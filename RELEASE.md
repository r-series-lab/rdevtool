# Release

This repository uses a stage-one preview release workflow.

## Targets

- macOS Apple Silicon: `aarch64-apple-darwin`
- macOS Intel: `x86_64-apple-darwin`
- Windows x64: `x86_64-pc-windows-msvc`

## How to Build

Open GitHub Actions and run **Release preview desktop packages** manually. The workflow uploads the generated packages as workflow artifacts.

To create a draft GitHub Release, push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow creates a draft release and attaches the generated macOS and Windows packages.

## Unsigned Package Notice

These stage-one packages use macOS ad-hoc signing only and are not Developer ID signed or notarized. Windows packages are not Authenticode signed.

- macOS may show a Gatekeeper warning.
- Windows may show a SmartScreen warning.

Signing and notarization are intentionally left for a later release stage.
