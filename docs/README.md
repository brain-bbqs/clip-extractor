# Development

A standard TypeScript + Vite app (structure and CI mirror [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)):

```
src/
  main.ts         # wires everything together (state, event handlers)
  style.css
  lib/            # framework-free, unit-tested logic (video, pose, annotations, payload, ffmpeg)
  ui/             # small DOM helpers (typed element lookup, log, key/value grid)
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

CI (`.github/workflows/`) runs typecheck/lint/unit-tests-with-coverage on every PR (`lint.yml`, coverage uploaded to Codecov), runs Playwright integration tests (`test.yml`), captures visual snapshots via Chromatic for both Storybook (`chromatic-storybook.yml`) and the full app via Playwright (`chromatic-playwright.yml`), deploys `main` to the `gh-pages` branch (`deploy.yml`), and stands up a per-PR preview under `pr-preview/pr-<n>/` (`preview.yml`).
