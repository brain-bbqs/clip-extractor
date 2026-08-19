# Live Testing

## Live test injections

Pasting a `?test&...` URL into the deployed app's address bar
(<https://clip-extractor.brain-bbqs.org>) drives the UI into a specific state — without touching real
EMBER network calls, real sign-in/`localStorage` state, or requiring a local video file — purely so a
person can eyeball every important UI state live, and so Playwright specs can reach the same states
without heavy `page.route` stubbing. This mirrors
[bbqs-uploader's own `?test` scheme](https://github.com/brain-bbqs/bbqs-uploader/blob/main/docs/README.md#live-testing);
the params below are this app's own, since its states differ.

| URL                                                                     | Expected Appearance                                                   | Link                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `?test&signed_out`                                                      | Page as seen by an unsigned-in visitor                                | [Open](https://clip-extractor.brain-bbqs.org/?test&signed_out)                              |
| `?test&num_datasets=0`                                                  | Signed in, "you have not been added to any direct-upload datasets"    | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=0)                          |
| `?test&num_datasets=1`                                                  | Single fake dataset, plain text destination, Upload enabled           | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=1)                          |
| `?test&num_datasets=2`                                                  | Dropdown of 2 fake datasets                                           | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=2)                          |
| `?test&num_datasets=1&embargoed=false`                                  | Single non-embargoed fake dataset: error card, Upload disabled        | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=1&embargoed=false)          |
| `?test&num_datasets=1&human_subjects`                                   | Single flagged dataset: warning banner, blur tool, gated Upload       | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=1&human_subjects)           |
| `?test&mock_video`                                                      | A synthesized 30-frame clip loaded onto the player, as if dropped     | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video)                              |
| `?test&mock_video=200`                                                  | Same, at 200 frames — long enough to see the trim track work          | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video=200)                          |
| `?test&mock_video&mock_slp`                                             | A loaded clip with a synthesized pose overlaid and matching           | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_slp)                     |
| `?test&mock_video&mock_slp&mismatch`                                    | Same, but the pose is refused: the SLEAP card's mismatch state        | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_slp&mismatch)            |
| `?test&mock_video&num_datasets=1`                                       | A loaded clip plus a fake upload destination, ready to preview Upload | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&num_datasets=1)               |
| `?test&mock_video&num_datasets=1&freeze_upload` (after pressing Upload) | Upload pane frozen mid-transfer, for a deterministic screenshot       | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&num_datasets=1&freeze_upload) |
| `?test&remote_listing=4`                                                | Read-only browse of 4 fake video files in one fake dataset            | [Open](https://clip-extractor.brain-bbqs.org/?test&remote_listing=4)                        |
| `?test&remote_listing=12`                                               | Same, 12 files spread across 3 fake datasets                          | [Open](https://clip-extractor.brain-bbqs.org/?test&remote_listing=12)                       |

**Safety**: `?test` alone (without any of the params above) is a no-op. Nothing here writes to real
`localStorage`, nothing touches the real sign-in tokens a genuine login holds, and every fake id these
params invent is chosen from a range no real EMBER dandiset occupies — so trying any of the above is
safe at any time, signed in or out, in production.

**Sign-out simulation**: `signed_out` forces the header, the delivery toggle, the human-subjects gate
and the browse pane to render as signed out, regardless of what a real stored token says — the
complement of `num_datasets`, which needs to look signed in without one.

**Fake datasets**: `num_datasets=0|1|2` fakes the delivery destination's dataset list with that many
datasets carrying identifiers well outside any real EMBER dandiset's numeric range, exactly the way
`applyDatasetList` would render a real one. They are embargoed (and so uploadable) by default; add
`&embargoed=false` to preview the "not embargoed, upload disabled" error state instead. Add
`&human_subjects` to flag them as holding human-subjects data, which raises the same warning banner
and blur tool a real flagged dataset would, without a real flagged dataset or a real sign-in behind it.

**A loaded video**: `mock_video` (optionally `=N` for the frame count, default 30) synthesizes a short
canvas-recorded clip in the page — the same technique the Playwright specs use to avoid a binary video
fixture — and loads it exactly as if it had been dropped onto the picker. This is the single
highest-value injection: the player, the timeline, the delivery panes and the SLEAP card are all only
interesting once a video is on screen, and this is the only param that puts one there with no local
file and no stream. Add `mock_slp` to also synthesize a matching pose model over it — drawn through
the same overlay code a real `.slp` would be — or `mock_slp&mismatch` to make that pose deliberately
describe a different recording, previewing the SLEAP card's mismatch refusal instead of a clean
overlay.

**Remote listing**: `remote_listing=N` fabricates the EMBER browse pane's dataset/video listing with
`N` fake video files spread across a handful of fake datasets, bypassing the real bucket listing and
manifest reads entirely. It is read-only in spirit — the fake video URLs resolve nowhere real, so
clicking a row shows the ordinary "cannot be opened" refusal, which is the truthful answer for a
source this param invented rather than a dead button.

**Upload freezing**: `freeze_upload`, combined with a loaded video and a fake destination (so the
Upload button is reachable), holds the upload pane at a fixed mid-transfer progress the instant Upload
is pressed and never resolves it — no archive request is made at all — for a deterministic screenshot
of the in-flight state.

## Expected console noise

Warnings that are known, harmless, and not fixable from this repo — don't go chasing them:

- **`A VideoSample was garbage collected without first being closed.`** — logged by
  [mediabunny](https://github.com/Vanilagy/mediabunny) once per second (it rate-limits) whenever a
  video is loaded or scrubbed. It comes from `MediaBunnyVideoBackend` inside
  `@talmolab/sleap-io.js`, which decodes a frame with
  `sample.toVideoFrame()` → `createImageBitmap(videoFrame)` → `videoFrame.close()`, but never
  closes the `VideoSample` itself. For a decoder-backed sample `toVideoFrame()` returns a _clone_
  (`new VideoFrame(this._data, …)`), so closing the clone leaves the decoder's own frame open until
  mediabunny's `FinalizationRegistry` closes it at GC time — which is what logs the warning. The
  sample never crosses the backend's API boundary (this app only ever receives the `ImageBitmap`),
  so there is nothing to close on our side; the fix is a `sample.close()` upstream. Still present in
  sleap-io.js 0.5.8.

None of the live test injections above add to this list: `?test&num_datasets=`/`&remote_listing=`
short-circuit before the real archive calls they stand in for are ever made, so there is nothing left
for either to log.

CI (`.github/workflows/`) runs typecheck/lint/unit-tests-with-coverage on every PR (`lint.yml`, coverage uploaded to Codecov), runs Playwright integration tests (`test.yml`), captures visual snapshots via Chromatic for both Storybook (`chromatic-storybook.yml`) and the full app via Playwright (`chromatic-playwright.yml`), deploys `main` to the `gh-pages` branch (`deploy.yml`), and stands up a per-PR preview under `pr-preview/pr-<n>/` (`preview.yml`). [pre-commit.ci](https://pre-commit.ci) runs `.pre-commit-config.yaml` (yaml/whitespace checks, prettier, eslint) on every PR and auto-fixes what it can.
