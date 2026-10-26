export const VERSION = '0.5.0-beta.11';
export const SERVICE_ID = 'roam-youtube-bilingual';
export const API_VERSION = 7;
export const SERVICE_URL = 'http://127.0.0.1:17321';
export const DEFAULT_CONFIG = { target: 'zh-Hans', sourceFontSize: 16, targetFontSize: 20, sourceColor: '#c7cad6', targetColor: '#ffffff' };
export function youtubeLanguage(code) {
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(code || '')) throw new Error('Invalid subtitle language.');
  const aliases = { 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant' };
  return aliases[code.toLowerCase()] || code;
}
export function validateConfig(value = {}) {
  const target = youtubeLanguage(value.target || DEFAULT_CONFIG.target);
  const legacySize = value.fontSize ?? (value.fontScale ? Math.round(Number(value.fontScale) * 20) : undefined);
  const sourceFontSize = Number(value.sourceFontSize ?? legacySize ?? DEFAULT_CONFIG.sourceFontSize);
  const targetFontSize = Number(value.targetFontSize ?? legacySize ?? DEFAULT_CONFIG.targetFontSize);
  if ([sourceFontSize, targetFontSize].some(size => !Number.isFinite(size) || size < 12 || size > 36)) throw new Error('Font size must be between 12 and 36 px.');
  const color = (input, fallback) => {
    const selected = input ?? fallback;
    if (typeof selected !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(selected)) throw new Error('Choose a six-digit hex color.');
    return selected.toLowerCase();
  };
  return { target, sourceFontSize, targetFontSize, sourceColor: color(value.sourceColor, DEFAULT_CONFIG.sourceColor), targetColor: color(value.targetColor, DEFAULT_CONFIG.targetColor) };
}
export function verifyHealth(data) {
  if (data?.service !== SERVICE_ID || data.apiVersion !== API_VERSION || data.provider !== 'youtube-unified' || data.ok !== true) throw new Error('Restart start.command to load the matching subtitle helper.');
  return data;
}
export function singleLine(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
export function fittedFontSize(requested, availableWidth, measuredWidth) {
  if (![requested, availableWidth, measuredWidth].every(Number.isFinite) || requested <= 0 || availableWidth <= 0 || measuredWidth < 0) return 0;
  return Math.min(requested, measuredWidth ? requested * Math.max(1, availableWidth - 2) / measuredWidth : requested);
}
