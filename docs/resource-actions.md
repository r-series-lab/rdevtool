# 参数化 Action

参数化 Action 用于把资源入口、参数表单和实际执行解耦。资源入口只保存稳定的 Action Key，Action 定义统一保存在当前资源配置源的 `actions.toml`。

## 资源入口

```toml
[[categories.entries]]
name = "预演批量部署"
kind = "tool"
tool = "action"
tool_key = "preview-deploy"
tool_action = "run"
note = "选择项目后执行预演部署"
```

旧的 `kind = "script"` 入口继续按原方式直接启动脚本，不会自动获得参数表单。需要参数、校验、日志和结果状态的脚本应迁移为 Action。

## Action 定义

```toml
schema_version = 1

[[actions]]
key = "preview-deploy"
name = "预演批量部署"
description = "选择具有 preview Jenkins 目标的项目。"
effect = "remote_write"

[actions.execution]
mode = "plan_apply"
plan_ttl_seconds = 300

[actions.runner]
type = "process"
program = "/bin/zsh"
args = ["scripts/preview-deploy.sh"]
input = "json_stdin"
output = "structured_json"
timeout_seconds = 900

[[actions.params]]
key = "projects"
label = "项目"
type = "project_multi"
required = true

[actions.params.source]
type = "projects"
deploy_target = "preview"
adapter = "jenkins"

[[actions.params]]
key = "branchOverride"
label = "统一分支覆盖"
type = "branch"
description = "仅覆盖声明了分支参数的项目；留空则沿用各项目配置。"

[[actions.params]]
key = "environment"
label = "环境"
type = "select"
options = ["preview-1", "preview-2"]
default = "preview-1"

[[actions.params]]
key = "planOnly"
label = "仅检查计划"
type = "boolean"
default = true
role = "dry_run"
```

脚本路径相对 `actions.toml` 所在目录解析。执行器不会拼接 Shell 命令；`program` 和 `args` 固定来自受信配置，用户参数通过 JSON stdin 传递。

App 会携带同版本的 `rdevtool` CLI sidecar，并向脚本注入绝对路径：

```bash
"$RDEVTOOL_CLI" --json build plan "$project" --target preview
"$RDEVTOOL_CLI" --json build run "$project" --target preview
```

CLI 会从 `RDEVTOOL_CONFIG_PATH` 和 `RDEVTOOL_WORKSPACE_KEY` 读取当前 App 的配置与工作区上下文。脚本无需查找 CLI，也不应硬编码安装路径。仓库中的 [`examples/resource-actions/actions.toml`](../examples/resource-actions/actions.toml) 和 [`preview-deploy.sh`](../examples/resource-actions/preview-deploy.sh) 展示了“全部项目先 plan，通过后再逐个 run”的完整编排；该脚本需要本机提供 `jq`。

不需要脚本且参数完全固定的 CLI 入口也可以直接声明逻辑程序名：

```toml
[actions.runner]
type = "process"
program = "@rdevtool"
args = ["--json", "info"]
```

`@rdevtool` 在界面展示和执行前解析为 sidecar 的绝对路径。开发环境可回退到同版本的已安装 CLI；`RDEVTOOL_CLI_PATH` 可用于显式覆盖，版本不一致时会拒绝执行。

## CLI 开发闭环

Action 可以脱离 App 完成定位、检查和运行，CLI 与 App 复用同一套配置加载、参数解析、动态项目选项、脱敏和结构化结果校验：

```bash
rdevtool --workspace r-series action path
rdevtool --workspace r-series action list
rdevtool --workspace r-series action show release-local-port
rdevtool --workspace r-series action validate
rdevtool --workspace r-series action plan release-local-port --set port=1420
rdevtool --workspace r-series action plan-show <plan-id>
rdevtool --workspace r-series action apply --plan-id <plan-id> --yes
```

`--source` 接受正式配置源 ID，也接受工作区 Key 作为简写。开发尚未安装的 Action 时，可以通过 `--file ./actions.toml` 直接指定配置文件。

`action run` 支持三种参数输入，`--set` 会优先按 JSON 值解析，无法解析时作为普通字符串，并覆盖 JSON 中的同名参数：

