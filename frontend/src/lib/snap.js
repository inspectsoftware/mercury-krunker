// Snapping for the HUD editor. Boxes are {x, y, w, h} in screen pixels.

/** Guide lines: the viewport's edges and center, and every other box's edges and center. */
export function guides(viewport, boxes) {
  const x = [0, viewport.w / 2, viewport.w];
  const y = [0, viewport.h / 2, viewport.h];
  for (const b of boxes) {
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

/** The nearest guide within `threshold` of the box's start, center or end on one axis: {d, g} or null. */
function nearest(start, size, lines, threshold) {
  let best = null;
  for (const edge of [start, start + size / 2, start + size]) {
    for (const g of lines) {
      const d = g - edge;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, g };
    }
  }
  return best;
}

/** How far to shift `box` so it sticks to the nearest guides: {dx, dy, gx, gy} (gx/gy: the guide hit, or null). */
export function snap(box, lines, threshold = 6) {
  const x = nearest(box.x, box.w, lines.x, threshold);
  const y = nearest(box.y, box.h, lines.y, threshold);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, gx: x?.g ?? null, gy: y?.g ?? null };
}
