# rDevTool CLI

rDevTool 的 CLI 是给脚本和 AI Agent 使用的稳定操作面。读取类命令和关键动作命令都应使用 `--json`。

规范写法把全局参数放在领域命令之前：

```bash
rdevtool --json <domain> <command>
```

能力发现和健康检查是自动化入口，不要从帮助文本猜功能：

```bash
rdevtool --json info
rdevtool --json agent capabilities
rdevtool --json doctor
```

## JSON 契约

成功：

```json
{
  "ok": true,
  "command": "agent.context",
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_arguments",
    "message": "..."
  }
}
```

常见错误码：

| code | 含义 |
| --- | --- |
| `invalid_arguments` | 参数错误或配置格式错误 |
| `missing_resource` | 项目、工作区、文件或远端资源不存在 |
| `unsupported_operation` | 前置条件不满足或能力未配置 |
| `internal_error` | 未归类的内部错误 |

## 上下文入口

```bash
rdevtool --json workspace show
rdevtool --json agent context --project <project> --for runtime --compact
rdevtool --json agent context --project <project> --for runtime --compact --debug-profile <profile>
rdevtool --json agent context --project <project> --for git --compact --include history
rdevtool --json agent context --for artifacts --compact
```

`--for` 支持 `workspace|git|runtime|build|web-actions|artifacts`。`--compact` 会裁掉无关能力、历史、笔记、导航和跨域项目字段；`--include` 再按需补回。runtime 预设在指定 `--project` 后返回共享 Runtime Context：每个 `runtime.targets[]` 都明确分开 `requested`、`effective`、`observed`，并包含有效 `cwd`、`focusUrl`、`readyProbe`、daemon 会话、证据、风险、托管产物和建议动作。不传 `--debug-profile` 时返回项目默认目标及全部 Debug Profile 目标；传入后只返回指定目标。`--runtime-profile` 可覆盖 Debug Profile 继承的运行配置。artifacts 预设只返回当前工作区边界、按类型计数、归属/活跃/缺失统计、`eligible|reviewRequired|blocked` 汇总、证据、风险和下一条只读命令，不返回逐条产物路径。旧的无参数 `agent context` 保持完整输出兼容。

开发态运行：

```bash
cargo run --quiet -- --json info
cargo run --quiet -- --json doctor
```

## App

```bash
rdevtool --json app preferences
rdevtool --json app set-preferences --style-mode mono
rdevtool --json app set-preferences --default-page build
rdevtool --json app set-preferences --enabled-page projects --enabled-page build
```

## Workspace

```bash
rdevtool --json workspace list
rdevtool --json workspace show
rdevtool --json workspace show r-series
rdevtool --json workspace use r-series
rdevtool --json workspace create marketing-rework --name "营销改造" --resource-dir /path/to/demand-assets
rdevtool --json workspace create clean-room --name "空工作区" --empty --no-switch
rdevtool --json workspace init-demand --name "需求 A" --requirement-dir /path/to/requirement --repo-path /path/to/repo --branch feature-a --copy-mode existing --dry-run
rdevtool --json workspace init-demand --name "需求 A" --requirement-dir /path/to/requirement --repo-path /path/to/source-repo --branch feature-a --root-dir /path/to/workspace --copy-mode worktree --dry-run
rdevtool --json workspace init-demand --name "需求 A" --requirement-dir /path/to/requirement --project demo-web --branch feature-a --root-dir /path/to/workspace --copy-mode clone --dry-run
rdevtool --json workspace resources-init marketing-rework --resource-dir /path/to/demand-assets
rdevtool --json workspace worklog-append marketing-rework --kind 修复 --summary "修复分支刷新" --detail "切换项目后主动获取远程分支。"
rdevtool --json workspace worklog-show marketing-rework --lines 80
rdevtool --json workspace worklog-auto marketing-rework --enabled false
rdevtool --json workspace scope r-series --project rdevtool --project rterm
rdevtool --json workspace scope r-series --navigation-category "R 系列"
rdevtool --json workspace scope r-series --proxy-profile default
rdevtool --json workspace scope r-series --all-projects --all-navigation
```

