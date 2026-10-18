import { vectorLiteral } from './chunking.js';
import { accessPredicate } from './access.js';
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const DECLINE = 'I couldn’t find enough information in your company documents to answer that. Try asking about a policy, benefit, or process covered in your documents.';
export async function retrieve(pool, model, config, user, question, signal) {
  const { rows: [before] } = await pool.query('SELECT * FROM index_meta WHERE id=1');
  if (!before?.generation_id) throw new HttpError(409, 'Rebuild the document index before asking questions.');
  const identity = await model.identity();
  if (before.model !== config.embedModel || before.model_digest !== identity.digest) throw new HttpError(409, 'The embedding model changed. Rebuild the index.');
  if ((await model.identity(before.pinned_model)).digest !== before.model_digest) throw new HttpError(409, 'The indexed model artifact is unavailable. Rebuild the index.');
  const embedding = await model.embed(question, signal, before.pinned_model);
  if (embedding.length !== before.dimensions) throw new HttpError(409, 'Embedding dimensions changed. Rebuild the index.');
  if ((await model.identity(before.pinned_model)).digest !== before.model_digest) throw new HttpError(409, 'The indexed model artifact changed. Rebuild the index.');
  signal?.throwIfAborted();
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [meta] } = await db.query('SELECT * FROM index_meta WHERE id=1');
    if (meta?.generation_id !== before.generation_id) throw new HttpError(409, 'The index changed while searching. Please ask again.');
    const { rows } = await db.query(`WITH accessible AS MATERIALIZED (
      SELECT c.*,d.title FROM chunks c JOIN documents d ON d.id=c.document_id
      WHERE c.generation_id=$4 AND c.document_revision=d.revision AND d.needs_index=false AND ${accessPredicate('d', '$2')}
    ) SELECT id,document_id,document_revision,generation_id,title,breadcrumb,content,1-(embedding <=> $1::vector) AS similarity
      FROM accessible ORDER BY embedding <=> $1::vector LIMIT $3`, [vectorLiteral(embedding), user.id, config.topK, meta.generation_id]);
    await db.query('COMMIT');
    return rows.filter(row => Number(row.similarity) >= config.threshold);
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

