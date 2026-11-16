// The HUD editor's layout: {selector: {x, y, s, hide}}. x/y are offsets in CSS pixels from where Krunker puts the
// element and s its scale. Written as the CSS `translate` and `scale` properties, they add to Krunker's own
// transforms instead of replacing them.

const num = (v, fallback) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);

/** A layout from storage (or an import): only known selectors, numbers in range, no entries that change nothing. */
export function cleanLayout(raw, known) {
  const out = {};
  for (const sel of known) {
    const p = raw?.[sel];
    if (!p || typeof p !== "object") continue;
    const entry = { x: num(p.x, 0), y: num(p.y, 0), s: Math.min(4, Math.max(0.25, num(p.s, 1))), hide: p.hide === true };
    if (entry.x || entry.y || entry.s !== 1 || entry.hide) out[sel] = entry;
  }
  return out;
}

/** The stylesheet for a clean layout. Hidden elements show faintly while the editor is open. */
export function layoutCss(layout) {
  return Object.entries(layout)
    .map(([sel, p]) => {
      const rule = `${sel} { translate: ${p.x}px ${p.y}px !important; scale: ${p.s} !important;${p.hide ? " visibility: hidden !important;" : ""} }`;
      return p.hide ? `${rule}\nhtml.mc-hud-edit ${sel} { visibility: visible !important; opacity: 0.35 !important; }` : rule;
    })
    .join("\n");
}
