import { DEFAULT_CONFIG, validateConfig } from './protocol.mjs';
export const VIDEO_PREFERENCES_PREFIX = 'roam-youtube-bilingual/video/v2/';
const LEGACY_VIDEO_PREFERENCES_PREFIX = 'roam-youtube-bilingual/video/v1/';
const validId = value => /^[\w-]{11}$/.test(value || '');

// Only explicit choices are stored. Runtime cancellation, load failures, and
// renderer teardown never write an OFF preference.
export function createVideoPreferences(storage, defaults = DEFAULT_CONFIG) {
  const fallback = { enabled: false, ...validateConfig(defaults) }, memory = new Map(), unsaved = new Set();
  const key = videoId => {
    if (!validId(videoId)) throw new Error('Invalid video preference key.');
    return VIDEO_PREFERENCES_PREFIX + videoId;
  };
  function get(videoId) {
    const name = key(videoId);
    if (!unsaved.has(videoId)) {
      let value = fallback;
      try {
        const current = storage?.getItem(name);
        const raw = current ?? storage?.getItem(LEGACY_VIDEO_PREFERENCES_PREFIX + videoId);
        if (raw && raw.length < 4096) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === (current == null ? 1 : 2)) value = { enabled: parsed.enabled === true, ...validateConfig(parsed) };
        }
      } catch { value = memory.get(videoId) || fallback; }
      memory.set(videoId, { ...value });
    }
    return { ...memory.get(videoId) };
  }
  return {
    get,
    set(videoId, patch) {
      const current = get(videoId);
      if ('enabled' in patch && typeof patch.enabled !== 'boolean') throw new Error('Invalid subtitle preference.');
      const legacy = 'fontSize' in patch ? { sourceFontSize: patch.fontSize, targetFontSize: patch.fontSize } : {};
      const next = { enabled: patch.enabled ?? current.enabled, ...validateConfig({ ...current, ...legacy, ...patch }) };
      memory.set(videoId, next);
      let saved = true;
      try {
        if (!storage?.setItem) throw new Error('Storage unavailable');
        storage.setItem(key(videoId), JSON.stringify({ version: 2, ...next }));
        unsaved.delete(videoId);
      } catch { saved = false; unsaved.add(videoId); }
      return { preferences: { ...next }, saved };
    },
  };
}
