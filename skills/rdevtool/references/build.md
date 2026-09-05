# Build, History, And Replay

## Standard Flow

1. Inspect `build targets <project>` when target parameters are unknown.
2. Run `build plan`; verify `effective.target`, `effective.env`, `effective.branch`, effective params, commit, changed paths, risks, command/cwd/output directory.
3. Run `build run` only after the plan matches user intent.
4. Add `--follow --poll-interval-ms 5000 --timeout-secs 900` when a terminal result is required.
5. Add `--compact` for operation ID, plan hash, effective parameters, URLs, state, history key, and commit without the full plan.
6. Verify persistence with `history build --latest --project <project> --env <env>`.

`deploy` is a compatibility surface for older Jenkins flows; prefer `build`.

## Status And History

- Use `build status --queue-url <url>` before Jenkins assigns a build URL.
- Use `build status --build-url <url> --fields state,url,commit` for bounded polling output.
- `history build --latest` applies project/environment filtering before selecting one record.
- History is scoped to the active workspace. The system workspace exposes global history.

## Replay

1. Run `history replay-plan <id>`.
2. Inspect the current target configuration and effective parameters.
3. Run `history replay-run <id>` only with explicit execution intent.
4. Add `--follow` for build replay; it is invalid for merge replay.

Replay branch normalization:

- Raw `BRANCH` with no current `kind=branch` parameter remains a raw one-off parameter.
- Matching raw and typed branch values merge into one structured branch.
- Conflicting values block before side effects and return both values plus executable one-off alternatives.

## Change Scope

Treat the selected remote branch commit and unrelated local dirty files as different evidence. Do not claim local uncommitted files are part of a remote deployment unless the adapter actually consumes that working tree.

## Promote Workflow

Use `workflow promote` for the standard selected-file push → environment-branch merge → deployment replay sequence.

1. Run `workflow promote plan` with project, source, target, and a build history replay ID. Add `--message` with one or more `--path` values only when committing selected files.
2. Verify the saved `planHash`, effective repository/branches, merge commits, replay parameters, and three stages.
3. Run `workflow promote run --plan-hash <hash>` in the same command-scoped workspace. Add `--follow` when the deployment must reach a terminal state.
4. Use `workflow promote status --plan-hash <hash>` for checkpoints.

Completed stages are skipped on rerun. Known push/merge failures resume from that stage. An unresolved or ambiguous deploy attempt is `blocked` and is never automatically retried.
