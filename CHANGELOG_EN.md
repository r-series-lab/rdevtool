# Changelog

[中文](CHANGELOG.md)

## Unreleased

### Added

- Product Manifest, a standalone validator, and R Series family consistency checks.
- Unified operation events for Git, builds, Runtime, Proxy, and Link, plus structured diagnostics and guarded retry entry points in the Activity Center.
- An IPC contract check covering 129 registered Tauri commands and literal frontend invokes.
- Pull request CI, cross-target preview releases, artifact manifests, and SHA-256 checksums.
- A SQLite `user_version` migration and upgrade tests for legacy workspace history.
- Documentation for the shared Core, domain boundaries, and incremental extraction roadmap.

### Changed

- macOS and Windows now use the canonical release build entry point at the repository root; macOS target post-processing supports a target triple.
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
