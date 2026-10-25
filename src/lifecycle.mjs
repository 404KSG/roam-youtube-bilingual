const KEY = Symbol.for('roam-youtube-bilingual.renderer');

// A renderer owns timers, message listeners and a surface.  Merely hiding an
// old surface leaves those side effects alive, so ownership changes only after
// the previous owner has released this exact global slot.
export function claimRenderer(host, owner, { unknownRenderer = false } = {}) {
  const previous = host[KEY];
  if (previous === owner) { owner.active = true; return true; }
  if (previous) {
    if (typeof previous.unload !== 'function') return false;
    previous.unload();
    if (previous.active || host[KEY] === previous) return false;
  }
  if (typeof unknownRenderer === 'function' ? unknownRenderer() : unknownRenderer) return false;
  host[KEY] = owner;
  owner.active = true;
  return true;
}

export function releaseRenderer(host, owner) {
  owner.active = false;
  if (host[KEY] === owner) delete host[KEY];
}
