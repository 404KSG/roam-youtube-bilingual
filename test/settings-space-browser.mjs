export async function runSettingsSpaceAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, fixture = document.querySelector('.fixture'), frame = document.querySelector('iframe'), originalFetch = window.fetch;
  const style = fixture.getAttribute('style'), scroll = window.scrollY, keys = ['roam-youtube-bilingual/video/v1/M7lc1UVf-VE', 'roam-youtube-bilingual/video/v2/M7lc1UVf-VE'];
  const values = keys.map(key => localStorage.getItem(key));
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  window.fetch = async (_url, options = {}) => new Response(JSON.stringify({ videoId: JSON.parse(options.body || '{}').videoId, sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }] }), { headers: { 'Content-Type': 'application/json' } });
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  try {
    fixture.style.width = '640px'; fixture.style.marginTop = `${innerHeight - frame.getBoundingClientRect().height - 80}px`; window.scrollTo(0, 0);
    plugin.onload(); const before = frame.getBoundingClientRect();
    document.querySelector('.ryb-toolbar-button').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.querySelector('.ryb-settings-host').shadowRoot, panel = root.querySelector('[role=dialog]'), rect = panel.getBoundingClientRect(), video = frame.getBoundingClientRect();
    check(!!document.querySelector('.ryb-settings-spacer'), 'opening near the viewport edge should create only temporary room below the video');
    check(rect.top >= video.bottom && rect.bottom <= innerHeight - 7, 'the card should remain below the video and visible at the bottom edge');
    check(panel.scrollHeight <= panel.clientHeight + 1, 'the default compact card should not be clipped after making room');
    check(Math.abs(video.width - before.width) < 1 && Math.abs(video.height - before.height) < 1, 'making room must not resize the native player');
    root.querySelector('[aria-label="Close subtitle settings"]').click();
    check(!document.querySelector('.ryb-settings-spacer'), 'dismissal should remove its own temporary spacer');
    check(Math.abs(window.scrollY) <= 1, 'automatic scrolling should be restored when the user has not scrolled');
    return { belowVideoAtViewportEdge: true, noClipping: true, nativeDimensionsPreserved: true, temporarySpaceRemoved: true, scrollRestored: true };
  } finally {
    plugin.onunload(); window.fetch = originalFetch;
    if (style === null) fixture.removeAttribute('style'); else fixture.setAttribute('style', style);
    window.scrollTo(0, scroll);
    keys.forEach((key, i) => values[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, values[i]));
  }
}
