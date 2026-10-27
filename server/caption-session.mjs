import { captionCueFingerprint, makeCaptionBundle } from './caption-bundle-cache.mjs';
import { isCaptionTrackKey } from './caption-key.mjs';

const policy = 'same-source-v1';
const messageFor = error => error?.message || 'The subtitle request failed.';
const targetMessageFor = error => `${messageFor(error)} Translated captions are unavailable; verified English captions remain available.`;
const errorCode = error => ['YOUTUBE_RATE_LIMITED', 'YOUTUBE_DOWNLOAD_FAILED', 'YOUTUBE_METADATA_FAILED', 'SOURCE_TRACK_UNAVAILABLE', 'LOCAL_QUEUE_FULL'].includes(error?.code) ? error.code : 'SUBTITLE_REQUEST_FAILED';
const targetType = (info, target) => target === info.sourceLanguage ? 'source' : info.languages.find(item => item.code === target)?.autoTranslated ? 'auto-translated' : 'uploaded';
const selectionFor = (info, language) => language === info.sourceLanguage ? info.sourceSelection : info.languages.find(item => item.code === language)?.selection;
const playerTrack = info => JSON.stringify(info.sourceTrack);
class AsyncEvents {
  constructor() { this.items = []; this.waiters = []; this.done = false; }
  push(value) { const waiter = this.waiters.shift(); if (waiter) waiter({ value, done: false }); else this.items.push(value); }
  end() { this.done = true; while (this.waiters.length) this.waiters.shift()({ done: true }); }
  async next() { if (this.items.length) return { value: this.items.shift(), done: false }; if (this.done) return { done: true }; return new Promise(resolve => this.waiters.push(resolve)); }
  [Symbol.asyncIterator]() { return this; }
}
export function createCaptionSession({ videoId, target, signal, cache, requests, getInfo, loadTracks, importLegacy, now = Date.now }) {
  if (!/^[\w-]{11}$/.test(videoId || '') || !isCaptionTrackKey(target)) throw Object.assign(new Error('Invalid caption session request.'), { status: 400 });
  const events = new AsyncEvents(); let sequence = 0, sourceReady = false, targetAbort;
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const emit = (type, value = {}) => events.push({ sequence: ++sequence, videoId, target, captionPolicy: policy, type, ...value });
  const readTrack = (info, language, lane, lifecycle, subscriberSignal = signal, fresh = false) => {
    const selected = selectionFor(info, language), type = targetType(info, language);
    const key = ['track', videoId, language, type, playerTrack(info), JSON.stringify(selected), policy].join(':');
    return requests.request(key, async sharedSignal => {
      const result = await loadTracks(videoId, [language], sharedSignal, { waitSeconds: lane === 'translation' ? 60 : 0, lifecycle, sourceLanguage: info.sourceLanguage, expectedSourceTrack: info.sourceTrack, selections: { [language]: selected } });
      const cues = result?.tracks?.[language];
      if (!Array.isArray(cues) || !cues.length) throw result?.error || new Error('YouTube did not provide the requested caption track.');
      return { cues, selection: result.identities?.[language] || selected };
    }, subscriberSignal, { lane, fresh });
  };
  void (async () => {
    try {
      emit('phase', { phase: 'cache-reading' });
      const saved = await cache?.read(videoId, target, signal);
      signal?.throwIfAborted();
      if (saved?.freshness === 'fresh') {
        const bundle = saved.bundle;
        emit('phase', { phase: 'cache-hit' });
        emit('info', { info: bundle.sanitizedInfo, cacheDisposition: 'fresh' });
        emit('source-ready', { language: bundle.source.trackKey, sourceFingerprint: bundle.source.cueSha256, cues: bundle.source.cues });
        emit('target-ready', { language: target, targetType: bundle.targetTrack.type, sourceFingerprint: bundle.source.cueSha256, pairId: bundle.pairId, cues: bundle.targetTrack.cues });
        emit('complete', { outcome: 'bilingual' }); return;
      }
      if (saved) emit('phase', { phase: 'cache-revalidation-due' });
      emit('phase', { phase: 'metadata-loading' });
      const info = await getInfo(videoId, signal, { fresh: !!saved });
      if (!info?.sourceLanguage) throw new Error('This video has no available English captions.');
      if (target !== info.sourceLanguage && !info.languages?.some(item => item.code === target)) throw Object.assign(new Error('This video does not provide the requested caption language.'), { status: 400 });
      const type = targetType(info, target), sourceSelection = selectionFor(info, info.sourceLanguage), targetSelection = selectionFor(info, target);
      if (!sourceSelection || !targetSelection) throw new Error('The selected subtitle source is unavailable.');
      const legacy = !saved ? await importLegacy?.(info, target, signal) : undefined;
      if (legacy) {
        await cache?.write(legacy, signal);
        emit('info', { info, cacheDisposition: 'legacy-import' });
        emit('source-ready', { language: legacy.source.trackKey, sourceFingerprint: legacy.source.cueSha256, cues: legacy.source.cues });
        sourceReady = true;
        emit('target-ready', { language: target, targetType: legacy.targetTrack.type, sourceFingerprint: legacy.source.cueSha256, pairId: legacy.pairId, cues: legacy.targetTrack.cues });
        emit('complete', { outcome: 'bilingual' }); return;
      }
      emit('info', { info, cacheDisposition: saved ? 'revalidated' : 'miss' });
      let initialTarget;
      if (!saved && target !== info.sourceLanguage) {
        emit('phase', { phase: 'target-queued' }); targetAbort = new AbortController();
        const targetSignal = AbortSignal.any([signal, targetAbort.signal]);
        initialTarget = readTrack(info, target, type === 'auto-translated' ? 'translation' : 'fast', phase => { if (phase === 'target-preparing' || phase === 'target-downloading') emit('phase', { phase }); }, targetSignal, false).then(value => ({ value }), error => ({ error }));
      }
      emit('phase', { phase: 'source-loading' });
      const source = await readTrack(info, info.sourceLanguage, 'fast', undefined, signal, !!saved);
      const sourceFingerprint = captionCueFingerprint(source.cues);
      sourceReady = true; emit('source-ready', { language: info.sourceLanguage, sourceFingerprint, cues: source.cues });
      if (saved && type === 'auto-translated' && saved.bundle.schema === 3 && saved.bundle.cachePolicy === 'verified-bundle-v1' && saved.bundle.captionPolicy === policy && saved.bundle.source.trackKey === info.sourceLanguage && saved.bundle.source.playerTrack === playerTrack(info) && saved.bundle.source.cueSha256 === sourceFingerprint && same(saved.bundle.source.selection, source.selection) && saved.bundle.targetTrack.type === type && same(saved.bundle.targetTrack.selection, targetSelection)) {
        const refreshed = makeCaptionBundle({ videoId, target, info, source: { trackKey: info.sourceLanguage, playerTrack: playerTrack(info), selection: source.selection, cues: source.cues }, targetTrack: { type, selection: saved.bundle.targetTrack.selection, cues: saved.bundle.targetTrack.cues }, now });
        await cache?.write(refreshed, signal);
        emit('target-ready', { language: target, targetType: type, sourceFingerprint, pairId: refreshed.pairId, cues: refreshed.targetTrack.cues });
        emit('complete', { outcome: 'bilingual' }); return;
      }
      let targetResult;
      if (target === info.sourceLanguage) targetResult = source;
      else if (initialTarget) {
        const result = await initialTarget; if (result.error) throw result.error; targetResult = result.value;
      } else {
        emit('phase', { phase: 'target-queued' });
        const lane = type === 'auto-translated' ? 'translation' : 'fast';
        targetResult = await readTrack(info, target, lane, phase => { if (phase === 'target-preparing') emit('phase', { phase }); if (phase === 'target-downloading') emit('phase', { phase }); }, signal, !!saved);
      }
      const bundle = makeCaptionBundle({ videoId, target, info, source: { trackKey: info.sourceLanguage, playerTrack: playerTrack(info), selection: source.selection, cues: source.cues }, targetTrack: { type, selection: targetResult.selection, cues: targetResult.cues }, now });
      await cache?.write(bundle, signal);
      emit('target-ready', { language: target, targetType: type, sourceFingerprint, pairId: bundle.pairId, cues: targetResult.cues });
      emit('complete', { outcome: 'bilingual' });
    } catch (error) {
      targetAbort?.abort();
      if (error?.name === 'AbortError' || signal?.aborted) return;
      if (sourceReady) {
        const code = errorCode(error); emit('target-error', { code, message: targetMessageFor(error), ...(Number.isFinite(error?.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }); emit('complete', { outcome: 'source-only' });
      } else emit('fatal-error', { code: errorCode(error), message: messageFor(error), ...(Number.isFinite(error?.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
    } finally { events.end(); }
  })();
  return events;
}