`system` 是全局工作区，显示全部项目和入口。
新工作区默认在资料目录中初始化 `WORKLOG.md`，并自动记录构建、Git、Runtime 与关键配置操作的最终结果；使用 `--no-worklog` 可只配置目录，使用 `--no-auto-worklog` 可关闭自动记录。资料目录会作为工作区入口，可存放真实文件或软链接。未传 `--resource-dir` 时，目录默认为 `<root_dir>/resources`，轻量工作区则使用 rDevTool 的默认工作区目录。
`workspace scope` 会写入 `workspaces/<key>.toml`，并在指定 `--proxy-profile` 时更新 `proxy.toml` 中 profile 的工作区归属。

`--project-instance project=/path` 默认要求路径存在、是 Git 仓库根目录，并且归一化后的 remote 与项目 `git_url` 匹配。确实需要绑定镜像或迁移仓库时才使用 `--allow-remote-mismatch`。

`workspace init-demand` 支持 `--copy-mode existing|worktree|clone`，默认 `existing`。`existing` 绑定 `--repo-path` 或项目已有 `repoPath`；`worktree` 从本地源仓库创建副本；`clone` 使用项目 `gitUrl`，显式 `--project` 后可以省略 `--repo-path`。托管副本默认位于 `<root-dir>/<project-key>`，`--instance-dir` 只能指定 `root-dir` 下不存在的直属目录。先使用 `--dry-run` 查看 `requested/effective/observed` 和 `plannedActions`；dry-run 不创建目录、不 fetch、不写配置也不激活工作区。正式执行时完整配置最后保存、激活最后执行，失败只回滚本次创建的托管副本和资源。worktree 分支如果已被其他工作目录占用会明确失败，不会创建 detached HEAD。

App 和 `git checkout-branch` 的“创建工作副本”会优先使用兼容旧版 Git 的 worktree 参数，并在创建后显式设置 upstream。只有 Git 完全不支持 `worktree` 子命令时才回退为独立 clone；权限、fetch、分支或目录错误不会触发静默回退。JSON 结果项通过 `checkoutMode` 返回实际模式，发生回退时额外返回 `fallbackReason`。

## Projects

```bash
rdevtool --json projects list
rdevtool --json projects add --key demo-web --name "Demo Web" --repo-path /path/to/demo-web --git-url https://git.example.com/demo-web.git
rdevtool --json projects update demo-web --category "营销" --repo-path /path/to/demo-web
rdevtool --json projects set-command demo-web --kind dev --command "npm run dev" --cwd /path/to/demo-web --env VITE_ENV=local
rdevtool --json projects set-command demo-web --kind build --command "npm run build" --cwd /path/to/demo-web --output-dir /path/to/demo-web/dist
rdevtool --json projects build-target-add demo-web --key standard --label "标准部署" --adapter jenkins --action-kind deploy --profile default --job "Demo/demo-web" --output-dir /path/to/demo-web/jenkins-artifacts
rdevtool --json projects build-target-add demo-web --key package --label "本地打包" --adapter r_series_package
rdevtool --json projects build-param-add demo-web standard --key ENV_PROFILE --label "环境" --kind select --option uat3 --option pre --default uat3 --required
rdevtool --json projects build-param-add demo-web standard --key IS_GRAY --label "灰度" --kind boolean --true-value 是 --false-value 否 --default 否
rdevtool --json projects build-param-update demo-web standard IS_GRAY --optional --default 是
rdevtool --json projects build-param-delete demo-web standard IS_GRAY
rdevtool --json projects build-target-update demo-web standard --label "主部署" --output-dir /path/to/demo-web/jenkins-artifacts
rdevtool --json projects build-target-update demo-web standard --clear-output-dir
rdevtool --json projects build-target-delete demo-web standard
rdevtool --json projects delete demo-web
rdevtool --json projects show imop-admin
rdevtool --json projects branch imop-admin
rdevtool --json projects branches imop-admin
rdevtool --json projects envs imop-admin --target vke
rdevtool --json projects options imop-admin --target vke
```

项目列表受当前工作区过滤。`add/update/delete/set-command/build-target-*` 会写入全局 `projects.toml`，不受当前工作区过滤；如果新增项目需要出现在某个普通工作区里，再用 `workspace scope <workspace> --project <project>` 纳入范围。`target-*` 和 `target-param-*` 仍是兼容别名。

## Build

`build` 是通用构建入口。当前 adapter：

| adapter | 行为 |
| --- | --- |
| `jenkins` | 触发 Jenkins `buildWithParameters`，返回队列和构建地址 |
| `local_command` | 在本机执行构建目标命令 |
| `r_series_package` | 面向 R 系列项目的本地打包 adapter，默认复用 `[projects.build]` |

