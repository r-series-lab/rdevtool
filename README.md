# rDevTool

`rDevTool` 是一个中文友好的本地开发工作台，用来把多项目开发里的项目访达、分支流转、Jenkins 部署、常用入口、活动记录和自动化上下文收在一个桌面工具里。

它不是 GitLab、Jenkins 或 CI/CD 平台的替代品，而是一个本机入口：把「我现在要打开哪个项目、切哪个分支、跑哪个 dev/build、部署到哪个环境、下一步要不要触发别的动作」这些日常动作变得可见、可复用，并且提供稳定 JSON CLI，方便脚本和 AI Agent 调用。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`

## 适合谁

- 同时维护多个前端、桌面或内部工具项目的人。
- 经常需要在多个分支、多个环境、多个 Jenkins job 之间切换的人。
- 希望把团队内部页面、脚本、应用、项目目录整理成一个可搜索入口的人。
- 希望给 AI Agent 提供稳定上下文，而不是让 AI 直接操作网页和 GUI 的人。

## 当前能力概览

### 访达

访达是 rDevTool 的项目入口页，负责把项目、网站、应用和脚本放在同一个可搜索视图里。

- 按「项目 / 网站 / 应用 / 脚本」切换入口类型。
- 支持分类、收藏、最近使用和关键词过滤。
- 可打开项目目录、网站、macOS 应用、脚本入口。
- 可从项目卡片直接进入「分支」或「部署」页面。
- 可启动或停止项目的 `dev` 命令。
- 可运行或停止项目的 `build` 命令。
- 可打开构建产物目录。
- 可读取 dev/build 日志，日志面板会限制展示行数，避免页面失控。
- 可配置和选择 debug profile，为启动命令叠加环境变量、本地文件写入、浏览器 profile 和代理。
- 可通过 focus 配置唤起项目页面或应用。
- 可给项目动作绑定工作流信号，例如 dev 启动成功后触发另一个动作。

### 分支

分支页面面向多分支日常操作，重点是把高风险操作拆成可确认、可复用的任务。

- 查看当前项目本地分支、远程分支和更新时间。
- 按项目配置里的分支关键字区分源分支和目标分支。
- 将一个源分支同步到多个目标分支。
- 批量为多个项目创建同名目标分支。
- 将指定分支克隆到选择的目录。
- 切换本地工作区到指定分支。
- 查看本地推送状态：当前分支、upstream、ahead/behind、暂存、未暂存、未跟踪、冲突文件。
- 支持仅 push，或先 commit 再 push。
- 保存分支任务历史，支持按历史记录重播。
- 可把分支成功事件广播成工作流信号，也可接收信号自动重播某个分支任务。

### 部署

部署页负责把项目部署参数、Jenkins job 和构建状态串起来。

- 按项目选择部署配置 target。
- 部署参数来自 `projects.toml`，支持 `select`、`boolean`、`branch`、`text`、`hidden`。
- 分支参数可以从 Git 分支列表选择，也可以手动输入。
- 触发前先生成部署计划，便于确认 Jenkins profile、job、参数和目标环境。
- 调用 Jenkins API 触发构建。
- 支持 queue URL 和 build URL 状态刷新。
- 构建状态会记录为部署历史，便于回看和重播。
- 部署历史按同参数记录聚合，支持展开同组记录。
- 常用部署可以置顶到托盘，减少重复输入。
- 可把部署历史绑定为工作流接收动作，例如分支合并成功后自动重播一次部署。

### 设置

设置面板用于编辑本地工作台配置。

- 切换界面风格：`light` 或 `mono`。
- 设置默认页面和启用页面顺序。
- 打开配置目录、项目配置文件和导航配置文件。
- 编辑项目基础信息：key、名称、分类、仓库路径、Git URL。
- 编辑全局或项目级分支规则。
- 编辑项目 dev/build 命令、cwd、输出目录和环境变量。
- 编辑 focus 行为：URL、bundle id、启动后自动唤起。
- 编辑 debug profile：环境变量、本地文件写入、浏览器、浏览器 profile、网络代理。
- 编辑部署 target 和部署参数。
- 编辑导航入口分类与 URL / app / script 条目。

### 活动中心

活动中心是任务状态总览，用来避免「点了之后不知道发生了什么」。

- 记录 runtime、build、branch、deploy、shortcut 等活动。
- 区分运行中、成功、失败和普通信息。
- 支持按执行链分组，方便看一串自动化动作。
- 可打开关联资源，例如构建记录、产物目录、本地日志。
- 可定位到对应页面或项目。
- 可标记已处理、清空活动、刷新状态。
- 部署状态自动同步失败时会累积失败次数，避免无限重试。

### 网页动作

rDevTool 内置一个基于 Chrome DevTools Protocol 的轻量网页动作系统。

- 首次使用会在配置目录生成 `web_actions.toml`。
- 可启动一个受控 Chrome，默认 CDP 端口为 `9223`。
- 可列出当前受控页面。
- 可按 URL 匹配动作。
- 可运行预配置 JavaScript 动作，也可执行临时脚本。
- 动作参数在 TOML 中声明，运行结果以结构化对象返回。

默认模板包含「读取页面信息」和一个示例搜索动作，实际使用时建议替换成团队内部页面的自动化动作。

### CLI 与 AI Agent

CLI 与桌面端共享同一套 Rust core。所有关键操作都有 `--json` 输出，方便脚本、CI 辅助工具或 AI Agent 调用。

- `info` 输出配置路径、项目数量、Jenkins profile、GitLab token 状态。
- `capabilities` 输出可用能力清单。
- `context` / `agent context` 汇总项目、笔记、部署历史、分支历史、导航搜索结果。
- `projects ...` 管理项目查询。
- `deploy ...` 生成部署计划、触发 Jenkins、查询状态和历史。
- `git ...` 执行当前分支、分支列表、合并预览、合并、批量创建、克隆、切换、推送。
- `notes ...` 管理本地笔记。
- `navigation ...` 查询和打开导航入口。
- `app preferences` / `app set-preferences` 管理工作台页面和样式偏好。

## 快速开始

安装前端依赖：

```bash
npm run web:install
```

启动 Tauri 桌面开发版：

```bash
npm run dev
```

检查 Rust 和前端构建：

```bash
npm run rust-check
npm run web:build
```

构建桌面应用：

```bash
npm run build
```

构建并调用 CLI：

```bash
cargo build
./target/debug/rdevtool --json info
```

## 配置文件

首次启动或首次调用 CLI 时，应用会在系统配置目录创建默认配置。

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`

