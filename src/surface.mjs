export function subtitleMetrics(width, height, fontScale = 1, bottomRatio = 0.08) {
  return {
    fontSize: Math.max(12, Math.min(32, Math.max(14, Math.min(26, width / 32, height / 12)) * fontScale)),
    bottom: Math.max(8, Math.min(height * 0.3, height * bottomRatio)),
    controlTop: height < 230 ? 10 : 52,
  };
}

export class VideoSurface {
  constructor(iframe, css) {
    this.iframe = iframe;
    this.host = document.createElement('div');
    this.host.className = 'ryb-surface-host';
    this.host.setAttribute('contenteditable', 'false');
    this.host.style.cssText = 'all:initial;display:block;pointer-events:none!important;z-index:30!important;overflow:hidden!important;isolation:isolate;box-sizing:border-box!important;';
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
    const a = parent.getBoundingClientRect(), b = this.iframe.getBoundingClientRect();
    return ['left', 'top', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) < 3) ? parent : null;
  }
  sync({ blocked = false, fontScale = 1, bottomRatio = 0.08 } = {}) {
    if (this.disposed) return;
    const rect = this.iframe.getBoundingClientRect();
    const container = this.findContainer();
    const target = container || document.body;
    if (this.host.parentElement !== target) target.append(this.host);
    this.container = container;
    const css = this.host.style;
    css.setProperty('position', container ? 'absolute' : 'fixed', 'important');
    css.setProperty('left', container ? '0px' : `${rect.left}px`, 'important');
    css.setProperty('top', container ? '0px' : `${rect.top}px`, 'important');
    css.setProperty('width', container ? '100%' : `${rect.width}px`, 'important');
    css.setProperty('height', container ? '100%' : `${rect.height}px`, 'important');
    css.setProperty('z-index', container ? '30' : '1000', 'important');
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
    const metrics = subtitleMetrics(rect.width, rect.height, fontScale, bottomRatio);
    this.scene.style.setProperty('--ryb-size', `${metrics.fontSize}px`);
    this.scene.style.setProperty('--ryb-bottom', `${metrics.bottom}px`);
    this.scene.style.setProperty('--ryb-control-top', `${metrics.controlTop}px`);
  }
  async toggleFullscreen() {
    if (this.fullscreen && document.fullscreenElement === this.fullscreen.container) { await document.exitFullscreen(); return; }
    const container = this.findContainer();
    if (!container?.requestFullscreen || !document.fullscreenEnabled) throw new Error('此布局不支持双语全屏。请使用 Roam 的剧场视频视图。');
    if (document.fullscreenElement) throw new Error('请先退出 YouTube 原生全屏，再使用“双语全屏”。');
    const original = container.getAttribute('data-ryb-fullscreen');
    const style = document.createElement('style'); style.dataset.rybFullscreen = 'true';
    style.textContent = '[data-ryb-fullscreen="managed"]:fullscreen{position:fixed!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;padding:0!important;margin:0!important;border:0!important;inset:0!important;background:#000!important}';
    this.fullscreen = { container, original, style };
    container.setAttribute('data-ryb-fullscreen', 'managed'); document.head.append(style);
    try { await container.requestFullscreen(); } catch { this.restoreFullscreen(); throw new Error('浏览器未允许全屏，请直接点击“双语全屏”按钮重试。'); }
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
    if (this.fullscreen?.container === document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.restoreFullscreen(); this.host.remove();
  }
}
