import { videoIdFromUrl, normalizeCues, activeCueIndex } from './core.mjs';
import { YouTubeClock } from './clock.mjs';
import { VideoSurface } from './surface.mjs';
import { claimRenderer, releaseRenderer } from './lifecycle.mjs';
import { resolveNativeCc } from './native-cc.mjs';
import { VERSION, SERVICE_URL, DEFAULT_CONFIG, validateConfig, verifyHealth, singleLine, fittedFontSize } from './protocol.mjs';

const STORAGE_KEY = 'roam-youtube-bilingual/session/v1';
const commandLabel = 'YouTube subtitles: Settings';
const fullscreenCommand = 'YouTube subtitles: Fullscreen';
const videos = new Map();
let config = { ...DEFAULT_CONFIG };
let active = false, observer, scanTimer, surfaceTimer, settings, globalStyle;
let commandRegistered = false;
const lifecycle = { active: false, unload: () => onunload() };
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const button = (text, callback, cls = '') => { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', callback); return node; };
function saveConfig(next) {
  const old = config; config = validateConfig(next);
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* Optional session storage. */ }
  for (const video of videos.values()) {
    if (old.target !== config.target) void video.changeTarget();
    else video.drawPair();
  }
}
async function request(path, body, signal) {
  let response;
  try {
    response = await fetch(`${SERVICE_URL}${path}`, {
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
function languageName(language) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(language.code) || language.code; } catch { return language.code; }
}
function closeSettings(ref = settings) {
  if (!ref || ref.closed) return;
  ref.closed = true; ref.abort.abort();
  if (ref.dialog.open) ref.dialog.close(); ref.host.remove();
  if (settings === ref) settings = null;
  if (!ref.owner.disposed) { ref.owner.toolbarButton.setAttribute('aria-expanded', 'false'); ref.owner.closeNativeGate(); if (active) ref.owner.sync(); }
}
function openSettings(owner) {
  if (!owner || owner.disposed) return;
  if (settings) { settings.dialog.focus(); return; }
  owner.closeNativeGate();
  const host = el('div', 'ryb-settings-host'); host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const shadow = host.attachShadow({ mode: 'open' }); const style = el('style'); style.textContent = STYLE;
  const dialog = el('dialog', 'ryb-settings');
  const ref = { host, dialog, owner, abort: new AbortController() }; settings = ref;
  for (const type of ['pointerdown', 'click', 'keydown']) dialog.addEventListener(type, (event) => event.stopPropagation());
  dialog.addEventListener('close', () => closeSettings(ref));
  dialog.append(el('h2', '', 'Bilingual subtitles'));
  const enabledLabel = el('label', 'ryb-toggle-row');
  const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = owner.enabled; enabled.setAttribute('aria-label', 'Enable bilingual subtitles');
  enabledLabel.append(el('span', '', 'Enable bilingual subtitles'), enabled); dialog.append(enabledLabel);
  const languageLabel = el('label', 'ryb-field'); languageLabel.append(el('span', '', 'Translation language'));
  const language = el('select'); language.name = 'target'; language.disabled = true;
  language.append(el('option', '', 'Loading available languages…')); languageLabel.append(language); dialog.append(languageLabel);
  const fontLabel = el('label', 'ryb-field');
  const sizeText = el('span', '', `Font size: ${config.fontSize} px`);
  const font = el('input'); font.type = 'range'; font.name = 'fontSize'; font.min = '12'; font.max = '36'; font.step = '1'; font.value = String(config.fontSize); font.setAttribute('aria-label', 'Subtitle font size');
  fontLabel.append(sizeText, font); dialog.append(fontLabel);
  dialog.append(el('p', 'ryb-hint', 'English above translation. Two lines share one background; long captions shrink to fit.'));
  const status = el('p', 'ryb-status'); status.setAttribute('role', 'status'); status.textContent = owner.loading ? owner.noticeBox.textContent || 'Preparing subtitles…' : owner.lastError || ''; ref.status = status; dialog.append(status);
  const footer = el('div', 'ryb-settings-footer'); footer.append(button('Done', () => closeSettings(ref), 'ryb-primary')); dialog.append(footer);
  font.addEventListener('input', () => { try { saveConfig({ ...config, fontSize: Number(font.value) }); sizeText.textContent = `Font size: ${config.fontSize} px`; } catch (error) { status.textContent = error.message; } });
  language.addEventListener('change', () => { try { saveConfig({ ...config, target: language.value }); } catch (error) { status.textContent = error.message; } });
  enabled.addEventListener('change', () => { if (enabled.checked) void owner.turnOn().then(() => { if (!ref.closed) { enabled.checked = owner.enabled; status.textContent = owner.lastError || ''; } }); else owner.turnOff(); });
  shadow.append(style, dialog);
  const fs = document.fullscreenElement;
  (fs && fs.contains(owner.iframe) ? fs : document.body).append(host);
  owner.toolbarButton.setAttribute('aria-expanded', 'true'); dialog.showModal(); owner.sync();
  void owner.loadInfo(ref.abort.signal).then((info) => {
    if (ref.closed) return;
    language.replaceChildren();
    const priority = ['zh-Hans', 'zh-Hant', 'ja'];
    const languages = [...info.languages].sort((a, b) => {
      const ai = priority.includes(a.code) ? priority.indexOf(a.code) : 99, bi = priority.includes(b.code) ? priority.indexOf(b.code) : 99;
      return ai - bi || languageName(a).localeCompare(languageName(b), 'en');
    });
    for (const item of languages) { const option = el('option', '', languageName(item)); option.value = item.code; language.append(option); }
    language.value = config.target;
    if (!language.value) { language.selectedIndex = -1; status.textContent = 'Choose a translation language available for this video.'; }
    language.disabled = !languages.length;
    if (!info.sourceLanguage) { enabled.disabled = true; status.textContent = 'This video has no available English captions.'; }
  }).catch((error) => { if (!ref.closed && error.name !== 'AbortError') status.textContent = error.message; });
}
function toolbarIcon() {
  const icon = el('span', 'bp3-icon bp3-icon-translate');
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

class VideoCaptions {
  constructor(iframe) {
    this.iframe = iframe; this.videoId = videoIdFromUrl(iframe.src); this.embedId = this.videoId;
    this.tracks = new Map(); this.time = 0; this.epoch = 0; this.enabled = false; this.loading = false; this.ccState = 'unknown'; this.ccVerifiedAt = 0; this.nativeWasOn = null; this.nativeChanged = false;
    this.surface = new VideoSurface(iframe, STYLE); this.surface.host.dataset.version = VERSION;
    this.box = el('div', 'ryb-caption-box'); this.box.hidden = true; this.box.setAttribute('aria-label', 'Bilingual subtitles');
    this.source = el('div', 'ryb-line ryb-source'); this.source.dir = 'ltr';
    this.target = el('div', 'ryb-line ryb-target'); this.target.dir = 'auto';
    this.box.append(this.source, this.target); this.surface.scene.append(this.box);
    this.noticeBox = el('div', 'ryb-notice'); this.noticeBox.hidden = true; this.noticeBox.setAttribute('role', 'status'); this.surface.scene.append(this.noticeBox);
    this.toolbarButton = button('', () => openSettings(this), 'bp3-button bp3-minimal ryb-toolbar-button');
    this.toolbarButton.append(toolbarIcon()); this.toolbarButton.setAttribute('aria-label', 'Bilingual subtitle settings'); this.toolbarButton.setAttribute('aria-haspopup', 'dialog'); this.toolbarButton.title = 'Bilingual subtitle settings';
    for (const type of ['click', 'pointerdown', 'mousedown', 'keydown']) this.toolbarButton.addEventListener(type, (event) => event.stopPropagation());
    this.canvas = document.createElement('canvas'); this.measure = this.canvas.getContext('2d');
    this.mountToolbar();
  }
  mountToolbar() {
    const wrapper = this.iframe.parentElement?.closest('.rm-video-player__spacing-wrapper, .rm-iframe__spacing-wrapper');
    const native = wrapper?.querySelector('.rm-video-player__theater-toolbar');
    let target = native;
    if (!target) {
      const anchor = wrapper || this.surface.findContainer() || this.iframe;
      if (!this.fallback) this.fallback = el('div', 'ryb-toolbar-fallback');
      if (this.fallback.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', this.fallback);
      target = this.fallback;
    }
    if (this.toolbarButton.parentElement !== target) target.append(this.toolbarButton);
    if (native && this.fallback) { this.fallback.remove(); this.fallback = null; }
  }
  updateIcon() { this.toolbarButton.dataset.active = String(this.enabled); this.toolbarButton.dataset.loading = String(this.loading); this.toolbarButton.setAttribute('aria-busy', String(this.loading)); this.toolbarButton.title = this.loading ? 'Preparing subtitles. Open settings to cancel.' : 'Bilingual subtitle settings'; }
  notice(message, duration = 6000) {
    if (this.disposed) return;
    if (settings?.owner === this && settings.status) settings.status.textContent = message;
    const key = `${this.epoch}:${message}`;
    if (this.lastNoticeKey === key) return;
    this.lastNoticeKey = key;
    clearTimeout(this.noticeTimer); this.noticeBox.textContent = message; this.noticeBox.hidden = !message;
    if (duration) this.noticeTimer = setTimeout(() => { this.noticeBox.hidden = true; }, duration);
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
  async loadTrack(language, signal) {
    if (this.tracks.has(language)) return this.tracks.get(language);
    const data = await request('/v1/youtube/captions', { videoId: this.videoId, target: language }, signal);
    signal?.throwIfAborted();
    if (this.disposed || data.videoId !== this.videoId || data.language !== language) throw new Error('The captions do not match the current video or language.');
    const cues = normalizeCues(data.cues);
    if (!cues.length) throw new Error('The selected captions have no valid timestamps.');
    this.tracks.set(language, cues); return cues;
  }
  connect() {
    if (this.clock) return;
    this.clock = new YouTubeClock(this.iframe, (time) => { if (!this.disposed) { this.time = time; this.updatePair(); } }, (state) => {
      if (this.enabled && state === 'Playback time unavailable. Subtitles are paused.') { this.clearPair(); this.notice(state); }
    }, (id) => this.videoChanged(id), { onApiChange: () => this.closeNativeGate(), onIframeLoad: () => this.closeNativeGate() });
  }
  videoChanged(id) {
    this.cancelInfo(); this.closeNativeGate(); this.turnOff(); this.videoId = id; this.info = null; this.tracks.clear();
    this.notice('Video changed. Enable bilingual subtitles again.', 4000);
  }
  async turnOn() {
    if (this.enabled || this.disposed) return;
    for (const video of videos.values()) if (video !== this) video.turnOff();
    this.turnOff(); this.enabled = true; this.loading = true; this.lastError = '';
    const epoch = this.epoch; const abort = this.startRequest = new AbortController();
    this.updateIcon(); this.notice('Loading English and translated subtitles…');
    try {
      verifyHealth(await request('/v1/youtube/health', undefined, abort.signal));
      const info = await this.loadInfo(abort.signal);
      if (!info.sourceLanguage) throw new Error('This video has no available English captions.');
      if (!info.languages.some((item) => item.code === config.target)) throw new Error('Choose a translation language available for this video.');
      if (!this.tracks.has(config.target) && info.languages.some(item => item.code === config.target && item.autoTranslated)) this.notice('Preparing YouTube translation. The first download may take about a minute.');
      // The helper prepares auto-translations after extraction and reuses saved
      // tracks. Original/uploaded captions do not need the preparation delay.
      await this.loadTrack(config.target, abort.signal);
      await this.loadTrack(info.sourceLanguage, abort.signal);
      if (this.disposed || epoch !== this.epoch || abort.signal.aborted) return;
      this.connect(); this.closeNativeGate(); this.notice('Checking that native captions are off…');
    } catch (error) {
      if (error.name !== 'AbortError' && epoch === this.epoch) { this.turnOff(); this.lastError = error.message; this.notice(error.message); }
    } finally { if (this.startRequest === abort) { this.startRequest = null; this.loading = false; this.updateIcon(); } }
  }
  clearPair() { this.pair = null; this.box.hidden = true; this.source.textContent = ''; this.target.textContent = ''; }
  closeNativeGate() {
    this.ccState = 'unknown'; this.ccVerifiedAt = 0; this.ccRequest?.abort(); this.ccRequest = null; this.clearPair();
    this.nextCcCheck = 0;
  }
  turnOff() {
    this.epoch++; this.enabled = false; this.loading = false;
    this.startRequest?.abort(); this.startRequest = null; this.ccRequest?.abort(); this.ccRequest = null;
    this.ccState = 'unknown'; this.ccVerifiedAt = 0; this.clearPair();
    // Never switch native CC merely because a download failed or a dialog closed.
    // Restore only a state this instance positively observed and then changed.
    if (this.nativeChanged && this.nativeWasOn === true) this.clock?.restoreCaptions();
    this.nativeChanged = false; this.nativeWasOn = null;
    clearTimeout(this.noticeTimer); this.noticeBox.hidden = true; this.updateIcon();
  }
  async changeTarget() {
    const restart = this.enabled;
    this.turnOff();
    if (restart) await this.turnOn();
  }
  screenFrame() {
    const rect = this.iframe.getBoundingClientRect();
    const scale = outerWidth > 0 && innerWidth > 0 ? outerWidth / innerWidth : 1;
    return { x: screenX + rect.x * scale, y: screenY + outerHeight - innerHeight * scale + rect.y * scale, width: rect.width * scale, height: rect.height * scale };
  }
  async checkNativeCc() {
    if (!this.enabled || this.loading || this.disposed || this.ccRequest || settings || document.hidden || this.surface.host.style.display === 'none' || Date.now() < (this.nextCcCheck || 0)) return;
    const epoch = this.epoch, videoId = this.videoId, abort = this.ccRequest = new AbortController();
    const before = Date.now(), frame = this.screenFrame();
    try {
      const data = await request('/v1/youtube/native-cc-state', { videoId, frame }, abort.signal);
      if (this.disposed || epoch !== this.epoch || abort.signal.aborted || data.videoId !== videoId) return;
      const currentFrame = this.screenFrame();
      if (Date.now() - before > 1200 || ['x', 'y', 'width', 'height'].some(key => Math.abs(frame[key] - currentFrame[key]) > 4)) { this.closeNativeGate(); return; }
      this.ccState = resolveNativeCc(this.ccState, data);
      this.nextCcCheck = Date.now() + 700;
      if (this.ccState !== 'off') {
        this.clearPair();
        if (this.ccState === 'on') {
          this.nativeWasOn ??= true; this.nativeChanged = true;
          this.clock?.unloadCaptions(); this.notice('Native captions are still on. Bilingual subtitles remain hidden.');
        } else if (data.reason === 'controls-hidden') this.clock?.wakeCaptionControls();
        return;
      }
      this.nativeWasOn ??= false; this.ccVerifiedAt = before;
      this.noticeBox.hidden = true; this.lastNoticeKey = null; this.lastError = ''; this.updatePair();
    } catch (error) {
      if (error.name !== 'AbortError' && epoch === this.epoch) { this.ccState = 'unknown'; this.clearPair(); this.lastError = error.message; this.notice(error.message); this.nextCcCheck = Date.now() + 2000; }
    } finally { if (this.ccRequest === abort) this.ccRequest = null; }
  }
  updatePair() {
    if (!this.enabled || this.loading || this.ccState !== 'off' || Date.now() - this.ccVerifiedAt > 1500 || this.disposed || !this.clock?.isSynchronized()) { this.clearPair(); return; }
    const sourceCues = this.tracks.get(this.info?.sourceLanguage), targetCues = this.tracks.get(config.target);
    const source = sourceCues?.[activeCueIndex(sourceCues, this.time)], target = targetCues?.[activeCueIndex(targetCues, this.time)];
    if (!source || !target) { this.clearPair(); return; }
    this.pair = { source: singleLine(source.text), target: singleLine(target.text) }; this.drawPair();
  }
  drawPair() {
    if (!this.enabled || this.ccState !== 'off' || Date.now() - this.ccVerifiedAt > 1500 || !this.pair || this.disposed) { this.box.hidden = true; return; }
    const rect = this.iframe.getBoundingClientRect(), pair = this.pair;
    if (rect.width < 160 || rect.height < 90 || !pair.source || !pair.target) { this.box.hidden = true; return; }
    if (this.source.textContent !== pair.source) this.source.textContent = pair.source;
    if (this.target.textContent !== pair.target) this.target.textContent = pair.target;
    const available = rect.width - 28;
    this.measure.font = `400 ${config.fontSize}px Arial, "PingFang SC", sans-serif`;
    const measured = Math.max(this.measure.measureText(pair.source).width, this.measure.measureText(pair.target).width);
    const font = fittedFontSize(config.fontSize, available, measured);
    const textWidth = measured * font / config.fontSize;
    const width = Math.min(rect.width, Math.max(textWidth + 24, 80));
    const height = font * 2.5 + 12, bottom = Math.max(10, rect.height * .08);
    Object.assign(this.box.style, { width: `${width}px`, height: `${height}px`, left: `${Math.max(0, (rect.width - width) / 2)}px`, top: `${Math.max(0, rect.height - bottom - height)}px`, fontSize: `${font}px`, borderRadius: width >= rect.width - .5 ? '0px' : '4px' });
    this.box.hidden = false;
    const range = document.createRange();
    const renderedWidth = Math.max(...[this.source, this.target].map((row) => { range.selectNodeContents(row); return range.getBoundingClientRect().width; }));
    const innerWidth = Math.max(1, width - 24);
    const finalFont = renderedWidth > innerWidth ? font * (innerWidth - 1) / renderedWidth : font;
    this.box.style.fontSize = `${finalFont}px`; this.box.dataset.fontSize = String(finalFont);
  }
  sync() {
    this.mountToolbar(); this.surface.sync({ blocked: !!settings });
    this.drawPair(); void this.checkNativeCc();
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
  try { config = validateConfig(JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')); } catch { config = { ...DEFAULT_CONFIG }; }
  globalStyle = el('style'); globalStyle.dataset.rybToolbar = 'true'; globalStyle.textContent = '.ryb-toolbar-button{width:30px!important;min-width:30px!important;height:30px!important;padding:6px!important;display:inline-flex!important;align-items:center;justify-content:center;background:transparent;border:0;border-radius:3px;color:#607789;cursor:pointer}.ryb-toolbar-button:hover{background:#6077891c}.ryb-toolbar-button[data-active="true"]{color:#2378b5;background:#2378b512}.ryb-toolbar-button .bp3-icon{font-size:20px;line-height:1;color:inherit;pointer-events:none}.ryb-toolbar-fallback{display:flex;justify-content:flex-end;min-height:30px}.ryb-toolbar-button:focus-visible{outline:2px solid #2378b5;outline-offset:2px}'; document.head.append(globalStyle);
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
  active = false; observer?.disconnect(); observer = null; clearTimeout(scanTimer); scanTimer = null; clearInterval(surfaceTimer); surfaceTimer = null;
  closeSettings(); for (const video of videos.values()) video.destroy(); videos.clear(); globalStyle?.remove(); globalStyle = null;
  if (commandRegistered) { window.roamAlphaAPI?.ui?.commandPalette?.removeCommand({ label: commandLabel }); window.roamAlphaAPI?.ui?.commandPalette?.removeCommand({ label: fullscreenCommand }); }
  commandRegistered = false; releaseRenderer(window, lifecycle);
}
export default { onload, onunload };
