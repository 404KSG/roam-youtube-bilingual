// Only mocked, agent-owned localhost fixtures. Never run on a real Roam page.
export async function runPreferenceAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, frame = document.querySelector('iframe');
  const originalSrc = frame.src, originalFetch = window.fetch;
  const ids = ['M7lc1UVf-VE', 'dQw4w9WgXcQ'];
  const keys = ids.map(id => 'roam-youtube-bilingual/video/v1/' + id);
  const saved = keys.map(key => localStorage.getItem(key));
  const legacyKey = 'roam-youtube-bilingual/session/v1', legacy = sessionStorage.getItem(legacyKey);
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  const results = {}, calls = [];
  const assert = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  const wait = async condition => { const end = performance.now() + 7000; while (!condition()) { if (performance.now() > end) throw new Error('Preference fixture timed out'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const icon = () => document.querySelector('.ryb-toolbar-button');
  const dialog = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const open = async () => { icon().click(); await wait(() => dialog()?.querySelector('select').disabled === false); };
  const close = () => [...dialog().querySelectorAll('button')].find(button => button.textContent === 'Done').click();
  const clock = () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: 1, playerState: 2 } } }));
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  sessionStorage.setItem(legacyKey, JSON.stringify({ target: 'zh-Hans', fontSize: 20 }));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : {}; calls.push({ path, body });
    let data;
    if (path.endsWith('/health')) data = { ok: true, service: 'roam-youtube-bilingual', apiVersion: 6, provider: 'youtube-unified' };
    else if (path.endsWith('/video-info')) data = { videoId: body.videoId, title: 'Mock video', sourceLanguage: 'en', languages: [{ code: 'zh-Hans', name: 'Chinese' }, { code: 'ja', name: 'Japanese' }] };
    else if (path.endsWith('/captions')) data = { videoId: body.videoId, language: body.target, cues: [{ id: 0, start: 0, end: 10, text: body.target === 'en' ? 'English fixture' : body.target === 'ja' ? '日本語の例' : '中文示例' }] };
    else if (path.endsWith('/native-cc-state')) data = { videoId: body.videoId, state: 'off', reason: 'control', checkedAt: Date.now() };
    else throw new Error('Unexpected endpoint');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    plugin.onload(); await open();
    dialog().querySelector('[name=target]').value = 'ja'; dialog().querySelector('[name=target]').dispatchEvent(new Event('change'));
    dialog().querySelector('[name=fontSize]').value = '24'; dialog().querySelector('[name=fontSize]').dispatchEvent(new Event('input'));
    const enabled = dialog().querySelector('input[type=checkbox]'); enabled.checked = true; enabled.dispatchEvent(new Event('change'));
    await wait(() => icon().dataset.loading === 'false'); clock(); close();
    plugin.onunload(); plugin.onload();
    await wait(() => icon()?.dataset.active === 'true' && icon().dataset.loading === 'false');
    await open();
    assert(dialog().querySelector('input[type=checkbox]').checked && dialog().querySelector('[name=target]').value === 'ja' && dialog().querySelector('[name=fontSize]').value === '24', 'reopening a video restores enablement, language and font size'); close();
    frame.src = 'https://www.youtube.com/embed/' + ids[1] + '?enablejsapi=1';
    await wait(() => icon()?.dataset.active === 'false'); await open();
    assert(!dialog().querySelector('input[type=checkbox]').checked && dialog().querySelector('[name=target]').value === 'zh-Hans', 'a different video does not inherit another video\'s enabled state or language'); close();
    frame.src = originalSrc;
    await wait(() => icon()?.dataset.active === 'true' && icon().dataset.loading === 'false'); await open();
    assert(dialog().querySelector('[name=target]').value === 'ja' && dialog().querySelector('[name=fontSize]').value === '24', 'returning to the first video restores its own settings');
    const off = dialog().querySelector('input[type=checkbox]'); off.checked = false; off.dispatchEvent(new Event('change')); close();
    plugin.onunload(); const count = calls.length; plugin.onload();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert(icon().dataset.active === 'false' && calls.length === count, 'an explicitly disabled video stays disabled after reload without requests');
    return results;
  } finally {
    plugin.onunload(); window.fetch = originalFetch; frame.src = originalSrc;
    keys.forEach((key, index) => saved[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[index]));
    if (legacy === null) sessionStorage.removeItem(legacyKey); else sessionStorage.setItem(legacyKey, legacy);
    if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
  }
}
