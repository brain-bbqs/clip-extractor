# Live Testing

## Live test injections

| URL                                              | Expected Appearance                                         | Link                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `?test&signed_out`                               | Page as seen by a signed-out visitor                        | [Open](https://clip-extractor.brain-bbqs.org/?test&signed_out)                               |
| `?test&num_datasets=0`                           | "Not added to any direct-upload datasets"                   | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=0)                           |
| `?test&num_datasets=1`                           | Single fake dataset, Upload enabled                         | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=1)                           |
| `?test&num_datasets=2`                           | Dropdown of 2 fake datasets                                 | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=2)                           |
| `?test&num_datasets=1&embargoed=false`           | Non-embargoed fake dataset: error card, Upload disabled     | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=1&embargoed=false)           |
| `?test&num_datasets=1&human_subjects`            | Flagged dataset: warning banner, blur tool, gated Upload    | [Open](https://clip-extractor.brain-bbqs.org/?test&num_datasets=1&human_subjects)            |
| `?test&mock_video`                               | A synthesized 30-frame clip loaded, as if dropped           | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video)                               |
| `?test&mock_video=200`                           | Same, 200 frames, enough to see the trim track              | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video=200)                           |
| `?test&mock_video_long`                          | A 4-hour clip: the sliding-window timeline and width        | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video_long)                          |
| `?test&mock_video&mock_slp`                      | Loaded clip with a synthesized, matching pose overlay       | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_slp)                      |
| `?test&mock_video&mock_slp&mismatch`             | Same, but refused: the SLEAP card's mismatch state          | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_slp&mismatch)             |
| `?test&remote_listing=12`                        | Browse pane, 12 fake videos named `sub-01/ses-01/…` and up  | [Open](https://clip-extractor.brain-bbqs.org/?test&remote_listing=12)                        |
| `?test&mock_video&mock_ready`                    | Frame picked, described, Save/Upload enabled — no clicking  | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_ready)                    |
| `?test&mock_video&mock_ready&from_local&frame`   | Same, spelled out: a still frame of a locally dropped video | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_ready&from_local&frame)   |
| `?test&mock_video&mock_ready&from_local&snippet` | A marked range of a locally dropped video                   | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_ready&from_local&snippet) |
| `?test&mock_video&mock_ready&from_ember&frame`   | A still frame of an archive-sourced `sub-01/ses-02` video   | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_ready&from_ember&frame)   |
| `?test&mock_video&mock_ready&from_ember&snippet` | A marked range of that same archive-sourced video           | [Open](https://clip-extractor.brain-bbqs.org/?test&mock_video&mock_ready&from_ember&snippet) |

**Safety**: `?test` alone, with none of the params below, is a no-op. Nothing here writes to real
`localStorage`, nothing touches real sign-in tokens, and every fake id is chosen from a range no real
EMBER dandiset occupies, so trying any of the above is safe at any time, signed in or out, in
production.

**Sign-out simulation**: `signed_out` renders the header, the delivery toggle, the human-subjects gate
and the browse pane as signed out, regardless of any real stored token. It is the complement of
`num_datasets`, which needs to look signed in without one.

**Fake datasets**: `num_datasets=0|1|2` fakes the delivery destination's dataset list with that many
datasets, with identifiers well outside any real EMBER dandiset's numeric range. They are embargoed
(and so uploadable) by default; add `&embargoed=false` to preview the "not embargoed, upload disabled"
error state instead. Add `&human_subjects` to flag them as holding human-subjects data, raising the
same warning banner and blur tool a real flagged dataset would, with no real flagged dataset or sign-in
behind it.

**A loaded video**: `mock_video` (optionally `=N` for the frame count, default 30) synthesizes a short
canvas-recorded clip in the page, the same technique the Playwright specs use to avoid a binary video
fixture, and loads it exactly as if it had been dropped onto the picker. It is the single highest-value
injection: the player, the timeline, the delivery panes and the SLEAP card are all only interesting
once a video is on screen. Add `mock_slp` to also synthesize a matching pose model over it, drawn
through the same overlay code a real `.slp` would be, or `mock_slp&mismatch` to make that pose
describe a different recording, previewing the SLEAP card's mismatch refusal. Save works fully
offline, so the resulting `.tar.gz` can be downloaded and unpacked to see the whole tree, without
needing a real EMBER sign-in. Add `mock_ready` to skip the manual steps Save/Upload gate on entirely —
marking a selection and typing a description — so the link lands directly on a saveable state, ready
for one click, rather than the gated "describe it first" state `mock_video` alone previews (itself
worth trying, since it is what a real visitor sees too).

**What a ready link previews**: `mock_ready` crosses two choices, and the four links in the table
above are that grid spelled out. _Where the video came from_: `from_local` (the default) is the
"dropped locally" case — no archive path, so the output falls back to `sub-unknown`, its derivatives
sit in a `recording-<label>/` directory, and `dataset_description.json` gets no `SourceDatasets`
entry, since a local file has no URL to name. `from_ember` instead makes the same mock video look as
though it had been opened out of the archive at `sub-01/ses-02/…`, which is what a real Browse EMBER
selection produces: a known subject and session, a `date-<label>_time-<label>/` directory, and a real
`URL` in `SourceDatasets`. _What is selected in it_: `frame` (the default) marks a still frame, which
needs no ffmpeg.wasm — and so no CDN — to extract; `snippet` marks a range instead, previewing the
video sidecar's own `VideoCodec`/`VideoFrameCount` and, with `mock_slp`, a rendered overlay. Both
land on real, mid-clip indices rather than the whole recording or the frame it opened on — frame 12,
and frames 6–21, of `mock_video`'s own 30. Name others with `frame=<n>` or `snippet=<lo>-<hi>`; both
are held to the loaded video's own bounds, so an index past the end lands on its last frame rather
than off it.

**A long recording**: `mock_video_long` (optionally `=N` for the duration in seconds, default 14400,
4 hours) previews the sliding-window timeline a recording past half an hour gets (see
`WINDOW_MIN_SECONDS` in lib/timeline.ts). It is a different clip from `mock_video`, built from one
frame every ten seconds of the target duration rather than recorded in real time, so a 4-hour preview
costs a couple of seconds rather than 4 real hours. The default is well past the half-hour threshold
that turns the window on, since the widest window setting (`±30 min`, a full hour) would otherwise
still cover a merely 40-minute clip in its entirety, leaving nothing for the window to show — and the
ten-second sampling matters as much as the duration: too sparse, and the trim track's own ruler ticks
(which round a time to the nearest real frame) collapse onto the same one or two positions instead of
spreading across it.

**Remote listing**: `remote_listing=N` fakes the EMBER browse pane's dataset/video listing with `N`
fake video files spread across a handful of fake datasets, bypassing the real bucket listing and
manifest reads, and switches straight to the Browse EMBER pane so the fake listing is what shows. Each
video's own path is BIDS-entity-shaped (`sub-01/ses-01/…`, and up), the same structure a real
dandiset's own asset paths carry. It is read-only in spirit: the fake video URLs resolve nowhere real,
so clicking a row shows the ordinary "cannot be opened" refusal.

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
