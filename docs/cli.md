# rDevTool CLI

rDevTool 的 CLI 是给脚本和 AI Agent 使用的稳定操作面。读取类命令和关键动作命令都应使用 `--json`。

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

## 启动检查

```bash
rdevtool --json info
rdevtool --json doctor
rdevtool --json agent capabilities
rdevtool --json agent context --limit 6
```

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
rdevtool --json workspace create marketing-rework --name "营销改造"
rdevtool --json workspace create clean-room --name "空工作区" --empty --no-switch
rdevtool --json workspace scope r-series --project rdevtool --project rterm
rdevtool --json workspace scope r-series --navigation-category "R 系列"
rdevtool --json workspace scope r-series --proxy-profile default
rdevtool --json workspace scope r-series --all-projects --all-navigation
```

`system` 是全局工作区，显示全部项目和入口。
`workspace scope` 会写入 `workspaces/<key>.toml`，并在指定 `--proxy-profile` 时更新 `proxy.toml` 中 profile 的工作区归属。

## Projects

```bash
rdevtool --json projects list
rdevtool --json projects add --key demo-web --name "Demo Web" --repo-path /path/to/demo-web --git-url https://git.example.com/demo-web.git
rdevtool --json projects update demo-web --category "营销" --repo-path /path/to/demo-web
rdevtool --json projects set-command demo-web --kind dev --command "npm run dev" --cwd /path/to/demo-web --env VITE_ENV=local
rdevtool --json projects set-command demo-web --kind build --command "npm run build" --cwd /path/to/demo-web --output-dir /path/to/demo-web/dist
rdevtool --json projects build-target-add demo-web --key standard --label "标准部署" --adapter jenkins --action-kind deploy --profile default --job "Demo/demo-web"
rdevtool --json projects build-target-add demo-web --key package --label "本地打包" --adapter r_series_package
rdevtool --json projects build-param-add demo-web standard --key ENV_PROFILE --label "环境" --kind select --option uat3 --option pre --default uat3 --required
rdevtool --json projects build-param-add demo-web standard --key IS_GRAY --label "灰度" --kind boolean --true-value 是 --false-value 否 --default 否
rdevtool --json projects build-param-update demo-web standard IS_GRAY --optional --default 是
rdevtool --json projects build-param-delete demo-web standard IS_GRAY
rdevtool --json projects build-target-update demo-web standard --label "主部署"
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

本地 adapter 的命令解析顺序：`--set build_command=...`、target 的 `job_name`、`[projects.build].command`、默认 `npm run build`。`cwd` 默认取 `[projects.build].cwd` 或 `repo_path`，也可用 `--set build_cwd=...` 覆盖。`build plan` 会返回 `command`、`cwd`、`outputDir`；`build run` 的 `status` 是进程退出码。

执行前先跑 `build plan`。如果目标的 `action_kind` 是 `deploy` 或 `release`，仍按高风险动作处理。

R 系列应用常用配置：

```bash
rdevtool --json projects set-command rdevtool --kind dev --command "npm run dev" --cwd /Users/ikiru/Documents/r-series-public/rdevtool
rdevtool --json projects set-command rdevtool --kind build --command "npm run build" --cwd /Users/ikiru/Documents/r-series-public/rdevtool --output-dir /Users/ikiru/Documents/r-series-public/rdevtool/target/release/bundle
rdevtool --json projects build-target-add rdevtool --key web --label "前端构建" --adapter local_command --job "npm run web:build"
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
rdevtool --json git merge-many --project imop-admin --source feature-x --target pre --target release
rdevtool --json git create --project imop-admin --source release-a --target feature-b
rdevtool --json git clone --project imop-admin --source release-a --destination /tmp/imop-admin-release-a
rdevtool --json git switch --project imop-admin --target feature-x
rdevtool --json git push-status --project imop-admin
rdevtool --json git push --project imop-admin --message "update"
rdevtool --json git history --project imop-admin --limit 12
```

合并前先跑 `git overview`。推送前先跑 `git push-status`。

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

代理配置问题优先看：

```bash
rdevtool --json doctor
```

`doctor` 同时报告配置源注册表、当前工作区实际选择的代理源、对应文件路径、运行时版本和端口状态。

## Runtime

Runtime 命令使用当前激活工作区覆盖后的项目配置。项目级生命周期命令优先取 `[projects.dev].cwd`；相对 `cwd` 基于 `repo_path` 解析，未配置 `cwd` 时回退到 `repo_path`，最终使用 canonical cwd 定位 daemon 状态。因此同一项目在不同工作区实例路径下拥有独立运行时身份。

```bash
rdevtool --json runtime profiles
rdevtool --json runtime profile-show local-browser
rdevtool --json runtime inspect --project demo-web
rdevtool --json runtime preflight --project demo-web --runtime-profile local-browser --expect-port 4173
rdevtool --json runtime start --project demo-web --runtime-profile local-browser --expect-port 4173 --env MODE=local
rdevtool --json runtime status --project demo-web
rdevtool --json runtime list
rdevtool --json runtime list --running-only
rdevtool --json runtime stop --project demo-web
rdevtool --json runtime restart --project demo-web --runtime-profile local-browser --expect-port 4173 --env MODE=local
rdevtool --json runtime diagnose --project demo-web
rdevtool --json runtime adopt --project demo-web --pid 4242
rdevtool --json runtime focus --project demo-web
rdevtool --json runtime log --project demo-web --kind dev
```

`restart` 接受与 `start` 相同的启动参数，并显式停止当前项目/cwd 对应的受管 daemon 后，再以本次参数启动。`stop` 只操作经过 daemon 状态验证的项目进程组，不会按端口查找或终止进程。

`diagnose` 返回 daemon diagnosis；需要更完整的启动条件与联调状态时，再配合 `runtime preflight` 和 `runtime inspect`。`adopt` 当前调用 core 后明确返回 `supported=false`；它不会把无法验证原始命令、环境、cwd 和进程组归属的现有 PID 伪装成受管运行时。

生命周期命令的 JSON `command` 名固定为 `runtime.status`、`runtime.list`、`runtime.stop`、`runtime.restart`、`runtime.adopt` 和 `runtime.diagnose`。不带 `--json` 时会输出适合终端阅读的状态摘要。

## Notes

```bash
rdevtool --json notes list --limit 24
rdevtool --json notes search "构建"
rdevtool --json notes get <id>
rdevtool --json notes create --title "构建记录"
rdevtool --json notes save <id> --title "构建记录" --content "..."
rdevtool --json notes save <id> --title "构建记录" --file ./note.md
rdevtool --json notes save <id> --title "构建记录" --stdin
rdevtool --json notes delete <id>
```

`notes save` 只能选择 `--content`、`--file`、`--stdin` 其中一种内容来源。

## History

```bash
rdevtool --json history build --project imop-admin --limit 12
rdevtool --json history merge --project imop-admin --limit 12
```

历史记录按当前工作区过滤。`history deploy` 仍是 Jenkins 部署历史的兼容入口。

## Legacy Aliases

早期顶层命令仍保留兼容，例如 `list`、`show`、`plan`、`trigger`、`merge`。新脚本和 AI 使用应优先选择领域命令：`projects`、`build`、`git`、`workspace`、`navigation`、`proxy`、`agent`。