```bash
rdevtool --json build targets imop-admin
rdevtool --json build plan imop-admin --target vke --env uat3 --branch env-uat3-vke
rdevtool --json build run imop-admin --target vke --env uat3 --branch env-uat3-vke
rdevtool --json build status --queue-url "http://jenkins/queue/item/1/"
rdevtool --json build status --build-url "http://jenkins/job/demo/1/"
rdevtool --json build history --project imop-admin --limit 12
```

额外参数：

```bash
rdevtool --json build plan imop-admin --target vke --set IS_GRAY=否 --set IS_BUILD_ADMIN=是
rdevtool --json build plan rdevtool --target package --set platform=macos --set profile=release
rdevtool --json build run rdevtool --target package --set build_command="npm run build"
```

本地 adapter 的命令解析顺序：`--set build_command=...`、target 的 `job_name`、`[projects.build].command`、默认 `npm run build`。`cwd` 默认取 `[projects.build].cwd` 或 `repo_path`，也可用 `--set build_cwd=...` 覆盖。产物目录按 `--set build_output_dir=...`、target `artifact.output_dir`、`[projects.build].output_dir` 依次解析。Jenkins target 也可声明产物目录，但只作为 rDevTool 元数据，不会传给 Job。`build plan` 会返回 `command`、`cwd`、`outputDir`；`build run` 的 `status` 是进程退出码。

执行前先跑 `build plan`。如果目标的 `action_kind` 是 `deploy` 或 `release`，仍按高风险动作处理。

R 系列应用常用配置：

```bash
rdevtool --json projects set-command rdevtool --kind dev --command "npm run dev" --cwd /Users/ikiru/Documents/r-series-public/rdevtool
rdevtool --json projects set-command rdevtool --kind build --command "npm run build" --cwd /Users/ikiru/Documents/r-series-public/rdevtool --output-dir /Users/ikiru/Documents/r-series-public/rdevtool/target/release/bundle
rdevtool --json projects build-target-add rdevtool --key web --label "前端构建" --adapter local_command --job "npm run web:build" --output-dir /Users/ikiru/Documents/r-series-public/rdevtool/web/dist
rdevtool --json projects build-target-add rdevtool --key package --label "本地打包" --adapter r_series_package
rdevtool --json projects build-param-add rdevtool package --key platform --label "系统" --kind select --default macos --option macos --option windows --option linux
rdevtool --json projects build-param-add rdevtool package --key profile --label "配置" --kind select --default release --option release --option debug
```

## Deploy

`deploy` 是 Jenkins 部署兼容入口，内部走同一套 build adapter。

```bash
rdevtool --json deploy targets imop-admin
rdevtool --json deploy plan imop-admin --target vke --env uat3 --branch env-uat3-vke
rdevtool --json deploy trigger imop-admin --target vke --env uat3 --branch env-uat3-vke
rdevtool --json deploy status --queue-url "http://jenkins/queue/item/1/"
rdevtool --json deploy status --build-url "http://jenkins/job/demo/1/"
rdevtool --json deploy history --project imop-admin --limit 12
```

额外 Jenkins 参数：

```bash
rdevtool --json deploy plan imop-admin --target vke --set IS_GRAY=否 --set IS_BUILD_ADMIN=是
```

执行部署前先跑 `deploy plan`。

## Git

```bash
rdevtool --json git current imop-admin
rdevtool --json git branches imop-admin
rdevtool --json git overview --project imop-admin --source feature-x --target release-y
rdevtool --json git merge --project imop-admin --source feature-x --target release-y
rdevtool --json git merge-many --project imop-admin --project message-center --source feature-x --target pre --plan
rdevtool --json git merge-many --project imop-admin --project message-center --source feature-x --target pre --target release
rdevtool --json git create --project imop-admin --source release-a --target feature-b
rdevtool --json git clone --project imop-admin --source release-a /tmp/imop-admin-release-a
rdevtool --json git switch --project imop-admin --target feature-x
rdevtool --workspace feature-a --json git switch --project imop-admin --target feature-x --repo-path /path/to/workspace/imop-admin
rdevtool --json git push-status --project imop-admin
rdevtool --json git push --project imop-admin --message "update"
rdevtool --json git history --project imop-admin --limit 12
rdevtool --json history operations --domain git --origin cli --limit 24
rdevtool --json history operations --domain build --origin cli --limit 24
rdevtool --json history operations --domain runtime --limit 24
rdevtool --json history operations --domain proxy --origin tray --limit 24
rdevtool --json history operations --domain link --origin app --limit 24
rdevtool history operations show <event-id>
```

