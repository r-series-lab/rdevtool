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

For import, select a pack, choose a conflict strategy, map each packed source to a local source, generate a plan, complete required local path mappings, review every blocker and operation, then apply. Same-name sources are mapped automatically. A completed import exposes a one-click transaction rollback.

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

Plans expire after 24 hours and include fingerprints for every proposed file. Apply revalidates the pack checksum and destination state, then snapshots and atomically writes targets under one configuration lock set. Every import creates a transaction backup under `config-pack-backups/<transaction-id>/`; failed writes restore the complete original set automatically, while a failed rollback restores the pre-rollback state.
