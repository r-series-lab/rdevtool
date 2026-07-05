# AI Agent Usage

rDevTool 给 AI 的定位是本地开发工作台的稳定入口。AI 应通过 CLI 获取上下文、生成预览、再执行用户明确要求的动作。

## Skill

本机已提供专用 Skill：

```text
/Users/ikiru/.codex/skills/rdevtool
```

触发场景包括：

- 查询当前工作区、项目、入口、代理、构建或分支状态。
- 生成构建、打包或 Jenkins 部署计划。
- 检查或重播构建/合并历史。
- 搜索或打开工作台入口。
- 让 AI 先理解当前 rDevTool 上下文再继续开发任务。

## Intake

AI 接到 rDevTool 相关任务后应先运行：

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent context --limit 6
```

开发态可替换为：

```bash
cd /Users/ikiru/Documents/r-series-public/rdevtool
cargo run --quiet -- --json info
cargo run --quiet -- --json doctor
cargo run --quiet -- --json agent context --limit 6
```

## Workspace Rules

- 默认尊重当前激活工作区。
- `system` 是全局视图，不是某个需求。
- 切换工作区前要确认用户意图。
- 切换后重新运行 `agent context`。

```bash
rdevtool --json workspace list
rdevtool --json workspace show
rdevtool --json workspace use r-series
rdevtool --json workspace scope r-series --project rdevtool --navigation-category "R 系列"
```

## Safe Action Rules

项目配置：

```bash
rdevtool --json projects add --key <project> --name "项目名" --repo-path /path/to/repo
rdevtool --json projects update <project> --category "分类"
rdevtool --json projects set-command <project> --kind dev --command "npm run dev" --cwd /path/to/repo
rdevtool --json projects set-command <project> --kind build --command "npm run build" --cwd /path/to/repo
rdevtool --json projects build-target-add <project> --key standard --label "标准部署" --adapter jenkins --action-kind deploy --profile default --job "Folder/job"
rdevtool --json projects build-target-add <project> --key package --label "本地打包" --adapter r_series_package
rdevtool --json projects build-param-add <project> standard --key ENV_PROFILE --label "环境" --kind select --option uat3 --default uat3 --required
```

只在用户明确要求修改配置时使用这些写命令。新增项目后，如果当前不是 `system` 工作区，要用 `workspace scope` 把项目纳入对应工作区。

构建：

```bash
rdevtool --json build plan <project> --target <target> --env <env> --branch <branch>
rdevtool --json build run <project> --target <target> --env <env> --branch <branch>
```

优先使用 `build plan` / `build run`。`deploy plan` / `deploy trigger` 是兼容入口。本地 adapter 的 `build plan` 会返回 `command`、`cwd` 和 `outputDir`，执行前要把这些关键项汇报清楚。只在用户明确要求构建、部署或发布时执行 `build run`；当目标 `actionKind` 是 `deploy` 或 `release` 时按高风险动作汇报。

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
```

只在用户明确要求合并时执行 `git merge`。

推送：

```bash
rdevtool --json git push-status --project <project>
rdevtool --json git push --project <project> --message "..."
```

只在用户明确要求推送时执行 `git push`。

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
rdevtool --json proxy list
rdevtool --json proxy show default
rdevtool --json proxy add --name "需求代理" --listen-port 8789 --workspace r-series
rdevtool --json proxy update default --listen-port 8788
rdevtool --json proxy export default --output ./proxy-default.json
rdevtool --json proxy import --file ./proxy-default.json --workspace r-series
rdevtool --json proxy rule-list --profile default
rdevtool --json proxy rule-add --profile default --name "Mock 用户" --path-prefix /api/user --action mock --status 200 --body '{"ok":true}'
```

复杂规则批量迁移仍可使用桌面设置面板或 profile pack；只有用户明确要求时才直接编辑 `proxy.toml`。

## Reporting

向用户汇报时只提与任务相关的信息：

- 当前工作区。
- 相关项目和入口。
- `doctor` 中会影响任务的 warning/error。
- 预览命令的关键结果。
- 下一步是否需要用户确认高风险动作。
