// Mock-data layout/behavior tests. Only run on the agent-owned /test-fixture.
// This is not evidence of live YouTube translation or desktop bridge operation.
export async function runUnifiedAcceptance(options = {}) {
  if (location.pathname !== '/test-fixture') throw new Error('Isolated fixture only.');
  const results = {}, calls = [];
  const assert = (condition, name) => { if (!condition) throw new Error(name); results[name] = true; };
  const wait = async (condition) => {
    const limit = performance.now() + 8000;
    while (!condition()) { if (performance.now() > limit) throw new Error('Unified fixture timed out'); await new Promise((resolve) => setTimeout(resolve, 30)); }
  };
  // Simulate an active tab only in this fully local, mocked fixture. Never use
  // this override on a real Roam page or as a substitute for desktop acceptance.
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  const plugin = window.roamYouTubeBilingual;
  plugin.onunload();
  const frame = document.querySelector('iframe');
  const before = frame.getBoundingClientRect().toJSON();
  const originalFetch = window.fetch;
  const source = 'This English sentence\nwas previously wrapped onto two lines.';
  const targets = { 'zh-Hans': ['第一行中文', '第二行中文'], ja: ['日本語の字幕を', '一行にまとめます。'], fr: ['Une ligne française', 'sans retour à la ligne.'] };
  let ccState = 'off', ccReason = 'control', releaseLate, hold = false;
  sessionStorage.setItem('roam-youtube-bilingual/session/v1', JSON.stringify({ target: 'zh-Hans', fontSize: 20 }));
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, body });
    let data;
    if (path.endsWith('/health')) data = { ok: true, service: 'roam-youtube-bilingual', apiVersion: 5, provider: 'youtube-unified' };
    else if (path.endsWith('/video-info')) data = { videoId: body.videoId, title: 'Fixture video', sourceLanguage: 'en', languages: [{ code: 'en', name: 'English' }, { code: 'zh-Hans', name: 'Chinese' }, { code: 'ja', name: 'Japanese' }, { code: 'fr', name: 'French' }] };
    else if (path.endsWith('/captions')) data = { videoId: body.videoId, language: body.target, cues: [{ id: 0, start: 0, end: 100, text: body.target === 'en' ? source : (targets[body.target] || targets['zh-Hans']).join('') }] };
    else if (path.endsWith('/native-cc-state')) {
      data = { videoId: body.videoId, state: ccState, reason: ccReason };
      if (hold) return new Promise((resolve) => { releaseLate = () => resolve(new Response(JSON.stringify({ ...data, state: 'off' }))); });
    } else throw new Error('Unexpected endpoint: ' + path);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  const host = () => document.querySelector('.ryb-surface-host');
  const root = () => host().shadowRoot;
  const setting = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const done = () => [...setting().querySelectorAll('button')].find((node) => node.textContent === 'Done').click();
  const clock = (time) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: time, playerState: 2 } } }));
  let held = false;
  const cleanup = () => {
    window.fetch = originalFetch; plugin.onunload();
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor); else delete document.hidden;
    delete window.__unifiedFixtureCleanup;
  };
  try {
    plugin.onload();
    const toolbar = document.querySelector('.rm-video-player__theater-toolbar');
    const icon = document.querySelector('.ryb-toolbar-button');
    assert(icon.parentElement === toolbar && !!icon.querySelector('.bp3-icon.bp3-icon-translate') && !icon.querySelector('svg'), 'one icon is mounted in the existing native toolbar');
    assert(!root().querySelector('button') && !document.querySelector('.ryb-panel'), 'no in-video control cluster or below-video panel');
    const after = frame.getBoundingClientRect();
    assert(['x', 'y', 'width', 'height'].every((key) => Math.abs(before[key] - after[key]) < 1), 'native video geometry is unchanged');
    assert(calls.length === 0, 'no caption reads while disabled');
    icon.click();
    await wait(() => setting()?.querySelector('select').disabled === false);
    const fields = [...setting().querySelectorAll('input,select')];
    assert(fields.length === 3 && fields.some((field) => field.type === 'checkbox') && fields.some((field) => field.name === 'target') && fields.some((field) => field.name === 'fontSize'), 'settings contain only enable, language and font size');
    assert(setting().querySelector('h2').textContent === 'Bilingual subtitles' && !/[\u4e00-\u9fff]/.test(setting().querySelector('dialog').textContent), 'all settings labels and language names are English');
    assert([...setting().querySelector('select').options].map((option) => option.value).includes('ja'), 'language choices come from video metadata');
    setting().querySelector('input[type=checkbox]').checked = true;
    setting().querySelector('input[type=checkbox]').dispatchEvent(new Event('change'));
    await wait(() => icon.dataset.loading === 'false');
    clock(1);
    assert(calls.every((call) => !call.path.endsWith('native-cc-state')), 'native CC verification pauses while settings are open');
    done();
    await wait(() => !root().querySelector('.ryb-caption-box').hidden);
    const box = root().querySelector('.ryb-caption-box'), a = root().querySelector('.ryb-source'), b = root().querySelector('.ryb-target');
    assert(a.textContent === source.replace(/\n/g, ' ') && b.textContent === '第一行中文第二行中文', 'both former multiline texts are flattened without loss');
    assert(box.children.length === 2 && getComputedStyle(a).whiteSpace === 'nowrap' && getComputedStyle(b).whiteSpace === 'nowrap', 'exactly two non-wrapping rows share one container');
    assert(getComputedStyle(box).backgroundColor === 'rgb(9, 12, 16)' && getComputedStyle(a).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)', 'one opaque shared background contains both independently downloaded tracks');
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    assert(br.top - ar.bottom <= 2 && br.top >= ar.bottom, 'English and translation are separated by at most two pixels');
    assert(a.scrollWidth <= box.clientWidth - 20 && b.scrollWidth <= box.clientWidth - 20, 'long lines fit horizontally instead of becoming four lines');
    assert(box.getBoundingClientRect().bottom <= frame.getBoundingClientRect().bottom - 8, 'renderer positions its own shared box at the video bottom without masking native text');
    if (options.capture) { held = true; window.__unifiedFixtureCleanup = cleanup; return { ...results, screenshotUsesMockData: true }; }
    icon.click();
    await wait(() => setting()?.querySelector('select').disabled === false);
    setting().querySelector('[name=target]').value = 'ja'; setting().querySelector('[name=target]').dispatchEvent(new Event('change'));
    setting().querySelector('[name=fontSize]').value = '14'; setting().querySelector('[name=fontSize]').dispatchEvent(new Event('input'));
    done();
    await wait(() => b.textContent === '日本語の字幕を一行にまとめます。' && !box.hidden);
    assert(Number(box.dataset.fontSize) <= 14 && Number(box.dataset.fontSize) > 0, 'font size applies to both rows');
    assert(calls.filter((call) => call.path.endsWith('/captions')).length === 3, 'target changes reuse English but download a separate target track');
    assert(calls.filter((call) => call.path.endsWith('/captions')).some((call) => call.body.target === 'ja'), 'Japanese selection requests the actual Japanese track');
    ccState = 'unknown'; ccReason = 'controls-hidden';
    const checksBeforeHide = calls.filter(call => call.path.endsWith('native-cc-state')).length;
    await wait(() => calls.filter(call => call.path.endsWith('native-cc-state')).length >= checksBeforeHide + 3);
    assert(!box.hidden, 'verified off state survives hidden player controls while scope stays visible');
    ccReason = 'player-not-visible'; await wait(() => box.hidden);
    assert(box.hidden, 'missing player still closes the display gate');
    ccState = 'off'; ccReason = 'control'; await wait(() => !box.hidden);
    ccState = 'on'; await wait(() => box.hidden);
    assert(box.hidden, 'CC on immediately closes the render gate');
    ccState = 'off'; await wait(() => !box.hidden);
    hold = true; await wait(() => !!releaseLate);
    icon.click(); setting().querySelector('input[type=checkbox]').checked = false; setting().querySelector('input[type=checkbox]').dispatchEvent(new Event('change')); done();
    releaseLate(); await new Promise((resolve) => setTimeout(resolve, 100));
    assert(box.hidden && !root().textContent.includes('STALE RESULT'), 'off cancels late reads without displaying stale text');
    plugin.onunload();
    assert(!document.querySelector('.ryb-toolbar-button,.ryb-surface-host,.ryb-settings-host,[data-ryb-toolbar]'), 'unload removes only owned icon, overlay and styles');
    assert(toolbar.querySelectorAll('.native-icon').length === 2, 'native toolbar icons remain intact');
    plugin.onload(); plugin.onload();
    assert(document.querySelectorAll('.ryb-toolbar-button').length === 1, 'reload never duplicates the toolbar icon');
    return results;
  } catch (error) {
    error.message += JSON.stringify({ passed: Object.keys(results), lastStates: calls.filter((call) => call.path.endsWith('native-cc-state')).slice(-3).map((call) => call.body) });
    throw error;
  } finally { if (!held) cleanup(); }
}
