import { singleLine } from './protocol.mjs';

function joinCaptionFragments(cues, language) {
  const compact = /^(zh|ja|ko)(-|$)/i.test(language);
  return cues.reduce((text, cue) => {
    const next = singleLine(cue.text);
    if (!next) return text;
    const space = text && (!compact || (/[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(next))) ? ' ' : '';
    return text + space + next;
  }, '');
}

// Inputs are normalized, ordered, non-overlapping tracks. Use English segment
// boundaries for BOTH rows. This aligns timestamps; it does not retranslate or
// claim semantic equivalence between differently segmented YouTube tracks.
export function alignCaptionTracks(sourceCues, targetCues, language) {
  const groups = sourceCues.map(() => []), fallback = sourceCues.map(() => null);
  let first = 0;
  for (const target of targetCues) {
    while (first < sourceCues.length && sourceCues[first].end <= target.start) first++;
    let owner = -1, largest = 0;
    for (let index = first; index < sourceCues.length && sourceCues[index].start < target.end; index++) {
      const source = sourceCues[index];
      const overlap = Math.min(source.end, target.end) - Math.max(source.start, target.start);
      if (overlap <= 0) continue;
      if (overlap > largest) { largest = overlap; owner = index; }
      if (!fallback[index] || overlap > fallback[index].overlap) fallback[index] = { overlap, target };
    }
    if (owner >= 0) groups[owner].push(target);
  }
  return sourceCues.map((source, index) => ({
    start: source.start, end: source.end, source: singleLine(source.text),
    // A longer target cue can span several short English cues. Only reuse an
    // actually overlapping cue; never borrow a translation across a time gap.
    target: joinCaptionFragments(groups[index].length ? groups[index] : fallback[index] ? [fallback[index].target] : [], language),
  }));
}
