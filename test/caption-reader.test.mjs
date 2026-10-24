import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCaption, joinCaptionLines, createCaptionReader, createPeerVerifier } from '../server/caption-reader.mjs';
import { sanitizeVideoInfo } from '../server/video-info.mjs';
const frame = { x: 100, y: 100, width: 800, height: 450 };
const node = (id, parent, role, text, box) => ({ element_index: id, parent_index: parent, role, label: text, value: text, frame: box });
function fixture() {
  return { elements: [
    node(0, undefined, 'AXWindow', 'PRIVATE GRAPH TITLE', { x: 0, y: 0, w: 1200, h: 900 }),
    node(1, 0, 'AXWebArea', 'Private Roam graph', { x: 0, y: 0, w: 1200, h: 900 }),
    node(2, 1, 'AXWebArea', 'Test video - YouTube', { x: 100, y: 100, w: 800, h: 450 }),
    node(3, 1, 'AXStaticText', 'PRIVATE NOTE MUST NEVER LEAVE', { x: 350, y: 490, w: 300, h: 24 }),
    node(4, 2, 'AXStaticText', '这是第一行', { x: 350, y: 490, w: 300, h: 24 }),
    node(5, 2, 'AXStaticText', '也是第二行。', { x: 380, y: 518, w: 240, h: 24 }),
    node(6, 2, 'AXButton', 'More videos', { x: 400, y: 520, w: 200, h: 24 }),
    node(7, 6, 'AXStaticText', 'BUTTON TEXT', { x: 400, y: 520, w: 200, h: 24 }),
    node(8, 2, 'AXStaticText', 'Time elapsed 12 seconds', { x: 400, y: 520, w: 200, h: 24 }),
    node(9, 1, 'AXStaticText', 'ALREADY RENDERED OVERLAY', { x: 350, y: 490, w: 300, h: 24 }),
  ] };
}
test('reader extracts only native captions of the exact title and geometry', () => {
  const result = extractCaption(fixture(), { title: 'Test video', frame, target: 'zh-Hans' });
  assert.equal(result.text, '这是第一行也是第二行。');
  assert.equal(result.bounds.width, 300 / 800);
  assert.equal(result.bounds.height, 52 / 450);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('OVERLAY'), false);
  assert.equal(extractCaption(fixture(), { title: 'Other video', frame, target: 'ja' }), null);
  assert.equal(extractCaption(fixture(), { title: 'Test video', frame: { ...frame, x: 2000 }, target: 'ja' }), null);
});
test('open native menus and empty/locked-screen trees fail closed', () => {
  const snapshot = fixture(); snapshot.elements.push(node(10, 2, 'AXMenu', '', { x: 400, y: 300, w: 200, h: 200 }));
  assert.equal(extractCaption(snapshot, { title: 'Test video', frame, target: 'zh-Hans' }), null);
  assert.equal(extractCaption({ elements: [] }, { title: 'Test video', frame, target: 'zh-Hans' }), null);
});
test('Chinese and Japanese lines are joined, while Latin word boundaries are retained', () => {
  assert.equal(joinCaptionLines(['字幕を', '表示します。'], 'ja'), '字幕を表示します。');
  assert.equal(joinCaptionLines(['Bonjour', 'le monde'], 'fr'), 'Bonjour le monde');
  assert.equal(joinCaptionLines(['NVIDIA', 'GPU'], 'zh-Hans'), 'NVIDIA GPU');
});
test('video metadata uses the supplied language list and removes raw URLs', () => {
  const info = sanitizeVideoInfo({ id: 'vif8NQcjVf0', title: 'Test video', subtitles: { en: [{ ext: 'json3', name: 'English', url: 'https://www.youtube.com/api/timedtext?lang=en' }] }, automatic_captions: { ja: [{ name: 'Japanese', url: 'https://www.youtube.com/?secret=not-returned' }], 'zh-Hans': [{ name: 'Chinese (Simplified)' }], 'en-orig': [{}], bad: [] } }, 'vif8NQcjVf0');
  assert.equal(info.sourceLanguage, 'en');
  assert.ok(info.languages.some((item) => item.code === 'ja'));
  assert.ok(!info.languages.some((item) => item.code.endsWith('-orig')));
  assert.equal(JSON.stringify(info).includes('secret'), false);
  assert.throws(() => sanitizeVideoInfo({ id: 'other', title: 'Bad' }, 'vif8NQcjVf0'));
});
test('peer check authenticates the client UID, not the server side of a socket', async () => {
  let calls = 0; const socket = { remoteAddress: '127.0.0.1', remotePort: 50001 };
  const verify = createPeerVerifier({ platform: 'darwin', uid: 501, exec: async () => { calls++; return { stdout: 'p10\nu501\nn127.0.0.1:50001->127.0.0.1:17321\n' }; } });
  await verify(socket, 17321); await verify(socket, 17321); assert.equal(calls, 1);
  const wrong = createPeerVerifier({ platform: 'darwin', uid: 501, exec: async () => ({ stdout: 'p10\nu502\nn127.0.0.1:50001->127.0.0.1:17321\np20\nu501\nn127.0.0.1:17321->127.0.0.1:50001\n' }) });
  await assert.rejects(wrong(socket, 17321), (error) => error.status === 403);
});
test('read bridge uses only permitted read-only tools and never returns AX snapshots', async () => {
  const calls = [];
  const exec = async (_path, args, options) => {
    calls.push(args);
    assert.equal(options.env?.OPENAI_API_KEY, undefined);
    let result;
    if (args[0] === 'permissions') result = { accessibility: true, source: { attribution: 'driver-daemon' } };
    else if (args[1] === 'get_recording_state') result = { enabled: false, recording: false };
    else if (args[1] === 'list_apps') result = { apps: [{ bundle_id: 'com.roam-research.desktop-app', pid: 23, running: true }] };
    else if (args[1] === 'list_windows') result = { windows: [{ window_id: 9, is_on_screen: true, bounds: { x: 0, y: 0, width: 1200, height: 900 }, title: 'PRIVATE GRAPH', z_index: 1 }] };
    else if (args[1] === 'get_window_state') { const input = JSON.parse(args[2]); assert.equal(input.pid, 23); assert.equal(input.window_id, 9); assert.equal(input.include_screenshot, false); result = fixture(); }
    else throw new Error('Unexpected command');
    return { stdout: JSON.stringify(result) };
  };
  const reader = createCaptionReader({ platform: 'darwin', exec, now: () => 1000 });
  const result = await reader.read({ title: 'Test video', frame, target: 'zh-Hans' });
  assert.equal(result.matched, true); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.ok(calls.every((args) => args[0] === 'permissions' || ['get_recording_state', 'list_apps', 'list_windows', 'get_window_state'].includes(args[1])));
});
test('recording or missing permission never triggers capture or permission changes', async () => {
  const calls = [];
  const reader = createCaptionReader({ platform: 'darwin', exec: async (_path, args) => { calls.push(args); return { stdout: JSON.stringify({ enabled: true }) }; } });
  await assert.rejects(reader.read({ title: 'Test video', frame, target: 'ja' }), /录制/);
  assert.deepEqual(calls.map((args) => args[1]), ['get_recording_state']);
});
