import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createIndexer } from '../src/indexer.js';
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'groundwork-index-test-'));
  await writeFile(path.join(dir,'policy.md'),'# Policy\n## Leave\n20 days.\n## Remote work\nThree days.');
  const calls=[]; let job; let released=0;
  const query=async(sql,args)=>{
    calls.push(sql);
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
    if(sql.includes('INSERT INTO index_jobs'))job={id:args[0],status:'running'};
    if(sql.includes("SET status='complete'"))job.status='complete';
    if(sql.includes("SET status='failed',message=$2"))job.status='failed';
    return {rows:[]};
  };
  const pool={query,async connect(){return {query,release(){released++;}};}};
  const wait=async()=>{for(let i=0;i<100;i++){if(job?.status!=='running'&&released>0)return;await new Promise(r=>setTimeout(r,10));}throw new Error('Index job timed out');};
  return {dir,calls,pool,wait,get job(){return job;},cleanup:()=>rm(dir,{recursive:true,force:true})};
}
test('successful indexing publishes all vectors and metadata in a transaction',async()=>{
  const f=await fixture();
  try {
    const indexer=createIndexer(f.pool,{embed:async()=>[1,0]},{docsPath:f.dir,embedModel:'test'});
    await indexer.start();await f.wait();assert.equal(f.job.status,'complete');
    const begin=f.calls.indexOf('BEGIN');const deletion=f.calls.indexOf('DELETE FROM documents');const commit=f.calls.indexOf('COMMIT');
    assert.ok(begin>=0&&begin<deletion&&deletion<commit);
    assert.equal(f.calls.filter(q=>q.includes('INSERT INTO chunks')).length,2);
    assert.ok(f.calls.some(q=>q.includes('INSERT INTO index_meta')));
  } finally {await f.cleanup();}
});
test('failed embeddings never delete the live index',async()=>{
  const f=await fixture();let count=0;
  try {
    const indexer=createIndexer(f.pool,{embed:async()=>{if(++count===2)throw new Error('Deliberate test model failure');return [1,0];}},{docsPath:f.dir,embedModel:'test'});
    await indexer.start();await f.wait();assert.equal(f.job.status,'failed');
    assert.equal(f.calls.includes('DELETE FROM documents'),false);
    assert.equal(f.calls.some(q=>q.includes('INSERT INTO index_meta')),false);
    assert.ok(f.calls.some(q=>q.includes('pg_advisory_unlock')));
  } finally {await f.cleanup();}
});
test('a running index build rejects a second rebuild',async()=>{
  const f=await fixture();let release;const paused=new Promise(r=>{release=r;});
  try {
    const indexer=createIndexer(f.pool,{embed:async()=>{await paused;return [1,0];}},{docsPath:f.dir,embedModel:'test'});
    await indexer.start();await assert.rejects(indexer.start(),e=>e.status===409);release();await f.wait();
  } finally {release();await f.cleanup();}
});
