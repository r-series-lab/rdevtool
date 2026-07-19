# rDevTool

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

`rDevTool` 是一个本地开发工作台，把多项目日常里的工作区、资源入口、Git 分支、构建任务、本地代理、运行时调试、活动记录和 AI 上下文收在一起。它不是 GitLab、Jenkins 或 CI/CD 平台的替代品，而是一个面向个人和小团队工作流的桌面入口：让「当前在哪个需求上下文、该打开哪个项目、查哪个入口、切哪个分支、构建或部署到哪里」这些动作可见、可复用、可被 CLI 和 AI 稳定调用。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`。

### 界面与功能

- **工作台**：按工作区聚合项目、入口、代理、Link、构建、Git 和最近活动；支持 `system` 全局视图和普通需求工作区，并对外部配置变化执行增量刷新。
- **资源入口**：统一管理项目、网站、目录、应用和脚本入口，支持搜索、收藏、最近使用和工作区过滤。
- **配置源**：资源、Link、代理和运行配置可以按工作区分别选择来源；支持来源比较、独立复制、能力范围控制和外部文件变更提醒。
- **Link 联调链**：把本地文件检查、代理启动/检查、Runtime 启停和页面聚焦组合成可预览、检查、执行、停止并挂载到工作区的快捷链路。
- **Git 工作流**：查看分支、同步多目标分支、创建分支、切换分支、检出到目录、合并预览、合并、推送前检查和推送。
- **构建任务**：从项目配置生成构建计划，支持 Jenkins、本地命令和 R 系列桌面应用打包 adapter，并保留构建历史与重放入口。
- **本地代理**：维护代理 profile、规则、Mock、转发、阻断和导入导出，可绑定到运行时 profile。
- **项目运行时**：检查、预检、启动、查看、停止、重启和诊断由 App 与 CLI 共享 daemon 托管的项目运行时，支持状态恢复、外部进程检测、受限认领评估、进程归属校验、聚焦页面与读取运行日志。
- **活动中心**：集中显示构建、Git、运行时和外部配置变更；连续执行按最新一次结果呈现外层状态，同时保留每次明细、页面记录和安全重放入口。
- **系统托盘**：以工作区作为一级菜单，按入口、项目、代理、Link、构建和 Git 组织二级/三级快捷动作；支持打开工作区、固定动作和重复上次操作。
- **命令面板**：使用 `Cmd/Ctrl + K` 快速搜索项目、入口和常用动作。
- **工作流信号**：把分支、构建、运行时等动作串起来，用规则接收或广播可重放的工作流。
- **AI / CLI**：关键读取和动作命令都提供稳定 JSON 输出，AI Agent 应优先走 CLI 而不是 GUI 自动化。

### 快速开始

```bash
npm run web:install
npm run dev
```

常用检查：

```bash
npm run rust-check
npm run web:build
cargo run --quiet -- --json doctor
```

打包桌面应用：

```bash
npm run build
```

清理：

```bash
npm run clean
npm run clean:all
```

### CLI 快速入口

开发态可在仓库内运行：

```bash
cargo run --quiet -- --json info
cargo run --quiet -- --json doctor
cargo run --quiet -- --json agent context --limit 6
```

安装或放入 `PATH` 后：

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent capabilities
rdevtool --json agent context --limit 6
rdevtool --json workspace list
rdevtool --json projects list
rdevtool --json navigation search Jenkins
rdevtool --json config-source list
rdevtool --json config-source compare default default
rdevtool --json link list
rdevtool --json link plan <link-key>
rdevtool --json proxy list
rdevtool --json runtime status --project <project>
rdevtool --json runtime list --running-only
rdevtool --json history replay-plan <action-id>
```

高风险动作先预览再执行：

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json git overview --project <project> --source <source> --target <target>
rdevtool --json git push-status --project <project>
```

完整命令见 [docs/cli.md](docs/cli.md)。

### 配置与数据

rDevTool 首次运行会在本机配置目录生成默认配置：

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`
- 本地历史数据库：`~/.rdevtool/rdevtool.sqlite`

主要配置文件：

