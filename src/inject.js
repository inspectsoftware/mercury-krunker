// Runs in every frame before the page's own scripts (see on_context_created in lib.rs).

// Raw mouse input: request unadjusted movement (no Windows acceleration) on every pointer lock,
// and fall back to a normal lock where the platform refuses it.
// shortcut: page scripts can see this override; M3 moves the default into the Chromium patch set.
(() => {
  const lock = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (options) {
    const raw = lock.call(this, { ...options, unadjustedMovement: true });
    return raw?.catch?.(() => lock.call(this, options)) ?? raw;
  };
})();
