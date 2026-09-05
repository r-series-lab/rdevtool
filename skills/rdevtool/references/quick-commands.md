# Intent To Shortest Command

Use `--json` for agent-readable output.

| Intent | Command |
| --- | --- |
| Verify CLI and Skill compatibility | `rdevtool --json agent compatibility` |
| List workspaces without nested resources | `rdevtool --json workspace list --compact` |
| Inspect active workspace | `rdevtool --json workspace show` |
| Run one command in another workspace | `rdevtool --workspace <key> --json <project-command>` |
| Compact workspace handoff | `rdevtool --json agent context --for workspace --compact` |
| Review all demand worktrees against explicit bases | `rdevtool --workspace <key> --json workspace review --base <project>=origin/master --base <project>=origin/pre [--allow-path <project>=<path>]` |
| Plan a build | `rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>` |
| Run and wait for a build | `rdevtool --json build run <project> --target <target> --env <env> --branch <branch> --follow --poll-interval-ms 5000 --timeout-secs 900 --compact` |
| Read selected build state | `rdevtool --json build status --build-url <url> --fields state,url,commit` |
| Latest build in one environment | `rdevtool --json history build --latest --project <project> --env <env>` |
| Preview a replay | `rdevtool --json history replay-plan build:<historyKey>` |
| Replay and wait | `rdevtool --json history replay-run build:<historyKey> --follow --timeout-secs 900` |
| Inspect another checkout | `rdevtool --json git push-status --project <project> --repo-path <path>` |
| Diff a file in another checkout | `rdevtool --json git diff --project <project> --repo-path <path> --path <file>` |
| Commit selected files and push | `rdevtool --json git push --project <project> --repo-path <path> --message "<message>" --path <file>` |
| Plan push → merge → deploy | `rdevtool --workspace <key> --json workflow promote plan --project <project> --source <branch> --target <env-branch> --deploy-history-id build:<historyKey> [--message "<message>" --path <file>]` |
| Run and follow a saved promotion | `rdevtool --workspace <key> --json workflow promote run --plan-hash <hash> --follow --timeout-secs 900` |
| Inspect promotion checkpoints | `rdevtool --workspace <key> --json workflow promote status --plan-hash <hash>` |
| Inspect runtime readiness | `rdevtool --json runtime preflight --project <project>` |
| Diagnose one project in one workspace | `rdevtool --workspace <key> --json doctor --project <project> --debug-profile <profile>` |
| Validate workspace resource Actions | `rdevtool --workspace <key> --json action validate` |
| Inspect one resource Action | `rdevtool --workspace <key> --json action show <action-key>` |
| Run a read-only or dry-run Action | `rdevtool --workspace <key> --json action run <action-key> --set <key>=<value>` |
| Run an Action that changes state | Inspect it first, then `rdevtool --workspace <key> --json action run <action-key> --set <key>=<value> --yes` |
| Plan a two-stage Action | `rdevtool --workspace <key> --json action plan <action-key> --set <key>=<value>` |
| Inspect a persisted Action plan | `rdevtool --workspace <key> --json action plan-show <plan-id>` |
| Apply a persisted Action plan | `rdevtool --workspace <key> --json action apply --plan-id <plan-id> --yes` |
| Confirm executable/source identity and invocation | `rdevtool --json info` then read `identity.recommendedInvocation` |
| Start and wait for HTTP | `rdevtool --json runtime start --project <project>` then `rdevtool --json runtime wait --project <project> --run-id <id> --until http-verified` |
| Search recent runtime errors | `rdevtool --json runtime log --project <project> --tail 300 --errors-only` |
| Search the runtime log tail | `rdevtool --json runtime log --project <project> --tail 500 --grep "<text>"` |
| Locate the rDevTool knowledge root | `rdevtool --json notes path` |
| Initialize the rDevTool knowledge root | `rdevtool --json notes init` |
| Locate application-specific notes | `rdevtool --workspace <key> --json notes project-path --project <project>` |
| Initialize application-specific notes | `rdevtool --workspace <key> --json notes project-init --project <project>` |
| Index application and shared Markdown notes | `rdevtool --workspace <key> --json notes index --project <project> --limit 12` |
| Search application and shared Markdown notes | `rdevtool --workspace <key> --json notes file-search "<query>" --project <project> --limit 6` |
| Compact artifact risk summary | `rdevtool --json agent context --for artifacts --compact` |
| Exact syntax | `rdevtool <domain> <command> --help` |

Use repeated `--set KEY=VALUE` for target-specific build parameters. Use repeated `--path` for selected Git paths.

Action `--set` values are parsed as JSON when possible. Use `--params-file` or `--params-json -` for secrets so they do not enter shell history. `local_write`, `remote_write`, and `destructive` Actions require `--yes` unless the resolved `dry_run` role is true.

For `plan_apply` Actions, never use `action run` for a real write. Create the plan, inspect its actual target evidence, then apply the same unexpired plan. Non-secret effective parameters are replayed from the plan; provide secret parameters again via file or stdin. Apply is single-use even when the runner returns an ambiguous failure.

`workspace review` never fetches or changes repositories. Its `remoteRefsRefreshed=false` field means base refs are the locally cached remote refs; fetch separately only when the user requests synchronization or current remote state is required. Require `repositoryObserved=true` and `detached=false`; `pathAllowlistApplied=false` means path scope was not checked.

`info.identity.recommendedInvocation` keeps later commands on the inspected executable. Older builds fall back to `canonicalExecutablePath` or `executablePath`. Use `sourceInvocation` only for explicit source validation; a build/source mismatch alone is not permission to switch to a dirty checkout.

Markdown knowledge lives under rDevTool's application data directory at `notes/`: application-specific notes in `notes/projects/<project>/`, cross-project procedures in `notes/playbooks/`, and shared environment conventions in `notes/environments/`. Both init commands are idempotent and do not overwrite an existing `README.md`. `notes index` / `notes file-search` return bounded summaries and paths, not full-file context. Read the matched source before acting on a detailed procedure.
