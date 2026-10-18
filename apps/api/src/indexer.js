import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { chunkDocument, vectorLiteral } from './chunking.js';
import { transaction } from './db.js';
import { HttpError } from './retrieval.js';
import { extractDocument } from './parsers.js';
async function filesIn(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(file));
    else if (/\.(md|txt|pdf|docx)$/i.test(entry.name)) result.push(file);
  }
  return result.sort();
}
export function createIndexer(pool, model, config) {
  let running = false;
  return { async start() {
    if (running) throw new HttpError(409, 'An index rebuild is already running.');
    running = true; const id = randomUUID();
    try {
      await transaction(pool, async db => {
        await db.query('SELECT pg_advisory_xact_lock(762911)');
        if ((await db.query("SELECT id FROM index_jobs WHERE status='running' AND heartbeat_at>now()-interval '2 minutes'")).rowCount) throw new HttpError(409, 'An index rebuild is already running.');
        await db.query("UPDATE index_jobs SET status='failed',message='Worker interrupted. Rebuild to retry.',finished_at=now() WHERE status='running'");
        await db.query("INSERT INTO index_jobs(id,status,message) VALUES($1,'running','Preparing document revisions')", [id]);
      });
      void rebuild(id).finally(() => { running = false; });
      return { id, status: 'running' };
    } catch (error) { running = false; throw error; }
  } };
  async function rebuild(id) {
    const abort = new AbortController();
    const timer = setInterval(() => pool.query("UPDATE index_jobs SET heartbeat_at=now() WHERE id=$1 AND status='running' RETURNING id", [id]).then(r => { if (!r.rowCount) abort.abort(); }).catch(() => abort.abort()), 15000);
    try {
      const files = await filesIn(config.docsPath);
      const pin = await model.pin();
      const pipeline = 'chunk-v2/lock-' + createHash('sha256').update(await readFile(new URL('../../../package-lock.json',import.meta.url))).digest('hex');
      await pool.query("INSERT INTO index_generations(id,model,model_digest,pinned_model,pipeline,status) VALUES($1,$2,$3,$4,$5,'staging')", [id, config.embedModel, pin.digest, pin.name, pipeline]);
      const folderPaths = files.map(file => path.relative(config.docsPath, file).replaceAll('\\', '/'));
      // Only IDs are kept in memory; managed content is loaded one document at a time.
      const managed = (await pool.query("SELECT id FROM documents WHERE source_kind='managed' AND deleted_at IS NULL ORDER BY id")).rows;
      const inputs = [...files.map((file, i) => ({ file, source: folderPaths[i] })), ...managed];
      await pool.query('UPDATE index_jobs SET total=$2 WHERE id=$1', [id, inputs.length]);
      let dimensions; let count = 0;
      for (const input of inputs) {
        abort.signal.throwIfAborted();
        let doc;
        if (input.file) {
          if ((await stat(input.file)).size > 10 * 1024 * 1024) throw new Error('A document exceeds 10 MB.');
          const text = await extractDocument(await readFile(input.file), input.file);
          const hash = createHash('sha256').update(text).digest('hex');
          doc = await transaction(pool, async db => {
            await db.query("INSERT INTO documents(id,title,source_path,content_hash,content_text,visibility,needs_index) VALUES($1,$2,$3,$4,$5,'admins',true) ON CONFLICT(source_path) DO NOTHING", [randomUUID(), /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || path.basename(input.file), input.source, hash, text]);
            const { rows: [record] } = await db.query('SELECT * FROM documents WHERE source_path=$1 FOR UPDATE', [input.source]);
            if (record.deleted_at) return null;
            if (record.content_hash !== hash || record.content_text === null) return (await db.query('UPDATE documents SET content_text=$2,content_hash=$3,revision=revision+1,needs_index=true WHERE id=$1 RETURNING *', [record.id, text, hash])).rows[0];
            return record;
          });
        } else doc = (await pool.query('SELECT * FROM documents WHERE id=$1 AND deleted_at IS NULL', [input.id])).rows[0];
        if (doc) {
          const chunks = chunkDocument(doc.content_text, doc.title);
          if(!chunks.length)throw new Error('A document contains no indexable paragraphs.');
          for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
            const chunk = chunks[ordinal];
            const embedding = await model.embed(`${doc.title}\n${chunk.breadcrumb}\n${chunk.content}`, abort.signal, pin.name);
            dimensions ??= embedding.length;
            if (embedding.length !== dimensions) throw new Error('Embedding dimensions changed.');
            await pool.query('INSERT INTO chunks(id,document_id,breadcrumb,content,embedding,ordinal,generation_id,document_revision) VALUES($1,$2,$3,$4,$5::vector,$6,$7,$8)', [randomUUID(), doc.id, chunk.breadcrumb, chunk.content, vectorLiteral(embedding), ordinal, id, doc.revision]);
          }
        }
        await pool.query('UPDATE index_jobs SET completed=$2,message=$3 WHERE id=$1', [id, ++count, `Prepared ${count} of ${inputs.length} documents`]);
      }
      if (!dimensions) dimensions = (await model.embed('index dimensions', abort.signal, pin.name)).length;
      if ((await model.identity(pin.name)).digest !== pin.digest || (await model.identity()).digest !== pin.digest) throw new Error('Embedding model changed. Rebuild with the new model.');
      abort.signal.throwIfAborted();
      await transaction(pool, async db => {
        // Serialize publishers/job recovery only, never live ACL changes.
        await db.query('SELECT pg_advisory_xact_lock(762911)');
        const job = await db.query("SELECT id FROM index_jobs WHERE id=$1 AND status='running' FOR UPDATE", [id]);
        if (!job.rowCount) throw new Error('This build was superseded.');
        await db.query("UPDATE documents SET needs_index=true WHERE source_kind='folder' AND NOT(source_path=ANY($1::text[]))", [folderPaths]);
        await db.query('UPDATE documents d SET needs_index=false,indexed_at=now() WHERE d.deleted_at IS NULL AND EXISTS(SELECT 1 FROM chunks c WHERE c.document_id=d.id AND c.document_revision=d.revision AND c.generation_id=$1)', [id]);
        await db.query("UPDATE index_generations SET dimensions=$2,status='complete' WHERE id=$1", [id, dimensions]);
        await db.query('INSERT INTO index_meta(id,model,dimensions,generation_id,model_digest,pinned_model) VALUES(1,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET model=$1,dimensions=$2,generation_id=$3,model_digest=$4,pinned_model=$5,built_at=now()', [config.embedModel, dimensions, id, pin.digest, pin.name]);
        await db.query("UPDATE index_jobs SET status='complete',finished_at=now(),message='Index published. Documents edited during this build may need another rebuild.' WHERE id=$1", [id]);
      });
      // Audits retain exact excerpts; obsolete vectors need not grow indefinitely.
      await pool.query('DELETE FROM index_generations WHERE id<>$1 AND id NOT IN(SELECT generation_id FROM index_meta WHERE generation_id IS NOT NULL) AND created_at<now()-interval \'1 day\' AND status<>\'staging\'', [id]);
    } catch (error) {
      console.error('Index build failed:', error.message);
      await pool.query("UPDATE index_generations SET status='failed' WHERE id=$1 AND status='staging'", [id]).catch(() => {});
      await pool.query("UPDATE index_jobs SET status='failed',finished_at=now(),message=$2 WHERE id=$1 AND status='running'", [id, error.code === 'ENOENT' ? 'Document folder not found. Check DOCS_PATH.' : String(error.message).slice(0,300)]).catch(() => {});
    } finally { clearInterval(timer); }
  }
}

