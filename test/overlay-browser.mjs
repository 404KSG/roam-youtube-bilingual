// Isolated /roam-layout acceptance checks. Never run against a user's graph.
export async function inspectOverlayGeometry() {
  const frame = document.querySelector('iframe');
  const host = document.querySelector('.ryb-surface-host');
  const root = host?.shadowRoot;
  if (!frame || !root) throw new Error('In-video overlay not mounted');
  const rect = frame.getBoundingClientRect();
  const within = (node) => {
    const r = node.getBoundingClientRect();
    return r.left >= rect.left - 1 && r.top >= rect.top - 1 && r.right <= rect.right + 1 && r.bottom <= rect.bottom + 1;
  };
  const caption = root.querySelector('.ryb-captions');
  const toggle = root.querySelector('.ryb-toggle');
  const options = root.querySelector('.ryb-options');
  return {
    belowPanels: document.querySelectorAll('.ryb-panel,.ryb-transcript,.ryb-current').length,
    surfaceWithinFrame: within(host), controlsWithinFrame: within(toggle) && within(options),
    captionVisible: !caption.hidden,
    captionWithinFrame: caption.hidden || within(caption),
    source: root.querySelector('.ryb-source').textContent,
    target: root.querySelector('.ryb-target').textContent,
    label: root.querySelector('.ryb-preview-label').textContent,
  };
}

