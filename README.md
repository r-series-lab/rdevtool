# rDevTool

`rDevTool` 是一个本地开发工作台，用来把多项目日常里的访达入口、分支操作、构建/部署、代理配置、活动记录和 AI 上下文收在一起。

它不是 GitLab、Jenkins 或 CI/CD 平台的替代品，而是一个面向个人工作流的桌面入口：让「现在在哪个需求上下文、该打开哪个项目、查哪个入口、切哪个分支、构建或部署到哪里」这些动作变得可见、可复用、可被 CLI 和 AI 稳定调用。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`

## 产品模型

- **工作区**：需求或项目上下文。`system` 是全局视图，显示全部项目、入口、代理和记录；普通工作区只引用相关项目和入口，不复制完整配置。
- **访达**：项目、网站、目录、应用和脚本的统一入口，支持搜索、收藏、最近使用和工作区过滤。
- **项目**：仓库路径、Git URL、dev/build 命令、focus 行为、debug profile、构建 target 和分支规则。
- **分支**：查看当前分支、分支列表、合并预览、合并、批量建分支、切换和推送。
- **构建**：从项目配置生成构建计划，支持 Jenkins、本地命令和 R 系列打包 adapter，保留旧配置字段和历史复用。
- **代理**：本地代理 profile 和规则，支持按工作区归属，便于调试特定需求环境。
- **活动与历史**：记录 runtime、build、branch、shortcut 等操作状态，便于回看和重播。
- **CLI / AI**：所有关键读取能力提供稳定 JSON 输出，AI 应优先通过 CLI 获取上下文和执行预览。

## 快速开始

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

构建桌面应用：

```bash
npm run build
```

## CLI 快速入口

开发态可以直接在仓库内运行：

```bash
cargo run --quiet -- --json info
cargo run --quiet -- --json doctor
cargo run --quiet -- --json agent context --limit 6
```

安装或放入 `PATH` 后：

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json workspace list
rdevtool --json projects list
rdevtool --json projects add --key demo-web --name "Demo Web" --repo-path /path/to/demo-web
rdevtool --json navigation search Jenkins
rdevtool --json proxy list
```

高风险动作遵循先预览再执行：

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json git overview --project <project> --source <source> --target <target>
rdevtool --json git push-status --project <project>
```

完整命令见 [docs/cli.md](docs/cli.md)。

## 配置边界

rDevTool 首次运行会在本机配置目录生成默认配置：

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`

主要文件：

| 文件 | 用途 |
| --- | --- |
| `projects.toml` | 项目、仓库、构建 adapter、Jenkins、部署、分支、dev/build、debug profile |
| `workspace.toml` | UI 偏好、启用页面、当前激活工作区 |
| `workspaces/*.toml` | 需求工作区，只保存项目、入口、代理等引用范围 |
| `navigation.toml` | 网站、目录、应用、脚本入口 |
| `proxy.toml` | 本地代理 profile 和规则 |
| `web_actions.toml` | Chrome DevTools Protocol 网页动作 |
| `~/.rdevtool/rdevtool.sqlite` | 本地历史、笔记和运行记录 |

详细配置见 [docs/config.md](docs/config.md)。

## AI 使用

已提供专用 Skill：

```text
/Users/ikiru/.codex/skills/rdevtool
```

AI 处理 rDevTool 任务时应先读取当前上下文：

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent context --limit 6
```

然后按工作区和命令预览结果行动。详细流程见 [docs/ai-agent.md](docs/ai-agent.md)。

## 文档

- [docs/cli.md](docs/cli.md)：CLI 命令、JSON 契约和示例。
- [docs/config.md](docs/config.md)：本地配置文件和工作区模型。
- [docs/r-series-apps.md](docs/r-series-apps.md)：R 系列应用开发配置范式。
- [docs/ai-agent.md](docs/ai-agent.md)：AI Agent 使用方式和安全规则。

## 开发命令

```bash
npm run dev          # Tauri 桌面开发
npm run web:build    # 前端构建
npm run rust-check   # Rust/Tauri 检查
npm run build        # 打包桌面应用
npm run clean        # 清理构建产物
```
