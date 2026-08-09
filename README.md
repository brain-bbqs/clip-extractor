<p align="center">
  <img src="src/assets/mark-612.png" alt="Clip Extractor logo" width="120">
</p>

# Clip Extractor

**Live:** https://clip-extractor.brain-bbqs.org

A TypeScript + Vite video player built on [sleap-io.js](https://github.com/talmolab/sleap-io) for **selecting a clip range or a single frame from a video**, in preparation for upload to a backend. Drop a video (and optionally a SLEAP `.slp` for a pose overlay) into the top file picker, choose **Snippet** or **Frame** selector mode, and scrub to the range or frame you want. Selections stream directly from the source with no re-encoding. Upload is coming soon.

## Features

- **Top-loading source picker** with a centered **Load local file / Stream from EMBER** toggle:
  - **Load local file** — a drag-and-drop dropzone (mirroring [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)'s picker); drop a video, click to browse, or load the bundled sample (`MediaBunnyVideoBackend.fromBlob`, with an mp4box fallback).
  - **Stream from EMBER** — paste an EMBER/DANDI asset URL and stream it directly (`MediaBunnyVideoBackend.fromUrl`, with a full-download fallback); also reachable via the `?url=` param.
- **Optional SLEAP annotations step** — an on/off switch at the top right of the load card (default off) reveals a second card for loading a `.slp` (`loadSlp({ openVideos: false })`); dropping a `.slp` anywhere enables it automatically.
- **Snippet / Frame selector toggle** centered above the player:
  - **Snippet** — mark an in/out range with **[ Set In** / **Set Out ]** (or `I` / `O`); the clip streams directly, no re-encoding.
  - **Frame** — scrub to select a single frame.
- **Frame-accurate player** — play/pause, step, scrub, speed control, and a B-frame decode→display reorder (from `getFrameTimes`) so playback never jumps backwards. Keyboard: `Space` play/pause, `←/→` step, `Shift`+scrub extends the range.
- **Pose overlay** — skeleton edges + nodes drawn per track when a `.slp` is loaded.
- **Light/dark theme** with an OS-preference default and a header toggle, styled after [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader).
- **Sign in with EMBER** — the same browser-side OAuth2 (Authorization Code + PKCE) flow as [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), with the signed-in account behind the header avatar.
- **Upload destination** — the bottom card lists the signed-in user's `Incoming: ` datasets (the BBQS staging convention), narrowed by the same server-side check that a BBQS/EMBER admin co-owns the dataset, and flags a destination that is not embargoed. The Upload button itself is disabled until the backend handoff lands.

## Usage

1. Pick a source at the top: drop a local video into the picker (or click to browse; **Load the sample (mice)** works too), or switch to **Stream from EMBER** and paste an asset URL.
2. Pick **Snippet** or **Frame** mode above the player.
3. Scrub to your selection: in Snippet mode press **[ Set In** / **Set Out ]** (or `I` / `O`); in Frame mode just seek to the frame.
4. Optionally flip the **SLEAP annotations (.slp)** switch on the load card and drop a `.slp` into the card that appears.
5. **Sign in with EMBER** in the header to pick the upload destination in the bottom card; only `Incoming: ` datasets you own that a BBQS/EMBER admin also owns are offered.
6. **Upload** is coming soon.

URL params: `?url=<video>&slp=<labels>` auto-load on open.

## Development

A standard TypeScript + Vite app (structure and CI mirror [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)) — see [docs/README.md](docs/README.md) for the project layout and dev commands.

## Notes

- Remote video/SLP URLs must be CORS-accessible.
- The extraction/payload libraries (ffmpeg.wasm stream-copy trimming, clip-relative annotation JSON, payload packaging) live in `src/lib/` for the upcoming upload step.

## Initial prompt

> let's start a /new-vibe in a new PR. use sleap-io.js extensively (look at the other open PR and other vibes that have video players -- though careful, some of them are out of date). make a video player that supports both remote web endpoints + local file system access api reading (this is all handled by sleap-io.js) and is optimized for selecting a clip that we will extract with ffmpeg wasm (see PR 67 and related issue) to transmit to a ember backend (details on the handoff TBD). right now it should just be able to pull up a video, optionally with an SLP file (also sleap-io.js) and pull out the frames (+ annotations, encoded out as json for payload transmission, no SLP dependency), and get it ready for transmission to a POST request to a REST API backend (again, protocol TBD) for upload

Follow-ups locked the name (`clip-extractor`) and redesigned the interface: top-loading drag-and-drop file picker, a Video/Frame selector toggle (direct streaming, no re-encoding), an optional `.slp` loader above the player, and a single (coming soon) Upload button, with layout and styling based on [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader).
