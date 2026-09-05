# Operations, Evidence, And Artifacts

## Durable Lifecycle

For build, deploy, merge, push, or replay, keep these states separate:

1. `executed`: local/remote operation accepted.
2. `persisted`: matching durable history exists.
3. `activityVisible`: Activity synchronized the durable record.
4. `verified`: terminal result matches intent.

Match builds by history key and queue/build URL. Match merges by project, branches, commit, and timestamp. Activity is eventually consistent and is not the source of truth.

New build and merge records use compact IDs such as `build-0123456789ab` and `merge-0123456789ab`; queue/build URLs remain separate fields. Legacy URL-shaped history keys remain valid for lookup and replay.

Storage timestamps use UTC RFC3339 with an explicit `Z`. Treat older records as UTC after schema migration.

## Errors

- Parse stable JSON error codes and structured `details`; do not scrape human text.
- Jenkins crumb failures expose `retryable`, `attempts`, and `sideEffectOccurred:false`.
- Replay branch conflicts expose structured/raw values, one-off alternatives, and `sideEffectOccurred:false`.
- A timeout does not imply the remote operation failed; preserve URLs and query status/history.

## Managed Artifacts

1. Use `agent context --for artifacts --compact` for counts and risk intake.
2. Use `artifacts list` for individual paths.
3. Keep `observed.artifacts` separate from `observed.references`.
4. Run `artifacts cleanup-plan` with the same filters.
5. Stop after the plan when `executionSupported=false`.

Never substitute `rm` for a missing cleanup command.
