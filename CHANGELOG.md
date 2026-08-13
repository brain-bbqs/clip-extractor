# Changelog

## 0.1.7

#### 🐛 Bug Fix

- A video named by URL now streams instead of downloading whole. The player opened one through sleap-io.js's MediaBunny backend, which lists every packet's timestamp to build its frame index and, at the settings it asks for, loads each packet's data along with its metadata — over a URL that is the entire file before the first frame appears. The same index is in the container's own tables, which opening the video has already read, so the player now builds it from those: a 10.6 GB recording on the EMBER bucket opens after about 71 MB, and every byte after that is a frame somebody looked at ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A seek into a range the read-ahead is still decoding is served as soon as that one frame lands, rather than after the whole range: the frame asked for is usually the first the decoder reaches, and waiting for the other twenty-nine was most of what made scrubbing over a fresh stretch of video feel stuck ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Opening a second video releases the first. Its decoded frames are ImageBitmaps, which hold memory the garbage collector does not account for, and a streamed URL leaves reads in flight; neither was freed by dropping the reference to it ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Opening a large recording now reports how much of its index has been read as it goes, since even a streamed multi-gigabyte file takes long enough that silence reads as a stall ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))

#### 🏠 Internal

- Added `src/lib/streaming.ts`, a frame-indexed video backend on mediabunny directly, and with it `mediabunny` as a direct dependency. It was already in the bundle behind sleap-io.js, which is built on it, so this costs a dependency entry rather than download weight. sleap-io.js's own backends stay as the fallbacks: its MediaBunny one for a file this cannot open, and its mp4box one for a file neither will ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A video backend may now offer a `close()`, which the streaming one uses to drop its frames and cancel its reads ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Added unit coverage for the new backend against a stand-in for mediabunny — above all that it asks for packet metadata alone, which is the whole of the fix and the one thing a later refactor could quietly undo — alongside its frame cache, its window arithmetic and the seek that overtakes a read-ahead ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))

## 0.1.5

#### 🚀 Enhancement

- The upload pane now raises the same red human-subjects banner as [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) when the selected dataset's draft description carries the `CONTAINS HUMAN SUBJECTS` marker, and holds the Upload button until the de-identification and IRB notice is confirmed. The warning is about a destination, so it appears only while signed in and on the Upload side, and a confirmation lasts the session per dataset ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- That warning brings out a blur tool under the player: circular areas of a settable radius, placed by clicking the picture and then dragged over a face or anything else identifying. Each area is a focusable ring on the video, so it can be nudged with the arrow keys, resized with `+`/`−` and removed with `Delete` as well as with the buttons beside the controls ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- The blur is burned into everything a delivery writes, not only into the preview: the player's own canvas, the extracted frame's PNG, every frame of the rendered pose overlay, and the snippet, which ffmpeg blurs in one gaussian pass blended back inside the circles. Any blur forces a re-encode, since a stream copy would hand the source's frames over untouched ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- The original content stops travelling with a blurred selection — it still holds the pixels that were covered — so the "include the original content" switch is held off with a note saying why, and the choice comes back once the areas are cleared ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- The provenance record now names what was blurred: each area's centre and radius in source pixels, and the strength they were blurred at, so a reader can see which parts of the frame carry no data ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))

#### 🐛 Bug Fix

- The player no longer stretches the video when the frame is taller than the room there is for it. `max-height` clamped the canvas's height while its width stayed at 100%, and a canvas fills its box, so a 4:3 recording was drawn into a 16:9 one — noticeable once a blur area, drawn as a circle, came out on screen as an ellipse. The frame is now letterboxed at its own proportions, and the blur rings and the pointer that places them are mapped through the same fit ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))

#### 🏠 Internal

- Added unit coverage for the blur's canvas painting against a recording stand-in for a 2D context, jsdom having no canvas of its own: that the blur is clipped to the circles rather than smeared over the frame, that the padded copy is drawn back past its padding, and above all that a browser without canvas filters takes the shrink-and-magnify path instead of quietly drawing the picture back unblurred ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))

## 0.1.4

#### 🚀 Enhancement

- The annotations card now takes an ndx-pose `.nwb` as well as a SLEAP `.slp`, reading both flavors of the format (`PoseEstimation` predictions and `PoseTraining` annotations) through sleap-io.js's `loadNwb`. Both formats land in the same pose model, so the overlay, the annotations sidecar, the rendered overlay copy and the provenance record treat them alike ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- An `.nwb`'s pose series is measured off its data array, which is what a predictions file has instead of a recorded frame count: it names its original video and nothing else about it. More samples than the video has frames refuses the pair; fewer says on the card how much of the video the file covers ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- A dense `.nwb` series is re-indexed by sample order when its timestamps were read as spread-out frame indices, which happens to real-seconds timestamps slower than about 1 fps. A series exactly as long as the video is one sample per frame whatever its timestamps said ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- Card notices now name the format in hand rather than always saying `.slp`, and `?pose=` joins `?slp=` as the URL parameter for either format ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))

