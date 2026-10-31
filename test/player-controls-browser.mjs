import { VideoSurface } from '../src/surface.mjs';

// Fully owned srcdoc player, mocked captions, and API-v8 state observations.
// The real iframe range is driven separately with trusted browser pointer input.
export async function setupPlayerControlsFixture({ sourceCues, targetCues } = {}) {
  if (location.pathname !== '/test-controls-fixture') throw new Error('Owned control-clearance fixture only.');
  const plugin = window.roamYouTubeBilingual, frame = document.querySelector('#player');
  const originalFetch = window.fetch, key = 'roam-youtube-bilingual/global/v1', saved = localStorage.getItem(key);
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  plugin.onunload(); localStorage.removeItem(key);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  const source = 'The same English caption stays readable without covering playback controls.';
  const target = '这条测试字幕应该避开进度条，同时保留原来的字号和颜色。';
  let reason = 'control', nativeState = 'off', controlsVisible = true, state = 2, time = 1, captionRequests = 0, ccChecks = 0;
  const wait = async condition => { const end = performance.now() + 7000; while (!condition()) { if (performance.now() > end) throw new Error('Control-clearance fixture timed out'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const host = () => document.querySelector('.ryb-surface-host');
  const box = () => host()?.shadowRoot.querySelector('.ryb-caption-box');
  const tick = () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: time, playerState: state } } }));
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : {};
    let data;
    if (path.endsWith('/health')) data = { ok: true, service: 'roam-youtube-bilingual', apiVersion: 8, provider: 'youtube-unified' };
    else if (path.endsWith('/video-info')) data = { videoId: body.videoId, sourceLanguage: 'en', title: 'Mock', languages: [{ code: 'zh-Hans' }] };
    else if (path.endsWith('/native-cc-state')) { ccChecks++; data = { videoId: body.videoId, state: nativeState, reason, controlsVisible, checkedAt: Date.now() }; }
    else if (path.endsWith('/caption-session')) {
      captionRequests++;
      const base = { videoId: body.videoId, target: body.target, captionPolicy: 'same-source-v1' }, fingerprint = 'a'.repeat(64);
      const events = [
        { ...base, sequence: 1, type: 'info', cacheDisposition: 'miss', info: { videoId: body.videoId, sourceLanguage: 'en', title: 'Mock', languages: [{ code: 'zh-Hans' }] } },
        { ...base, sequence: 2, type: 'source-ready', language: 'en', sourceFingerprint: fingerprint, cues: sourceCues || [{ start: 0, end: 600, text: source }] },
        { ...base, sequence: 3, type: 'target-ready', language: body.target, targetType: 'auto-translated', sourceFingerprint: fingerprint, pairId: 'b'.repeat(64), cues: targetCues || [{ start: 0, end: 600, text: target }] },
        { ...base, sequence: 4, type: 'complete', outcome: 'bilingual' },
      ];
      return new Response(events.map(JSON.stringify).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
    } else throw new Error('Unexpected fixture request');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  const timer = setInterval(tick, 200);
  plugin.onload(); document.querySelector('.ryb-toolbar-button').click();
  const settings = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  await wait(() => settings()?.querySelector('select')?.disabled === false);
  const toggle = settings().querySelector('input[type=checkbox]'); toggle.checked = true; toggle.dispatchEvent(new Event('change'));
  settings().querySelector('[aria-label="Close subtitle settings"]').click();
  await wait(() => box() && !box().hidden);
  const probe = () => {
    const f = frame.getBoundingClientRect(), b = box().getBoundingClientRect(), controls = frame.contentDocument.querySelector('#controls').getBoundingClientRect();
    const scaleY = f.height / frame.clientHeight;
    return { frame: f.toJSON(), box: b.toJSON(), controlsTop: f.top + controls.top * scaleY, gap: f.bottom - b.bottom, hidden: box().hidden, layer: getComputedStyle(host()).zIndex, local: host().parentElement === frame.offsetParent, requests: captionRequests, source: box().children[0].textContent, target: box().children[1].textContent, sizes: [...box().children].map(row => getComputedStyle(row).fontSize) };
  };
  return {
    frame, host, box, probe, wait,
    get ccChecks() { return ccChecks; },
    at(seconds) { time = seconds; tick(); },
    nativeCc(nextState, nextReason, visible = nextReason !== 'controls-hidden') {
      nativeState = nextState; reason = nextReason; controlsVisible = visible;
      frame.contentDocument.querySelector('#controls').hidden = visible === false;
    },
    playback(nextState, controlsHidden = false) {
      state = nextState; reason = controlsHidden ? 'controls-hidden' : 'control'; nativeState = controlsHidden ? 'unknown' : 'off'; controlsVisible = !controlsHidden;
      frame.contentDocument.querySelector('#controls').hidden = controlsHidden; tick();
    },
    async geometry(style, frameStyle = '') {
      document.querySelector('#player-container').style.cssText = style; frame.style.cssText = frameStyle;
      tick(); await wait(() => host().style.display !== 'none');
    },
    async independentSurfaceChecks() {
      const extra = document.createElement('iframe'); extra.srcdoc = '<!doctype html><p>Owned layout probe</p>';
      extra.style.cssText = 'display:block;position:static;width:320px;height:180px;border:0;margin:0';
      await new Promise(resolve => { extra.onload = resolve; document.body.append(extra); });
      const surface = new VideoSurface(extra, '');
      try {
        const r = extra.getBoundingClientRect(), h = surface.host.getBoundingClientRect();
        if (surface.host.style.zIndex !== '1' || ['left','top','width','height'].some(k => Math.abs(r[k] - h[k]) > 1)) throw new Error('Plain iframe fallback is not bounded at a low layer');
        surface.destroy(); const at = surface.lastInteraction; extra.dispatchEvent(new Event('pointerenter'));
        if (surface.host.isConnected || surface.lastInteraction !== at) throw new Error('Surface interaction listeners survived teardown');
      } finally { surface.destroy(); extra.remove(); }
    },
    cleanup() {
      clearInterval(timer); plugin.onunload(); window.fetch = originalFetch;
      if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
      if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
    },
  };
}

