import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo } from "./helpers";

// Save writes the same files an upload would have registered, packed into one gzipped tar — so this
// drives a real save and unpacks what lands on disk. A single frame is used as the selection because
// that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

const BLOCK = 512;

/** Walks the 512-byte headers of a tar, the way `tar tf` lists it. */
function listTar(gzipped: Buffer): { path: string; size: number; text: string }[] {
  const tar = gunzipSync(gzipped);
  const read = (offset: number, start: number, length: number) => {
    const raw = tar.subarray(offset + start, offset + start + length);
    const end = raw.findIndex((b) => b === 0 || b === 0x20);
    return raw.subarray(0, end === -1 ? raw.length : end).toString();
  };
  const entries: { path: string; size: number; text: string }[] = [];
  for (let offset = 0; offset + BLOCK <= tar.length && tar[offset] !== 0;) {
    const prefix = read(offset, 345, 155);
    const name = read(offset, 0, 100);
    const size = parseInt(read(offset, 124, 12), 8);
    offset += BLOCK;
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      size,
      text: tar.subarray(offset, offset + size).toString(),
    });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

test("a save writes a bundle holding the extract, the original and their provenance record", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/");
  // Signed out, Save is the side that leads.
  await expect(page.locator("#downloadPane")).toBeVisible();

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
  // Nothing is saved until the selection has been described.
  await expect(page.locator("#btnDownload")).toBeDisabled();
  await expect(page.locator("#downloadStatus")).toContainText("Describe the frame");
  await page.locator("#selectionDescription").fill("The mouse leaves frame here — the tracker keeps a stale track.");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  // The button names the bundle before it is written.
  await expect(page.locator("#downloadPreviewName")).toHaveText("name-file+example+480+Copy_index-5_type-frame_bundle.tar.gz");
  await expect(page.locator("#uploadOriginal")).toBeChecked();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toBe("name-file+example+480+Copy_index-5_type-frame_bundle.tar.gz");
  await expect(page.locator("#downloadStatus")).toContainText("Saved");

  const entries = listTar(readFileSync((await download.path())!));
  // The same files, in the same order, an upload would have written — extract first, then the
  // original, then the sidecar naming both. They unpack into one dated folder: the archive's
  // `sourcedata/raw/` prefix means nothing outside a dandiset, so a bundle does not carry it.
  const directory = entries[0].path.slice(0, entries[0].path.lastIndexOf("/"));
  expect(directory).toMatch(/^date-\d{8}_time-\d{6}_type-frame$/);
  expect(entries.map((e) => e.path.slice(directory.length + 1))).toEqual([
    "name-file+example+480+Copy_index-5_type-frame_image.png",
    "file_example_480-Copy.webm",
    "name-file+example+480+Copy_index-5_type-frame_provenance.json",
  ]);
  expect(entries.every((e) => e.path.startsWith(`${directory}/`))).toBe(true);
  expect(entries[0].size).toBeGreaterThan(0);

  const provenance = JSON.parse(entries[2].text) as Record<string, unknown>;
  expect(provenance.format).toBe("clip-extractor-provenance/v1");
  expect(provenance.description).toBe("The mouse leaves frame here — the tracker keeps a stale track.");
  // Nothing was uploaded, so there is no archive to name — only the directory inside the bundle.
  expect(provenance.destination).toEqual({ api: null, dandiset_id: null, directory });
  expect(provenance.uploaded_by).toBeNull();
  // The original rode along, checksummed exactly as an upload would have registered it.
  const source = provenance.source_video as Record<string, unknown>;
  expect(source.uploaded).toBe(true);
  expect(source.asset_path).toBe(`${directory}/file_example_480-Copy.webm`);
  expect((source.checksum as { value: string }).value).toMatch(/^[0-9a-f]{32}-\d+$/);
});

test("leaving the original out saves the extract and its provenance alone", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/");

  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#selectionDescription").fill("A clean frame, kept as a reference.");
  await page.locator("#uploadOriginal").uncheck();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  const entries = listTar(readFileSync((await download.path())!));
  expect(entries.map((e) => e.path.split("/").pop())).toEqual([
    "name-mice_index-0_type-frame_image.png",
    "name-mice_index-0_type-frame_provenance.json",
  ]);

  const provenance = JSON.parse(entries[1].text) as Record<string, unknown>;
  // Left out of the bundle, but still named and checksummed: that is what ties the frame to it.
  const source = provenance.source_video as Record<string, unknown>;
  expect(source.uploaded).toBe(false);
  expect(source.asset_path).toBeNull();
  expect(source.filename).toBe("mice.webm");
  expect((source.checksum as { value: string }).value).toMatch(/^[0-9a-f]{32}-\d+$/);
  expect(provenance.description).toBe("A clean frame, kept as a reference.");
});
