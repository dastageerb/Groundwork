// Fail fast at a bounded queue. Waiting work is cancellable and owns no DB client.
export class Capacity {
  constructor(limit = 2, maxWaiting = 12) { this.limit = limit; this.maxWaiting = maxWaiting; this.active = 0; this.waiting = []; }
  async run(action, signal) {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.maxWaiting) throw Object.assign(new Error('The local engine is busy. Please try again shortly.'), { status: 503 });
      await new Promise((resolve, reject) => {
        const item = { resolve: () => { cleanup(); resolve(); } };
        const cancel = () => { this.waiting = this.waiting.filter(v => v !== item); cleanup(); reject(signal.reason); };
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        signal?.addEventListener('abort', cancel, { once: true });
        this.waiting.push(item);
      });
    } else this.active++;
    try { signal?.throwIfAborted(); return await action(); }
    finally { const next = this.waiting.shift(); if (next) next.resolve(); else this.active--; }
  }
}
