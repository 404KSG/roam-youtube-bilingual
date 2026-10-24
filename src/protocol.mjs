export const VERSION = '0.2.0-beta.2';
export const SERVICE_ID = 'roam-youtube-bilingual';
export const API_VERSION = 1;
export const PAGE_SIZE = 100;
export const DEFAULT_CONFIG = { service: 'http://127.0.0.1:17321', token: '', source: 'en', target: 'zh-CN', overlay: true };

export function validateConfig(value) {
  let url;
  try { url = new URL(value.service); } catch { throw new Error('请输入完整的本机服务地址，例如 http://127.0.0.1:17321。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('服务地址须为 http://127.0.0.1:端口 或 http://localhost:端口。');
  for (const key of ['source', 'target']) if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value[key])) throw new Error('语言须使用 en、zh-CN、ja 等代码。');
  if (typeof value.token !== 'string' || /[\r\n]/.test(value.token)) throw new Error('配对码格式无效。');
  return { service: url.origin, token: value.token.trim(), source: value.source, target: value.target, overlay: Boolean(value.overlay) };
}

export function configChange(previous, next) {
  if (previous.source !== next.source) return 'source';
  if (previous.target !== next.target || previous.service !== next.service) return 'translation';
  if (previous.token !== next.token) return 'connection';
  return 'display';
}

export function cuePage(length, index = 0) {
  const start = Math.floor(Math.max(0, Math.min(index, length - 1)) / PAGE_SIZE) * PAGE_SIZE;
  return { start, end: Math.min(length, start + PAGE_SIZE) };
}

export function verifyHealth(data) {
  if (data?.service !== SERVICE_ID || data.apiVersion !== API_VERSION || data.ok !== true) throw new Error('不是兼容的双语字幕服务，请更新本机服务并确认端口。');
  return data;
}
