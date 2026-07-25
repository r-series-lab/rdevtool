# 更新日志

[English](CHANGELOG_EN.md)

## 未发布

### 新增

- 产品 Manifest、独立校验器与 R 系列家族一致性检查。
- Git、构建、Runtime、Proxy 和 Link 的统一操作事件，以及活动中心的结构化诊断和受控重试入口。
- IPC 契约检查，覆盖 129 个已注册的 Tauri 命令与前端字面量 `invoke` 调用。
- Pull Request CI、跨目标预览发布、制品清单与 SHA-256 校验和。
- SQLite `user_version` 迁移与旧版工作区历史升级测试。
- 共享 Core、领域边界和渐进拆分路线文档。

### 变更

- macOS 和 Windows 统一使用仓库根发布构建入口；macOS 目标后处理支持目标三元组（target triple）。
- 最小桌面窗口调整为 `820 x 640`，并增加紧凑窗口浏览器回归测试。
- Agent 能力发现补齐 Link 与统一操作历史能力。
- 构建失败恢复会先切回并校验原工作区，构建执行与后续历史更新始终绑定该工作区，避免同名项目在其他工作区或 worktree 中被误重放。
- 文档与官网内容改由应用 Manifest 和应用仓库源文档驱动。
- README 与发布说明拆分为独立的中英文单一来源，并将英文发布文档纳入 Manifest 本地化索引和版本复核。
- 将中英文更新日志拆分为独立单一来源，在 Manifest 中登记英文文档，并将其纳入版本复核。

### 安全

- 启用 Tauri Content Security Policy 与 `freezePrototype`。
- 保持主窗口 capability 最小化，并明确本地历史、凭据和预览签名边界。

## 0.1.0

- 首个具备公开发布准备的快照。
- 支持项目配置、部署规划、分支工作流、资源入口和本地历史记录。
- 为 `project`、`deploy`、`merge`、`history`、`navigation` 和 Agent Context 工作流提供具有稳定 `--json` 输出的原生 CLI 命令。
