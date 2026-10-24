import { MAX_SUBTITLE_BYTES, videoIdFromUrl, parseSubtitles, normalizeCues, activeCueIndex, formatTime, translationWindow, validateTranslations, exportMarkdown } from './core.mjs';
import { YouTubeClock } from './clock.mjs';
import { mountPanel } from './mount.mjs';
import { VERSION, DEFAULT_CONFIG, PAGE_SIZE, validateConfig, configChange, cuePage, verifyHealth } from './protocol.mjs';

const STORAGE_KEY = 'roam-youtube-bilingual/session/v1';
let config = { ...DEFAULT_CONFIG };
let active = false;
let observer;
let scanTimer;
let style;
let dialog;
let settingsRequest;
let commandRegistered = false;
const panels = new Map();
const commandLabel = 'YouTube 双语字幕：连接与设置';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, onClick, className = '') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
function saveConfig() {
  // Pairing token is session-only; never written through roamAlphaAPI/settings.
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* Private storage may be unavailable. */ }
}
async function request(path, body, signal, cfg = config) {
  if (!cfg.token) throw new Error('请先打开“设置”，填写本机服务配对码。导入字幕不需要配对码。');
  let response;
  try {
    response = await fetch(`${cfg.service}${path}`, {
      method: body === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit',
      headers: { Authorization: `Bearer ${cfg.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(90000)]),
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
    if (error.name === 'TimeoutError') throw new Error('本机请求超时，请检查服务终端后重试。');
    throw new Error('无法连接本机服务。请运行 npm start，并检查本地网络访问提示与服务端口。');
  }
  let data;
  try { data = await response.json(); } catch { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); throw new Error('本机服务响应异常，请确认端口指向此插件服务。'); }
  if (!response.ok) throw new Error(data?.error || `本机服务返回 HTTP ${response.status}`);
  return data;
}

function openSettings() {
  if (dialog) { dialog.showModal(); return; }
  dialog = element('dialog', 'ryb-settings');
  const openedDialog = dialog;
  dialog.addEventListener('close', () => {
    settingsRequest?.abort(); settingsRequest = null;
    openedDialog.remove(); if (dialog === openedDialog) dialog = null;
  });
  const form = element('form');
  form.method = 'dialog';
  const title = element('h2', '', `连接你的翻译服务 · ${VERSION}`);
  const description = element('p', 'ryb-muted', 'API Key 写在电脑上的 .env 文件中；这里填写的是本机服务配对码。连接信息仅保留在当前窗口会话。');
  const fields = {};
  const addField = (key, label, type = 'text') => {
    const wrapper = element('label', 'ryb-field');
    wrapper.append(element('span', '', label));
    const input = element('input');
    input.name = key;
    input.type = type;
    input.value = config[key];
    input.autocomplete = 'off';
    input.spellcheck = false;
    wrapper.append(input);
    fields[key] = input;
    form.append(wrapper);
  };
  form.append(title, description);
  addField('service', '本机服务地址');
  addField('token', '本机服务配对码', 'password');
  addField('source', '原字幕语言（例如 en）');
  addField('target', '译文语言（例如 zh-CN）');
  const overlayLabel = element('label', 'ryb-check');
  const overlay = element('input');
  overlay.type = 'checkbox'; overlay.checked = config.overlay;
  overlayLabel.append(overlay, document.createTextNode(' 在视频画面内显示双语字幕'));
  const status = element('p', 'ryb-status'); status.setAttribute('role', 'status');
  const apply = () => {
    const next = validateConfig({ ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()])), overlay: overlay.checked });
    const change = configChange(config, next);
    config = next;
    for (const panel of panels.values()) {
      if (change === 'source') { panel.reset(); panel.setStatus('原字幕语言已改变，请重新获取字幕。'); }
      else if (change === 'translation') { panel.invalidateTranslation(); panel.setStatus('已保留原字幕，点击开始翻译以使用新的译文设置。'); }
      else if (change === 'connection') { panel.stop(); panel.cancelCaptions(); panel.setStatus('配对码已更新，可重新获取或开始翻译。'); }
      panel.positionOverlay();
    }
    saveConfig();
    return next;
  };
  const actions = element('div', 'ryb-actions');
  const connect = button('连接并检查', async () => {
    connect.disabled = true;
    try {
      const next = apply();
      settingsRequest?.abort(); settingsRequest = new AbortController();
      const data = verifyHealth(await request('/health', undefined, settingsRequest.signal, next));
      if (!active || !openedDialog.isConnected) return;
      status.textContent = data.demo ? '已连接演示服务：使用预置字幕和译文，不调用真实 API。' : data.apiConfigured ? '已连接。已配置模型，实际翻译时会验证 API。' : '字幕服务已连接；请填写 .env 中的模型和 API 配置后重启。';
    } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
    finally { connect.disabled = false; }
  }, 'ryb-primary');
  actions.append(connect, button('保存设置', () => { try { apply(); dialog.close(); } catch (error) { status.textContent = error.message; } }), button('关闭', () => dialog.close()));
  form.append(overlayLabel, status, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
}

class SubtitlePanel {
  constructor(iframe) {
    this.iframe = iframe;
    this.videoId = videoIdFromUrl(iframe.src);
    this.embedId = this.videoId;
    this.cues = [];
    this.translations = new Map();
    this.rows = new Map();
    this.controllers = new Set();
    this.generation = 0;
    this.time = 0;
    this.offset = 0;
    this.currentIndex = -1;
    this.pageStart = 0;
    this.translating = false;
    this.busy = false;
    this.lastAttempt = 0;
    this.root = element('section', 'ryb-panel');
    this.root.setAttribute('aria-label', 'YouTube 双语字幕');
    this.root.contentEditable = 'false';
    const toolbar = element('div', 'ryb-toolbar');
    toolbar.append(element('strong', 'ryb-brand', '双语字幕'));
    toolbar.append(element('span', 'ryb-version', VERSION));
    this.clockStatus = element('span', 'ryb-clock-status', '播放器尚未连接');
    this.clockStatus.setAttribute('aria-live', 'polite');
    toolbar.append(this.clockStatus, button('设置', openSettings, 'ryb-settings-button'));
    this.status = element('p', 'ryb-status', config.token
      ? '先获取或导入字幕，再开始翻译。若服务未启动，请运行本机 start.command。'
      : '① 点“设置”连接本机服务 → ② 获取或导入字幕 → ③ 开始翻译。未配置服务时也可以导入字幕查看原文。');
    this.status.setAttribute('role', 'status');
    const actions = element('div', 'ryb-actions');
    this.fetchButton = button('获取字幕', () => this.loadCaptions());
    const upload = element('input', 'ryb-file');
    upload.type = 'file'; upload.accept = '.vtt,.srt,.json3,.json';
    upload.setAttribute('aria-label', '选择字幕文件');
    upload.addEventListener('change', async () => {
      const file = upload.files?.[0];
      if (!file) return;
      const generation = this.generation;
      try {
        if (file.size > MAX_SUBTITLE_BYTES) throw new Error('字幕文件须小于 5 MB。');
        const cues = parseSubtitles(await file.text());
        if (this.disposed || generation !== this.generation) return;
        this.setCues(cues);
        this.connect();
        this.setStatus(`已导入 ${cues.length} 条字幕。点击“开始翻译”调用你的 API。`);
      } catch (error) { this.setStatus(error.message); }
      finally { upload.value = ''; }
    });
    this.translateButton = button('开始翻译', () => this.toggleTranslation(), 'ryb-primary');
    this.translateButton.disabled = true;
    actions.append(this.fetchButton, button('导入字幕', () => upload.click()), this.translateButton, upload);
    const settingsRow = element('div', 'ryb-options');
    const offsetLabel = element('label', '', '时间偏移（秒） ');
    const offset = element('input'); offset.type = 'number'; offset.step = '0.5'; offset.min = '-3600'; offset.max = '3600'; offset.value = '0'; offset.setAttribute('aria-label', '字幕时间偏移，正数使字幕延后');
    offset.addEventListener('input', () => { this.offset = Math.max(-3600, Math.min(3600, Number(offset.value) || 0)); this.update(this.time); });
    offsetLabel.append(offset);
    const followLabel = element('label', 'ryb-check');
    this.follow = element('input'); this.follow.type = 'checkbox';
    this.follow.addEventListener('change', () => this.revealCurrent());
    followLabel.append(this.follow, document.createTextNode(' 字幕列表跟随播放'));
    settingsRow.append(offsetLabel, followLabel);
    this.current = element('div', 'ryb-current');
    this.currentSource = element('p', 'ryb-source', '原文字幕将显示在这里');
    this.currentTarget = element('p', 'ryb-target', '译文将显示在原文下方');
    this.current.append(this.currentSource, this.currentTarget);
    this.details = element('details', 'ryb-transcript');
    this.summary = element('summary', '', '字幕列表');
    this.list = element('div', 'ryb-list');
    this.pagination = element('div', 'ryb-actions ryb-pagination');
    this.previousPage = button('上一页', () => this.renderPage(this.pageStart - PAGE_SIZE));
    this.nextPage = button('下一页', () => this.renderPage(this.pageStart + PAGE_SIZE));
    this.pageLabel = element('span', 'ryb-muted');
    this.pagination.append(this.previousPage, this.pageLabel, this.nextPage, button('定位当前句', () => this.revealCurrent(true)));
    this.details.append(this.summary, this.list, this.pagination);
    this.details.addEventListener('toggle', () => { if (this.details.open) this.revealCurrent(); });
    const footer = element('div', 'ryb-actions ryb-footer');
    footer.append(button('复制当前双语', () => this.copyCurrent()), button('导出双语 Markdown', () => this.export()), button('重新连接', () => this.reconnect()));
    this.root.append(toolbar, actions, settingsRow, this.status, this.current, this.details, footer);
    this.mount = mountPanel(iframe, this.root);
    this.overlay = element('div', 'ryb-overlay');
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlaySource = element('span', 'ryb-overlay-source');
    this.overlayTarget = element('span', 'ryb-overlay-target');
    this.overlay.append(this.overlaySource, this.overlayTarget);
    document.body.append(this.overlay);
    this.positionTimer = setInterval(() => this.positionOverlay(), 200);
  }
  setStatus(text) { if (!this.disposed) this.status.textContent = text; }
  connect() {
    if (this.clock) return;
    const needsReload = new URL(this.iframe.src).searchParams.get('enablejsapi') !== '1';
    if (needsReload) this.setStatus('首次连接会重新加载此播放器一次，以开启时间同步。');
    this.clockStatus.textContent = '正在连接…';
    this.clock = new YouTubeClock(this.iframe, (time) => this.update(time), (state) => { if (!this.disposed) this.clockStatus.textContent = state; }, (id) => {
      this.reset(); this.videoId = id;
      this.setStatus('播放器切换了视频，请重新获取或导入该视频的字幕。');
    });
  }
  reconnect() {
    this.clock?.destroy(); this.clock = null; this.connect();
  }
  cancelCaptions() {
    this.captionController?.abort(); this.captionController = null;
    this.fetchButton.disabled = false;
  }
  invalidateTranslation() {
    this.stop(); this.cancelCaptions(); this.generation++;
    this.translations.clear();
    for (const { target } of this.rows.values()) target.textContent = '';
    this.renderCurrent();
  }
  reset() {
    this.stop(); this.cancelCaptions();
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.cues = []; this.translations.clear(); this.rows.clear();
    this.list.replaceChildren(); this.currentIndex = -1; this.pageStart = 0;
    this.translateButton.disabled = true;
    this.summary.textContent = '字幕列表';
    this.renderCurrent();
  }
  setCues(cues) {
    if (cues.some((cue) => cue.text.length > 5500)) throw new Error('单条字幕超过 5500 个字符，请先拆分该条字幕后再导入。');
    this.reset();
    this.cues = cues;
    this.renderPage(0);
    this.summary.textContent = `字幕列表 · ${cues.length} 条`;
    this.translateButton.disabled = false;
    this.update(this.time);
  }
  renderPage(index) {
    const { start, end } = cuePage(this.cues.length, index);
    this.pageStart = start;
    this.rows.clear();
    const fragment = document.createDocumentFragment();
    for (const cue of this.cues.slice(start, end)) {
      const row = button('', () => { this.connect(); this.clock.seek(cue.start + this.offset); }, 'ryb-cue');
      row.setAttribute('aria-label', `跳转到 ${formatTime(cue.start)}`);
      const stamp = element('span', 'ryb-stamp', formatTime(cue.start));
      const lines = element('span', 'ryb-cue-lines');
      const source = element('span', 'ryb-source', cue.text);
      const target = element('span', 'ryb-target', this.translations.get(cue.id) || '');
      if (cue === this.cues[this.currentIndex]) row.setAttribute('aria-current', 'true');
      lines.append(source, target); row.append(stamp, lines);
      this.rows.set(cue.id, { row, target }); fragment.append(row);
    }
    this.list.replaceChildren(fragment);
    this.list.scrollTop = 0;
    this.previousPage.disabled = start === 0;
    this.nextPage.disabled = end === this.cues.length;
    this.pageLabel.textContent = this.cues.length ? `${start + 1}–${end} / ${this.cues.length}` : '尚无字幕';
  }
  revealCurrent(force = false) {
    if (this.currentIndex < 0 || (!force && !this.follow.checked)) return;
    if (force) this.details.open = true;
    const page = cuePage(this.cues.length, this.currentIndex);
    if (page.start !== this.pageStart) this.renderPage(page.start);
    const row = this.rows.get(this.cues[this.currentIndex].id)?.row;
    if (row && this.details.open) this.list.scrollTop += row.getBoundingClientRect().top - this.list.getBoundingClientRect().top - (this.list.clientHeight - row.offsetHeight) / 2;
  }
  async loadCaptions() {
    if (this.fetchButton.disabled) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    const generation = this.generation;
    this.captionController = controller;
    const cfg = { ...config };
    this.fetchButton.disabled = true;
    this.setStatus(`正在获取 ${config.source} 字幕… YouTube 可能需要几十秒。`);
    try {
      verifyHealth(await request('/health', undefined, controller.signal, cfg));
      const data = await request('/v1/captions', { videoId: this.videoId, language: cfg.source }, controller.signal, cfg);
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
      if (data.videoId !== this.videoId || data.language !== cfg.source) throw new Error('字幕响应与当前视频或语言不匹配，请更新本机服务。');
      if (!Array.isArray(data.cues)) throw new Error('字幕服务没有返回有效字幕。');
      const cues = normalizeCues(data.cues);
      if (!cues.length) throw new Error('该视频没有可用字幕，请尝试导入文件。');
      this.controllers.delete(controller);
      this.setCues(cues);
      this.connect();
      this.setStatus(data.demo ? '【演示】已载入预置示例字幕，并非此视频真实字幕。' : `已获取 ${cues.length} 条原文字幕。点击“开始翻译”调用你的 API。`);
    } catch (error) { if (error.name !== 'AbortError' && !controller.signal.aborted && generation === this.generation) this.setStatus(error.message); }
    finally {
      this.controllers.delete(controller);
      if (this.captionController === controller) { this.captionController = null; if (!this.disposed) this.fetchButton.disabled = false; }
    }
  }
  update(time) {
    if (this.disposed) return;
    this.time = time;
    const index = activeCueIndex(this.cues, time - this.offset);
    if (index !== this.currentIndex) {
      const old = this.cues[this.currentIndex];
      if (old) this.rows.get(old.id)?.row.removeAttribute('aria-current');
      this.currentIndex = index;
      const cue = this.cues[index];
      const row = cue && this.rows.get(cue.id)?.row;
      if (row) {
        row.setAttribute('aria-current', 'true');
      }
      this.revealCurrent();
      this.renderCurrent();
    }
    if (this.translating && Date.now() - this.lastAttempt > 1500) void this.translateNear();
    this.positionOverlay();
  }
  renderCurrent() {
    const cue = this.cues[this.currentIndex];
    const source = cue?.text || (this.cues.length ? '当前时间没有字幕' : '原文字幕将显示在这里');
    const target = cue ? this.translations.get(cue.id) || (this.translating ? '正在准备译文…' : '点击“开始翻译”获取译文') : '';
    this.currentSource.textContent = source;
    this.currentTarget.textContent = target;
    this.overlaySource.textContent = cue?.text || '';
    this.overlayTarget.textContent = cue ? this.translations.get(cue.id) || '' : '';
  }
  positionOverlay() {
    const rect = this.iframe.getBoundingClientRect();
    const captionY = rect.bottom - Math.min(80, rect.height * 0.22);
    const captionX = rect.left + rect.width / 2;
    const visible = config.overlay && !document.hidden && this.iframe.isConnected && this.currentIndex >= 0 && rect.width > 160 && rect.height > 100 && captionY > 35 && captionY < innerHeight && captionX > 0 && captionX < innerWidth && !document.fullscreenElement && !dialog?.open && document.elementFromPoint(captionX, captionY - 10) === this.iframe;
    this.overlay.hidden = !visible;
    if (!visible) return;
    this.overlay.style.left = `${Math.max(0, rect.left + 12)}px`;
    this.overlay.style.top = `${rect.top + rect.height - Math.min(80, rect.height * 0.22)}px`;
    this.overlay.style.width = `${Math.max(0, Math.min(rect.width - 24, innerWidth - rect.left - 12))}px`;
    this.overlay.style.fontSize = `${Math.max(13, Math.min(23, rect.width / 40))}px`;
  }
  toggleTranslation() {
    if (this.translating) { this.stop(); this.setStatus('已停止自动翻译；已得到的译文仍可查看。'); return; }
    if (!this.cues.length) return this.setStatus('请先获取或导入字幕。');
    if (!config.token) { openSettings(); return; }
    for (const panel of panels.values()) if (panel !== this) panel.stop();
    this.connect();
    this.translating = true;
    this.translateButton.textContent = '停止翻译';
    this.setStatus('已启动：只翻译当前播放位置附近约 90 秒的字幕。跳转后会准备新位置的译文。');
    this.renderCurrent();
    void this.translateNear();
  }
  stop() {
    this.translating = false;
    this.translateButton.textContent = '开始翻译';
    this.translationController?.abort();
    this.translationController = null;
    this.renderCurrent();
  }
  async translateNear() {
    if (this.busy || !this.translating || this.disposed || document.hidden || !this.clock?.isSynchronized()) return;
    this.lastAttempt = Date.now();
    const entries = translationWindow(this.cues, this.time - this.offset, this.translations);
    if (!entries.length) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.translationController = controller;
    this.controllers.add(controller);
    this.busy = true;
    const cfg = { ...config };
    try {
      const data = await request('/v1/translate', { entries, target: cfg.target }, controller.signal, cfg);
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
      if (data.target !== cfg.target) throw new Error('译文语言不匹配，请更新本机服务。');
      for (const entry of validateTranslations(data.translations, entries)) {
        this.translations.set(entry.id, entry.text);
        const target = this.rows.get(entry.id)?.target;
        if (target) target.textContent = entry.text;
      }
      this.renderCurrent();
      this.setStatus(`${data.demo ? '【演示预置译文】' : ''}已翻译 ${this.translations.size}/${this.cues.length} 条；继续播放时按需翻译。`);
    } catch (error) {
      if (error.name !== 'AbortError' && !controller.signal.aborted && generation === this.generation) { this.stop(); this.setStatus(error.message + ' 点击“开始翻译”可重试。'); }
    } finally {
      this.controllers.delete(controller);
      if (this.translationController === controller) this.translationController = null;
      this.busy = false;
    }
  }
  async copyCurrent() {
    const cue = this.cues[this.currentIndex];
    if (!cue) return this.setStatus('请先播放到有字幕的位置。');
    try {
      await navigator.clipboard.writeText(exportMarkdown([cue], this.translations, this.videoId));
      this.setStatus('已复制当前双语字幕和时间链接，可粘贴到 Roam。');
    } catch { this.setStatus('当前窗口不允许访问剪贴板，可使用“导出双语 Markdown”。'); }
  }
  export() {
    if (!this.cues.length) return this.setStatus('请先获取或导入字幕。');
    const blob = new Blob([exportMarkdown(this.cues, this.translations, this.videoId)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = element('a'); link.href = url; link.download = `${this.videoId}.${config.target}.md`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.setStatus(`已导出。包含 ${this.cues.length} 条原文、${this.translations.size} 条已生成译文。`);
  }
  destroy() {
    this.disposed = true;
    this.reset();
    clearInterval(this.positionTimer);
    this.clock?.destroy();
    this.mount?.dispose();
    this.root.remove(); this.overlay.remove();
  }
}

function scan() {
  if (!active) return;
  for (const [iframe, panel] of panels) {
    if (!iframe.isConnected || !panel.root.isConnected || videoIdFromUrl(iframe.src) !== panel.embedId) {
      panel.destroy(); panels.delete(iframe);
    } else if (!panel.mount.isCurrent()) {
      panel.mount.dispose();
      panel.mount = mountPanel(iframe, panel.root);
    }
  }
  for (const iframe of document.querySelectorAll('iframe[src]')) {
    if (panels.has(iframe) || !videoIdFromUrl(iframe.src) || !new URL(iframe.src).pathname.startsWith('/embed/')) continue;
    panels.set(iframe, new SubtitlePanel(iframe));
  }
}

function onload() {
  onunload();
  active = true;
  try { config = validateConfig({ ...DEFAULT_CONFIG, ...JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') }); } catch { config = { ...DEFAULT_CONFIG }; }
  style = element('style'); style.dataset.ryb = 'style'; style.textContent = STYLE;
  document.head.append(style);
  observer = new MutationObserver((records) => {
    if (records.every((r) => r.target instanceof Element && r.target.closest('.ryb-panel,.ryb-overlay,.ryb-settings'))) return;
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  if (window.roamAlphaAPI?.ui?.commandPalette) {
    window.roamAlphaAPI.ui.commandPalette.addCommand({ label: commandLabel, callback: openSettings });
    commandRegistered = true;
  }
  scan();
}
function onunload() {
  active = false;
  observer?.disconnect(); observer = null;
  clearTimeout(scanTimer); scanTimer = null;
  for (const panel of panels.values()) panel.destroy();
  panels.clear();
  style?.remove(); style = null;
  settingsRequest?.abort(); settingsRequest = null;
  dialog?.remove(); dialog = null;
  if (commandRegistered) window.roamAlphaAPI?.ui?.commandPalette?.removeCommand({ label: commandLabel });
  commandRegistered = false;
}

export default { onload, onunload };
