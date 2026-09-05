# Workspace And Resources

## Workspace Scope

- `workspace list --compact` is the default inventory command.
- `workspace show [key]` returns full scope, project instances, resources, and worklog state.
- The system workspace is global. Task workspaces may rebind project paths to worktrees or clones.
- Use `rdevtool --workspace <key> ...` to scope one project command, history query, navigation operation, or operation record without changing the active workspace.
- Use domain-level `--repo-path` when a command must target a checkout outside the selected workspace.
- Top-level `--workspace` must appear before the command. Command-specific `--workspace` options keep their existing resource-target meaning.

## Demand Initialization

Use `workspace init-demand ... --dry-run` before creating a demand workspace.

- `--copy-mode existing`: bind an existing checkout; it is not rDevTool-owned.
- `--copy-mode worktree`: create a branch-backed task checkout.
- `--copy-mode clone`: create an independent clone.

Verify planned actions, effective instance directory, ownership, remote identity, and risks before running without `--dry-run`.

## Demand Review

Use `workspace review` for a read-only review across every project instance in a demand workspace:

```bash
rdevtool --workspace <key> --json workspace review \
  --base <project-a>=origin/master \
  --base <project-b>=origin/pre \
  --allow-path <project-a>=src/required-file.ts
```

- Repeat `--base` for projects with different baselines.
- Repeat `--allow-path` for exact files; a trailing `/**` allows a directory tree.
- When no explicit base is supplied, the command uses the current upstream if configured.
- No fetch is performed. Read `requested.remoteRefsRefreshed=false` and do not present cached refs as freshly observed remote state.
- Review output distinguishes configured and effective repository paths and reports instance ownership, repository observation, detached HEAD, current/base commits, comparability, ahead/behind, conflicts, changed files, unexpected paths, and `git diff --check`.
- Require `repositoryObserved=true` and `detached=false` before treating a project as ready. `pathAllowlistApplied=false` means no path constraint was requested; it does not mean an allowlist check passed.
- Compact workspace context exposes the same path distinction under `workspace.projectInstances[]`; use `effectiveRepoPath` for file operations and treat `configuredRepoPath` as configuration provenance only.

## Resources And Navigation

- Keep demand-specific entries in `navigation add --workspace <key>`.
- Use global navigation writes only for shared resources.
- `kind=tool` is the formal reusable tool entry.
- Link tools should use `--tool link --tool-key <key> --tool-action plan`.
- Workspace worklog records terminal operations when auto-recording is enabled.

## Configuration Sources

Use `config-source list/show/compare` for inspection. `copy` and `use` persist configuration and need explicit intent. Prefer these commands over direct config-file edits.
