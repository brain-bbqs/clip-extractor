import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { listTar, loadRecordedVideo, seekTo } from "./helpers";

// Save writes the same files an upload would have registered, packed into one gzipped tar — so this
// drives a real save and unpacks what lands on disk. A single frame is used as the selection because
// that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

// No archive path names a locally dropped video, so its subject entity falls back to `sub-unknown`
// (see lib/bidsPath.ts's behEntities), and the recording entity is stamped from Save's own instant —
// only its shape (17 digits) is pinned down here. It names both this delivery's own directory under
// derivatives/ and every filename inside it (see lib/bidsPath.ts's derivativesDirectory) — but not
// the bundle's own name, which carries none of BEP047's entities at all.
const RECORDING = "\\d{17}";

test("a save writes a bundle holding the extract, the original, their sidecar and all three dataset_description.json files", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/");
  // Signed out, Save is the side that leads.
  await expect(page.locator("#downloadPane")).toBeVisible();

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  // Nothing is saved until the selection has been described.
  await expect(page.locator("#btnDownload")).toBeDisabled();
  await expect(page.locator("#downloadStatus")).toContainText("Describe the frame");
  await page.locator("#selectionDescription").fill("The mouse leaves frame here — the tracker keeps a stale track.");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  // The button names the bundle before it is written. A locally dropped video came from no dataset,
  // so the name falls back to local-dataset; none of BEP047's entities appear on it.
  await expect(page.locator("#downloadPreviewName")).toHaveText(/^local-dataset\.tar\.gz$/);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toMatch(/^local-dataset\.tar\.gz$/);
  await expect(page.locator("#downloadStatus")).toContainText("Saved");

  const entries = listTar(readFileSync((await download.path())!));
  // The same files, in the same order, an upload would have written: the extract under
  // `derivatives/clip-extractor/`'s own per-delivery `recording-<label>/` directory, the original
  // (and its own technical sidecar) under `sourcedata/` (mirroring the same fallback subject, with no
  // such directory of its own), the extract's own sidecar, then both `dataset_description.json`
  // files.
  const derivativesDir = entries[0].path.slice(0, entries[0].path.lastIndexOf("/"));
  expect(derivativesDir).toMatch(new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/recording-${RECORDING}$`));
  // The same stamp the directory carries is repeated in every filename inside it.
  const recording = derivativesDir.match(/recording-(\d+)$/)![1];
  expect(entries.map((e) => e.path)).toEqual([
    `${derivativesDir}/sub-unknown_recording-${recording}_image.png`,
    "sourcedata/rawbids/sub-unknown/beh/sub-unknown_video.webm",
    "sourcedata/rawbids/sub-unknown/beh/sub-unknown_video.json",
    `${derivativesDir}/sub-unknown_recording-${recording}_image.json`,
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
    "sourcedata/rawbids/dataset_description.json",
  ]);
  expect(entries[0].size).toBeGreaterThan(0);

  const sidecar = JSON.parse(entries[3].text) as Record<string, unknown>;
  expect(sidecar.Description).toBe("The mouse leaves frame here — the tracker keeps a stale track.");
  // No nested, app-specific record alongside the standard BEP047/BEP028 keys.
  expect(sidecar).not.toHaveProperty("clip-extractor");
  // The frame's stored pixel layout, read off the PNG the browser actually encoded (not assumed):
  // 8-bit, RGB with or without alpha depending on the encoder's choice.
  expect(sidecar.ImageBitDepth).toBe(8);
  expect(sidecar.ImagePixelFormat).toMatch(/^(rgba|rgb24)$/);

  // The original's own sidecar carries its real technical properties, not a copy of the extract's.
  const originalSidecar = JSON.parse(entries[2].text) as Record<string, unknown>;
  expect(originalSidecar.Description).toBe("The source video this selection was clipped from.");
  expect(originalSidecar.ImageWidth).toBe(320);
  expect(originalSidecar.ImageHeight).toBe(240);
  expect(originalSidecar.GeneratedBy).toBeUndefined();

  const rootDescription = JSON.parse(entries[4].text) as Record<string, unknown>;
  // "study": this root organizes sourcedata/rawbids/ (raw) and derivatives/ (derived) together.
  expect(rootDescription.DatasetType).toBe("study");
  // No timestamp: this file is dataset-level, so its name has to still fit whatever is added later.
  expect(rootDescription.Name).toBe("Frame extracted using the Clip Extractor");
  const generatedBy = rootDescription.GeneratedBy as { Name: string }[];
  expect(generatedBy[0].Name).toBe("clip-extractor");
  // Nobody signed in for a local Save, so nobody is credited — not even the field added.
  expect(rootDescription.Authors).toBeUndefined();
  // Names its own derivatives directory and sourcedata/rawbids/ directly, so either can be followed
  // without spelling its path out.
  expect(rootDescription.DatasetLinks).toEqual({ clip: "derivatives/clip-extractor", source: "sourcedata/rawbids" });
  const derivativesDescription = JSON.parse(entries[5].text) as Record<string, unknown>;
  expect(derivativesDescription.DatasetType).toBe("derivative");
  // The same study name, with a suffix, so the three read as one related set.
  expect(derivativesDescription.Name).toBe(`${rootDescription.Name} (Extracted)`);
  // No SourceDatasets entry for a locally dropped file: it belongs to no dataset to name.
  expect(derivativesDescription.SourceDatasets).toBeUndefined();
  // Names its own way back to sourcedata/rawbids/, the other half of the same pair.
  expect(derivativesDescription.DatasetLinks).toEqual({ raw: "../../sourcedata/rawbids" });
  // sourcedata/rawbids's own — DatasetType: "raw" too, so that subtree validates independently.
  const sourcedataDescription = JSON.parse(entries[6].text) as Record<string, unknown>;
  expect(sourcedataDescription.DatasetType).toBe("raw");
  expect(sourcedataDescription.Name).toBe(`${rootDescription.Name} (Original)`);
});

test("leaving the original out saves the extract and its sidecar alone, plus all three dataset_description.json files", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/");

  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#selectionDescription").fill("A clean frame, kept as a reference.");
  await page.locator("#uploadOriginal").uncheck();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  const entries = listTar(readFileSync((await download.path())!));
  expect(entries.map((e) => e.path)).toEqual([
    entries[0].path,
    entries[1].path,
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
    "sourcedata/rawbids/dataset_description.json",
  ]);
  expect(entries[0].path).toMatch(
    new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/recording-(${RECORDING})/sub-unknown_recording-\\1_image\\.png$`),
  );
  expect(entries[1].path).toMatch(
    new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/recording-(${RECORDING})/sub-unknown_recording-\\1_image\\.json$`),
  );

  const sidecar = JSON.parse(entries[1].text) as Record<string, unknown>;
  expect(sidecar.Description).toBe("A clean frame, kept as a reference.");

  // Left out of the bundle, and no SourceDatasets entry either — a local file belongs to no dataset,
  // so nothing here ties the frame back to it once the original is excluded.
  const derivativesDescription = JSON.parse(entries[3].text) as Record<string, unknown>;
  expect(derivativesDescription.SourceDatasets).toBeUndefined();
});

// The four live-test links `?test&mock_video&mock_ready` crosses: where the video came from
// (`&from_local`, dropped locally — sub-unknown, belonging to no dataset and so no SourceDatasets
// entry at all, see lib/provenance.ts's buildSourceDatasetEntry; `&from_ember`, opened out of a fixed
// dandiset and path — SourceDatasets' own URL and a known subject/session, so a date-/time-
// recording-) against what is selected in it (`&frame`, a still frame; `&snippet`, a range). Each
// lands on a saveable state with no manual selection or description, and each marks a real,
// mid-clip selection rather than the whole recording or the frame it opened on — frame 12 and
// frames 6–21 of `mock_video`'s own 30 (see lib/testInjection.ts's MOCK_READY_FRAME/_RANGE).
//
// The two `&snippet` cases stop at the state Save would write from rather than pressing it: a real
// snippet extraction needs ffmpeg.wasm off a CDN, which no spec in this suite depends on (see
// blur.spec.ts's own header comment). What is skipped is the encode, not the thing under test — the
// marked range and the selector mode below are the selection itself. The bundle name is the other
// half of the source split: named after the source dandiset (`200123.tar.gz`) for the from_ember
// cases, and `local-dataset.tar.gz` for the from_local ones, which came from no dataset at all.

const MOCK_FRAME = "12";
const MOCK_RANGE = { in: "6", out: "21" };
/** The selector's snippet side — `video` is what lib/types.ts's SelectorMode calls it. */
const SNIPPET_MODE_BUTTON = '#modeSeg button[data-mode="video"]';

test("?test&mock_video&mock_ready&from_local&frame saves a still frame of a locally dropped video", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/?test&mock_video&mock_ready&from_local&frame");
  await expect(page.locator("#btnDownload")).toBeEnabled();
  // A frame somebody would have had to seek to by hand, not the one the video opened on.
  await expect(page.locator("#curVal")).toHaveValue(MOCK_FRAME);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toBe("local-dataset.tar.gz");

  const entries = listTar(readFileSync((await download.path())!));
  // Dropped locally: the sub-unknown fallback, a recording- directory, and no dataset for
  // SourceDatasets to name — unlike the from_ember cases below.
  expect(entries[0].path).toMatch(
    new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/recording-(${RECORDING})/sub-unknown_recording-\\1_image\\.png$`),
  );
  const derivativesDescription = JSON.parse(
    entries.find((e) => e.path.endsWith("derivatives/clip-extractor/dataset_description.json"))!.text,
  );
  expect(derivativesDescription.SourceDatasets).toBeUndefined();
});

