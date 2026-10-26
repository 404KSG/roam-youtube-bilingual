import { activeCueIndex } from './core.mjs';
import { joinCaptionFragments } from './alignment.mjs';

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
      last.end = pair.end; last.source += ' ' + pair.source;
      last.target = joinCaptionFragments([{ text: last.target }, { text: pair.target }], language);
      last.parts.push(pair);
    } else result.push({ ...pair, parts: [pair] });
  }
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
  if (segment.parts.length === 1 || fits(segment)) return segment;
  const index = activeCueIndex(segment.parts, time);
  if (index >= 0) return segment.parts[index];
  const previous = segment.parts.findLast(part => part.end <= time);
  return previous && time - previous.end <= .2 ? previous : undefined;
}
