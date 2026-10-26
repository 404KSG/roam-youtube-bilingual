import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const runtimeFiles = ['src/settings.mjs', 'src/reading.mjs', 'src/preferences.mjs', 'src/alignment.mjs', 'server/caption-selection.mjs', 'src/extension.mjs', 'src/protocol.mjs', 'src/core.mjs', 'src/clock.mjs', 'src/surface.mjs', 'server/index.mjs', 'server/captions.mjs', 'server/video-info.mjs', 'server/caption-reader.mjs', 'server/request-pool.mjs', 'server/caption-cache.mjs', 'start.command'];
test('all plugin controls, messages, and helper notices use English', async () => {
  for (const path of runtimeFiles) {
    const text = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\p{Script=Han}/u, `${path} still contains Chinese interface text`);
  }
});
test('the toolbar uses the host Blueprint translate icon, not custom SVG or text', async () => {
  const source = await readFile(new URL('../src/extension.mjs', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function toolbarIcon()'), source.indexOf('\nclass VideoCaptions'));
  const node = tag => ({ tag, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  const icon = vm.runInNewContext(`${fn}; toolbarIcon()`, {
    el: (tag, className) => Object.assign(node(tag), { className }),
    document: { createElementNS: (_namespace, tag) => node(tag) },
  });
  assert.equal(icon.tag, 'span');
  assert.match(icon.className, /\bbp3-icon-translate\b/);
  assert.equal(icon.attributes['aria-hidden'], 'true');
  assert.equal(icon.innerHTML, undefined);
});
test('repeated errors do not keep a stale banner over the video', async () => {
  const source = await readFile(new URL('../src/extension.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('class VideoCaptions {'), source.indexOf('\nfunction scan()'));
  let timer, schedules = 0;
  const Controller = vm.runInNewContext(`${code}; VideoCaptions`, { settings: null, clearTimeout() {}, setTimeout(callback, delay) { assert.equal(delay, 6000); timer = callback; schedules++; return 1; } });
  const video = Object.create(Controller.prototype); Object.assign(video, { epoch: 1, noticeBox: {} });
  video.notice('YouTube returned HTTP 429.'); video.notice('YouTube returned HTTP 429.');
  assert.equal(schedules, 1); timer(); assert.equal(video.noticeBox.hidden, true);
  video.notice('YouTube returned HTTP 429.'); assert.equal(video.noticeBox.hidden, true);
});
