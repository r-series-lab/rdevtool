# Architecture And Evolution

rDevTool 使用 `modular-workbench` 架构：React 桌面界面和 native CLI 是两个 adapter，共享 Rust domain core、配置解析、操作模型与 SQLite 状态。它不是把 Web UI 包进桌面壳后再单独实现一套 CLI。

## Dependency Direction

```text
React UI -> Tauri commands -> Rust core -> config / storage / external tools
Native CLI ---------------> Rust core -> config / storage / external tools
Tray actions -------------> Rust core -> operation events
```

- `src/`：可复用 domain core 与 native CLI。核心逻辑不能依赖 React 或 WebView 状态。
- `src-tauri/`：窗口、托盘、文件监听和 Tauri transport。Command 负责解析参数、调用 core、序列化结果。
- `web/src/`：页面、组件、hooks 与前端派生状态。业务事实来自 typed response，不在 UI 复制 domain 规则。
- TOML：项目、工作区、配置源和工具定义的事实源。
- SQLite：历史、统一操作事件、本机运行状态，以及兼容保留的全局便笺。
- 应用数据目录 Markdown：知识库事实源，包含收件箱、项目级经验、跨项目 playbook 与共享环境约定；索引只返回有界摘要和路径，正文按需读取。

## Domain Map

| Domain | Core responsibility | Main adapters |
| --- | --- | --- |
| Workspace / Config Source | 当前范围、项目实例、资料与配置来源 | App, CLI |
| Projects / Git | 项目事实、分支观测与受控 mutation | App, CLI, Tray |
| Build / Deploy | adapter 计划、参数解析、触发与状态 | App, CLI, Tray |
| Runtime | target 解析、preflight、daemon 和日志 | App, CLI, Link |
| Proxy / Link | 本地代理生命周期和联调步骤组合 | App, CLI, Tray |
| Operations / History | App/CLI/Tray 统一事件、诊断和重试依据 | Activity Center, CLI |
| Web Actions | CDP 目标和已登记页面动作 | App, CLI |
| Artifacts | 受管产物 inventory 与只读 cleanup plan | App, CLI, Agent context |
| Knowledge | Markdown 知识索引、安全读取与模板新建 | App, CLI, Agent context |
| Health | 可执行文件身份与受管存储健康 | Settings, CLI, Agent context |

## Operation Lifecycle

有副作用的流程优先遵循同一生命周期：

1. `plan`：解析请求与有效配置，不产生副作用。
2. `check`：读取当前仓库、进程、端口、远端或页面状态。
3. `execute`：在确认后执行，并写统一 operation event。
4. `replay`：从规范化参数重新进入当前检查流程，不复用过期判断。

返回值逐步统一为 `requested`、`effective`、`observed`、`status`、`evidence`、`risks`、`managedArtifacts` 与 `recommendedActions`。Tauri 和 CLI 只改变 transport，不改变这些字段的语义。

## Contract Guards

- `r-app.manifest.json` 连接版本、文档、CLI、官网和质量命令。
- `manifest:check` 比较 package、Cargo、Tauri、文档和安全配置。
- `ipc:check` 比较 `#[tauri::command]`、`generate_handler!` 和前端 literal invoke。
- Core、Tauri、Vitest 与 Playwright 分层验证同一行为。
- SQLite 使用 `user_version` 做只向前迁移，并拒绝更高版本 schema。

## Staged Decomposition

当前功能集中区包括 CLI `src/main.rs`、Tauri `src-tauri/src/lib.rs`、全局样式和 Activity Center。后续按领域渐进拆分，不做一次性重写：

1. 先保持 command 名、Serde payload、JSON envelope 和测试不变。
2. 将 Tauri command 按 workspace、git、build、runtime、proxy/link、history、web-actions 提取到 `commands/` 子模块。
3. 将 CLI parser/handler 按相同 domain 提取到 `cli/`，执行仍调用现有 core。
4. 建立前端 typed IPC gateway，再逐页迁移 direct `invoke`；动态 selector 必须保留显式 command union。
5. 将 Activity Center 拆为查询、分组、详情、诊断和 retry action 组件，状态编排继续留在 hook/lib。
6. 将全局 CSS 按 token、shell、shared components 和 page modules 分层，保持现有 selector 与视觉回归。

每一步单独提交并运行 `npm run check:full`。如果拆分同时要求修改产品行为，先完成行为和测试，再做机械移动，避免审查时混合两种风险。

### Current Decomposition Status

- `web-actions`、`history` 与 runtime 只读 Tauri adapters 已提取到 `src-tauri/src/commands/`，共 25 个 IPC 名称与 payload 保持不变。
- `ipc:check` 已递归扫描 `src-tauri/src/**/*.rs`，并将模块化 handler 路径归一为公开 IPC 名称后再比较。
- 下一块优先提取 runtime lifecycle 的 `start`、`stop` 与 `adopt` mutations，保持 operation event、workspace worklog、托盘重放和代理准备顺序不变；build、focus、open 与 log clear 留到后续独立迁移。

## Adding A Feature

新增功能时先回答：属于哪个 domain、是否有副作用、是否需要 CLI/Agent、事实存在哪里、事件如何记录、失败能否安全重试。然后按 core、adapter、UI、docs、Manifest、CHANGELOG 的顺序更新，完整流程见 [maintenance.md](maintenance.md)。
