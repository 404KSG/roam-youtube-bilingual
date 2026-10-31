import { videoIdFromUrl, activeCueIndex } from './core.mjs';
import { YouTubeClock } from './clock.mjs';
import { VideoSurface, subtitleMetrics } from './surface.mjs';
import { claimRenderer, releaseRenderer } from './lifecycle.mjs';
import { resolveNativeCc } from './native-cc.mjs';
import { createSubtitlePreferences, GLOBAL_PREFERENCES_KEY } from './preferences.mjs';
import { alignCaptionTracks } from './alignment.mjs';
import { readingSegments, visibleSegment } from './reading.mjs';
import { createSettingsPopover } from './settings.mjs';
import { VERSION, SERVICE_URL, DEFAULT_CONFIG, validateConfig, verifyHealth } from './protocol.mjs';
import { CaptionSession, phaseMessage } from './caption-session.mjs';

const STORAGE_KEY = 'roam-youtube-bilingual/session/v1';
const commandLabel = 'YouTube subtitles: Settings';
const fullscreenCommand = 'YouTube subtitles: Fullscreen';
const videos = new Map();
let preferences, preferenceStorage;
let active = false, observer, scanTimer, surfaceTimer, settings, globalStyle;
let commandRegistered = false;
const lifecycle = { active: false, unload: () => onunload() };
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const button = (text, callback, cls = '') => { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', callback); return node; };
async function applyGlobalPreferences(next, { activate, saved = true } = {}) {
  let restart;
  for (const video of videos.values()) {
    const targetChanged = video.config.target !== next.target, switchedOn = !video.wantsEnabled && next.enabled;
    if (targetChanged && video.enabled) { video.turnOff(); restart = video; }
    video.config = validateConfig(next); video.wantsEnabled = next.enabled;
    video.preferenceError = saved ? '' : 'Global settings could not be saved on this device.';
    video.preferenceNotice = preferences.notice;
    if (!video.wantsEnabled) video.turnOff();
    else if (targetChanged || switchedOn) { video.restoreAttempted = false; video.lastError = ''; }
    video.updateIcon(); video.updatePair();
  }
  settings?.refresh?.();
  const candidate = activate || restart;
  if (candidate?.wantsEnabled && !candidate.disposed) await candidate.turnOn();
}
async function saveConfig(owner, patch) {
  const result = preferences.set(patch);
  await applyGlobalPreferences(result.preferences, { activate: patch.enabled === true ? owner : undefined, saved: result.saved });
  if (owner.preferenceError) owner.notice(owner.preferenceError);
}
function syncStoredPreferences(event) {
  if (!active || (event.key !== GLOBAL_PREFERENCES_KEY && event.key !== null) || (event.storageArea && event.storageArea !== preferenceStorage)) return;
  void applyGlobalPreferences(preferences.refresh());
}
async function request(path, body, signal, observation) {
  let response;
  const url = new URL(path, SERVICE_URL);
  url.searchParams.set('client_version', VERSION);
  if (observation) url.searchParams.set('previous_cc', observation);
  try {
    response = await fetch(url.href, {
      method: body ? 'POST' : 'GET', credentials: 'omit',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(path.endsWith('native-cc-state') ? 3500 : path.endsWith('/captions') ? 240000 : 90000)]),
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
    if (error.name === 'TimeoutError') throw Object.assign(new Error('The subtitle request timed out. Try again later.'), { code: 'REQUEST_TIMEOUT' });
    throw Object.assign(new Error('The local subtitle helper is unavailable. Run start.command.'), { code: 'SERVICE_UNREACHABLE' });
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('The local subtitle helper returned an invalid response.'); }
  if (!response.ok) throw Object.assign(new Error(data?.error || `The subtitle helper returned HTTP ${response.status}.`), {
    status: response.status, code: typeof data?.code === 'string' ? data.code : 'HTTP_ERROR',
    ...(Number.isFinite(data?.retryAfterSeconds) ? { retryAfterSeconds: Math.max(1, Math.min(3600, data.retryAfterSeconds)) } : {}),
  });
  return data;
}
function closeSettings(ref = settings) { ref?.close(); }
function openSettings(owner) {
  if (!owner || owner.disposed) return;
  if (settings?.owner === owner) { closeSettings(); return; }
  closeSettings();
  settings = createSettingsPopover(owner, { css: STYLE, version: VERSION, save: patch => saveConfig(owner, patch), onClose: ref => {
    if (settings === ref) settings = null;
    if (active && !owner.disposed) owner.sync();
  } });
  owner.sync();
}
function toolbarIcon() {
  const icon = el('span', 'bp3-icon bp3-icon-translate');
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

class VideoCaptions {
  constructor(iframe) {
    this.iframe = iframe; this.videoId = videoIdFromUrl(iframe.src); this.embedId = this.videoId;
    const saved = preferences.get(this.videoId); this.config = validateConfig(saved); this.wantsEnabled = saved.enabled; this.restoreAttempted = false;
    this.preferenceError = preferences.saveWarning; this.preferenceNotice = preferences.notice;
    this.captionData = null; this.time = 0; this.epoch = 0; this.enabled = false; this.loading = false; this.ccState = 'unknown'; this.ccVerifiedAt = 0; this.nativeWasOn = null; this.nativeChanged = false; this.nativeCcOnNoticeEpoch = null; this.nativeCcConflictSince = null;
    this.nativeControlsHidden = false; this.nativeControlsVisible = false;
    this.surface = new VideoSurface(iframe, STYLE, { onLayoutChange: () => this.drawPair() }); this.surface.host.dataset.version = VERSION;
    this.box = el('div', 'ryb-caption-box'); this.box.hidden = true; this.box.setAttribute('aria-label', 'Bilingual subtitles');
    this.source = el('div', 'ryb-line ryb-source'); this.source.dir = 'ltr';
    this.target = el('div', 'ryb-line ryb-target'); this.target.dir = 'auto';
    this.box.append(this.source, this.target); this.surface.scene.append(this.box);
    this.noticeBox = el('div', 'ryb-notice'); this.noticeBox.hidden = true; this.noticeBox.setAttribute('role', 'status'); this.surface.scene.append(this.noticeBox);
    this.toolbarButton = button('', () => openSettings(this), 'bp3-button bp3-minimal ryb-toolbar-button');
    this.toolbarButton.append(toolbarIcon()); this.toolbarButton.setAttribute('aria-label', 'Bilingual subtitle settings'); this.toolbarButton.setAttribute('aria-haspopup', 'dialog'); this.toolbarButton.title = 'Bilingual subtitle settings';
    for (const type of ['click', 'pointerdown', 'mousedown', 'keydown']) this.toolbarButton.addEventListener(type, (event) => event.stopPropagation());
    this.canvas = document.createElement('canvas'); this.measure = this.canvas.getContext('2d');
    this.mountToolbar(); this.updateIcon();
  }
  mountToolbar() {
    const wrapper = this.iframe.parentElement?.closest('.rm-video-player__spacing-wrapper, .rm-iframe__spacing-wrapper');
    const row = wrapper?.querySelector('.rm-video-player__theater-toolbar');
    const gutter = wrapper?.querySelector('.rm-video-player__gutter');
    const theater = wrapper?.classList.contains('rm-video-player__spacing-wrapper--theater') || (!!row && !gutter);
    let target = theater ? row : gutter;
    this.toolbarButton.dataset.layout = target === gutter && gutter ? 'inline' : 'theater';
    if (!target && wrapper?.classList.contains('rm-video-player__spacing-wrapper')) {
      // Roam may rebuild its hover controls. Do not create an always-visible
      // bottom bar while the native gutter/toolbar is temporarily absent.
      this.toolbarButton.remove(); this.fallback?.remove(); this.fallback = null; return;
    }
    if (!target) {
      const anchor = wrapper || this.surface.findContainer() || this.iframe;
      if (!this.fallback) this.fallback = el('div', 'ryb-toolbar-fallback');
      if (this.fallback.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', this.fallback);
      target = this.fallback; this.toolbarButton.dataset.layout = 'fallback';
    }
    if (this.toolbarButton.parentElement !== target) target.append(this.toolbarButton);
    if (target !== this.fallback && this.fallback) { this.fallback.remove(); this.fallback = null; }
  }
  updateIcon() { this.toolbarButton.dataset.active = String(this.wantsEnabled); this.toolbarButton.dataset.loading = String(this.loading); this.toolbarButton.setAttribute('aria-busy', String(this.loading)); this.toolbarButton.title = this.loading ? 'Preparing subtitles. Open settings to cancel.' : 'Bilingual subtitle settings'; }
  loadingMessage() {
    if (!this.enabled || !this.loading || this.captionData?.target) return '';
    if (this.captionData?.source) {
      if (this.targetPhase === 'target-queued') return 'Translation queued…';
      if (this.targetPhase === 'target-downloading') return 'Downloading translation…';
      return 'Loading translation…';
    }
    return phaseMessage(this.loadingPhase) || 'Loading subtitles…';
  }
  statusMessage() {
    const pending = this.loadingMessage();
    const native = this.enabled && this.captionData?.source ? this.nativeError || (this.ccState === 'on' ? 'Native captions are still on. Bilingual subtitles remain hidden.' : !pending && this.ccState !== 'off' ? 'Checking that native captions are off…' : '') : '';
    return this.targetError || this.lastError || [pending, native, this.preferenceError].filter(Boolean).join(' ') || this.preferenceNotice || '';
  }
  refreshStatusNotice() {
    const pending = this.loadingMessage();
    if (pending) this.notice(pending, 0, 'loading');
    else if (this.enabled && this.targetError) this.notice('Translation unavailable. Open settings for details.', 0, 'error');
    else { clearTimeout(this.noticeTimer); this.noticeBox.hidden = true; this.lastNoticeKey = null; }
    if (settings?.owner === this) settings.refresh?.();
  }
  notice(message, duration = 6000, kind = 'info') {
    if (this.disposed) return;
    if (settings?.owner === this && settings.status) {
      const status = kind === 'info' ? message : this.statusMessage() || message;
      if (settings.status.textContent !== status) settings.status.textContent = status;
    }
    const key = `${this.epoch}:${kind}:${duration}:${message}`;
    if (this.lastNoticeKey === key) return;
    this.lastNoticeKey = key;
    clearTimeout(this.noticeTimer); this.noticeBox.textContent = message; this.noticeBox.hidden = !message;
    if (this.noticeBox.dataset) this.noticeBox.dataset.kind = kind;
    if (duration) this.noticeTimer = setTimeout(() => {
      if (this.lastNoticeKey !== key) return;
      if (this.loadingMessage() || this.enabled && this.targetError) this.refreshStatusNotice();
      else this.noticeBox.hidden = true;
    }, duration);
  }
  cancelInfo() {
    const task = this.infoTask; this.infoTask = null; task?.abort.abort();
  }
  async loadInfo(signal) {
    signal?.throwIfAborted();
    if (this.info) return this.info;
    const videoId = this.videoId;
    if (this.infoTask && (this.infoTask.videoId !== videoId || this.infoTask.abort.signal.aborted)) this.cancelInfo();
    if (!this.infoTask) {
      const task = this.infoTask = { videoId, abort: new AbortController(), waiters: new Set(), settled: false };
      let response;
      try { response = request('/v1/youtube/video-info', { videoId }, task.abort.signal); }
      catch (error) { response = Promise.reject(error); }
      task.promise = Promise.resolve(response).then(info => {
        if (this.disposed || this.infoTask !== task || task.abort.signal.aborted || this.videoId !== videoId) throw new DOMException('Aborted', 'AbortError');
        if (info.videoId !== videoId || !Array.isArray(info.languages)) throw new Error('The video metadata no longer matches the current video.');
        this.info = info; return info;
      }).finally(() => { task.settled = true; if (this.infoTask === task) this.infoTask = null; });
    }
    const task = this.infoTask;
    return new Promise((resolve, reject) => {
      const waiter = {};
      const finish = (error, value) => {
        if (!task.waiters.delete(waiter)) return;
        signal?.removeEventListener('abort', cancel); task.abort.signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => {
        finish(new DOMException('Aborted', 'AbortError'));
        if (!task.waiters.size && !task.settled) {
          if (this.infoTask === task) this.infoTask = null;
          task.abort.abort();
        }
      };
      task.waiters.add(waiter);
      signal?.addEventListener('abort', cancel, { once: true }); task.abort.signal.addEventListener('abort', cancel, { once: true });
      task.promise.then(value => finish(null, value), error => finish(error));
      if (signal?.aborted || task.abort.signal.aborted) cancel();
    });
  }
  connect() {
    if (this.clock) return;
    this.clock = new YouTubeClock(this.iframe, (time) => {
      if (this.disposed) return;
      const state = this.clock?.state, playbackStarted = state === 1 && this.lastPlayerState !== 1;
      this.lastPlayerState = state; this.time = time;
      if (playbackStarted) this.restoreIfNeeded(true);
      this.updatePair();
    }, (state) => {
      if (this.enabled && state === 'Playback time unavailable. Subtitles are paused.') { this.clearPair(); this.notice(state); }
    }, (id) => this.videoChanged(id), { onApiChange: () => this.closeNativeGate(), onIframeLoad: () => this.closeNativeGate() });
  }
  videoChanged(id) {
    this.cancelInfo(); this.closeNativeGate(); this.turnOff(); this.videoId = id; this.info = null; this.captionData = null; this.alignment = null;
    const saved = preferences.get(id); this.config = validateConfig(saved); this.wantsEnabled = saved.enabled;
    this.preferenceError = preferences.saveWarning; this.preferenceNotice = preferences.notice;
    this.restoreAttempted = false; this.lastPlayerState = -1; this.lastError = ''; this.targetError = ''; this.nativeError = ''; this.updateIcon();
  }
  restoreIfNeeded(playbackStarted = false) {
    if (!this.wantsEnabled || this.enabled || this.restoreAttempted || this.disposed || document.hidden || this.surface.host.style.display === 'none') return;
    if (!playbackStarted && [...videos.values()].some(video => video !== this && video.enabled)) return;
    this.restoreAttempted = true; void this.turnOn();
  }
  handleSessionEvent(event, session) {
    if (this.disposed || this.session !== session || session.epoch !== this.epoch) return;
    if (event.type === 'phase') {
      this.loadingPhase = event.phase;
      if (event.phase.startsWith('target-')) this.targetPhase = event.phase;
      this.refreshStatusNotice(); return;
    }
    const data = this.captionData;
    if (event.type === 'info') { this.info = event.info; session.info = event.info; if (data?.owner === session) data.info = event.info; settings?.refresh?.(); return; }
    if (event.type === 'source-ready') {
      if (!data || data.owner !== session || data.epoch !== this.epoch || data.videoId !== this.videoId || !this.info || event.language !== this.info.sourceLanguage) throw new Error('The English captions do not match the active video.');
      data.source = { language: event.language, fingerprint: event.sourceFingerprint, cues: event.cues }; data.target = null; this.alignment = null; session.sourceFingerprint = event.sourceFingerprint;
      this.connect(); this.closeNativeGate(); this.refreshStatusNotice(); void this.checkNativeCc(); return;
    }
    if (event.type === 'target-ready') {
      if (!data || data.owner !== session || data.epoch !== this.epoch || data.videoId !== this.videoId || event.language !== data.targetLanguage || event.sourceFingerprint !== data.source?.fingerprint) throw new Error('The translated captions do not match the active English source.');
      this.targetError = ''; data.target = { language: event.language, sourceFingerprint: event.sourceFingerprint, pairId: event.pairId, cues: event.cues }; this.alignment = null; this.loading = false; this.updateIcon(); this.updatePair(); this.refreshStatusNotice(); return;
    }
    if (event.type === 'target-error') { if (data?.owner === session) { data.target = null; this.alignment = null; } this.loading = false; this.targetError = event.message; this.updateIcon(); this.updatePair(); this.refreshStatusNotice(); return; }
    if (event.type === 'fatal-error') throw Object.assign(new Error(event.message), { code: event.code });
    if (event.type === 'complete') { this.loading = false; this.updateIcon(); if (event.outcome === 'bilingual') this.lastError = ''; this.refreshStatusNotice(); }
  }
  async turnOn() {
    if (this.enabled || this.disposed) return;
    this.restoreAttempted = true;
    for (const video of videos.values()) if (video !== this && video.enabled) { video.turnOff(); video.restoreAttempted = false; }
    this.turnOff(); this.enabled = true; this.loading = true; this.loadingPhase = 'cache-reading'; this.targetPhase = ''; this.lastError = ''; this.targetError = ''; this.nativeError = '';
    const target = this.config.target, epoch = this.epoch, abort = this.startRequest = new AbortController();
    this.updateIcon(); this.refreshStatusNotice();
    try {
      verifyHealth(await request('/v1/youtube/health', undefined, abort.signal));
      const url = `${SERVICE_URL}/v1/youtube/caption-session?client_version=${encodeURIComponent(VERSION)}`;
      const session = this.session = new CaptionSession({ videoId: this.videoId, target, epoch, signal: abort.signal, url, onEvent: (event, ref) => this.handleSessionEvent(event, ref) });
      this.captionData = { owner: session, epoch, videoId: this.videoId, targetLanguage: target, info: null, source: null, target: null };
      await session.start();
      if (this.session === session) this.session = null;
    } catch (error) {
      if (error.name !== 'AbortError' && epoch === this.epoch) { this.turnOff(); this.lastError = error.message; this.notice(error.message); this.updateIcon(); }
    } finally { if (this.startRequest === abort) { this.startRequest = null; this.loading = false; this.updateIcon(); } }
  }
  clearPair() { this.pair = null; this.renderCache = null; this.box.hidden = true; this.source.textContent = ''; this.target.textContent = ''; }
  closeNativeGate() {
    this.ccState = 'unknown'; this.ccVerifiedAt = 0; this.nativeControlsHidden = false; this.nativeControlsVisible = false; this.ccRequest?.abort(); this.ccRequest = null; this.clearPair();
    this.nextCcCheck = 0;
  }
  turnOff() {
    this.epoch++; this.enabled = false; this.loading = false;
    this.startRequest?.abort(); this.startRequest = null; this.session = null; this.captionData = null; this.alignment = null; this.ccRequest?.abort(); this.ccRequest = null;
    this.ccState = 'unknown'; this.ccVerifiedAt = 0; this.nativeControlsHidden = false; this.nativeControlsVisible = false; this.clearPair();
    // Never switch native CC merely because a download failed or a dialog closed.
    // Restore only a state this instance positively observed and then changed.
    if (this.nativeChanged && this.nativeWasOn === true) this.clock?.restoreCaptions();
    this.nativeChanged = false; this.nativeWasOn = null; this.nativeCcOnNoticeEpoch = null; this.nativeCcConflictSince = null;
    clearTimeout(this.noticeTimer); this.noticeBox.hidden = true; this.loadingPhase = ''; this.targetPhase = ''; this.lastNoticeKey = null; this.updateIcon();
  }
  async changeTarget() {
    const restart = this.wantsEnabled;
    this.turnOff();
    if (restart) await this.turnOn();
  }
  screenFrame() {
    const rect = this.iframe.getBoundingClientRect();
    const scale = outerWidth > 0 && innerWidth > 0 ? outerWidth / innerWidth : 1;
    return { x: screenX + rect.x * scale, y: screenY + outerHeight - innerHeight * scale + rect.y * scale, width: rect.width * scale, height: rect.height * scale };
  }
  async checkNativeCc() {
    if (!this.enabled || !this.captionData?.source || this.captionData.videoId !== this.videoId || this.disposed || this.ccRequest || document.hidden || this.surface.host.style.display === 'none' || Date.now() < (this.nextCcCheck || 0)) return;
    const epoch = this.epoch, videoId = this.videoId, abort = this.ccRequest = new AbortController();
    const before = Date.now(), frame = this.screenFrame();
    try {
      const data = await request('/v1/youtube/native-cc-state', { videoId, frame }, abort.signal, this.ccState);
      if (this.disposed || epoch !== this.epoch || abort.signal.aborted || data.videoId !== videoId) return;
      const currentFrame = this.screenFrame();
      if (['x', 'y', 'width', 'height'].some(key => Math.abs(frame[key] - currentFrame[key]) > 4)) { this.nextCcCheck = 0; return; }
      if (!Number.isFinite(data.checkedAt) || data.checkedAt < before - 100 || data.checkedAt > Date.now() + 100 || Date.now() - data.checkedAt > 1500) { this.closeNativeGate(); return; }
      this.ccState = resolveNativeCc(this.ccState, data);
      // Missing CC controls alone do not prove the transport is hidden.
      // Older helpers omit this flag and keep the conservative high position.
      this.nativeControlsHidden = this.ccState === 'off' && data.reason === 'controls-hidden' && data.controlsVisible === false;
      this.nativeControlsVisible = this.ccState === 'off' && data.reason === 'controls-visible';
      this.nextCcCheck = Date.now() + 700;
      if (this.ccState !== 'off') {
        this.clearPair();
        if (this.ccState === 'on') {
          // Static caption evidence still closes the gate, but only an explicit
          // control may establish ownership for later restoration.
          if (data.reason === 'control') { this.nativeWasOn ??= true; this.nativeChanged = true; }
          this.clock?.unloadCaptions();
          // Hide/recover immediately, but do not toast a brief self-healing
          // CC reactivation on pause. Settings keep the live diagnostic.
          this.nativeCcConflictSince ??= Date.now();
          if (this.loading || this.targetError) this.refreshStatusNotice();
          else if (this.nativeCcOnNoticeEpoch !== this.epoch && Date.now() - this.nativeCcConflictSince >= 2000) {
            this.nativeCcOnNoticeEpoch = this.epoch;
            this.notice('Native captions are still on. Bilingual subtitles remain hidden.');
          }
        } else if (data.reason === 'controls-hidden') this.clock?.wakeCaptionControls();
        if (settings?.owner === this) settings.refresh?.();
        return;
      }
      if (data.reason === 'control') { this.nativeCcOnNoticeEpoch = null; this.nativeCcConflictSince = null; }
      this.nativeWasOn ??= false; this.ccVerifiedAt = data.checkedAt;
      this.nativeError = ''; this.refreshStatusNotice(); this.updatePair();
    } catch (error) {
      if (error.name !== 'AbortError' && epoch === this.epoch) { this.ccState = 'unknown'; this.clearPair(); this.nativeError = error.message; if (this.loading || this.targetError) this.refreshStatusNotice(); else this.notice(error.message); if (settings?.owner === this) settings.refresh?.(); this.nextCcCheck = Date.now() + 2000; }
    } finally { if (this.ccRequest === abort) this.ccRequest = null; }
  }
  updatePair() {
    if (!this.enabled || this.ccState !== 'off' || this.nativeControlsVisible || Date.now() - this.ccVerifiedAt > 1500 || this.disposed || !this.clock?.isSynchronized()) { this.clearPair(); return; }
    const data = this.captionData;
    if (!data?.source || data.epoch !== this.epoch || data.videoId !== this.videoId || data.targetLanguage !== this.config.target) { this.clearPair(); return; }
    const sourceCues = data.source.cues, targetCues = data.target?.sourceFingerprint === data.source.fingerprint && data.target.language === data.targetLanguage ? data.target.cues : null;
    if (!targetCues) {
      const index = activeCueIndex(sourceCues, this.time); const source = index >= 0 ? sourceCues[index].text : '';
      if (!source) { this.clearPair(); return; }
      this.pair = { source, target: '' }; this.drawPair(); return;
    }
    if (this.alignment?.sourceCues !== sourceCues || this.alignment?.targetCues !== targetCues || this.alignment?.language !== data.targetLanguage) {
      const pairs = alignCaptionTracks(sourceCues, targetCues, data.targetLanguage);
      this.alignment = { sourceCues, targetCues, language: data.targetLanguage, pairs, segments: readingSegments(pairs, data.targetLanguage) };
    }
    const pair = visibleSegment(this.alignment.segments, this.time, segment => this.fitsReadingSegment(segment));
    if (!pair?.source) { this.clearPair(); return; }
    this.pair = pair; this.drawPair();
  }
  textWidth(text, size) {
    this.measure.font = `400 ${size}px Arial, "PingFang SC", sans-serif`;
    return this.measure.measureText(text).width;
  }
  fitsReadingSegment(segment) {
    const width = Math.min((this.surface?.viewport?.width || this.iframe.getBoundingClientRect().width) - 40, 1060), config = this.config;
    const cache = this.fitCache;
    if (cache?.segment === segment && cache.width === width && cache.config === config) return cache.fits;
    const fits = this.textWidth(segment.source, config.sourceFontSize) <= width * 1.6 && this.textWidth(segment.target, config.targetFontSize) <= width * 1.6;
    this.fitCache = { segment, width, config, fits }; return fits;
  }
  fitRow(row, requested, scaleY = 1) {
    if (row.hidden) return;
    row.style.fontSize = `${requested}px`;
    const fits = size => row.getBoundingClientRect().height / scaleY <= size * 2.6 + .5 && row.scrollWidth <= row.clientWidth + 1;
    if (!fits(requested)) {
      let low = .5, high = requested;
      for (let i = 0; i < 10; i++) { const middle = (low + high) / 2; row.style.fontSize = `${middle}px`; if (fits(middle)) low = middle; else high = middle; }
      row.style.fontSize = `${Math.floor(low * 10) / 10}px`;
    }
    row.dataset.fontSize = String(parseFloat(row.style.fontSize));
  }
  drawPair() {
    if (!this.enabled || this.ccState !== 'off' || this.nativeControlsVisible || Date.now() - this.ccVerifiedAt > 1500 || !this.pair || this.disposed) { this.box.hidden = true; return; }
    const rect = this.iframe.getBoundingClientRect(), pair = this.pair, config = this.config;
    if (rect.width < 160 || rect.height < 90 || !pair.source || this.surface.host.style.display === 'none') { this.box.hidden = true; this.renderCache = null; return; }
    const viewport = this.surface.viewport || { width: rect.width, height: rect.height, scaleY: 1 };
    const controlsHidden = this.nativeControlsHidden && [1, 2].includes(this.clock?.state) && !this.surface.isInteracting({ controlsHidden: true });
    const metrics = subtitleMetrics(viewport.width, viewport.height, 1, .08, { controlsHidden });
    if (metrics.maxCaptionHeight < 24) { this.box.hidden = true; this.renderCache = null; return; }
    const previous = this.renderCache;
    if (previous?.pair === pair && previous.config === config && previous.width === viewport.width && previous.height === viewport.height && previous.bottom === metrics.bottom) { this.box.hidden = false; return; }
    if (this.source.textContent !== pair.source) this.source.textContent = pair.source;
    if (this.target.textContent !== pair.target) this.target.textContent = pair.target;
    this.target.hidden = !pair.target;
    this.source.style.color = config.sourceColor; this.target.style.color = config.targetColor;
    const textWidth = Math.max(this.textWidth(pair.source, config.sourceFontSize), this.textWidth(pair.target, config.targetFontSize));
    const width = Math.min(viewport.width - 20, 1080, Math.max(100, textWidth + 20));
    Object.assign(this.box.style, { visibility: 'hidden', width: `${width}px`, height: 'auto', left: `${(viewport.width - width) / 2}px`, top: '0px' });
    this.box.hidden = false;
    this.fitRow(this.source, config.sourceFontSize, viewport.scaleY); this.fitRow(this.target, config.targetFontSize, viewport.scaleY);
    // Preserve the existing font-fitting budget. If native controls leave too
    // little room, wait rather than shrinking the user's styles further.
    const budget = Math.max(24, viewport.height * .45), firstHeight = this.box.getBoundingClientRect().height / viewport.scaleY;
    if (firstHeight > budget) {
      const scale = Math.max(.1, (budget - 16) / Math.max(1, firstHeight - 16));
      this.fitRow(this.source, parseFloat(this.source.style.fontSize) * scale, viewport.scaleY);
      this.fitRow(this.target, parseFloat(this.target.style.fontSize) * scale, viewport.scaleY);
    }
    const height = this.box.getBoundingClientRect().height / viewport.scaleY;
    if (height > metrics.maxCaptionHeight + .5) { this.box.hidden = true; this.renderCache = null; return; }
    this.box.style.top = `${Math.max(0, viewport.height - metrics.bottom - height)}px`; this.box.style.visibility = 'visible';
    this.renderCache = { pair, config, width: viewport.width, height: viewport.height, bottom: metrics.bottom };
  }
  sync() {
    this.mountToolbar(); this.surface.sync();
    if (settings?.owner === this) settings.schedulePosition();
    if (this.wantsEnabled && !document.hidden && this.surface.host.style.display !== 'none') { this.connect(); this.restoreIfNeeded(); }
    this.updatePair(); void this.checkNativeCc();
  }
  destroy() { this.turnOff(); this.disposed = true; this.cancelInfo(); this.clock?.destroy(); this.surface.destroy(); this.toolbarButton.remove(); this.fallback?.remove(); if (settings?.owner === this) closeSettings(); }
}
function scan() {
  if (!active) return;
  for (const [iframe, video] of videos) if (!iframe.isConnected || videoIdFromUrl(iframe.src) !== video.embedId) { video.destroy(); videos.delete(iframe); }
  for (const iframe of document.querySelectorAll('iframe[src]')) if (!videos.has(iframe) && videoIdFromUrl(iframe.src) && new URL(iframe.src).pathname.startsWith('/embed/')) videos.set(iframe, new VideoCaptions(iframe));
}
function onload() {
  if (lifecycle.active) onunload();
  if (!claimRenderer(window, lifecycle, { unknownRenderer: () => !!document.querySelector('.ryb-surface-host,.ryb-settings-host,.ryb-toolbar-button,[data-ryb-toolbar]') })) { console.error('Roam YouTube Bilingual did not start: the previous instance could not be unloaded safely.'); return false; }
  active = true;
  let defaults = { ...DEFAULT_CONFIG }, storage;
  try {
    const legacy = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    if (legacy?.target) defaults.target = validateConfig({ target: legacy.target }).target;
  } catch { /* Keep a legacy language preference, but use the current appearance defaults. */ }
  try { storage = window.localStorage; } catch { /* Report unavailable persistence when a choice is saved. */ }
  preferenceStorage = storage; preferences = createSubtitlePreferences(storage, defaults);
  const visible = [...document.querySelectorAll('iframe[src]')].find(iframe => {
    const rect = iframe.getBoundingClientRect();
    return videoIdFromUrl(iframe.src) && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  });
  preferences.get(visible ? videoIdFromUrl(visible.src) : undefined);
  window.addEventListener('storage', syncStoredPreferences);
  globalStyle = el('style'); globalStyle.dataset.rybToolbar = 'true'; globalStyle.textContent = '.ryb-toolbar-button{width:30px!important;min-width:30px!important;height:30px!important;padding:6px!important;display:inline-flex!important;align-items:center;justify-content:center;background:transparent;border:0;border-radius:3px;color:#607789;cursor:pointer}.ryb-toolbar-button:hover{background:#6077891c}.ryb-toolbar-button[data-active="true"]{color:#2378b5;background:#2378b512}.ryb-toolbar-button .bp3-icon{font-size:18px;line-height:1;pointer-events:none}.ryb-toolbar-button[data-active="true"] .bp3-icon{color:#2378b5!important}.ryb-toolbar-button[data-layout="inline"]{width:24px!important;min-width:24px!important;height:24px!important;min-height:24px!important;padding:4px!important}.ryb-toolbar-button[data-layout="inline"] .bp3-icon{font-size:16px;font-family:Icons16!important}.rm-video-player__spacing-wrapper:not(:hover) .rm-video-player__gutter:not(:focus-within) .ryb-toolbar-button{display:none!important}.ryb-toolbar-fallback{display:flex;justify-content:flex-end;min-height:30px}.ryb-toolbar-button:focus-visible{outline:2px solid #2378b5;outline-offset:2px}'; document.head.append(globalStyle);
  observer = new MutationObserver((records) => {
    if (records.every((record) => record.target instanceof Element && record.target.closest('.ryb-surface-host,.ryb-settings-host,.ryb-toolbar-button'))) return;
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  surfaceTimer = setInterval(() => { for (const video of videos.values()) video.sync(); }, 120);
  if (window.roamAlphaAPI?.ui?.commandPalette) {
    window.roamAlphaAPI.ui.commandPalette.addCommand({ label: commandLabel, callback: () => openSettings([...videos.values()][0]) });
    window.roamAlphaAPI.ui.commandPalette.addCommand({ label: fullscreenCommand, callback: () => { const video = [...videos.values()].find((v) => v.enabled) || [...videos.values()][0]; if (video) void video.surface.toggleFullscreen().catch((error) => video.notice(error.message)); } });
    commandRegistered = true;
  }
  scan(); return true;
}
function onunload() {
  active = false; window.removeEventListener('storage', syncStoredPreferences); preferenceStorage = null; observer?.disconnect(); observer = null; clearTimeout(scanTimer); scanTimer = null; clearInterval(surfaceTimer); surfaceTimer = null;
  closeSettings(); for (const video of videos.values()) video.destroy(); videos.clear(); globalStyle?.remove(); globalStyle = null;
  if (commandRegistered) { window.roamAlphaAPI?.ui?.commandPalette?.removeCommand({ label: commandLabel }); window.roamAlphaAPI?.ui?.commandPalette?.removeCommand({ label: fullscreenCommand }); }
  commandRegistered = false; releaseRenderer(window, lifecycle);
}
export default { onload, onunload };
