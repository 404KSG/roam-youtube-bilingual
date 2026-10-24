import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const ROAM_BUNDLE = 'com.roam-research.desktop-app';
const localEnv = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));

export function validRect(rect) {
  return rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key])) && Math.abs(rect.x) < 40000 && Math.abs(rect.y) < 40000 && rect.width >= 100 && rect.width <= 12000 && rect.height >= 70 && rect.height <= 12000;
}
function overlap(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height / Math.max(1, Math.max(a.width * a.height, b.width * b.height));
}
function rectOf(frame) { return frame && { x: frame.x, y: frame.y, width: frame.w, height: frame.h }; }
function normalizedTitle(value) { return String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s*[-–—]\s*YouTube\s*$/i, '').replace(/\s+/g, ' ').trim(); }
export function joinCaptionLines(lines, language) {
  const clean = lines.map((line) => String(line).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!/^(zh|ja|yue|cmn|th|lo|km|my)(?:-|$)/i.test(language)) return clean.join(' ');
  return clean.reduce((result, line) => result + (result && /[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(line) ? ' ' : '') + line, '');
}

export function extractCaption(snapshot, { title, frame, target }) {
  if (!validRect(frame) || !Array.isArray(snapshot?.elements)) return null;
  const elements = snapshot.elements;
  const byId = new Map(elements.map((entry) => [entry.element_index, entry]));
  const candidates = elements.filter((entry) => entry.role === 'AXWebArea' && /YouTube\s*$/i.test(entry.label || '') && normalizedTitle(entry.label) === normalizedTitle(title) && validRect(rectOf(entry.frame)))
    .map((entry) => ({ entry, rect: rectOf(entry.frame), score: overlap(frame, rectOf(entry.frame)) })).filter((entry) => entry.score > 0.72).sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  const { entry: player, rect } = candidates[0];
  const ancestry = (entry) => {
    const parents = [], seen = new Set();
    while (entry?.parent_index !== undefined && !seen.has(entry.parent_index)) {
      seen.add(entry.parent_index); entry = byId.get(entry.parent_index); if (!entry) break;
      parents.push(entry); if (entry.element_index === player.element_index) return parents;
    }
    return null;
  };
  const owned = elements.map((entry) => ({ entry, parents: ancestry(entry) })).filter(({ parents }) => parents);
  // Do not mistake caption settings, language pickers, buttons or links for text.
  if (owned.some(({ entry }) => /^AXMenu/.test(entry.role) && entry.frame?.h > 5)) return null;
  const center = rect.x + rect.width / 2;
  const rows = owned.filter(({ entry, parents }) => {
    const b = rectOf(entry.frame), text = entry.value || entry.label || '';
    return entry.role === 'AXStaticText' && b && b.width > 1 && b.height >= 8 && b.height < rect.height * 0.3 && b.y >= rect.y + rect.height * 0.5 && b.y + b.height <= rect.y + rect.height + 3 && Math.abs(b.x + b.width / 2 - center) <= Math.max(10, rect.width * 0.015) && !/^Time (elapsed|duration)/i.test(text) && !/^(?:English|英语|英語)\s*>>/.test(text) && !/^(?:Click|点击|點按).*(?:settings|设置|設定)/i.test(text) && !parents.some((p) => /AX(Button|Link|Menu|Slider|CheckBox)/.test(p.role));
  }).map(({ entry }) => ({ text: entry.value || entry.label, ...rectOf(entry.frame) })).sort((a, b) => b.y - a.y);
  if (!rows.length || rows[0].y + rows[0].height < rect.y + rect.height * 0.82) return null;
  const cluster = [rows[0]];
  for (const row of rows.slice(1)) {
    const previous = cluster.at(-1);
    if (row.y === previous.y && row.text === previous.text) continue;
    if (previous.y - (row.y + row.height) > Math.max(previous.height, row.height) * 0.8 || Math.abs(previous.height - row.height) > Math.max(previous.height, row.height) * 0.25 || cluster.length >= 6) break;
    cluster.push(row);
  }
  cluster.reverse();
  const text = joinCaptionLines(cluster.map((row) => row.text), target);
  if (!text || text.length > 1200) return null;
  const left = Math.min(...cluster.map((row) => row.x)), top = Math.min(...cluster.map((row) => row.y));
  const right = Math.max(...cluster.map((row) => row.x + row.width)), bottom = Math.max(...cluster.map((row) => row.y + row.height));
  return { text, bounds: { left: (left - rect.x) / rect.width, top: (top - rect.y) / rect.height, width: (right - left) / rect.width, height: (bottom - top) / rect.height } };
}

// The caption-reading route is restricted to the same logged-in OS user. Native
// source-caption endpoints remain public, but cannot expose accessibility data.
export function createPeerVerifier({ exec = execute, uid = process.getuid?.(), platform = process.platform } = {}) {
  const peers = new WeakMap();
  return async (socket, port) => {
    if (platform !== 'darwin' || uid === undefined) throw new Error('合并字幕目前仅支持 macOS Roam 桌面版。');
    if (!peers.has(socket)) peers.set(socket, (async () => {
      const peerPort = socket.remotePort;
      if (!Number.isInteger(peerPort) || !['127.0.0.1', '::ffff:127.0.0.1'].includes(socket.remoteAddress)) return false;
      const { stdout } = await exec('/usr/sbin/lsof', ['-nP', `-iTCP:${peerPort}`, '-Fpun'], { timeout: 1800, maxBuffer: 128 * 1024, env: localEnv() });
      let owner, pid, clientPid;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('p')) { owner = undefined; pid = Number(line.slice(1)); }
        if (line.startsWith('u')) owner = Number(line.slice(1));
        if (line.slice(1).split(' ')[0] === `127.0.0.1:${peerPort}->127.0.0.1:${port}` && line[0] === 'n' && owner === uid) clientPid = pid;
      }
      if (!Number.isInteger(clientPid) || clientPid <= 0) return false;
      const processInfo = await exec('/bin/ps', ['-ww', '-p', String(clientPid), '-o', 'comm='], { timeout: 1000, maxBuffer: 8192, env: localEnv() });
      return processInfo.stdout.trim().includes('/Roam Research.app/Contents/');
    })().catch(() => false));
    if (!await peers.get(socket)) throw Object.assign(new Error('字幕读取仅允许当前登录用户的 Roam 桌面进程连接。'), { status: 403 });
  };
}