export async function runInVideoAcceptance() {
  if (location.pathname !== '/roam-layout') throw new Error('Use only the isolated native-layout fixture.');
  const report = {};
  const assert = (condition, name) => { if (!condition) throw new Error(name); report[name] = true; };
  const wait = async (condition) => {
    const deadline = performance.now() + 6000;
    while (!condition()) { if (performance.now() > deadline) throw new Error('Timed out waiting for overlay state'); await new Promise((resolve) => setTimeout(resolve, 20)); }
  };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
  const plugin = window.roamYouTubeBilingual;
  plugin.onunload();
  const frame = document.querySelector('iframe');
  const wrapper = frame.closest('.rm-video-player__spacing-wrapper');
  const before = frame.getBoundingClientRect().toJSON();
  frame.setAttribute('sandbox', '');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Clock fixture did not load')), 5000);
    frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    frame.srcdoc = '<!doctype html><p>Isolated video clock fixture</p>';
  });
  sessionStorage.setItem('roam-youtube-bilingual/session/v1', JSON.stringify({ provider: 'api', service: location.origin, token: '', source: 'en', target: 'zh-CN', fontScale: 1, bottomRatio: 0.08 }));
  const originalFetch = window.fetch;
  const calls = [];
  let holdTranslation = false, releaseLate, failProvider = false;
  window.fetch = async (url, options = {}) => {
    const path = new URL(url, location.origin).pathname;
    if (!['/health', '/v1/captions', '/v1/translate'].includes(path)) return originalFetch(url, options);
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, body });
    let data;
    if (path === '/health') data = { ok: true, service: 'roam-youtube-bilingual', apiVersion: 1, demo: true, apiConfigured: false };
    if (path === '/v1/captions') data = { videoId: body.videoId, language: body.language, demo: true, cues: Array.from({ length: 5001 }, (_, id) => ({ id, start: id * 5, end: id * 5 + 5, text: `Original ${id} <T>` })) };
    if (path === '/v1/translate') {
      if (holdTranslation) return new Promise((resolve) => { releaseLate = () => resolve(new Response(JSON.stringify({ target: body.target, translations: body.entries.map(({ id }) => ({ id, text: 'LATE RESULT' })) }))); });
      if (failProvider) return new Response(JSON.stringify({ error: '测试错误：服务未连接' }), { status: 503 });
      data = { target: body.target, demo: true, translations: body.entries.map(({ id }) => ({ id, text: `译文 ${id}` })) };
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const surface = () => document.querySelector('.ryb-surface-host');
  const root = () => surface().shadowRoot;
  const settingsRoot = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const findButton = (scope, text) => [...scope.querySelectorAll('button')].find((node) => node.textContent === text);
  const clock = (time) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: time, playerState: 2 } } }));
  try {
    plugin.onload();
    assert(!document.querySelector('.ryb-panel,.ryb-current,.ryb-transcript'), 'no below-video panel or transcript is created');
    const after = frame.getBoundingClientRect();
    assert(['x', 'y', 'width', 'height'].every((key) => Math.abs(after[key] - before[key]) < 1), 'mounting leaves native video geometry unchanged');
    assert(!document.querySelector('[data-ryb-theater]'), 'native theater layout is not modified');
    assert(surface().parentElement === frame.closest('.rm-video-player__container'), 'controls and subtitles mount inside the native player');
    assert(calls.length === 0, 'loading the extension makes no API requests');
    root().querySelector('.ryb-toggle').click();
    assert(settingsRoot()?.querySelector('dialog').open, 'explicit unconfigured API mode opens setup');
    assert(!settingsRoot().querySelector('.ryb-preview-button'), 'sample subtitle preview has been removed');
    findButton(settingsRoot(), '关闭').click();
    assert(root().querySelector('.ryb-captions').hidden && calls.length === 0, 'no fabricated subtitles or API requests before activation');
    const hostile = document.createElement('style'); hostile.textContent = 'button,input,span{color:red!important;position:fixed!important} input[type=file]{display:block!important}'; document.head.append(hostile);
    assert(getComputedStyle(root().querySelector('.ryb-toggle')).position !== 'fixed', 'Shadow DOM isolates controls from Roam and theme styles');
    hostile.remove();
    root().querySelector('.ryb-options').click();
    settingsRoot().querySelector('[name=token]').value = 'isolated-test-token';
    findButton(settingsRoot(), '保存并开启双语').click();
    await wait(() => calls.some((call) => call.path === '/v1/captions'));
    await wait(() => root().querySelector('.ryb-toggle').getAttribute('aria-busy') === 'false');
    clock(1);
    await wait(() => root().querySelector('.ryb-target').textContent === '译文 0');
    assert(root().querySelector('.ryb-source').textContent === 'Original 0 <T>', 'one action loads source, translates, and renders both lines');
    assert(root().querySelectorAll('.ryb-source,.ryb-target').length === 2 && !root().querySelector('.ryb-cue'), '5001 cues still render only two subtitle text elements');
    clock(19501);
    await wait(() => root().querySelector('.ryb-target').textContent === '译文 3900');
    assert(root().querySelector('.ryb-source').textContent === 'Original 3900 <T>', 'native seek updates source and translation together');
    root().querySelector('.ryb-options').click();
    settingsRoot().querySelector('[name=target]').value = 'ja';
    findButton(settingsRoot(), '关闭').click();
    root().querySelector('.ryb-options').click();
    assert(settingsRoot().querySelector('[name=target]').value === 'zh-CN', 'unsaved settings are discarded');
    settingsRoot().querySelector('[name=target]').value = 'ja';
    findButton(settingsRoot(), '保存并开启双语').click();
    await wait(() => calls.some((call) => call.path === '/v1/translate' && call.body.target === 'ja'));
    assert(calls.filter((call) => call.path === '/v1/captions').length === 1, 'changing target language preserves source cues');
    await wait(() => root().querySelector('.ryb-target').textContent === '译文 3900');
    holdTranslation = true; clock(20001);
    await wait(() => !!releaseLate);
    root().querySelector('.ryb-toggle').click(); releaseLate(); await pause();
    assert(root().querySelector('.ryb-captions').hidden && !root().textContent.includes('LATE RESULT'), 'stopped late responses cannot repaint the video');
    holdTranslation = false; failProvider = true;
    root().querySelector('.ryb-toggle').click();
    await wait(() => !root().querySelector('.ryb-notice').hidden && root().querySelector('.ryb-notice').textContent.includes('测试错误'));
    assert(!document.querySelector('.ryb-panel') && root().querySelector('.ryb-toggle').getAttribute('aria-pressed') === 'false', 'errors stay in-video and leave a usable retry control');
    failProvider = false;
    root().querySelector('.ryb-options').click();
    const fileInput = settingsRoot().querySelector('.ryb-file');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['WEBVTT\n\n00:00.000 --> 00:05.000\nImported &lt;T&gt;'], 'import.vtt', { type: 'text/vtt' }));
    fileInput.files = transfer.files; fileInput.dispatchEvent(new Event('change'));
    await wait(() => settingsRoot().querySelector('.ryb-setting-status').textContent.includes('已导入 1 条'));
    findButton(settingsRoot(), '保存并开启双语').click(); clock(1);
    await wait(() => root().querySelector('.ryb-target').textContent === '译文 0');
    assert(root().querySelector('.ryb-source').textContent === 'Imported <T>' && calls.filter((call) => call.path === '/v1/captions').length === 1, 'file import stays in settings and renders bilingual text in-video');
    let leakedClicks = 0;
    const catchClick = () => { leakedClicks++; };
    wrapper.addEventListener('click', catchClick);
    root().querySelector('.ryb-toggle').click();
    wrapper.removeEventListener('click', catchClick);
    assert(leakedClicks === 0, 'overlay controls do not trigger parent Roam block clicks');
    const sidebar = document.createElement('div'); sidebar.className = 'sidebar-fixture'; document.querySelector('aside').append(sidebar);
    sidebar.append(wrapper);
    await pause();
    assert(surface().parentElement.contains(frame) && document.querySelectorAll('.ryb-surface-host').length === 1, 'moving the native player retains one in-video surface');
    document.querySelector('.rm-video-theater').append(wrapper); sidebar.remove();
    plugin.onunload();
    assert(!document.querySelector('.ryb-surface-host,.ryb-settings-host,[data-ryb-fullscreen]'), 'unload removes overlays, settings, and fullscreen state');
    plugin.onload(); plugin.onload();
    assert(document.querySelectorAll('.ryb-surface-host').length === 1, 'repeated loading does not duplicate controls');
    frame.remove();
    await wait(() => !document.querySelector('.ryb-surface-host'));
    assert(!document.querySelector('.ryb-surface-host'), 'removing a video cleans up its overlay');
    return report;
  } finally { window.fetch = originalFetch; plugin.onunload(); }
}
