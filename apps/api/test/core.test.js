import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument, vectorLiteral } from '../src/chunking.js';
import { retrieve } from '../src/retrieval.js';
import { configuration } from '../src/config.js';
import { Ollama } from '../src/ollama.js';
test('chunks retain heading ancestry and whole tables', () => {
  const table = '| Type | Days |\n| --- | --- |\n| Annual | 20 |';
  const chunks = chunkDocument(`# Handbook\n## Leave\nA first paragraph.\n\n${table}\n\n### Eligibility\nAfter 90 days.`, 'Fallback', 30);
  assert.equal(chunks[0].breadcrumb, 'Handbook › Leave');
  assert.ok(chunks.some(c => c.content === table));
  assert.equal(chunks.at(-1).breadcrumb, 'Handbook › Leave › Eligibility');
});
test('fenced headings do not become document structure', () => {
  const chunks = chunkDocument('# Manual\n```sh\n# comment\n```\n\nText');
  assert.equal(chunks.length, 1); assert.equal(chunks[0].breadcrumb, 'Manual'); assert.match(chunks[0].content, /# comment/);
});
test('plain text uses filename and empty documents produce no chunks', () => {
  assert.deepEqual(chunkDocument('  '), []); assert.equal(chunkDocument('Hello', 'Policy.txt')[0].breadcrumb, 'Policy.txt');
});
test('oversized blocks fail without silent truncation', () => assert.throws(() => chunkDocument('a'.repeat(16001)), /16,000/));
test('invalid and zero vectors are rejected', () => {
  for (const v of [[], [NaN], [Infinity], ['1'], [0,0]]) assert.throws(() => vectorLiteral(v));
  assert.equal(vectorLiteral([0.1, -0.2]), '[0.1,-0.2]');
});
function mockDb(meta, rows = []) {
  const calls = [];
  return { calls, async query(sql, args) { calls.push({ sql, args }); if (sql.includes('index_meta')) return { rows: meta ? [meta] : [] }; if (sql.includes('WITH accessible')) return { rows }; return { rows: [] }; } };
}
const config = { embedModel: 'embedding', threshold: .6, topK: 4 };
test('a missing or mismatched index fails before embedding', async () => {
  for (const meta of [null, { model:'other', dimensions:2 }]) {
    let calls = 0; const db = mockDb(meta);
    await assert.rejects(retrieve(db, { embed: async () => { calls++; return [1,0]; } }, config, { id:'user' }, 'hello'), e => e.status === 409);
    assert.equal(calls, 0); assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  }
});
test('retrieval filters accessible chunks before ranking and gate drops low matches', async () => {
  const db = mockDb({model:'embedding',dimensions:2}, [{id:'low',similarity:.2}, {id:'high',similarity:.8}]);
  const rows = await retrieve(db, {embed:async()=>[1,0]}, config, {id:'user'}, 'leave');
  assert.deepEqual(rows.map(r=>r.id), ['high']);
  const query = db.calls.find(c => c.sql.includes('WITH accessible'));
  assert.match(query.sql, /accessible AS MATERIALIZED/); assert.match(query.sql, /visibility='everyone'/); assert.equal(query.args[1], 'user');
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});
test('dimension mismatch fails closed', async () => {
  await assert.rejects(retrieve(mockDb({model:'embedding',dimensions:3}), {embed:async()=>[1,0]}, config, {id:'user'}, 'x'), e=>e.status===409);
});
test('configuration rejects unsupported auth modes and unsafe settings', () => {
  assert.throws(()=>configuration({}), /SESSION_SECRET/);
  assert.throws(()=>configuration({AUTH_MODE:'oidc'}), /v0.1/);
  assert.throws(()=>configuration({SIMILARITY_THRESHOLD:'NaN'}), /THRESHOLD/);
});
test('Ollama parser handles split JSON lines and refuses incomplete streams', async () => {
  const model = new Ollama({});
  const encoder = new TextEncoder();
  model.request = async () => new Response(new ReadableStream({start(c){for (const s of ['{"message":{"content":"He','llo"}}\n','{"done":true}\n']) c.enqueue(encoder.encode(s));c.close();}}));
  let answer = ''; for await (const text of model.chat('?', [])) answer += text; assert.equal(answer,'Hello');
  model.request = async () => new Response('{"message":{"content":"Partial"}}\n');
  await assert.rejects(async()=>{for await (const text of model.chat('?', [])) {}}, /before completion/);
});
