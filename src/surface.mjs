export function subtitleMetrics(width, height, fontScale = 1, bottomRatio = 0.08, { controlsHidden = false } = {}) {
  const preferred = Math.max(10, Math.min(height * 0.3, height * bottomRatio));
  // A parent overlay cannot interleave with controls inside YouTube's iframe.
  // Keep its lower transport/time area clear unless idle controls are confirmed hidden.
  const controlInset = Math.min(height, Math.max(64, Math.min(128, height * 0.5)));
  const bottom = Math.min(height, controlsHidden ? preferred : Math.max(preferred, controlInset));
  return {
    fontSize: Math.max(12, Math.min(32, Math.max(14, Math.min(26, width / 32, height / 12)) * fontScale)),
    bottom,
    maxCaptionHeight: Math.max(0, Math.min(height * 0.45, height - bottom - 8)),
    controlTop: height < 230 ? 10 : 52,
  };
}

export class VideoSurface {
  constructor(iframe, css, { onLayoutChange = () => {}, now = Date.now } = {}) {
    this.iframe = iframe; this.onLayoutChange = onLayoutChange; this.now = now; this.lastInteraction = -Infinity;
    this.interactionListeners = ['pointerenter', 'pointerleave', 'focus', 'blur'].map(type => {
      const listener = () => { if (this.disposed) return; this.lastInteraction = this.now(); this.sync(); this.onLayoutChange(); };
      iframe.addEventListener(type, listener); return [type, listener];
    });
    this.host = document.createElement('div');
    this.host.className = 'ryb-surface-host';
    this.host.setAttribute('contenteditable', 'false');
    this.host.style.cssText = 'all:initial;display:block;pointer-events:none!important;z-index:1!important;overflow:hidden!important;isolation:isolate;box-sizing:border-box!important;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    this.scene = document.createElement('div'); this.scene.className = 'ryb-scene';
    this.shadow.append(style, this.scene);
    this.onFullscreen = () => { if (this.fullscreen && document.fullscreenElement !== this.fullscreen.container) this.restoreFullscreen(); this.sync(); };
    document.addEventListener('fullscreenchange', this.onFullscreen);
    this.sync();
  }
  findContainer() {
    const parent = this.iframe.parentElement?.closest('.rm-video-player__container, .rm-iframe__container, .rm-iframe-container');
    if (!parent || getComputedStyle(parent).position === 'static') return null;
    return parent;
  }
  isInteracting() {
    return this.iframe.matches(':hover') || document.activeElement === this.iframe || this.now() - this.lastInteraction < 3500;
  }
  sync({ blocked = false, fontScale = 1, bottomRatio = 0.08 } = {}) {
    if (this.disposed) return;
    const rect = this.iframe.getBoundingClientRect();
    const offset = this.iframe.offsetParent;
    const container = offset && offset !== document.body && offset !== document.documentElement ? offset : this.findContainer();
    const target = container || document.body;
    if (this.host.parentElement !== target) target.append(this.host);
    this.container = container;
    const parentRect = container?.getBoundingClientRect();
    const scaleX = parentRect && container.offsetWidth ? parentRect.width / container.offsetWidth : 1;
    const scaleY = parentRect && container.offsetHeight ? parentRect.height / container.offsetHeight : 1;
    const width = rect.width / (scaleX || 1), height = rect.height / (scaleY || 1);
    if (this.viewport && (Math.abs(this.viewport.width - width) > 1 || Math.abs(this.viewport.height - height) > 1)) this.lastInteraction = this.now();
    this.viewport = { width, height, scaleX: scaleX || 1, scaleY: scaleY || 1 };
    const left = container ? (rect.left - parentRect.left) / (scaleX || 1) - container.clientLeft + container.scrollLeft : rect.left;
    const top = container ? (rect.top - parentRect.top) / (scaleY || 1) - container.clientTop + container.scrollTop : rect.top;
    const css = this.host.style;
    css.setProperty('position', container ? 'absolute' : 'fixed', 'important');
    css.setProperty('left', `${left}px`, 'important');
    css.setProperty('top', `${top}px`, 'important');
    css.setProperty('width', `${width}px`, 'important');
    css.setProperty('height', `${height}px`, 'important');
    // Use only the next local paint layer, never a page-level 1000/30 overlay.
    const iframeLayer = Number.parseInt(getComputedStyle(this.iframe).zIndex, 10);
    css.setProperty('z-index', String(Math.max(0, Number.isFinite(iframeLayer) ? iframeLayer : 0) + 1), 'important');
    const fs = document.fullscreenElement;
    const eligible = !blocked && !document.hidden && this.iframe.isConnected && rect.width >= 160 && rect.height >= 90 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && (!fs || fs.contains(this.host));
    let visible = eligible;
    if (eligible) {
      // Native container clips automatically; portal fallback additionally checks
      // occlusion to avoid painting over Roam dialogs or unrelated blocks.
      const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      visible = hit === this.iframe || hit === this.host;
    }
    css.setProperty('display', visible ? 'block' : 'none', 'important');
    const metrics = subtitleMetrics(width, height, fontScale, bottomRatio);
    this.scene.style.setProperty('--ryb-size', `${metrics.fontSize}px`);
    this.scene.style.setProperty('--ryb-bottom', `${metrics.bottom}px`);
    this.scene.style.setProperty('--ryb-control-top', `${metrics.controlTop}px`);
  }
  async toggleFullscreen() {
    if (this.fullscreen && document.fullscreenElement === this.fullscreen.container) { await document.exitFullscreen(); return; }
    const container = this.findContainer();
    if (!container?.requestFullscreen || !document.fullscreenEnabled) throw new Error('Bilingual fullscreen is unavailable in this layout. Use Roam\'s theater view.');
    if (document.fullscreenElement) throw new Error('Exit YouTube fullscreen before opening bilingual fullscreen.');
    const original = container.getAttribute('data-ryb-fullscreen');
    const style = document.createElement('style'); style.dataset.rybFullscreen = 'true';
    style.textContent = '[data-ryb-fullscreen="managed"]:fullscreen{position:fixed!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;padding:0!important;margin:0!important;border:0!important;inset:0!important;background:#000!important}';
    this.fullscreen = { container, original, style };
    container.setAttribute('data-ryb-fullscreen', 'managed'); document.head.append(style);
    try { await container.requestFullscreen(); } catch { this.restoreFullscreen(); throw new Error('Fullscreen was blocked. Run the bilingual fullscreen command directly.'); }
  }
  restoreFullscreen() {
    if (!this.fullscreen) return;
    const { container, original, style } = this.fullscreen;
    if (container.getAttribute('data-ryb-fullscreen') === 'managed') {
      if (original === null) container.removeAttribute('data-ryb-fullscreen'); else container.setAttribute('data-ryb-fullscreen', original);
    }
    style.remove(); this.fullscreen = null;
  }
  destroy() {
    this.disposed = true;
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    for (const [type, listener] of this.interactionListeners) this.iframe.removeEventListener(type, listener);
    if (this.fullscreen?.container === document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.restoreFullscreen(); this.host.remove();
  }
}
