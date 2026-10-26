import { DEFAULT_CONFIG } from './protocol.mjs';

// A non-modal, light-dismiss surface. It never makes the player inert, locks
// page scrolling, or owns translation/runtime state.
export function createSettingsPopover(owner, { css, version, save, onClose }) {
  const node = (tag, cls, text) => { const result = document.createElement(tag); if (cls) result.className = cls; if (text !== undefined) result.textContent = text; return result; };
  const action = (text, label, callback, cls = '') => { const result = node('button', cls, text); result.type = 'button'; result.setAttribute('aria-label', label); result.addEventListener('click', callback); return result; };
  const host = node('div', 'ryb-settings-host');
  host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const shadow = host.attachShadow({ mode: 'open' }), style = node('style'); style.textContent = css;
  const panel = node('section', 'ryb-settings'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Bilingual subtitle settings'); panel.setAttribute('aria-modal', 'false'); panel.tabIndex = -1;
  const abort = new AbortController(), ref = { host, dialog: panel, owner, abort, closed: false };
  const fields = new Map(), swatches = new Map();
  let lastAnchor = owner.toolbarButton.getBoundingClientRect();
  ref.position = () => {
    if (ref.closed) return;
    const anchor = owner.toolbarButton.getBoundingClientRect(); if (anchor.width) lastAnchor = anchor;
    const width = Math.max(0, Math.min(320, innerWidth - 24)); panel.style.width = `${width}px`; panel.style.maxHeight = `${Math.max(100, innerHeight - 24)}px`;
    const height = panel.offsetHeight;
    let top = lastAnchor.bottom + 8;
    if (top + height > innerHeight - 12) top = lastAnchor.top - height - 8;
    panel.style.left = `${Math.max(12, Math.min(lastAnchor.right - width, innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
  };
  ref.close = ({ restoreFocus = false } = {}) => {
    if (ref.closed) return;
    ref.closed = true; abort.abort(); host.remove(); owner.toolbarButton.setAttribute('aria-expanded', 'false');
    onClose(ref);
    if (restoreFocus && !owner.disposed && owner.toolbarButton.isConnected) owner.toolbarButton.focus({ preventScroll: true });
  };
  const heading = node('div', 'ryb-heading'); heading.append(node('h2', '', 'Subtitles'), action('×', 'Close subtitle settings', () => ref.close({ restoreFocus: true }), 'ryb-close')); panel.append(heading);
  const toggleRow = node('label', 'ryb-toggle-row'), enabled = node('input', 'ryb-switch'); enabled.type = 'checkbox'; enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', 'Enable bilingual subtitles'); enabled.checked = owner.wantsEnabled;
  toggleRow.append(node('span', '', 'Bilingual subtitles'), enabled); panel.append(toggleRow);
  const languageRow = node('label', 'ryb-language-row'), language = node('select'); language.name = 'target'; language.setAttribute('aria-label', 'Translation language'); language.disabled = true;
  language.append(node('option', '', 'Loading languages…')); languageRow.append(node('span', '', 'Language'), language); panel.append(languageRow);
  const status = ref.status = node('p', 'ryb-status'); status.setAttribute('role', 'status');
  const saved = node('span', '', 'Per-video settings');
  const updateFields = () => {
    enabled.checked = owner.wantsEnabled;
    for (const [key, field] of fields) if (document.activeElement !== host || shadow.activeElement !== field) field.value = String(owner.config[key]);
    for (const [key, buttons] of swatches) for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.color === owner.config[key]));
    status.textContent = owner.loading ? owner.noticeBox.textContent || 'Preparing subtitles…' : owner.lastError || owner.preferenceError || '';
  };
  const commit = async patch => {
    try { const pending = save(patch); updateFields(); await pending; if (!ref.closed) { updateFields(); saved.textContent = owner.preferenceError ? 'Not saved' : 'Saved for this video'; ref.position(); } }
    catch (error) { if (!ref.closed) { status.textContent = error.message; ref.position(); } }
  };
  const presets = [['#ffffff', 'White'], ['#c7cad6', 'Mist'], ['#ffd580', 'Gold'], ['#b7ccff', 'Blue'], ['#b9e6cf', 'Mint'], ['#edbfd5', 'Pink']];
  for (const [prefix, label] of [['source', 'English'], ['target', 'Translation']]) {
    const sizeKey = prefix + 'FontSize', colorKey = prefix + 'Color';
    const section = node('section', 'ryb-appearance'), row = node('div', 'ryb-appearance-heading'); row.append(node('h3', '', label));
    const stepper = node('div', 'ryb-stepper'), size = node('input'); size.type = 'number'; size.name = sizeKey; size.min = '12'; size.max = '36'; size.step = '1'; size.value = String(owner.config[sizeKey]); size.setAttribute('aria-label', label + ' font size'); size.title = '12–36 px'; fields.set(sizeKey, size);
    const changeSize = delta => { const value = Math.min(36, Math.max(12, Number(size.value || owner.config[sizeKey]) + delta)); size.value = String(value); void commit({ [sizeKey]: value }); };
    stepper.append(action('−', 'Decrease ' + label.toLowerCase() + ' font size', () => changeSize(-1)), size, node('span', 'ryb-unit', 'px'), action('+', 'Increase ' + label.toLowerCase() + ' font size', () => changeSize(1))); row.append(stepper); section.append(row);
    size.addEventListener('input', () => { const value = Number(size.value); if (size.value && value >= 12 && value <= 36) void commit({ [sizeKey]: value }); });
    size.addEventListener('change', () => { if (!size.value || Number(size.value) < 12 || Number(size.value) > 36) { size.value = String(owner.config[sizeKey]); status.textContent = 'Font size must be between 12 and 36 px.'; } });
    const colors = node('div', 'ryb-colors'); colors.setAttribute('role', 'group'); colors.setAttribute('aria-label', label + ' text color');
    const buttons = presets.map(([color, name]) => {
      const button = action('', label + ' color: ' + name, () => { colorInput.value = color; void commit({ [colorKey]: color }); }, 'ryb-swatch');
      button.dataset.color = color; button.style.setProperty('--swatch', color); button.title = name; colors.append(button); return button;
    }); swatches.set(colorKey, buttons);
    const colorInput = node('input', 'ryb-hex'); colorInput.name = colorKey; colorInput.value = owner.config[colorKey]; colorInput.maxLength = 7; colorInput.spellcheck = false; colorInput.setAttribute('aria-label', label + ' custom color'); colorInput.title = 'Six-digit hex color'; fields.set(colorKey, colorInput);
    colorInput.addEventListener('input', () => { const color = colorInput.value.startsWith('#') ? colorInput.value : '#' + colorInput.value; if (/^#[a-fA-F0-9]{6}$/.test(color)) void commit({ [colorKey]: color }); });
    colorInput.addEventListener('change', () => { colorInput.value = owner.config[colorKey]; }); colors.append(colorInput); section.append(colors); panel.append(section);
  }
  const hint = node('p', 'ryb-hint', 'Long captions wrap to two lines per language.'); panel.append(hint, status);
  const footer = node('div', 'ryb-settings-footer'); footer.append(saved, action('Reset style', 'Reset subtitle appearance', () => { const { sourceFontSize, targetFontSize, sourceColor, targetColor } = DEFAULT_CONFIG; void commit({ sourceFontSize, targetFontSize, sourceColor, targetColor }); }, 'ryb-text-button'));
  panel.append(footer, node('p', 'ryb-version', `Version ${version}`));
  enabled.addEventListener('change', () => { void commit({ enabled: enabled.checked }); });
  language.addEventListener('change', () => { void commit({ target: language.value }); });
  for (const type of ['pointerdown', 'click', 'keydown']) panel.addEventListener(type, event => { event.stopPropagation(); if (type === 'keydown' && event.key === 'Escape') { event.preventDefault(); ref.close({ restoreFocus: true }); } });
  shadow.append(style, panel);
  const fullscreen = document.fullscreenElement;
  (fullscreen?.contains(owner.iframe) ? fullscreen : document.body).append(host);
  owner.toolbarButton.setAttribute('aria-expanded', 'true'); updateFields(); ref.position(); panel.focus({ preventScroll: true });
  const inside = event => event.composedPath().includes(host) || event.composedPath().includes(owner.toolbarButton);
  document.addEventListener('pointerdown', event => { if (!inside(event)) ref.close(); }, { capture: true, signal: abort.signal });
  document.addEventListener('focusin', event => { if (!inside(event)) ref.close(); }, { signal: abort.signal });
  window.addEventListener('blur', () => { requestAnimationFrame(() => { if (document.activeElement?.tagName === 'IFRAME') ref.close(); }); }, { signal: abort.signal });
  window.addEventListener('resize', ref.position, { passive: true, signal: abort.signal });
  document.addEventListener('scroll', ref.position, { capture: true, passive: true, signal: abort.signal });
  const languageName = item => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(item.code) || item.code; } catch { return item.code; } };
  void owner.loadInfo(abort.signal).then(info => {
    if (ref.closed) return;
    language.replaceChildren();
    const priority = code => { const index = ['zh-Hans', 'zh-Hant', 'ja'].indexOf(code); return index < 0 ? 99 : index; };
    for (const item of [...info.languages].sort((a, b) => priority(a.code) - priority(b.code) || languageName(a).localeCompare(languageName(b), 'en'))) {
      const option = node('option', '', languageName(item)); option.value = item.code; language.append(option);
    }
    language.value = owner.config.target; language.disabled = !info.languages.length;
    if (!language.value) { language.selectedIndex = -1; status.textContent = 'Choose an available translation language.'; }
    if (!info.sourceLanguage) { enabled.disabled = true; status.textContent = 'This video has no available English captions.'; }
    ref.position();
  }).catch(error => { if (!ref.closed && error.name !== 'AbortError') { status.textContent = error.message; ref.position(); } });
  return ref;
}
