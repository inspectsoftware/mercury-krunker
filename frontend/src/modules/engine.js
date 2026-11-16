// Engine settings: read by the host before Chromium starts (src/lib.rs, engine_switches), so they need a restart.

export default {
  id: "engine",
  name: "Engine",
  category: "Engine",
  perf: true,
  toggle: false,
  settings: [
    {
      key: "uncapped",
      label: "Uncapped FPS",
      desc: "No frame rate limit and no vsync. Keep Krunker's aim freeze fix on with this (Input).",
      type: "bool",
      default: true,
      restart: true,
    },
    {
      key: "angle",
      label: "Graphics backend",
      desc: "How Chromium talks to your GPU. Direct3D 11 is the safe default; try the others if you stutter.",
      type: "select",
      default: "",
      restart: true,
      options: [["", "Default (Direct3D 11)"], ["d3d11", "Direct3D 11"], ["d3d11on12", "Direct3D 11 on 12"], ["gl", "OpenGL"], ["vulkan", "Vulkan"]],
    },
    {
      key: "colorProfile",
      label: "Color profile",
      type: "select",
      default: "",
      restart: true,
      options: [["", "Default"], ["srgb", "sRGB"], ["display-p3-d65", "Display P3"], ["scrgb-linear", "scRGB linear"], ["hdr10", "HDR10"]],
    },
    {
      key: "flags",
      label: "Custom Chromium flags",
      desc: "Extra switches, separated by spaces. Start the client with --safe-mode if a flag breaks it.",
      type: "text",
      wide: true,
      default: "",
      placeholder: "--flag --other-flag=value",
      restart: true,
    },
  ],
};
