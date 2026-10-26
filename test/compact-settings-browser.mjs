export async function runCompactSettingsAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, oldFetch = window.fetch, fixture = document.querySelector('.fixture'), frame = document.querySelector('iframe');
  const oldWidth = fixture.style.width;
  const keys = ['roam-youtube-bilingual/video/v1/M7lc1UVf-VE', 'roam-youtube-bilingual/video/v2/M7lc1UVf-VE'], oldValues = keys.map(key => localStorage.getItem(key));
  const results = {}, check = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  const root = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const wait = async condition => { const end = performance.now() + 5000; while (!condition()) { if (performance.now() > end) throw new Error('Compact settings timeout'); await new Promise(resolve => setTimeout(resolve, 25)); } };
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key)); fixture.style.width = '640px';
  window.fetch = async (_url, options = {}) => { const body = JSON.parse(options.body || '{}'); return new Response(JSON.stringify({ videoId: body.videoId, sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }, { code: 'ja' }] }), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    plugin.onload(); const original = frame.getBoundingClientRect();
    document.querySelector('.ryb-toolbar-button').click(); await wait(() => !root().querySelector('select').disabled);
    const panel = root().querySelector('[role=dialog]'), bounds = panel.getBoundingClientRect(), video = frame.getBoundingClientRect();
    check(bounds.width <= 273 && panel.scrollHeight <= 230, 'the default settings card is compact rather than a tall control panel');
    check(getComputedStyle(panel).outlineStyle === 'none', 'programmatic dialog focus does not add a large browser-blue frame');
    check(bounds.top >= video.bottom && bounds.left >= video.left - 1 && bounds.right <= video.right + 1, 'the card stays underneath and inside the video column');
    check(Math.abs(original.width - video.width) < 1 && Math.abs(original.height - video.height) < 1, 'opening settings preserves native video dimensions');
    check([...root().querySelectorAll('.ryb-colors')].every(group => group.hidden), 'color palettes stay collapsed by default');
    check(root().querySelector('.ryb-heading').contains(root().querySelector('input[type=checkbox]')), 'the enable switch shares the compact heading');
    root().querySelector('button[aria-label="English text color"]').click();
    check(!root().querySelector('[name=sourceColor]').parentElement.hidden, 'English colors expand on demand');
    root().querySelector('button[aria-label="Translation text color"]').click();
    check(root().querySelector('[name=sourceColor]').parentElement.hidden && !root().querySelector('[name=targetColor]').parentElement.hidden, 'only the selected language color palette is expanded');
    root().querySelector('[aria-label="Translation color: Gold"]').click();
    root().querySelector('[name=sourceFontSize]').value = '14'; root().querySelector('[name=sourceFontSize]').dispatchEvent(new Event('input'));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    check(!root() && !document.querySelector('.ryb-settings-spacer'), 'outside dismissal removes the card and any temporary layout space');
    document.querySelector('.ryb-toolbar-button').click(); await wait(() => !root().querySelector('select').disabled);
    check(root().querySelector('[name=sourceFontSize]').value === '14' && root().querySelector('[name=targetColor]').value === '#ffd580', 'compact controls still save independent appearance choices');
    check([...root().querySelectorAll('.ryb-colors')].every(group => group.hidden), 'reopening starts compact without losing saved colors');
    return results;
  } finally {
    plugin.onunload(); window.fetch = oldFetch; fixture.style.width = oldWidth;
    keys.forEach((key, i) => oldValues[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, oldValues[i]));
  }
}
