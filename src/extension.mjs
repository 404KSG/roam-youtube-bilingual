import { MAX_SUBTITLE_BYTES, videoIdFromUrl, parseSubtitles, normalizeCues, activeCueIndex, formatTime, translationWindow, validateTranslations } from './core.mjs';
import { YouTubeClock } from './clock.mjs';
import { VideoSurface } from './surface.mjs';
import { VERSION, DEFAULT_CONFIG, validateConfig, configChange, verifyHealth } from './protocol.mjs';

const STORAGE_KEY = 'roam-youtube-bilingual/session/v1';
const commandLabel = 'YouTube 双语字幕：连接与设置';
const videos = new Map();
let config = { ...DEFAULT_CONFIG };
let active = false;
let observer, scanTimer, surfaceTimer, settings;
let commandRegistered = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, callback, className = '') {
  const node = element('button', className, text); node.type = 'button';
  node.addEventListener('click', callback); return node;
}
function saveConfig(next) {
  const change = configChange(config, next);
  const serviceChanged = config.service !== next.service;
  config = next;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* Session-only storage is optional. */ }
  for (const video of videos.values()) {
    if (change !== 'display') {
      video.turnOff();
      if (change === 'source' || serviceChanged || change === 'provider') video.cues = [];
      if (change === 'source' || change === 'translation' || change === 'provider') video.translations.clear();
      video.render();
    }
  }
  syncSurfaces();
}
async function request(path, body, signal, cfg = config) {
  const nativeRequest = path.startsWith('/v1/youtube/');
  if (!nativeRequest && !cfg.token) throw new Error('自定义 API 模式需要本机服务配对码；YouTube 模式不需要。');
  let response;
  try {
    response = await fetch(`${cfg.service}${path}`, {
      method: body === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit',
      headers: { ...(!nativeRequest ? { Authorization: `Bearer ${cfg.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(90000)]),
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
    if (error.name === 'TimeoutError') throw new Error('字幕请求超时，请稍后重试。');
    throw new Error(nativeRequest ? '本机原字幕服务未连接。请先运行 start.command；YouTube 模式不需要 API Key 或配对码。' : '无法连接本机服务，请运行 start.command 并检查 API 模式配对码。');
  }
  let data;
  try { data = await response.json(); }
  catch { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); throw new Error('本机服务响应无效，请确认端口。'); }
  if (!response.ok) {
    if (nativeRequest && [401, 404].includes(response.status)) throw new Error('本机服务可能仍是旧版，请重启 start.command。YouTube 模式不需要配对码。');
    throw new Error(data?.error || `本机服务返回 HTTP ${response.status}`);
  }
  return data;
}
function assertTranslationReady(health, provider) {
  if (provider === 'youtube') {
    if (health.demo || health.provider !== 'youtube-native') throw new Error('请运行正式的 npm start，而不是演示服务。YouTube 模式不需要 API。');
  } else if (!health.demo && !health.apiConfigured) throw new Error('自定义 API 尚未配置。可以改用默认的“YouTube 自带翻译”，无需 Key。');
}
function disposeSettings(ref) {
  if (!ref || ref.disposed) return;
  ref.disposed = true; ref.request?.abort();
  if (ref.dialog.open) ref.dialog.close();
  ref.host.remove();
  if (settings === ref) settings = null;
  syncSurfaces();
}
function openSettings(owner = null) {
  if (settings) { settings.dialog.focus(); return; }
  const host = element('div', 'ryb-settings-host');
  host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = element('style'); sheet.textContent = STYLE;
  const dialog = element('dialog', 'ryb-settings');
  for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) dialog.addEventListener(type, (event) => event.stopPropagation());
  const ref = { host, dialog, owner, disposed: false };
  settings = ref;
  dialog.addEventListener('close', () => disposeSettings(ref));
  const form = element('form'); form.method = 'dialog';
  form.addEventListener('submit', (event) => event.preventDefault());
  form.append(element('h2', '', '视频内双语字幕'), element('p', 'ryb-muted', `${VERSION} · 原文与译文只显示在视频画面内，不在下方创建面板。`));
  const fields = {};
  const providerLabel = element('label', 'ryb-field');
  providerLabel.append(element('span', '', '翻译来源'));
  const provider = element('select'); provider.name = 'provider';
  for (const [value, text] of [['youtube', 'YouTube 自带翻译（默认，无需 API）'], ['api', '自定义 API（可选）']]) {
    const option = element('option', '', text); option.value = value; provider.append(option);
  }
  provider.value = config.provider; fields.provider = provider;
  providerLabel.append(provider); form.append(providerLabel);
  function field(key, label, type = 'text', options = {}) {
    const wrapper = element('label', 'ryb-field'); wrapper.append(element('span', '', label));
    const input = element('input'); input.name = key; input.type = type;
    input.value = options.value ?? config[key]; input.autocomplete = 'off'; input.spellcheck = false;
    for (const name of ['min', 'max', 'step']) if (options[name] !== undefined) input[name] = options[name];
    fields[key] = input; wrapper.append(input); return wrapper;
  }
  const appearance = element('div', 'ryb-setting-grid');
  appearance.append(field('fontScale', '字幕大小（1 为默认）', 'number', { min: '0.75', max: '1.6', step: '0.05' }), field('bottomRatio', '英文距底部比例（YouTube 默认 0.18）', 'number', { min: '0.02', max: '0.25', step: '0.01' }));
  form.append(appearance);
  const status = element('p', 'ryb-setting-status'); status.setAttribute('role', 'status');
  const readValues = () => validateConfig({ ...Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'offset').map(([key, input]) => [key, input.value.trim()])) });
  const apply = () => {
    const next = readValues(); saveConfig(next);
    if (owner && !owner.disposed && fields.offset) { owner.offset = Math.max(-3600, Math.min(3600, Number(fields.offset.value) || 0)); owner.render(); }
    return next;
  };
  const languages = element('div', 'ryb-setting-grid');
  languages.append(field('source', '原字幕语言，例如 en'), field('target', '译文语言，例如 zh-CN'));
  form.append(languages, field('service', '本机原字幕服务地址'));
  const nativeHelp = element('p', 'ryb-muted', '中文由 YouTube 播放器自带翻译显示，插件只同步叠加英文。无需 API Key、模型或配对码。本机服务仅用于获取原文字幕。');
  const apiBox = element('div', 'ryb-api-config');
  apiBox.append(field('token', 'API 模式配对码（不是 API Key）', 'password'), element('p', 'ryb-muted', '仅自定义 API 模式需要本机 .env 中的 Key 和模型。原字幕会发送到你配置的供应商，并可能产生费用。'));
  const updateProviderUI = () => { apiBox.hidden = provider.value !== 'api'; nativeHelp.hidden = provider.value !== 'youtube'; };
  provider.addEventListener('change', () => {
    if ([0.08, 0.18].includes(Number(fields.bottomRatio.value))) fields.bottomRatio.value = provider.value === 'youtube' ? '0.18' : '0.08';
    updateProviderUI();
  });
  updateProviderUI(); form.append(nativeHelp, apiBox);
  if (owner) {
    const advanced = element('details', 'ryb-advanced');
    advanced.append(element('summary', '', '字幕文件、同步与全屏'));
    const input = element('input', 'ryb-file'); input.type = 'file'; input.accept = '.srt,.vtt,.json,.json3'; input.setAttribute('aria-label', '选择字幕文件');
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      const importId = ref.importId = (ref.importId || 0) + 1;
      try {
        if (file.size > MAX_SUBTITLE_BYTES) throw new Error('字幕文件须小于 5 MB。');
        const cues = parseSubtitles(await file.text());
        if (ref.disposed || owner.disposed || ref.importId !== importId) return;
        owner.turnOff(); owner.assignCues(cues);
        status.textContent = `已导入 ${cues.length} 条字幕。点击“保存并开启双语”开始翻译。`;
      } catch (error) { status.textContent = error.message; }
      finally { input.value = ''; }
    });
    const actions = element('div', 'ryb-actions');
    actions.append(button('导入 SRT / VTT', () => input.click()), button('重新获取字幕', () => { owner.turnOff(); owner.cues = []; owner.translations.clear(); status.textContent = '已清除本视频缓存，下次开启时重新获取字幕。'; }));
    const full = button('双语全屏', () => {
      disposeSettings(ref);
      void owner.surface.toggleFullscreen().catch((error) => owner.notice(error.message));
    });
    actions.append(full);
    advanced.append(actions, input, field('offset', '时间偏移（正数让字幕延后，秒）', 'number', { min: '-3600', max: '3600', step: '0.5', value: String(owner.offset) }), element('p', 'ryb-muted', `已载入 ${owner.cues.length} 条原文，当前 ${formatTime(owner.time)}。YouTube 模式需要保留原生 CC，它负责显示中文；关闭“双语”仅收起英文。如果未自动切换，请在 YouTube 字幕菜单选择自动翻译→中文。保持两种字幕的全屏请用上方“双语全屏”。`));
    form.append(advanced);
  }
  const actions = element('div', 'ryb-actions');
  const check = button('检查连接', async () => {
    check.disabled = true;
    try {
      const next = readValues(); ref.request?.abort(); ref.request = new AbortController();
      const health = verifyHealth(await request(next.provider === 'youtube' ? '/v1/youtube/health' : '/health', undefined, ref.request.signal, next));
      if (ref.disposed) return;
      if (next.provider === 'youtube') { assertTranslationReady(health, next.provider); status.textContent = 'YouTube 原生双语服务已连接，无需 API 或配对码。'; }
      else status.textContent = health.demo ? '已连接 API 演示服务，并非真实翻译。' : health.apiConfigured ? '自定义 API 模型已配置。' : '自定义 API 尚未配置；也可直接选 YouTube 自带翻译。';
    } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
    finally { check.disabled = false; }
  });
  const start = button(owner ? '保存并开启双语' : '保存设置', () => {
    try { apply(); disposeSettings(ref); if (owner && !owner.disposed) void owner.turnOn(); }
    catch (error) { status.textContent = error.message; }
  }, 'ryb-primary');
  actions.append(check, start, button('关闭', () => disposeSettings(ref)));
  form.append(status, actions); dialog.append(form); shadow.append(sheet, dialog);
  const fs = document.fullscreenElement;
  (fs && owner && fs.contains(owner.iframe) ? fs : document.body).append(host);
  dialog.showModal(); syncSurfaces();
}

class VideoCaptions {
  constructor(iframe) {
    this.iframe = iframe;
    this.videoId = videoIdFromUrl(iframe.src); this.embedId = this.videoId;
    this.cues = []; this.translations = new Map(); this.epoch = 0;
    this.enabled = false; this.loading = false; this.time = 0; this.offset = 0;
    this.lastAttempt = 0;
    this.surface = new VideoSurface(iframe, STYLE);
    for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) this.surface.scene.addEventListener(type, (event) => event.stopPropagation());
    this.surface.host.dataset.version = VERSION;
    this.surface.host.dataset.video = this.videoId;
    this.toggleButton = button('双语', () => {
      if (this.enabled) this.turnOff(); else void this.turnOn();
    }, 'ryb-toggle');
    this.toggleButton.title = '在视频画面内显示原文和译文';
    this.optionsButton = button('⋯', () => openSettings(this), 'ryb-options');
    this.optionsButton.setAttribute('aria-label', '字幕设置'); this.optionsButton.title = '字幕设置';
    const controls = element('div', 'ryb-controls'); controls.append(this.toggleButton, this.optionsButton);
    this.caption = element('div', 'ryb-captions'); this.caption.hidden = true;
    this.caption.setAttribute('aria-label', '视频内双语字幕');
    this.previewLabel = element('span', 'ryb-preview-label');
    this.source = element('span', 'ryb-source'); this.target = element('span', 'ryb-target');
    this.caption.append(this.previewLabel, this.source, this.target);
    this.noticeBox = element('div', 'ryb-notice'); this.noticeBox.hidden = true;
    this.noticeText = element('span'); this.noticeText.setAttribute('role', 'status');
    const close = button('×', () => this.clearNotice(), 'ryb-dismiss'); close.setAttribute('aria-label', '关闭字幕提示');
    this.noticeBox.append(this.noticeText, close);
    this.surface.scene.append(controls, this.caption, this.noticeBox);
    this.render();
  }
  notice(text, duration = 0) {
    if (this.disposed) return;
    clearTimeout(this.noticeTimer); this.noticeText.textContent = text; this.noticeBox.hidden = !text;
    if (duration) this.noticeTimer = setTimeout(() => this.clearNotice(), duration);
  }
  clearNotice() { clearTimeout(this.noticeTimer); this.noticeBox.hidden = true; this.noticeText.textContent = ''; }
  connect() {
    if (this.clock) return;
    this.clock = new YouTubeClock(this.iframe, (time) => {
      if (this.disposed) return;
      this.time = time; this.render();
      if (this.enabled && Date.now() - this.lastAttempt > 1500) void this.translateNear();
    }, (state) => {
      if (this.enabled && /未收到|中断/.test(state)) this.notice(state);
    }, (id) => {
      this.turnOff(); this.videoId = id; this.surface.host.dataset.video = id;
      this.cues = []; this.translations.clear(); this.notice('视频已切换。点击“双语”加载新视频字幕。', 5000);
    });
  }
  assignCues(cues) {
    if (!cues.length) throw new Error('没有可用字幕。请尝试导入 SRT / VTT。');
    if (cues.some((cue) => cue.text.length > 5500)) throw new Error('单条字幕超过 5500 个字符，请先拆分。');
    this.cues = cues; this.translations.clear(); this.render();
  }
  async turnOn() {
    if (this.disposed || this.enabled) return;
    if (config.provider === 'api' && !config.token) { openSettings(this); return; }
    for (const video of videos.values()) if (video !== this) video.turnOff();
    this.turnOff();
    this.enabled = true; this.loading = true;
    const epoch = this.epoch, cfg = { ...config }, controller = new AbortController();
    this.startRequest = controller;
    this.notice('正在连接字幕服务…'); this.render();
    try {
      const native = cfg.provider === 'youtube';
      if (!native || !this.cues.length) {
        const health = verifyHealth(await request(native ? '/v1/youtube/health' : '/health', undefined, controller.signal, cfg));
        assertTranslationReady(health, cfg.provider); this.demo = Boolean(health.demo);
      } else this.demo = false;
      if (!this.cues.length) {
        this.notice(`正在获取 ${cfg.source} 原字幕…`);
        const data = await request(native ? '/v1/youtube/captions' : '/v1/captions', { videoId: this.videoId, language: cfg.source }, controller.signal, cfg);
        if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
        if (data.videoId !== this.videoId || data.language !== cfg.source || native && data.demo) throw new Error('字幕来源与当前视频不匹配，请更新本机服务。');
        this.assignCues(normalizeCues(data.cues));
        this.demo = Boolean(data.demo);
      }
      if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
      this.connect();
      if (native) {
        this.clock.setNativeTranslation(cfg.source, cfg.target);
        this.notice('英文已载入。中文字幕由 YouTube 自带翻译提供；若未出现，请在播放器字幕菜单选择中文。', 6500);
      } else this.notice('字幕已载入，正在准备 API 译文…');
    } catch (error) {
      if (error.name !== 'AbortError' && !controller.signal.aborted && epoch === this.epoch) { this.turnOff(); this.notice(error.message); }
    } finally {
      if (this.startRequest === controller) { this.startRequest = null; this.loading = false; this.render(); }
    }
  }
  turnOff() {
    this.epoch++; this.enabled = false; this.loading = false;
    this.clock?.clearNativeTranslation();
    this.startRequest?.abort(); this.startRequest = null;
    this.translationRequest?.abort(); this.translationRequest = null;
    this.clearNotice(); this.render();
  }
  render() {
    if (!this.toggleButton || this.disposed) return;
    this.toggleButton.textContent = this.loading ? '加载中' : '双语';
    this.toggleButton.setAttribute('aria-label', this.enabled ? '关闭双语字幕' : '开启双语字幕');
    this.toggleButton.setAttribute('aria-pressed', String(this.enabled));
    this.toggleButton.setAttribute('aria-busy', String(this.loading));
    this.surface.host.dataset.enabled = String(this.enabled);
    this.previewLabel.textContent = this.demo ? 'API 演示预置字幕 · 非视频转录' : '';
    this.surface.host.dataset.provider = config.provider;
    const index = activeCueIndex(this.cues, this.time - this.offset);
    const cue = this.cues[index];
    const visible = this.enabled && !this.loading && this.clock?.isSynchronized() && cue;
    this.caption.hidden = !visible;
    this.source.textContent = visible ? cue.text : '';
    // YouTube renders the real target-language caption inside its iframe. Do not
    // replace it with a placeholder, preview string, or an external AI response.
    this.target.textContent = visible && config.provider === 'api' ? this.translations.get(cue.id) || '译文加载中…' : '';
  }
  async translateNear() {
    if (config.provider !== 'api' || !this.enabled || this.loading || this.disposed || this.translationRequest || document.hidden || !this.clock?.isSynchronized()) return;
    this.lastAttempt = Date.now();
    const entries = translationWindow(this.cues, this.time - this.offset, this.translations);
    if (!entries.length) return;
    const controller = new AbortController(), epoch = this.epoch, cfg = { ...config };
    this.translationRequest = controller;
    try {
      const data = await request('/v1/translate', { entries, target: cfg.target }, controller.signal, cfg);
      if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
      if (data.target !== cfg.target) throw new Error('译文语言不匹配，请更新本机服务。');
      for (const entry of validateTranslations(data.translations, entries)) this.translations.set(entry.id, entry.text);
      this.clearNotice(); this.render();
    } catch (error) {
      if (error.name !== 'AbortError' && !controller.signal.aborted && epoch === this.epoch) { this.turnOff(); this.notice(`${error.message} 可在字幕设置中检查连接。`); }
    } finally { if (this.translationRequest === controller) this.translationRequest = null; }
  }
  destroy() {
    this.turnOff(); this.disposed = true;
    this.clock?.destroy(); this.surface.destroy();
    if (settings?.owner === this) disposeSettings(settings);
  }
}
function syncSurfaces() {
  if (!active) return;
  for (const video of videos.values()) {
    video.surface.sync({ blocked: !!settings?.dialog.open, fontScale: config.fontScale, bottomRatio: config.bottomRatio });
  }
}
function scan() {
  if (!active) return;
  for (const [iframe, video] of videos) {
    if (!iframe.isConnected || videoIdFromUrl(iframe.src) !== video.embedId) { video.destroy(); videos.delete(iframe); }
  }
  for (const iframe of document.querySelectorAll('iframe[src]')) {
    if (videos.has(iframe) || !videoIdFromUrl(iframe.src) || !new URL(iframe.src).pathname.startsWith('/embed/')) continue;
    videos.set(iframe, new VideoCaptions(iframe));
  }
  syncSurfaces();
}
function onload() {
  onunload(); active = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    config = validateConfig({ ...DEFAULT_CONFIG, ...saved, provider: saved.provider });
  } catch { config = { ...DEFAULT_CONFIG }; }
  observer = new MutationObserver((records) => {
    if (records.every((record) => record.target instanceof Element && record.target.closest('.ryb-surface-host,.ryb-settings-host'))) return;
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  surfaceTimer = setInterval(syncSurfaces, 120);
  if (window.roamAlphaAPI?.ui?.commandPalette) {
    window.roamAlphaAPI.ui.commandPalette.addCommand({ label: commandLabel, callback: () => openSettings([...videos.values()][0] || null) }); commandRegistered = true;
  }
  scan();
}
function onunload() {
  active = false; observer?.disconnect(); observer = null;
  clearTimeout(scanTimer); scanTimer = null; clearInterval(surfaceTimer); surfaceTimer = null;
  disposeSettings(settings);
  for (const video of videos.values()) video.destroy(); videos.clear();
  if (commandRegistered) window.roamAlphaAPI?.ui?.commandPalette?.removeCommand({ label: commandLabel });
  commandRegistered = false;
}
export default { onload, onunload };
