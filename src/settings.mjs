import { DEFAULT_CONFIG } from './protocol.mjs';

export function popoverPosition(anchor, size, viewport, video) {
  const leftEdge = Math.max(8, video.left), rightEdge = Math.min(viewport.width - 8, video.right);
  const left = Math.max(leftEdge, Math.min(anchor.right - size.width, rightEdge - size.width));
  const top = Math.max(video.bottom, anchor.bottom) + 6;
  return { left, top, maxHeight: Math.max(0, viewport.height - top - 8) };
}

// A compact, non-modal card. Ordinary views stay below the video; color editors
// expand in place. Temporary scroll space is owned and removed on dismissal.
export function createSettingsPopover(owner, { css, version, save, onClose }) {
  const node = (tag, cls, text) => { const result = document.createElement(tag); if (cls) result.className = cls; if (text !== undefined) result.textContent = text; return result; };
  const action = (text, label, callback, cls = '') => { const result = node('button', cls, text); result.type = 'button'; result.setAttribute('aria-label', label); result.addEventListener('click', callback); return result; };
  const host = node('div', 'ryb-settings-host');
  host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const shadow = host.attachShadow({ mode: 'open' }), style = node('style'); style.textContent = css;
  const panel = node('section', 'ryb-settings'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Bilingual subtitle settings'); panel.setAttribute('aria-modal', 'false'); panel.tabIndex = -1;
  const abort = new AbortController(), ref = { host, dialog: panel, owner, abort, closed: false };
  const fields = new Map(), swatches = new Map(), editors = new Map(), scrollPositions = [];
  let anchorOffset = { right: 0, bottom: 0 }, spacer, positioning = false, expandedColor;
  const anchorFor = video => {
    const anchor = owner.toolbarButton.getBoundingClientRect();
    if (anchor.width) anchorOffset = { right: anchor.right - video.right, bottom: anchor.bottom - video.bottom };
    return { right: video.right + anchorOffset.right, bottom: video.bottom + anchorOffset.bottom };
  };
  const makeRoom = height => {
    const insertion = owner.toolbarButton.closest('.ryb-toolbar-fallback') || owner.iframe.closest('.rm-video-player__spacing-wrapper,.rm-iframe__spacing-wrapper') || owner.iframe;
    if (!insertion.isConnected) return;
    if (!spacer) {
      for (let element = insertion.parentElement; element; element = element.parentElement) scrollPositions.push({ element, top: element.scrollTop, left: element.scrollLeft });
      spacer = node('div', 'ryb-settings-spacer'); spacer.setAttribute('aria-hidden', 'true'); spacer.style.pointerEvents = 'none'; insertion.insertAdjacentElement('afterend', spacer);
    }
    spacer.style.height = `${height + 12}px`;
    spacer.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
    for (const position of scrollPositions) { position.afterTop = position.element.scrollTop; position.afterLeft = position.element.scrollLeft; }
  };
  ref.position = (reveal = false) => {
    if (ref.closed || positioning) return;
    positioning = true;
    try {
      for (const position of scrollPositions) if (Math.abs(position.element.scrollTop - position.afterTop) > 1 || Math.abs(position.element.scrollLeft - position.afterLeft) > 1) position.userMoved = true;
      let video = owner.iframe.getBoundingClientRect();
      const width = Math.max(0, Math.min(272, innerWidth - 16, video.width)); panel.style.width = `${width}px`; panel.style.maxHeight = 'none';
      const height = panel.offsetHeight;
      let position;
      if (document.fullscreenElement?.contains(owner.iframe)) {
        // There is no area below a fullscreen frame. Keep its controls usable
        // in a compact bottom dock, never in a separate right-hand column.
        position = { left: Math.max(8, (innerWidth - width) / 2), top: Math.max(8, innerHeight - height - 8), maxHeight: innerHeight - 16 };
        panel.dataset.placement = 'fullscreen-dock';
      } else {
        position = popoverPosition(anchorFor(video), { width, height }, { width: innerWidth, height: innerHeight }, video);
        if (reveal && position.maxHeight < height && !scrollPositions.some(item => item.userMoved)) {
          makeRoom(height); video = owner.iframe.getBoundingClientRect();
          position = popoverPosition(anchorFor(video), { width, height }, { width: innerWidth, height: innerHeight }, video);
        }
        panel.dataset.placement = 'below-video';
      }
      panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`; panel.style.maxHeight = `${Math.max(0, position.maxHeight)}px`;
    } finally { positioning = false; }
  };
  ref.close = ({ restoreFocus = false } = {}) => {
    if (ref.closed) return;
    ref.closed = true; abort.abort(); host.remove(); owner.toolbarButton.setAttribute('aria-expanded', 'false');
    const restore = !owner.disposed && owner.iframe.isConnected ? scrollPositions.filter(p => !p.userMoved && Math.abs(p.element.scrollTop - p.afterTop) <= 1 && Math.abs(p.element.scrollLeft - p.afterLeft) <= 1) : [];
    spacer?.remove(); for (const p of restore) if (p.element.isConnected) p.element.scrollTo({ top: p.top, left: p.left, behavior: 'instant' });
    onClose(ref);
    if (restoreFocus && !owner.disposed) {
      const target = owner.toolbarButton.isConnected && owner.toolbarButton.getBoundingClientRect().width ? owner.toolbarButton : owner.iframe;
      target.focus({ preventScroll: true });
    }
  };
  const heading = node('div', 'ryb-heading'), title = node('h2', '', 'Subtitles'); title.title = 'Up to two lines per language. Changes are saved for this video.';
  const enabled = node('input', 'ryb-switch'); enabled.type = 'checkbox'; enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', 'Enable bilingual subtitles'); enabled.checked = owner.wantsEnabled;
  const headingActions = node('div', 'ryb-heading-actions'); headingActions.append(enabled, action('×', 'Close subtitle settings', () => ref.close({ restoreFocus: true }), 'ryb-close'));
  heading.append(title, headingActions); panel.append(heading);
  const languageRow = node('label', 'ryb-language-row'), language = node('select'); language.name = 'target'; language.setAttribute('aria-label', 'Translation language'); language.disabled = true;
  language.append(node('option', '', 'Loading languages…')); languageRow.append(node('span', '', 'Language'), language); panel.append(languageRow);
  const status = ref.status = node('p', 'ryb-status'); status.setAttribute('role', 'status');
  const versionLabel = node('span', 'ryb-version', `Version ${version}`); versionLabel.title = 'Changes are saved for this video.';
  const updateFields = () => {
    enabled.checked = owner.wantsEnabled;
    for (const [key, field] of fields) if (document.activeElement !== host || shadow.activeElement !== field) field.value = String(owner.config[key]);
    for (const [key, buttons] of swatches) for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.color === owner.config[key]));
    for (const [key, editor] of editors) editor.trigger.style.setProperty('--swatch', owner.config[key]);
    status.textContent = owner.loading ? owner.noticeBox.textContent || 'Preparing subtitles…' : owner.lastError || owner.preferenceError || '';
  };
  const commit = async patch => {
    try { const pending = save(patch); updateFields(); await pending; if (!ref.closed) { updateFields(); versionLabel.title = owner.preferenceError || 'Saved for this video'; ref.position(); } }
    catch (error) { if (!ref.closed) { status.textContent = error.message; ref.position(); } }
  };
  const toggleColors = key => {
    expandedColor = expandedColor === key ? undefined : key;
    for (const [name, editor] of editors) { editor.group.hidden = name !== expandedColor; editor.trigger.setAttribute('aria-expanded', String(name === expandedColor)); }
    ref.position(true);
  };
  const presets = [['#ffffff', 'White'], ['#c7cad6', 'Mist'], ['#ffd580', 'Gold'], ['#b7ccff', 'Blue'], ['#b9e6cf', 'Mint'], ['#edbfd5', 'Pink']];
  for (const [prefix, label] of [['source', 'English'], ['target', 'Translation']]) {
    const sizeKey = prefix + 'FontSize', colorKey = prefix + 'Color', sizeLabel = prefix === 'source' ? 'English' : 'translation';
    const section = node('section', 'ryb-appearance'), row = node('div', 'ryb-appearance-heading'); row.append(node('h3', '', label));
    const stepper = node('div', 'ryb-stepper'), size = node('input'); size.type = 'number'; size.name = sizeKey; size.min = '12'; size.max = '36'; size.step = '1'; size.value = String(owner.config[sizeKey]); size.setAttribute('aria-label', label + ' font size'); size.title = '12–36 px'; fields.set(sizeKey, size);
    const changeSize = delta => { const value = Math.min(36, Math.max(12, Number(size.value || owner.config[sizeKey]) + delta)); size.value = String(value); void commit({ [sizeKey]: value }); };
    stepper.append(action('−', 'Decrease ' + sizeLabel + ' font size', () => changeSize(-1)), size, node('span', 'ryb-unit', 'px'), action('+', 'Increase ' + sizeLabel + ' font size', () => changeSize(1))); row.append(stepper);
    const trigger = action('', label + ' text color', () => toggleColors(colorKey), 'ryb-color-trigger'); trigger.title = label + ' text color'; trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', prefix + '-colors'); row.append(trigger); section.append(row);
    size.addEventListener('input', () => { const value = Number(size.value); if (size.value && value >= 12 && value <= 36) void commit({ [sizeKey]: value }); });
    size.addEventListener('change', () => { if (!size.value || Number(size.value) < 12 || Number(size.value) > 36) { size.value = String(owner.config[sizeKey]); status.textContent = 'Font size must be between 12 and 36 px.'; } });
    const colors = node('div', 'ryb-colors'); colors.id = prefix + '-colors'; colors.hidden = true; colors.setAttribute('role', 'group'); colors.setAttribute('aria-label', label + ' text color'); editors.set(colorKey, { group: colors, trigger });
    const buttons = presets.map(([color, name]) => {
      const button = action('', label + ' color: ' + name, () => { colorInput.value = color; void commit({ [colorKey]: color }); }, 'ryb-swatch');
      button.dataset.color = color; button.style.setProperty('--swatch', color); button.title = name; colors.append(button); return button;
    }); swatches.set(colorKey, buttons);
    const colorInput = node('input', 'ryb-hex'); colorInput.name = colorKey; colorInput.value = owner.config[colorKey]; colorInput.maxLength = 7; colorInput.spellcheck = false; colorInput.setAttribute('aria-label', label + ' custom color'); colorInput.title = 'Six-digit hex color'; fields.set(colorKey, colorInput);
    colorInput.addEventListener('input', () => { const color = colorInput.value.startsWith('#') ? colorInput.value : '#' + colorInput.value; if (/^#[a-fA-F0-9]{6}$/.test(color)) void commit({ [colorKey]: color }); });
    colorInput.addEventListener('change', () => { colorInput.value = owner.config[colorKey]; }); colors.append(colorInput); section.append(colors); panel.append(section);
  }
  panel.append(status);
  const footer = node('div', 'ryb-settings-footer'); footer.append(versionLabel, action('Reset style', 'Reset subtitle appearance', () => { const { sourceFontSize, targetFontSize, sourceColor, targetColor } = DEFAULT_CONFIG; void commit({ sourceFontSize, targetFontSize, sourceColor, targetColor }); }, 'ryb-text-button')); panel.append(footer);
  enabled.addEventListener('change', () => { void commit({ enabled: enabled.checked }); });
  language.addEventListener('change', () => { void commit({ target: language.value }); });
  for (const type of ['pointerdown', 'click', 'keydown']) panel.addEventListener(type, event => { event.stopPropagation(); if (type === 'keydown' && event.key === 'Escape') { event.preventDefault(); ref.close({ restoreFocus: true }); } });
  shadow.append(style, panel);
  const fullscreen = document.fullscreenElement;
  (fullscreen?.contains(owner.iframe) ? fullscreen : document.body).append(host);
  owner.toolbarButton.setAttribute('aria-expanded', 'true'); updateFields(); ref.position(true); panel.focus({ preventScroll: true });
  const inside = event => event.composedPath().includes(host) || event.composedPath().includes(owner.toolbarButton);
  document.addEventListener('pointerdown', event => { if (!inside(event)) ref.close(); }, { capture: true, signal: abort.signal });
  document.addEventListener('focusin', event => { if (!inside(event)) ref.close(); }, { signal: abort.signal });
  window.addEventListener('blur', () => { requestAnimationFrame(() => { if (document.activeElement?.tagName === 'IFRAME') ref.close(); }); }, { signal: abort.signal });
  window.addEventListener('resize', () => ref.position(), { passive: true, signal: abort.signal });
  document.addEventListener('scroll', () => ref.position(), { capture: true, passive: true, signal: abort.signal });
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
