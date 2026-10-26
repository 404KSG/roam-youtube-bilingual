import { DEFAULT_CONFIG, validateConfig } from './protocol.mjs';
export const GLOBAL_PREFERENCES_KEY = 'roam-youtube-bilingual/global/v1';
const VIDEO_V2 = 'roam-youtube-bilingual/video/v2/', VIDEO_V1 = 'roam-youtube-bilingual/video/v1/';
const validId = value => /^[\w-]{11}$/.test(value || '');

// One preference record for every video in this client. Runtime cancellation,
// video changes and load failures never persist an OFF choice.
export function createSubtitlePreferences(storage, defaults = DEFAULT_CONFIG) {
  const fallback = { enabled: false, ...validateConfig(defaults) };
  let memory = { ...fallback }, initialized = false, unsaved = false, reviewRequired = false;
  const parse = (raw, version) => {
    if (!raw || raw.length >= 4096) return undefined;
    try { const value = JSON.parse(raw); return value?.version === version ? { preferences: { enabled: value.enabled === true, ...validateConfig(value) }, review: value.reviewRequired === true } : undefined; }
    catch { return undefined; }
  };
  const legacy = videoId => {
    if (!validId(videoId)) return undefined;
    try { const current = storage?.getItem(VIDEO_V2 + videoId); return parse(current ?? storage?.getItem(VIDEO_V1 + videoId), current == null ? 1 : 2)?.preferences; }
    catch { return undefined; }
  };
  const persist = () => {
    try {
      if (!storage?.setItem) throw new Error('Storage unavailable');
      storage.setItem(GLOBAL_PREFERENCES_KEY, JSON.stringify({ version: 1, ...memory, ...(reviewRequired ? { reviewRequired: true } : {}) }));
      unsaved = false; return true;
    } catch { unsaved = true; return false; }
  };
  const migrate = videoId => {
    const ids = new Set(validId(videoId) ? [videoId] : []);
    try {
      for (let i = 0; i < Math.min(Number(storage?.length) || 0, 10000); i++) {
        const key = storage.key(i);
        for (const prefix of [VIDEO_V2, VIDEO_V1]) if (typeof key === 'string' && key.startsWith(prefix) && validId(key.slice(prefix.length))) ids.add(key.slice(prefix.length));
      }
    } catch { /* Migration only reads this plugin's old records. */ }
    const profiles = [...ids].map(legacy).filter(Boolean), current = legacy(videoId);
    const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
    const enabled = unique(profiles.filter(profile => profile.enabled));
    if (current?.enabled) memory = current;
    else if (enabled.length === 1) memory = enabled[0];
    else if (enabled.length > 1) {
      // Old records have no reliable last-edit timestamp. Do not invent one.
      memory = { ...(current || fallback), enabled: true }; reviewRequired = true;
    } else memory = current || (unique(profiles).length === 1 ? profiles[0] : fallback);
    if (profiles.length) persist();
  };
  function get(videoId) {
    if (videoId !== undefined && !validId(videoId)) throw new Error('Invalid legacy video preference key.');
    if (!unsaved) {
      try {
        const raw = storage?.getItem(GLOBAL_PREFERENCES_KEY);
        if (raw != null) {
          const stored = parse(raw, 1); memory = stored?.preferences || { ...fallback }; reviewRequired = stored?.review || false; initialized = true;
        } else if (!initialized) { initialized = true; migrate(videoId); }
      } catch { initialized = true; }
    }
    return { ...memory };
  }
  return {
    get,
    set(patch) {
      const current = get();
      if ('enabled' in patch && typeof patch.enabled !== 'boolean') throw new Error('Invalid subtitle preference.');
      const legacySize = 'fontSize' in patch ? { sourceFontSize: patch.fontSize, targetFontSize: patch.fontSize } : {};
      memory = { enabled: patch.enabled ?? current.enabled, ...validateConfig({ ...current, ...legacySize, ...patch }) };
      initialized = true; reviewRequired = false;
      const saved = persist();
      return { preferences: { ...memory }, saved };
    },
    refresh() {
      // A storage event is authoritative. Removing the global record resets
      // defaults rather than resurrecting an old per-video ON preference.
      memory = { ...fallback }; unsaved = false; reviewRequired = false; initialized = true;
      return get();
    },
    get notice() { return reviewRequired ? 'Older videos used different styles. Review these global settings once.' : ''; },
    get saveWarning() { return unsaved ? 'Global settings could not be saved on this device.' : ''; },
  };
}
