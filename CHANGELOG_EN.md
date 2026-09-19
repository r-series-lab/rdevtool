# Changelog

[中文](CHANGELOG.md)

## Unreleased

- No unreleased changes.

## 0.1.6

Configuration-chain clarity and release stability improvements.

### Added and improved

- Project launch profiles and shared runtime environments now show effective configuration previews, bindings, and missing-configuration notices so the selected profile's actual runtime behavior is easier to understand.
- Runtime configuration panels now show profile usage counts, project binding state, and the source of launch parameters.

### Fixed

- Relaxed the transient startup wait in the external-process runtime test so a slow cold start on GitHub-hosted runners does not produce a false release-gate failure.

## 0.1.5

The first user-facing Public Preview. It aligns the application, source Tag, and package version while completing configuration transfer, open-source governance, and release safety gates.

### Added

- A `.rdtpack` configuration transfer center covering projects, builds, deployments, Git, workspaces, and resource sources, with secret removal, portable path placeholders, conflict planning, destination-state validation, transaction backup, full rollback, and matching CLI commands.
- A schema-driven parameterized Action dialog with fixed context, fully visible project selection, plan/apply confirmation, live logs, cancellation, background execution, failed-item retry, and unified operation history.
- Build Record parameter-difference previews, complete effective/default details, secret masking, failure diagnostics, and repeated-run timelines.
- Branch Record per-project rows, expandable long branches, a stable three-card viewport, and structured GitLab 403 or merge-conflict explanations.
- Lockfile-aware local dependency linking for requirement workspaces and blocking Runtime preflight when a Node launch entry is missing.
- Chinese and English interface guides plus a reproducible public-screenshot generator backed by real components and mock IPC.
- Product Manifest, a standalone validator, and R Series family consistency checks.
- Unified operation events for Git, builds, Runtime, Proxy, and Link, plus structured diagnostics and guarded retry entry points in the Activity Center.
- An IPC contract check covering 167 Rust commands, 134 frontend commands, and 212 `invoke` call sites.
- Pull request CI, cross-target preview releases, artifact manifests, and SHA-256 checksums.
- A SQLite `user_version` migration and upgrade tests for legacy workspace history.
- Documentation for the shared Core, domain boundaries, and incremental extraction roadmap.

### Changed

- Generic Action controls localize in Chinese and English while Action names, descriptions, parameters, and resource notes preserve configured copy; multi-value parameters now use searchable, removable-tag dropdowns, the direct-execution migration notice is removed, and context, parameter, and execution-detail sections are denser.
- Build and Branch record cards use tighter content spacing, consistent pinned surfaces, and a More menu for secondary commands.
- GitLab and Jenkins failures retain HTTP status, permission scope, and recommended checks instead of collapsing into a generic failure.
- macOS and Windows now use the canonical release build entry point at the repository root; macOS target post-processing supports a target triple.
- Target-specific release manifests and SHA-256 files now use unique platform-qualified names to prevent collisions when multi-platform assets are merged.
- The minimum desktop window is now `820 x 640`, with a compact-window browser regression test.
- Agent capability discovery now includes Link and unified operation-history capabilities.
- Build failure recovery now returns to and verifies the original workspace first. Build execution and later history updates remain bound to that workspace, preventing accidental replay against a same-named project in another workspace or worktree.
- Documentation and website content are now driven by the app Manifest and source documents in the app repository.
- The README and release documentation now use separate single sources of truth for Chinese and English; the English release document is indexed in the Manifest and included in version review.
- The Chinese and English changelogs now use separate sources of truth; the English document is registered in the Manifest and included in version review.

### Security

- Enables the Tauri Content Security Policy and `freezePrototype`.
- Keeps the main-window capability minimal and documents the boundaries for local history, credentials, and preview signing.

## 0.1.0

- Initial public-ready snapshot.
- Supports project configuration, deployment planning, branch workflows, navigation entries, and local history.
- Includes native CLI commands with stable `--json` output for project, deploy, merge, history, navigation, and agent context workflows.
