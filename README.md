# rDevTool

<p align="center">
  <a href="#中文">中文</a> · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://rdt.rurie.top">官方网站</a> ·
  <a href="https://rdt.rurie.top/zh/docs">使用文档</a> ·
  <a href="https://github.com/r-series-lab/rdevtool/releases">预览版下载</a> ·
  <a href="https://github.com/r-series-lab/rdevtool/issues">问题反馈</a>
</p>

---

## 中文

> 当前 `0.1.x` 为 Public Preview。安装包尚未完成 macOS Developer ID 公证与 Windows Authenticode 签名，安装前请阅读 [发布说明](RELEASE.md) 并核对 Release 中的 SHA-256 清单。

`rDevTool` 是一个本地开发工作台，把多项目日常里的工作区、资源入口、Git 分支、构建任务、本地代理、运行时调试、活动记录和 AI 上下文收在一起。它不是 GitLab、Jenkins 或 CI/CD 平台的替代品，而是一个面向个人和小团队工作流的桌面入口：让「当前在哪个需求上下文、该打开哪个项目、查哪个入口、切哪个分支、构建或部署到哪里」这些动作可见、可复用、可被 CLI 和 AI 稳定调用。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`。

### 界面与功能

- **工作台**：按工作区聚合项目、入口、代理、Link、构建、Git 和最近活动；支持 `system` 全局视图和普通需求工作区，并对外部配置变化执行增量刷新。
- **资源入口**：统一管理项目、网站、目录、应用、脚本和参数化 Action，支持搜索、收藏、最近使用、工作区过滤，以及工作区专属资源的界面增改删。
- **参数化 Action**：由 `actions.toml` Schema 生成通用弹窗，支持完整可见的项目多选、固定上下文、plan/apply、实时日志、取消、后台运行、失败项重试和统一操作历史。
- **CLI 桥接**：App 打包同版本 `rdevtool` sidecar，Action 脚本通过 `RDEVTOOL_CLI` 复用现有构建、Jenkins 与工作区能力。
- **配置源**：资源、Link、代理和运行配置可以按工作区分别选择来源；支持来源比较、独立复制、能力范围控制和外部文件变更提醒。
- **配置迁移**：按项目、工作区和配置源导出 `.rdtpack`；导入前生成可筛选、可逐项选择的路径与冲突计划，执行时校验包和目标状态、建立整批备份，并通过迁移历史安全回滚。
- **Link 联调链**：把本地文件检查、代理启动/检查、Runtime 启停和页面聚焦组合成可预览、检查、执行、停止并挂载到工作区的快捷链路。
- **Git 工作流**：查看分支、同步多目标分支、创建分支、切换分支、检出到目录、合并预览、合并、推送前检查和推送；批量记录按项目分行，并明确显示 403、合并冲突等错误及处理建议。
- **构建任务**：从项目配置生成构建计划，支持 Jenkins、本地命令和 R 系列桌面应用打包 adapter；Build Record 优先显示参数差异、默认值、失败原因和连续运行时间线。
- **本地代理**：维护代理 profile、规则、Mock、转发、阻断和导入导出，可绑定到运行时 profile。
- **项目运行时**：检查、预检、启动、查看、停止、重启和诊断由 App 与 CLI 共享 daemon 托管的项目运行时；项目详情和 Link 计划/检查会直接展示有效运行目标与当前 daemon 观测，支持状态恢复、外部进程检测、受限认领评估、进程归属校验、聚焦页面与读取运行日志。
- **托管产物**：按工作区和项目盘点 rDevTool 明确拥有的工作区实例、Runtime 状态与日志，并把仅被配置引用的路径单独列出；可生成带活动状态、Git 工作树和目录边界检查的只读清理计划。
- **知识库**：按收件箱、项目、通用手册和环境约定检索 Markdown 长期知识；支持正文预览、范围筛选、模板新建和外部编辑，Markdown 文件始终是事实源。
- **系统诊断**：在设置中只读查看当前可执行文件/源码身份、受管存储占用与健康风险。
- **活动中心**：集中显示 Action、构建、Git、Runtime、代理、Link 和外部配置变更；连续执行按最新一次结果呈现外层状态，同时保留每次明细、结构化诊断和“检查并重试”入口。
- **系统托盘**：以工作区作为一级菜单，按入口、项目、代理、Link、构建和 Git 组织二级/三级快捷动作；支持打开工作区、固定动作和重复上次操作。
- **命令面板**：使用 `Cmd/Ctrl + K` 快速搜索项目、入口和常用动作。
- **工作流信号**：把分支、构建、运行时等动作串起来，用规则接收或广播可重放的工作流。
- **AI / CLI**：关键读取和动作命令都提供稳定 JSON 输出，AI Agent 应优先走 CLI 而不是 GUI 自动化。

### 界面预览

Workspace 图展示当前暗色界面；操作图使用仓库内置 mock 数据按应用默认窗口比例生成。所有公开图片均不包含凭据。完整交互说明见 [界面功能指南](docs/interface-guide.md)。

<p align="center">
  <img src="docs/assets/screenshots/workspace-overview.png" alt="暗色模式下的 R系列 Workspace 首页" width="99%">
</p>

<p align="center">
  <img src="docs/assets/screenshots/action-batch-deploy-pre.png" alt="批量部署 Pre 通用 Action 弹窗" width="49%">
  <img src="docs/assets/screenshots/build-record-details.png" alt="项目管理构建参数区与 Build Record" width="49%">
</p>
<p align="center">
  <img src="docs/assets/screenshots/branch-record-summary.png" alt="项目管理 Git 操作区与 Branch Record" width="99%">
</p>

### 快速开始

```bash
npm run web:install
npm run dev
```

常用检查：

```bash
npm run manifest:check
npm run ipc:check
npm run check
npm run check:full
cargo run --quiet -- --json doctor
```

打包桌面应用：

```bash
npm run build
```

macOS 打包会在 Tauri 构建后编译 Icon Composer 资源并重建 DMG，本机需要完整 Xcode；GitHub 发布工作流使用相同根构建命令。

清理：

```bash
npm run clean
npm run clean:all
```

### CLI 快速入口

开发态可在仓库内运行：

```bash
cargo run --quiet -- --json info
cargo run --quiet -- --json agent context --for workspace --compact
```

安装或放入 `PATH` 后：

```bash
rdevtool --json info
rdevtool --json agent capabilities
rdevtool --json agent context --project <project> --for runtime --compact --debug-profile <profile>
rdevtool --json workspace list
rdevtool --json workspace init-demand --name "需求" --project <project> --branch <branch> --requirement-dir /path/to/requirement --root-dir /path/to/workspace --copy-mode worktree --dry-run
rdevtool --json projects list
rdevtool --json navigation search Jenkins
rdevtool --json config-source list
rdevtool --json config-source compare default default
rdevtool --workspace <key> --json action validate
rdevtool --workspace <key> --json action plan <action-key> --set projects='["demo"]'
rdevtool --workspace <key> --json action apply --plan-id <plan-id> --yes
rdevtool --json link list
rdevtool --json link plan <link-key>
rdevtool --json proxy list
rdevtool --json runtime status --project <project>
rdevtool --json runtime inspect --project <project> --debug-profile <profile>
rdevtool --json runtime list --running-only
rdevtool --json runtime log --project <project> --current
rdevtool --json runtime log --project <project> --tail 300 --errors-only
rdevtool --json runtime wait --project <project> --run-id <run-id> --until http-verified
rdevtool --workspace <key> --json doctor --project <project> --debug-profile <profile>
rdevtool --workspace <key> --json notes file-search "代理" --project <project>
rdevtool --json history operations --domain action --limit 24
rdevtool --json history replay-plan <action-id>
rdevtool --workspace <key> --json workflow chain list
```

`workspace init-demand` 在 `worktree` / `clone` 模式下默认使用
`--dependency-mode auto-link`：仅当源目录已有 `node_modules` 且源、目标锁文件内容一致时
创建本地依赖链接；否则保留工作区并返回明确告警。需要完全隔离安装时可传
`--dependency-mode none`。Runtime 启动预检会阻止缺少本地 Node 启动入口的命令继续执行。

高风险动作先预览再执行：

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json git overview --project <project> --source <source> --target <target>
rdevtool --json git push-status --project <project>
rdevtool --workspace <key> --json action plan <action-key> --params-file ./params.json
```

