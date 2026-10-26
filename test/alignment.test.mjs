import test from 'node:test';
import assert from 'node:assert/strict';
import { alignCaptionTracks } from '../src/alignment.mjs';
import { activeCueIndex } from '../src/core.mjs';
const cue = (start, end, text) => ({ start, end, text });

test('one English segment holds all corresponding short Chinese fragments until its boundary', () => {
  const pairs = alignCaptionTracks([cue(0, 4, 'A complete English segment.'), cue(4, 7, 'Next segment.')], [cue(0, 1, '这是'), cue(1, 2, '完整的'), cue(2, 4, '中文段落。'), cue(4, 7, '下一段。')], 'zh-Hans');
  for (const time of [.5, 1.5, 3.9]) assert.equal(pairs[activeCueIndex(pairs, time)].target, '这是完整的中文段落。');
  assert.equal(pairs[activeCueIndex(pairs, 4)].target, '下一段。');
  assert.equal(pairs[activeCueIndex(pairs, 1)].source, 'A complete English segment.');
});
test('the reported 3:25 example groups the original YouTube fragments without retranslating', () => {
  const english = [cue(200, 204.1, 'Previous segment'), cue(204.1, 208.049, 'memory, the network and the NVLink,\nthe NICs, the optics and the'), cue(208.049, 212, 'Next segment')];
  const chinese = [cue(203.519, 205.44, '高带宽内存，'), cue(205.44, 207.2, '网络、NVL 链接、Nyx、'), cue(207.2, 208.879, '光学元件和铜')];
  const pair = alignCaptionTracks(english, chinese, 'zh-Hans')[1];
  assert.equal(pair.target, '高带宽内存，网络、NVL 链接、Nyx、光学元件和铜');
  assert.equal(pair.source, 'memory, the network and the NVLink, the NICs, the optics and the');
});
test('each fragment prefers its largest temporal overlap instead of leaking into both neighbors', () => {
  const pairs = alignCaptionTracks([cue(0, 4, 'First'), cue(4, 8, 'Second')], [cue(0, 1, '一。'), cue(1, 4.2, '二。'), cue(4.2, 8, '三。')], 'zh-Hans');
  assert.equal(pairs[0].target, '一。二。'); assert.equal(pairs[1].target, '三。');
});
test('a long translated cue may cover short English segments, but unrelated gaps stay empty', () => {
  const pairs = alignCaptionTracks([cue(0, 2, 'First'), cue(2, 4, 'Second'), cue(5, 6, 'Untranslated')], [cue(0, 4, '同一条完整译文。')], 'zh-Hans');
  assert.equal(pairs[0].target, '同一条完整译文。'); assert.equal(pairs[1].target, '同一条完整译文。'); assert.equal(pairs[2].target, '');
  assert.equal(activeCueIndex(pairs, 4.5), -1);
});
test('joining preserves Latin word spacing and does not invent or remove repeated speech', () => {
  const source = [cue(0, 4, 'English')];
  assert.equal(alignCaptionTracks(source, [cue(0, 2, 'Bonjour,'), cue(2, 4, 'le monde.')], 'fr')[0].target, 'Bonjour, le monde.');
  assert.equal(alignCaptionTracks(source, [cue(0, 2, 'NVIDIA'), cue(2, 4, 'GPU 计算。')], 'zh-Hans')[0].target, 'NVIDIA GPU 计算。');
  assert.equal(alignCaptionTracks(source, [cue(0, 1, '是。'), cue(2, 4, '是。')], 'zh-Hans')[0].target, '是。是。');
});
