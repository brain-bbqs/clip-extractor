# User Test Checklist

A basic manual pass through Clip Extractor's core flows, for a real browser session against
production (or a preview deploy). See [`docs/README.md`](README.md) for `?test` query params that
can stand in for steps that need a real video, sign-in, or dataset when those aren't handy.

## Sign-in and access

- [ ] Sign in via the header and confirm the user's name/avatar appears
- [ ] Confirm the dataset picker lists the signed-in user's direct-upload datasets
- [ ] Sign out and confirm the app returns to a usable signed-out state (local-only delivery)

## Loading a video

- [ ] Drag-and-drop a local video file onto the picker and confirm it loads and starts playing
- [ ] Load a video via the "Browse" pane from the EMBER Archive instead of a local file
- [ ] Confirm video metadata (duration, resolution, frame rate) displays correctly
- [ ] Try an unsupported/corrupt file and confirm a clear error message appears, not a silent failure

## Timeline and playback

- [ ] Scrub the timeline and confirm the preview frame updates accordingly
- [ ] Play/pause with both the on-screen controls and spacebar
- [ ] Step forward/backward frame-by-frame with keyboard shortcuts
- [ ] Load a long video and confirm the sliding-window timeline works (zoom/pan behaves sensibly)

## Selecting a clip

- [ ] Mark a single frame and confirm the selection UI reflects "frame" mode
- [ ] Mark a snippet range (in/out points) and confirm duration updates as you adjust either end
- [ ] Confirm the selection persists correctly when switching between play and pause

## Pose overlay (SLEAP)

- [ ] Load a matching `.slp` pose file alongside a video and confirm the pose overlay renders
- [ ] Load a mismatched `.slp` file and confirm the app refuses with a clear mismatch message

## Blur tool

- [ ] For a dataset flagged as human-subjects, confirm the blur tool is available and the warning banner shows
- [ ] Draw a blur region and confirm it's visibly applied in the preview and in the exported output
- [ ] Remove/adjust a blur region and confirm the change is reflected

## Export / local download

- [ ] Export a marked frame and confirm a valid image file downloads
- [ ] Export a marked snippet and confirm a valid video file downloads
- [ ] Confirm exported filenames follow the expected BIDS-like naming convention
- [ ] Confirm exported files play/open correctly outside the app (e.g., in a media player or image viewer)

## Upload to EMBER Archive

- [ ] Upload an exported frame/snippet to a selected dataset and confirm a progress indicator shows
- [ ] Confirm the upload completes and the asset appears in the target dataset's file listing
- [ ] Interrupt an in-progress upload (e.g., close/reload the tab) and confirm the app recovers gracefully on return
- [ ] Attempt to upload to a non-embargoed dataset and confirm upload is correctly disabled with an explanatory message

## General

- [ ] Resize the browser window / test on a smaller viewport and confirm the layout stays usable
- [ ] Reload the page mid-session and confirm no unrecoverable errors occur
- [ ] Check the browser console for unexpected errors or warnings during the above steps
