// Raw mouse input: every pointer lock asks for unadjusted movement (no Windows acceleration or scaling), and falls
// back to a normal lock where the platform refuses it.
// shortcut: page scripts can see this override; a Chromium patch would hide it, if we ever build one.

export default {
  id: "rawInput",
  name: "Raw mouse input",
  desc: "Reads the mouse without Windows' pointer acceleration.",
  category: "Input",
  perf: true,
  early() {
    const lock = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function (options) {
      const raw = lock.call(this, { ...options, unadjustedMovement: true });
      return raw?.catch?.(() => lock.call(this, options)) ?? raw;
    };
  },
};