`git merge-many` 可重复传入 `--project` 和 `--target`；使用 `--plan`（或 `--dry-run`）只刷新并检查远端源分支、目标分支。正式执行时，单个项目失败不会阻断其余项目，但 CLI 会返回非零退出码，JSON 同时保留完整的逐项结果。合并前先跑 `git overview`。推送前先跑 `git push-status`。

CLI 执行批量合并、创建分支、创建工作副本、切换分支和推送后，会把整次任务及逐项目结果写入共享分支历史；App 活动中心会自动同步这些记录，并保留具体失败原因和结构化重试参数。上述任务只要存在失败项就返回非零退出码；`--json` 同时返回 `ok: false`、稳定错误码和完整 `data`，脚本既能可靠判定失败，也能读取逐项目结果。App UI 触发的同类操作会即时记录，历史同步时自动去重。

App、CLI 和托盘触发的 Git、构建、Runtime、本地代理与 Link 操作会写入统一操作事件流。Runtime 记录启动、停止、重启和外部进程认领，本地代理记录启动、停止和重启；只读状态查询不会产生活动。构建从排队或运行开始记录，后续状态刷新会按同一事件 ID 更新为成功或失败；活动中心会保留关键状态、记录链接和失败原因，并与旧版 Git/构建历史自动去重。失败的 Git、Runtime、代理和 Link 活动会在参数可精确恢复且安全检查可执行时提供“检查并重试”；使用 App 暂不支持的 CLI 一次性启动覆盖时只保留诊断，不会生成不精确的重试动作。`history operations` 默认读取当前工作区，可用 `--domain git|build|runtime|proxy|link`、`--origin app|cli|tray`、`--project` 和 `--limit` 过滤；`history operations show <event-id>` 可查看单条事件及其结构化诊断数据。旧版 Git/构建历史继续保留，供对应页面展示详细记录与重放入口。

`git branches` 使用有界的分层读取：有本地仓库时先在 8 秒边界内执行非交互式 `fetch`，成功后读取本地/远端引用；刷新失败但已有引用时返回 `degraded + cached`，不会清空列表。无本地仓库时再依次尝试总时限 12 秒的 GitLab API 和 8 秒的 `git ls-remote`。JSON 保留兼容的 `branches` 字符串数组，并增加 `requested`、`effective`、`observed`、`status`、`evidence`、`risks`、`recommendedActions` 与 `branchOptions`，可据此区分实际来源、新鲜度、耗时和降级原因。

## Workflow

工作区“联动操作”与 CLI 读取同一份配置。Git、构建、Runtime 启停、代理启停和 Link 启停都使用各自已有的领域命令；可先查看计划，再按配置顺序执行：

```bash
rdevtool --json workflow chain list
rdevtool --workspace feature-a --json workflow chain list
rdevtool --json workflow chain show <chain-id>
rdevtool --json workflow chain plan <chain-id>
rdevtool --json workflow chain run <chain-id>
rdevtool --json workflow chain run <chain-id> --follow --timeout-secs 900
```

`workflow chain run` 严格按配置顺序执行，任一步失败后停止后续步骤，并返回本次 `runId`、已完成步骤、失败步骤、退出码和原命令输出。每一步仍使用原领域 CLI 执行器，并将同一 `runId`、流程名称和步骤名称写入统一操作事件；App 活动中心会把它们分组，工作区面板也能恢复 CLI 触发的进度与结果。停用的联动默认不可运行；确需执行时可为 `plan` 或 `run` 增加 `--force`。

## Navigation

```bash
rdevtool --json navigation path
rdevtool --json navigation list --limit 24
rdevtool --json navigation search Jenkins --limit 8
rdevtool --json navigation open --name "Jenkins"
rdevtool --json navigation open --query "智能营销"
rdevtool --json navigation add --category "R 系列" --name "rDevTool" --kind directory --path /Users/ikiru/Documents/r-series-public/rdevtool
rdevtool --json navigation add --category "办公平台" --name "Jenkins" --kind url --url http://127.0.0.1:8080
rdevtool --json navigation update --category "办公平台" --name "Jenkins" --url http://127.0.0.1:8787
rdevtool --json navigation delete --category "办公平台" --name "Jenkins"
```

