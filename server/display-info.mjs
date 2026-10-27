// Display-only, idle metadata lease. Never use this for caption validation or writes.
export function createDisplayInfoLease({ now = Date.now, maxEntries = 40, idleMs = 120000 } = {}) {
  const entries = new Map();
  const get = videoId => {
    const entry = entries.get(videoId);
    if (!entry || now() - entry.usedAt > idleMs) { entries.delete(videoId); return undefined; }
    entries.delete(videoId); entry.usedAt = now(); entries.set(videoId, entry); return entry.info;
  };
  const remember = (videoId, info) => {
    if (!info || info.videoId !== videoId) return info;
    entries.delete(videoId); entries.set(videoId, { info, usedAt: now() });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return info;
  };
  return { get, remember };
}
