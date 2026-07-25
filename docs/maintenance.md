# Documentation And Website Maintenance

rDevTool 以应用仓库为功能与文档事实源。官网只消费机器可读产品信息和这里登记的 Markdown，不手工维护第二份产品正文。

## Source Map

- `r-app.manifest.json`：跨仓库产品契约，负责身份、产品边界、官网展示、文档索引、CLI 域、运行时与质量命令。
- `package.json` / Cargo / Tauri config：各自构建名称和版本的事实源。
- `README.md`：当前版本的中文产品、主要功能、快速开始与开发入口。
- `README_EN.md`：当前版本的英文产品、快速开始、CLI 与安全边界概览。
- `docs/cli.md`：真实 CLI grammar、JSON、退出行为和例子。
- `docs/ai-agent.md`：能力发现、上下文、证据和高风险动作顺序。
- `docs/config.md`：配置、SQLite schema 与数据边界。
- `docs/r-series-apps.md`：R 系列项目、构建目标、工作区与资源入口的接入范式。
- `docs/architecture.md`：共享 Core、adapter 依赖方向和渐进拆分路线。
- `docs/security.md`：权限、凭据、本地数据和分发边界。
- `RELEASE.md` / `RELEASE_EN.md`：中英文发布流程、构建目标、制品证据与签名状态。
- `CHANGELOG.md` / `CHANGELOG_EN.md`：中英文版本变化。

## Feature Update Sequence

1. 修改共享 Rust core 和测试。
2. 同步 Tauri/UI 与 CLI adapter。
3. 如果 command 新增、删除或改名，更新 `agent capabilities` 与 `docs/cli.md`。
4. 更新受影响的用户文档以及中英文 `CHANGELOG.md` / `CHANGELOG_EN.md`。
5. 如果公开能力、工作流或边界变化，更新 Manifest 的 `website`、`documentation` 或 `cli`。
6. 复核 `localization.translations.en`、`README_EN.md`、`RELEASE_EN.md` 与 `CHANGELOG_EN.md`；确认一致后更新对应英文文档的 `reviewedForVersion`。
7. 运行应用检查和 R 系列家族检查。
8. 构建官网，确认中英文产品页和文档路由来自最新 Manifest。

```bash
npm run manifest:check
npm run ipc:check
npm run check:full
cd ../r-series-apps && npm run family:check
```

Manifest 校验会比较 root/web/Cargo/Tauri 版本、标识、文档路径、安全配置和必需脚本。IPC 检查会比较 `#[tauri::command]`、`generate_handler!` 与前端 literal invoke；动态 command selector 会单独进入报告。

## Website And Screenshots

官网构建扫描同级应用的 `r-app.manifest.json`，只发布 `website.publish=true` 的应用，并按语言复制默认 `documentation[].source` 与 `localization.translations.<locale>.documentation[].source`。产品卡片、能力、流程、边界、平台和格式来自同一 Manifest。

截图尚未稳定时保持 `website.screenshots: []`。补图后把原始文件放入应用仓库，登记 `id`、`alt`、`caption` 和 `source`，再由官网构建复制；不要把临时截图直接放在官网仓库形成孤立资产。

## Release Update

发版时同步五处版本：root/web package、Core/Tauri Cargo、Tauri config，并在 `CHANGELOG.md` 与 `CHANGELOG_EN.md` 建立对应版本节。英文 overview、release 与 changelog 文档的 `reviewedForVersion` 会在版本变化后触发系列检查警告；只有复核正文后才同步新版本。运行 `npm run manifest:check` 后再打 tag。预览或正式渠道、签名状态、迁移风险变化时，同步更新 `RELEASE.md`、`RELEASE_EN.md`、`docs/security.md` 和中英文 Manifest `releaseSummary`。