入口列表和搜索结果受当前工作区过滤。
`navigation add/update/delete` 会写入全局 `navigation.toml`；如果当前工作区不是全局并且没有包含该入口，需要再用 `workspace scope` 把入口纳入当前范围。

## Link

```bash
rdevtool --json link path
rdevtool --json link list
rdevtool --json link inspect local-debug
rdevtool --json link show local-debug
rdevtool --json link plan local-debug
rdevtool --json link check local-debug
rdevtool --json link run local-debug
rdevtool --json link stop local-debug
rdevtool --json link --source workspace-feature-a plan local-debug
rdevtool --json link save --key local-debug --name "本地联调" --workspace feature-a --project imop-admin --step type=proxy.start,profile=api-proxy
rdevtool --json link attach local-debug --workspace feature-a --category "工具" --name "本地联调"
rdevtool --json link delete local-debug
rdevtool --json link migrate local-debug --from default --to workspace-feature-a --dry-run
rdevtool --json link migrate local-debug --from default --to workspace-feature-a
rdevtool --json link migrate local-debug --from default --to workspace-feature-a --copy
rdevtool --json link migrate local-debug --from default --to workspace-feature-a --replace --dry-run
```

Link 默认使用当前工作区为 `link` 能力选择的配置源；Proxy 和 Runtime 依赖分别使用该工作区对应能力的配置源。`--source` 只临时覆盖本次 Link 文件，不修改持久化偏好。`migrate/move` 必须显式指定 `--from` 和 `--to`，并建议先执行 `--dry-run`。

`link inspect` 会返回当前文件状态、执行计划和所有配置源中的同名 Link 位置。当前源缺失时不会跨源回退执行；计划和活动记录中的 `sourceContext` 会保留实际 Link、Proxy、Runtime 来源，保证稍后重试仍使用原上下文。

`link migrate` 默认移动单个 Link，`--copy` 保留来源，`--replace` 才允许覆盖内容不同的同名目标。迁移使用有序双文件锁、原子写入、回读校验和失败回滚，不会替换目标文件中的其他 Link。

`link plan` 是默认预览入口。对于 `runtime.start` 和 `runtime.focus`，计划步骤会携带与 Agent Context 相同的 `runtime` 快照，直接给出请求参数、有效 Runtime Target、daemon 观测、状态和证据；配置错误或不安全的运行态会进入步骤风险并阻止执行。`link check` 的 runtime 启动步骤同时返回 `preflight` 与该快照，页面聚焦步骤也返回有效 `focusUrl`。`link run` / `link stop` 只在用户明确要求执行链路时使用，并会记录一条整链活动，包含完成、失败、跳过统计及失败步骤；`link check` 保持只读，不产生活动。

## Config Source

配置源命令对资源入口、链路、代理和运行配置通用，选择结果按当前工作区和能力分别保存。

```bash
rdevtool --json config-source list
rdevtool --json config-source show default
rdevtool --json config-source compare default team-local
rdevtool --json config-source copy team-local --id team-local-copy --name "团队本地联调副本"
rdevtool --json config-source use team-local --capability resource
rdevtool --json config-source use team-local --capability proxy
```

`list` 会同时返回四种能力的当前偏好和全部可用来源。`compare` 只返回文件存在性、大小与一致性摘要，不返回配置内容。`copy` 会创建新的自建来源；可通过 `--base-dir <absolute-path>` 指定空目录，留空则自动创建独立目录。自建来源的目录、文件映射和能力范围也可以在桌面端“配置源管理”中维护。

## Proxy

代理命令默认使用当前工作区为 `proxy` 能力选择的配置源。`proxy source` 可查看或切换来源，后续 profile、规则、运行状态和诊断命令都会使用同一来源。

