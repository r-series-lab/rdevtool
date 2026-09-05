# Security And Data Boundary

rDevTool 是本地开发工作台，不是密钥库、远端权限代理或隔离执行环境。它会读取本机仓库与配置，并在用户明确操作后启动进程、访问 Jenkins/GitLab、控制本地代理或连接浏览器调试目标。

## WebView And Tauri Permissions

生产 WebView 启用 Content Security Policy：默认只加载自身资源，IPC 只允许 Tauri 协议，图片可使用本地 asset/blob/data，脚本沿用 `self`，对象与 frame 被禁用。Material UI/Emotion 运行时需要注入样式，因此 `style-src` 保留 `'unsafe-inline'`；同时启用 `freezePrototype`。

主窗口 capability 当前只包含：

- Tauri core 默认能力
- 窗口拖动
- dialog 默认能力与 confirm

没有向 WebView 开放通用 shell 或文件系统权限。文件、进程、网络和配置动作由 Rust command 接收结构化参数后执行；新增权限时应按窗口和用途收窄，而不是扩展默认 capability。

## Credentials

- Jenkins 密码和 GitLab token 优先来自环境变量或本机私有配置。
- `info` / `doctor` 只应报告凭据是否存在，不回显值。
- 不要把 token、password、cookie、Authorization header 或私钥放进仓库模板、`--set`、`--env`、Web Action 参数、notes、工作日志或活动摘要。
- Web Actions 可以在用户选定的 CDP 页面执行已登记动作或脚本，只在用户明确要求时运行，并先确认目标页面与脚本来源。

## Local Data

配置默认位于系统应用配置目录，历史状态位于 `~/.rdevtool/rdevtool.sqlite`。SQLite 没有应用层加密，可能包含项目路径、分支、构建/合并记录、URL、操作诊断和非敏感参数。数据库使用 WAL 和只向前 schema migration；更高版本 schema 会被拒绝，避免旧应用隐式降级。

工作区 `managed=true` 只表示 rDevTool 创建并能验证生命周期的副本。`artifacts cleanup-plan` 固定为只读，普通 existing 仓库、工作区根、资料目录和外部日志不能据此删除。

## External Actions

- 合并前运行 `git overview`，推送前运行 `git push-status`。
- 构建、部署和发布先运行 `build plan` 或兼容 `deploy plan`。
- Runtime stop/restart 只操作 daemon 验证过的进程组，不按端口猜 PID。
- Proxy stop/restart 不操作 `managed=false` 的外部监听器。
- Link 先 `plan` / `check`，再 `run` / `stop`。
- 失败活动只有在参数可恢复且当前检查通过时才提供重试；一次性覆盖不做猜测。

## Distribution

当前 GitHub Release 产物是预览包。macOS 仅 ad-hoc signing，尚未 Developer ID 签名或 notarize；Windows 尚未 Authenticode 签名。每个目标生成 artifact manifest 和 SHA-256 校验和，但校验和不能替代平台签名。

正式渠道要求见 [RELEASE.md](../RELEASE.md)。发现安全问题时，先保留最小复现、受影响版本与数据边界，不要把真实凭据或私有配置附在 issue、日志或截图中。