主要配置文件：

| 文件 | 用途 |
| --- | --- |
| `projects.toml` | 项目、仓库、Git URL、Jenkins profile、部署 target、dev/build 命令、debug profile |
| `workspace.toml` | UI 风格、默认页面、启用页面与顺序 |
| `navigation.toml` | 常用网站、应用、脚本入口 |
| `web_actions.toml` | 受控 Chrome 和网页动作脚本 |

本地运行状态和历史数据保存在：

```text
~/.rdevtool/rdevtool.sqlite
```

仓库中提供安全模板：

- [projects.template.toml](projects.template.toml)
- [workspace.template.toml](workspace.template.toml)
- [navigation.template.toml](navigation.template.toml)

敏感信息建议放到环境变量或私有本地配置中，不要写进仓库模板。

## 最小项目配置

```toml
[defaults]
gitlab_api_base_url = "http://127.0.0.1:8181/gitlab/api/v4"
gitlab_token_env = "GITLAB_TOKEN"

[defaults.branch_rules]
target_keywords = ["staging", "pre", "main", "release"]

[defaults.jenkins_profiles.default]
base_url = "http://127.0.0.1:8080"
username = ""
password_env = "JENKINS_PASSWORD"

[[projects]]
key = "example-web"
name = "示例项目"
category = "Workspace"
repo_path = "/path/to/example-web"
git_url = "http://git.example.com/group/example-web.git"

[projects.dev]
command = "npm run dev"

[projects.build]
command = "npm run build"
output_dir = "/path/to/example-web/dist"

[projects.focus]
url = "http://127.0.0.1:3000"
auto_on_start = true

[[projects.deploy_targets]]
key = "standard"
label = "标准"
jenkins_profile = "default"
job_name = "Example/example-web"

[[projects.deploy_targets.params]]
key = "ENV_PROFILE"
label = "环境"
type = "select"
default = "uat3"
options = ["sit1", "sit2", "uat1", "uat2", "uat3", "pre", "pro"]
required = true

[[projects.deploy_targets.params]]
key = "BRANCH"
label = "分支"
type = "branch"
required = true
```

