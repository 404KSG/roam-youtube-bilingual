export async function runDefaultSettingsAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, originalFetch = window.fetch;
  const keys = ['roam-youtube-bilingual/global/v1', 'roam-youtube-bilingual/video/v1/M7lc1UVf-VE', 'roam-youtube-bilingual/video/v2/M7lc1UVf-VE'], originals = keys.map(key => localStorage.getItem(key));
  const legacyKey = 'roam-youtube-bilingual/session/v1', legacy = sessionStorage.getItem(legacyKey);
  const root = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const wait = async condition => { const end = performance.now() + 5000; while (!condition()) { if (performance.now() > end) throw new Error('Defaults fixture timeout'); await new Promise(resolve => setTimeout(resolve, 25)); } };
  const result = {}, check = (ok, name) => { if (!ok) throw new Error(name); result[name] = true; };
  const read = name => root().querySelector(`[name=${name}]`).value;
  const open = async () => { document.querySelector('.ryb-toolbar-button').click(); await wait(() => !root().querySelector('select').disabled); };
  const close = () => root().querySelector('[aria-label="Close subtitle settings"]').click();
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  sessionStorage.setItem(legacyKey, JSON.stringify({ target: 'ja', fontSize: 12, sourceColor: '#c7cad6' }));
  window.fetch = async (_url, options = {}) => new Response(JSON.stringify({ videoId: JSON.parse(options.body || '{}').videoId, sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }, { code: 'ja' }] }), { headers: { 'Content-Type': 'application/json' } });
  try {
    plugin.onload(); await open();
    check(read('sourceFontSize') === '20' && read('targetFontSize') === '18', 'new videos use 20 px English and 18 px translation even with an old global session size');
    check(read('sourceColor') === '#ffffff' && read('targetColor') === '#ffffff', 'both default subtitle colors are white');
    check(read('target') === 'ja', 'changing appearance defaults does not discard the existing language preference');
    const font = root().querySelector('[name=sourceFontSize]'); font.value = '24'; font.dispatchEvent(new Event('input'));
    root().querySelector('[aria-label="English text color"]').click(); root().querySelector('[aria-label="English color: Blue"]').click();
    close(); await open();
    check(read('sourceFontSize') === '24' && read('sourceColor') === '#b7ccff', 'explicit global choices remain intact after reopening');
    root().querySelector('[aria-label="Reset subtitle appearance"]').click();
    await wait(() => read('sourceFontSize') === '20' && read('targetFontSize') === '18');
    check(read('sourceColor') === '#ffffff' && read('targetColor') === '#ffffff' && read('target') === 'ja', 'Reset style restores the new white 20/18 defaults without changing language');
    return result;
  } finally {
    plugin.onunload(); window.fetch = originalFetch;
    keys.forEach((key, i) => originals[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, originals[i]));
    if (legacy === null) sessionStorage.removeItem(legacyKey); else sessionStorage.setItem(legacyKey, legacy);
  }
}
