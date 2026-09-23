# AI Agent Guidelines & Boundaries

These instructions apply strictly to all AI models, agents, and automated tools across every AI provider (Anthropic, OpenAI, Google/Gemini, Cursor, Windsurf, Copilot, etc.) working on this repository.

## 1. Branch Protection (`main` is strictly protected)

- **Never commit directly to `main`.**
- **Never make changes on `main`.**
- All work must take place on dedicated branches (e.g. feature/fix branches like `feat/*`, `fix/*`, `chore/*`).
- Always verify the current branch (`git branch --show-current`) before writing code or committing.

## 2. Granular Commits

- Commit progress granularly and accordingly as logical increments of work are completed.
- Do not accumulate large batches of unrelated changes into a single commit.
- A commit should not contain more then 2 - 3 files.

## 3. Single-Line Commit Messages

- **Every commit message must be exactly one line.**
- Keep commit messages brief, direct, and concise (e.g. using conventional commit prefixes: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`).
- **Never** include multi-line commit bodies, summaries, descriptions, or bulleted lists in git commit messages.

## 4. No Co-Authors

- **Under no circumstances should any co-author be added by the agent.**
- Do not append `Co-authored-by:` or any assistant attribution trailers to git commits.

## 5. Feature-Based Directory Organization

- **Organize code using feature directories**: Group functions, utilities, and components into dedicated directories named after the feature or domain they serve.
- **Group related functions**: If a function or set of functions can be grouped inside a feature folder, it must be done rather than leaving them in flat or catch-all files.
- **Self-explanatory navigation**: The source structure must be intuitive and easy to navigate and understand from folder names alone, without having to inspect file contents.

## 6. Enforcement

- Git hooks in `.githooks/` (`pre-commit` and `commit-msg`) enforce these rules automatically at the git level.
