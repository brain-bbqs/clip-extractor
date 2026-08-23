import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { listTar } from "./helpers";

// Golden-tree tests for what Save actually writes, in the `expected_output/` fixture style of
// brain-bbqs/data-ingest-task-force's labs/kemere/tests: each live-test link is driven to a real
// save, the bundle is unpacked, and the result is held against a tree committed in
// tests/integration/expected_output/<case>/ — the whole file listing against `manifest.txt`, and
// every JSON file's full content against the same file at the same (normalized) path. The committed
// tree is the explicit, browsable statement of the output shape, so any change to it — a renamed
// entity, a dropped key, a reordered directory — shows up as a readable diff on GitHub rather than
// slipping through.
//
// No videos are committed: the mock source is synthesized in the page (lib/testInjection.ts), and
// binary members are pinned by presence in `manifest.txt` rather than by bytes. The pieces of the
// output this app does not decide are normalized to spelled-out placeholders before comparing, so
// the fixtures stay stable run to run:
//   recording-TIMESTAMP / date-DATE / time-TIME  — the delivery's own stamp, taken from the clock
//   MD5-CHECKSUM / SHA256-CHECKSUM / DANDI-ETAG-CHECKSUM — digests of MediaRecorder-made bytes
//   APP-VERSION — the package.json version, bumped every release
//   MEDIARECORDER-DEPENDENT — duration/frame-rate/frame-count of the synthesized source, which
//     MediaRecorder decides (30 frames of capture can decode as 29; see save.spec.ts)
// Everything else — every path, every key, every other value — is compared verbatim.
//
// Only the two &frame cases are fixtured: a &snippet save needs ffmpeg.wasm off a CDN, which no
// spec in this suite depends on (see save.spec.ts's own comment on the 2x2 grid).
//
// To regenerate after an intentional output change:
//   UPDATE_EXPECTED=1 npx playwright test --config configs/playwright.config.ts expectedOutput
// then review the diff, run pre-commit (prettier reformats the JSON; comparison is semantic), and
// commit the new tree.

const EXPECTED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "expected_output");
const UPDATE = !!process.env.UPDATE_EXPECTED;

const APP_VERSION = (JSON.parse(readFileSync(join(EXPECTED_ROOT, "..", "..", "..", "package.json"), "utf8")) as { version: string })
  .version;

/** JSON keys whose values MediaRecorder decides while synthesizing the mock source, not this app. */
const MEDIARECORDER_KEYS = new Set(["RecordingDuration", "VideoFrameRate", "VideoFrameCount"]);

/** Rewrites the run-to-run-varying spans of a path or string value to their named placeholders. */
function normalizeText(text: string): string {
  return (
    text
      .replace(/recording-\d{17}/g, "recording-TIMESTAMP")
      .replace(/date-\d{8}/g, "date-DATE")
      .replace(/time-\d{6}/g, "time-TIME")
      // Longest first, so an etag is never half-eaten as an MD5 and a SHA-256 never as two MD5s.
      .replace(/\b[0-9a-f]{32}-\d+\b/g, "DANDI-ETAG-CHECKSUM")
      .replace(/\b[0-9a-f]{64}\b/g, "SHA256-CHECKSUM")
      .replace(/\b[0-9a-f]{32}\b/g, "MD5-CHECKSUM")
      .replaceAll(APP_VERSION, "APP-VERSION")
  );
}

/** The same normalization over a parsed JSON document, key order preserved. */
function normalizeJson(value: unknown, key?: string): unknown {
  if (key !== undefined && MEDIARECORDER_KEYS.has(key) && typeof value === "number") return "MEDIARECORDER-DEPENDENT";
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeJson(v, k)]));
  }
  return value;
}

const CASES = [
  { name: "from_local_frame", link: "/?test&mock_video&mock_ready&from_local&frame" },
  { name: "from_ember_frame", link: "/?test&mock_video&mock_ready&from_ember&frame" },
];

for (const { name, link } of CASES) {
  test(`${link} writes exactly the committed expected_output/${name} tree`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
    await page.goto(link);
    await expect(page.locator("#btnDownload")).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
    const entries = listTar(readFileSync((await download.path())!));
    const paths = entries.map((entry) => normalizeText(entry.path));
    const jsonEntries = entries
      .filter((entry) => entry.path.endsWith(".json"))
      .map((entry) => ({ path: normalizeText(entry.path), content: normalizeJson(JSON.parse(entry.text)) }));

    const caseDir = join(EXPECTED_ROOT, name);
    if (UPDATE) {
      rmSync(caseDir, { recursive: true, force: true });
      mkdirSync(caseDir, { recursive: true });
      writeFileSync(join(caseDir, "manifest.txt"), paths.join("\n") + "\n");
      for (const { path, content } of jsonEntries) {
        mkdirSync(join(caseDir, dirname(path)), { recursive: true });
        writeFileSync(join(caseDir, path), JSON.stringify(content, null, 2) + "\n");
      }
    }

    expect(existsSync(caseDir), `no ${caseDir} — regenerate with UPDATE_EXPECTED=1 (see this spec's header)`).toBe(true);
    // Every member the bundle holds, in the order the tar writes them — binary members included.
    const manifest = readFileSync(join(caseDir, "manifest.txt"), "utf8").trimEnd().split("\n");
    expect(paths).toEqual(manifest);
    // Every JSON file's whole content, compared parsed so formatting never matters.
    for (const { path, content } of jsonEntries) {
      const golden: unknown = JSON.parse(readFileSync(join(caseDir, path), "utf8"));
      expect(content, `content of ${path}`).toEqual(golden);
    }
  });
}
