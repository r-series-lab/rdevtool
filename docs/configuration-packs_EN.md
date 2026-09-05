# Configuration Import and Export

rDevTool uses `.rdtpack` archives to move project, workspace, and resource configuration between machines or distribute credential-free team templates.

The workflow is deliberately staged: **inspect -> plan -> resolve mappings and conflicts -> apply -> roll back when needed**.

## Modules

Schema `v1` supports:

| Module | Contents |
| --- | --- |
| `projects` | Project identity, repository URL, local commands, runtime profiles, build/deploy targets, and Git branch rules |
| `workspaces` | Workspace scope, project instances, resource categories, directories, and work-log settings |
| `preferences` | Menu and appearance preferences, excluding the active workspace |
| `config_sources` | Resources, Actions, Links, local proxy configuration, and runtime overrides from selected sources |

Packs do not contain repositories, build outputs, activity/history data, databases, knowledge-base Markdown content, or other business files.

## Desktop Workflow

Open **Settings -> Configuration Transfer**.

For export, choose modules and exact project/workspace scopes, keep dependency inclusion enabled, choose one or more resource configuration sources, and save the `.rdtpack` file.

For import, select a pack, choose a conflict strategy, map each packed source to a local source, generate a plan, and complete required local path mappings. Search or filter operations by module and action, exclude unwanted items, then update the plan before applying. Same-name sources are mapped automatically.

Each operation has a stable ID. The selected IDs participate in `planHash`, so a changed selection must be replanned and excluded operations do not require unrelated path or secret mappings. The **History** tab reads durable transaction manifests and shows the latest 100 valid imports, their applied/skipped counts, changed files, and rollback state.

## Conflict Strategies

- `merge` combines object fields and merges identified arrays by `key`, `id`, `name`, or `title`.
- `add` adds missing entries and skips conflicts.
- `replace` replaces conflicting entities with the packed version.
- `skip` skips conflicts while still adding missing entries.

`merge` is the default. Use `replace` only after reviewing the generated plan.

## Portability and Secrets

Machine-specific paths become `${PROJECT_ROOT:key}`, `${WORKSPACE_ROOT:key}`, or `${HOME}` placeholders. Existing targets reuse their current paths; new targets require explicit mappings.

Jenkins passwords and GitLab tokens are never exported. Suspected secrets in environment maps, headers, and authentication helpers become environment references. Missing secrets are warnings by default and blockers with CLI `--require-secrets`.

## CLI

```bash
rdevtool --json pack inventory
rdevtool pack export team.rdtpack --preferences --include-config-sources
rdevtool --json pack inspect team.rdtpack
rdevtool --json pack import-plan team.rdtpack \
  --strategy merge \
  --project-root admin=/Users/me/Projects/admin \
  --config-source-map default=default
rdevtool --json pack import-run --plan-hash rdtpack-<sha256>
rdevtool --json pack rollback <transaction-id>
```

Plans expire after 24 hours and include fingerprints for every proposed file. Apply revalidates the pack checksum and destination state, then snapshots and atomically writes targets under one configuration lock set. Every import creates a transaction backup under `config-pack-backups/<transaction-id>/`; failed writes restore the complete original set automatically.

Transactions also store fingerprints of the applied files. Rollback verifies those fingerprints under the configuration lock and refuses to overwrite files changed after import. If rollback itself fails partway through, rDevTool restores the pre-rollback state.
