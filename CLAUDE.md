# Development Guidelines

- Always run `pre-commit` before committing and pushing changes
- To the best of your ability, ensure tests are passing
- Follow assertion style (actual on left, expected on right)
- Always bump the version in `package.json` appropriately when any file under `src/` (except `tests/`), `configs/`, `index.html`, or `package.json`/`package-lock.json` itself, is changed. Bump once per PR: if the version was already bumped by earlier work on the same PR/branch and it hasn't been merged yet, do not bump it again for follow-up commits on that same PR, keep adding entries under the existing top-most `CHANGELOG.md` heading instead
- This project has no formal releases, so there is no `## Upcoming` staging section in `CHANGELOG.md`. Leave a short description of the change or addition directly under the top-most version heading (the same version just bumped in `package.json`; create the heading if it does not yet exist) under the appropriate subsection (`#### 🚀 Enhancement`, `#### 🐛 Bug Fix`, or `#### 🏠 Internal`); create the subsection if it does not yet exist; include the GitHub PR link at the end of each entry in the format `([#N](https://github.com/brain-bbqs/clip-extractor/pull/N))`
- Keep `CHANGELOG.md` entries concise: one sentence each, naming what changed and what it means for someone using the app. Leave the reasoning, the measurements and the mechanism to the code comments and the PR
- Prefer a single `CHANGELOG.md` entry per PR, describing the change as a whole at the level someone using the app would notice. Follow-up commits on the same PR should usually revise that entry rather than add another: a PR that ends up with a list of entries is almost always narrating its own development (including steps a later commit reversed) instead of stating where it landed. Add a second entry only for a genuinely separate change that happens to ride along. Field names, filename shapes, flag spellings and other such detail belong in the code comments and the PR description, not here
- PR titles should be human-readable and in the past tense; they should NOT use conventional commit style
- Keep PR descriptions short and to the point
- End every PR description with the prompts that asked for the work, verbatim, inside a collapsed `<details>` block titled `Original prompt`; when follow-up prompts refine the same PR, append each one to that block
- Limit use of em-dashes in all text
