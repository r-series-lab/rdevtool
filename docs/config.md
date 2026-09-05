# rDevTool Config

rDevTool 的配置模型是：全局配置保存事实源，工作区只保存当前需求需要看的范围。

## 配置目录

macOS:

```text
~/Library/Application Support/rDevTool/
```

Linux:

```text
~/.config/rDevTool/
```

本地历史数据库：

```text
~/.rdevtool/rdevtool.sqlite
```

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `projects.toml` | 项目事实源：仓库、Jenkins、部署、分支、dev/build、debug profile |
| `workspace.toml` | App 偏好：主题、启用页面、当前激活工作区、系统范围配置源偏好 |
| `workspaces/*.toml` | 工作区范围：项目、导航分类、导航入口、配置源偏好、代理 profile 引用 |
| `config_sources.toml` | 自建配置源注册表：目录、文件映射、界面配置和能力范围 |
| `sources/workspaces/<key>/` | 工作区自动生成的独立配置目录 |
| `navigation.toml` | 入口事实源：网站、目录、应用、脚本 |
| `actions.toml` | 参数化 Action 事实源：参数 Schema 与受控执行配置 |
| `links.toml` | Link 事实源：本地文件、代理、Runtime 与页面步骤 |
| `proxy.toml` | 代理事实源：profile、规则、工作区归属 |
| `runtime_overrides.toml` | 配置源提供的 Runtime profile 覆盖 |
| `web_actions.toml` | Chrome CDP 网页动作 |

仓库内模板：

```text
projects.template.toml
workspace.template.toml
project-workspace.template.toml
navigation.template.toml
actions.template.toml
```

## Local State And Migrations

`~/.rdevtool/rdevtool.sqlite` 保存 notes、构建/合并历史、统一操作事件、分支观测缓存和少量本机状态，不是项目配置事实源。数据库启用 WAL，并使用 `PRAGMA user_version` 做只向前迁移：

- schema v1：KV、notes、构建历史和合并历史基础表。
- schema v2：为构建与合并历史增加工作区和项目实例范围。

应用会在启动时逐级迁移旧库；如果数据库版本高于当前应用支持版本，会拒绝打开而不是尝试降级。SQLite 没有应用层加密，备份或迁移时应把它视为本机开发历史数据；不要在构建参数、活动 payload 或 notes 中保存 token、密码、cookie 和私钥。

分支目录缓存与 Git 合并默认选择按“工作区 + 项目”分组，工作区实例切换后不会复用其他实例的分支上下文。分支目录仍会在进入 Git 页面时重新观测；旧版 `ruritool.*` 浏览器缓存只迁移一次，成功写入 SQLite 后即清理。

## Workspace

`workspace.toml` 只记录 UI 偏好和当前激活工作区：

```toml
[app]
style_mode = "mono"
default_page = "projects"
enabled_pages = ["projects", "merge", "build", "proxy"]
active_workspace = "r-series"

[app.config_source_preferences]
"configSource.proxy" = "default"
```

`system` 工作区的配置源偏好保存在 `workspace.toml`；普通工作区的偏好保存在各自 `workspaces/<key>.toml` 的 `metadata` 中。App 会自动维护这些字段，通常不需要手改。

桌面端会在 WebView `localStorage` 中保留后端已确认选择的启动镜像，以避免页面初始化时短暂跳回默认来源。TOML 始终是权威值，加载完成后会覆盖镜像；配置源管理器中的临时浏览选择不会写入镜像，也不会改变工作区偏好。

CLI 与 App 使用同一套按工作区、按能力解析规则。Link 定义、代理 profile 和 Runtime override 可以来自不同配置源，计划结果中的 `sourceContext` 会明确列出三者；缺失或不支持能力时会失败，不会静默回退到默认源。

App 从资源卡片、活动重试和托盘菜单执行 Link 时会固定工作区和 Link、Proxy、Runtime 三个来源。`skipped` 仅在没有风险时视为正常跳过，带风险的跳过会保持阻断状态。

## Config Sources

配置源把资源入口、参数化 Action、链路、代理和运行配置映射到一组可独立迁移的文件。内置来源包括默认配置和每个普通工作区的自动来源，也可以在 App 的“配置源管理”中添加团队目录或个人目录。

```toml
[[sources]]
id = "team-local"
name = "团队本地联调"
kind = "custom"
baseDir = "/absolute/path/to/team-local"
uiProfile = "resource-basic"
capabilities = ["resource", "link", "proxy", "runtime"]

[sources.files]
navigation = "navigation.toml"
actions = "actions.toml"
links = "links.toml"
proxy = "proxy.toml"
runtimeOverrides = "runtime_overrides.toml"
```

