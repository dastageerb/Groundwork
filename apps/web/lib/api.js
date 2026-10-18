export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if(response.status===401&&!['/me','/auth/login','/auth/setup'].includes(path)&&typeof window!=='undefined')window.dispatchEvent(new Event('groundwork:expired'));
  if (!response.ok) { const error = new Error(data.error || 'The server is unavailable. Please try again.'); error.status = response.status; throw error; }
  return data;
}
export async function streamQuestion(question, signal, onEvent) {
  const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal });
  if(response.status===401)window.dispatchEvent(new Event('groundwork:expired'));
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Unable to send your question.'); }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ''; let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      pending += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const raw = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(raw)?.[1]; const data = /^data: (.+)$/m.exec(raw)?.[1];
        if (!event || !data) continue;
        const parsed = JSON.parse(data);
        if (event === 'error') throw new Error(parsed.error);
        if (event === 'done') completed = true;
        onEvent(event, parsed);
      }
    }
    if (!completed) throw new Error('The connection ended before the answer finished. Please try again.');
  } finally { reader.releaseLock(); }
}