```bash
rdevtool action run example --params-json '{"port":1420}'
rdevtool action run example --params-file ./params.json
printf '%s' '{"token":"..."}' | rdevtool action run example --params-json -
rdevtool action run example --set enabled=true --set projects='["portal"]'
```

不要把 secret 放进命令行参数或 Shell 历史，使用文件或 stdin。`local_write`、`remote_write` 和 `destructive` Action 默认要求显式传入 `--yes`；如果 Action 声明了 `dry_run` 角色且本次解析后的值为 `true`，则不需要 `--yes`。

声明 `execution.mode = "plan_apply"` 后，非 dry-run 的 `action run` 会拒绝直接执行。先用 `action plan` 运行只读计划阶段，使用返回的 `planId` 检查实际目标，再通过 `action apply --plan-id <plan-id> --yes` 执行。apply 自动复用计划中保存的非敏感有效参数；secret 不会写入计划，必须用 `--params-file` 或 stdin 再次提供。计划会校验工作区、配置源、Action 配置、参数指纹和有效期，并且默认只能消费一次。

`action validate` 会对 `effect = "remote_write"` 且仍使用 `execution.mode = "direct"` 的 Action 输出 `resource_action.remote_write_direct` 告警。告警不会阻断兼容脚本；应优先把高风险远程写入逐步迁移到 `plan_apply`。

## 输入协议

脚本从 stdin 读取一个 JSON 对象：

```json
{
  "schemaVersion": 1,
  "action": {
    "key": "preview-deploy",
    "name": "预演批量部署",
    "effect": "remote_write"
  },
  "operation": {
    "id": "action-...",
    "startedAt": "2026-08-03T00:00:00Z",
    "phase": "plan",
    "planId": null,
    "planEvidence": null
  },
  "params": {
    "projects": ["portal", "admin"],
    "branchOverride": "release/preview",
    "environment": "preview-1"
  }
}
```

`operation.phase` 为 `run`、`plan` 或 `apply`。apply 阶段的 `planEvidence` 是核心持久化并限制大小的结构化计划结果；Runner 必须使用其中的 PID/启动时间、提交 SHA、远程参数等证据重新核对易变化目标，不能仅因为存在 `planId` 就执行写入。

示例脚本提供 `rdev_action_param_bool <payload> <key> <default>` 读取布尔参数。它会保留显式的 `false`，并仅在参数缺失或为 `null` 时使用默认值；不要使用 `.params.<key> // true`，因为 jq 的 `//` 会把 `false` 当作回退条件。

执行环境同时提供 `RDEVTOOL_ACTION_KEY`、`RDEVTOOL_ACTION_RUN_ID` 和 `RDEVTOOL_ACTION_INPUT=json_stdin`。stdout、stderr 和退出码会回传到结果弹窗与 Activity；输出有大小上限，`secret` 参数值会在回传文本中脱敏。

App 执行 Action 时会按 operation ID 接收受限长度的实时输出，并允许从弹窗停止正在运行的进程组。取消结果明确返回 `cancelled = true`，同时以 `resource_action_cancelled` 写入操作历史。只要本次请求提供了任意 secret 参数，核心就不会发送原始实时输出；弹窗会在执行结束后展示统一脱敏的最终日志。

`run`、`plan` 和 `apply` 会以 `domain = "action"` 写入统一操作历史，运行态和终态共用同一个 operation ID。历史仅保存非 secret 参数、secret key 元数据、受限长度的输出和结构化结果，可用以下命令查询：

```bash
rdevtool --json history operations --domain action --limit 24
rdevtool --json history operations show <operation-id>
```

## 结构化输出协议

Runner 默认使用 `output = "text"`，与原有纯文本 Action 完全兼容。声明 `output = "structured_json"` 后，stdout 必须只包含一个结果对象；运行日志应写入 stderr：

