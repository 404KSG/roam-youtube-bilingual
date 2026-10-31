import { activeCueIndex } from './core.mjs';
import { joinCaptionFragments } from './alignment.mjs';

function joinSourceFragments(previous, next) {
  const before = previous.trim().split(/\s+/), after = next.trim().split(/\s+/);
  let shared = 0;
  for (let size = Math.min(before.length, after.length) - 1; size >= 2; size--) {
    if (before.slice(-size).every((word, index) => word === after[index])) { shared = size; break; }
  }
  return previous + ' ' + after.slice(shared).join(' ');
}
function addTargetCues(targetCues, pair) { for (const cue of pair.targetCues || []) targetCues.add(cue); }
function createPrefixes(segment, language) {
  let source = '', target = ''; const targetCues = new Set();
  segment.prefixes = segment.parts.map((part, index) => {
    source = index ? joinSourceFragments(source, part.source) : part.source;
    const duplicateFallback = part.fallbackTarget && targetCues.has(part.fallbackTarget);
    if (!duplicateFallback) target = index ? joinCaptionFragments([{ text: target }, { text: part.target }], language) : part.target;
    addTargetCues(targetCues, part);
    return { start: segment.start, end: segment.end, source, target };
  });
}

// Bounded, punctuation-aware display grouping, not a translation engine.
// Keep original parts so narrow views can retain readable font sizes.
export function readingSegments(pairs, language) {
  const result = [];
  for (const pair of pairs) {
    const last = result.at(-1);
    const complete = last && /[.!?]["'”’)\]]*$/.test(last.source) && !/\b(?:Mr|Mrs|Ms|Dr|Prof|St)\.$/.test(last.source);
    const canJoin = last && !complete && last.target && pair.target && !/^\s*[-–—]\s/.test(pair.source)
      && pair.start - last.end <= .2 && pair.end - last.start <= 8 && last.parts.length < 4
      && last.source.length + pair.source.length < 220 && last.target.length + pair.target.length < 180;
    if (canJoin) {
      const duplicateFallback = pair.fallbackTarget && last.targetCues.has(pair.fallbackTarget);
      last.end = pair.end; last.source = joinSourceFragments(last.source, pair.source);
      if (!duplicateFallback) last.target = joinCaptionFragments([{ text: last.target }, { text: pair.target }], language);
      addTargetCues(last.targetCues, pair); last.parts.push(pair);
    } else {
      const targetCues = new Set(); addTargetCues(targetCues, pair);
      result.push({ ...pair, parts: [pair], targetCues });
    }
  }
  for (const segment of result) if (segment.parts.length > 1) createPrefixes(segment, language);
  // Bridge only tiny caption-authoring gaps, never real pauses or missing text.
  for (let i = 0; i < result.length - 1; i++) {
    const gap = result[i + 1].start - result[i].end;
    if (gap > 0 && gap <= .12) result[i].end = result[i + 1].start;
  }
  return result;
}
export function visibleSegment(segments, time, fits = () => true) {
  const segment = segments[activeCueIndex(segments, time)];
  if (!segment) return undefined;
  if (segment.parts.length === 1) return segment;
  const index = activeCueIndex(segment.parts, time);
  const current = index >= 0 ? index : segment.parts.findLastIndex(part => part.end <= time && time - part.end <= .2);
  if (current < 0) return undefined;
  return fits(segment) ? segment.prefixes[current] : segment.parts[current];
}
