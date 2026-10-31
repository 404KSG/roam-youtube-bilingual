import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCcState, inspectNativeCc, createCaptionReader, createPeerVerifier } from '../server/caption-reader.mjs';
import { sanitizeVideoInfo } from '../server/video-info.mjs';
import { fixtureMetadata } from './caption-fixtures.mjs';
const frame = { x: 100, y: 100, width: 800, height: 450 };
const node = (id, parent, role, text, box) => ({ element_index: id, parent_index: parent, role, label: text, value: text, frame: box });
function fixture(label = 'Subtitles/CC turned off') {
  return { elements: [
    node(0, undefined, 'AXWindow', 'PRIVATE GRAPH TITLE', { x: 0, y: 0, w: 1200, h: 900 }),
    node(1, 0, 'AXWebArea', 'Private Roam graph', { x: 0, y: 0, w: 1200, h: 900 }),
    node(2, 1, 'AXWebArea', 'Test video - YouTube', { x: 100, y: 100, w: 800, h: 450 }),
    node(3, 2, 'AXCheckBox', label, { x: 820, y: 500, w: 30, h: 30 }),
    node(4, 1, 'AXCheckBox', 'Subtitles/CC turned off', { x: 20, y: 20, w: 30, h: 30 }),
    node(5, 1, 'AXStaticText', 'PRIVATE NOTE MUST NEVER LEAVE', { x: 350, y: 490, w: 300, h: 24 }),
  ] };
}
test('native CC state accepts only the explicit new YouTube labels for the exact visible player', () => {
  assert.equal(nativeCcState(fixture('Subtitles/CC turned on'), { title: 'Test video', frame }), 'on');
  assert.equal(nativeCcState(fixture('Subtitles/CC turned off'), { title: 'Test video', frame }), 'off');
  assert.equal(nativeCcState(fixture('Subtitles/CC'), { title: 'Test video', frame }), 'unknown');
  assert.equal(nativeCcState(fixture(), { title: 'Other video', frame }), 'unknown');
  assert.equal(nativeCcState({ elements: fixture().elements.filter((entry) => entry.role !== 'AXCheckBox') }, { title: 'Test video', frame }), 'unknown');
});
test('a Roam checkbox overlapping the video cannot falsely confirm native CC off', () => {
  const snapshot = fixture('Subtitles/CC turned on');
  snapshot.elements.unshift(node(99, 1, 'AXCheckBox', 'Subtitles/CC turned off', { x: 820, y: 500, w: 30, h: 30 }));
  assert.equal(nativeCcState(snapshot, { title: 'Test video', frame }), 'on');
});
test('hidden controls and a missing player are distinct; native caption nodes prove on', () => {
  const snapshot = fixture(); snapshot.elements = snapshot.elements.filter(entry => entry.element_index !== 3);
  assert.deepEqual(inspectNativeCc(snapshot, { title: 'Test video', frame }), { state: 'unknown', reason: 'controls-hidden', controlsVisible: false });
  assert.deepEqual(inspectNativeCc(snapshot, { title: 'Other video', frame }), { state: 'unknown', reason: 'player-not-visible' });
  snapshot.elements.push(node(7, 2, 'AXStaticText', 'Native caption content', { x: 350, y: 480, w: 300, h: 24 }));
  assert.deepEqual(inspectNativeCc(snapshot, { title: 'Test video', frame }), { state: 'on', reason: 'native-caption-visible', controlsVisible: false });
});
test('visible playback chrome without a CC checkbox cannot turn centered pause text into CC-on evidence', () => {
  const snapshot = fixture(); snapshot.elements = snapshot.elements.filter(entry => entry.element_index !== 3);
  snapshot.elements.push(node(7, 2, 'AXButton', 'Play', { x: 120, y: 500, w: 32, h: 32 }));
  snapshot.elements.push(node(8, 2, 'AXStaticText', 'Chapter title', { x: 350, y: 480, w: 300, h: 24 }));
  assert.deepEqual(inspectNativeCc(snapshot, { title: 'Test video', frame }), { state: 'unknown', reason: 'controls-visible', controlsVisible: true });
});
test('only visible playback chrome with centered static text is controls-visible', () => {
  const base = fixture().elements.filter(entry => entry.element_index !== 3);
  for (const [chrome, visible] of [
    [node(7, 2, 'AXButton', 'Play', { x: 120, y: 500, w: 0, h: 0 }), false],
    [node(7, 2, 'AXButton', 'Play', { x: 120, y: 500, w: 32, h: 32 }), true],
    [{ ...node(7, 2, 'AXButton', 'Play', { x: 120, y: 500, w: 32, h: 32 }), hidden: true }, false],
    [node(7, 2, 'AXButton', 'Play', { x: 2000, y: 500, w: 32, h: 32 }), false],
  ]) {
    const snapshot = { elements: [...base, chrome] };
    assert.deepEqual(inspectNativeCc(snapshot, { title: 'Test video', frame }), { state: 'unknown', reason: 'controls-hidden', controlsVisible: visible });
    snapshot.elements.push(node(8, 2, 'AXStaticText', 'Chapter title', { x: 350, y: 480, w: 300, h: 24 }));
    assert.deepEqual(inspectNativeCc(snapshot, { title: 'Test video', frame }), visible ? { state: 'unknown', reason: 'controls-visible', controlsVisible: true } : { state: 'on', reason: 'native-caption-visible', controlsVisible: false });
  }
});
test('player-control visibility is independent of the CC evidence reason', () => {
  const scope = { title: 'Test video', frame };
  assert.equal(inspectNativeCc(fixture(), scope).controlsVisible, true);
  const snapshot = fixture(); snapshot.elements = snapshot.elements.filter(entry => entry.element_index !== 3);
  assert.equal(inspectNativeCc(snapshot, scope).controlsVisible, false);
  snapshot.elements.push(node(7, 2, 'AXSlider', 'Playback position', { x: 120, y: 490, w: 730, h: 20 }));
  const visible = inspectNativeCc(snapshot, scope);
  assert.equal(visible.reason, 'controls-hidden', 'legacy CC evidence remains distinct from transport visibility');
  assert.equal(visible.controlsVisible, true, 'a visible transport cannot be treated as hidden just because CC is missing');
  assert.equal(inspectNativeCc(snapshot, { title: 'Other video', frame }).controlsVisible, undefined);
});
test('hidden CC controls do not establish visible chrome or an explicit OFF observation', () => {
  const snapshot = fixture(); snapshot.elements.find(e => e.element_index === 3).hidden = true;
  const result = inspectNativeCc(snapshot, { title: 'Test video', frame });
  assert.equal(result.state, 'unknown'); assert.equal(result.controlsVisible, false);
});
test('video metadata uses the supplied language list and removes raw URLs', () => {
  const raw = fixtureMetadata(); raw.subtitles.en[0].url += '&signature=secret-not-returned';
  const info = sanitizeVideoInfo(raw, 'vif8NQcjVf0');
  assert.equal(info.sourceLanguage, 'en');
  assert.ok(info.languages.some((item) => item.code === 'ja'));
  assert.ok(!info.languages.some((item) => item.code.endsWith('-orig') || item.code.endsWith('-en')));
  assert.equal(JSON.stringify(info).includes('secret'), false);
  assert.throws(() => sanitizeVideoInfo({ id: 'other', title: 'Bad' }, 'vif8NQcjVf0'));
});
test('metadata distinguishes prepared auto-translations from uploaded captions', () => {
  const raw = fixtureMetadata();
  raw.subtitles.ja = [{ ext: 'json3', name: 'Japanese', url: 'https://www.youtube.com/api/timedtext?lang=ja' }];
  const metadata = sanitizeVideoInfo(raw, 'vif8NQcjVf0');
  assert.equal(metadata.languages.find(item => item.code === 'zh-Hans').autoTranslated, true);
  assert.equal(metadata.languages.find(item => item.code === 'ja').autoTranslated, false);
});
test('peer check authenticates the client UID, not the server side of a socket', async () => {
  let calls = 0; const socket = { remoteAddress: '127.0.0.1', remotePort: 50001 };
  const verify = createPeerVerifier({ platform: 'darwin', uid: 501, exec: async (path) => { calls++; return { stdout: path.endsWith('lsof') ? 'p10\nu501\nn127.0.0.1:50001->127.0.0.1:17321\n' : '/Applications/Roam Research.app/Contents/Frameworks/Roam Research Helper' }; } });
  await verify(socket, 17321); await verify(socket, 17321); assert.equal(calls, 2);
  const wrong = createPeerVerifier({ platform: 'darwin', uid: 501, exec: async () => ({ stdout: 'p10\nu502\nn127.0.0.1:50001->127.0.0.1:17321\np20\nu501\nn127.0.0.1:17321->127.0.0.1:50001\n' }) });
  await assert.rejects(wrong(socket, 17321), (error) => error.status === 403);
});
test('read bridge reuses the verified Roam process and timestamps the actual snapshot', async () => {
  const calls = []; let now = 1000;
  const exec = async (_path, args, options) => {
    calls.push(args); assert.equal(options.env?.OPENAI_API_KEY, undefined);
    let result;
    if (_path === '/bin/ps') return { stdout: '/Applications/Roam Research.app/Contents/MacOS/Roam Research' };
    if (args[0] === 'permissions') result = { accessibility: true, source: { attribution: 'driver-daemon' } };
    else if (args[1] === 'get_recording_state') result = { enabled: false, recording: false };
    else if (args[1] === 'list_apps') result = { apps: [{ bundle_id: 'com.roam-research.desktop-app', pid: 23, running: true }] };
    else if (args[1] === 'list_windows') result = { windows: [{ window_id: 9, is_on_screen: true, bounds: { x: 0, y: 0, width: 1200, height: 900 }, title: 'PRIVATE GRAPH', z_index: 1 }] };
    else if (args[1] === 'get_window_state') { const input = JSON.parse(args[2]); assert.equal(input.include_screenshot, false); result = fixture(); }
    else throw new Error('Unexpected command');
    return { stdout: JSON.stringify(result) };
  };
  const reader = createCaptionReader({ platform: 'darwin', exec, now: () => now });
  const result = await reader.read({ title: 'Test video', frame });
  assert.deepEqual(result, { state: 'off', reason: 'control', controlsVisible: true, checkedAt: 1000 });
  now = 7000;
  assert.equal((await reader.read({ title: 'Test video', frame })).checkedAt, 7000);
  assert.equal(calls.filter(args => args[1] === 'list_apps').length, 1);
  assert.equal(calls.filter(args => args[1] === 'list_windows').length, 2);
  assert.ok(calls.every((args) => args[0] === 'permissions' || args[0] === '-ww' || ['get_recording_state', 'list_apps', 'list_windows', 'get_window_state'].includes(args[1])));
});
test('recording never triggers a state read or permission change', async () => {
  const calls = [];
  const reader = createCaptionReader({ platform: 'darwin', exec: async (_path, args) => { calls.push(args); return { stdout: JSON.stringify({ enabled: true }) }; } });
  await assert.rejects(reader.read({ title: 'Test video', frame }), /recording/);
  assert.deepEqual(calls.map((args) => args[1]), ['get_recording_state']);
});
