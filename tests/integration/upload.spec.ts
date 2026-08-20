import { test, expect } from "@playwright/test";
import { loadRecordedVideo, seekTo, stubArchive } from "./helpers";

// Drives a real upload against a stubbed archive, to pin down the asset paths every file actually
// lands at: the BEP047 `derivatives/`/`sourcedata/` split, the extract's own entities, the sidecar
// that mirrors them, and the original video's untouched name. A single frame is used as the
// selection because that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

// No archive path names this video (it was dropped locally), so its subject entity falls back to
// `sub-unknown` — see lib/bidsPath.ts's behEntities. The recording entity is stamped from the
// upload's own instant, so only its shape (17 digits) is pinned down here.
const RECORDING = "\\d{17}";

test("an upload registers the extract, the original and a matching sidecar", async ({ page }) => {
  const { registered, uploaded } = await stubArchive(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Frame 5 is where the two tracks swap identities.");
  await expect(page.locator("#uploadOriginal")).toBeChecked();
  await expect(page.locator("#btnUpload")).toBeEnabled();

  await page.locator("#btnUpload").click();
  const status = page.locator("#uploadStatus");
  await expect(status).toContainText("Upload complete", { timeout: 60_000 });

  expect(registered).toHaveLength(6);
  // The extract goes up first, then the original — with its own technical sidecar, since it's a real
  // source file and not one this app produced — mirroring the same subject in `sourcedata/`, then the
  // extract's own sidecar, then both `dataset_description.json` files this delivery's tool identity
  // belongs in.
  const [imagePath, originalPath, originalSidecarPath, sidecarPath, rootDescriptionPath, derivativesDescriptionPath] = registered;
  expect(imagePath).toMatch(new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/sub-unknown_recording-${RECORDING}_image\\.png$`));
  expect(originalPath).toBe("sourcedata/sub-unknown/beh/file_example_480-Copy.webm");
  expect(originalSidecarPath).toBe("sourcedata/sub-unknown/beh/file_example_480-Copy.json");
  expect(sidecarPath).toBe(imagePath.replace(/\.png$/, ".json"));
  expect(rootDescriptionPath).toBe("dataset_description.json");
  expect(derivativesDescriptionPath).toBe("derivatives/clip-extractor/dataset_description.json");

  // The uploaded bytes line up 1:1 with `registered`, so the extract's own sidecar is the second JSON
  // blob sent up, not the first — the original's technical sidecar goes up ahead of it.
  const jsonBodies = uploaded.map((part) => part.toString()).filter((body) => body.startsWith("{"));
  const originalSidecar = JSON.parse(jsonBodies[0]) as Record<string, unknown>;
  expect(originalSidecar.Description).toBe("The untouched source video this delivery's selection was cut from.");
  expect(originalSidecar.GeneratedBy).toBeUndefined();

  // The sidecar that actually went up carries the description written for this selection, the
  // standard BEP047 technical keys, a BEP028 GeneratedBy entry, and this app's own full record
  // nested under its own key.
  const sidecar = JSON.parse(jsonBodies[1]) as Record<string, unknown>;
  expect(sidecar.Description).toBe("Frame 5 is where the two tracks swap identities.");
  expect((sidecar.GeneratedBy as { Name: string }[])[0].Name).toBe("clip-extractor");
  const provenance = sidecar["clip-extractor"] as Record<string, unknown>;
  expect(provenance.destination).toEqual({
    api: "https://api-dandi.emberarchive.org/api",
    dandiset_id: "000123",
    directory: imagePath.slice(0, imagePath.lastIndexOf("/")),
  });
  expect(provenance.uploaded_by).toEqual({ username: "ada-lovelace", name: "Ada Lovelace" });

  // The completion link opens the archive's file browser at this upload's own derivatives directory.
  const directory = imagePath.slice(0, imagePath.lastIndexOf("/"));
  await expect(status.locator("a")).toHaveText("click here to view and share");
  await expect(status.locator("a")).toHaveAttribute(
    "href",
    `https://dandi.emberarchive.org/dandiset/000123/draft/files?location=${encodeURIComponent(directory)}`,
  );
  await expect(status.locator("a")).toHaveAttribute("target", "_blank");
});

test("the completion link survives a look at the other pane, and retires with the selection", async ({ page }) => {
  await stubArchive(page);
  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Worth sharing with the lab.");
  await page.locator("#btnUpload").click();
  const status = page.locator("#uploadStatus");
  await expect(status).toContainText("Upload complete", { timeout: 60_000 });
  // Pressing Upload takes the button away, so the same selection cannot be sent twice over.
  await expect(page.locator("#btnUpload")).toBeHidden();

  // Looking at what Save would have done, then coming back, is not a reason to lose the link to
  // where the upload landed.
  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(status).toContainText("Upload complete");
  await expect(status.locator("a")).toHaveText("click here to view and share");
  await expect(page.locator("#btnUpload")).toBeHidden();

  // Moving to another frame retires both: the line named where a different selection went, and
  // this one has not been uploaded yet.
  await seekTo(page, 9);
  await expect(status).not.toContainText("Upload complete");
  await expect(page.locator("#btnUpload")).toBeVisible();
});
