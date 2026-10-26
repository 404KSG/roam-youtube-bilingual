// Run only in the owned fixture, with the real host Blueprint stylesheet.
export async function runToolbarColorAcceptance(blueprintCss) {
  if (location.pathname !== '/test-fixture' || !blueprintCss.includes('.bp3-button:not(')) throw new Error('Owned fixture and Blueprint CSS required.');
  const plugin = window.roamYouTubeBilingual;
  const keys = ['roam-youtube-bilingual/video/v1/M7lc1UVf-VE', 'roam-youtube-bilingual/video/v2/M7lc1UVf-VE'];
  const saved = keys.map(key => localStorage.getItem(key)), wasDark = document.body.classList.contains('bp3-dark');
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  const hostStyle = document.createElement('style'); hostStyle.textContent = blueprintCss; document.head.append(hostStyle);
  const reference = document.createElement('button'); reference.className = 'bp3-button bp3-minimal'; reference.setAttribute('aria-label', 'Native Blueprint color reference');
  const nativeIcon = document.createElement('span'); nativeIcon.className = 'bp3-icon bp3-icon-time'; reference.append(nativeIcon);
  document.querySelector('.rm-video-player__theater-toolbar').prepend(reference);
  const results = {}, check = (condition, name, detail) => { if (!condition) throw new Error(`${name}: ${JSON.stringify(detail)}`); results[name] = detail; };
  const color = element => getComputedStyle(element).color;
  try {
    plugin.onload();
    const button = document.querySelector('.ryb-toolbar-button'), icon = button.querySelector('.bp3-icon');
    const setEnabled = async enabled => {
      button.click(); const panel = document.querySelector('.ryb-settings-host').shadowRoot;
      const toggle = panel.querySelector('input[type=checkbox]'); toggle.checked = enabled; toggle.dispatchEvent(new Event('change'));
      await new Promise(resolve => setTimeout(resolve, 50));
      panel.querySelector('[aria-label="Close subtitle settings"]').click();
    };
    for (const theme of ['light', 'dark']) {
      document.body.classList.toggle('bp3-dark', theme === 'dark');
      check(color(icon) === color(nativeIcon), `${theme}: off matches native Blueprint gray`, { actual: color(icon), native: color(nativeIcon) });
      await setEnabled(true);
      check(color(icon) === 'rgb(35, 120, 181)', `${theme}: enabled remains blue`, color(icon));
      await setEnabled(false);
      check(color(icon) === color(nativeIcon), `${theme}: switching off restores native gray`, { actual: color(icon), native: color(nativeIcon) });
    }
    check(icon.classList.contains('bp3-icon-translate') && !button.querySelector('svg'), 'the native Blueprint translate glyph is retained', true);
    return results;
  } finally {
    plugin.onunload(); reference.remove(); hostStyle.remove(); document.body.classList.toggle('bp3-dark', wasDark);
    keys.forEach((key, index) => saved[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[index]));
  }
}
