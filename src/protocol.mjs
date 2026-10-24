export const VERSION = '0.4.0-beta.1';
export const SERVICE_ID = 'roam-youtube-bilingual';
export const API_VERSION = 1;
export const DEFAULT_CONFIG = { provider: 'youtube', service: 'http://127.0.0.1:17321', token: '', source: 'en', target: 'zh-CN', fontScale: 1, bottomRatio: 0.18 };

export function validateConfig(value) {
  let url;
  try { url = new URL(value.service); } catch { throw new Error('请输入完整的本机服务地址，例如 http://127.0.0.1:17321。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('服务地址须为 http://127.0.0.1:端口 或 http://localhost:端口。');
  for (const key of ['source', 'target']) if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value[key])) throw new Error('语言须使用 en、zh-CN、ja 等代码。');
  if (typeof value.token !== 'string' || /[\r\n]/.test(value.token)) throw new Error('配对码格式无效。');
  const provider = value.provider ?? 'youtube';
  if (!['youtube', 'api'].includes(provider)) throw new Error('请选择 YouTube 自带翻译或自定义 API。');
  const fontScale = Number(value.fontScale ?? 1);
  const bottomRatio = Number(value.provider === undefined ? 0.18 : value.bottomRatio ?? (provider === 'youtube' ? 0.18 : 0.08));
  if (!Number.isFinite(fontScale) || fontScale < 0.75 || fontScale > 1.6) throw new Error('字幕大小须在 0.75–1.6 之间。');
  if (!Number.isFinite(bottomRatio) || bottomRatio < 0.02 || bottomRatio > 0.25) throw new Error('距底部比例须在 0.02–0.25 之间。');
  return { provider, service: url.origin, token: value.token.trim(), source: value.source, target: value.target, fontScale, bottomRatio };
}

export function configChange(previous, next) {
  if (previous.provider !== next.provider) return 'provider';
  if (previous.source !== next.source) return 'source';
  if (previous.target !== next.target || previous.service !== next.service) return 'translation';
  if (previous.token !== next.token) return 'connection';
  return 'display';
}

export function nativeCaptionTrack(source, target) {
  for (const language of [source, target]) if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) throw new Error('无效的字幕语言。');
  const aliases = { 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant' };
  return { languageCode: aliases[source.toLowerCase()] || source, translationLanguage: { languageCode: aliases[target.toLowerCase()] || target } };
}

export function verifyHealth(data) {
  if (data?.service !== SERVICE_ID || data.apiVersion !== API_VERSION || data.ok !== true) throw new Error('不是兼容的双语字幕服务，请更新本机服务并确认端口。');
  return data;
}