完整命令见 [docs/cli.md](docs/cli.md)。

### 配置与数据

rDevTool 首次运行会在本机配置目录生成默认配置：

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`
- 本地历史数据库：`~/.rdevtool/rdevtool.sqlite`

SQLite 使用 `PRAGMA user_version` 执行只向前迁移；新版本不会尝试打开比自身更新的数据库结构。

主要配置文件：

| 文件 | 用途 |
| --- | --- |
| `projects.toml` | 项目、仓库、构建 adapter、Jenkins、dev/build、debug profile、分支规则 |
| `workspace.toml` | UI 偏好、启用页面、默认页面、当前激活工作区 |
| `workspaces/*.toml` | 需求工作区，只保存项目、入口、代理等引用范围 |
| `config_sources.toml` | 自建配置源及资源、链路、代理、运行配置文件映射 |
| `sources/workspaces/<key>/` | 工作区自动生成的独立配置目录 |
| `navigation.toml` | 网站、目录、应用、脚本入口 |
| `actions.toml` | 参数化 Action、通用参数 Schema 与受控进程执行配置 |
| `links.toml` | 可组合的本地联调链路及执行步骤 |
| `proxy.toml` | 本地代理 profile、规则和工作区归属 |
| `runtime_overrides.toml` | 配置源提供的 Runtime profile 覆盖 |
| `web_actions.toml` | Chrome DevTools Protocol 网页动作 |
| `notes/` | 收件箱、项目经验、通用手册与环境约定的 Markdown 长期知识 |

详细配置见 [docs/config.md](docs/config.md)。

### 项目模型

- **Workspace**：需求或项目上下文。`system` 是全局视图，普通工作区只引用相关项目、入口和代理。
- **Project**：仓库路径、Git URL、dev/build 命令、focus 行为、debug profile、构建 target 和分支规则。
- **Build Target**：支持 `jenkins`、`local_command`、`r_series_package` 三类 adapter。
- **Runtime Profile**：浏览器、代理、环境变量和本地联调能力的组合。
- **Navigation Entry**：URL、目录、应用或脚本入口。
- **Proxy Profile**：本地转发、Mock、阻断和诊断规则集合。
- **Config Source**：为资源、Link、代理和 Runtime 能力提供可切换、可比较和可复制的文件来源。
- **Resource Action**：由参数 Schema、受控 Runner、effect 和执行模式组成的可复用动作；远程写入优先使用 plan/apply。
- **Link**：由本地文件、代理、Runtime 和页面动作组成的可复用联调链路。

### AI 使用

建议把 rDevTool skill 安装在本机 Codex skills 目录，例如：

```text
~/.codex/skills/rdevtool
```

AI 处理 rDevTool 任务时应先读取当前上下文：

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent context --limit 6
```

然后按工作区和命令预览结果行动。详细流程见 [docs/ai-agent.md](docs/ai-agent.md)。

### 文档

- [docs/cli.md](docs/cli.md)：CLI 命令、JSON 契约和示例。
- [docs/interface-guide.md](docs/interface-guide.md)：工作区、通用 Action、Build Record 与 Branch Record 界面说明。
- [docs/config.md](docs/config.md)：本地配置文件和工作区模型。
- [docs/configuration-packs.md](docs/configuration-packs.md)：项目、工作区与资源配置的安全导入、导出和回滚。
- [docs/resource-actions.md](docs/resource-actions.md)：参数化 Action、脚本输入协议与安全边界。
- [docs/r-series-apps.md](docs/r-series-apps.md)：R 系列应用开发配置范式。
- [docs/ai-agent.md](docs/ai-agent.md)：AI Agent 使用方式和安全规则。
- [docs/architecture.md](docs/architecture.md)：共享 Core、领域边界与渐进拆分路线。
- [docs/security.md](docs/security.md)：信任边界、CSP、凭据、本地数据与发布安全。
- [docs/maintenance.md](docs/maintenance.md)：功能、Manifest、文档和官网的同步维护流程。
- [RELEASE.md](RELEASE.md)：CI、桌面制品、签名状态和发布步骤。
- [CHANGELOG.md](CHANGELOG.md)：按版本记录的功能与文档变化。

### 隐私与安全

- 仓库模板只应该包含示例路径、示例 URL 和占位配置。
- Jenkins、GitLab、代理和认证信息应通过环境变量或本机配置提供，不要提交真实 token、密码或 cookie。
- 工作区只保存引用范围，不复制项目配置、私有模板或业务内容。
- CLI 的 `--json` 输出保持机器友好，不混入解释性文字。
- 合并、推送、构建、部署等动作建议先运行 `plan` / `overview` / `push-status`。
- Tauri WebView 启用 CSP 和冻结原型，主窗口只授予窗口拖动与确认对话框所需权限。
- SQLite 未做应用层加密；活动和构建历史可能包含路径、分支、URL 与非敏感参数，不要把 token、密码或 cookie 作为一次性命令参数传入。

### 开发命令

```bash
npm run dev                # Tauri 桌面开发
npm run web:install        # 安装前端依赖
npm run web:dev            # 仅启动前端
npm run web:build          # 前端构建
npm run web:test           # 前端单元测试
npm run web:test:e2e       # 浏览器流程测试
npm run docs:screenshots   # 用 mock smoke 场景更新公开界面截图
npm run rust-check         # Rust/Tauri 检查
npm run rust-test          # Core 与 Tauri 测试
npm run manifest:check     # 产品、版本、文档与安全契约
npm run ipc:check          # UI invoke 与 Rust command 契约
npm run check              # 快速完整检查
npm run check:full         # 再包含浏览器流程
npm run build              # 打包桌面应用
npm run size               # 查看构建缓存和产物体积
npm run clean              # 清理常规构建产物
npm run clean:all          # 连依赖一起清理
```
