# Changelog

## 0.1.2

#### 🚀 Enhancement

- Removed the "Selection: full video" summary shown before a range is trimmed, since the handles already sit at the video's own bounds ([#17](https://github.com/brain-bbqs/clip-extractor/pull/17))
- Dropped the word "Play" from the play button, leaving the glyph now that the step buttons carry arrows instead of triangles ([#17](https://github.com/brain-bbqs/clip-extractor/pull/17))

#### 🐛 Bug Fix

- Playback again loops inside the marked range: with the trim handles the playhead is no longer moved when a range is marked, so pressing play started outside the band and ran the whole way up to Out before wrapping ([#17](https://github.com/brain-bbqs/clip-extractor/pull/17))

## 0.1.1

#### 🚀 Enhancement

- Replaced the frame step buttons' triangle glyphs with the arrow keys they are bound to, so they no longer read as a smaller copy of the play button, and gave both an explicit screen reader label ([#16](https://github.com/brain-bbqs/clip-extractor/pull/16))

#### 🏠 Internal

- Adopted version bumping and changelog conventions, and backfilled this changelog from the project's history to date ([#16](https://github.com/brain-bbqs/clip-extractor/pull/16))

## 0.1.0

Everything built before the project began tracking versions.

#### 🚀 Enhancement

- Replaced the trim buttons with In and Out handles dragged directly on the timeline ([#15](https://github.com/brain-bbqs/clip-extractor/pull/15))
- Added the BBQS, CON, and Talmo Lab watermarks and a version indicator to the footer ([#14](https://github.com/brain-bbqs/clip-extractor/pull/14))
- Unified the save and upload routes so both deliver the same tar.gz bundle ([#13](https://github.com/brain-bbqs/clip-extractor/pull/13))
- Added download and upload delivery modes for extracted selections ([#12](https://github.com/brain-bbqs/clip-extractor/pull/12))
- Added EMBER OAuth sign-in and an upload destination picker ([#11](https://github.com/brain-bbqs/clip-extractor/pull/11))
- Added Google Analytics behind a GDPR cookie consent banner ([#10](https://github.com/brain-bbqs/clip-extractor/pull/10))
- Redesigned the UI with a light and dark theme toggle and a simplified extraction flow ([#8](https://github.com/brain-bbqs/clip-extractor/pull/8))
- Added the video player itself: frame range selection, extraction to an upload-ready payload, and a pose overlay ([#1](https://github.com/brain-bbqs/clip-extractor/pull/1))

#### 🏠 Internal

- Added GitHub issue templates for bug reports and feature requests ([#9](https://github.com/brain-bbqs/clip-extractor/pull/9))
- Added REUSE licensing compliance and a pre-commit hook ([#7](https://github.com/brain-bbqs/clip-extractor/pull/7))
- Bumped codecov/codecov-action from 5 to 7 ([#5](https://github.com/brain-bbqs/clip-extractor/pull/5))
- Added Playwright integration tests, Storybook, and Chromatic visual review ([#4](https://github.com/brain-bbqs/clip-extractor/pull/4))
- Migrated from a single-file HTML page to modular TypeScript built with Vite ([#3](https://github.com/brain-bbqs/clip-extractor/pull/3))
- Deployed the app to the GitHub Pages root on push to main ([#2](https://github.com/brain-bbqs/clip-extractor/pull/2))
- Added the initial repository scaffolding, along with the preview and Dependabot workflows
