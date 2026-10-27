import { MAX_SUBTITLE_BYTES, normalizeCues } from './core.mjs';

const policy = 'same-source-v1';
const phases = new Set(['cache-reading', 'cache-hit', 'cache-revalidation-due', 'metadata-loading', 'source-loading', 'target-queued', 'target-preparing', 'target-downloading']);
const types = new Set(['phase', 'info', 'source-ready', 'target-ready', 'target-error', 'fatal-error', 'complete']);
const failure = message => Object.assign(new Error(message), { code: 'INVALID_CAPTION_SESSION' });
const validInfo = (info, videoId) => info && typeof info === 'object' && info.videoId === videoId && typeof info.title === 'string' && Array.isArray(info.languages) && typeof info.sourceLanguage === 'string';
const boundedCues = cues => {
  const normalized = normalizeCues(cues);
  if (!normalized.length || new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_SUBTITLE_BYTES) throw failure('The subtitle session exceeded its cue limit.');
  return normalized;
};
export class CaptionSession {
  constructor({ videoId, target, epoch, signal, fetchImpl = fetch, url, onEvent }) {
    this.videoId = videoId; this.target = target; this.epoch = epoch; this.signal = signal; this.fetchImpl = fetchImpl; this.url = url; this.onEvent = onEvent;
    this.sequence = 0; this.sourceFingerprint = null; this.info = null; this.sourceReady = false; this.targetReady = false; this.targetFailed = false; this.terminal = false;
  }
  accept(event) {
    if (!event || typeof event !== 'object' || !types.has(event.type) || event.videoId !== this.videoId || event.target !== this.target || event.captionPolicy !== policy || !Number.isSafeInteger(event.sequence) || event.sequence <= this.sequence || this.terminal) throw failure('The subtitle helper sent an invalid or out-of-order session event.');
    this.sequence = event.sequence;
    if (event.type === 'phase') { if (!phases.has(event.phase)) throw failure('The subtitle helper sent an unknown progress phase.'); return event; }
    if (event.type === 'info') {
      if (this.info || this.sourceReady || !validInfo(event.info, this.videoId) || !['fresh', 'revalidated', 'legacy-import', 'miss'].includes(event.cacheDisposition)) throw failure('The subtitle helper sent invalid video metadata.');
      this.info = event.info; return event;
    }
    if (event.type === 'source-ready') {
      if (!this.info || this.sourceReady || event.language !== this.info.sourceLanguage || !/^[a-f0-9]{64}$/.test(event.sourceFingerprint || '')) throw failure('The subtitle helper sent an invalid English source.');
      event.cues = boundedCues(event.cues); this.sourceFingerprint = event.sourceFingerprint; this.sourceReady = true; return event;
    }
    if (event.type === 'target-ready') {
      if (!this.sourceReady || this.targetReady || this.targetFailed || event.language !== this.target || event.sourceFingerprint !== this.sourceFingerprint || !['uploaded', 'auto-translated', 'source'].includes(event.targetType) || !/^[a-f0-9]{64}$/.test(event.pairId || '')) throw failure('The translated captions do not match the active English source.');
      event.cues = boundedCues(event.cues); this.targetReady = true; return event;
    }
    if (event.type === 'target-error') {
      if (!this.sourceReady || this.targetReady || this.targetFailed || typeof event.code !== 'string' || typeof event.message !== 'string' || event.message.length > 1000) throw failure('The subtitle helper sent an invalid target error.');
      this.targetFailed = true; return event;
    }
    if (event.type === 'fatal-error') {
      if (this.sourceReady || typeof event.code !== 'string' || typeof event.message !== 'string' || event.message.length > 1000) throw failure('The subtitle helper sent an invalid fatal error.');
      this.terminal = true; return event;
    }
    if (!['bilingual', 'source-only'].includes(event.outcome) || (event.outcome === 'bilingual' && (!this.sourceReady || !this.targetReady || this.targetFailed)) || (event.outcome === 'source-only' && (!this.sourceReady || !this.targetFailed || this.targetReady))) throw failure('The subtitle helper sent an incoherent completion event.');
    this.terminal = true; return event;
  }
  async start() {
    let response;
    try {
      response = await this.fetchImpl(this.url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: this.videoId, target: this.target }), signal: this.signal });
    } catch (cause) { if (this.signal?.aborted || cause?.name === 'AbortError') throw new DOMException('Aborted', 'AbortError'); throw Object.assign(new Error('The local subtitle helper is unavailable. Run start.command.'), { code: 'SERVICE_UNREACHABLE' }); }
    if (!response.ok) { let data; try { data = await response.json(); } catch {} throw Object.assign(new Error(data?.error || `The subtitle helper returned HTTP ${response.status}.`), { code: data?.code || 'HTTP_ERROR', status: response.status }); }
    if (!/^application\/x-ndjson(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw failure('The local subtitle helper did not start a caption session.');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '', bytes = 0, failed = false;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength; if (bytes > MAX_SUBTITLE_BYTES * 2 + 128 * 1024) throw failure('The subtitle session exceeded its response limit.');
        text += decoder.decode(next.value, { stream: true });
        const lines = text.split('\n'); text = lines.pop();
        for (const line of lines) { if (!line) continue; if (line.length > MAX_SUBTITLE_BYTES * 2) throw failure('The subtitle helper sent an oversized session event.'); this.onEvent(this.accept(JSON.parse(line)), this); }
      }
      text += decoder.decode(); if (text.trim()) this.onEvent(this.accept(JSON.parse(text)), this);
      if (!this.terminal) throw failure('The subtitle session ended without a terminal event.');
    } catch (error) {
      failed = true; await reader.cancel(error).catch(() => {}); throw error;
    } finally { if (failed) await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
export const phaseMessage = phase => ({ 'cache-reading': 'Reading saved subtitles…', 'cache-hit': 'Saved subtitles ready.', 'cache-revalidation-due': 'Checking saved subtitles…', 'metadata-loading': 'Loading video caption details…', 'source-loading': 'Loading English captions…', 'target-queued': 'Translation is queued…', 'target-preparing': 'Preparing YouTube translation…', 'target-downloading': 'Downloading translated captions…' })[phase] || '';