文件映射可以是绝对路径，也可以相对 `baseDir`。切换配置源时，App 会先确认偏好写入成功，再加载目标数据；快速切换工作区时只应用最新请求，避免旧结果覆盖当前页面。

CLI 可以查看来源并为当前工作区切换任意能力：

```bash
rdevtool --json config-source list
rdevtool --json config-source show team-local
rdevtool --json config-source compare default team-local
rdevtool --json config-source copy team-local --id team-local-copy --name "团队本地联调副本"
rdevtool --json config-source use team-local --capability proxy
```

桌面端“配置源管理”可以直接比较任意两个来源，并把默认、工作区或自建来源复制为新的自建来源。比较结果覆盖资源入口、链路、代理和运行配置，只展示状态摘要；复制时缺失文件保持缺失，不会修改原来源。

桌面端会监听工作区、项目工作区、项目列表和配置源文件的外部变化。变化会先增量刷新当前界面，并在活动中心保留一条可确认记录；工作区与项目配置可以直接重新加载，配置源变化可以直接打开比较结果。应用自身的保存操作会标记为内部写入，不会生成重复提醒。

## Project Workspace

`workspaces/system.toml` 是全局工作区。它显示全部项目、入口、代理和记录。

普通工作区只保存引用：

```toml
key = "marketing-rework"
name = "营销改造"
description = "营销相关项目和入口"
root_dir = "/path/to/workspace"
resource_dir = "/path/to/workspace/resources"
worklog_file = "WORKLOG.md"
worklog_auto_record = true
include_all_projects = false
include_all_navigation = false
projects = ["demo-console", "demo-mobile"]
navigation_categories = ["营销后台", "Jenkins"]
navigation_entries = ["CI 示例构建"]
```

`root_dir` 是项目副本和运行目录的根；`resource_dir` 是该需求的文档、附件、脚本和软链接目录；`worklog_file` 必须是 `resource_dir` 内的相对 Markdown 路径。`worklog_auto_record` 默认开启，只记录构建、Git、Runtime 和关键配置操作的完成或失败结果，并对同一终态事件去重。它们与全局 SQLite notes 的用途不同，工作日志会随工作区资料一起迁移，并进入 AI 工作区上下文。

不要在工作区里复制项目配置、Jenkins 配置或导航入口详情。它们仍然分别属于 `projects.toml`、`navigation.toml` 和 `proxy.toml`。

CLI 可直接更新工作区范围：

```bash
rdevtool --json workspace scope r-series --project rdevtool --navigation-category "R 系列"
rdevtool --json workspace scope r-series --proxy-profile default
```

## Projects

最小项目：

```toml
[[projects]]
key = "example-web"
name = "示例项目"
category = "工作"
repo_path = "/path/to/example-web"
git_url = "https://git.example.com/group/example-web.git"
```

常见能力块：

```toml
[projects.dev]
cwd = "/path/to/example-web"
command = "npm run dev"

[projects.build]
cwd = "/path/to/example-web"
command = "npm run build"
output_dir = "/path/to/example-web/dist"

[[projects.deploy_targets]]
key = "vke"
label = "VKE"
adapter = "jenkins"
action_kind = "deploy"
jenkins_profile = "default"
job_name = "Marketing/example-web-vke"

[projects.deploy_targets.artifact]
output_dir = "/path/to/example-web/jenkins-artifacts"

[[projects.deploy_targets.params]]
key = "ENV_PROFILE"
label = "环境"
type = "select"
default = "uat3"
options = ["uat3", "pre"]
required = true

[[projects.deploy_targets.params]]
key = "IS_GRAY"
label = "灰度"
type = "boolean"
default = "否"
true_value = "是"
false_value = "否"

[[projects.deploy_targets]]
key = "package"
label = "本地打包"
adapter = "r_series_package"
action_kind = "package"
job_name = ""

[[projects.deploy_targets.params]]
key = "platform"
label = "系统"
type = "select"
default = "macos"
options = ["macos", "windows", "linux"]
```

常见项目配置可以用 CLI 维护，避免手改 TOML：

```bash
rdevtool --json projects add --key example-web --name "示例项目" --repo-path /path/to/example-web
rdevtool --json projects set-command example-web --kind dev --command "npm run dev" --cwd /path/to/example-web
rdevtool --json projects build-target-add example-web --key vke --label VKE --adapter jenkins --action-kind deploy --profile default --job "Marketing/example-web-vke" --output-dir /path/to/example-web/jenkins-artifacts
rdevtool --json projects build-target-add example-web --key package --label "本地打包" --adapter r_series_package
rdevtool --json projects build-param-add example-web vke --key ENV_PROFILE --label "环境" --kind select --option uat3 --option pre --default uat3 --required
```

