# 发布

[English](RELEASE_EN.md)

rDevTool 当前发布渠道是明确标记的预览制品。Pull Request 和 `main` 先运行代码质量、产品契约与浏览器流程；手动触发或 `v*` tag 再构建桌面包。

## 构建目标

- macOS Apple Silicon: `aarch64-apple-darwin`
- macOS Intel: `x86_64-apple-darwin`
- Windows x64: `x86_64-pc-windows-msvc`

## 统一构建入口

仓库根目录只有一个正式构建入口：

```bash
npm --prefix web ci
npm run check:full
npm run build
```

`npm run build` 调用 `scripts/build-release.mjs`，再由 Tauri 构建前端与桌面包。macOS 构建完成后会编译 `AppIcon.icon`、写入 `Assets.car`、更新 `Info.plist`、重新签名并重建 DMG；本机执行这一步需要完整 Xcode，不只是 Command Line Tools。

发布矩阵也调用同一个命令，并用 `--target <triple>` 选择目标。不要在工作流里直接调用 `tauri build`，否则会绕过 macOS 图标与制品后处理。

## CI 与发布证据

`.github/workflows/ci.yml` 运行：

- Manifest、版本、文档、安全配置与 IPC 契约检查
- 前端单元测试、TypeScript/Vite 构建
- Rust 格式、Core/Tauri 测试与检查
- Playwright Chromium 浏览器流程

`.github/workflows/release.yml` 为每个目标生成桌面包、带目标名的发布清单与 SHA-256 校验文件，并上传为 workflow artifacts。推送版本 tag 会创建带全部目标制品的 draft prerelease。

```bash
git tag v0.1.6
git push origin v0.1.6
```

## 版本检查清单

发布前保持以下版本一致：

- `package.json`
- `web/package.json`
- `Cargo.toml`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`
- `CHANGELOG_EN.md`

随后运行 `npm run manifest:check`；不一致会直接失败。功能、CLI、文档或官网描述变化时，还要按 [docs/maintenance.md](docs/maintenance.md) 更新 Manifest。

## 预览签名说明

当前 macOS 包只做 ad-hoc signing，没有 Developer ID 签名和 notarization；Windows 包没有 Authenticode 签名。Gatekeeper 和 SmartScreen 可能显示警告。

正式稳定渠道启用前还需要：受保护的签名凭据、macOS notarization、Windows Authenticode、签名 updater metadata、上一公开版本升级测试和回滚演练。凭据缺失时应让正式发布失败，不能静默降级为同名未签名制品。
