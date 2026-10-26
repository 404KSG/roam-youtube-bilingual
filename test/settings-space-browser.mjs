// Reproduce a fixed-height Roam pane: adding space cannot move its video.
export async function runSettingsSpaceAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, fixture = document.querySelector('.fixture'), frame = document.querySelector('iframe'), originalFetch = window.fetch;
  const style = fixture.getAttribute('style'), bodyStyle = document.body.getAttribute('style'), scroll = window.scrollY;
  const keys = ['roam-youtube-bilingual/video/v1/M7lc1UVf-VE', 'roam-youtube-bilingual/video/v2/M7lc1UVf-VE'], values = keys.map(key => localStorage.getItem(key));
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  window.fetch = async (_url, options = {}) => new Response(JSON.stringify({ videoId: JSON.parse(options.body || '{}').videoId, sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }] }), { headers: { 'Content-Type': 'application/json' } });
  const results = {}, check = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  const wait = async condition => { const end = performance.now() + 5000; while (!condition()) { if (performance.now() > end) throw new Error('Adaptive position timeout'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  try {
    document.body.style.height = '100vh'; document.body.style.overflow = 'hidden';
    Object.assign(fixture.style, { position: 'fixed', left: '32px', width: '640px', margin: '0' });
    fixture.style.top = `${innerHeight - frame.getBoundingClientRect().height - 90}px`; window.scrollTo(0, 0);
    plugin.onload(); const before = frame.getBoundingClientRect(), originalTop = fixture.style.top;
    document.querySelector('.ryb-toolbar-button').click();
    const root = document.querySelector('.ryb-settings-host').shadowRoot, panel = root.querySelector('[role=dialog]');
    await wait(() => !root.querySelector('select').disabled);
    let rect = panel.getBoundingClientRect();
    check(rect.top >= 8 && rect.bottom <= innerHeight - 7 && panel.scrollHeight <= panel.clientHeight + 1, 'a fixed bottom-edge pane shows the complete card instead of a clipped strip');
    check(panel.dataset.placement === 'above-trigger', 'insufficient bottom space flips the card upward');
    check(!document.querySelector('.ryb-settings-spacer') && window.scrollY === 0 && fixture.style.top === originalTop, 'opening does not add blank space or force page scrolling');
    const video = frame.getBoundingClientRect();
    check(Math.abs(video.width - before.width) < 1 && Math.abs(video.height - before.height) < 1, 'adaptive placement does not resize the native video');
    fixture.style.top = '20px';
    await wait(() => panel.dataset.placement === 'below-video');
    check(panel.getBoundingClientRect().top >= frame.getBoundingClientRect().bottom, 'layout movement returns the card below the video when space becomes available');
    const button = document.querySelector('.ryb-toolbar-button'), targetBottom = innerHeight - 22 - panel.offsetHeight;
    fixture.style.top = `${parseFloat(fixture.style.top) + targetBottom - button.getBoundingClientRect().bottom}px`;
    await wait(() => panel.dataset.placement === 'below-video' && Math.abs(button.getBoundingClientRect().bottom - targetBottom) < 1);
    root.querySelector('[aria-label="English text color"]').click();
    await wait(() => panel.dataset.placement === 'above-trigger');
    check(panel.scrollHeight <= panel.clientHeight + 1, 'expanding a color palette repositions the whole card rather than clipping controls');
    fixture.style.width = '420px';
    await wait(() => panel.dataset.placement === 'below-video' && panel.getBoundingClientRect().right <= frame.getBoundingClientRect().right + 1);
    check(true, 'sidebar-sized video changes update the card position without a window resize');
    root.querySelector('[aria-label="Close subtitle settings"]').click();
    check(!document.querySelector('.ryb-settings-host,.ryb-settings-spacer') && window.scrollY === 0, 'dismissal leaves no layout changes or scrolling behind');
    return results;
  } finally {
    plugin.onunload(); window.fetch = originalFetch;
    if (style === null) fixture.removeAttribute('style'); else fixture.setAttribute('style', style);
    if (bodyStyle === null) document.body.removeAttribute('style'); else document.body.setAttribute('style', bodyStyle);
    window.scrollTo(0, scroll);
    keys.forEach((key, i) => values[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, values[i]));
  }
}
