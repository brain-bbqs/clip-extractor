# Changelog

## 1.1.0

#### 🚀 Enhancement

- Save and Upload now write a BIDS-Study-shaped tree instead of a single ad hoc folder: a root `dataset_description.json` (`DatasetType: "study"`) organizes the source video under `sourcedata/rawbids/` (its own valid raw BIDS dataset) and the extracted clip or frame, its pose overlay, and any `.slp` under `derivatives/clip-extractor/`, named per BEP047's entities with BEP028-style provenance — naming the source video too — in their sidecars and in every `dataset_description.json` ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- `?test&mock_video&mock_ready` now picks a frame and types a description on its own, so the link lands directly on a saveable state instead of needing that done by hand before Save/Upload output can be previewed ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- Every `dataset_description.json` a delivery writes now credits the signed-in archive account as an `Author`, when there is one, and the root and derivatives files cross-link each other by a `DatasetLinks` alias ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- Video/image sidecars now carry a `Checksum` (both MD5 and dandi-etag) and, where known, `VideoCodecRFC6381`/`ImagePixelFormat`/`ImageBitDepth`; `SourceDatasets` now accumulates one entry per distinct source video across repeat deliveries instead of only naming the first; and the study root's `DatasetLinks` names its own `sourcedata/rawbids/` subtree directly, alongside `derivatives/clip-extractor/` ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- `?test&mock_video&mock_sub=`/`&mock_ses=` are gone; `?test&remote_listing=` previews a known-subject/session path instead, its fake video listing now named `sub-01/ses-01/…` and up ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- The source video's own copy under `sourcedata/rawbids/` is now named per BEP047 (`sub-<label>[_ses-<label>]_video.<ext>`) instead of keeping its original filename, and a repeat delivery of the same subject/session now overwrites that copy instead of piling up duplicates ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- `?test&mock_video&mock_ready` gained a `=snippet` variant (extracting a real clip instead of a still frame) and can be crossed with a new `&from_archive` flag, which previews the case of a video opened out of the archive (a known `sub-01/ses-02`, with a real source URL) rather than dropped locally ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- Removed the ad hoc `clip-extractor` provenance block nested in the sidecar JSON; a later PR will add a proper W3C PROV record in its place ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- The plain extracted clip/frame is now named `desc-extracted+clip`, alongside its pose-overlay sibling's existing `desc-overlay`, instead of carrying no `desc` at all ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- Every sidecar's `GeneratedBy` entry is gone; that's already recorded once in each `dataset_description.json`, so repeating it per-file was redundant ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- `SourceDatasets` no longer names a locally dropped video by filename and checksum alone; without a real URL that pair would only repeat what the file's own sidecar already says, so a local delivery now leaves `SourceDatasets` out entirely ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- The saved bundle is now named `desc-extracted+clip` like the extract inside it, rather than `desc-frame`/`desc-snippet` ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- The three `dataset_description.json` files no longer carry the delivery's timestamp in their `Name`, so the one the first delivery creates still fits everything added to that dataset afterwards ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- Live-test links now spell out both halves of what they preview — `&from_local`/`&from_ember` for where the video came from, `&frame`/`&snippet` for what is selected in it — replacing `&from_archive` and `mock_ready=snippet` ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- A `mock_ready` link now marks a real mid-clip selection (frame 12, or frames 6–21) rather than the frame the video opened on, with `&frame=<n>`/`&snippet=<lo>-<hi>` to name others ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))
- The per-delivery `date-`/`time-`/`recording-` disambiguator moved off every derivatives filename and onto its own directory (`derivatives/clip-extractor/sub-.../beh/<date-..._time-...|recording-...>/`), so a delivery's files no longer repeat it in their own names; the Save bundle's own filename carries neither, so the same source saved again names the same bundle ([#41](https://github.com/brain-bbqs/clip-extractor/pull/41))

## 1.0.0

#### 🐛 Bug Fix

- Fixed Browse EMBER showing embargoed datasets nobody owns while leaving out most of the actually-public ones; which datasets are public is now settled against the archive's own API instead of guessed from whether their file listing could be read off the public bucket, which turned out not to track embargo status at all ([#40](https://github.com/brain-bbqs/clip-extractor/pull/40))
- A dataset's file list that fails to load during the archive scan is now retried a couple of times before being treated as unreadable, so a transient network hiccup does not permanently hide it ([#40](https://github.com/brain-bbqs/clip-extractor/pull/40))

## 0.1.18

#### 🐛 Bug Fix

- A video whose container and size looked fine but whose network request or decoder never answered used to leave the player loading forever; it now gives up after 30 seconds with a message pointing at the likely codec or connection problem ([#36](https://github.com/brain-bbqs/clip-extractor/pull/36))

## 0.1.17

#### 🚀 Enhancement

- The Show overlay control is now a switch in the top right of the player card, beside the picture it draws on, and it only appears while the pose annotations step is switched on ([#33](https://github.com/brain-bbqs/clip-extractor/pull/33))
- The Show overlay switch is now carried in the address bar, so a link to a streamed recording opens with the overlay the way it was left, including when the pose file is sent along by hand ([#33](https://github.com/brain-bbqs/clip-extractor/pull/33))

## 0.1.16

#### 🚀 Enhancement

- The address bar now carries the streamed video, the pose file, the marks and the description, so reloading the tab or sending somebody the link opens on the same clip instead of an empty page ([#32](https://github.com/brain-bbqs/clip-extractor/pull/32))
- Signing in with EMBER no longer costs you what was on screen: the session is held across the round trip to the archive and put back on the way in ([#32](https://github.com/brain-bbqs/clip-extractor/pull/32))
- A link naming an embargoed archive asset now opens for a signed-in visitor, by asking EMBER for the same signed link the browse pane asks for ([#32](https://github.com/brain-bbqs/clip-extractor/pull/32))

## 0.1.15

#### 🚀 Enhancement

- The header now carries a one-line description of what the app is for, under the title ([#31](https://github.com/brain-bbqs/clip-extractor/pull/31))
- The Save/Upload toggle is only shown once you are signed in with EMBER, since signed out there is nowhere to upload to; signing out falls back to Save and signing back in returns to the side you had picked ([#31](https://github.com/brain-bbqs/clip-extractor/pull/31))

## 0.1.14

#### 🚀 Enhancement

- The browse pane's scrolling lists now carry a slim, rounded, accent-tinted scrollbar instead of the platform's gray slab with stepper arrows, matching the tables on the DANDI usage page ([#30](https://github.com/brain-bbqs/clip-extractor/pull/30))

## 0.1.13

#### 🚀 Enhancement

- A remote video in a container that cannot be streamed, such as an `.avi` over 1 GB, is now refused with an explanation instead of being downloaded whole into a tab that cannot hold it ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))
- The browse pane marks such a file `no streaming` in the listing, so it reads as one before it is picked ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))
- A URL that cannot be streamed for any other reason is no longer downloaded past 1 GB either, whatever its container ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))
- A refused video now points at the Encoding Helper, as a link rather than a bare URL, instead of describing a conversion to make by hand ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))
- Only the app's own links are made clickable in a message, so a crafted `?url=` cannot put a link to somewhere else on the page ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))
- A refusal now reads as three centered lines — the file, what is wrong with it, and the Encoding Helper as a named link — rather than as one paragraph ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))
- A remote recording over 1 GB whose container does not record where its frames are is now refused as soon as its header says so, rather than looking for them by reading the file itself — which for a 300 GB `.mkv` was hours of a byte count going up with nothing on the stage ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))

#### 🐛 Bug Fix

- A video that will not open now says so in one place — the browse pane for a video picked out of it, the stage for a URL or a dropped file — and each attempt clears the last one's message, so two refusals are never read side by side ([#29](https://github.com/brain-bbqs/clip-extractor/pull/29))

## 0.1.12

#### 🐛 Bug Fix

- Dropped the play triangle from each video row in the browse pane, where it read as a dropdown that would expand rather than as the row that opens the video ([#28](https://github.com/brain-bbqs/clip-extractor/pull/28))

## 0.1.11

#### 🏠 Internal

- The dataset picker's admin-owner check no longer sends your EMBER sign-in token to the companion admin-check service; that service now answers from its own archive credentials, so your token only ever goes to EMBER itself ([#27](https://github.com/brain-bbqs/clip-extractor/pull/27))

## 0.1.10

#### 🚀 Enhancement

- A new **Browse EMBER** source pane finds an existing video in the archive and streams it, so a clip can be pulled out of an archived recording without first knowing its URL ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- Public datasets are read from EMBER's public S3 manifests rather than its API, so browsing what is public needs no sign-in and no token ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- Signing in adds the embargoed datasets you are listed as an owner of to the same list, marked `embargoed`, and opens a video in one through a signed link the archive hands out on demand ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- Each video source is now marked by an icon on the source picker, and the pose annotations switch names the formats it accepts on their own line ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- The pane lists only the datasets that actually hold video, so nothing offered in it is a dead end ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- Sizes now scale into GB and TB, so a 336 GB archived recording reads as that rather than as six figures of megabytes — in the browse pane and every other readout that shows a size ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- The filter box matches a dataset by its number, its title or the name of a file inside it, and public titles are cached between visits so it works straight away on a return ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- A video chosen from the archive records the archive's own asset URL as its source, rather than the content-addressed bucket URL its frames are actually read from ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))
- Renamed the URL pane from **Stream from EMBER** to **Stream from a URL**, which is what it has always accepted ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))

#### 🏠 Internal

- Added `src/lib/archives.ts` (the bucket listing, dataset index and video assets), `src/lib/embargoed.ts` (the API side of the pane) and `src/lib/archiveNames.ts` (the cached dataset titles), with unit and integration coverage ([#26](https://github.com/brain-bbqs/clip-extractor/pull/26))

## 0.1.9

#### 🚀 Enhancement

- The player now says when it is waiting on video rather than sitting unchanged until the picture arrives: opening a recording names it on the stage and counts the index off as it streams in, and a seek that has to wait on a frame raises a spinner over the picture ([#25](https://github.com/brain-bbqs/clip-extractor/pull/25))
- A URL that cannot be range-read is still downloaded whole, but that download now counts itself off against the file's size instead of showing nothing at all until it finishes ([#25](https://github.com/brain-bbqs/clip-extractor/pull/25))
- A video that could not be loaded now says so on the stage, which previously went back to inviting a file with the reason left in the browser console ([#25](https://github.com/brain-bbqs/clip-extractor/pull/25))

#### 🏠 Internal

- Added `src/ui/stageStatus.ts`, holding the timing that keeps the indicator off screen for a wait that ends quickly and up for a run of slow ones, with unit and integration coverage ([#25](https://github.com/brain-bbqs/clip-extractor/pull/25))

## 0.1.8

#### 🚀 Enhancement

- A recording longer than half an hour is now trimmed against half an hour either side of where you are looking, moved by a new slider under the timeline spanning the whole recording, rather than one track across the entire thing where a single pixel of travel covers a minute and a half of video ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- Sliding that window carries the playhead and the snippet with it, so a range of the right length can be pushed across a recording to find the moment it belongs to instead of being left behind wherever it was marked ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- Dragging one trim marker on a windowed timeline now sets the other at the edge of what the timeline covers rather than at the end of the recording, so a first drag marks a snippet of the window instead of one running from there to the end of the day ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- How much of a long recording the timeline covers is now set beside the transport, from five minutes either side to thirty, and the choice is remembered between visits ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- The transport row now carries that width control at its left end and the speed control at its right, labelled and set either side of the play buttons ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
- Dropped the `[ ] I O` shortcuts that marked a snippet end at the playhead; either end is set by dragging its marker, arrowing it once focused, or typing a frame index into the readout ([#24](https://github.com/brain-bbqs/clip-extractor/pull/24))
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
