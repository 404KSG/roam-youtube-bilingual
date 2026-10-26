// Public UI interactions in the owned fixture; no real Roam or YouTube calls.
export async function runSettingsDismissalAcceptance() {
  if (location.pathname !== '/test-fixture') throw new Error('Owned fixture only.');
  const plugin = window.roamYouTubeBilingual; plugin.onunload(); plugin.onload();
  const icon = document.querySelector('.ryb-toolbar-button');
  const root = () => document.querySelector('.ryb-settings-host')?.shadowRoot;
  const results = {}, check = (ok, name) => { if (!ok) throw new Error(name); results[name] = true; };
  try {
    icon.click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    check(!root(), 'clicking outside closes settings without Done');
    icon.click();
    const panel = root().querySelector('[role=dialog]');
    check(!!panel && !panel.matches(':modal'), 'settings do not make the video or page inert');
    panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    check(!!root(), 'inside interaction does not dismiss the popover');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    check(!root(), 'Escape closes the popover');
    icon.click(); document.querySelector('iframe').focus(); window.dispatchEvent(new Event('blur'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    check(!root(), 'focusing the video also dismisses settings');
    return results;
  } finally { plugin.onunload(); }
}
