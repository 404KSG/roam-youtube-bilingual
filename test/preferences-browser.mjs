// Mocked, owned localhost fixture. Exercises settings through the visible UI.
export async function runPreferenceAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual, frame = document.querySelector('iframe'), originalSrc = frame.src, originalFetch = window.fetch;
  const ids = ['M7lc1UVf-VE', 'dQw4w9WgXcQ'], globalKey = 'roam-youtube-bilingual/global/v1';
  const keys = [globalKey, ...ids.flatMap(id => ['roam-youtube-bilingual/video/v1/' + id, 'roam-youtube-bilingual/video/v2/' + id])], saved = keys.map(key => localStorage.getItem(key));
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden'), results = {}, calls = [];
  const theater = document.querySelector('.rm-video-theater'), originalTheaterStyle = theater.getAttribute('style'), originalWrapperStyle = document.querySelector('.rm-video-player__spacing-wrapper').getAttribute('style');
  let extraWrapper;
  const check = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  const wait = async condition => { const end = performance.now() + 8000; while (!condition()) { if (performance.now() > end) throw new Error('Global preference fixture timed out'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const icon = () => document.querySelector('.ryb-toolbar-button');
  const dialog = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const open = async () => { icon().click(); await wait(() => dialog()?.querySelector('select').disabled === false); };
  const close = () => dialog().querySelector('[aria-label="Close subtitle settings"]').click();
  const clock = () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { currentTime: 1, playerState: 2 } } }));
  const setField = (name, value, event = 'input') => { const input = dialog().querySelector(`[name=${name}]`); input.value = value; input.dispatchEvent(new Event(event)); };
  const sourceText = () => [...document.querySelectorAll('.ryb-surface-host')].map(host => host.shadowRoot.querySelector('.ryb-source').textContent).join(' ');
  const switchVideo = async id => {
    const old = icon(); frame.src = `https://www.youtube.com/embed/${id}?enablejsapi=1`;
    await wait(() => icon() && icon() !== old);
  };
  plugin.onunload(); keys.forEach(key => localStorage.removeItem(key));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : {}; calls.push({ path, body });
    let data;
    if (path.endsWith('/health')) data = { ok: true, service: 'roam-youtube-bilingual', apiVersion: 7, provider: 'youtube-unified' };
    else if (path.endsWith('/video-info')) data = { videoId: body.videoId, title: 'Mock video', sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }, { code: 'ja' }] };
    else if (path.endsWith('/captions')) data = { videoId: body.videoId, language: body.target, sourceLanguage: 'en', captionPolicy: 'same-source-v1', cues: [{ start: 0, end: 10, text: `${body.target === 'en' ? 'English' : body.target === 'ja' ? '日本語' : '中文'} for ${body.videoId}` }] };
    else if (path.endsWith('/native-cc-state')) data = { videoId: body.videoId, state: 'off', reason: 'control', checkedAt: Date.now() };
    else throw new Error('Unexpected fixture endpoint');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    plugin.onload(); await open();
    setField('target', 'ja', 'change'); setField('sourceFontSize', '24'); setField('targetFontSize', '18');
    setField('sourceColor', '#b7ccff'); setField('targetColor', '#ffd580');
    const enabled = dialog().querySelector('input[type=checkbox]'); enabled.checked = true; enabled.dispatchEvent(new Event('change'));
    await wait(() => icon().dataset.loading === 'false'); close(); clock();
    await switchVideo(ids[1]);
    check(icon().dataset.active === 'true', 'a different video inherits the global ON choice without another toggle');
    await wait(() => calls.some(call => call.path.endsWith('/captions') && call.body.videoId === ids[1] && call.body.target === 'ja') && icon().dataset.loading === 'false');
    clock(); await wait(() => sourceText().includes(ids[1]));
    check(!sourceText().includes(ids[0]), 'a new video obtains its own captions rather than retaining the previous text');
    await open();
    check(dialog().querySelector('input[type=checkbox]').checked && dialog().querySelector('[name=target]').value === 'ja' && dialog().querySelector('[name=sourceFontSize]').value === '24' && dialog().querySelector('[name=targetFontSize]').value === '18' && dialog().querySelector('[name=sourceColor]').value === '#b7ccff' && dialog().querySelector('[name=targetColor]').value === '#ffd580', 'language, independent sizes and both colors carry across videos');
    setField('sourceFontSize', '22'); setField('targetColor', '#ffffff'); close();
    await switchVideo(ids[0]); await open();
    check(dialog().querySelector('[name=sourceFontSize]').value === '22' && dialog().querySelector('[name=targetColor]').value === '#ffffff', 'returning to an older video uses the latest global choices');
    close();
    const beforePlaylistSwitch = calls.filter(call => call.path.endsWith('/video-info') && call.body.videoId === ids[1]).length;
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'https://www.youtube.com', data: { event: 'infoDelivery', info: { videoData: { video_id: ids[1] }, currentTime: 1, playerState: 2 } } }));
    await wait(() => calls.filter(call => call.path.endsWith('/video-info') && call.body.videoId === ids[1]).length > beforePlaylistSwitch && icon().dataset.loading === 'false');
    check(icon().dataset.active === 'true', 'changing video inside the same YouTube player retains global enablement');
    await open();
    const off = dialog().querySelector('input[type=checkbox]'); off.checked = false; off.dispatchEvent(new Event('change')); close();
    const count = calls.length; await switchVideo(ids[1]); await new Promise(resolve => setTimeout(resolve, 300));
    check(icon().dataset.active === 'false' && calls.length === count, 'global OFF remains off on the next video without automatic downloads');
    plugin.onunload(); plugin.onload(); await open();
    check(!dialog().querySelector('input[type=checkbox]').checked && dialog().querySelector('[name=sourceFontSize]').value === '22', 'global settings persist after extension reload');
    const shared = { version: 1, enabled: true, target: 'zh-Hans', sourceFontSize: 20, targetFontSize: 18, sourceColor: '#ffffff', targetColor: '#ffffff' };
    localStorage.setItem(globalKey, JSON.stringify(shared)); window.dispatchEvent(new StorageEvent('storage', { key: globalKey, newValue: JSON.stringify(shared), storageArea: localStorage }));
    await wait(() => dialog().querySelector('input[type=checkbox]').checked && dialog().querySelector('[name=target]').value === 'zh-Hans');
    check(dialog().querySelector('[name=sourceFontSize]').value === '20' && dialog().querySelector('[name=sourceColor]').value === '#ffffff', 'another window updating shared settings refreshes the open controls');
    close(); await wait(() => icon().dataset.loading === 'false'); clock(); await wait(() => sourceText().includes(ids[1]));
    const wrapper = document.querySelector('.rm-video-player__spacing-wrapper');
    extraWrapper = wrapper.cloneNode(true); extraWrapper.querySelectorAll('.ryb-toolbar-button,.ryb-toolbar-fallback,.ryb-surface-host').forEach(node => node.remove());
    extraWrapper.querySelector('iframe').src = `https://www.youtube.com/embed/${ids[0]}?enablejsapi=1`;
    theater.style.display = 'flex'; theater.style.gap = '12px'; wrapper.style.width = '390px'; extraWrapper.style.width = '390px'; theater.append(extraWrapper);
    await wait(() => extraWrapper.querySelector('.ryb-toolbar-button'));
    check([...document.querySelectorAll('.ryb-toolbar-button')].every(button => button.dataset.active === 'true'), 'all mounted video controls reflect the global ON choice');
    extraWrapper.querySelector('.ryb-toolbar-button').click(); await wait(() => !dialog().querySelector('select').disabled);
    setField('sourceFontSize', '22');
    await wait(() => [...document.querySelectorAll('.ryb-surface-host')].some(host => { const row = host.shadowRoot.querySelector('.ryb-source'); return row.textContent.includes(ids[1]) && parseFloat(row.style.fontSize) === 22; }));
    check(true, 'editing style from another video updates the currently active captions');
    const allOff = dialog().querySelector('input[type=checkbox]'); allOff.checked = false; allOff.dispatchEvent(new Event('change'));
    check([...document.querySelectorAll('.ryb-toolbar-button')].every(button => button.dataset.active === 'false') && [...document.querySelectorAll('.ryb-surface-host')].every(host => host.shadowRoot.querySelector('.ryb-caption-box').hidden), 'turning global subtitles off hides every mounted caption layer');
    return results;
  } finally {
    plugin.onunload(); extraWrapper?.remove(); window.fetch = originalFetch; frame.src = originalSrc;
    if (originalTheaterStyle === null) theater.removeAttribute('style'); else theater.setAttribute('style', originalTheaterStyle);
    const wrapper = document.querySelector('.rm-video-player__spacing-wrapper'); if (originalWrapperStyle === null) wrapper.removeAttribute('style'); else wrapper.setAttribute('style', originalWrapperStyle);
    keys.forEach((key, i) => saved[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[i]));
    if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
  }
}