```bash
rdevtool --json proxy path
rdevtool --json proxy source
rdevtool --json proxy source --set default
rdevtool --json proxy list
rdevtool --json proxy status
rdevtool --json proxy start default
rdevtool --json proxy restart default
rdevtool --json proxy stop default
rdevtool --json proxy show default
rdevtool --json proxy add --name "本地代理" --listen-port 8787
rdevtool --json proxy update default --listen-port 8788
rdevtool --json proxy delete default
rdevtool --json proxy export default --output ./proxy-default.json
rdevtool --json proxy import --file ./proxy-default.json --workspace r-series
rdevtool --json proxy rule-list --profile default
rdevtool --json proxy rule-add --profile default --name "转发 API" --path-prefix /api --action forward --target-base-url http://127.0.0.1:3000
rdevtool --json proxy rule-add --profile default --name "Mock 用户" --path-prefix /api/user --action mock --status 200 --body '{"ok":true}' --header content-type=application/json
rdevtool --json proxy rule-add --profile default --name "阻断调试" --url-contains debug=true --action block --status 403
rdevtool --json proxy rule-update "转发 API" --priority 10 --request-header x-devtool=true
rdevtool --json proxy rule-delete "阻断调试"
rdevtool --json proxy diagnose --profile default --method POST --url /api/user
rdevtool --json proxy verify --profile default --url /api/user --expect-status 200
```

App 与 CLI 共用同一个代理守护进程。`proxy status` 会区分 rDevTool 管理的进程和外部端口占用；旧版本守护进程会标记为待升级，并在下一次 `start` 或 `restart` 时受控替换。不要停止 `managed=false` 的外部监听器。

`proxy status/start/stop/restart`、`proxy diagnose` 和 `proxy verify` 的 JSON 都包含同一 `operation` 契约：`requested`、`effective`、`observed`、`lifecycle`、`status`、`evidence`、`risks`、`managedArtifacts` 和 `recommendedActions`。`lifecycle` 分开报告 `configured`、`started`、`matched`、`verified`，阶段状态使用 `confirmed|partial|predicted|notConfirmed|notEvaluated`，不能把配置值或静态规则推演当成真实观测。

`diagnose` 的规则命中只会标记为 `matched.state=predicted`。`verify` 会给单次请求增加内部关联标记；该标记不参与规则匹配、不会转发到上游，只用于关联持久化 Proxy 事件。只有 rDevTool daemon 归属、端口监听、实际事件规则和 HTTP 断言全部成立时，`operation.lifecycle.verified.confirmed=true`。顶层旧字段 `verified` 继续表示状态码/正文断言是否通过，供兼容调用方使用，严格端到端结论应读取 `operation.status.success`。

代理配置问题优先看：

```bash
rdevtool --json doctor
```

`doctor` 同时报告配置源注册表、当前工作区实际选择的代理源、对应文件路径、运行时版本和端口状态。

## Runtime

Runtime 命令使用当前激活工作区覆盖后的项目配置。运行目标的目录优先级是 Debug Profile `cwd`、`[projects.dev].cwd`、`repo_path`；相对目录都基于当前工作区生效后的 `repo_path` 解析。`runtime inspect` 和 `runtime preflight` 的 `target` 会返回实际命令、目录、端口、启动页及其来源。

Debug Profile 可以覆盖一个项目的独有运行目标：

```bash
rdevtool --json projects debug-profile-add demo-web --key feature-a --label "Feature A" --cwd worktrees/feature-a --focus-url http://127.0.0.1:4173/debug --expect-port 4173 --ready-probe-path /health --ready-expect-status 204 --ready-timeout-ms 90000
rdevtool --json projects debug-profile-update demo-web feature-a --ready-probe-url http://127.0.0.1:4173/health
rdevtool --json projects debug-profile-update demo-web feature-a --clear-cwd --clear-focus-url --clear-ready-probe
```

`cwd` 可指向同一仓库的 worktree、副本或子应用。`focusUrl` 用于该档案的页面聚焦和端口回退；`readyProbe` 仅控制 `runtime wait --until http-verified` 的 URL/路径、成功状态码和超时。三者扩展现有 Debug Profile，不新增重复的 Runtime Surface 配置模型。

