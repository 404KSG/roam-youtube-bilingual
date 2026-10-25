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

// A missing checkbox is unknown, not off: the player can temporarily omit its
// controls while loading. Only YouTube's explicit AX label opens the renderer.
export function nativeCcState(snapshot, { title, frame }) {
  if (!validRect(frame) || !Array.isArray(snapshot?.elements)) return 'unknown';
  const elements = snapshot.elements;
  const player = elements.filter((entry) => entry.role === 'AXWebArea' && /YouTube\s*$/i.test(entry.label || '') && normalizedTitle(entry.label) === normalizedTitle(title) && validRect(rectOf(entry.frame)))
    .map((entry) => ({ entry, score: overlap(frame, rectOf(entry.frame)) })).filter((candidate) => candidate.score > 0.72).sort((a, b) => b.score - a.score)[0]?.entry;
  if (!player) return 'unknown';
  const playerRect = rectOf(player.frame), byIndex = new Map(elements.map(entry => [entry.element_index, entry]));
  const belongsToPlayer = (entry) => {
    const visited = new Set();
    while (entry && !visited.has(entry.element_index)) {
      if (entry.element_index === player.element_index) return true;
      visited.add(entry.element_index); entry = byIndex.get(entry.parent_index);
    }
    return false;
  };
  const checkbox = elements.find((entry) => {
    const rect = rectOf(entry.frame), cx = rect && rect.x + rect.width / 2, cy = rect && rect.y + rect.height / 2;
    return entry.role === 'AXCheckBox' && belongsToPlayer(entry) && rect && rect.width > 0 && rect.height > 0 && Number.isFinite(cx) && Number.isFinite(cy) && cx >= playerRect.x && cx <= playerRect.x + playerRect.width && cy >= playerRect.y && cy <= playerRect.y + playerRect.height;
  });
  if (!checkbox) return 'unknown';
  const label = String(checkbox.label || checkbox.value || '').trim();
  if (label === 'Subtitles/CC turned on') return 'on';
  if (label === 'Subtitles/CC turned off') return 'off';
  return 'unknown';
}

// The native-state route is restricted to the same logged-in OS user. It does
// not return captions, screenshots, AX trees, or arbitrary accessibility data.
export function createPeerVerifier({ exec = execute, uid = process.getuid?.(), platform = process.platform } = {}) {
  const peers = new WeakMap();
  return async (socket, port) => {
    if (platform !== 'darwin' || uid === undefined) throw new Error('Native caption checks require the macOS Roam desktop app.');
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
    if (!await peers.get(socket)) throw Object.assign(new Error('Native caption checks accept only the current user\'s Roam desktop process.'), { status: 403 });
  };
}

export function createCaptionReader({ exec = execute, platform = process.platform, now = Date.now } = {}) {
  let discovery, discoveredAt = 0, busy = false;
  const cli = async (tool, args, signal) => {
    const { stdout } = await exec(process.env.CUA_DRIVER_PATH || 'cua-driver', ['call', tool, JSON.stringify(args)], { timeout: 2500, maxBuffer: 1024 * 1024, signal, env: localEnv() });
    return JSON.parse(stdout);
  };
  return {
    async read({ title, frame, signal }) {
      if (platform !== 'darwin') throw new Error('Native caption checks require the local read-only helper and macOS Roam desktop.');
      if (busy) return { state: 'unknown', reason: 'busy' };
      busy = true;
      try {
        const recording = await cli('get_recording_state', {}, signal);
        if (recording.enabled || recording.recording || recording.video_active) throw new Error('The accessibility helper is recording. Native caption checks are paused.');
        if (!discovery || now() - discoveredAt > 5000) {
          const { stdout } = await exec(process.env.CUA_DRIVER_PATH || 'cua-driver', ['permissions', 'status', '--json'], { timeout: 2000, maxBuffer: 65536, signal, env: localEnv() });
          const permissions = JSON.parse(stdout);
          if (permissions.accessibility !== true || permissions.source?.attribution !== 'driver-daemon') throw new Error('The accessibility helper is not ready. Permissions will not be changed automatically.');
          const apps = await cli('list_apps', {}, signal);
          const app = apps.apps?.find((item) => item.bundle_id === ROAM_BUNDLE && item.running && Number.isInteger(item.pid) && item.pid > 0);
          if (!app) throw new Error('Open the video in the Roam Research desktop app.');
          const windows = await cli('list_windows', { pid: app.pid }, signal);
          discovery = { pid: app.pid, windows: windows.windows.filter((window) => window.is_on_screen && window.bounds.width > 200 && window.bounds.height > 150).map(({ window_id, bounds, z_index }) => ({ window_id, bounds, z_index })) };
          discoveredAt = now();
        }
        const windows = discovery.windows.filter((window) => {
          const b = window.bounds, cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
          return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
        }).sort((a, b) => b.z_index - a.z_index);
        if (!windows.length) { discovery = null; return { state: 'unknown', reason: 'window-not-visible' }; }
        const snapshot = await cli('get_window_state', { pid: discovery.pid, window_id: windows[0].window_id, include_screenshot: false, max_depth: 4, max_elements: 600 }, signal);
        return { state: nativeCcState(snapshot, { title, frame }) };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        discovery = null;
        const safe = ['Native caption checks', 'The accessibility helper', 'Open the video in'];
        throw new Error(safe.some((prefix) => error.message?.startsWith(prefix)) ? error.message : 'Native caption state is unavailable. Keep the Roam desktop window visible and check the local read-only helper.');
      } finally { busy = false; }
    },
  };
}
