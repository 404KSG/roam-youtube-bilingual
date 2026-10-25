export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

export function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.split('/')[1];
    else if (/^(www\.|m\.)?youtube\.com$/.test(url.hostname) || url.hostname === 'www.youtube-nocookie.com') {
      id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1];
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

export function decodeText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? all;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  }).replace(/[\t ]+/g, ' ').trim();
}

export function normalizeCues(raw) {
  if (!Array.isArray(raw) || raw.length > 20000) throw new Error('Invalid captions or more than 20,000 cues.');
  // Normalized cues are plain text. Decoding them twice would erase literal <T>.
  const clean = raw.filter((cue) => cue && typeof cue.text === 'string')
    .map((cue) => ({ start: Number(cue.start), end: Number(cue.end), text: cue.text.replace(/[\t ]+/g, ' ').trim() }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && c.text)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cue of clean) {
    const last = merged.at(-1);
    if (last && last.start === cue.start) {
      if (last.text !== cue.text) last.text += `\n${cue.text}`;
      last.end = Math.max(last.end, cue.end);
    } else if (last && last.text === cue.text && cue.start <= last.end + 0.05) last.end = Math.max(last.end, cue.end);
    else merged.push(cue);
  }
  for (let i = 0; i < merged.length - 1; i++) merged[i].end = Math.min(merged[i].end, merged[i + 1].start);
  return merged.filter((c) => c.end > c.start).map((c, id) => ({ id, ...c }));
}

export function parseJSON3(data) {
  const json = typeof data === 'string' ? JSON.parse(data) : data;
  if (!Array.isArray(json?.events)) throw new Error('Invalid YouTube JSON3 captions.');
  const raw = [];
  for (const event of json.events) {
    if (!Array.isArray(event?.segs)) continue;
    const text = event.segs.map((s) => typeof s?.utf8 === 'string' ? s.utf8 : '').join('').trim();
    if (!text) continue;
    const start = Number(event.tStartMs) / 1000;
    const end = start + Number(event.dDurationMs ?? 3000) / 1000;
    const last = raw.at(-1);
    if (event.aAppend && last && start <= last.end) {
      last.text += ` ${text}`;
      last.end = Math.max(last.end, end);
    } else raw.push({ start, end, text });
  }
  return normalizeCues(raw);
}

function timestamp(value) {
  const fields = value.replace(',', '.').split(':').map(Number);
  if (fields.at(-1) >= 60 || fields.at(-2) >= 60) return NaN;
  return fields.reduce((total, part) => total * 60 + part, 0);
}

export function parseSubtitles(input) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > MAX_SUBTITLE_BYTES) throw new Error('Caption files must be smaller than 5 MB.');
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (text.startsWith('{')) {
    const cues = parseJSON3(text);
    if (!cues.length) throw new Error('The caption file has no valid timestamps.');
    return cues;
  }
  const raw = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const position = lines.findIndex((line) => /-->/.test(line));
    if (position < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const match = lines[position].match(/((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})/);
    if (!match) continue;
    raw.push({ start: timestamp(match[1]), end: timestamp(match[2]), text: decodeText(lines.slice(position + 1).join('\n')) });
  }
  const cues = normalizeCues(raw);
  if (!cues.length) throw new Error('No timed captions found. Expected SRT, VTT, or YouTube JSON3.');
  return cues;
}

export function activeCueIndex(cues, time) {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cues[mid].start <= time) low = mid + 1;
    else high = mid;
  }
  const index = low - 1;
  return index >= 0 && time < cues[index].end ? index : -1;
}