export async function runPlayerControlsAcceptance({ keep = false } = {}) {
  const fixture = await setupPlayerControlsFixture(), results = {};
  const check = (condition, name) => { if (!condition) throw new Error(name); results[name] = true; };
  try {
    let p = fixture.probe();
    check(p.box.bottom <= p.controlsTop - 8, 'paused captions remain above the native transport and time controls');
    check(p.local && p.layer === '1', 'captions use the lowest local layer above the iframe, not a page-top layer');
    check(p.sizes[0] === '20px' && p.sizes[1] === '18px', 'normal player keeps the selected independent font sizes');
    const x = p.frame.left + p.frame.width / 2, y = p.frame.bottom - 74;
    check(document.elementFromPoint(x, y) === fixture.frame, 'pointer hit testing reaches the iframe at the seek bar');
    document.querySelector('#outside').focus();
    fixture.playback(1, true);
    await fixture.wait(() => !fixture.box().hidden && fixture.probe().gap < 60);
    check(fixture.probe().gap >= 10, 'verified idle playback returns to the normal bottom position');
    fixture.frame.dispatchEvent(new Event('pointerenter'));
    check(fixture.probe().gap >= 120, 'interaction raises an unchanged caption immediately without waiting for a new cue');
    fixture.playback(2);
    await fixture.geometry('height:532px;padding:16px;border:2px solid transparent;', 'inset:16px;width:calc(100% - 32px);height:calc(100% - 32px)');
    await fixture.wait(() => { const f = fixture.frame.getBoundingClientRect(), h = fixture.host().getBoundingClientRect(); return ['left','top','width','height'].every(k => Math.abs(f[k] - h[k]) < 1); });
    check(fixture.host().parentElement === document.querySelector('#player-container'), 'padded native containers keep the overlay local instead of falling back to body');
    await fixture.geometry('height:496px;transform:scale(.8);transform-origin:top left;', '');
    await fixture.wait(() => Math.abs(fixture.probe().gap - 128 * .8) < 1);
    check(fixture.probe().box.bottom <= fixture.probe().controlsTop - 5, 'scaled player preserves control clearance in the same coordinate space');
    await fixture.geometry('height:150px;width:320px;transform:none;', '');
    await fixture.wait(() => fixture.box().hidden);
    check(document.querySelector('.ryb-toolbar-button').dataset.active === 'true', 'small interactive player hides only the caption paint, not the saved ON preference');
    await fixture.geometry('height:496px;width:100%;', '');
    await fixture.wait(() => !fixture.box().hidden);
    p = fixture.probe();
    check(p.box.top >= p.frame.top && p.box.bottom <= p.controlsTop - 8, 'expanding restores the same caption inside the safe picture area');
    check(p.requests === 1 && p.source.includes('same English caption') && p.target.includes('测试字幕'), 'geometry and controls do not restart downloads or change caption text');
    const cover = document.createElement('div');
    cover.style.cssText = `position:fixed;left:${p.frame.left + p.frame.width / 2 - 40}px;top:${p.frame.top + p.frame.height / 2 - 40}px;width:80px;height:80px;background:white;z-index:100`;
    document.body.append(cover);
    try {
      await fixture.wait(() => fixture.host().style.display === 'none' && fixture.box().hidden);
      document.querySelector('.ryb-toolbar-button').click();
      const settings = document.querySelector('.ryb-settings-host').shadowRoot;
      const size = settings.querySelector('[name=sourceFontSize]'); size.value = '21'; size.dispatchEvent(new Event('input'));
      settings.querySelector('[aria-label="Close subtitle settings"]').click();
    } finally { cover.remove(); }
    await fixture.wait(() => fixture.host().style.display !== 'none' && !fixture.box().hidden && fixture.probe().sizes[0] === '21px');
    check(fixture.probe().box.bottom <= fixture.probe().controlsTop - 8, 'a changed caption style is remeasured after occlusion rather than reusing a hidden zero-height layout');
    await fixture.independentSurfaceChecks();
    check(true, 'plain-frame fallback and interaction-listener teardown remain bounded');
    if (keep) { window.__playerControlsFixture = fixture; return results; }
    fixture.cleanup();
    check(!document.querySelector('.ryb-surface-host,.ryb-settings-host,.ryb-toolbar-button'), 'unload removes the owned caption UI');
    return results;
  } catch (error) { error.message += JSON.stringify({ passed: Object.keys(results), geometry: fixture.probe() }); fixture.cleanup(); throw error; }
}
