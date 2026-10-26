export async function runGlobalMigrationAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, frame = document.querySelector('iframe'), originalSrc = frame.src, originalFetch = window.fetch;
  const oldVideo = 'dQw4w9WgXcQ', currentVideo = 'M7lc1UVf-VE', unsupported = 'aqz-KE-bpKQ', globalKey = 'roam-youtube-bilingual/global/v1';
  const keys = [globalKey, ...[oldVideo, currentVideo, unsupported].flatMap(id => ['roam-youtube-bilingual/video/v1/' + id, 'roam-youtube-bilingual/video/v2/' + id])], originalValues = keys.map(key => localStorage.getItem(key));
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden'), results = {};
  const check = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  const wait = async condition => { const end = performance.now() + 7000; while (!condition()) { if (performance.now() > end) throw new Error('Global migration timeout'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const icon = () => document.querySelector('.ryb-toolbar-button'), panel = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  localStorage.setItem('roam-youtube-bilingual/video/v2/' + oldVideo, JSON.stringify({ version: 2, enabled: true, target: 'ja', sourceFontSize: 24, targetFontSize: 18, sourceColor: '#b7ccff', targetColor: '#ffd580' }));
  localStorage.setItem('roam-youtube-bilingual/video/v2/' + currentVideo, JSON.stringify({ version: 2, enabled: false, target: 'zh-Hans', sourceFontSize: 20, targetFontSize: 18, sourceColor: '#ffffff', targetColor: '#ffffff' }));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = JSON.parse(options.body || '{}');
    const data = path.endsWith('/health') ? { ok: true, service: 'roam-youtube-bilingual', apiVersion: 7, provider: 'youtube-unified' }
      : path.endsWith('/video-info') ? { videoId: body.videoId, title: 'Fixture', sourceLanguage: body.videoId === unsupported ? null : 'en', languages: body.videoId === unsupported ? [] : [{ code: 'ja' }, { code: 'zh-Hans' }] }
      : path.endsWith('/captions') ? { videoId: body.videoId, sourceLanguage: 'en', captionPolicy: 'same-source-v1', language: body.target, cues: [{ start: 0, end: 10, text: 'Fixture ' + body.target }] }
      : { videoId: body.videoId, state: 'off', reason: 'control', checkedAt: Date.now() };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    plugin.onload();
    await wait(() => icon()?.dataset.active === 'true' && icon().dataset.loading === 'false');
    icon().click(); await wait(() => !panel().querySelector('select').disabled);
    check(panel().querySelector('input[type=checkbox]').checked && panel().querySelector('[name=target]').value === 'ja' && panel().querySelector('[name=sourceFontSize]').value === '24' && panel().querySelector('[name=sourceColor]').value === '#b7ccff', 'upgrading on a new OFF video inherits the previous enabled profile globally');
    panel().querySelector('[aria-label="Close subtitle settings"]').click();
    const oldIcon = icon(); frame.src = `https://www.youtube.com/embed/${unsupported}?enablejsapi=1`;
    await wait(() => icon() && icon() !== oldIcon && icon().dataset.loading === 'false');
    icon().click(); await wait(() => panel()?.querySelector('[role=status]').textContent.includes('no available English'));
    const toggle = panel().querySelector('input[type=checkbox]');
    check(toggle.checked && !toggle.disabled, 'an unsupported video does not clear global ON and cannot lock the global switch');
    toggle.checked = false; toggle.dispatchEvent(new Event('change')); panel().querySelector('[aria-label="Close subtitle settings"]').click();
    const previous = icon(); frame.src = originalSrc;
    await wait(() => icon() && icon() !== previous);
    check(icon().dataset.active === 'false', 'global OFF from an unsupported video applies to the next supported video');
    return results;
  } finally {
    plugin.onunload(); window.fetch = originalFetch; frame.src = originalSrc;
    keys.forEach((key, i) => originalValues[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, originalValues[i]));
    if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
  }
}
