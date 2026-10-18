import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
const config = {secret:'http-tests-secret-longer-than-32-characters',publicUrl:'http://localhost:3000',embedModel:'embed',chatModel:'chat',threshold:.6,topK:4};
const token='test-token';
const signature=createHmac('sha256',config.secret).update(token).digest('base64').replace(/=+$/,'');
const cookie=`groundwork=${encodeURIComponent(`s:${token}.${signature}`)}`;
test('HTTP middleware and pre-model gate enforce the backend boundary', async () => {
  let mode='member'; let similarity=.2; let chatCalls=0; let embeddingCalls=0;
  const queries=[];
  const pool={async query(sql,args){
    queries.push(sql);
    if(sql.includes('JOIN users')) return {rows:[{id:'00000000-0000-4000-8000-000000000001',name:'Member',username:'member',role:mode==='admin'?'admin':'member',must_change_password:mode==='temporary'}]};
    if(sql.includes('index_meta'))return {rows:[{model:'embed',dimensions:2}]};
    if(sql.includes('WITH accessible'))return {rows:[{id:'source',document_id:'doc',title:'Handbook',breadcrumb:'Leave',content:'20 days',similarity}]};
    return {rows:[]};
  },async connect(){return {query:pool.query,release(){}};}};
  const model={async embed(){embeddingCalls++;return [1,0];},async *chat(){chatCalls++;yield '20 days. [1]';}};
  const server=createApp({pool,model,config}).listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,body,overrides={})=>fetch(base+path,{method:body?'POST':'GET',headers:{Origin:config.publicUrl,Cookie:cookie,'Content-Type':'application/json',...overrides},body:body?JSON.stringify(body):undefined});
  try {
    assert.equal((await call('/api/documents',null,{Cookie:''})).status,401);
    assert.equal((await call('/api/users')).status,403);
    assert.equal((await call('/api/index/rebuild',{})).status,403);
    assert.equal((await call('/api/chat',{question:'hi'},{Origin:'https://untrusted.example'})).status,403);
    mode='temporary';assert.equal((await call('/api/chat',{question:'hi'})).status,403);mode='member';
    assert.equal(embeddingCalls,0);assert.equal(chatCalls,0);
    assert.equal((await call('/api/chat',{question:''})).status,422);
    const declined=await call('/api/chat',{question:'off topic'});assert.equal(declined.status,200);assert.match(declined.headers.get('content-type'),/event-stream/);
    assert.match(await declined.text(),/"modelCalled":false/);assert.equal(chatCalls,0);
    similarity=.9;const answered=await call('/api/chat',{question:'leave'});const content=await answered.text();assert.match(content,/20 days/);assert.match(content,/"title":"Handbook"/);assert.equal(chatCalls,1);
    assert.ok(queries.some(q=>q.includes('accessible AS MATERIALIZED')));
    assert.equal((await call('/api/me',null,{Cookie:cookie+'tampered'})).status,401);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