## Debug Profile 示例

debug profile 用于给同一个项目准备不同启动上下文，例如代理环境、灰度环境、本地覆盖文件。

```toml
[[projects.debug_profiles]]
key = "proxy"
label = "代理调试"
browser = "Google Chrome"
browser_profile = "Profile 1"

[projects.debug_profiles.env]
VITE_API_BASE = "https://example.test"

[projects.debug_profiles.network_proxy]
enabled = true
proxy_url = "http://127.0.0.1:7897"
inject_env = true
node_hook = false
no_proxy = "localhost,127.0.0.1,::1"

[[projects.debug_profiles.local_files]]
path = "/path/to/example-web/.env.local"
mode = "overwrite"
enabled = true
content = """
VITE_API_BASE=https://example.test
"""
```

## CLI 用法

开发期使用：

```bash
npm run cli -- --json info
npm run cli -- --json capabilities
npm run cli -- --json context --project example-web --query deploy
```

构建后使用：

```bash
./target/debug/rdevtool --json agent capabilities
```

### 工作台偏好

```bash
npm run cli -- --json app preferences
npm run cli -- --json app set-preferences --style-mode mono --default-page projects
npm run cli -- --json app set-preferences --enabled-page projects --enabled-page merge --enabled-page deploy
```

### 项目查询

```bash
npm run cli -- --json projects list
npm run cli -- --json projects show example-web
npm run cli -- --json projects branches example-web
npm run cli -- --json projects envs example-web --target standard
npm run cli -- --json projects options example-web --target standard
```

旧版顶层命令仍可用：

```bash
npm run cli -- --json list
npm run cli -- --json show example-web
npm run cli -- --json branches example-web
```

### 部署

生成部署计划：

```bash
npm run cli -- --json deploy plan example-web \
  --target standard \
  --env uat3 \
  --branch feature-demo \
  --set IS_GRAY=否
```

触发部署：

```bash
JENKINS_PASSWORD='your-password' npm run cli -- --json deploy trigger example-web \
  --target standard \
  --env uat3 \
  --branch feature-demo
```

查询构建状态：

```bash
npm run cli -- --json deploy status --queue-url http://127.0.0.1:8080/queue/item/1/
npm run cli -- --json deploy history --project example-web --limit 10
```

顶层别名也可用：

```bash
npm run cli -- --json plan example-web --env uat3 --branch feature-demo
npm run cli -- --json trigger example-web --env uat3 --branch feature-demo
npm run cli -- --json status --build-url http://127.0.0.1:8080/job/example/1/
```

### Git 和分支

```bash
npm run cli -- --json git current example-web
npm run cli -- --json git branches example-web
npm run cli -- --json git overview --project example-web --source release/test --target main
npm run cli -- --json git merge --project example-web --source release/test --target main
npm run cli -- --json git merge-many --project example-web --source release/test --target main --target pre
npm run cli -- --json git create --project example-web --source main --target feature/new-work
npm run cli -- --json git clone --project example-web --source feature/new-work --destination /tmp/example-web
npm run cli -- --json git switch --project example-web --target feature/new-work
npm run cli -- --json git push-status --project example-web
npm run cli -- --json git push --project example-web --message "sync"
npm run cli -- --json git history --project example-web --limit 10
```

对应的顶层命令：

