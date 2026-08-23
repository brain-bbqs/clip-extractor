# Expected Save output

The golden trees `expectedOutput.spec.ts` holds a real Save against, one directory per live-test
link (see docs/README.md) — the whole 2x2 grid of where the video came from against what is selected
in it:

- `from_local_frame/` — `?test&mock_video&mock_ready&from_local&frame`
- `from_ember_frame/` — `?test&mock_video&mock_ready&from_ember&frame`
- `from_local_snippet/` — `?test&mock_video&mock_ready&from_local&snippet`
- `from_ember_snippet/` — `?test&mock_video&mock_ready&from_ember&snippet`

Each mirrors the BIDS-Study tree inside the saved `.tar.gz`: `manifest.txt` lists every member in
tar order (binary members included; no media is committed — the mock source is synthesized in the
page), and every JSON member is committed in full at its own path. Values the app does not decide
are spelled out as placeholders (`recording-TIMESTAMP`, `MD5-CHECKSUM`, `APP-VERSION`,
`MEDIARECORDER-DEPENDENT`, ...) — the spec's header comment defines them all.

The two snippet cases run a real ffmpeg.wasm encode. Its ~32MB core is served out of the
`@ffmpeg/core` devDependency rather than the CDN the app fetches it from in the browser, so the
encode is the app's own and the test still needs no network.

To regenerate after an intentional output change:

```
UPDATE_EXPECTED=1 npx playwright test --config configs/playwright.config.ts expectedOutput
```

then review the diff and commit the new tree.
