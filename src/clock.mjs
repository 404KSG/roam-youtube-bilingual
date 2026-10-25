import { videoIdFromUrl } from './core.mjs';
import { nativeCaptionTrack } from './protocol.mjs';

// Share Roam's player without replacing it or installing a second YT.Player.
// This iframe transport is not a stable public API; isolate it and fail closed.
export class YouTubeClock {
  constructor(iframe, onTime, onState = () => {}, onVideo = () => {}, { now = () => performance.now() } = {}) {
    Object.assign(this, { iframe, onTime, onState, onVideo, now });
    this.videoId = videoIdFromUrl(iframe.src);
    this.time = 0;
    this.state = -1;
    this.rate = 1;
    this.updated = now();
    this.lastTimeMessage = -Infinity;
    this.ready = false;
    this.hasTime = false;
    this.pendingSeek = null;
    this.originalSrc = iframe.getAttribute('src');
    const url = new URL(iframe.src);
    this.origin = url.origin;
    // Roam already owns a YT.Player instance. Reusing its message id prevents
    // stealing infoDelivery from its timestamp/seek controls.
    let sdk;
    try { const candidate = window.YT?.get?.(iframe.id); if (candidate?.getIframe?.() === iframe) sdk = candidate; } catch { /* Standalone iframe. */ }
    this.channelId = sdk && ['number', 'string'].includes(typeof sdk.id) ? sdk.id : `ryb-${Math.random().toString(36).slice(2)}`;
    this.message = (event) => {
      if (this.destroyed || event.source !== iframe.contentWindow || event.origin !== this.origin) return;
      let data;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!data || !['infoDelivery', 'initialDelivery', 'onReady', 'onStateChange'].includes(data.event)) return;
      this.ready = true;
      const info = data.info;
      const wasPlaying = this.state === 1;
      let snapshot = this.currentTime();
      if (data.event === 'onStateChange' && Number.isFinite(info)) {
        this.time = snapshot; this.updated = now(); this.state = info;
      }
      if (info && typeof info === 'object') {
        const id = info.videoData?.video_id;
        if (/^[\w-]{11}$/.test(id || '') && id !== this.videoId) {
          this.videoId = id; this.pendingSeek = null; this.hasTime = false;
          this.time = 0; snapshot = 0; this.updated = now(); this.state = -1; this.rate = 1;
          this.onVideo(id);
        }
        // Rate/state-only packets must rebase the clock before changing its slope.
        if (Number.isFinite(info.currentTime) && info.currentTime >= 0) {
          this.time = info.currentTime; this.updated = now();
          this.hasTime = true; this.lastTimeMessage = now();
        } else if (Number.isFinite(info.playerState) || Number.isFinite(info.playbackRate)) {
          this.time = snapshot; this.updated = now();
        }
        if (Number.isFinite(info.playerState)) this.state = info.playerState;
        if (Number.isFinite(info.playbackRate) && info.playbackRate > 0) this.rate = info.playbackRate;
      }
      if (this.hasTime) {
        this.setStatus('已连接播放器');
        if (this.pendingSeek !== null) { const target = this.pendingSeek; this.pendingSeek = null; this.seek(target); }
      }
      if (!wasPlaying && this.state === 1 && this.nativeTrack && !this.nativePlaySeen) {
        this.nativePlaySeen = true; this.nativeAttempts = 0; this.nativeLastAttempt = -Infinity;
      }
      this.applyNativeTranslation();
      this.onTime(this.currentTime());
    };
    this.listen = () => {
      this.post({ event: 'listening', id: this.channelId, channel: 'widget' });
      this.command('addEventListener', ['onStateChange']);
    };
    this.loaded = () => {
      this.ready = false; this.hasTime = false; this.state = -1; this.lastTimeMessage = -Infinity;
      this.nativeAttempts = 0; this.nativeLastAttempt = -Infinity; this.nativePlaySeen = false;
      this.setStatus('正在连接…'); this.listen();
    };
    window.addEventListener('message', this.message);
    iframe.addEventListener('load', this.loaded);
    if (url.searchParams.get('enablejsapi') !== '1') {
      url.searchParams.set('enablejsapi', '1');
      url.searchParams.set('origin', location.origin);
      this.managedSrc = url.href; iframe.src = this.managedSrc;
    }
    this.listen();
    this.handshake = setInterval(() => { if (!this.isSynchronized()) this.listen(); }, 2000);
    this.timer = setInterval(() => {
      if (this.hasTime && !this.isSynchronized()) this.setStatus('播放时间信号中断，已暂停自动翻译；可点击重新连接。');
      this.applyNativeTranslation();
      this.onTime(this.currentTime());
    }, 200);
    this.timeout = setTimeout(() => { if (!this.hasTime) this.setStatus('未收到播放时间。请先播放视频；若仍无响应，请重新连接。'); }, 12000);
  }
  setStatus(value) { if (this.status !== value) { this.status = value; this.onState(value); } }
  post(data) { if (!this.destroyed) this.iframe.contentWindow?.postMessage(JSON.stringify(data), this.origin); }
  command(func, args = []) { this.post({ event: 'command', func, args }); }
  setNativeTranslation(source, target, details) {
    this.nativeTrack = nativeCaptionTrack(source, target, details);
    this.nativeAttempts = 0; this.nativeLastAttempt = -Infinity; this.nativePlaySeen = this.state === 1;
    this.applyNativeTranslation();
  }
  clearNativeTranslation() { this.nativeTrack = null; }
  applyNativeTranslation() {
    // This is the same track-selection payload used by YouTube's own caption
    // menu. It is an empirical adapter, not a documented/stable IFrame option.
    // Chinese is fetched and rendered by YouTube, never translated by our API.
    if (!this.nativeTrack || !this.hasTime || this.destroyed || this.nativeAttempts >= 3 || this.now() - this.nativeLastAttempt < 1500) return;
    this.nativeLastAttempt = this.now(); this.nativeAttempts++;
    this.command('loadModule', ['captions']);
    this.command('setOption', ['captions', 'track', this.nativeTrack]);
  }
  isSynchronized() {
    // Paused/ended/cued players need not emit periodic time packets.
    return !this.destroyed && this.hasTime && (this.state !== 1 || this.now() - this.lastTimeMessage < 5000);
  }
  currentTime() {
    // A disconnected player must never advance indefinitely and spend API credits.
    const elapsed = Math.max(0, Math.min(1500, this.now() - this.updated)) / 1000;
    return Math.max(0, this.time + (this.state === 1 ? elapsed * this.rate : 0));
  }
  seek(seconds) {
    if (!Number.isFinite(seconds)) return;
    if (!this.isSynchronized()) { this.pendingSeek = Math.max(0, seconds); this.listen(); return; }
    this.time = Math.max(0, seconds); this.updated = this.now();
    this.command('seekTo', [this.time, true]); this.command('playVideo');
    this.onTime(this.time);
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.handshake); clearInterval(this.timer); clearTimeout(this.timeout);
    window.removeEventListener('message', this.message);
    this.iframe.removeEventListener('load', this.loaded);
    if (this.managedSrc && this.iframe.getAttribute('src') === this.managedSrc) this.iframe.setAttribute('src', this.originalSrc);
  }
}
