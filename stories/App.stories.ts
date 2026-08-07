// Loaded via Vite's `?raw` import so this story always mirrors the real markup in index.html
// instead of a hand-maintained copy that can drift out of sync.
import indexHtml from "../index.html?raw";

function buildApp(withSlp = false): HTMLElement {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  // The app's own <script type="module"> wires up state against real video/ffmpeg backends;
  // Storybook only needs the static markup for a visual snapshot of the empty (unloaded) state.
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  const wrapper = document.createElement("div");
  wrapper.innerHTML = doc.body.innerHTML;
  if (withSlp) {
    // Mirrors what main.ts does when the SLEAP annotations switch is flipped on.
    const toggle = wrapper.querySelector<HTMLInputElement>("#slpToggle");
    if (toggle) toggle.checked = true;
    wrapper.querySelector("#slpCard")?.removeAttribute("hidden");
  }
  return wrapper;
}

export default {
  title: "App",
};

export const Default = {
  name: "Default (no video loaded)",
  render: () => buildApp(),
};

export const SlpEnabled = {
  name: "SLEAP annotations enabled",
  render: () => buildApp(true),
};
