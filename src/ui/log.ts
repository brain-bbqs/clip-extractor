export type LogClass = "err" | "ok" | "warn" | "";

/** Appends a line to the on-page log panel and scrolls it into view. */
export function createLogger(logEl: HTMLDivElement) {
  return function log(msg: string, cls: LogClass = ""): void {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };
}
