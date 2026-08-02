# AI Agent Usage

rDevTool 给 AI 的定位是本地开发工作台的稳定入口。AI 应通过 CLI 获取上下文、生成预览、再执行用户明确要求的动作。

## Skill

本机已提供专用 Skill：

```text
~/.codex/skills/rdevtool
```

触发场景包括：

- 查询当前工作区、项目、入口、代理、构建或分支状态。
- 生成构建、打包或 Jenkins 部署计划。
- 检查或重播构建/合并历史。
- 搜索或打开工作台入口。
- 让 AI 先理解当前 rDevTool 上下文再继续开发任务。

## Intake

先按任务选择最小上下文，不再固定运行全量检查：

```bash
rdevtool --json agent capabilities
rdevtool --json workspace show
rdevtool --json agent context --project <project> --for runtime --compact
rdevtool --json agent context --project <project> --for runtime --compact --debug-profile <profile>
rdevtool --json agent context --project <project> --for runtime --compact --include proxy
rdevtool --json agent context --for artifacts --compact
```

只读问答使用对应的 `show`、`inspect` 或源码；跨模块总览才使用 `info`；故障跨越多个配置域或配置写入后再运行 `doctor`。`info.identity` 用于确认当前执行文件、构建 commit 与本地源码是否一致；指定 `--workspace` 的 `doctor` 会使用该命令作用域，而不是 App 持久化的活动工作区。

`--include` 支持 `history,notes,navigation,proxy,projects,worklog`，其中 proxy 只表示配置绑定，`observed=false` 时不能当作监听或请求证据。Agent context schema v2 的 `fileNotes` 只注入最多 4 条非 README Markdown 摘要和路径；需要完整步骤时再读取命中文件。runtime 预设需要 `--project` 才会生成 `runtime.targets`：默认一次返回项目默认目标和各 Debug Profile；使用 `--debug-profile` / `--runtime-profile` 可只读取指定组合。

开发态可替换为：

```bash
cd /Users/ikiru/Documents/r-series-public/rdevtool
cargo run --quiet -- --json agent context --project <project> --for runtime --compact
```

## Agent 数据契约

存在配置解析或动态状态的命令逐步统一为：

- `requested`：调用方要求的值。
- `effective`：工作区、Profile 和命令行优先级解析后的实际值。
- `observed`：文件、Git、进程、端口、HTTP、浏览器或远端的真实观测。
- `status`、`evidence`、`risks`、`managedArtifacts`、`recommendedActions`：终态、证据、风险、本次创建且可管理的产物和后续动作。

顶层 `ok=true` 只表示 CLI 成功完成了这次查询或等待；业务目标是否完成必须读取 `data.status.success`。`managedArtifacts` 只记录 rDevTool 创建并具有明确生命周期的产物，不能因为某个已有目录被工作区引用，就推断 rDevTool 有权删除它。

磁盘或工作区清理请求可先运行 `agent context --for artifacts --compact` 获得按类型、归属和清理资格汇总；需要逐条证据时再运行 `artifacts list`，随后运行 `artifacts cleanup-plan`。Inventory 把可验证的工作区、Runtime 和 Proxy daemon 产物放在 `observed.artifacts`，把 root/resource/worklog、existing 实例和 Proxy 配置放在 `observed.references`；cleanup-plan 只返回 `eligible`、`reviewRequired`、`blocked` 和理由，当前固定为 `executionSupported=false`，不得据此直接执行删除。桌面端“设置 → 受管产物”读取同一台账，也保持只读。

`agent context --for runtime --compact`、桌面端项目 Runtime 详情与 Link runtime 步骤复用同一快照契约。每个目标都同时提供有效 `cwd`、`focusUrl`、`readyProbe` 和最多五条匹配当前工作区候选目录的 daemon 会话；配置值仍属于 `effective`，只有 daemon 状态属于 `observed`。`link plan` 可直接检查并展示该快照，`link check` 再把 runtime preflight 与快照一并返回。

统一操作事件使用 `origin`、`workspaceKey`、`domain`、`action`、`state`、关联历史与结构化 payload 表达 App、CLI 和托盘结果。它是诊断与重试依据，不代表所有动作都可直接重放；只有参数可精确恢复且当前检查通过时才可执行重试。

## Workspace Rules

- 默认尊重当前激活工作区。
- `system` 是全局视图，不是某个需求。
- 切换工作区前要确认用户意图。
- 切换后重新运行对应任务预设的 `agent context`。
- 创建需求工作区副本时，先执行 `workspace init-demand ... --copy-mode worktree|clone --dry-run`，核对 `effective.instanceDir`、`plannedActions` 和风险后再移除 `--dry-run`。
- `existing` 实例不属于 rDevTool；只有成功创建的 worktree/clone 才能以 `managed=true` 和 `managedArtifacts` 报告为托管产物。
- `agent context` 返回 `resourceDir`、`worklogAutoRecord`、工作日志路径和最近日志内容；优先使用这些稳定字段，不要猜测目录。
- rDevTool 会自动记录构建、Git、Runtime 和关键配置操作的最终结果；AI 仍应在完成有意义的优化、修复、决策或验证后，用 `workspace worklog-append` 补充人工语义记录。

```bash
rdevtool --json workspace list
rdevtool --json workspace show
rdevtool --json workspace use r-series
rdevtool --json workspace scope r-series --project rdevtool --navigation-category "R 系列"
rdevtool --json workspace worklog-append r-series --kind 优化 --summary "统一工作区工具栏" --detail "完成实现并通过前端构建。"
```

## Safe Action Rules

项目配置：

