# Release

[中文](RELEASE.md)

rDevTool currently distributes explicitly labeled preview artifacts. Pull requests and `main` first run code-quality, product-contract, and browser-workflow checks. Manual runs or `v*` tags then build the desktop packages.

## Build Targets

- macOS Apple Silicon: `aarch64-apple-darwin`
- macOS Intel: `x86_64-apple-darwin`
- Windows x64: `x86_64-pc-windows-msvc`

## Canonical Build

The repository root has one canonical release build entry point:

```bash
npm --prefix web ci
npm run check:full
npm run build
```

`npm run build` invokes `scripts/build-release.mjs`, after which Tauri builds the frontend and desktop packages. When the macOS build finishes, it compiles the `AppIcon.icon` resources, writes `Assets.car`, updates `Info.plist`, re-signs the app, and rebuilds the DMG. Running this step locally requires full Xcode, not only the Command Line Tools.

The release matrix invokes the same command and selects each target with `--target <triple>`. Do not invoke `tauri build` directly in the workflow, because that bypasses the macOS icon and artifact post-processing.

## CI and Release Evidence

`.github/workflows/ci.yml` runs:

- Manifest, version, documentation, security configuration, and IPC contract checks;
- frontend unit tests and the TypeScript/Vite build;
- Rust formatting, Core and Tauri tests, and compile checks;
- Playwright Chromium browser workflows.

`.github/workflows/release.yml` creates desktop packages, `release-artifacts.json`, and `SHA256SUMS` for every target, then uploads them as workflow artifacts. Pushing a version tag creates a draft GitHub Release containing artifacts for all targets.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Version Checklist

Keep these versions aligned before a release:

- `package.json`
- `web/package.json`
- `Cargo.toml`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`
- `CHANGELOG_EN.md`

Then run `npm run manifest:check`; a mismatch fails immediately. When a feature, CLI contract, document, or website description changes, also update the Manifest according to [docs/maintenance.md](docs/maintenance.md).

## Preview Signing Notice

The current macOS packages use ad-hoc signing only; they are not Developer ID signed or notarized. Windows packages are not Authenticode signed. Gatekeeper and SmartScreen may therefore display warnings.

Before enabling the stable release channel, the project still needs protected signing credentials, macOS notarization, Windows Authenticode signing, signed updater metadata, upgrade testing from the previous public version, and rollback drills. Missing credentials must make a stable release fail instead of silently producing an unsigned artifact under the same name.
