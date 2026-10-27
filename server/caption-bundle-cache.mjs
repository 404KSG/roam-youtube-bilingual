import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES, normalizeCues } from '../src/core.mjs';
import { isCaptionTrackKey } from './caption-key.mjs';

const VIDEO = /^[\w-]{11}$/;
const MAX_CUES = 20000;
const MAX_METADATA_BYTES = 64 * 1024;
const SKEW_MS = 60_000;
const canonical = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const cueDigest = cues => digest(cues.map(({ start, end, text }) => ({ start, end, text })));
export const captionCueFingerprint = cueDigest;
const validKey = (videoId, target) => VIDEO.test(videoId) && isCaptionTrackKey(target);
const selection = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identity = value.identity;
  if (typeof value.downloadLanguage !== 'string' || value.downloadLanguage.length > 160 || !identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  const keys = ['lang', 'kind', 'name', 'tlang'];
  if (Object.keys(identity).some(key => !keys.includes(key)) || keys.some(key => typeof identity[key] !== 'string' || identity[key].length > 240)) return null;
  return { downloadLanguage: value.downloadLanguage, identity: Object.fromEntries(keys.map(key => [key, identity[key]])) };
};
const sanitizedInfo = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !VIDEO.test(value.videoId) || typeof value.title !== 'string' || value.title.length > 1000 || !isCaptionTrackKey(value.sourceLanguage) || !isCaptionTrackKey(value.playerSourceLanguage)) return null;
  if (!value.sourceTrack || typeof value.sourceTrack !== 'object' || Array.isArray(value.sourceTrack)) return null;
  const sourceTrack = value.sourceTrack;
  if (Object.keys(sourceTrack).some(key => !['languageCode', 'languageName', 'kind', 'name', 'vss_id'].includes(key)) || ['languageCode', 'languageName', 'kind', 'name'].some(key => typeof sourceTrack[key] !== 'string' || sourceTrack[key].length > 240)) return null;
  const sourceSelection = selection(value.sourceSelection);
  if (!sourceSelection || !Array.isArray(value.languages) || value.languages.length > 200) return null;
  const languages = [];
  for (const language of value.languages) {
    if (!language || typeof language !== 'object' || Array.isArray(language) || Object.keys(language).some(key => !['code', 'name', 'autoTranslated', 'selection'].includes(key)) || !isCaptionTrackKey(language.code) || typeof language.name !== 'string' || language.name.length > 160 || typeof language.autoTranslated !== 'boolean') return null;
    const chosen = selection(language.selection); if (!chosen) return null;
    languages.push({ code: language.code, name: language.name, autoTranslated: language.autoTranslated, selection: chosen });
  }
  const result = { videoId: value.videoId, title: value.title, sourceLanguage: value.sourceLanguage, playerSourceLanguage: value.playerSourceLanguage, sourceTrack: { languageCode: sourceTrack.languageCode, languageName: sourceTrack.languageName, kind: sourceTrack.kind, name: sourceTrack.name, ...(typeof sourceTrack.vss_id === 'string' && sourceTrack.vss_id.length <= 240 ? { vss_id: sourceTrack.vss_id } : {}) }, sourceSelection, languages };
  return Buffer.byteLength(canonical(result)) <= MAX_METADATA_BYTES ? result : null;
};
const normalized = value => {
  try {
    if (!Array.isArray(value) || value.length > MAX_CUES) return null;
    const cues = normalizeCues(value);
    const text = canonical(cues);
    return cues.length && Buffer.byteLength(text) <= MAX_SUBTITLE_BYTES ? cues : null;
  } catch { return null; }
};
function pairIdFor(bundle) {
  return digest([bundle.schema, bundle.cachePolicy, bundle.captionPolicy, bundle.videoId, bundle.source.trackKey, bundle.source.playerTrack, bundle.source.selection, bundle.source.cueSha256, bundle.target, bundle.targetTrack.language, bundle.targetTrack.type, bundle.targetTrack.selection, bundle.targetTrack.cueSha256]);
}
const same = (left, right) => canonical(left) === canonical(right);
function crossBound(info, target, source, targetTrack) {
  const targetInfo = info.languages.find(language => language.code === target);
  const type = target === info.sourceLanguage ? 'source' : targetInfo?.autoTranslated ? 'auto-translated' : 'uploaded';
  return !!targetInfo && source.trackKey === info.sourceLanguage && source.playerTrack === canonical(info.sourceTrack) && same(source.selection, info.sourceSelection) && targetTrack.language === target && targetTrack.type === type && same(targetTrack.selection, targetInfo.selection);
}
function validateBundle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields = ['schema', 'cachePolicy', 'captionPolicy', 'videoId', 'target', 'createdAt', 'validatedAt', 'lastAccessed', 'sanitizedInfo', 'source', 'targetTrack', 'pairId'];
  if (Object.keys(input).some(key => !fields.includes(key)) || input.schema !== 3 || input.cachePolicy !== 'verified-bundle-v1' || input.captionPolicy !== 'same-source-v1' || !validKey(input.videoId, input.target) || !Number.isFinite(input.createdAt) || !Number.isFinite(input.validatedAt) || !Number.isFinite(input.lastAccessed)) return null;
  const info = sanitizedInfo(input.sanitizedInfo);
  if (!info || info.videoId !== input.videoId) return null;
  const source = input.source, targetTrack = input.targetTrack;
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(key => !['trackKey', 'playerTrack', 'selection', 'cueSha256', 'cues'].includes(key)) || !isCaptionTrackKey(source.trackKey) || typeof source.playerTrack !== 'string' || source.playerTrack.length > 2000 || typeof source.cueSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.cueSha256)) return null;
  const sourceSelection = selection(source.selection), sourceCues = normalized(source.cues);
  if (!sourceSelection || !sourceCues || cueDigest(sourceCues) !== source.cueSha256) return null;
  if (!targetTrack || typeof targetTrack !== 'object' || Array.isArray(targetTrack) || Object.keys(targetTrack).some(key => !['language', 'type', 'selection', 'cueSha256', 'cues'].includes(key)) || targetTrack.language !== input.target || !['uploaded', 'auto-translated', 'source'].includes(targetTrack.type) || typeof targetTrack.cueSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(targetTrack.cueSha256)) return null;
  const targetSelection = selection(targetTrack.selection), targetCues = normalized(targetTrack.cues);
  if (!targetSelection || !targetCues || cueDigest(targetCues) !== targetTrack.cueSha256 || !crossBound(info, input.target, { ...source, selection: sourceSelection }, { ...targetTrack, selection: targetSelection })) return null;
  const bundle = { schema: 3, cachePolicy: 'verified-bundle-v1', captionPolicy: 'same-source-v1', videoId: input.videoId, target: input.target, createdAt: input.createdAt, validatedAt: input.validatedAt, lastAccessed: input.lastAccessed, sanitizedInfo: info, source: { trackKey: source.trackKey, playerTrack: source.playerTrack, selection: sourceSelection, cueSha256: source.cueSha256, cues: sourceCues }, targetTrack: { language: targetTrack.language, type: targetTrack.type, selection: targetSelection, cueSha256: targetTrack.cueSha256, cues: targetCues }, pairId: input.pairId };
  return typeof input.pairId === 'string' && /^[a-f0-9]{64}$/.test(input.pairId) && pairIdFor(bundle) === input.pairId ? bundle : null;
}
export function makeCaptionBundle({ videoId, target, info, source, targetTrack, now = Date.now }) {
  const timestamp = now(), cleanInfo = sanitizedInfo(info), sourceCues = normalized(source?.cues), targetCues = normalized(targetTrack?.cues);
  const sourceSelection = selection(source?.selection), targetSelection = selection(targetTrack?.selection);
  if (!cleanInfo || !validKey(videoId, target) || cleanInfo.videoId !== videoId || !sourceCues || !targetCues || !sourceSelection || !targetSelection || !isCaptionTrackKey(source?.trackKey) || typeof source?.playerTrack !== 'string' || !['uploaded', 'auto-translated', 'source'].includes(targetTrack?.type) || !crossBound(cleanInfo, target, { ...source, selection: sourceSelection }, { language: target, ...targetTrack, selection: targetSelection })) throw new Error('Invalid verified caption bundle.');
  const bundle = { schema: 3, cachePolicy: 'verified-bundle-v1', captionPolicy: 'same-source-v1', videoId, target, createdAt: timestamp, validatedAt: timestamp, lastAccessed: timestamp, sanitizedInfo: cleanInfo, source: { trackKey: source.trackKey, playerTrack: source.playerTrack, selection: sourceSelection, cueSha256: cueDigest(sourceCues), cues: sourceCues }, targetTrack: { language: target, type: targetTrack.type, selection: targetSelection, cueSha256: cueDigest(targetCues), cues: targetCues }, pairId: '' };
  bundle.pairId = pairIdFor(bundle); return bundle;
}
export function createCaptionBundleCache(directory, { now = Date.now, freshnessMs = 86400000, retentionMs = 90 * 86400000, maxBytes = 256 * 1024 * 1024, maxFiles = 512 } = {}) {
  let mutation = Promise.resolve();
  const pathFor = (videoId, target) => { if (!validKey(videoId, target)) throw new Error('Invalid caption bundle cache key.'); return join(directory, `${videoId}.${target}.bundle.json`); };
  const locked = action => { const task = mutation.then(action, action); mutation = task.catch(() => {}); return task; };
  const ensureDirectory = async () => { await mkdir(directory, { recursive: true, mode: 0o700 }); const state = await lstat(directory); if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('Caption bundle cache directory is unsafe.'); };
  const readPath = async path => {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_SUBTITLE_BYTES * 2 + MAX_METADATA_BYTES) return null;
      const raw = await handle.readFile({ encoding: 'utf8' });
      return validateBundle(JSON.parse(raw));
    } catch { return null; } finally { await handle?.close().catch(() => {}); }
  };
  const remove = path => unlink(path).catch(() => {});
  const evict = async () => {
    let files; try { files = await readdir(directory); } catch { return; }
    const entries = [];
    for (const name of files.filter(name => /^[\w-]{11}\.[A-Za-z0-9_-]+\.bundle\.json$/.test(name))) {
      const path = join(directory, name); const stat = await lstat(path).catch(() => null); if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      const bundle = await readPath(path); if (!bundle) { await remove(path); continue; }
      entries.push({ path, name, size: stat.size, accessed: bundle.lastAccessed });
    }
    let bytes = entries.reduce((sum, item) => sum + item.size, 0), filesLeft = entries.length;
    const ordered = entries.sort((a, b) => a.accessed - b.accessed || a.name.localeCompare(b.name));
    for (let index = 0; index < ordered.length && (bytes > maxBytes || filesLeft > maxFiles); index++) {
      const item = ordered[index]; await remove(item.path); bytes -= item.size; filesLeft--;
    }
  };
  const touch = async (path, bundle) => {
    const next = { ...bundle, lastAccessed: now() }; const body = canonical(next);
    const temp = `${path}.${randomUUID()}.tmp`; let handle;
    try { handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); await handle.writeFile(body); await handle.close(); handle = null; await rename(temp, path); } finally { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
  };
  return {
    async read(videoId, target, signal) {
      const path = pathFor(videoId, target); signal?.throwIfAborted();
      try { await ensureDirectory(); } catch { return undefined; }
      const bundle = await readPath(path); if (!bundle) return undefined;
      const time = now();
      if (bundle.validatedAt > time + SKEW_MS || time - bundle.validatedAt > retentionMs) { await locked(() => remove(path)); return undefined; }
      await locked(async () => { await ensureDirectory(); await touch(path, bundle); }).catch(() => {});
      return { bundle, freshness: time - bundle.validatedAt <= freshnessMs ? 'fresh' : 'due' };
    },
    async write(input, signal) {
      signal?.throwIfAborted(); const bundle = validateBundle(input); if (!bundle) return false;
      const path = pathFor(bundle.videoId, bundle.target), body = canonical(bundle);
      if (Buffer.byteLength(body) > MAX_SUBTITLE_BYTES * 2 + MAX_METADATA_BYTES) return false;
      return locked(async () => {
        const temp = `${path}.${randomUUID()}.tmp`; let handle;
        try { await ensureDirectory(); signal?.throwIfAborted(); handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); await handle.writeFile(body); await handle.close(); handle = null; signal?.throwIfAborted(); await rename(temp, path); await evict(); return true; }
        catch { return false; } finally { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
      });
    },
    async findFreshInfo(videoId) {
      if (!VIDEO.test(videoId)) throw new Error('Invalid caption bundle cache key.');
      let files; try { await ensureDirectory(); files = await readdir(directory); } catch { return undefined; }
      for (const name of files.filter(name => name.startsWith(`${videoId}.`) && name.endsWith('.bundle.json')).sort()) {
        const bundle = await readPath(join(directory, name)); const time = now();
        if (bundle?.videoId === videoId && bundle.validatedAt <= time + SKEW_MS && time - bundle.validatedAt <= freshnessMs) return bundle.sanitizedInfo;
      }
      return undefined;
    },
    pathFor,
  };
}