```json
{
  "schemaVersion": 1,
  "summary": "计划检查完成，共 2 个项目",
  "items": [
    {
      "key": "portal",
      "label": "Portal",
      "status": "failed",
      "summary": "计划被阻断",
      "detail": "缺少必要部署参数",
      "url": "https://jenkins.example/job/portal",
      "parameters": [
        { "key": "env", "label": "环境", "value": "pre" }
      ]
    }
  ],
  "retry": {
    "param": "projects",
    "values": ["portal"]
  }
}
```

`items[].status` 支持 `success`、`warning`、`failed` 和 `skipped`。`retry` 是可选能力：参数必须是 `multi_select` 或 `project_multi`，重试值必须属于本次原始输入，App 和执行层都会再次校验。

远程写入出现含糊失败时不得提供 `retry`。批量部署示例只在 plan 阶段失败且尚未触发任何远程任务时开放失败项重试；部署触发失败后会停止后续项目并保留结果供人工检查。

## 参数类型

当前支持 `text`、`textarea`、`number`、`select`、`multi_select`、`boolean`、`branch`、`project`、`project_multi`、`file`、`directory`、`secret` 和 `hidden`。

参数可以声明通用约束。约束会同时传给表单控件，并由 Rust 执行层再次校验：

```toml
[[actions.params]]
key = "port"
label = "端口号"
type = "number"
required = true
min = 1
max = 65535
step = 1

[[actions.params]]
key = "name"
label = "名称"
type = "text"
min_length = 2
max_length = 40

[[actions.params]]
key = "targets"
label = "目标"
type = "multi_select"
options = ["alpha", "beta", "gamma"]
min_items = 1
max_items = 2
```

`min`、`max` 和 `step` 只用于 `number`；`min_length` 和 `max_length` 用于文本、分支、路径、secret 和 hidden；`min_items` 和 `max_items` 用于 `multi_select` 与 `project_multi`。配置类型不匹配、上下界颠倒或非正数步长会在 Action 加载阶段直接失败。

布尔参数可声明 `role = "dry_run"`。值为 `true` 时提交按钮显示“检查计划”，远程写入不弹确认；值为 `false` 时显示“开始执行”，并在执行前展示本次有效参数。角色是显式 Schema 元数据，不依赖 `planOnly` 等参数命名约定。

项目参数默认从当前工作区可见项目生成选项；可通过 `source.deploy_target`、`source.adapter` 和 `source.action_kind` 继续筛选。选项生成只使用 rDevTool 内建数据源，不会在打开弹窗时执行任意脚本。

统一分支覆盖应保持可选。脚本可先通过 `projects options <project> --target <target>` 检查项目是否声明了 `branch` 类型参数，仅对这些项目追加 `--branch`；未声明分支参数的项目继续使用自己的参数契约。留空时，CLI 按项目显式默认值或当前仓库分支解析。

## 执行约束

- `secret` 不允许配置默认值，也不会以原文保存到 Activity。
- `plan_apply` 要求 `output = "structured_json"`；计划结果至少包含一个实际目标项。
- 计划正文只保存非敏感有效参数；secret 仅参与带 planId 的指纹计算，apply 时必须再次提供。
- apply 在启动 Runner 前以事务方式消费计划。Runner 启动后出现含糊失败时不会自动恢复为可重试状态。
- Action 配置、参数 key、静态选项和动态选项会在执行前再次校验。
- 非零退出码作为一次有结果的失败返回，便于保留 stdout/stderr。
- 超时后会停止 Action 进程；Unix 平台同时终止该 Action 创建的进程组。Action 不应启动脱离进程组的后台任务。
- Jenkins 等远程写入由脚本通过 `$RDEVTOOL_CLI build plan/run` 调用，继续复用现有凭据、Crumb、参数映射和历史逻辑。

Action 层不增加 Jenkins 专属 Runner。批量场景先由脚本编排现有 CLI；当重复模式稳定后，可以在 CLI 内增加通用的 `build batch-plan/batch-run`，Action Schema 与参数弹窗无需变化。

高风险 Action 可采用 plan/apply 协议，完整信任边界见 [`resource-action-plan-apply.md`](resource-action-plan-apply.md)。未声明执行模式的单阶段 Action 与真实 dry-run 保持兼容，不使用隐式参数名模拟核心阶段。
