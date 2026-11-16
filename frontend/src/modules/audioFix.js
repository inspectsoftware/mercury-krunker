// Audio stutters, fixed in the page (no Chromium patch): Krunker plays sound through Howler, a global its own <script>
// defines. After 30 s without sound Howler suspends the AudioContext; resuming it on the next sound costs a stutter,
// and position updates written while it is suspended pile up in Chromium's AudioParam timelines until it resumes.
// Keeping the context running avoids both. Only Howler's public autoSuspend option changes; Krunker's code is untouched.

export default {
  id: "audioFix",
  name: "Fix audio stutters",
  desc: "Keeps Krunker's audio running between sounds instead of suspending it after 30 s.",
  category: "Performance",
  perf: true,
  early() {
    const started = Date.now();
    const timer = setInterval(() => {
      const howler = window.Howler;
      if (howler) howler.autoSuspend = false;
      if (howler || Date.now() - started > 60_000) clearInterval(timer);
    }, 250);
  },
};
