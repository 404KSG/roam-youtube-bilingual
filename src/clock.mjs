import { videoIdFromUrl } from './core.mjs';

// Share Roam's player without replacing it or installing a second YT.Player.
// This iframe transport is not a stable public API; isolate it and fail closed.
export class YouTubeClock {
  constructor(iframe, onTime, onState = () => {}, onVideo = () => {}, { now = () => performance.now(), onApiChange = () => {}, onIframeLoad = () => {} } = {}) {
    Object.assign(this, { iframe, onTime, onState, onVideo, now, onApiChange, onIframeLoad });
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
    this.sdk = sdk;
    this.lastRawTimeAt = -Infinity;
    this.channelId = sdk && ['number', 'string'].includes(typeof sdk.id) ? sdk.id : `ryb-${Math.random().toString(36).slice(2)}`;
    this.message = (event) => {
      if (this.destroyed || event.source !== iframe.contentWindow || event.origin !== this.origin) return;
      let data;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!data || !['infoDelivery', 'initialDelivery', 'onReady', 'onStateChange', 'onApiChange'].includes(data.event)) return;
      if (data.event === 'onApiChange') { this.onApiChange(); return; }
      this.ready = true;
      const info = data.info;
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
          this.hasTime = true; this.lastTimeMessage = now(); this.lastRawTimeAt = now();
        } else if (Number.isFinite(info.playerState) || Number.isFinite(info.playbackRate)) {
          this.time = snapshot; this.updated = now();
        }
        if (Number.isFinite(info.playerState)) this.state = info.playerState;
        if (Number.isFinite(info.playbackRate) && info.playbackRate > 0) this.rate = info.playbackRate;
      }
      if (this.hasTime) {
        this.setStatus('Player connected.');
        if (this.pendingSeek !== null) { const target = this.pendingSeek; this.pendingSeek = null; this.seek(target); }
      }
      this.onTime(this.currentTime());
    };
    this.listen = () => {
      this.post({ event: 'listening', id: this.channelId, channel: 'widget' });
      this.command('addEventListener', ['onStateChange']);
      this.command('addEventListener', ['onApiChange']);
    };
    this.loaded = () => {
      this.ready = false; this.hasTime = false; this.state = -1; this.lastTimeMessage = -Infinity;
      this.setStatus('Connecting to the player…'); this.onIframeLoad(); this.listen();
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
      this.readSdk();
      if (this.hasTime && !this.isSynchronized()) this.setStatus('Playback time unavailable. Subtitles are paused.');
      this.onTime(this.currentTime());
    }, 200);
    this.timeout = setTimeout(() => { if (!this.hasTime) this.setStatus('No playback time received. Play the video first.'); }, 12000);
  }
  readSdk() {
    // Prefer fresh player packets. The existing SDK also supplies time/state
    // when a paused player or SDK message dispatcher does not rebroadcast them.
    if (this.destroyed || !this.sdk || this.now() - this.lastRawTimeAt < 500) return;
    try {
      if (this.sdk.getIframe?.() !== this.iframe) return;
      const time = this.sdk.getCurrentTime?.(), state = this.sdk.getPlayerState?.();
      if (!Number.isFinite(time) || time < 0 || ![-1, 0, 1, 2, 3, 5].includes(state)) return;
      const rate = this.sdk.getPlaybackRate?.() || 1;
      if (time !== this.sdkTime || state !== this.sdkState) this.lastTimeMessage = this.now();
      this.sdkTime = time; this.sdkState = state;
      this.time = time; this.state = state; this.rate = rate; this.updated = this.now(); this.hasTime = true; this.ready = true;
      this.setStatus('Player connected.');
    } catch { /* Player may be between mounts; packet transport remains available. */ }
  }
  setStatus(value) { if (this.status !== value) { this.status = value; this.onState(value); } }
  post(data) { if (!this.destroyed) this.iframe.contentWindow?.postMessage(JSON.stringify(data), this.origin); }
  command(func, args = []) { this.post({ event: 'command', func, args }); }
  unloadCaptions() {
    // This only requests closure. The overlay stays hidden until the separate
    // read-only native-state bridge confirms that CC is actually off.
    this.command('unloadModule', ['captions']);
  }
  restoreCaptions() { this.command('loadModule', ['captions']); }
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
