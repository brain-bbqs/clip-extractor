# Changelog

## 0.1.8

#### 🚀 Enhancement

- A recording longer than an hour is now trimmed against half an hour either side of where you are looking, moved by a new slider under the timeline spanning the whole recording, rather than one track across the entire thing where a single pixel of travel covers a minute and a half of video ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- How much of a long recording the timeline covers is now set beside the transport, anywhere from fifteen minutes either side to two hours, and the choice is remembered between visits ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- The transport row now carries that width control at its left end and the speed control at its right, labelled and set either side of the play buttons ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- A trim marker whose frame is outside the stretch the timeline covers now flattens against the edge it left through instead of vanishing, and stays draggable so a snippet can still be started from it ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))

#### 🏠 Internal

- Added `src/lib/timeline.ts`, holding the arithmetic for which stretch of a recording the timeline covers and how it is divided, with unit coverage ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))

## 0.1.7

#### 🚀 Enhancement

- Dropped two hints from the cards: the line under the Stream box describing what it does, and the note saying a streamed original is not sent back with the selection ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))

#### 🐛 Bug Fix

- No snippet this app writes carries audio any more. Every route but one already dropped it; a fast trim stream-copied the source's tracks straight through, so a recording being de-identified could send voices to the archive in a track nobody was shown ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Extracting a selection from a streamed video no longer downloads the whole recording first: it is cut straight out of the stream, so a five second clip an hour into a 10.6 GB file reads about 1.5 MB rather than all 10.6 GB, which never finished ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A video named by URL now streams over range requests instead of being downloaded whole before it can play: a 10.6 GB recording on the EMBER bucket opens after about 71 MB ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A long recording no longer locks the tab up while it opens: the frame index is taken from the rate the container records rather than by walking every packet, which for a 16-hour file meant 1.76 million of them with nothing yielding to the browser in between ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- The timeline ruler now carries a recording that runs for hours, with gradations up to twelve-hourly and an hours field in its labels, instead of hundreds of ticks under a smear of overlapping ones ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A seek into a stretch the read-ahead is still decoding is now served as soon as that frame lands rather than after the whole window, so scrubbing over fresh video no longer feels stuck ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Opening a second video now releases the first, whose decoded frames and in-flight reads were left behind ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Opening a long recording now reports how much of its index has been read, rather than looking stalled while it is ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))

#### 🏠 Internal

- Added `src/lib/streaming.ts`, a frame-indexed video backend built on mediabunny directly, with sleap-io.js's own backends kept as the fallbacks ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A streamed selection is trimmed by mediabunny rather than ffmpeg.wasm, which copies the frames over untouched when the cut may start on a key frame and re-encodes when it must be frame-exact or carry a blur ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Added `mediabunny` as a direct dependency, at the cost of a dependency entry rather than download weight, since sleap-io.js already brings it into the bundle ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A file whose frames do not sit at the rate its header records is still indexed packet by packet, and that walk now yields to the event loop as it goes ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- A video backend may now offer a `close()`, which the streaming one uses to drop its frames and cancel its reads ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Moved the ruler's gradation and label arithmetic into `lib/format.ts`, where it is unit tested ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))
- Added unit coverage for the new backend against a stand-in for mediabunny, above all that a constant-rate file is opened without walking a single packet ([#23](https://github.com/brain-bbqs/clip-extractor/pull/23))

## 0.1.6

#### 🐛 Bug Fix

- The snippet encode's progress now measures the snippet rather than the recording it was cut out of, so the bar spans the encode instead of creeping to a fraction of itself and then jumping to full ([#22](https://github.com/brain-bbqs/clip-extractor/pull/22))
- A frame-exact cut decodes the source up to the selection before it can encode anything, and the status line now names that step rather than holding the bar at 0% through it ([#22](https://github.com/brain-bbqs/clip-extractor/pull/22))
- The rendered pose overlay's encode reports progress at all, having sat at 0% from the first frame to the last ([#22](https://github.com/brain-bbqs/clip-extractor/pull/22))

## 0.1.5

#### 🚀 Enhancement

- The upload pane now raises the same red human-subjects banner as [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) when the selected dataset's draft description carries the `CONTAINS HUMAN SUBJECTS` marker, holding the Upload button until the de-identification and IRB notice is confirmed ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- That warning brings out a blur tool under the player: circular areas dragged over a face or anything else identifying, each a focusable ring that can be nudged, resized and removed from the keyboard as well as from the buttons beside the controls ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- The blur is burned into everything a delivery writes rather than only the preview: the extracted frame, every frame of the rendered pose overlay, and the snippet, which any blur forces to be re-encoded ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- The original content no longer travels with a blurred selection, since it still holds the pixels that were covered, and the switch offering it comes back once the areas are cleared ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))
- The provenance record now names each blurred area's centre, radius and strength, so a reader can see which parts of the frame carry no data ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))

#### 🐛 Bug Fix

- The player no longer stretches a video whose frame is taller than the room there is for it: the frame is letterboxed at its own proportions, and the blur rings and the pointer that places them are mapped through the same fit ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))

#### 🏠 Internal

- Added unit coverage for the blur's canvas painting against a recording stand-in for a 2D context, jsdom having no canvas of its own ([#20](https://github.com/brain-bbqs/clip-extractor/pull/20))

## 0.1.4

#### 🚀 Enhancement

- The annotations card now takes an ndx-pose `.nwb` as well as a SLEAP `.slp`, reading both `PoseEstimation` predictions and `PoseTraining` annotations into the same pose model, so the overlay, the sidecar and the provenance record treat the two formats alike ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- An `.nwb`'s pose series is measured off its data array, a predictions file having no recorded frame count: more samples than the video has frames refuses the pair, and fewer says on the card how much of the video the file covers ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- A dense `.nwb` series is re-indexed by sample order when its real-seconds timestamps were read as spread-out frame indices, which happens below about 1 fps ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- Card notices now name the format in hand rather than always saying `.slp`, and `?pose=` joins `?slp=` as the URL parameter for either format ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))

#### 🏠 Internal

- Added `h5wasm` as a direct dependency for the shallow HDF5 walk that measures the pose series, at the cost of a dependency entry rather than download weight, since sleap-io.js already brings it into the bundle ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- Moved `@talmolab/sleap-io.js` to `^0.5.9`, the first release exporting the NWB readers ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))
- Added `tests/fixtures/make_nwb_fixtures.py`, which regenerates the committed `.nwb` fixtures from a minimal hand-built ndx-pose layout ([#19](https://github.com/brain-bbqs/clip-extractor/pull/19))

## 0.1.3

#### 🚀 Enhancement

- The SLEAP card now refuses a `.slp` that was labeled against a different video, listing the frame count, frame size or labeled frame range that does not fit and asking for another file, instead of overlaying a pose that lands on the wrong pixels ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))
- The same check runs when a video is loaded under an already-loaded `.slp`, so swapping either side of the pair is caught ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))
- A `.slp` whose recorded video name is not the loaded video now gets an amber notice rather than a red refusal, names being a prompt to look rather than grounds to refuse, and a differing fps or a multi-video `.slp` is flagged there too instead of only in the console ([#18](https://github.com/brain-bbqs/clip-extractor/pull/18))
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
