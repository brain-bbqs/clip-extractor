# User Test Checklist

|            |              |
| ---------- | ------------ |
| **Tester** | Brock Wester |
| **Date**   | 9/9/26       |

A basic manual pass through Clip Extractor's core flows before a release or after a significant
change. Run through this on the deployed site, signed in with a real EMBER Archive account with
access to at least one Dandiset.

See https://github.com/talmolab/sleap-tutorial-data/tree/main/new_data/results for some example pose data.

## Sign-in and dataset selection

- [x] Loading the page signed out shows the signed-out state and a working sign-in control
- [ ] Signing in redirects back to the app in a signed-in state, with the user's name/avatar shown
- With access to:
  - [ ] exactly one direct-upload dataset, it's selected without needing a dropdown
  - [ ] multiple direct-upload datasets, they appear in a dropdown and switching selection updates the page
  - [ ] no direct-upload datasets, the app falls back to local-only delivery
- [x] A dataset flagged as containing human subjects data shows the warning banner and gates upload until the blur tool has been used or dismissed
- [x] Signing out returns to the signed-out state cleanly

## Loading a video

- [x] Dragging and dropping a local video file onto the picker loads it and playback starts
- [x] "Browse" loads a video from the EMBER Archive instead of a local file
- [x] Video metadata (duration, resolution, frame rate) displays correctly once loaded
- [ ] An unsupported or corrupt file shows a clear error message, not a silent failure

## Timeline and playback

- [x] Scrubbing the timeline updates the preview frame accordingly
- [x] Play/pause works from both the on-screen controls
- [x] Frame-by-frame stepping works with the keyboard shortcuts
- [ ] A long video shows the sliding-window timeline, and zoom/pan on it behaves sensibly

## Selecting a clip

- [x] Marking a single frame switches the selection UI to "frame" mode
- [x] Marking a snippet range (in/out points) updates the duration as either end is adjusted
- [ ] The selection persists correctly when switching between play and pause

## Pose overlay (SLEAP)

- [x] Loading a matching `.slp` pose file alongside a video renders the pose overlay
- [x] Loading a mismatched `.slp` file is refused with a clear mismatch message

## Blur tool

- [x] For a dataset flagged as human-subjects, the blur tool is available and the warning banner shows
- [x] Drawing a blur region visibly applies it in both the preview and the exported output
- [x] Removing or adjusting a blur region is reflected correctly

## Export / local download

- [x] Exporting a marked frame downloads a valid image file
- [x] Exporting a marked snippet downloads a valid video file
- [x] Exported filenames follow the expected BIDS-like naming convention
- [x] Exported files play/open correctly outside the app (e.g., in a media player or image viewer)


## Upload to EMBER Archive

- [x] Uploading an exported frame/snippet to a selected dataset shows a progress indicator
- [x] A successful upload's asset appears in the target dataset's file listing on EMBER Archive
- [x] Interrupting an in-progress upload (e.g., close/reload the tab) recovers gracefully on return

## Cross-cutting

- [x] Reloading the page mid-session doesn't corrupt local state (localStorage) in a way that breaks the next load
- [x] The app is usable in both light and dark OS/browser theme
- [x] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [x] No unexpected errors in the browser console
- [x] Can navigate to all hyperlinks in the bottom-left

## Extra notes

Add 'Start' and 'End' buttons within frame digit boxes

Make total frame and time exposure more visually obvious

Allow user to enter exact frame OR timestamp

keyboard shortcut + speed respect; shift+nav could multiply by 10x

time-dependent blur ; primarily for tracking faces ; alometric scaling for size of region?
- wouldn't be hard to have 1 second keyframes to shift centroid and then interpolate spline

investigate if restoring after stop requires adjusting video range

Export should have clearer names; "Save to device" + "Upload to EMBER" (with logo)

dev log:

```
Ready. Load a local video or stream one from EMBER to begin.
/?url=https%3A%2F%2Fapi-dandi.emberarchive.org%2Fapi%2Fassets%2F6665d13c-9244-4081-b30b-4a0eda1dce53%2Fdownload%2F&in=338&out=1353&frame=338:1 Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.
index-Ca73Nk8g.js:1576 Loading video: video.mp4…
index-Ca73Nk8g.js:1576 Reading video.mp4's index… 16.0 KB so far
index-Ca73Nk8g.js:1576 Loaded 1024×768, 1692 frames @ 47.00 fps
(index):1 Access to fetch at 'https://api-dandi.emberarchive.org/api/assets/6665d13c-9244-4081-b30b-4a0eda1dce53/download/' from origin 'https://clip-extractor.brain-bbqs.org' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
api-dandi.emberarchive.org/api/assets/6665d13c-9244-4081-b30b-4a0eda1dce53/download/:1  Failed to load resource: net::ERR_FAILED
index-Ca73Nk8g.js:1576 Could not open the embargoed file derivatives/clip-extractor/sub-unknown/beh/recording-20260829203026236/sub-unknown_recording-20260829202635822_desc-overlay_video.mp4: Failed to fetch
Q @ index-Ca73Nk8g.js:1576
activeContent.js:1   Uncaught (in promise) TypeError: Failed to fetch
    at activeContent.js:1:995
    at activeContent.js:1:2323
    at kA (index-Ca73Nk8g.js:1576:18293)
    at te (index-Ca73Nk8g.js:1576:85770)
index-Ca73Nk8g.js:1576 Loading video: annotated_frames.avi…
index-Ca73Nk8g.js:1576 annotated_frames.avi cannot be streamed, so all 1.45 MB of it will be downloaded first
Q @ index-Ca73Nk8g.js:1576
index-Ca73Nk8g.js:1576 Reading annotated_frames.avi's index… 15.2 KB so far
index-Ca73Nk8g.js:1576 Range/stream open failed (Input has an unsupported or unrecognizable format.); downloading full file…
Q @ index-Ca73Nk8g.js:1576
index-Ca73Nk8g.js:1576 Reading annotated_frames.avi's index… 64.0 KB so far
index-Ca73Nk8g.js:1576 Streaming open failed (Input has an unsupported or unrecognizable format.); indexing the whole file…
Q @ index-Ca73Nk8g.js:1576
index-Ca73Nk8g.js:1576 MediaBunny failed (Input has an unsupported or unrecognizable format.); trying mp4box…
Q @ index-Ca73Nk8g.js:1576
index-Ca73Nk8g.js:1576 Loading video: mice.mp4…
index-Ca73Nk8g.js:1576 Reading mice.mp4's index… 16.0 KB so far
index-Ca73Nk8g.js:1576 Loaded 1024×768, 14100 frames @ 47.00 fps
index-Ca73Nk8g.js:1576 Video error: annotated_frames.avi could not be opened within 30 seconds. This usually means the video codec is inefficient or the connection stalled.

Please use the [Encoding Helper](https://encoding-helper.brain-bbqs.org/) to improve the video accessibility.
Q @ index-Ca73Nk8g.js:1576
index-Ca73Nk8g.js:1580 Error: annotated_frames.avi could not be opened within 30 seconds. This usually means the video codec is inefficient or the connection stalled.

Please use the [Encoding Helper](https://encoding-helper.brain-bbqs.org/) to improve the video accessibility.
    at index-Ca73Nk8g.js:1568:82648
ZP @ index-Ca73Nk8g.js:1580
/?url=https%3A%2F%2Fapi-dandi.emberarchive.org%2Fapi%2Fassets%2F1e002c85-67e8-4a61-b304-5b819bc69d5e%2Fdownload%2F&in=2820&out=4308&frame=2765&description=Mouse+video+with+blur+overlays:1 Access to fetch at 'https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83-b6dc-4cd1-8d92-38787d5b797b' from origin 'https://clip-extractor.brain-bbqs.org' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83-b6dc-4cd1-8d92-38787d5b797b:1  Failed to load resource: net::ERR_FAILED
index-Ca73Nk8g.js:5 Request will not be retried because a CORS error was suspected due to different origins. You can modify this behavior by providing your own function for the 'getRetryDelay' option.
_warn @ index-Ca73Nk8g.js:5
index-Ca73Nk8g.js:1576 Export failed: Failed to fetch
Q @ index-Ca73Nk8g.js:1576
index-Ca73Nk8g.js:1580 TypeError: Failed to fetch
    at activeContent.js:1:995
    at activeContent.js:1:2323
    at Sn (index-Ca73Nk8g.js:5:20156)
    at e._runWorker (index-Ca73Nk8g.js:5:261663)
    at Bs.runWorker (index-Ca73Nk8g.js:5:273378)
    at Bs.checkHoleAgainstWorker (index-Ca73Nk8g.js:5:272560)
    at Bs.read (index-Ca73Nk8g.js:5:271406)
    at e._read (index-Ca73Nk8g.js:5:261457)
    at eu.requestSlice (index-Ca73Nk8g.js:5:405336)
    at ba.fetchPacketForSampleIndex (index-Ca73Nk8g.js:5:122227)
JL @ index-Ca73Nk8g.js:1580
26activeContent.js:1   Uncaught (in promise) TypeError: Failed to fetch
    at activeContent.js:1:995
    at activeContent.js:1:2323
    at Sn (index-Ca73Nk8g.js:5:20156)
    at e._runWorker (index-Ca73Nk8g.js:5:261663)
    at Bs.runWorker (index-Ca73Nk8g.js:5:273378)
    at Bs.checkHoleAgainstWorker (index-Ca73Nk8g.js:5:272560)
    at Bs.read (index-Ca73Nk8g.js:5:271406)
    at e._read (index-Ca73Nk8g.js:5:261457)
    at eu.requestSlice (index-Ca73Nk8g.js:5:405336)
    at ba.fetchPacketForSampleIndex (index-Ca73Nk8g.js:5:122227)
index-Ca73Nk8g.js:1576 Exported 000265.tar.gz (5 files, 5.35 MB)
index-Ca73Nk8g.js:1576 Uploading the snippet to derivatives/clip-extractor/sub-1/beh/date-20260918_time-142446/sub-1_date-20260918_time-142326_video.mp4 (5.36 MB)…
index-Ca73Nk8g.js:1576 Uploaded derivatives/clip-extractor/sub-1/beh/date-20260918_time-142446/sub-1_date-20260918_time-142326_video.mp4
index-Ca73Nk8g.js:1576 Uploading the sidecar record to derivatives/clip-extractor/sub-1/beh/date-20260918_time-142446/sub-1_date-20260918_time-142446_video.json (735 B)…
index-Ca73Nk8g.js:1576 Uploaded derivatives/clip-extractor/sub-1/beh/date-20260918_time-142446/sub-1_date-20260918_time-142446_video.json
index-Ca73Nk8g.js:1576 Uploading dataset_description.json to dataset_description.json (976 B)…
index-Ca73Nk8g.js:1576 Uploaded dataset_description.json
index-Ca73Nk8g.js:1576 Uploading derivatives/clip-extractor/dataset_description.json to derivatives/clip-extractor/dataset_description.json (1.1 KB)…
index-Ca73Nk8g.js:1576 Uploaded derivatives/clip-extractor/dataset_description.json
index-Ca73Nk8g.js:1576 Uploading sourcedata/rawbids/dataset_description.json to sourcedata/rawbids/dataset_description.json (883 B)…
index-Ca73Nk8g.js:1576 Uploaded sourcedata/rawbids/dataset_description.json
index-Ca73Nk8g.js:1576 Upload complete: derivatives/clip-extractor/sub-1/beh/date-20260918_time-142446/
```

