<p align="center">
  <img src="src/assets/mark-612.png" alt="Clip Extractor logo" width="120">
</p>

# Clip Extractor

**Live:** https://clip-extractor.brain-bbqs.org

A TypeScript + Vite video player built on [sleap-io.js](https://github.com/talmolab/sleap-io) for **selecting a clip range or a single frame from a video**, in preparation for upload to a backend. Drop a video (and optionally a SLEAP `.slp` for a pose overlay) into the top file picker, choose **Video** or **Frame** selector mode, and scrub to the range or frame you want. Selections stream directly from the source with no re-encoding. Upload is coming soon.

## Features

- **Top-loading drag-and-drop file picker** (mirroring [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)'s dropzone) — drop a video and/or a `.slp`, click to browse, or load the bundled sample.
- **Load anything sleap-io.js can open**
  - Local video files (`MediaBunnyVideoBackend.fromBlob`, with an mp4box fallback)
  - Remote video URLs via the `?url=` param (streamed via `MediaBunnyVideoBackend.fromUrl`, with a full-download fallback)
  - Optional SLEAP `.slp` (drop it in, or the **Load .slp file** button above the player), loaded with `loadSlp({ openVideos: false })`
- **Video / Frame selector toggle** above the player:
  - **Video** — mark an in/out range with **[ Set In** / **Set Out ]** (or `I` / `O`); the clip streams directly, no re-encoding.
  - **Frame** — scrub to select a single frame.
- **Frame-accurate player** — play/pause, step, scrub, speed control, and a B-frame decode→display reorder (from `getFrameTimes`) so playback never jumps backwards. Keyboard: `Space` play/pause, `←/→` step, `Shift`+scrub extends the range.
- **Pose overlay** — skeleton edges + nodes drawn per track when a `.slp` is loaded.
- **Light/dark theme** with an OS-preference default and a header toggle, styled after [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader).
- **Upload** — a single button, disabled until the backend handoff lands.

## Usage

1. Drop a video (and optionally a `.slp`) into the picker at the top, or click it to browse. **Load the sample (mice)** works too.
2. Pick **Video** or **Frame** mode above the player.
3. Scrub to your selection: in Video mode press **[ Set In** / **Set Out ]** (or `I` / `O`); in Frame mode just seek to the frame.
4. **Upload** is coming soon.

URL params: `?url=<video>&slp=<labels>` auto-load on open.

## Development

A standard TypeScript + Vite app (structure and CI mirror [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)) — see [docs/README.md](docs/README.md) for the project layout and dev commands.

## Notes

- Remote video/SLP URLs must be CORS-accessible.
- The extraction/payload libraries (ffmpeg.wasm stream-copy trimming, clip-relative annotation JSON, payload packaging) live in `src/lib/` for the upcoming upload step.

## Initial prompt

> let's start a /new-vibe in a new PR. use sleap-io.js extensively (look at the other open PR and other vibes that have video players -- though careful, some of them are out of date). make a video player that supports both remote web endpoints + local file system access api reading (this is all handled by sleap-io.js) and is optimized for selecting a clip that we will extract with ffmpeg wasm (see PR 67 and related issue) to transmit to a ember backend (details on the handoff TBD). right now it should just be able to pull up a video, optionally with an SLP file (also sleap-io.js) and pull out the frames (+ annotations, encoded out as json for payload transmission, no SLP dependency), and get it ready for transmission to a POST request to a REST API backend (again, protocol TBD) for upload

Follow-ups locked the name (`clip-extractor`) and redesigned the interface: top-loading drag-and-drop file picker, a Video/Frame selector toggle (direct streaming, no re-encoding), an optional `.slp` loader above the player, and a single (coming soon) Upload button, with layout and styling based on [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader).
