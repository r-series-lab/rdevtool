# Action Plan / Apply 设计边界

本文记录参数化 Action 已落地的两阶段执行协议边界，避免在脚本和界面中继续增加隐式约定。当前单阶段 Action 行为保持不变。

## 目标

- 高风险 Action 在确认前展示实际目标，而不只展示用户输入。
- apply 只能使用已经展示过且尚未过期的计划。
- App 与 CLI 共用计划记录、参数解析、配置指纹和结果协议。
- 不把 Action 扩展成 DAG、插件宿主或领域逻辑实现层。

## Schema 方向

Action 可选声明两阶段模式；未声明时继续直接运行现有 Runner。`plan_apply` 必须使用 `structured_json` 输出。

```toml
[actions.execution]
mode = "plan_apply"
plan_ttl_seconds = 300
```

同一个 Runner 在两种受信阶段运行，阶段信息由核心写入 `operation.phase`，不作为用户参数暴露：

```json
{
  "operation": {
    "phase": "plan",
    "planId": null,
    "planEvidence": null
  }
}
```

apply 阶段会额外携带核心保存的计划 ID 和有界计划证据。脚本必须重新核对易变化目标，例如 PID、进程启动时间、仓库提交或远程任务参数。

## 核心保存内容

计划记录写入 rDevTool 现有持久化存储，至少包含：

- `planId`、Action Key、工作区和配置源
- Action 配置指纹、解析后的有效参数指纹
- 结构化计划结果及目标证据
- 创建时间、过期时间、消费状态

secret 不进入计划正文或指纹明文；非敏感有效参数会保存以支持 `action apply <plan-id>` 精确复用，secret 必须再次提供。apply 校验配置、参数、工作区、过期时间和消费状态；任何一项变化都要求重新 plan。计划在启动 Runner 前通过 SQLite 事务单次消费，含糊失败不会自动释放消费状态。

## App 与 CLI

App 流程固定为“填写参数 → plan → 展示实际目标 → 确认 → apply”。CLI 提供对应的 `action plan <key>`、`action plan-show <plan-id>` 和 `action apply --plan-id <plan-id> --yes`，便于人工检查和自动化。

`destructive` 默认必须使用两阶段模式；对无法稳定识别目标的动作允许继续单阶段执行，但必须保留显式确认。远程 POST 等含糊失败不自动重试。

## 不纳入本阶段

- Action 间依赖和 DAG 编排
- 打开表单时执行任意脚本生成选项
- 宣称无法实际执行的文件系统或网络沙箱
- 自动重试含糊的远程写入或进程信号

批量部署继续由脚本编排 rDevTool CLI，释放端口继续由脚本核对监听进程；plan/apply 只负责可信交接和确认，不复制这些领域逻辑。
