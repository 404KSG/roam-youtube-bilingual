import test from 'node:test';
import assert from 'node:assert/strict';
import { readingSegments, visibleSegment } from '../src/reading.mjs';
const pair = (start, end, source, target) => ({ start, end, source, target });

test('a short sentence split by caption timing reads as one stable bilingual unit', () => {
  const groups = readingSegments([pair(0, 2, 'This is one', '这是一句'), pair(2.08, 4, 'complete sentence.', '完整的话。'), pair(4.1, 6, 'Next sentence.', '下一句。')], 'zh-Hans');
  for (const time of [.5, 2.03, 3.5]) {
    assert.equal(visibleSegment(groups, time).source, 'This is one complete sentence.');
    assert.equal(visibleSegment(groups, time).target, '这是一句完整的话。');
  }
  assert.equal(visibleSegment(groups, 4.2).target, '下一句。');
  assert.equal(visibleSegment(groups, 1).source, 'This is one complete sentence.');
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