test("?test&mock_video&mock_ready&from_local&snippet marks a real range of a locally dropped video", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/?test&mock_video&mock_ready&from_local&snippet");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  // Snippet mode, not frame mode with stray marks left on it.
  await expect(page.locator(SNIPPET_MODE_BUTTON)).toHaveAttribute("aria-pressed", "true");
  // A sub-range with recording on either side of it, and the playhead parked inside what would be
  // extracted rather than back at the start of the video.
  await expect(page.locator("#inVal")).toHaveValue(MOCK_RANGE.in);
  await expect(page.locator("#outVal")).toHaveValue(MOCK_RANGE.out);
  await expect(page.locator("#curVal")).toHaveValue(MOCK_RANGE.in);
  await expect(page.locator("#downloadPreviewName")).toHaveText("local-dataset.tar.gz");
});

test("?test&mock_video&mock_ready&from_ember&frame saves a still frame of an archive-sourced video", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  // `from_ember` (see lib/testInjection.ts) makes the mock video look, to behEntities, as if it were
  // opened from sub-01/ses-02/… — a known subject and session, so its derivatives directory gets a
  // date-/time- disambiguator (not recording-), while the bundle name carries neither.
  await page.goto("/?test&mock_video&mock_ready&from_ember&frame");
  await expect(page.locator("#btnDownload")).toBeEnabled();
  await expect(page.locator("#curVal")).toHaveValue(MOCK_FRAME);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toBe("200123.tar.gz");

  const entries = listTar(readFileSync((await download.path())!));
  expect(entries[0].path).toMatch(
    /^derivatives\/clip-extractor\/sub-01\/ses-02\/beh\/date-(\d{8})_time-(\d{6})\/sub-01_ses-02_date-\1_time-\2_image\.png$/,
  );
  const derivativesDescription = JSON.parse(
    entries.find((e) => e.path.endsWith("derivatives/clip-extractor/dataset_description.json"))!.text,
  );
  // The dandiset it came out of, and the asset path within it — this reads as opened out of EMBER,
  // not dropped locally, which is the "more advanced metadata" from_ember exists to preview.
  expect(derivativesDescription.SourceDatasets).toEqual([
    {
      URL: "https://api-dandi.emberarchive.org/api/dandisets/200123",
      Path: "sub-01/ses-02/test-injection-mock-video.mp4",
    },
  ]);
});

