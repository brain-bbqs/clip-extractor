# User Test Checklist

|            |        |
| ---------- | ------ |
| **Tester** | Rahul  |
| **Date**   | 9/3/26 |

A basic manual pass through Clip Extractor's core flows before a release or after a significant
change. Run through this on the deployed site, signed in with a real EMBER Archive account with
access to at least one Dandiset.

See https://github.com/talmolab/sleap-tutorial-data/tree/main/new_data/results for some example pose data.

## Sign-in and dataset selection

- [x] Loading the page signed out shows the signed-out state and a working sign-in control
- [x] Signing in redirects back to the app in a signed-in state, with the user's name/avatar shown
  - NOTE: Doing the process and signing out reset the entire page
- With access to:
  - [ ] ~~exactly one direct-upload dataset, it's selected without needing a dropdown~~
  - [x] multiple direct-upload datasets, they appear in a dropdown and switching selection updates the page
  - [ ] ~~no direct-upload datasets, the app falls back to local-only delivery~~
- [x] A dataset flagged as containing human subjects data shows the warning banner and gates upload until the blur tool has been used or dismissed
- [ ] Signing out returns to the signed-out state cleanly
  - NOTE: did not have time to try

## Loading a video

- [x] Dragging and dropping a local video file onto the picker loads it and playback starts
- [ ] "Browse" loads a video from the EMBER Archive instead of a local file
    - NOTE: Did not have time to try
- [x] Video metadata (duration, resolution, frame rate) displays correctly once loaded
- [x] An unsupported or corrupt file shows a clear error message, not a silent failure

## Timeline and playback

- [x] Scrubbing the timeline updates the preview frame accordingly
- [x] Play/pause works from both the on-screen controls and the spacebar
- [x] Frame-by-frame stepping works with the keyboard shortcuts
- [ ] A long video shows the sliding-window timeline, and zoom/pan on it behaves sensibly
  - NOTE: did not have a video to try

## Selecting a clip

- [x] Marking a single frame switches the selection UI to "frame" mode
- [x] Marking a snippet range (in/out points) updates the duration as either end is adjusted
- [x] The selection persists correctly when switching between play and pause

## Pose overlay (SLEAP)

- [x] Loading a matching `.slp` pose file alongside a video renders the pose overlay
- [ ] Loading a mismatched `.slp` file is refused with a clear mismatch message
  - NOTE: did not have an example to try; maybe include link at the top of the template to the other `.slp` example?

## Blur tool

- [x] For a dataset flagged as human-subjects, the blur tool is available and the warning banner shows
- [x] Drawing a blur region visibly applies it in both the preview and the exported output
- [x] Removing or adjusting a blur region is reflected correctly

## Export / local download

- [x] Exporting a marked frame downloads a valid image file
- [x] Exporting a marked snippet downloads a valid video file
- [x] Exported filenames follow the expected BIDS-like naming convention
- [x] Exported files play/open correctly outside the app (e.g., in a media player or image viewer)

NOTE: when exporting blurred version, need to deal better with including original content [can't bundle as intended but still says (recommended)]

## Upload to EMBER Archive

- [ ] Uploading an exported frame/snippet to a selected dataset shows a progress indicator
- [ ] A successful upload's asset appears in the target dataset's file listing on EMBER Archive
- [ ] Interrupting an in-progress upload (e.g., close/reload the tab) recovers gracefully on return
- [ ] Attempting to upload to a non-embargoed dataset is correctly disabled, with an explanatory message

NOTE: did not have time to try

## Cross-cutting

- [ ] Reloading the page mid-session doesn't corrupt local state (localStorage) in a way that breaks the next load
- [x] The app is usable in both light and dark OS/browser theme
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] No unexpected errors in the browser console

NOTE: did not have time to check most of these
