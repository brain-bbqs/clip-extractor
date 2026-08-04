// Loaded via Vite's `?raw` import so this story always mirrors the real markup in index.html
// instead of a hand-maintained copy that can drift out of sync.
import indexHtml from "../index.html?raw";

function buildApp(): HTMLElement {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  // The app's own <script type="module"> wires up state against real video/ffmpeg backends;
  // Storybook only needs the static markup for a visual snapshot of the empty (unloaded) state.
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  const wrapper = document.createElement("div");
  wrapper.innerHTML = doc.body.innerHTML;
  return wrapper;
}

export default {
  title: "App",
};

export const Default = {
  name: "Default (no video loaded)",
  render: () => buildApp(),
};
