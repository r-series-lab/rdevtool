---
name: rdevtool
description: Use and manage the user's rDevTool desktop workbench through its CLI. Use for rDevTool workspaces, projects, build/deploy, Git, resources, Link tools, proxy, runtime/debug profiles, artifacts, activity/history, notes, web actions, or agent context.
---

# rDevTool

## Execution Contract

1. Prefer the CLI over GUI automation and add `--json` to machine-read commands.
2. Use `rdevtool` from `PATH` for stable behavior. If the desktop environment does not expose it through `PATH`, try `$HOME/.local/bin/rdevtool` when that executable exists. After `info` succeeds, use `identity.recommendedInvocation` when present; older builds fall back to `identity.canonicalExecutablePath` or `identity.executablePath`. Use `identity.sourceInvocation` only when explicitly testing current rDevTool source changes, or when an installed command is unavailable and the implementation is confirmed in source. Do not select a dirty source checkout merely because it exists; never bypass the stable install script's dirty-worktree guard.
3. When `agent compatibility` is available, run it after a CLI/Skill update, after an executable/source mismatch, or before relying on a command that the installed CLI might not expose. Read `data.status.success`; top-level `ok=true` only means the compatibility query completed.
4. Read only the reference for the requested domain. Start with [quick-commands.md](references/quick-commands.md); use the matching file under [generated](references/generated/index.md) only for exact or uncommon flags.
5. Inspect or plan before writes. Execute only the scope the user requested, then verify status and durable history.
6. Prefer bounded output: `workspace list --compact`, `agent context --compact`, `build run --compact`, `build status --fields state,url,commit`, and `history build --latest`.
7. Use `build run --follow` or `history replay-run --follow` when the user wants the terminal result. Do not manually repeat status calls while a supported follow mode is available.
8. Keep credentials redacted. For password, secret, token, authorization, cookie, private key, or PEM material, report presence/source only.
9. Use top-level `--workspace <key>` before a project command to scope one invocation without changing the persisted active workspace.
10. For recurring project-specific troubleshooting, inspect `notes project-path --project <key>` and read its index when it exists. Initialize the directory only when the user asks to preserve reusable project knowledge.
11. When installed CLI and source behavior may differ, run `info` first and compare `identity.executablePath`, `buildCommit`, `currentSourceCommit`, and `sourceCommitMatchesBuild`. Follow `recommendedInvocation` when present, with the executable-path fields as the backward-compatible fallback; treat `sourceInvocation` as an explicit source-testing alternative.
12. For cross-project demand review, prefer `workspace review` with explicit per-project base refs and optional path allowlists. It is read-only, uses cached refs, and reports effective workspace instance paths, repository observation, detached HEAD, comparability, conflicts, changed files, path-allowlist application, and `git diff --check`.

## Route By Intent

| Intent | Read |
| --- | --- |
| Workspace, project instance, demand setup, resources | [workspace.md](references/workspace.md) |
| Build, deploy, status, history, replay | [build.md](references/build.md) |
| Diff, review, commit, push, merge, branch operations | [git.md](references/git.md) |
| Runtime, debug profile, local proxy, Link, web checks | [runtime.md](references/runtime.md) |
| Application-specific reusable notes | [quick-commands.md](references/quick-commands.md) |
| Persistence, Activity, evidence, errors, artifacts | [operations.md](references/operations.md) |
| Exact command syntax | [generated index](references/generated/index.md) |

## Safety Rules

- Treat the system workspace as the global view. Do not switch the active workspace unless the user asks; use command-local `--repo-path` where supported.
- Use project configuration commands instead of editing `projects.toml` by hand.
- Do not trigger builds, replay, merges, branch switches, pushes, process stops, or config writes from hints alone.
- For build, run `build plan` first. For replay, run `history replay-plan` first. For Git, inspect `git push-status` or `git overview` first.
- Never retry an ambiguous side-effecting POST. Jenkins crumb GET may retry safely; a trigger POST must remain single-attempt.
- For the standard push → merge → deploy path, use `workflow promote plan` and execute only its saved `planHash`. A blocked deploy checkpoint must be inspected, never auto-retried.
- Do not kill a process unless port, cwd, command, or process group proves it belongs to the requested project.
- Never delete `observed.references`, dirty worktrees, active runtimes, symlinks, or project instances outside their workspace root.
- Keep reusable application notes under rDevTool's project data directory. Keep one-demand execution history in the demand workspace worklog, and never copy credentials or browser authentication state into either.

## Project Knowledge

- `notes project-path --project <key>` is read-only and reports the application-specific notes directory and index state.
- `notes path` and `notes init` expose or initialize the rDevTool-wide Markdown knowledge root.
- `notes project-init --project <key>` creates `notes/projects/<key>/README.md` only when missing and never overwrites an existing index.
- `notes index --project <key>` lists bounded Markdown metadata and summaries; `notes file-search <query> --project <key>` searches project notes together with shared playbooks and environment notes.
- Use Markdown topic files for durable, AI-readable runbooks: topology, environment conventions, symptom-to-cause mappings, commands, and verified outcomes.
- Prefer the project notes directory over files in the business repository for machine-, application-, authentication-, or environment-specific knowledge.
- Put cross-project procedures in `notes/playbooks/` and shared environment conventions in `notes/environments/`.
- Existing SQLite notes remain suitable for global reminders and search; project Markdown notes are the source for reusable application runbooks.
- Agent context injects only bounded non-index Markdown summaries when notes are requested. Read the returned path explicitly before relying on full note content.

## Evidence And Result Contract

Keep these boundaries explicit:

- `requested`: user or command input.
- `effective`: resolved values after workspace, profile, target, and override precedence.
- `observed`: live Git, filesystem, process, listener, HTTP, browser, or remote state.

For side effects, report:

- `executed`: the operation was accepted.
- `persisted`: durable history contains the new operation identity.
- `activityVisible`: the App synchronized the persisted record when relevant.
- `verified`: the expected terminal result was observed.

Preserve `operationId`, `planHash`, short `historyKey`, queue/build URL, commit, cwd, and effective project-instance path when exposed. Report relevant `status`, `evidence`, `risks`, and `recommendedActions`; never present configured or predicted state as observed success.

## Maintenance

Refresh exact CLI docs after changing Clap definitions:

```bash
 ./scripts/refresh-cli-reference.sh
```

Validate this Skill with the system `quick_validate.py` after editing it.
