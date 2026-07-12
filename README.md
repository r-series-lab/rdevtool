# rDevTool

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

`rDevTool` 是一个本地开发工作台，把多项目日常里的工作区、资源入口、Git 分支、构建任务、本地代理、运行时调试、活动记录和 AI 上下文收在一起。它不是 GitLab、Jenkins 或 CI/CD 平台的替代品，而是一个面向个人和小团队工作流的桌面入口：让「当前在哪个需求上下文、该打开哪个项目、查哪个入口、切哪个分支、构建或部署到哪里」这些动作可见、可复用、可被 CLI 和 AI 稳定调用。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`。

### 界面与功能

- **工作台**：按工作区聚合项目、入口、代理和最近活动；支持 `system` 全局视图和普通需求工作区。
- **资源入口**：统一管理项目、网站、目录、应用和脚本入口，支持搜索、收藏、最近使用和工作区过滤。
- **Git 工作流**：查看分支、同步多目标分支、创建分支、切换分支、检出到目录、合并预览、合并、推送前检查和推送。
- **构建任务**：从项目配置生成构建计划，支持 Jenkins、本地命令和 R 系列桌面应用打包 adapter，并保留构建历史与重放入口。
- **本地代理**：维护代理 profile、规则、Mock、转发、阻断和导入导出，可绑定到运行时 profile。
- **项目运行时**：检查、预检、启动、聚焦和读取项目运行日志，适合浏览器联调和本地服务调试。
- **活动中心**：集中显示构建、Git、运行时、代理等操作状态，支持刷新、清理和工作流重放。
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
rdevtool --json proxy list
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
| `navigation.toml` | 网站、目录、应用、脚本入口 |
| `proxy.toml` | 本地代理 profile、规则和工作区归属 |
| `web_actions.toml` | Chrome DevTools Protocol 网页动作 |

详细配置见 [docs/config.md](docs/config.md)。

### 项目模型

- **Workspace**：需求或项目上下文。`system` 是全局视图，普通工作区只引用相关项目、入口和代理。
- **Project**：仓库路径、Git URL、dev/build 命令、focus 行为、debug profile、构建 target 和分支规则。
- **Build Target**：支持 `jenkins`、`local_command`、`r_series_package` 三类 adapter。
- **Runtime Profile**：浏览器、代理、环境变量和本地联调能力的组合。
- **Navigation Entry**：URL、目录、应用或脚本入口。
- **Proxy Profile**：本地转发、Mock、阻断和诊断规则集合。

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

- **Workbench**: groups projects, shortcuts, proxy profiles, and recent activity by workspace; supports the global `system` workspace and scoped requirement workspaces.
- **Resource Finder**: manages projects, websites, directories, apps, and scripts with search, favorites, recents, and workspace filtering.
- **Git Workflow**: branch listing, multi-target sync, branch creation, checkout, switch, merge preview, merge, push status, and push.
- **Build Tasks**: creates executable build plans from project config; supports Jenkins, local commands, and the R-series packaging adapter.
- **Local Proxy**: manages proxy profiles, forwarding, mocks, blocking rules, diagnostics, import/export, and runtime binding.
- **Project Runtime**: inspects, preflights, starts, focuses, and reads logs for local project runtimes.
- **Activity Center**: centralizes build, Git, runtime, and proxy status with refresh, cleanup, and replay actions.
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
rdevtool --json proxy list
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
| `navigation.toml` | Websites, directories, apps, and scripts |
| `proxy.toml` | Local proxy profiles, rules, and workspace ownership |
| `web_actions.toml` | Chrome DevTools Protocol web actions |

See [docs/config.md](docs/config.md) for details.

### Product Model

- **Workspace**: a requirement or project context. `system` shows everything; scoped workspaces reference only the relevant projects, resources, and proxies.
- **Project**: repository path, Git URL, dev/build commands, focus behavior, debug profiles, build targets, and branch rules.
- **Build Target**: one of `jenkins`, `local_command`, or `r_series_package`.
- **Runtime Profile**: browser, proxy, environment, and local debugging setup.
- **Navigation Entry**: URL, directory, app, or script shortcut.
- **Proxy Profile**: forwarding, mock, block, and diagnosis rules for local development.

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
