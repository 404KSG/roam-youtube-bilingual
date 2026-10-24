export async function runMountLifecycleChecks() {
  if (location.pathname !== '/roam-layout') throw new Error('Run only in the isolated Roam layout fixture.');
  const report = {};
  const assert = (condition, name) => { if (!condition) throw new Error(name); report[name] = true; };
  const wait = async (condition) => {
    const deadline = performance.now() + 5000;
    while (!condition()) { if (performance.now() > deadline) throw new Error('Mount lifecycle timed out'); await new Promise((resolve) => setTimeout(resolve, 20)); }
  };
  const plugin = window.roamYouTubeBilingual;
  const theater = document.querySelector('.rm-video-theater');
  const wrapper = document.querySelector('.rm-video-player__spacing-wrapper');
  const iframe = wrapper.querySelector('iframe');
  assert(document.querySelector('.ryb-panel').previousElementSibling === wrapper, 'panel follows entire native video component');
  assert(document.querySelector('.ryb-status').textContent.includes('设置'), 'unpaired onboarding is visible');
  assert(getComputedStyle(document.querySelector('.ryb-file')).display === 'none', 'native form selectors cannot expose the internal file input');
  const videoHeight = iframe.getBoundingClientRect().height;
  assert(videoHeight > 100, 'native video retains a positive height');
  const clone = wrapper.cloneNode(true);
  clone.querySelector('iframe').srcdoc = '<!doctype html><p>Second video fixture</p>';
  theater.append(clone);
  await wait(() => document.querySelectorAll('.ryb-panel').length === 2);
  assert(theater.getAttribute('data-ryb-theater') === 'managed', 'multiple video panels share theater ownership');
  clone.remove();
  await wait(() => document.querySelectorAll('.ryb-panel').length === 1);
  assert(theater.getAttribute('data-ryb-theater') === 'managed', 'removing one video preserves the remaining theater owner');
  const sidebar = document.createElement('div'); sidebar.className = 'sidebar-fixture'; document.querySelector('aside').append(sidebar);
  const panelBeforeMove = document.querySelector('.ryb-panel');
  sidebar.append(wrapper);
  await wait(() => panelBeforeMove.parentElement === sidebar);
  assert(panelBeforeMove === document.querySelector('.ryb-panel') && panelBeforeMove.previousElementSibling === wrapper, 'moving to sidebar remounts existing panel without duplicate state');
  assert(!theater.hasAttribute('data-ryb-theater'), 'leaving theater restores its ownership marker');
  await wait(() => Math.abs(panelBeforeMove.getBoundingClientRect().width - wrapper.getBoundingClientRect().width) < 2);
  assert(panelBeforeMove.getBoundingClientRect().width <= 332, 'sidebar panel follows video width');
  theater.append(wrapper);
  await wait(() => panelBeforeMove.parentElement === theater);
  sidebar.remove();
  assert(Math.abs(iframe.getBoundingClientRect().height - videoHeight) < 2, 'theater return preserves video dimensions');
  plugin.onunload();
  assert(!theater.hasAttribute('data-ryb-theater') && !document.querySelector('.ryb-panel'), 'unload restores native theater layout');
  theater.setAttribute('data-ryb-theater', 'preexisting-value');
  plugin.onload(); plugin.onunload();
  assert(theater.getAttribute('data-ryb-theater') === 'preexisting-value', 'preexisting attributes are restored exactly');
  theater.removeAttribute('data-ryb-theater');
  plugin.onload();
  const buttons = [...document.querySelectorAll('.ryb-panel button')];
  buttons.find((button) => button.textContent === '获取字幕').click();
  await wait(() => document.querySelector('.ryb-status').textContent.includes('配对码'));
  assert(document.querySelector('.ryb-status').textContent.includes('设置'), 'missing-service error explains setup rather than silently failing');
  return report;
}

export async function inspectRoamLayout() {
  const panel = document.querySelector('.ryb-panel');
  const frame = document.querySelector('iframe.rm-video-player');
  if (!panel || !frame) throw new Error('Roam layout fixture did not load.');
  const frameRect = frame.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const controls = [...panel.querySelectorAll('.ryb-toolbar button,.ryb-actions button')].filter((node) => !node.closest('details'));
  const hitTests = controls.map((node) => {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { text: node.textContent, reachable: hit === node || node.contains(hit), x: rect.x, y: rect.y };
  });
  return {
    insideClippingContainer: !!panel.closest('.rm-video-player__container,.rm-iframe__container'),
    videoBottom: frameRect.bottom,
    panelTop: panelRect.top,
    belowVideo: panelRect.top >= frameRect.bottom,
    controls: hitTests,
    pass: !panel.closest('.rm-video-player__container,.rm-iframe__container') && panelRect.top >= frameRect.bottom && hitTests.every((test) => test.reachable),
  };
}
