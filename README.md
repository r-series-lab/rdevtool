# rDevTool

`rDevTool` 是一个中文友好的开发者工作流桌面工具，用来管理多个前端/桌面项目的分支、部署、合并、导航、笔记和历史记录。它不是 CI/CD 平台，而是把常用开发操作收进一个本地工作台，并提供稳定 CLI，方便脚本和 AI Agent 调用。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`

## 功能

- 从 TOML 配置读取项目列表
- 查看项目、分支、环境和部署参数
- 构建部署计划并触发 Jenkins job
- 查询构建状态和历史
- 通过 GitLab API 或本地 git 执行分支合并
- 批量同步分支、创建分支、checkout 到目录
- 查看本地分支推送状态并执行 push
- 维护项目导航条目
- 保存本地笔记、部署历史和合并历史
- 桌面 UI、TUI 和 CLI 共用同一套 Rust core
- `--json` 输出稳定，适合 AI/自动化调用

## 适合做什么

- 管理多个项目的日常部署和分支操作
- 把团队常用页面、环境、Jenkins job 和项目路径整理成可搜索配置
- 给 AI Agent 提供稳定 CLI 上下文，而不是让 AI 操作浏览器或 GUI
- 在本机保留部署/合并/笔记历史

当前版本不会替代 GitLab、Jenkins 或真正的 CI 平台；它只是本地工作流入口。

## 快速开始

安装前端依赖：

```bash
npm run web:install
```

启动桌面开发版：

```bash
npm run dev
```

检查 Rust 和前端构建：

```bash
npm run rust-check
npm run web:build
```

构建 CLI：

```bash
cargo build
./target/debug/rdevtool --json info
```

## 配置文件

首次启动时，应用会在系统配置目录创建默认配置。

- macOS: `~/Library/Application Support/rDevTool/`
- Linux: `~/.config/rDevTool/`

主要配置：

| 文件 | 用途 |
| --- | --- |
| `projects.toml` | 项目、仓库路径、Git URL、Jenkins profile、部署目标和参数 |
| `workspace.toml` | UI 偏好、默认页面、启用模块 |
| `navigation.toml` | 常用页面和项目导航 |

仓库中提供安全模板：

- [projects.template.toml](projects.template.toml)
- [workspace.template.toml](workspace.template.toml)
- [navigation.template.toml](navigation.template.toml)

敏感信息建议放到环境变量或私有本地配置中，不要写进仓库模板。

## 最小配置示例

```toml
[defaults]
gitlab_api_base_url = "http://127.0.0.1:8181/gitlab/api/v4"
gitlab_token_env = "GITLAB_TOKEN"

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

[[projects.deploy_targets]]
key = "standard"
label = "标准"
jenkins_profile = "default"
job_name = "Example/example-web"
```

## CLI 用法

开发期使用：

```bash
npm run cli -- --json info
npm run cli -- --json capabilities
npm run cli -- --json list
```

构建后使用：

```bash
cargo build
./target/debug/rdevtool --json agent capabilities
```

### 项目与部署

```bash
npm run cli -- --json projects list
npm run cli -- --json show example-web
npm run cli -- --json branches example-web
npm run cli -- --json envs example-web
npm run cli -- --json options example-web
```

生成部署计划：

```bash
npm run cli -- --json plan example-web \
  --env uat3 \
  --branch feature-demo
```

触发部署：

```bash
JENKINS_PASSWORD='your-password' npm run cli -- --json trigger example-web \
  --env uat3 \
  --branch feature-demo
```

查询构建状态：

```bash
npm run cli -- --json status --queue-url http://127.0.0.1:8080/queue/item/1/
```

### Git 和分支

```bash
npm run cli -- --json git current example-web
npm run cli -- --json merge-overview example-web --source release/test --target main
npm run cli -- --json merge example-web --source release/test --target main
npm run cli -- --json push-status --project example-web
npm run cli -- --json push-branch --project example-web --message "sync"
```

批量创建分支：

```bash
npm run cli -- --json create-branch \
  --project example-web \
  --source main \
  --target feature/new-work
```

### 笔记、历史和导航

```bash
npm run cli -- --json notes list
npm run cli -- --json notes search deploy
printf 'Release note\n- Sync config\n' | npm run cli -- --json notes save demo-note --title "Example note" --stdin
npm run cli -- --json history deploy --project example-web --limit 5
npm run cli -- --json navigation list
npm run cli -- --json navigation search jenkins
```

### Agent 上下文

```bash
npm run cli -- --json agent capabilities
npm run cli -- --json agent context --project example-web --query deploy --limit 6
```

## JSON 输出约定

成功：

```json
{
  "ok": true,
  "command": "list",
  "data": []
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

启用 `--json` 时，CLI 不会混入解释性 prose。

## 给 AI / 自动化工具的建议

- 先调用 `agent capabilities --json`，再决定使用哪个命令。
- 需要理解项目上下文时调用 `agent context --project ... --query ... --json`。
- 需要部署时先调用 `plan ... --json`，展示计划给用户确认，再调用 `trigger ... --json`。
- 需要合并时先调用 `merge-overview ... --json`，确认 commits 和风险，再调用 `merge ... --json`。
- 不要把 token 或 password 写入仓库；优先使用 `GITLAB_TOKEN` 和 `JENKINS_PASSWORD`。
- 自动化脚本应解析 `ok`、`command`、`data`、`error` 字段。

## 数据与安全边界

- 共享配置放在 TOML 文件中。
- 本地状态、笔记、部署历史、合并历史保存在 SQLite。
- Git 分支是远程动态数据，不作为共享配置提交。
- Jenkins password 和 GitLab token 应使用环境变量或私有本地配置。
- 仓库模板只包含假服务地址和示例项目。

## 开发命令

```bash
npm run web:install    # 安装 web 依赖
npm run dev            # 启动桌面开发版
npm run web:build      # 前端生产构建
npm run rust-check     # Rust 类型检查
npm run size           # 查看构建缓存和产物体积
npm run clean          # 清理构建产物
npm run clean:all      # 清理构建产物和 web/node_modules
```

## 项目结构

```text
src/               Rust core、CLI、TUI、SQLite storage
src-tauri/         Tauri 桌面壳
web/               React + Vite 前端
scripts/           开发启动脚本
*.template.toml    公开安全配置模板
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
