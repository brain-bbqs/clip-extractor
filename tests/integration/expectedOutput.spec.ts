import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { listTar, serveFfmpegCore } from "./helpers";

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
// All four links of the 2x2 grid are fixtured. The &snippet pair really encodes: a snippet cut from
// local bytes goes through ffmpeg.wasm, whose core `serveFfmpegCore` hands over from node_modules so
// no CDN is involved (see helpers.ts) — the h264 encode itself is the app's own, not a stub.
//
// To regenerate after an intentional output change:
//   UPDATE_EXPECTED=1 npx playwright test --config configs/playwright.config.ts expectedOutput
// then review the diff, run pre-commit (prettier reformats the JSON; comparison is semantic), and
// commit the new tree.

const EXPECTED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "expected_output");
const UPDATE = !!process.env.UPDATE_EXPECTED;

const APP_VERSION = (JSON.parse(readFileSync(join(EXPECTED_ROOT, "..", "..", "..", "package.json"), "utf8")) as { version: string })
  .version;

// Keys whose values MediaRecorder decides while synthesizing the mock source, not this app: it
// honors a `mock_video=<n>` capture only approximately (30 frames of capture decode as 29), and picks
// the real frame rate itself. Anything derived from that rate goes with them.
//
// The extract's own frame count is not one of them — a `&snippet` link marks frames 6 through 21, so
// 16 frames is the app's own arithmetic and is held exactly. Only the source sidecar, which reports
// the whole synthesized recording, gives that key up.
const RATE_DEPENDENT_KEYS = new Set(["RecordingDuration", "VideoFrameRate"]);
const SOURCE_ONLY_DEPENDENT_KEYS = new Set(["VideoFrameCount"]);

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

/** The same normalization over a parsed JSON document, key order preserved. `describesSource` marks
 * the sidecar of the synthesized recording itself, which gives up one key more than the rest. */
function normalizeJson(value: unknown, describesSource: boolean, key?: string): unknown {
  if (key !== undefined && typeof value === "number") {
    if (RATE_DEPENDENT_KEYS.has(key) || (describesSource && SOURCE_ONLY_DEPENDENT_KEYS.has(key))) return "MEDIARECORDER-DEPENDENT";
  }
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, describesSource));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeJson(v, describesSource, k)]));
  }
  return value;
}

const CASES = [
  { name: "from_local_frame", link: "/?test&mock_video&mock_ready&from_local&frame", encodes: false },
  { name: "from_ember_frame", link: "/?test&mock_video&mock_ready&from_ember&frame", encodes: false },
  { name: "from_local_snippet", link: "/?test&mock_video&mock_ready&from_local&snippet", encodes: true },
  { name: "from_ember_snippet", link: "/?test&mock_video&mock_ready&from_ember&snippet", encodes: true },
];

for (const { name, link, encodes } of CASES) {
  test(`${link} writes exactly the committed expected_output/${name} tree`, async ({ page }) => {
    // Loading a 32MB wasm core and encoding through it takes far longer than a frame's canvas.toBlob.
    if (encodes) test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
    if (encodes) await serveFfmpegCore(page);
    await page.goto(link);
    await expect(page.locator("#btnDownload")).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), page.locator("#btnDownload").click()]);
    const entries = listTar(readFileSync((await download.path())!));
    const paths = entries.map((entry) => normalizeText(entry.path));
    const jsonEntries = entries
      .filter((entry) => entry.path.endsWith(".json"))
      .map((entry) => ({
        path: normalizeText(entry.path),
        // Only the copied-along recording's own sidecar describes what MediaRecorder made; the
        // dataset_description.json beside it in sourcedata/ describes the dataset, not the video.
        content: normalizeJson(JSON.parse(entry.text), entry.path.startsWith("sourcedata/") && entry.path.endsWith("_video.json")),
      }));

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