test("?test&mock_video&mock_ready&from_ember&snippet marks a real range of an archive-sourced video", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/?test&mock_video&mock_ready&from_ember&snippet");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  await expect(page.locator(SNIPPET_MODE_BUTTON)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#inVal")).toHaveValue(MOCK_RANGE.in);
  await expect(page.locator("#outVal")).toHaveValue(MOCK_RANGE.out);
  await expect(page.locator("#curVal")).toHaveValue(MOCK_RANGE.in);
  await expect(page.locator("#downloadPreviewName")).toHaveText("200123.tar.gz");
});

test("the bundle stays named after its source dandiset even with an upload destination picked", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  // `num_datasets=1` picks the fake destination dandiset 214000 (see lib/testInjection.ts's
  // FAKE_DANDISET_ID_BASE), while from_ember's own source is 200123. The bundle names where the
  // recording came FROM, not where it is going — the destination is the archive's business, and it
  // is what would swallow the files were this an upload instead of a save.
  await page.goto("/?test&mock_video&mock_ready&from_ember&frame&num_datasets=1");
  await expect(page.locator("#dandisetSingleText")).toContainText("214000");
  // With a dataset to upload to, that is the side the delivery card leads with — so Save has to be
  // asked for before its button is the one on screen.
  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await expect(page.locator("#downloadPreviewName")).toHaveText("200123.tar.gz");

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toBe("200123.tar.gz");
});

test("&frame=<n> and &snippet=<lo>-<hi> pick their own indices, held to the video's own bounds", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/?test&mock_video&mock_ready&from_local&frame=4");
  await expect(page.locator("#curVal")).toHaveValue("4");

  await page.goto("/?test&mock_video&mock_ready&from_local&snippet=3-9");
  await expect(page.locator("#inVal")).toHaveValue("3");
  await expect(page.locator("#outVal")).toHaveValue("9");

  // Past the end of the mock video, so both ends land on its last frame rather than off it. That
  // last index is read off the field's own max rather than assumed: MediaRecorder decides how many
  // frames a `mock_video=<n>` capture really ends up holding, which is not always the n it was asked
  // for (30 frames of capture decode as 29).
  await page.goto("/?test&mock_video&mock_ready&from_local&snippet=900-999");
  await expect(page.locator("#btnDownload")).toBeEnabled();
  const last = (await page.locator("#inVal").getAttribute("max"))!;
  await expect(page.locator("#inVal")).toHaveValue(last);
  await expect(page.locator("#outVal")).toHaveValue(last);
});
