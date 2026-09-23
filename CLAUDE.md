# Claude Agent Guidelines

## Critical Rules & Boundaries

- **Never commit directly to `main`**: All changes and commits must occur on a dedicated feature branch. Check out a branch before making edits.
- **Granular commits**: Commit very frequently and incrementally as logical tasks are completed.
- **Single-line commits only**: Every commit message must be strictly one line, brief and direct (e.g. `feat: description`, `fix: description`). No multi-line bodies.
- **No co-authors**: Under no circumstances should any co-author (`Co-authored-by:`) or AI attribution be added to commit messages.
- **Feature-based directory organization**: Organize code using directories grouped by feature or domain. If functions can be grouped in a feature folder, do so. Make the source tree intuitive to navigate without opening files.
- **Enforcement**: Repository hooks in `.githooks/` actively validate branch and commit message constraints. Add more if needed. Do not bypass it unless there is a clear roadblock, before bypassing you must inform and ask the user about it, indepedently of the mode you are working on.
