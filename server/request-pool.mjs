// Independent implementation: share identical work, serialize upstream access,
// and retain a shared job until its final interested caller cancels.
const aborted = () => new DOMException('Aborted', 'AbortError');
export function createRequestPool({ now = Date.now, cooldownMs = 60000, maxEntries = 40, maxPending = 16 } = {}) {
  const cache = new Map(), jobs = new Map(), queue = [];
  let active = 0, blockedUntil = 0, closed = false;
  const peek = key => {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key); cache.delete(key); cache.set(key, value); return value;
  };
  const prime = (key, value) => {
    cache.delete(key); cache.set(key, value);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return value;
  };
  const rateError = () => {
    const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil - now()) / 1000));
    return Object.assign(new Error(`YouTube 限流（429）。本机暂停新字幕请求 ${retryAfterSeconds} 秒；之后可手动重试，不保证届时限流已解除。`), {
      status: 429, code: 'YOUTUBE_RATE_LIMITED', retryAfterSeconds,
    });
  };
  function finish(job, error, value) {
    if (job.done) return;
    job.done = true;
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    if (!error && !job.controller.signal.aborted && job.waiters.size) prime(job.key, value);
    for (const waiter of [...job.waiters]) waiter.settle(error, value);
  }
  function pump() {
    if (closed || active) return;
    while (queue.length && !active) {
      const job = queue.shift();
      if (job.done || job.controller.signal.aborted || !job.waiters.size) continue;
      const cached = peek(job.key);
      if (cached !== undefined) { finish(job, null, cached); continue; }
      if (now() < blockedUntil) { finish(job, rateError()); continue; }
      active++; job.started = true;
      void Promise.resolve().then(() => {
        job.controller.signal.throwIfAborted();
        return job.load(job.controller.signal);
      }).then(value => finish(job, null, value), error => {
        if (!error || typeof error !== 'object') error = new Error('字幕请求失败。');
        if (error.code === 'YOUTUBE_RATE_LIMITED' && error.status === 429) {
          blockedUntil = Math.max(blockedUntil, now() + cooldownMs);
          error = rateError();
        }
        finish(job, error);
      }).finally(() => { active--; pump(); });
    }
  }
  function request(key, load, signal) {
    if (closed || signal?.aborted) return Promise.reject(aborted());
    const cached = peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let job = jobs.get(key);
    if (!job) {
      if (now() < blockedUntil) return Promise.reject(rateError());
      if (jobs.size >= maxPending) return Promise.reject(Object.assign(new Error('本机字幕请求队列已满，请稍后重试。'), { status: 503, code: 'LOCAL_QUEUE_FULL' }));
      job = { key, load, controller: new AbortController(), waiters: new Set(), started: false, done: false };
      jobs.set(key, job); queue.push(job);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        settle(error, value) {
          if (!job.waiters.delete(waiter)) return;
          signal?.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve(value);
        },
      };
      const cancel = () => {
        waiter.settle(aborted());
        if (!job.waiters.size && !job.done) {
          job.controller.abort();
          if (jobs.get(key) === job) jobs.delete(key);
          const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
          pump();
        }
      };
      job.waiters.add(waiter); signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel(); else pump();
    });
  }
  return { request, peek, prime, close() {
    closed = true;
    for (const job of jobs.values()) { job.controller.abort(); finish(job, aborted()); }
    jobs.clear(); queue.length = 0; cache.clear();
  } };
}
