# Development

A standard TypeScript + Vite app (structure and CI mirror [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)):

```
src/
  main.ts         # wires everything together (state, event handlers)
  style.css
  lib/            # framework-free, unit-tested logic (video, pose, annotations, extraction, upload)
  ui/             # small DOM helpers (typed element lookup, identity readout, blob download)
configs/          # vite/tsconfig/eslint/vitest/prettier/playwright/storybook config, kept out of the repo root
stories/          # Storybook stories (visual snapshots, checked by Chromatic)
tests/unit/       # vitest specs for src/lib
tests/integration/ # Playwright specs against a built preview server
tests/chromatic/  # Playwright specs captured by Chromatic (visual regression)
```

```sh
npm install
npm run dev              # start the Vite dev server
npm run build             # typecheck + production build to dist/
npm run preview           # serve the production build locally
npm test                  # run unit tests once
npm run test:watch        # unit tests in watch mode
npm run test:coverage     # unit tests with coverage
npm run test:integration  # Playwright integration tests (builds + serves dist/ first)
npm run test:chromatic    # Playwright tests used for Chromatic visual regression
npm run typecheck         # tsc --noEmit
npm run lint              # eslint
npm run format            # prettier --write
npm run storybook         # start Storybook locally (port 6006)
npm run build-storybook   # build the static Storybook site
```

## Expected console noise

Warnings that are known, harmless, and not fixable from this repo — don't go chasing them:

- **`A VideoSample was garbage collected without first being closed.`** — logged by
  [mediabunny](https://github.com/Vanilagy/mediabunny) once per second (it rate-limits) whenever a
  video is loaded or scrubbed. It comes from `MediaBunnyVideoBackend` inside
  `@talmolab/sleap-io.js`, which decodes a frame with
  `sample.toVideoFrame()` → `createImageBitmap(videoFrame)` → `videoFrame.close()`, but never
  closes the `VideoSample` itself. For a decoder-backed sample `toVideoFrame()` returns a _clone_
  (`new VideoFrame(this._data, …)`), so closing the clone leaves the decoder's own frame open until
  mediabunny's `FinalizationRegistry` closes it at GC time — which is what logs the warning. The
  sample never crosses the backend's API boundary (this app only ever receives the `ImageBitmap`),
  so there is nothing to close on our side; the fix is a `sample.close()` upstream. Still present in
  sleap-io.js 0.5.8.

CI (`.github/workflows/`) runs typecheck/lint/unit-tests-with-coverage on every PR (`lint.yml`, coverage uploaded to Codecov), runs Playwright integration tests (`test.yml`), captures visual snapshots via Chromatic for both Storybook (`chromatic-storybook.yml`) and the full app via Playwright (`chromatic-playwright.yml`), deploys `main` to the `gh-pages` branch (`deploy.yml`), and stands up a per-PR preview under `pr-preview/pr-<n>/` (`preview.yml`). [pre-commit.ci](https://pre-commit.ci) runs `.pre-commit-config.yaml` (yaml/whitespace checks, prettier, eslint) on every PR and auto-fixes what it can.
