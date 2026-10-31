import test from 'node:test';
import assert from 'node:assert/strict';
import { readingSegments, visibleSegment } from '../src/reading.mjs';
import { alignCaptionTracks } from '../src/alignment.mjs';
const pair = (start, end, source, target) => ({ start, end, source, target });

test('a short sentence split by caption timing reveals only speech that has started', () => {
  const groups = readingSegments([pair(0, 2, 'This is one', '这是一句'), pair(2.08, 4, 'complete sentence.', '完整的话。'), pair(4.1, 6, 'Next sentence.', '下一句。')], 'zh-Hans');
  for (const time of [.5, 1, 2.03]) {
    assert.equal(visibleSegment(groups, time).source, 'This is one');
    assert.equal(visibleSegment(groups, time).target, '这是一句');
  }
  assert.equal(visibleSegment(groups, 3.5).source, 'This is one complete sentence.');
  assert.equal(visibleSegment(groups, 3.5).target, '这是一句完整的话。');
  assert.equal(visibleSegment(groups, 4.2).target, '下一句。');
});
test('fallback copies from one long translation are not duplicated when source parts are grouped', () => {
  const pairs = alignCaptionTracks([{ start: 0, end: 2, text: 'First' }, { start: 2, end: 4, text: 'Second' }], [{ start: 0, end: 4, text: '同一条完整译文。' }], 'zh-Hans');
  const groups = readingSegments(pairs, 'zh-Hans');
  assert.equal(visibleSegment(groups, .1).source, 'First');
  assert.equal(visibleSegment(groups, .1).target, '同一条完整译文。');
  assert.equal(visibleSegment(groups, 2.1).source, 'First Second');
  assert.equal(visibleSegment(groups, 2.1).target, '同一条完整译文。');
});
test('rolling caption windows never reveal their later replacement early', () => {
  const groups = readingSegments([pair(0, 2, 'we are going to talk about the', '第一句'), pair(2, 4, 'about the unfinished design', '第二句')], 'zh-Hans');
  assert.equal(visibleSegment(groups, .5).source, 'we are going to talk about the');
  assert.equal(visibleSegment(groups, 2.5).source, 'we are going to talk about the unfinished design');
});
test('grouping retains intentional repeated speech and translation fragments', () => {
  const groups = readingSegments([pair(0, 2, 'no', '是。'), pair(2, 4, 'no', '是。')], 'zh-Hans');
  assert.equal(visibleSegment(groups, 2.5).source, 'no no');
  assert.equal(visibleSegment(groups, 2.5).target, '是。是。');
});
test('a narrow view uses original parts rather than squeezing a merged paragraph', () => {
  const groups = readingSegments([pair(0, 2, 'One phrase', '第一部分'), pair(2, 4, 'continues here.', '后半部分。')], 'zh-Hans');
  assert.equal(visibleSegment(groups, 3, () => false).source, 'continues here.');
});
test('real gaps, speaker changes and missing translation are not papered over', () => {
  const groups = readingSegments([pair(0, 2, 'First phrase', '第一句'), pair(3, 5, 'Later phrase', ''), pair(5, 6, '- A reply.', '回答。')], 'zh-Hans');
  assert.equal(visibleSegment(groups, 2.5), undefined);
  assert.equal(visibleSegment(groups, 4).source, 'Later phrase');
  assert.equal(visibleSegment(groups, 4).target, '');
  assert.equal(groups.length, 3);
});
