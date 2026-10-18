import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base = process.env.EVAL_URL || 'http://localhost:3000';
const username = process.env.EVAL_USERNAME; const password = process.env.EVAL_PASSWORD;
if (!username || !password) throw new Error('Set EVAL_USERNAME and EVAL_PASSWORD for an existing account with a permanent password.');
const response = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username,password}) });
if (!response.ok) throw new Error(`Login failed: ${response.status}`);
const cookie = response.headers.get('set-cookie').split(';')[0];
const cases = JSON.parse(await readFile(new URL('../evaluation/questions.json',import.meta.url),'utf8')); const results=[];
try {
  for (const item of cases) {
    if (item.release !== 'v0.1') { results.push({...item,status:'deferred — requires v0.2 access control'}); continue; }
    const start=performance.now();
    const result=await fetch(`${base}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({question:item.question})});
    const raw=await result.text(); let answer=''; let final;
    for(const block of raw.split('\n\n')) { const event=/^event: (.+)$/m.exec(block)?.[1]; const data=/^data: (.+)$/m.exec(block)?.[1]; if(!data)continue; const parsed=JSON.parse(data); if(event==='token')answer+=parsed.text; if(event==='done')final=parsed; }
    results.push({...item,status:result.ok&&final?'complete':'failed',latencyMs:Math.round(performance.now()-start),answer,...final,expectedOutcomeMatched:final?final.declined===item.declined:false});
    console.log(`${results.length}/${cases.length}: ${results.at(-1).status}`);
    // Stay below the normal account chat rate limit.
    await new Promise(resolve=>setTimeout(resolve,3100));
  }
  await mkdir('test-results',{recursive:true}); await writeFile('test-results/evaluation.json',JSON.stringify({date:new Date().toISOString(),note:'Review answer and citation correctness manually. Record models and hardware alongside results.',results},null,2));
  console.log('Saved test-results/evaluation.json. Review semantic and citation correctness manually.');
} finally { await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Origin:base,Cookie:cookie}}); }
