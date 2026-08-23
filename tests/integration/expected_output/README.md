# Expected Save output

The golden trees `expectedOutput.spec.ts` holds a real Save against, one directory per live-test
link (see docs/README.md):

- `from_local_frame/` — `?test&mock_video&mock_ready&from_local&frame`
- `from_ember_frame/` — `?test&mock_video&mock_ready&from_ember&frame`

Each mirrors the BIDS-Study tree inside the saved `.tar.gz`: `manifest.txt` lists every member in
tar order (binary members included; no media is committed — the mock source is synthesized in the
page), and every JSON member is committed in full at its own path. Values the app does not decide
are spelled out as placeholders (`recording-TIMESTAMP`, `MD5-CHECKSUM`, `APP-VERSION`,
`MEDIARECORDER-DEPENDENT`, ...) — the spec's header comment defines them all.

To regenerate after an intentional output change:

```
UPDATE_EXPECTED=1 npx playwright test --config configs/playwright.config.ts expectedOutput
```

then review the diff and commit the new tree.
