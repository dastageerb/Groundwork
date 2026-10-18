'use client';
import { useEffect, useState } from 'react';
import { ArrowUp, FileText, RotateCcw } from 'lucide-react';
const scenes = [
  { question: 'When can I start taking annual leave?', answer: 'You can request annual leave after completing your first 90 days. Submit your request at least two weeks in advance through your manager.', source: 'People handbook · Annual leave' },
  { question: 'Can you write me a birthday poem?', answer: 'I can only answer questions covered by your company documents. I couldn’t find information to support this request.', declined: true }
];
export default function Demo() {
  const [step, setStep] = useState(0); const [typed, setTyped] = useState(''); const [paused, setPaused] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || paused) { setStep(2); setTyped(''); return; }
    const scene = scenes[Math.floor(step / 3) % 2]; let timeout;
    if (step % 3 === 0 && typed.length < scene.question.length) timeout = setTimeout(() => setTyped(scene.question.slice(0, typed.length + 1)), 48);
    else timeout = setTimeout(() => { setStep((step + 1) % 6); setTyped(''); }, step % 3 === 2 ? 5500 : 1200);
    return () => clearTimeout(timeout);
  }, [step, typed, paused]);
  const scene = scenes[Math.floor(step / 3) % 2];
  return <div className="demo-wrap"><div className="demo"><div className="demo-head"><strong>Ask your policies</strong><span className="status"><i/>Illustrative demo</span></div><div className="demo-messages" aria-live="off"><div className="demo-watermark"><BrandMark/><span>Your knowledge. A little more accessible.</span></div>{step % 3 > 0 && <div className="bubble user">{scene.question}</div>}{step % 3 === 1 && <div className="bubble assistant"><span className="dots">● ● ●</span> Searching your documents…</div>}{step % 3 === 2 && <div className="bubble assistant">{scene.answer}{scene.source && <span className="citation"><FileText size={13}/>{scene.source}</span>}{scene.declined && <span className="declined">Declined before chat generation</span>}</div>}</div><div className="demo-input"><span>{typed || 'Ask about a policy…'}{typed && <b className="caret"/>}</span><span className="send"><ArrowUp size={21}/></span></div></div><button className="text-button demo-control" onClick={() => setPaused(!paused)}><RotateCcw size={13}/>{paused ? 'Play animation' : 'Pause animation'}</button></div>;
}
function BrandMark() { return <span className="knowledge-mark">✳</span>; }