export function createCaptionReader({ exec = execute, platform = process.platform, now = Date.now } = {}) {
  let discovery, discoveredAt = 0, busy = false;
  const cli = async (tool, args, signal) => {
    const { stdout } = await exec(process.env.CUA_DRIVER_PATH || 'cua-driver', ['call', tool, JSON.stringify(args)], { timeout: 2500, maxBuffer: 1024 * 1024, signal, env: localEnv() });
    return JSON.parse(stdout);
  };
  return {
    async read({ title, frame, target, signal }) {
      if (platform !== 'darwin') throw new Error('同框字幕目前需要 macOS Roam 桌面版的本机只读桥。');
      if (busy) return { matched: false, reason: 'busy' };
      busy = true;
      try {
        // Never enable permissions, launch apps, change settings, or record.
        const recording = await cli('get_recording_state', {}, signal);
        if (recording.enabled || recording.recording || recording.video_active) throw new Error('辅助工具正在录制，已暂停字幕读取。');
        if (!discovery || now() - discoveredAt > 5000) {
          const { stdout } = await exec(process.env.CUA_DRIVER_PATH || 'cua-driver', ['permissions', 'status', '--json'], { timeout: 2000, maxBuffer: 65536, signal, env: localEnv() });
          const permissions = JSON.parse(stdout);
          if (permissions.accessibility !== true || permissions.source?.attribution !== 'driver-daemon') throw new Error('本机字幕读取组件尚未就绪；不会自动申请或更改系统权限。');
          const apps = await cli('list_apps', {}, signal);
          const app = apps.apps?.find((item) => item.bundle_id === ROAM_BUNDLE && item.running && Number.isInteger(item.pid) && item.pid > 0);
          if (!app) throw new Error('请在 Roam Research 桌面版中打开视频。');
          const windows = await cli('list_windows', { pid: app.pid }, signal);
          discovery = { pid: app.pid, windows: windows.windows.filter((window) => window.is_on_screen && window.bounds.width > 200 && window.bounds.height > 150).map(({ window_id, bounds, z_index }) => ({ window_id, bounds, z_index })) };
          discoveredAt = now();
        }
        const windows = discovery.windows.filter((window) => {
          const b = window.bounds, cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
          return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
        }).sort((a, b) => b.z_index - a.z_index);
        if (!windows.length) { discovery = null; return { matched: false, reason: 'window-not-visible' }; }
        const started = now();
        const snapshot = await cli('get_window_state', { pid: discovery.pid, window_id: windows[0].window_id, include_screenshot: false, max_depth: 4, max_elements: 600 }, signal);
        const ended = now();
        const playerVisible = snapshot.elements?.some((entry) => entry.role === 'AXWebArea' && /YouTube\s*$/i.test(entry.label || '') && normalizedTitle(entry.label) === normalizedTitle(title));
        if (!playerVisible) return { matched: false, reason: 'player-not-visible', retryAfterMs: 1500 };
        // Only this sanitized result survives. No AX tree, note content, app
        // titles, screenshots, or raw errors are returned or persisted.
        const caption = extractCaption(snapshot, { title, frame, target });
        return caption ? { matched: true, ...caption, sampledAt: Math.round((started + ended) / 2), durationMs: ended - started } : { matched: false, reason: 'no-matching-caption' };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        discovery = null;
        const safe = ['合并字幕', '同框字幕', '辅助工具正在录制', '本机字幕读取组件', '请在 Roam Research'];
        throw new Error(safe.some((prefix) => error.message?.startsWith(prefix)) ? error.message : '暂时无法读取当前视频字幕，请保持 Roam 桌面窗口可见，并确认本机只读桥已就绪。');
      } finally { busy = false; }
    },
  };
}
