export async function runAppearanceAcceptance({ apiVersion = 7 } = {}) {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, originalFetch = window.fetch, frame = document.querySelector('iframe');
  const keys = ['roam-youtube-bilingual/video/v1/M7lc1UVf-VE', 'roam-youtube-bilingual/video/v2/M7lc1UVf-VE'];
  const before = keys.map(key => localStorage.getItem(key)), hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  const originalWidth = document.querySelector('.fixture').style.width;
  const results = {}, check = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  const wait = async condition => { const end = performance.now() + 7000; while (!condition()) { if (performance.now() > end) throw new Error('Appearance fixture timed out'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const settings = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const root = () => document.querySelector('.ryb-surface-host')?.shadowRoot;
  const icon = () => document.querySelector('.ryb-toolbar-button');
  const text = 'This longer English caption should wrap naturally, keeping the selected font readable while the translation uses its own size and color.';
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.querySelector('.fixture').style.width = '630px';
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : {};
    let data;
    if (path.endsWith('/health')) data = { ok: true, service: 'roam-youtube-bilingual', apiVersion, provider: 'youtube-unified' };
    else if (path.endsWith('/video-info')) data = { videoId: body.videoId, sourceLanguage: 'en', title: 'Mock', languages: [{ code: 'zh-Hans' }, { code: 'ja' }] };
    else if (path.endsWith('/captions')) data = { videoId: body.videoId, language: body.target, sourceLanguage: 'en', captionPolicy: 'same-source-v1', cues: [{ start: 0, end: 10, text: body.target === 'en' ? text : '这是一段较长的字幕，用于验证自然换行、中英独立字号与颜色。文字不应被截断，也不应为了保持单行而一起缩小。' }] };
    else if (path.endsWith('/native-cc-state')) data = { videoId: body.videoId, state: 'off', reason: 'control', checkedAt: Date.now() };
    else throw new Error('Unexpected fixture request');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    plugin.onload(); icon().click(); await wait(() => !settings().querySelector('select').disabled);
    const toggle = settings().querySelector('input[type=checkbox]'); toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    await wait(() => icon().dataset.loading === 'false');
    const close = settings().querySelector('[aria-label="Close subtitle settings"]') || [...settings().querySelectorAll('button')].find(button => button.textContent === 'Done'); close.click();
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: 1, playerState: 2 } } }));
    await wait(() => !root().querySelector('.ryb-caption-box').hidden);
    const english = root().querySelector('.ryb-source'), translated = root().querySelector('.ryb-target');
    check(getComputedStyle(english).whiteSpace === 'normal' && getComputedStyle(translated).whiteSpace === 'normal', 'long captions can wrap instead of requiring a single line');
    icon().click(); await wait(() => !settings().querySelector('select').disabled);
    for (const [name, value] of [['sourceFontSize', '14'], ['targetFontSize', '22'], ['sourceColor', '#b7ccff'], ['targetColor', '#ffd580']]) {
      const input = settings().querySelector(`[name=${name}]`); input.value = value; input.dispatchEvent(new Event('input'));
    }
    await wait(() => getComputedStyle(translated).color === 'rgb(255, 213, 128)');
    check(!root().querySelector('.ryb-caption-box').hidden, 'style controls update live without hiding the captions');
    check(getComputedStyle(english).color === 'rgb(183, 204, 255)', 'English color changes independently');
    check(parseFloat(getComputedStyle(english).fontSize) <= 14 && parseFloat(getComputedStyle(translated).fontSize) > parseFloat(getComputedStyle(english).fontSize), 'translation can remain larger than English');
    check(![...settings().querySelectorAll('button')].some(button => button.textContent === 'Done'), 'the popover has no Done button');
    for (const row of [english, translated]) {
      const style = getComputedStyle(row), lines = row.getBoundingClientRect().height / parseFloat(style.lineHeight);
      check(lines <= 2.05 && row.scrollWidth <= row.clientWidth + 1, row === english ? 'English uses at most two unclipped lines' : 'translation uses at most two unclipped lines');
    }
    check(english.textContent === text, 'wrapping preserves the complete source text');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    check(!settings(), 'outside click closes the appearance controls');
    return results;
  } finally {
    plugin.onunload(); window.fetch = originalFetch;
    keys.forEach((key, i) => before[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, before[i]));
    document.querySelector('.fixture').style.width = originalWidth;
    if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
  }
}
