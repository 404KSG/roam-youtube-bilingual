import test from 'node:test';
import assert from 'node:assert/strict';
import { videoIdFromUrl, parseSubtitles, parseJSON3, normalizeCues, activeCueIndex, translationWindow, validateTranslations, exportMarkdown, decodeText } from '../src/core.mjs';

test('only trusted YouTube hosts and valid video IDs are accepted', () => {
  for (const url of ['https://www.youtube.com/embed/M7lc1UVf-VE?start=10', 'https://youtu.be/M7lc1UVf-VE', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE', 'https://m.youtube.com/watch?v=M7lc1UVf-VE']) assert.equal(videoIdFromUrl(url), 'M7lc1UVf-VE');
  for (const url of ['https://youtube.com.evil.test/embed/M7lc1UVf-VE', 'javascript:alert(1)', 'https://youtube.com/watch?v=bad', 'https://example.com/watch?v=M7lc1UVf-VE']) assert.equal(videoIdFromUrl(url), null);
});
test('SRT handles BOM, CRLF, tags, entities, hours and multiline cues', () => {
  const cues = parseSubtitles('\uFEFF1\r\n01:02:03,125 --> 01:02:05,500\r\n<i>Hello</i> &amp; welcome\r\nSecond line\r\n\r\n2\r\n01:02:05,500 --> 01:02:07,000\r\nNext');
  assert.deepEqual(cues[0], { id: 0, start: 3723.125, end: 3725.5, text: 'Hello & welcome\nSecond line' });
  assert.equal(cues[1].text, 'Next');
});
test('VTT handles metadata, cue IDs, inline word timestamps and position settings', () => {
  const cues = parseSubtitles('WEBVTT\nKind: captions\n\nNOTE source info\nignored\n\nfoo\n00:02.000 --> 00:05.000 align:start\n<00:02.100><c>Useful</c> tool\n\n00:05.500 --> 00:06.000\nDone');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Useful tool');
  assert.equal(activeCueIndex(cues, 5.2), -1);
});
test('JSON3 joins segments and append events but ignores empty windows', () => {
  const cues = parseJSON3({ events: [{ tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'Hello' }] }, { tStartMs: 1000, dDurationMs: 3000, aAppend: 1, segs: [{ utf8: 'world' }] }, { tStartMs: 5000, segs: [{ utf8: '\n' }] }, { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: 'Next ' }, { utf8: 'idea' }] }] });
  assert.deepEqual(cues.map((c) => c.text), ['Hello world', 'Next idea']);
  assert.equal(cues[0].end, 5);
});
test('overlaps are clipped, invalid cues ignored and duplicate rolling text merged', () => {
  const cues = normalizeCues([{ start: 0, end: 3, text: 'A' }, { start: 1, end: 4, text: 'A' }, { start: 3, end: 6, text: 'B' }, { start: -1, end: 2, text: 'bad' }]);
  assert.deepEqual(cues.map((c) => [c.start, c.end]), [[0, 3], [3, 6]]);
  assert.equal(activeCueIndex(cues, 3), 1);
  assert.equal(activeCueIndex(cues, 6), -1);
});
test('invalid or oversized imports fail with actionable errors', () => {
  assert.throws(() => parseSubtitles('no timestamps'), /时间轴/);
  assert.throws(() => parseSubtitles('x'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
  assert.throws(() => parseSubtitles('{"events":[]}'), /时间轴/);
  assert.equal(decodeText('&#x1f600; &#1114112; &lt;hello&gt;'), '😀 <hello>');
});
test('lookahead selects current/nearby uncached cues, including after a seek', () => {
  const cues = Array.from({ length: 200 }, (_, id) => ({ id, start: id * 5, end: id * 5 + 4, text: `caption ${id}` }));
  const result = translationWindow(cues, 500, new Map([[100, 'done']]));
  assert.equal(result[0].id, 101);
  assert.ok(result.every((c) => c.id <= 118));
  assert.ok(result.length <= 24);
  assert.equal(translationWindow(cues, 0, new Map()).length, 19);
});
test('incomplete, duplicated and renumbered model responses are rejected', () => {
  const entries = [{ id: 20, text: 'A' }, { id: 21, text: 'B' }];
  for (const result of [[{ id: 20, text: '甲' }], [{ id: 20, text: '甲' }, { id: 20, text: '乙' }], [{ id: 0, text: '甲' }, { id: 1, text: '乙' }]]) assert.throws(() => validateTranslations(result, entries));
  assert.deepEqual(validateTranslations([{ id: 21, text: ' 乙 ' }, { id: 20, text: '甲' }], entries)[0], { id: 21, text: '乙' });
});
test('export retains source, translation and timestamp links', () => {
  assert.equal(exportMarkdown([{ id: 9, start: 125, text: 'Original' }], new Map([[9, '原文']]), 'M7lc1UVf-VE'), '- [02:05](https://www.youtube.com/watch?v=M7lc1UVf-VE&t=125s) Original\n  - 原文');
});