```bash
rdevtool --json projects add --key <project> --name "项目名" --repo-path /path/to/repo
rdevtool --json projects update <project> --category "分类"
rdevtool --json projects set-command <project> --kind dev --command "npm run dev" --cwd /path/to/repo
rdevtool --json projects set-command <project> --kind build --command "npm run build" --cwd /path/to/repo
rdevtool --json projects build-target-add <project> --key standard --label "标准部署" --adapter jenkins --action-kind deploy --profile default --job "Folder/job" --output-dir /path/to/artifacts
rdevtool --json projects build-target-add <project> --key package --label "本地打包" --adapter r_series_package
rdevtool --json projects build-param-add <project> standard --key ENV_PROFILE --label "环境" --kind select --option uat3 --default uat3 --required
```

只在用户明确要求修改配置时使用这些写命令。新增项目后，如果当前不是 `system` 工作区，要用 `workspace scope` 把项目纳入对应工作区。

构建：

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json build run <project> --target <target> --env <env> --branch <branch>
```

优先使用 `build plan` / `build run`。`deploy plan` / `deploy trigger` 是兼容入口。target 的 `artifact.output_dir` 是 rDevTool 产物元数据，不会作为 Jenkins 参数发送；`build plan` 会返回 `command`、`cwd` 和 `outputDir`，执行前要把这些关键项汇报清楚。只在用户明确要求构建、部署或发布时执行 `build run`；当目标 `actionKind` 是 `deploy` 或 `release` 时按高风险动作汇报。

R 系列应用配置：

```bash
rdevtool --json workspace show r-series
rdevtool --json projects show rdevtool
rdevtool --json build plan rdevtool --target web
rdevtool --json build plan rdevtool --target package --set platform=macos --set profile=release
```

新 R app 纳入工作台时，优先补 `projects add/update`、`projects set-command`、`web/package` target，再用 `workspace scope r-series --project <key>` 纳入工作区。

分支：

```bash
rdevtool --json git overview --project <project> --source <source> --target <target>
rdevtool --json git merge --project <project> --source <source> --target <target>
rdevtool --json git merge-many --project <project-a> --project <project-b> --source <source> --target <target> --plan
rdevtool --json git merge-many --project <project-a> --project <project-b> --source <source> --target <target>
```

多项目合并先执行带 `--plan` 的预检命令；只在用户明确确认后执行不带 `--plan` 的 `git merge-many`。任一项目失败时命令会返回非零退出码，仍需读取 JSON `data.items` 获取每个项目的结果。

推送：

```bash
rdevtool --json git push-status --project <project>
rdevtool --json git push --project <project> --message "..."
```

只在用户明确要求推送时执行 `git push`。

## Operation History And Retry

先读取失败事件，再决定是否重试：

```bash
rdevtool --json history operations --domain git --limit 24
rdevtool --json history operations --domain runtime --limit 24
rdevtool --json history operations show <event-id>
```

- Git 重试先重新读取仓库和工作树状态，不沿用过期判断。
- Runtime 重试重新解析当前工作区、Debug Profile、目录和 daemon 会话。
- Proxy 重试先确认配置源、受管 daemon 和端口归属。
- Link 重试先重新执行 `link check`，再按精确的 Link key 和来源执行。
- 一次性 CLI 覆盖、已脱敏参数或无法还原的外部状态只生成诊断，不猜测重试参数。

构建兼容历史可使用 `history replay-plan <id>`，只有用户确认计划后才使用 `history replay-run <id>`。

## Opening Resources

搜索后再打开：

```bash
rdevtool --json navigation search Jenkins --limit 8
rdevtool --json navigation open --name "Jenkins"
```

如果当前工作区搜不到，先说明可能是工作区过滤导致，再决定是否切到 `system` 或让用户指定工作区。

## Proxy

代理 CLI 支持按当前工作区查询，也支持 profile 级配置管理：

```bash
rdevtool --json config-source list
rdevtool --json config-source show default
rdevtool --json proxy list
rdevtool --json proxy source
rdevtool --json proxy status
rdevtool --json proxy diagnose --profile default --method GET --url /api/health
rdevtool --json proxy verify --profile default --url /api/health --expect-status 200
rdevtool --json proxy start default
rdevtool --json proxy restart default
rdevtool --json proxy stop default
rdevtool --json proxy show default
rdevtool --json proxy add --name "需求代理" --listen-port 8789 --workspace r-series
rdevtool --json proxy update default --listen-port 8788
rdevtool --json proxy export default --output ./proxy-default.json
rdevtool --json proxy import --file ./proxy-default.json --workspace r-series
rdevtool --json proxy rule-list --profile default
rdevtool --json proxy rule-add --profile default --name "Mock 用户" --path-prefix /api/user --action mock --status 200 --body '{"ok":true}'
```

先用 `proxy source` 确认实际配置源，再操作 profile。三个观测命令统一读取 `data.operation`：`status` 最多确认 configured/started，`diagnose` 的 matched 只能是静态推演产生的 `predicted`，`verify` 必须同时拿到受管 daemon、listener、带单次标记的 Proxy 事件和 HTTP 断言，才会返回 `operation.lifecycle.verified.confirmed=true`。顶层兼容字段 `verified` 只代表 HTTP 状态/正文断言，不应单独作为端到端证据。复杂规则批量迁移仍可使用桌面设置面板或 profile pack；只有用户明确要求时才直接编辑配置源对应的 `proxy.toml`。

不要把 token、password、cookie、Authorization header 或私钥作为 `--set`、`--env`、Web Action 参数、工作日志或活动摘要传入。长期凭据使用环境变量或本机私有配置；诊断结果只汇报“是否存在”，不回显值。

## Reporting

向用户汇报时只提与任务相关的信息：

- 当前工作区。
- 相关项目和入口。
- `doctor` 中会影响任务的 warning/error。
- 预览命令的关键结果。
- 下一步是否需要用户确认高风险动作。
