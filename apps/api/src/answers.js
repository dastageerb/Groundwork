import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { retrieve, DECLINE } from './retrieval.js';
import { Capacity } from './capacity.js';

export const answerSchema = {
  type: 'object', additionalProperties: false, required: ['declined', 'claims'],
  properties: { declined: { type: 'boolean' }, claims: { type: 'array', maxItems: 8, items: {
    type: 'object', additionalProperties: false, required: ['text', 'citations'],
    properties: { text: { type: 'string' }, citations: { type: 'array', items: { type: 'integer' }, minItems: 1 } }
  } } }
};
const responseShape = z.object({ declined: z.boolean(), claims: z.array(z.object({
  text: z.string().trim().min(1).max(2000), citations: z.array(z.number().int().positive()).min(1).max(12)
}).strict()).max(8) }).strict();

export function registerAnswers(app, { pool, model, config, auth, changed, limiter }) {
  const admission = new Capacity(4, 8);
  app.post('/api/chat', auth, changed, limiter, async (req, res) => {
    const { question } = z.object({ question: z.string().trim().min(1).max(2000) }).parse(req.body);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(300000)]);
    await admission.run(async () => {
      const id = randomUUID(); const started = Date.now(); let called = false; let finished = false; let evidence = [];
      await pool.query("INSERT INTO audit_log(id,user_id,question,outcome) VALUES($1,$2,$3,'pending')", [id, req.user.id, question]);
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
      const send = (event, data) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
      try {
        send('status', { text: 'Searching authorized documents', auditId: id });
        let sources = await retrieve(pool, model, config, req.user, question, signal);
        // UTF-8 bytes conservatively bound ordinary tokenizer input. Reserve space
        // for the system prompt, serialization overhead and generated output.
        let budget = config.contextTokens - config.answerTokens - 1800 - Buffer.byteLength(question);
        sources = sources.filter(s => { const cost = Buffer.byteLength(JSON.stringify(s)) + 100; if (cost > budget) return false; budget -= cost; return true; });
        evidence = sources.map((s,i)=>({citation:i+1,id:s.id,documentId:s.document_id,revision:s.document_revision,generationId:s.generation_id,title:s.title,section:s.breadcrumb,excerpt:s.content}));
        let text = DECLINE; let declined = true; let used = [];
        if (sources.length) {
          send('status', { text: 'Preparing a sourced answer' });
          const raw = await model.answer(question, sources, signal, () => { called = true; });
          let result;
          try { result = responseShape.parse(JSON.parse(raw)); } catch { result = null; }
          if (result && !result.declined && result.claims.length && result.claims.every(c => c.citations.every(n => n <= sources.length) && !/\[\d+\]/.test(c.text))) {
            declined = false;
            const seen = new Set();
            const claims = result.claims.filter(c => { const key=c.text.toLowerCase().replace(/\s+/g,' '); if(seen.has(key))return false;seen.add(key);return true; });
            const ids = [...new Set(claims.flatMap(c => c.citations))];
            const numbers = new Map(ids.map((id,i)=>[id,i+1]));
            text = claims.map(c => `${c.text} ${[...new Set(c.citations)].map(n => `[${numbers.get(n)}]`).join(' ')}`).join('\n\n');
            used = ids.map(n => ({...evidence[n-1], citation:numbers.get(n)}));
            // Retain all considered evidence in the audit while recording displayed numbering.
            evidence = evidence.map(s=>({...s,answerCitation:numbers.get(s.citation)||null}));
          } else text = 'The available documents do not provide a sufficiently supported answer. Please check the documents or ask a more specific question.';
        }
        signal.throwIfAborted();
        // The full structure is validated before any answer text is published.
        for (const paragraph of text.split('\n\n')) send('token', { text: `${paragraph}\n\n` });
        signal.throwIfAborted();
        await pool.query('UPDATE audit_log SET outcome=$2,sources=$3,answer_text=$4,model_called=$5,duration_ms=$6,finished_at=now() WHERE id=$1', [id, declined ? 'declined' : 'answered', JSON.stringify(evidence), text, called, Date.now() - started]);
        signal.throwIfAborted();
        finished = true;
        send('done', { auditId: id, declined, modelCalled: called, sources: used });
      } catch (error) {
        await pool.query("UPDATE audit_log SET outcome=$2,model_called=$3,duration_ms=$4,sources=$5,finished_at=now() WHERE id=$1 AND outcome IN ('pending','answered','declined')", [id, abort.signal.aborted ? 'cancelled' : 'failed', called, Date.now() - started, JSON.stringify(evidence)]).catch(() => console.error('Unable to finalize answer audit', id));
        if (!res.destroyed) send('error', { error: error.status ? error.message : 'The local engine could not complete this answer. Please try again.' });
      } finally { clearInterval(heartbeat); if (!finished && signal.aborted) console.info('Answer interrupted', id); res.end(); }
    }, signal);
  });
}
