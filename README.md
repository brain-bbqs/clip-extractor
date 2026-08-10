<p align="center">
  <img src="src/assets/mark-612.png" alt="Clip Extractor logo" width="120">
</p>

# Clip Extractor

**Live:** https://clip-extractor.brain-bbqs.org

A TypeScript + Vite video player built on [sleap-io.js](https://github.com/talmolab/sleap-io) for **selecting a clip range or a single frame from a video** and then **downloading it or uploading it to EMBER**. Drop a video (and optionally a SLEAP `.slp` for a pose overlay) into the top file picker, choose **Snippet** or **Frame** selector mode, scrub to the range or frame you want, and pick **Save** or **Upload** in the bottom card. Playback streams directly from the source with no re-encoding; only the extracted snippet is re-encoded, frame-exactly, on the way out.

## Features

- **Top-loading source picker** with a centered **Load local file / Stream from EMBER** toggle:
  - **Load local file** — a drag-and-drop dropzone (mirroring [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)'s picker); drop a video, click to browse, or load the bundled sample (`MediaBunnyVideoBackend.fromBlob`, with an mp4box fallback).
  - **Stream from EMBER** — paste an EMBER/DANDI asset URL and stream it directly (`MediaBunnyVideoBackend.fromUrl`, with a full-download fallback); also reachable via the `?url=` param.
- **Optional SLEAP annotations step** — an on/off switch at the top right of the load card (default off) reveals a second card for loading a `.slp` (`loadSlp({ openVideos: false })`); dropping a `.slp` anywhere enables it automatically.
- **Snippet / Frame selector toggle** centered above the player:
  - **Snippet** — bound the range with the two **In** / **Out** handles on the trim track under the playhead; the clip streams directly, no re-encoding.
  - **Frame** — scrub to select a single frame.
  - Switching between the two keeps whatever was marked, so a look at a single frame does not cost you a snippet range you had already trimmed.
- **Two-handle trim track** — a second track under the playhead slider carrying the **In** and **Out** handles and the band between them, so scrubbing and trimming never compete for the same drag. Drag either handle to trim, drag the band to slide the whole range at its current length, or press anywhere on the track to bring the nearer handle to it. Handles are keyboard-operable (`←/→` by one frame, `Shift` by ten, `Home`/`End` to the bounds), and `[` / `]` (or `I` / `O`) still mark either end at the playhead.
- **Typed frame indices** — the **In**, **Current** and **Out** readouts under the transport are entry fields: type an exact frame and press `Enter` instead of hunting for it. Out-of-range entries are clamped rather than rejected.
- **Frame-accurate player** — play/pause, step, scrub, speed control, and a B-frame decode→display reorder (from `getFrameTimes`) so playback never jumps backwards. Keyboard: `Space` play/pause, `←/→` step, `Shift`+scrub extends the range.
- **Pose overlay** — skeleton edges + nodes drawn per track when a `.slp` is loaded.
- **Light/dark theme** with an OS-preference default and a header toggle, styled after [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader).
- **Sign in with EMBER** — the same browser-side OAuth2 (Authorization Code + PKCE) flow as [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), with the signed-in account behind the header avatar.
- **Save / Upload toggle** centered on the bottom card, which starts on whichever route is actually usable: **Upload** when you are signed in with at least one incoming dataset, otherwise **Save**. Whichever side you pick is remembered across refreshes.
  - **Description** — a required free-text box above both panes: what event the selection showcases, what went wrong in it, or anything else worth passing on with it. Neither button is available until it is filled in, and what it says travels either way, written into the provenance JSON described below.
  - **Save** — writes the selection to your computer as a single `.tar.gz` holding **exactly what an upload would have sent**: the extracted snippet (a frame-exact MP4 trimmed by ffmpeg.wasm) or frame (a PNG), the pose overlay, the original content, and the provenance JSON. It unpacks into one dated folder, `date-<YYYYMMDD>_time-<HHMMSS>_type-snippet/` (or `_type-frame`), with the original content in an `original/` subdirectory of it — the same directory an upload writes, minus the archive's `sourcedata/raw/` prefix, which means nothing outside a dandiset. Every file is checksummed on the way in, so the bundle's provenance quotes the same `dandi:dandi-etag` digests the archive would have registered.
  - **Upload** — sends the same set of files to the EMBER dataset picked below the toggle, into its own directory under `sourcedata/raw/clip-extractor/date-<YYYYMMDD>_time-<HHMMSS>_type-snippet/` (or `_type-frame`), following the same `sourcedata/raw/` convention as [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader). The extracted selection always goes up first. Transfers use DANDI's own multipart flow: dandi-etag checksum, presigned part PUTs straight to S3, then asset registration. When it finishes, the button is replaced by a status line linking straight into the archive's file browser at that upload's own directory, ready to view or share — so the same selection is not sent twice. Changing the selection, the source or the destination brings the button back.
  - **Include the original content** is recommended and pre-selected, but optional, and applies to both routes: it covers the source video and any loaded `.slp`.
- **BIDS-style names** — every file this app writes is named in entity style, `key-value` pairs joined by underscores and closed by a `type-` entity, so one glance says what a file is:
  - `name-mice_range-120+300_type-snippet_video.mp4` — the extracted snippet, with its inclusive frame range
  - `name-mice_range-120+300_type-snippet_provenance.json` — its sidecar, sharing every entity and differing only in the suffix
  - `name-mice_index-42_type-frame_image.png` and `name-mice_index-42_type-frame_provenance.json` — a single extracted frame and its sidecar
  - `name-mice_range-120+300_type-snippet_overlay.mp4` — the same selection with the pose drawn in
  - `name-mice_range-120+300_type-snippet_bundle.tar.gz` — a saved bundle, holding all of the above
  - The `name-` label is reduced to alphanumerics so the entities stay unambiguous to parse, with every word separator (space, `_`, `-`, punctuation) marked as `+`: `mice_new` becomes `name-mice+new`. The unabridged original file name is preserved in the provenance record.
  - **Original content is never renamed** — the source video and any `.slp` are untouched, so they keep the names they arrived with (minus spaces), and they sit together in an `original/` subdirectory of the delivery, apart from the files this app produced.
- **Pose overlay version** — whenever a `.slp` is loaded, a delivery also carries a rendered copy of the selection with the skeleton drawn into the pixels, for looking at without a viewer that understands `.slp`: a PNG in Frame mode, an H.264 MP4 in Snippet mode (drawn frame by frame, then encoded by the same ffmpeg.wasm that trims the plain snippet, so it does not depend on which codecs the browser can encode). It is **not** governed by the "include the original content" toggle — it is a view of the selection, not a copy of a source.
- **Provenance sidecar** — every delivery also writes a provenance JSON into the same directory: the description typed above the buttons, who uploaded it, the destination dataset (`null` for a saved bundle, which has no archive behind it), the source video's name and `dandi:dandi-etag` checksum (recorded **even when the original is not included**, so the clip can always be traced back to it), the video's fps/dimensions/frame count, the exact frame range, the extracted file's own size and checksum, the literal ffmpeg command that produced it, the rendered overlay's own size, checksum and command, and any loaded `.slp` (its name, checksum and counts, again whether or not it rode along).
- **Upload destination** — the upload pane lists the signed-in user's `Incoming: ` datasets (the BBQS staging convention), narrowed by the same server-side check that a BBQS/EMBER admin co-owns the dataset, and blocks a destination that is not embargoed.

## Usage

1. Pick a source at the top: drop a local video into the picker (or click to browse; **Load the sample (mice)** works too), or switch to **Stream from EMBER** and paste an asset URL.
2. Pick **Snippet** or **Frame** mode above the player.
3. Pick your selection: in Snippet mode drag the **In** and **Out** handles on the trim track (or type frame indices into the **In** / **Out** boxes, or press `I` / `O` to mark either end at the playhead); in Frame mode seek to the frame, or type its index into the **Current** box.
4. Optionally flip the **SLEAP annotations (.slp)** switch on the load card and drop a `.slp` into the card that appears.
5. In the bottom card, describe the selection — what event it showcases, or what went wrong in it — then pick **Save** to write it to your computer as a `.tar.gz`, or **Upload** to send it to EMBER. Both carry the same files and the same description, and neither is available until the description is filled in.
6. For an upload, **Sign in with EMBER** in the header first; only `Incoming: ` datasets you own that a BBQS/EMBER admin also owns are offered. Leave **Include the original content** on unless you know the source is already archived — either way, its name and checksum are recorded in the provenance JSON written alongside the clip.

URL params: `?url=<video>&slp=<labels>` auto-load on open.

## Development

A standard TypeScript + Vite app (structure and CI mirror [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)) — see [docs/README.md](docs/README.md) for the project layout and dev commands.

## Notes

- Remote video/SLP URLs must be CORS-accessible.
- Sign-in, token storage, and the admin-check service's trust boundary are documented in [SECURITY.md](SECURITY.md), mirroring [bbqs-uploader's](https://github.com/brain-bbqs/bbqs-uploader/blob/main/SECURITY.md).
- Extraction and transfer live in `src/lib/`: `extract.ts` (ffmpeg.wasm trimming and frame encoding), `etag.ts`/`s3.ts`/`upload.ts` (the DANDI upload pipeline, ported from bbqs-uploader), `delivery.ts` (the destination path and the default toggle side), `bundle.ts` (the tar + `CompressionStream` gzip behind a saved bundle, no dependency), and `provenance.ts` (the `clip-extractor-provenance/v1` sidecar). The clip-relative annotation JSON and payload-packaging helpers are also there, for a future annotations sidecar upload.
- Local content travels from the bytes already in the browser; a range-streamed URL is treated as already archived, so the "include the original content" option is not offered for it (and its checksum cannot be recorded, which the provenance file says explicitly).
- The source video and any `.slp` are checksummed even when they are not being uploaded, since that checksum is what ties a clip back to its source. For a multi-gigabyte source that hashing takes a while; it is chunked and reported in the status line.

## Initial prompt

> let's start a /new-vibe in a new PR. use sleap-io.js extensively (look at the other open PR and other vibes that have video players -- though careful, some of them are out of date). make a video player that supports both remote web endpoints + local file system access api reading (this is all handled by sleap-io.js) and is optimized for selecting a clip that we will extract with ffmpeg wasm (see PR 67 and related issue) to transmit to a ember backend (details on the handoff TBD). right now it should just be able to pull up a video, optionally with an SLP file (also sleap-io.js) and pull out the frames (+ annotations, encoded out as json for payload transmission, no SLP dependency), and get it ready for transmission to a POST request to a REST API backend (again, protocol TBD) for upload

Follow-ups locked the name (`clip-extractor`) and redesigned the interface: top-loading drag-and-drop file picker, a Video/Frame selector toggle (direct streaming, no re-encoding), an optional `.slp` loader above the player, and a bottom Save/Upload card, with layout and styling based on [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader).
