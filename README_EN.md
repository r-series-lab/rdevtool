# rDevTool

English | [中文](README.md)

[Official website](https://rdt.rurie.top) · [Documentation](https://rdt.rurie.top/en/docs) · [Preview downloads](https://github.com/r-series-lab/rdevtool/releases) · [Issue tracker](https://github.com/r-series-lab/rdevtool/issues)

> The `0.1.x` line is a Public Preview. Packages are not yet notarized with an Apple Developer ID or signed with Windows Authenticode. Read the [release notes](RELEASE_EN.md) and verify the SHA-256 manifest attached to the Release before installing.

`rDevTool` is a local desktop workbench for day-to-day multi-project development. It brings workspaces, resource shortcuts, Git branch workflows, build tasks, local proxy rules, runtime debugging, activity history, and AI-readable context into one Tauri app.

It is not a replacement for GitLab, Jenkins, or a CI/CD platform. It is a local control surface for the questions developers answer constantly: which requirement context am I in, which project should I open, which branch should I inspect or switch, and where should this build run?

Stack: `Tauri 2 + Rust + React + Vite + TypeScript + Material UI`.

## Product Areas

- **Workbench** groups projects, shortcuts, proxy profiles, Links, build and Git actions, and recent activity by workspace.
- **Resource Finder** manages projects, websites, directories, apps, scripts, and parameterized Actions with search, favorites, recents, workspace filtering, and UI-based CRUD for workspace-owned resources.
- **Parameterized Actions** generate a generic dialog from `actions.toml`, with fully visible multi-select values, fixed context, plan/apply, live logs, cancellation, background execution, failed-item retry, and operation history.
- **CLI Bridge** bundles a version-matched `rdevtool` sidecar and exposes it to Action scripts through `RDEVTOOL_CLI`.
- **Configuration Transfer** exports projects, workspaces, and resource sources as `.rdtpack` archives, then imports through filterable per-operation planning, path mapping, state validation, transaction backup, durable history, and guarded rollback.
- **Configuration Sources** select resource, Link, proxy, and runtime sources independently per workspace, with comparison and external-change detection.
- **Link Chains** compose local-file checks, proxy lifecycle, runtime lifecycle, and page focus into previewable and runnable workflows.
- **Git Workflow** covers branch listing, multi-target sync, branch creation, checkout, merge preview, merge, push status, and push. Batch records use one row per project and keep 403 or merge-conflict evidence actionable.
- **Build Tasks** create executable plans for Jenkins, local commands, and R Series packaging. Build Record prioritizes parameter overrides, defaults, failure evidence, and repeated-run timelines.
- **Local Proxy** manages forwarding, mocks, blocking rules, diagnostics, import/export, and runtime binding.
- **Project Runtime** inspects, preflights, starts, waits for, stops, restarts, and diagnoses supervised local processes.
- **Activity Center** records Action, build, Git, runtime, proxy, Link, and external-configuration activity with guarded replay.
- **AI / CLI** exposes deterministic JSON for important read and action surfaces so agents do not need GUI automation.

## Interface Preview

The Workspace image shows the current dark interface; operation images are generated from repository-owned mock data at the app's default window ratio. Public images contain no credentials. See the [Interface Guide](docs/interface-guide_EN.md) for the behavior behind each surface.

<p align="center">
  <img src="docs/assets/screenshots/workspace-overview.png" alt="The R Series Workspace home in dark mode" width="99%">
</p>

<p align="center">
  <img src="docs/assets/screenshots/action-batch-deploy-pre.png" alt="Generic Batch Deploy Pre Action dialog" width="49%">
  <img src="docs/assets/screenshots/build-record-details.png" alt="Project Management Build controls and Build Record" width="49%">
</p>
<p align="center">
  <img src="docs/assets/screenshots/branch-record-summary.png" alt="Project Management Git controls and Branch Record" width="99%">
</p>

## Quick Start

```bash
npm run web:install
npm run dev
```

Useful checks:

```bash
npm run manifest:check
npm run ipc:check
npm run check
npm run check:full
cargo run --quiet -- --json doctor
```

Package the desktop app:

```bash
npm run build
```

macOS packaging compiles Icon Composer assets and rebuilds the DMG after Tauri finishes, so a local package build requires full Xcode. The release workflow invokes the same root build command.

## CLI Quick Start

From a source checkout:

```bash
cargo run --quiet -- --json info
cargo run --quiet -- --json doctor
cargo run --quiet -- --json agent context --limit 6
```

After installing or putting `rdevtool` on `PATH`:

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent capabilities
rdevtool --json agent context --limit 6
rdevtool --json workspace list
rdevtool --json projects list
rdevtool --json navigation search Jenkins
rdevtool --json config-source list
rdevtool --workspace <key> --json action validate
rdevtool --workspace <key> --json action plan <action-key> --set projects='["demo"]'
rdevtool --workspace <key> --json action apply --plan-id <plan-id> --yes
rdevtool --json link list
rdevtool --json proxy list
rdevtool --json runtime list --running-only
rdevtool --json history operations --domain action --limit 24
rdevtool --workspace <key> --json workflow chain list
```

Preview consequential operations before running them:

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json git overview --project <project> --source <source> --target <target>
rdevtool --json git push-status --project <project>
rdevtool --workspace <key> --json action plan <action-key> --params-file ./params.json
```

The complete CLI reference currently lives in [docs/cli.md](docs/cli.md). Stable command names and JSON keys remain English even when reader-facing documentation is localized.

## Configuration and Local Data

rDevTool creates local configuration on first run:

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`
- Local history database: `~/.rdevtool/rdevtool.sqlite`

SQLite uses forward-only `PRAGMA user_version` migrations and rejects a database schema newer than the running app supports.

Main files:

| File | Purpose |
| --- | --- |
| `projects.toml` | Repositories, build adapters, development commands, debug profiles, targets, and branch rules |
| `workspace.toml` | App preferences, enabled pages, default page, and active workspace |
| `workspaces/*.toml` | Scoped workspaces containing project, resource, and proxy references |
| `config_sources.toml` | Custom configuration sources and capability mappings |
| `navigation.toml` | Websites, directories, apps, and scripts |
| `actions.toml` | Parameterized Action schemas and controlled process execution |
| `links.toml` | Reusable local-debug chains |
| `proxy.toml` | Local proxy profiles, rules, and workspace ownership |
| `runtime_overrides.toml` | Runtime overrides supplied by a configuration source |
| `web_actions.toml` | Chrome DevTools Protocol web actions |

## Safety Boundary

- Repository templates contain only sample paths, sample URLs, and placeholder configuration.
- Jenkins, GitLab, proxy, and authentication values come from environment variables or private local configuration.
- Workspaces store scoped references; they do not copy source repositories, private templates, or business content.
- JSON mode never mixes human prose into the machine envelope.
- Merge, push, build, deploy, and configuration writes expose a plan or status check first.
- The Tauri webview uses a Content Security Policy and frozen prototypes with narrowly scoped permissions.
- SQLite is not application-encrypted. Activity can contain paths, branches, URLs, and non-secret parameters, so secrets must never be passed as one-off command arguments.

## Documentation

- [docs/cli.md](docs/cli.md): command grammar, JSON contracts, and examples.
- [docs/interface-guide_EN.md](docs/interface-guide_EN.md): workspace, generic Action, Build Record, and Branch Record interface behavior.
- [docs/config.md](docs/config.md): local configuration and the workspace model.
- [docs/configuration-packs_EN.md](docs/configuration-packs_EN.md): safe project, workspace, and resource configuration transfer and rollback.
- [docs/resource-actions.md](docs/resource-actions.md): parameterized Actions, script input protocol, and safety boundaries.
- [docs/r-series-apps.md](docs/r-series-apps.md): R Series project registration, build targets, workspaces, and resource entry patterns.
- [docs/ai-agent.md](docs/ai-agent.md): agent workflow and safety rules.
- [docs/architecture.md](docs/architecture.md): shared core, domain boundaries, and staged decomposition.
- [docs/security.md](docs/security.md): trust boundaries, credentials, local data, and release security.
- [docs/maintenance.md](docs/maintenance.md): keeping features, the product manifest, docs, and website aligned.
- [RELEASE_EN.md](RELEASE_EN.md): CI, desktop artifacts, signing status, and release steps.
- [CHANGELOG_EN.md](CHANGELOG_EN.md): versioned product and documentation changes.

Detailed reference documents are currently Chinese-first. This overview is the maintained English entry point for the current app version.

## Development Commands

```bash
npm run dev
npm run web:install
npm run web:dev
npm run web:build
npm run web:test
npm run web:test:e2e
npm run docs:screenshots
npm run rust-check
npm run rust-test
npm run manifest:check
npm run ipc:check
npm run check
npm run check:full
npm run build
npm run size
npm run clean
npm run clean:all
```
