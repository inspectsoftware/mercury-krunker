// Paths for the resource swapper: <data>/swap/<path> replaces https://*.krunker.io/<path> (src/resources.rs).

// Krunker's code (scripts, the wasm loader, the packed game) is never swapped: Mercury doesn't touch game code.
const CODE = /^pkg\/|\.(m?js|wasm|html?|dat)$/i;

/** A swap path from what the player typed or pasted (a path or a full URL), or null if it can't be one. */
export function swapPath(input) {
  const path = String(input ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[a-z]+:\/\/[^/]*\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "");
  if (!path || path.split("/").some((s) => !s || s === "." || s === "..") || CODE.test(path)) return null;
  return path;
}

const FOLDER = { png: "textures", jpg: "textures", jpeg: "textures", webp: "textures", mp3: "sound", ogg: "sound", wav: "sound", css: "css", obj: "models", gltf: "models", glb: "models" };

/**
 * Where a dropped file most likely goes: the one requested path with the same file name (sure), else the first of
 * several, else Krunker's folder for its type. `requested`: paths the game loaded this session.
 */
export function guessPath(name, requested) {
  const lower = name.toLowerCase();
  const hits = requested.filter((p) => p.split("/").pop().toLowerCase() === lower);
  if (hits.length === 1) return { path: hits[0], sure: true };
  if (hits.length) return { path: hits[0], sure: false };
  const folder = FOLDER[lower.split(".").pop()];
  return { path: folder ? `${folder}/${name}` : name, sure: false };
}