| 文件 | 用途 |
| --- | --- |
| `projects.toml` | 项目、仓库、构建 adapter、Jenkins、dev/build、debug profile、分支规则 |
| `workspace.toml` | UI 偏好、启用页面、默认页面、当前激活工作区 |
| `workspaces/*.toml` | 需求工作区，只保存项目、入口、代理等引用范围 |
| `config_sources.toml` | 自建配置源及资源、链路、代理、运行配置文件映射 |
| `sources/workspaces/<key>/` | 工作区自动生成的独立配置目录 |
| `navigation.toml` | 网站、目录、应用、脚本入口 |
| `links.toml` | 可组合的本地联调链路及执行步骤 |
| `proxy.toml` | 本地代理 profile、规则和工作区归属 |
| `runtime_overrides.toml` | 配置源提供的 Runtime profile 覆盖 |
| `web_actions.toml` | Chrome DevTools Protocol 网页动作 |

详细配置见 [docs/config.md](docs/config.md)。

### 项目模型

- **Workspace**：需求或项目上下文。`system` 是全局视图，普通工作区只引用相关项目、入口和代理。
- **Project**：仓库路径、Git URL、dev/build 命令、focus 行为、debug profile、构建 target 和分支规则。
- **Build Target**：支持 `jenkins`、`local_command`、`r_series_package` 三类 adapter。
- **Runtime Profile**：浏览器、代理、环境变量和本地联调能力的组合。
- **Navigation Entry**：URL、目录、应用或脚本入口。
- **Proxy Profile**：本地转发、Mock、阻断和诊断规则集合。
- **Config Source**：为资源、Link、代理和 Runtime 能力提供可切换、可比较和可复制的文件来源。
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
- [docs/config.md](docs/config.md)：本地配置文件和工作区模型。
- [docs/r-series-apps.md](docs/r-series-apps.md)：R 系列应用开发配置范式。
- [docs/ai-agent.md](docs/ai-agent.md)：AI Agent 使用方式和安全规则。

### 隐私与安全

- 仓库模板只应该包含示例路径、示例 URL 和占位配置。
- Jenkins、GitLab、代理和认证信息应通过环境变量或本机配置提供，不要提交真实 token、密码或 cookie。
- 工作区只保存引用范围，不复制项目配置、私有模板或业务内容。
- CLI 的 `--json` 输出保持机器友好，不混入解释性文字。
- 合并、推送、构建、部署等动作建议先运行 `plan` / `overview` / `push-status`。

### 开发命令

```bash
npm run dev                # Tauri 桌面开发
npm run web:install        # 安装前端依赖
npm run web:dev            # 仅启动前端
npm run web:build          # 前端构建
npm run rust-check         # Rust/Tauri 检查
npm run build              # 打包桌面应用
npm run size               # 查看构建缓存和产物体积
npm run clean              # 清理常规构建产物
npm run clean:all          # 连依赖一起清理
```

---

## English

`rDevTool` is a local desktop workbench for day-to-day multi-project development. It brings workspaces, resource shortcuts, Git branch workflows, build tasks, local proxy rules, runtime debugging, activity history, and AI-readable context into one Tauri app.

It is not a replacement for GitLab, Jenkins, or a CI/CD platform. It is a local control surface for the questions developers answer constantly: which requirement context am I in, which project should I open, which resource should I search, which branch should I compare or switch, and where should this build go?

Stack: `Tauri 2 + Rust + React + Vite + TypeScript + Material UI`.

### Interface And Features

- **Workbench**: groups projects, shortcuts, proxy profiles, Links, build/Git actions, and recent activity by workspace; supports the global `system` workspace, scoped requirement workspaces, and incremental refresh after external config changes.
- **Resource Finder**: manages projects, websites, directories, apps, and scripts with search, favorites, recents, and workspace filtering.
- **Configuration Sources**: selects resource, Link, proxy, and runtime sources independently per workspace, with capability scoping, comparison, copying, and external-change notifications.
- **Link Chains**: composes local-file checks, proxy lifecycle, runtime lifecycle, and page focus into previewable, checkable, runnable, stoppable workspace tools.
- **Git Workflow**: branch listing, multi-target sync, branch creation, checkout, switch, merge preview, merge, push status, and push.
- **Build Tasks**: creates executable build plans from project config; supports Jenkins, local commands, and the R-series packaging adapter.
- **Local Proxy**: manages proxy profiles, forwarding, mocks, blocking rules, diagnostics, import/export, and runtime binding.
- **Project Runtime**: inspects, preflights, starts, lists, stops, restarts, and diagnoses project runtimes supervised by the App/CLI shared daemon, including state recovery, external-process detection, bounded adoption evaluation, and process ownership checks.
- **Activity Center**: centralizes build, Git, runtime, and external-config activity; grouped status follows the latest run while preserving every execution detail and safe replay path.
- **System Tray**: uses workspaces as first-level menus, then organizes resource, project, proxy, Link, build, and Git actions into nested shortcuts with pinning and repeat-last support.
- **Command Palette**: press `Cmd/Ctrl + K` to search projects, resources, and actions.
- **Workflow Signals**: connects branch, build, and runtime actions through replayable broadcast/receive rules.
- **AI / CLI**: all important read and action surfaces expose stable JSON output so AI agents can use the CLI instead of GUI automation.

