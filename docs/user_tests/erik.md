# User Test Checklist

|            |              |
| ---------- | ------------ |
| **Tester** | Erik Johnson |
| **Date**   | 9/4/26       |

A basic manual pass through Clip Extractor's core flows before a release or after a significant
change. Run through this on the deployed site, signed in with a real EMBER Archive account with
access to at least one Dandiset.

See https://github.com/talmolab/sleap-tutorial-data/tree/main/new_data/results for some example pose data.

## Sign-in and dataset selection

- [ ] Loading the page signed out shows the signed-out state and a working sign-in control
- [ ] Signing in redirects back to the app in a signed-in state, with the user's name/avatar shown
- With access to:
  - [ ] exactly one direct-upload dataset, it's selected without needing a dropdown
  - [ ] multiple direct-upload datasets, they appear in a dropdown and switching selection updates the page
  - [ ] no direct-upload datasets, the app falls back to local-only delivery
- [ ] A dataset flagged as containing human subjects data shows the warning banner and gates upload until the blur tool has been used or dismissed
- [ ] Signing out returns to the signed-out state cleanly

## Loading a video

- [ ] Dragging and dropping a local video file onto the picker loads it and playback starts
- [ ] "Browse" loads a video from the EMBER Archive instead of a local file
- [ ] Video metadata (duration, resolution, frame rate) displays correctly once loaded
- [ ] An unsupported or corrupt file shows a clear error message, not a silent failure

## Timeline and playback

- [ ] Scrubbing the timeline updates the preview frame accordingly
- [ ] Play/pause works from both the on-screen controls and the spacebar
- [ ] Frame-by-frame stepping works with the keyboard shortcuts
- [ ] A long video shows the sliding-window timeline, and zoom/pan on it behaves sensibly

## Selecting a clip

- [ ] Marking a single frame switches the selection UI to "frame" mode
- [ ] Marking a snippet range (in/out points) updates the duration as either end is adjusted
- [ ] The selection persists correctly when switching between play and pause

## Pose overlay (SLEAP)

- [ ] Loading a matching `.slp` pose file alongside a video renders the pose overlay
- [ ] Loading a mismatched `.slp` file is refused with a clear mismatch message

## Blur tool

- [ ] For a dataset flagged as human-subjects, the blur tool is available and the warning banner shows
- [ ] Drawing a blur region visibly applies it in both the preview and the exported output
- [ ] Removing or adjusting a blur region is reflected correctly

## Export / local download

- [ ] Exporting a marked frame downloads a valid image file
- [ ] Exporting a marked snippet downloads a valid video file
- [ ] Exported filenames follow the expected BIDS-like naming convention
- [ ] Exported files play/open correctly outside the app (e.g., in a media player or image viewer)

## Upload to EMBER Archive

- [ ] Uploading an exported frame/snippet to a selected dataset shows a progress indicator
- [ ] A successful upload's asset appears in the target dataset's file listing on EMBER Archive
- [ ] Interrupting an in-progress upload (e.g., close/reload the tab) recovers gracefully on return
- [ ] Attempting to upload to a non-embargoed dataset is correctly disabled, with an explanatory message

## Cross-cutting

- [ ] Reloading the page mid-session doesn't corrupt local state (localStorage) in a way that breaks the next load
- [ ] The app is usable in both light and dark OS/browser theme
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] No unexpected errors in the browser console
- [ ] Can navigate to all hyperlinks in the bottom-left

# Extra notes

Both he and Rahul were thrown off a little by the loading time for .slp files
