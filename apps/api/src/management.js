import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { HttpError } from './retrieval.js';
import { extractDocument } from './parsers.js';
import { accessPredicate } from './access.js';
const departments=z.array(z.uuid()).max(100).default([]);
const metadata=z.object({title:z.string().trim().min(1).max(200),category:z.string().trim().min(1).max(80).default('General'),version:z.string().trim().min(1).max(50).default('1'),visibility:z.enum(['everyone','departments','admins']).default('admins'),departments});
export async function replaceDepartments(db,table,column,id,ids) {
  // Table/column are internal constants, never client input.
  if(ids.length){const found=await db.query('SELECT id FROM departments WHERE id=ANY($1::uuid[])',[ids]);if(found.rowCount!==new Set(ids).size)throw new HttpError(422,'One or more departments no longer exist.');}
  await db.query(`DELETE FROM ${table} WHERE ${column}=$1`,[id]);
  for(const department of new Set(ids))await db.query(`INSERT INTO ${table}(${column},department_id) VALUES($1,$2)`,[id,department]);
}
export function registerManagement(app,{pool,auth,changed,admin}) {
  app.get('/api/departments',auth,changed,async(req,res)=>res.json((await pool.query('SELECT * FROM departments ORDER BY name')).rows));
  app.post('/api/departments',auth,changed,admin,async(req,res)=>{const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(req.body);res.status(201).json((await pool.query('INSERT INTO departments(id,name) VALUES($1,$2) RETURNING *',[randomUUID(),name])).rows[0]);});
  app.patch('/api/departments/:id',auth,changed,admin,async(req,res)=>{const id=z.uuid().parse(req.params.id);const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(req.body);const result=await pool.query('UPDATE departments SET name=$2 WHERE id=$1 RETURNING *',[id,name]);if(!result.rowCount)throw new HttpError(404,'Department not found.');res.json(result.rows[0]);});
  app.delete('/api/departments/:id',auth,changed,admin,async(req,res)=>{const id=z.uuid().parse(req.params.id);await transaction(pool,async db=>{const result=await db.query('DELETE FROM departments WHERE id=$1 RETURNING id',[id]);if(!result.rowCount)throw new HttpError(404,'Department not found.');});res.json({ok:true});});
  app.get('/api/admin/documents',auth,changed,admin,async(req,res)=>{
    const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const {rows}=await pool.query(`SELECT d.id,d.title,d.category,d.version,d.visibility,d.source_kind,d.needs_index,d.indexed_at,d.revision,
      ARRAY(SELECT department_id FROM document_departments WHERE document_id=d.id) AS departments,
      (SELECT count(*)::int FROM chunks c WHERE c.document_id=d.id AND c.generation_id=(SELECT generation_id FROM index_meta WHERE id=1) AND c.document_revision=d.revision) AS chunks
      FROM documents d WHERE deleted_at IS NULL ORDER BY title,id LIMIT 51 OFFSET $1`,[(page-1)*50]);
    res.json({items:rows.slice(0,50),hasMore:rows.length>50,page});
  });
  app.get('/api/admin/documents/:id',auth,changed,admin,async(req,res)=>{
    const {rows:[doc]}=await pool.query('SELECT d.*,ARRAY(SELECT department_id FROM document_departments WHERE document_id=d.id) AS departments FROM documents d WHERE id=$1 AND deleted_at IS NULL',[z.uuid().parse(req.params.id)]);
    if(!doc)throw new HttpError(404,'Document not found.');res.json(doc);
  });
  let uploads=0;
  async function create(input,text) {
    const data=metadata.parse(input);
    if(data.visibility==='departments'&&!data.departments.length)throw new HttpError(422,'Select at least one department.');
    const id=randomUUID();
    await transaction(pool,async db=>{await db.query("INSERT INTO documents(id,title,category,version,visibility,source_path,source_kind,content_text,content_hash,needs_index) VALUES($1,$2,$3,$4,$5,$6,'managed',$7,$8,true)",[id,data.title,data.category,data.version,data.visibility,`managed/${id}`,text,createHash('sha256').update(text).digest('hex')]);await replaceDepartments(db,'document_departments','document_id',id,data.visibility==='departments'?data.departments:[]);});
    return {id,needs_index:true};
  }
  app.post('/api/documents',auth,changed,admin,async(req,res)=>{const {content}=z.object({content:z.string().trim().min(1).max(2_000_000)}).parse(req.body);res.status(201).json(await create(req.body,content));});
  app.post('/api/documents/upload',auth,changed,admin,async(req,res,next)=>{
    if(uploads>=2)throw new HttpError(503,'Document uploads are busy. Please try again shortly.');
    uploads++;let released=false;const release=()=>{if(!released){released=true;uploads--;}};
    res.once('close',release);res.once('finish',release);
    // Import lazily so text ingestion does not load file parsing dependencies.
    const {default:multer}=await import('multer');
    multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:6,fieldSize:10000}}).single('file')(req,res,error=>error?next(new HttpError(422,'Upload failed. Use one file no larger than 10 MB.')):next());
  },async(req,res)=>{
    if(!req.file)throw new HttpError(422,'Select a file to upload.');
    let ids;try{ids=JSON.parse(req.body.departments||'[]');}catch{throw new HttpError(422,'Invalid department selection.');}
    const text=await extractDocument(req.file.buffer,req.file.originalname);
    res.status(201).json(await create({...req.body,departments:ids,title:req.body.title||req.file.originalname},text));
  });
  app.patch('/api/documents/:id',auth,changed,admin,async(req,res)=>{
    const id=z.uuid().parse(req.params.id);const data=metadata.parse(req.body);const content=z.string().trim().min(1).max(2_000_000).optional().parse(req.body.content);
    if(data.visibility==='departments'&&!data.departments.length)throw new HttpError(422,'Select at least one department.');
    await transaction(pool,async db=>{
      const {rows:[doc]}=await db.query('SELECT * FROM documents WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id]);if(!doc)throw new HttpError(404,'Document not found.');
      if(content!==undefined && doc.source_kind==='folder')throw new HttpError(422,'Edit folder documents in their source folder, then rebuild. You can change their access and metadata here.');
      const textChanged=content!==undefined&&content!==doc.content_text;
      await db.query('UPDATE documents SET title=$2,category=$3,version=$4,visibility=$5,content_text=COALESCE($6,content_text),needs_index=needs_index OR $7,revision=revision+CASE WHEN $7 THEN 1 ELSE 0 END,content_hash=CASE WHEN $6::text IS NULL THEN content_hash ELSE $8 END WHERE id=$1',[id,data.title,data.category,data.version,data.visibility,content??null,textChanged||data.title!==doc.title,content===undefined?null:createHash('sha256').update(content).digest('hex')]);
      await replaceDepartments(db,'document_departments','document_id',id,data.visibility==='departments'?data.departments:[]);
    });res.json({ok:true});
  });
  app.delete('/api/documents/:id',auth,changed,admin,async(req,res)=>{
    const id=z.uuid().parse(req.params.id);await transaction(pool,async db=>{const result=await db.query('UPDATE documents SET deleted_at=now(),content_text=NULL,revision=revision+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id',[id]);if(!result.rowCount)throw new HttpError(404,'Document not found.');});res.json({ok:true});
  });
  app.get('/api/audit',auth,changed,admin,async(req,res)=>{
    const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const {rows}=await pool.query(`SELECT a.id,a.user_id,a.question,a.outcome,a.model_called,a.duration_ms,a.created_at,
      CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.sources) s WHERE NOT EXISTS(SELECT 1 FROM documents d WHERE d.id=(s->>'documentId')::uuid AND ${accessPredicate('d','$2')})) THEN a.answer_text ELSE '[Source access changed; answer hidden]' END AS answer_text,
      COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(a.sources) s JOIN documents d ON d.id=(s->>'documentId')::uuid WHERE ${accessPredicate('d','$2')}),'[]'::jsonb) AS sources,
      u.name AS user_name,u.username,f.helpful,f.comment FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN feedback f ON f.audit_id=a.id AND f.user_id=a.user_id ORDER BY a.created_at DESC LIMIT 51 OFFSET $1`,[(page-1)*50,req.user.id]);
    res.json({items:rows.slice(0,50),hasMore:rows.length>50,page});
  });
  app.post('/api/feedback',auth,changed,async(req,res)=>{
    const input=z.object({auditId:z.uuid(),helpful:z.boolean(),comment:z.string().trim().max(1000).default('')}).parse(req.body);
    const result=await pool.query(`INSERT INTO feedback(audit_id,user_id,helpful,comment) SELECT id,user_id,$3,$4 FROM audit_log WHERE id=$1 AND user_id=$2 AND outcome IN ('answered','declined') ON CONFLICT(audit_id,user_id) DO UPDATE SET helpful=$3,comment=$4,created_at=now() RETURNING audit_id`,[input.auditId,req.user.id,input.helpful,input.comment]);
    if(!result.rowCount)throw new HttpError(404,'Completed answer not found.');res.json({ok:true});
  });
}
