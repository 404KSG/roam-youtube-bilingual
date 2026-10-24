// Run only on the isolated /demo page. The fixture replaces its video and uses
// synthetic, source-bound clock packets; live-player checks are separate.
export async function runBrowserRegressions() {
  const report = {};
  const assert = (condition, name) => { if (!condition) throw new Error(name); report[name] = true; };
  const wait = async (condition) => {
    const deadline = performance.now() + 5000;
    while (!condition()) { if (performance.now() > deadline) throw new Error('Browser fixture timed out'); await new Promise((resolve) => setTimeout(resolve, 20)); }
  };
  const plugin = window.roamYouTubeBilingual;
  if (!location.pathname.startsWith('/demo')) throw new Error('Use the isolated demo page, never a Roam graph.');
  plugin.onunload();
  const frame = document.querySelector('iframe');
  frame.setAttribute('sandbox', '');
  frame.src = 'https://www.youtube.com/embed/M7lc1UVf-VE?enablejsapi=1';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture frame did not load')), 5000);
    frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    frame.srcdoc = '<!doctype html><p>Isolated clock fixture</p>';
  });
  plugin.onload();
  const getButton = (text, scope = document) => [...scope.querySelectorAll('button')].find((n) => n.textContent === text);
  const clockPacket = (currentTime) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime, playerState: 2 } } }));
  const importCues = async (length) => {
    const events = Array.from({ length }, (_, id) => ({ tStartMs: id * 5000, dDurationMs: 5000, segs: [{ utf8: `Cue ${id} <T>` }] }));
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify({ events })], 'long.json3', { type: 'application/json' }));
    const input = document.querySelector('.ryb-file');
    input.files = transfer.files; input.dispatchEvent(new Event('change'));
    await wait(() => document.querySelector('.ryb-transcript summary').textContent.includes(`${length} 条`));
  };
  await importCues(5001);
  assert(document.querySelectorAll('.ryb-cue').length === 100, '5001 cues mount only 100 rows');
  assert(document.querySelector('.ryb-cue .ryb-source').textContent === 'Cue 0 <T>', 'literal angle brackets preserved');
  document.querySelector('details').open = true;
  getButton('下一页').click();
  assert(document.querySelector('.ryb-cue .ryb-source').textContent === 'Cue 100 <T>', 'pagination advances without data loss');
  clockPacket(25000);
  getButton('定位当前句').click();
  assert(document.querySelectorAll('.ryb-cue').length === 1 && document.querySelector('.ryb-cue').hasAttribute('aria-current'), 'jump-to-current reveals the last page');
  getButton('设置').click();
  document.querySelector('input[name=target]').value = 'ja';
  getButton('保存设置').click();
  await wait(() => !document.querySelector('dialog'));
  assert(document.querySelector('summary').textContent.includes('5001'), 'target language change keeps source captions');
  getButton('设置').click();
  document.querySelector('input[name=target]').value = 'fr'; getButton('关闭').click();
  await wait(() => !document.querySelector('dialog'));
  getButton('设置').click();
  assert(document.querySelector('input[name=target]').value === 'ja', 'unsaved settings are discarded');
  document.querySelector('input[name=target]').value = 'zh-CN'; getButton('保存设置').click();
  await wait(() => !document.querySelector('dialog'));
  await importCues(5); clockPacket(1);
  getButton('设置').click();
  await wait(() => document.querySelector('.ryb-overlay').hidden);
  assert(document.querySelector('.ryb-overlay').hidden, 'overlay is hidden behind settings');
  getButton('关闭').click(); await wait(() => !document.querySelector('dialog'));
  const originalFetch = window.fetch;
  let lateResolve;
  window.fetch = (url, options) => String(url).endsWith('/v1/translate') ? new Promise((resolve) => { lateResolve = () => resolve(new Response(JSON.stringify({ target: 'zh-CN', translations: JSON.parse(options.body).entries.map((entry) => ({ id: entry.id, text: 'STALE TRANSLATION' })) }))); }) : originalFetch(url, options);
  try {
    clockPacket(1); getButton('开始翻译').click();
    await wait(() => !!lateResolve);
    getButton('停止翻译').click();
    lateResolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(!document.querySelector('.ryb-panel').textContent.includes('STALE TRANSLATION'), 'canceled late responses do not repaint subtitles');
  } finally { window.fetch = originalFetch; }
  plugin.onunload();
  assert(document.querySelectorAll('.ryb-panel,.ryb-overlay,.ryb-settings,[data-ryb=style]').length === 0, 'unload cleans UI and styles');
  plugin.onload(); plugin.onload();
  assert(document.querySelectorAll('.ryb-panel').length === 1 && document.querySelectorAll('.ryb-overlay').length === 1, 'repeat load is idempotent');
  const originalSrc = frame.src;
  frame.src = 'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1';
  await wait(() => document.querySelector('.ryb-transcript summary').textContent === '字幕列表');
  assert(document.querySelectorAll('.ryb-panel').length === 1, 'video source changes replace the panel cleanly');
  frame.src = originalSrc;
  plugin.onunload();
  const module = await import('/extension.js?qa-final=1');
  module.default.onload(); module.default.onload();
  assert(document.querySelectorAll('.ryb-panel').length === 1, 'Depot ES module loads without duplicate UI');
  module.default.onunload();
  return report;
}
