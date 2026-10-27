// Shares only unfinished work. Verified v3 bundles own all completed caption reuse.
const aborted = () => new DOMException('Aborted', 'AbortError');
export function createRequestPool({ now = Date.now, cooldownMs = 60000, maxPending = 16, maxFastPending = maxPending, maxTranslationPending = maxPending, fastConcurrency = 1, translationConcurrency = 1 } = {}) {
  const jobs = new Map();
  const queues = { fast: [], translation: [] }, active = { fast: 0, translation: 0 }, limits = { fast: fastConcurrency, translation: translationConcurrency }, capacities = { fast: maxFastPending, translation: maxTranslationPending };
  let blockedUntil = 0, closed = false;
  const rateError = () => Object.assign(new Error(`YouTube returned HTTP 429. New downloads are paused for ${Math.max(1, Math.ceil((blockedUntil - now()) / 1000))}s after this error. Retry later; YouTube may still be limiting requests.`), { status: 429, code: 'YOUTUBE_RATE_LIMITED', retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now()) / 1000)) });
  function finish(job, error, value) {
    if (job.done) return; job.done = true;
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    for (const waiter of [...job.waiters]) waiter.settle(error, value);
  }
  function pump(lane) {
    if (closed) return;
    while (active[lane] < limits[lane] && queues[lane].length) {
      const job = queues[lane].shift();
      if (job.done || job.controller.signal.aborted || !job.waiters.size) continue;
      if (now() < blockedUntil) { finish(job, rateError()); continue; }
      active[lane]++; job.started = true;
      void Promise.resolve().then(() => { job.controller.signal.throwIfAborted(); return job.load(job.controller.signal); }).then(value => finish(job, null, value), error => {
        if (!error || typeof error !== 'object') error = new Error('The subtitle request failed.');
        if (error.code === 'YOUTUBE_RATE_LIMITED' && error.status === 429) { blockedUntil = Math.max(blockedUntil, now() + cooldownMs); error = rateError(); }
        finish(job, error);
      }).finally(() => { active[lane]--; pump(lane); if (now() < blockedUntil) { pump('fast'); pump('translation'); } });
    }
  }
  function request(key, load, signal, { lane = 'fast' } = {}) {
    if (!['fast', 'translation'].includes(lane)) throw new Error('Invalid request lane.');
    if (closed || signal?.aborted) return Promise.reject(aborted());
    let job = jobs.get(key);
    if (!job) {
      if (now() < blockedUntil) return Promise.reject(rateError());
      const queued = queues[lane].filter(item => !item.done).length + active[lane];
      if (jobs.size >= maxPending || queued >= capacities[lane]) return Promise.reject(Object.assign(new Error('The local subtitle queue is full. Try again later.'), { status: 503, code: 'LOCAL_QUEUE_FULL' }));
      job = { key, load, lane, controller: new AbortController(), waiters: new Set(), started: false, done: false }; jobs.set(key, job); queues[lane].push(job);
    }
    return new Promise((resolve, reject) => {
      const waiter = { settle(error, value) { if (!job.waiters.delete(waiter)) return; signal?.removeEventListener('abort', cancel); if (error) reject(error); else resolve(value); } };
      const cancel = () => { waiter.settle(aborted()); if (!job.waiters.size && !job.done) { job.controller.abort(); if (jobs.get(key) === job) jobs.delete(key); const index = queues[job.lane].indexOf(job); if (index >= 0) queues[job.lane].splice(index, 1); pump(job.lane); } };
      job.waiters.add(waiter); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel(); else pump(job.lane);
    });
  }
  return { request, close() { closed = true; for (const job of jobs.values()) { job.controller.abort(); finish(job, aborted()); } jobs.clear(); queues.fast.length = queues.translation.length = 0; } };
}