### Quick Start

```bash
npm run web:install
npm run dev
```

Useful checks:

```bash
npm run rust-check
npm run web:build
cargo run --quiet -- --json doctor
```

Package the desktop app:

```bash
npm run build
```

Clean outputs:

```bash
npm run clean
npm run clean:all
```

### CLI Quick Start

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
rdevtool --json link list
rdevtool --json link plan <link-key>
rdevtool --json proxy list
rdevtool --json runtime list --running-only
```

Preview risky operations before running them:

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json git overview --project <project> --source <source> --target <target>
rdevtool --json git push-status --project <project>
```

See [docs/cli.md](docs/cli.md) for the full CLI reference.

### Configuration And Data

rDevTool creates default local configuration on first run:

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`
- Local history database: `~/.rdevtool/rdevtool.sqlite`

Main files:

| File | Purpose |
| --- | --- |
| `projects.toml` | Project source of truth: repos, build adapters, Jenkins, dev/build commands, debug profiles, branch rules |
| `workspace.toml` | App preferences, enabled pages, default page, active workspace |
| `workspaces/*.toml` | Scoped requirement workspaces; stores only project, shortcut, and proxy references |
| `config_sources.toml` | Custom config sources and resource, link, proxy, and runtime file mappings |
| `sources/workspaces/<key>/` | Per-workspace generated configuration directories |
| `navigation.toml` | Websites, directories, apps, and scripts |
| `links.toml` | Composable local-debug chains and their execution steps |
| `proxy.toml` | Local proxy profiles, rules, and workspace ownership |
| `runtime_overrides.toml` | Runtime profile overrides supplied by a configuration source |
| `web_actions.toml` | Chrome DevTools Protocol web actions |

See [docs/config.md](docs/config.md) for details.

### Product Model

- **Workspace**: a requirement or project context. `system` shows everything; scoped workspaces reference only the relevant projects, resources, and proxies.
- **Project**: repository path, Git URL, dev/build commands, focus behavior, debug profiles, build targets, and branch rules.
- **Build Target**: one of `jenkins`, `local_command`, or `r_series_package`.
- **Runtime Profile**: browser, proxy, environment, and local debugging setup.
- **Navigation Entry**: URL, directory, app, or script shortcut.
- **Proxy Profile**: forwarding, mock, block, and diagnosis rules for local development.
- **Config Source**: a selectable, comparable, and copyable file source for resource, Link, proxy, and runtime capabilities.
- **Link**: a reusable local-debug chain composed from local-file, proxy, runtime, and page actions.

### AI Usage

Install the rDevTool skill under your local Codex skills directory, for example:

```text
~/.codex/skills/rdevtool
```

An AI agent should read the current state first:

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent context --limit 6
```

Then it should act through workspace-aware previews and CLI commands. See [docs/ai-agent.md](docs/ai-agent.md).

### Documentation

- [docs/cli.md](docs/cli.md): CLI commands, JSON contract, and examples.
- [docs/config.md](docs/config.md): local config files and workspace model.
- [docs/r-series-apps.md](docs/r-series-apps.md): R-series app registration pattern.
- [docs/ai-agent.md](docs/ai-agent.md): AI agent workflow and safety rules.

### Privacy And Safety

- Repository templates should contain only sample paths, sample URLs, and placeholder config.
- Jenkins, GitLab, proxy, and auth values should come from environment variables or local config, not committed tokens, passwords, or cookies.
- Workspaces store scoped references; they do not copy project config, private templates, or business content.
- `--json` output stays machine-friendly and does not mix in prose.
- Run `plan`, `overview`, or `push-status` before merge, push, build, or deploy operations.

### Development Commands

```bash
npm run dev                # Tauri desktop development
npm run web:install        # Install frontend dependencies
npm run web:dev            # Frontend only
npm run web:build          # Build frontend
npm run rust-check         # Rust/Tauri check
npm run build              # Package desktop app
npm run size               # Inspect build cache and outputs
npm run clean              # Clean normal build outputs
npm run clean:all          # Clean outputs and dependencies
```