敏感信息优先放环境变量，不要写入仓库模板。

`deploy_targets` 现在作为通用构建目标承载字段。旧配置不写 `adapter` 和 `action_kind` 时默认等价于：

```toml
adapter = "jenkins"
action_kind = "deploy"
```

当前已实现的 adapter：

| adapter | 用途 |
| --- | --- |
| `jenkins` | Jenkins 远端构建/部署，需要 `jenkins_profile` 和 `job_name` |
| `local_command` | 本地命令构建，可留空 `jenkins_profile`，`job_name` 作为命令覆盖 |
| `r_series_package` | R 系列本地打包，可复用 `[projects.build]`，参数会注入为 `RDEVTOOL_PARAM_*` 环境变量 |

每个 target 可通过 `[projects.deploy_targets.artifact].output_dir` 声明产物目录。它是 rDevTool 自身的产物元数据，不会作为 Jenkins 参数发送；Jenkins target 的 `build plan` 会返回该目录。本地 adapter 的命令解析顺序是 `build_command` 参数、target `job_name`、`[projects.build].command`、默认 `npm run build`。产物目录解析顺序是运行参数 `build_output_dir`、target `artifact.output_dir`、`[projects.build].output_dir`；运行参数保留用于兼容旧配置和一次性覆盖。

## R 系列应用

R 系列本地应用推荐统一注册为两个 build target：

- `web`：`local_command`，只跑前端构建，例如 `npm run web:build`。
- `package`：`r_series_package`，复用 `[projects.build]` 打包桌面应用。

```toml
[projects.dev]
command = "npm run dev"
cwd = "/Users/demo/Projects/r-series/rdevtool"

[projects.build]
command = "npm run build"
cwd = "/Users/demo/Projects/r-series/rdevtool"
output_dir = "/Users/demo/Projects/r-series/rdevtool/target/release/bundle"

[[projects.deploy_targets]]
key = "web"
label = "前端构建"
adapter = "local_command"
action_kind = "build"
job_name = "npm run web:build"

[projects.deploy_targets.artifact]
output_dir = "/Users/demo/Projects/r-series/rdevtool/web/dist"

[[projects.deploy_targets]]
key = "package"
label = "本地打包"
adapter = "r_series_package"
action_kind = "package"
job_name = ""

[[projects.deploy_targets.params]]
key = "platform"
label = "系统"
type = "select"
default = "macos"
options = ["macos", "windows", "linux"]

[[projects.deploy_targets.params]]
key = "profile"
label = "配置"
type = "select"
default = "release"
options = ["release", "debug"]
```

`r-series` 工作区建议只引用 R 系列项目和 `R系列开发` 导航分类，不复制项目或入口详情。

## Navigation

导航入口分为 `url`、`directory`、`app`、`script`。

```toml
[[categories]]
title = "办公平台"
short_label = "办公"

[[categories.entries]]
name = "Jenkins"
kind = "url"
url = "http://127.0.0.1:8080"

[[categories.entries]]
name = "项目目录"
kind = "directory"
path = "/Users/demo/Projects/r-series"
```

工作区可以引用整个分类，也可以引用单个入口。

## Proxy

代理 profile 可以归属到某个工作区：

```toml
[[profiles]]
id = "default"
name = "默认代理"
listen_host = "127.0.0.1"
listen_port = 8787
workspace_key = "r-series"
```

`system` 工作区显示全部代理。普通工作区只显示 `workspace_key` 等于当前工作区的 profile。

使用 `doctor` 检查代理配置：

```bash
rdevtool --json doctor
```

它会提示配置源解析、当前启用源、重复端口、守护进程版本、无效 URL、无效规则和缺失工作区引用。

CLI 可管理 profile 级配置：

```bash
rdevtool --json proxy add --name "需求代理" --listen-port 8789 --workspace r-series
rdevtool --json proxy update default --listen-port 8788
rdevtool --json proxy export default --output ./proxy-default.json
rdevtool --json proxy import --file ./proxy-default.json --workspace r-series
rdevtool --json proxy rule-add --profile default --name "转发 API" --path-prefix /api --action forward --target-base-url http://127.0.0.1:3000
rdevtool --json proxy rule-add --profile default --name "Mock 用户" --path-prefix /api/user --action mock --status 200 --body '{"ok":true}'
```

## Config Health

推荐在修改配置后运行：

```bash
rdevtool --json doctor
rdevtool --json agent context --limit 3
```

`doctor` 发现 warning 不一定代表不能使用，但应该处理会影响当前任务的问题，例如缺失仓库路径、重复代理端口、工作区引用不存在的项目。
