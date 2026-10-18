// Run only against an isolated disposable PostgreSQL + pgvector database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
const url = process.env.TEST_DATABASE_URL;
test('authentication, server permissions, gate, streaming, and model mismatch', {skip: !url}, async () => {
  const pool = database(url); await migrate(pool);
  assert.equal((await pool.query('SELECT id FROM users')).rowCount, 0, 'Test database must have no users');
  let chats = 0;
  const model = {tags:async()=>['test-chat','test-embed'],embed:async q=>q.includes('football')?[0,1]:[1,0],async *chat(){chats++;yield 'You have 20 days of annual leave. [1]';}};
  const config = {secret:'integration-test-secret-32-characters',setupCode:'integration-code',publicUrl:'http://localhost:3000',secure:false,embedModel:'test-embed',chatModel:'test-chat',threshold:.7,topK:4,docsPath:'../../sample-docs'};
  const server = createApp({pool,model,config}).listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, cookie, method = body ? 'POST':'GET') { return fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:config.publicUrl,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined}); }
  const cookie = r => r.headers.get('set-cookie')?.split(';')[0];
  const testPass = 'mock_auth_val_001';
  const testNewPass = 'mock_auth_val_002';
  try {
    assert.equal((await request('/api/users')).status,401);
    assert.equal((await request('/api/auth/setup',{name:'Admin',username:'admin',password:testPass,setupCode:'wrong'})).status,403);
    const setup = await request('/api/auth/setup',{name:'Admin',username:'admin',password:testPass,setupCode:config.setupCode}); assert.equal(setup.status,201); const admin=cookie(setup);
    assert.equal((await request('/api/auth/setup',{name:'Admin',username:'admin2',password:testPass,setupCode:config.setupCode})).status,409);
    const created = await request('/api/users',{name:'Member',username:'member'},admin); assert.equal(created.status,201); const member=await created.json();
    const login=await request('/api/auth/login',{username:'member',password:member.temporaryPassword}); const temporary=cookie(login); assert.equal(login.status,200);
    assert.equal((await request('/api/documents',null,temporary)).status,403);
    const changed=await request('/api/auth/change-password',{currentPassword:member.temporaryPassword,password:testNewPass},temporary); assert.equal(changed.status,200); const session=cookie(changed);
    assert.equal((await request('/api/me',null,temporary)).status,401);
    assert.equal((await request('/api/users',null,session)).status,403);
    assert.equal((await request('/api/index/rebuild',{},session)).status,403);
    const badOrigin=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:'https://attacker.example',Cookie:session}}); assert.equal(badOrigin.status,403);
    const doc=randomUUID(); await pool.query("INSERT INTO documents(id,title,source_path,content_hash) VALUES($1,'Handbook','test.md','test')",[doc]);
    await pool.query("INSERT INTO chunks(id,document_id,breadcrumb,content,embedding,ordinal) VALUES($1,$2,'Leave','20 days of annual leave','[1,0]',0)",[randomUUID(),doc]);
    await pool.query("INSERT INTO index_meta(id,model,dimensions) VALUES(1,'test-embed',2)");
    const decline=await request('/api/chat',{question:'Who won football?'},session); const declineText=await decline.text(); assert.match(declineText,/"declined":true/); assert.equal(chats,0);
    const answer=await request('/api/chat',{question:'How much leave?'},session); const answerText=await answer.text(); assert.match(answerText,/20 days/); assert.match(answerText,/"title":"Handbook"/); assert.equal(chats,1);
    await pool.query("UPDATE index_meta SET model='different'"); assert.equal((await request('/api/chat',{question:'leave'},session)).status,409); assert.equal(chats,1);
    const adminUser=await (await request('/api/me',null,admin)).json(); assert.equal((await request(`/api/users/${adminUser.id}`,{role:'member'},admin,'PATCH')).status,409);
    assert.equal((await request('/api/auth/logout',{},session)).status,200); assert.equal((await request('/api/me',null,session)).status,401);
  } finally { await new Promise(r=>server.close(r)); await pool.query('TRUNCATE users,documents,index_meta,index_jobs CASCADE'); await pool.end(); }
});