```bash
npm run cli -- --json merge-overview example-web --source release/test --target main
npm run cli -- --json sync-branches --project example-web --source release/test --target main --target pre
npm run cli -- --json create-branch --project example-web --source main --target feature/new-work
npm run cli -- --json checkout-branch --project example-web --source feature/new-work --destination /tmp/example-web
npm run cli -- --json switch-branch --project example-web --target feature/new-work
npm run cli -- --json push-status --project example-web
npm run cli -- --json push-branch --project example-web --message "sync"
```

### 笔记、历史和导航

```bash
npm run cli -- --json notes list --limit 20
npm run cli -- --json notes search deploy
npm run cli -- --json notes get demo-note
npm run cli -- --json notes create --title "部署排查"
printf 'Release note\n- Sync config\n' | npm run cli -- --json notes save demo-note --title "Example note" --stdin --tags deploy,example
npm run cli -- --json notes delete demo-note

npm run cli -- --json history deploy --project example-web --limit 5
npm run cli -- --json history merge --project example-web --limit 5

npm run cli -- --json navigation path
npm run cli -- --json navigation list
npm run cli -- --json navigation search jenkins
npm run cli -- --json navigation open --query jenkins
```

### Agent 上下文

```bash
npm run cli -- --json agent capabilities
npm run cli -- --json agent context --project example-web --query deploy --limit 6
```

建议自动化流程：

1. 先调用 `agent capabilities --json` 确认可用能力。
2. 需要理解项目时调用 `agent context --project ... --query ... --json`。
3. 需要部署时先调用 `deploy plan ... --json`，展示计划给用户确认，再调用 `deploy trigger ... --json`。
4. 需要合并时先调用 `git overview ... --json`，确认 commits 和风险，再调用 `git merge ... --json`。
5. 自动化脚本只解析 JSON 字段，不依赖人类可读输出。

## JSON 输出约定

成功：

```json
{
  "ok": true,
  "command": "info",
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_arguments",
    "message": "project not found"
  }
}
```

启用 `--json` 时，CLI 不会混入解释性文本。常见错误码包括：

| code | 含义 |
| --- | --- |
| `invalid_arguments` | 参数缺失、格式错误、互斥参数冲突 |
| `missing_resource` | 项目、配置、文件或外部资源不存在 |
| `unsupported_operation` | 当前配置不支持该操作，例如未配置仓库路径 |
| `internal_error` | 其他运行时错误 |

## 数据与安全边界

- 共享配置使用 TOML 文件，不应该提交真实 token、password、内网地址。
- Jenkins password 优先从 profile 的 `password_env` 或 fallback file 读取。
- GitLab token 优先从 `gitlab_token_env` 指定的环境变量读取。
- 本地状态、收藏、最近使用、工作流规则、活动、笔记、部署历史和分支历史保存在 SQLite。
- Git 分支是动态远程数据，不作为共享配置提交。
- 部署和合并都是显式动作，建议先生成计划或预览再执行。
- 网页动作会在受控 Chrome 页面执行 JavaScript，只应配置可信脚本。

## 开发命令

```bash
npm run web:install    # 安装 web 依赖
npm run dev            # 启动 Tauri 桌面开发版
npm run build          # 构建桌面应用
npm run cli -- --help  # 运行 CLI
npm run web:dev        # 仅启动前端开发服务
npm run web:build      # 前端生产构建
npm run rust-check     # Rust 类型检查
npm run size           # 查看构建缓存和产物体积
npm run clean          # 清理构建产物
npm run clean:all      # 清理构建产物和 web/node_modules
```

## 项目结构

```text
src/               Rust core、CLI、TUI、SQLite storage、Git/Jenkins/GitLab/导航/网页动作
src-tauri/         Tauri 桌面壳和前端可调用命令
web/               React + Vite 前端工作台
scripts/           开发启动脚本
*.template.toml    公开安全配置模板
```

## 非目标

- 不托管代码，也不替代 GitLab。
- 不替代 Jenkins 或完整 CI/CD 编排系统。
- 不承诺理解任意 shell 脚本或任意团队流程，核心能力来自显式配置。
- 不把敏感凭据作为公开模板的一部分。

## 许可证

MIT，见 [LICENSE](LICENSE)。
