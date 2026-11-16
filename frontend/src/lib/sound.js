// Alert sounds: a file from <data>/sounds (the host's files API), or Mercury's built-in chime.

import { call } from "../core/host.js";

const MIME = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", webm: "audio/webm" };
let ctx;

/** Plays `file` (a name in the sounds folder) or, when it is empty, the built-in chime; volume 0..1. */
export async function playSound(file, volume = 0.7) {
  if (file) {
    const data = await call("files.read", { dir: "sounds", path: file, encoding: "base64" });
    const ext = file.split(".").pop().toLowerCase();
    const audio = new Audio(`data:${MIME[ext] ?? "audio/mpeg"};base64,${data}`);
    audio.volume = Math.min(1, Math.max(0, volume));
    return audio.play();
  }
  ctx ??= new AudioContext();
  await ctx.resume();
  const start = ctx.currentTime + 0.02;
  // Three rising notes, each a short sine with a quick attack and a soft tail.
  [659.25, 880, 1318.5].forEach((freq, i) => {
    const t = start + i * 0.13;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * volume), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}
