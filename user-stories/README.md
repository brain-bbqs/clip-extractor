# User stories

User stories for tools in the EMBER ecosystem. A user story is a short, plain-language statement of who needs something, what they need, and why:

> As a **[kind of user]**, I want **[a capability]**, so that **[an outcome I care about]**.

Each story also carries **acceptance criteria**: concrete, checkable conditions under which the story is satisfied. Where it helps, a story includes a Mermaid diagram of the workflow it describes.

This material is written to be read on GitHub. It is deliberately not part of the [EMBER documentation site](https://docs.emberarchive.org).

## Why we write these down

BBQS teams span many labs, species, recording modalities, and levels of computational comfort. Tools built for the program have to earn their place by solving problems those teams actually have. Writing the problems down as user stories:

- keeps a tool's scope anchored to real needs raised by BBQS task forces and working groups,
- gives reviewers and funders a plain-language account of why the tool exists,
- gives developers a checklist to test against, and
- gives future contributors the context for why a feature exists before they change it.

## Tools covered

| Tool                                       | Where the need came from                                         |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [Clip Extractor](clip-extractor/README.md) | Pose Estimation Task Force discussions at the 2026 BBQS workshop |

## Layout

One folder per tool:

```text
user-stories/
├── README.md                     this file
├── story-template.md             template for a new story
└── <tool>/
    ├── README.md                 the tool's problem, solution, users, and story index
    ├── story-01-<descriptor>.md
    └── story-02-<descriptor>.md
```

## Contributing a story

Stories are living documents. If your team has a need that is not captured, or a story does not match how you actually work, open a pull request.

1. Copy [`story-template.md`](story-template.md) to the relevant tool folder as `story-<counter>-<descriptor>.md`, continuing that folder's numbering. Use a short, hyphenated descriptor drawn from the story title.
2. Fill it in: the persona in one line, the story in the "As a / I want / so that" form, why it matters, and two to five acceptance criteria that could be checked by someone other than you. A Mermaid diagram of the workflow is optional.
3. Link the new file from the story index in the tool's `README.md`, and update the previous/next navigation in the neighbouring story files.

If the tool does not have a folder yet, create one with a `README.md` describing the problem it solves, the solution, and who it is for, then add the tool to the table above.

Style conventions for these pages are recorded in [`CLAUDE.md`](../CLAUDE.md): no manual `<br/>` line breaks inside Mermaid labels, and no task-list checkboxes.

Questions can go to [help@emberarchive.org](mailto:help@emberarchive.org).
