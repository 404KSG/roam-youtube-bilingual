// Agent-owned fixture only. Pointer/focus state is driven by the browser tool.
export function checkPreviewToolbar(expectedVisible) {
  if (location.pathname !== '/test-preview-fixture') throw new Error('Owned preview fixture only.');
  const button = document.querySelector('.ryb-toolbar-button');
  if (!button || !button.parentElement.classList.contains('rm-video-player__gutter')) throw new Error('Preview subtitle control must be inside the native side gutter.');
  if (document.querySelector('.ryb-toolbar-fallback')) throw new Error('Preview must not add a separate bottom toolbar.');
  const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
  const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  if (visible !== expectedVisible) throw new Error(`Expected preview control visibility ${expectedVisible}, got ${visible}.`);
  if (visible) {
    const native = button.parentElement.querySelector('.native-icon').getBoundingClientRect();
    if (Math.abs(rect.width - native.width) > 1 || Math.abs(rect.left - native.left) > 1) throw new Error('Preview control must match the native side buttons.');
  }
  const frame = document.querySelector('iframe').getBoundingClientRect();
  if (Math.abs(frame.height - 340) > 1) throw new Error('The native video geometry changed.');
  return { nativeGutter: true, visible, originalVideoGeometry: true };
}