```bash
rdevtool --json runtime profiles
rdevtool --json runtime profile-show local-browser
rdevtool --json runtime inspect --project demo-web
rdevtool --json runtime preflight --project demo-web --runtime-profile local-browser --expect-port 4173
rdevtool --json runtime start --project demo-web --runtime-profile local-browser --expect-port 4173 --env MODE=local
rdevtool --json runtime status --project demo-web
rdevtool --json runtime status --project demo-web --run-id <run-id>
rdevtool --json runtime list
rdevtool --json runtime list --running-only
rdevtool --json runtime stop --project demo-web
rdevtool --json runtime stop --project demo-web --run-id <run-id>
rdevtool --json runtime restart --project demo-web --runtime-profile local-browser --expect-port 4173 --env MODE=local
rdevtool --json runtime diagnose --project demo-web --run-id <run-id>
rdevtool --json runtime adopt --project demo-web --pid 4242
rdevtool --json runtime focus --project demo-web
rdevtool --json runtime log --project demo-web --kind dev --current
rdevtool --json runtime log --project demo-web --kind dev --run-id <run-id>
rdevtool --json runtime log --project demo-web --tail 300 --errors-only
rdevtool --json runtime log --project demo-web --tail 500 --grep "ECONNRESET"
rdevtool --json runtime wait --project demo-web --run-id <run-id> --until listener-ready
rdevtool --json runtime wait --project demo-web --run-id <run-id> --until http-verified --probe-path /health --expect-status 204
```

`restart` 接受与 `start` 相同的启动参数，先按当前工作区有效的项目/Debug Profile 候选目录定位 daemon 会话，再以本次参数启动。`status`、`stop`、`diagnose` 和 `wait` 不再假定默认项目目录；可用 `--run-id` 精确选择 Debug Profile 独有目录下的会话。`stop` 只操作经过 daemon 状态验证的项目进程组，不会按端口查找或终止进程；当当前工作区候选目录内有多个运行会话时，不带 `--run-id` 的停止/重启会拒绝猜测。

`diagnose` 返回 daemon diagnosis；需要更完整的启动条件与联调状态时，再配合 `runtime preflight` 和 `runtime inspect`。`adopt` 仅在 PID、cwd、命令和监听端口身份都能验证时接管外部进程；身份不一致时会拒绝，不会把任意 PID 伪装成受管运行时。

`runtime log --current` 只返回最新会话标记之后的日志；`--run-id` 可读取指定历史会话。`--tail`（兼容旧名 `--max-lines`）先限制读取尾部行数，再由 `--grep`、`--errors-only` 和可选的 `--case-sensitive` 做筛选；响应同时报告文件字节数、扫描行数和命中行数。运行日志在项目下次启动或重启时按默认 32 MB 阈值轮转并保留有限归档，不会为轮转强制中断当前进程。

`runtime wait` 分别报告 `processStarted`、`listenerReady` 和 `httpVerified`。命令行 `--probe-url/--probe-path/--expect-status/--timeout-ms` 优先于会话启动时持久化的 Debug Profile `readyProbe`；未配置状态码时默认接受 200–399。响应采用 `requested/effective/observed` 和 `status/evidence/risks/managedArtifacts/recommendedActions`，TCP 监听不会被描述成 HTTP 已验证。

跨配置域诊断可使用 `rdevtool --workspace <key> --json doctor --project <project> --debug-profile <profile>`。Doctor 会尊重命令级工作区、返回当前执行文件/源码身份与受管存储健康，并复用 Runtime preflight；代理自环是 error，同一端点同时被进程代理与显式应用环境变量引用是带证据的 warning，不会从端口名称推断某一种代理软件。

生命周期命令的 JSON `command` 名固定为 `runtime.status`、`runtime.list`、`runtime.stop`、`runtime.restart`、`runtime.adopt` 和 `runtime.diagnose`。不带 `--json` 时会输出适合终端阅读的状态摘要。

## Managed Artifacts

```bash
rdevtool --json artifacts list
rdevtool --json artifacts list --workspace feature-a --project demo-web
rdevtool --json artifacts list --all-workspaces --kind runtimeState
rdevtool --json artifacts cleanup-plan --workspace feature-a
rdevtool --json artifacts cleanup-plan --artifact-id artifact-0123456789abcdef
rdevtool --json agent context --for artifacts --compact
```

`artifacts list` 默认使用当前工作区，从 `workspace.projectInstances[].managed`、Runtime daemon 状态和内部 `proxy-runtime` 目录派生统一台账，不再维护另一份容易漂移的注册文件。`workspaceConfig`、`workspaceProjectInstance`、`runtimeState`、`runtimeDaemonLog`、内部 `runtime-logs` 下的 `runtimeLog`，以及 `proxyState`、`proxyDaemonLog`、`proxyStopRequest`、`proxyLock`、`proxyEventLog` 可以进入 `observed.artifacts`；普通 existing 实例、workspace root、resource directory、worklog、Proxy 配置文件，以及内部目录之外的日志只进入 `observed.references`。无法关联到可验证 Proxy state 的遗留会话文件保留在观测结果中，但不会进入可信 `managedArtifacts`。

