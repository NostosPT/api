# GitHub Copilot Instructions

## Boundaries & Workflow

- **Branch isolation**: Do not touch or commit to `main`. Always perform changes on `develop` or a feature branch.
- **Granular commits**: Commit logical changes incrementally.
- **Single-line commit messages**: Commit messages must always be a single line, brief, direct, and without multi-line bodies.
- **No co-authors**: Never include `Co-authored-by:` or any assistant attribution in commits.
- **Feature directory organization**: Organize code using directories grouped by feature. If functions can be grouped inside a feature folder, do so. Keep the source tree intuitive to navigate without opening files.
- Git hooks in `.githooks/` enforce single-line commits, no co-authors, and block direct commits to `main`.
