# Development

A standard TypeScript + Vite app (structure and CI mirror [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)):

```
src/
  main.ts         # wires everything together (state, event handlers)
  style.css
  lib/            # framework-free, unit-tested logic (video, pose, annotations, payload, ffmpeg)
  ui/             # small DOM helpers (typed element lookup, log, key/value grid)
configs/          # vite/tsconfig/eslint/vitest/prettier config, kept out of the repo root
tests/unit/       # vitest specs for src/lib
```

```sh
npm install
npm run dev            # start the Vite dev server
npm run build           # typecheck + production build to dist/
npm run preview         # serve the production build locally
npm test                # run unit tests once
npm run test:watch      # unit tests in watch mode
npm run test:coverage   # unit tests with coverage
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run format           # prettier --write
```

CI (`.github/workflows/`) runs typecheck/lint/tests on every PR (`lint.yml`), deploys `main` to the `gh-pages` branch (`deploy.yml`), and stands up a per-PR preview under `pr-preview/pr-<n>/` (`preview.yml`).
