/** Renders a `.kv` key/value grid (used by the source-info and extraction-result panels) from an
 * ordered list of pairs, safely (text nodes, not innerHTML). */
export function renderKv(el: HTMLElement, rows: [string, string | number][]): void {
  el.replaceChildren();
  for (const [k, v] of rows) {
    const kEl = document.createElement("div");
    kEl.className = "k";
    kEl.textContent = k;
    const vEl = document.createElement("div");
    vEl.className = "v";
    vEl.textContent = String(v);
    el.append(kEl, vEl);
  }
}