#### 🏠 Internal

- Added `h5wasm` as a direct dependency, for the shallow HDF5 walk that measures the pose series. It was already in the bundle behind sleap-io.js, which loads it to read `.slp` and `.nwb` alike, so this costs a dependency entry rather than download weight ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- Moved `@talmolab/sleap-io.js` to `^0.5.9`, the first release exporting the NWB readers ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- Added `tests/fixtures/make_nwb_fixtures.py`, which regenerates the committed `.nwb` fixtures from a minimal hand-built ndx-pose layout ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))

## 0.1.3

#### 🚀 Enhancement

- The SLEAP card now refuses a `.slp` that was labeled against a different video, listing the frame count, frame size or labeled frame range that does not fit and asking for another file, instead of overlaying a pose that lands on the wrong pixels ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))
- The same check runs when a video is loaded under an already-loaded `.slp`, so swapping either side of the pair is caught ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))
- A `.slp` whose recorded video name is not the loaded video now gets an amber notice on the card rather than a red refusal: it still loads and draws, with what looked off named next to it. The name is the only identifier the format always carries (there is no checksum of the video in a `.slp`), but copies get renamed and re-encoded between machines, so it is a prompt to look rather than grounds to refuse. A differing fps and a multi-video `.slp` are flagged there too, instead of only in the console ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))
- A `.slp` that cannot be read at all now says so on the card too, instead of failing silently to the console ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))

## 0.1.2

#### 🚀 Enhancement

- Removed the "Selection" summary line under the trim track, since the handles, the band on the track and the In/Out readouts already report the range ([#17](https://github.com/brain-bbqs/clip-extractor/pull/17))
- Dropped the word "Play" from the play button, leaving the glyph now that the step buttons carry arrows instead of triangles ([#17](https://github.com/brain-bbqs/clip-extractor/pull/17))

#### 🐛 Bug Fix

- Playback again loops inside the marked range: with the trim handles the playhead is no longer moved when a range is marked, so pressing play started outside the band and ran the whole way up to Out before wrapping ([#17](https://github.com/brain-bbqs/clip-extractor/pull/17))

## 0.1.1

#### 🚀 Enhancement

- Replaced the frame step buttons' triangle glyphs with the arrow keys they are bound to, so they no longer read as a smaller copy of the play button, and gave both an explicit screen reader label ([#16](https://github.com/brain-bbqs/clip-extractor/pull/16))

#### 🏠 Internal

- Adopted version bumping and changelog conventions, and backfilled this changelog from the project's history to date ([#16](https://github.com/brain-bbqs/clip-extractor/pull/16))

## 0.1.0

Everything built before the project began tracking versions.

#### 🚀 Enhancement

- Replaced the trim buttons with In and Out handles dragged directly on the timeline ([#15](https://github.com/brain-bbqs/clip-extractor/pull/15))
- Added the BBQS, CON, and Talmo Lab watermarks and a version indicator to the footer ([#14](https://github.com/brain-bbqs/clip-extractor/pull/14))
- Unified the save and upload routes so both deliver the same tar.gz bundle ([#13](https://github.com/brain-bbqs/clip-extractor/pull/13))
- Added download and upload delivery modes for extracted selections ([#12](https://github.com/brain-bbqs/clip-extractor/pull/12))
- Added EMBER OAuth sign-in and an upload destination picker ([#11](https://github.com/brain-bbqs/clip-extractor/pull/11))
- Added Google Analytics behind a GDPR cookie consent banner ([#10](https://github.com/brain-bbqs/clip-extractor/pull/10))
- Redesigned the UI with a light and dark theme toggle and a simplified extraction flow ([#8](https://github.com/brain-bbqs/clip-extractor/pull/8))
- Added the video player itself: frame range selection, extraction to an upload-ready payload, and a pose overlay ([#1](https://github.com/brain-bbqs/clip-extractor/pull/1))

#### 🏠 Internal

- Added GitHub issue templates for bug reports and feature requests ([#9](https://github.com/brain-bbqs/clip-extractor/pull/9))
- Added REUSE licensing compliance and a pre-commit hook ([#7](https://github.com/brain-bbqs/clip-extractor/pull/7))
- Bumped codecov/codecov-action from 5 to 7 ([#5](https://github.com/brain-bbqs/clip-extractor/pull/5))
- Added Playwright integration tests, Storybook, and Chromatic visual review ([#4](https://github.com/brain-bbqs/clip-extractor/pull/4))
- Migrated from a single-file HTML page to modular TypeScript built with Vite ([#3](https://github.com/brain-bbqs/clip-extractor/pull/3))
- Deployed the app to the GitHub Pages root on push to main ([#2](https://github.com/brain-bbqs/clip-extractor/pull/2))
- Added the initial repository scaffolding, along with the preview and Dependabot workflows
