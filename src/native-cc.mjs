// Missing controls do not establish OFF. They may only preserve an OFF state
// already confirmed for this unchanged, visible player scope. Any positive
// native caption, scope loss, or unrecognized state closes the display gate.
export function resolveNativeCc(previous, observation) {
  if (observation?.state === 'on') return 'on';
  if (observation?.state === 'off') return 'off';
  if (previous === 'off' && observation?.reason === 'controls-hidden') return 'off';
  return 'unknown';
}
