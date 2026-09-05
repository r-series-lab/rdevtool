# Git Operations

## Inspect First

- `git current <project>`: current configured checkout branch.
- `git push-status --project <project> [--repo-path <path>]`: ahead/behind, staged, unstaged, untracked, conflicts, latest commit.
- `git diff --project <project> --path <file> [--repo-path <path>]`: bounded file diff; add `--mode staged|unstaged|head`, `--max-lines`, or `--max-bytes`.
- `git overview --project <project> --source <branch> --target <branch>`: merge comparison.

## Execute

- `git push --project <project> --repo-path <path>` pushes committed content only.
- Add `--message` to commit before push.
- Add repeated `--path` to commit only selected paths.
- `git merge`, `git merge-many`, `git create`, `git clone`, and `git switch` are side effects and require explicit user intent.

`--repo-path` is command-local. Prefer it over switching the active workspace when operating on a known checkout.

## Risk Checks

- Conflicts block commit, push, or merge.
- Staged and unstaged files are separate states.
- Call out untracked and sensitive-looking config files before commit.
- A dirty worktree does not imply its files are part of a remote branch build.
- Verify push by upstream/ahead state and resulting commit, not only by a successful process exit.
