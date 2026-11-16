// The crash finder's search (pure). A state is {candidates, off}: the suspects left, and the half switched off for
// this step. One switched-off module whose absence fixes the problem is the cause; running out of suspects means
// no Mercury module is.

const half = (candidates) => candidates.slice(0, Math.ceil(candidates.length / 2));

/** The first step: {candidates, off}, or {none: true} without suspects. */
export const begin = (candidates) => (candidates.length ? { candidates, off: half(candidates) } : { none: true });

/** After the player's answer: {found: id}, {none: true}, or the next {candidates, off}. */
export function advance({ candidates, off }, stillThere) {
  if (!stillThere && off.length === 1) return { found: off[0] };
  return begin(stillThere ? candidates.filter((id) => !off.includes(id)) : off);
}