桌面端可在“设置 → 受管产物”查看同一 Inventory 契约，支持当前/全部工作区范围、刷新和本地搜索。该视图没有删除或清理执行入口。

`artifacts cleanup-plan` 是只读安全计划，固定返回 `effective.executionSupported=false`。活动工作区、Runtime 或 Proxy daemon，工作区根目录之外的项目实例、非直属目录、脏 Git 工作树和无法验证归属的路径会被标记为 `blocked`；工作区配置、跨会话运行日志和 Proxy 事件历史标记为 `reviewRequired`。当前没有 `artifacts cleanup` 命令，不应把计划结果转换成手工递归删除。

`agent context --for artifacts --compact` 复用同一 Inventory 和 cleanup-plan 判定生成适合 Agent 交接的紧凑摘要。它不会返回逐条路径，也不会开放清理执行；需要定位具体产物时，按 `recommendedActions` 再运行带同一工作区/项目边界的 `artifacts list`。

## Web Actions

Web Actions 通过 Chrome DevTools Protocol 操作用户明确选择的浏览器目标：

```bash
rdevtool --json web-actions path
rdevtool --json web-actions list --scope default --url https://example.test/app
rdevtool --json web-actions targets
rdevtool --json web-actions open --url https://example.test/app
rdevtool --json web-actions run --action refresh-dashboard --target <target-id> --param mode=full
rdevtool --json web-actions script --target <target-id> --file ./action.js --param mode=full
```

`list` 读取当前配置源的动作定义，`targets` 只返回可连接的调试目标，`open` 打开目标页面。`run` 执行已登记动作；`script` 只能在用户明确要求执行脚本时使用，且 `--script`、`--file`、`--stdin` 三种来源只能选择一个。不要把包含 cookie、token 或私有页面数据的脚本和输出写入仓库或活动记录。

## Notes

```bash
rdevtool --json notes list --limit 24
rdevtool --json notes search "构建"
rdevtool --json notes index --project imop-admin --limit 12
rdevtool --json notes file-search "代理" --project imop-admin --limit 6
rdevtool --json notes get <id>
rdevtool --json notes create --title "构建记录"
rdevtool --json notes save <id> --title "构建记录" --content "..."
rdevtool --json notes save <id> --title "构建记录" --file ./note.md
rdevtool --json notes save <id> --title "构建记录" --stdin
rdevtool --json notes delete <id>
```

`notes list/search/get/create/save/delete` 操作兼容保留的 SQLite 全局便笺；应用内知识库与 `notes index/file-search` 使用应用数据目录下 `notes/inbox/`、`notes/projects/<project>/`、`notes/playbooks/` 和 `notes/environments/` 的 Markdown。Markdown 是长期知识事实源；应用只负责检索、预览、模板新建和调用外部编辑器。文件检索不跟随符号链接、不读取超过 512 KB 的单篇笔记，只返回标题、路径、作用域、相关度和最多 240 字摘要。`notes save` 只能选择 `--content`、`--file`、`--stdin` 其中一种内容来源。

## History

```bash
rdevtool --json history build --project imop-admin --limit 12
rdevtool --json history merge --project imop-admin --limit 12
rdevtool --json history operations --domain link --limit 24
rdevtool --json history operations show <event-id>
rdevtool --json history replay-plan <build-history-id>
rdevtool --json history replay-run <build-history-id>
```

历史记录按当前工作区过滤。`history operations` 是 App、CLI 与托盘共享的统一事件流；`show` 返回单条事件的来源、状态、关联历史和结构化 payload。`replay-plan` / `replay-run` 是旧版构建历史的兼容重放入口，仍要先计划再执行。Git、Runtime、代理和 Link 的失败重试由活动中心根据精确参数与当前安全检查生成；无法精确恢复的一次性 CLI 覆盖只提供诊断。`history deploy` 仍是 Jenkins 部署历史的兼容入口。

## Legacy Aliases

早期顶层命令仍保留兼容，例如 `list`、`show`、`plan`、`trigger`、`merge`。新脚本和 AI 使用应优先选择领域命令：`projects`、`build`、`git`、`workspace`、`navigation`、`proxy`、`agent`。
