// Controlled transport assertions only. Real Chinese rendering is separately
// verified in YouTube's own iframe, not simulated by this fixture.
export async function runNativeModeAcceptance() {
  if (location.pathname !== '/roam-layout') throw new Error('Use only the isolated fixture.');
  const results = {}, calls = [];
  const assert = (value, name) => { if (!value) throw new Error(name); results[name] = true; };
  const wait = async (condition) => {
    const until = performance.now() + 6000;
    while (!condition()) { if (performance.now() > until) throw new Error('Native-mode fixture timed out'); await new Promise((resolve) => setTimeout(resolve, 20)); }
  };
  const plugin = window.roamYouTubeBilingual;
  plugin.onunload();
  const frame = document.querySelector('iframe'); frame.setAttribute('sandbox', '');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Frame failed to load')), 5000);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    frame.srcdoc = '<!doctype html><p>Isolated clock fixture</p>';
  });
  // Old API-era settings with no provider must migrate to key-free YouTube mode.
  sessionStorage.setItem('roam-youtube-bilingual/session/v1', JSON.stringify({ service: location.origin, token: '', source: 'en', target: 'zh-CN', fontScale: 1, bottomRatio: 0.08 }));
  const originalFetch = window.fetch;
  let offline = false;
  window.fetch = async (url, options = {}) => {
    const path = new URL(url, location.origin).pathname;
    calls.push({ path, auth: options.headers?.Authorization, body: options.body ? JSON.parse(options.body) : null });
    if (offline) return new Response(JSON.stringify({ error: '本机原字幕服务未启动' }), { status: 503 });
    if (path === '/v1/youtube/health') return new Response(JSON.stringify({ ok: true, service: 'roam-youtube-bilingual', apiVersion: 1, provider: 'youtube-native', demo: false, tokenRequired: false }));
    if (path === '/v1/youtube/captions') {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ videoId: body.videoId, language: body.language, demo: false, source: 'youtube', cues: [{ id: 0, start: 0, end: 5, text: 'Genuine source fixture' }, { id: 1, start: 5, end: 10, text: 'Second source fixture' }] }));
    }
    throw new Error('Forbidden AI request in native mode: ' + path);
  };
  const host = () => document.querySelector('.ryb-surface-host');
  const root = () => host().shadowRoot;
  const settings = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const button = (scope, text) => [...scope.querySelectorAll('button')].find((node) => node.textContent === text);
  const clock = (time) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: time, playerState: 2 } } }));
  try {
    plugin.onload();
    assert(host().dataset.provider === 'youtube', 'old settings migrate to YouTube mode');
    assert(calls.length === 0, 'no network calls merely on load');
    root().querySelector('.ryb-toggle').click();
    await wait(() => root().querySelector('.ryb-toggle').getAttribute('aria-busy') === 'false');
    clock(1);
    await wait(() => root().querySelector('.ryb-source').textContent === 'Genuine source fixture');
    assert(!document.querySelector('.ryb-settings-host'), 'one click works without a pairing or API dialog');
    assert(calls.every((call) => call.path.startsWith('/v1/youtube/') && !call.auth), 'native flow uses only unauthenticated read-only YouTube routes');
    assert(root().querySelector('.ryb-target').textContent === '' && root().querySelector('.ryb-preview-label').textContent === '', 'plugin invents no translated or preview text; YouTube owns Chinese');
    clock(6);
    assert(root().querySelector('.ryb-source').textContent === 'Second source fixture', 'English follows native playback time');
    root().querySelector('.ryb-options').click();
    assert(settings().querySelector('[name=provider]').value === 'youtube' && settings().querySelector('.ryb-api-config').hidden, 'native settings hide API credentials');
    assert(settings().querySelector('[name=bottomRatio]').value === '0.18', 'legacy subtitle position is migrated above native captions');
    assert(!settings().querySelector('.ryb-preview-button'), 'no sample-preview entry point remains');
    const transfer = new DataTransfer(); transfer.items.add(new File(['WEBVTT\n\n00:00.000 --> 00:10.000\nImported original'], 'original.vtt'));
    const input = settings().querySelector('.ryb-file'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
    await wait(() => settings().querySelector('.ryb-setting-status').textContent.includes('已导入 1 条'));
    offline = true; const count = calls.length;
    button(settings(), '保存并开启双语').click(); clock(1);
    await wait(() => !root().querySelector('.ryb-captions').hidden);
    assert(calls.length === count && root().querySelector('.ryb-source').textContent === 'Imported original', 'imported original works in native mode without a running helper');
    root().querySelector('.ryb-toggle').click();
    assert(root().querySelector('.ryb-captions').hidden, 'off removes only the plugin English layer');
    root().querySelector('.ryb-options').click(); settings().querySelector('[name=source]').value = 'fr';
    button(settings(), '保存并开启双语').click();
    await wait(() => root().querySelector('.ryb-notice').textContent.includes('本机原字幕服务未启动'));
    assert(calls.every((call) => call.path.startsWith('/v1/youtube/')), 'helper failure never falls back to a paid translator');
    assert(!document.querySelector('.ryb-panel'), 'all controls and English remain in-video');
    return results;
  } finally { window.fetch = originalFetch; plugin.onunload(); }
}
