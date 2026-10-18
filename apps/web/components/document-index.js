'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

export default function DocumentIndex({ health, onChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lastJob = useRef(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    let active = true;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await api('/index/status');
        if (!active) return;
        setData(next);
        setError('');
        const previous = lastJob.current;
        lastJob.current = next.job;
        if (previous?.status === 'running' && next.job?.status !== 'running') {
          Promise.resolve(changed.current?.()).catch(e => { if (active) setError(e.message); });
        }
      } catch (e) { if (active) setError(e.message); }
      finally { loading = false; }
    }
    load();
    const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function rebuild() {
    setBusy(true); setError('');
    try {
      await api('/index/rebuild', { method: 'POST' });
      const next = await api('/index/status');
      setData(next); lastJob.current = next.job;
      await changed.current?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const job = data?.job;
  const running = job?.status === 'running';
  const ready = health?.status === 'ready';
  const title = running ? 'Indexing' : job?.status === 'failed' ? 'Indexing failed' : ready ? 'Index ready' : health?.ollama === 'offline' ? 'Engine offline' : health?.index === 'model_mismatch' ? 'Rebuild required' : 'Not indexed';
  return <section className="index-strip" aria-label="Document index">
    <div className="index-strip-row"><span className={'status '+(!ready?'warning':'')}><i/><strong>{title}</strong></span><span className="index-date">{running?`${job.completed} of ${job.total} documents`:data?.meta?.built_at?'Updated '+new Date(data.meta.built_at).toLocaleString():''}</span><button className="button small outline" disabled={busy || running || !data} onClick={rebuild}><RefreshCw size={14} className={running?'spin':''}/>{busy || running?'Indexing…':'Rebuild index'}</button></div>
    {running && <progress aria-label="Indexing progress" max={job.total || 1} value={job.completed}/>}
    {job?.message && (running || job.status === 'failed') && <p className={job.status === 'failed'?'error':'small-copy muted'} role="status">{job.message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <details className="index-more"><summary>Engine details <ChevronDown size={13}/></summary><dl><div><dt>Connection</dt><dd>{health?.ollama==='online'?'Connected':'Unavailable'}</dd></div><div><dt>Embedding model</dt><dd>{data?.configuredModel || 'Loading…'}</dd></div><div><dt>Vector dimensions</dt><dd>{data?.meta?.dimensions || 'Not indexed yet'}</dd></div></dl><p>Rebuilding imports folder files and publishes uploaded or edited documents. Unchanged documents remain searchable.</p></details>
  </section>;
}
