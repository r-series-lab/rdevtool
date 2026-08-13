export const EN_DIAGNOSTICS_MESSAGES: Record<string, string> = {
  "运行日志": "Runtime Logs",
  "代理运行记录": "Proxy Runtime Records",
  "受控浏览器档案": "Managed Browser Profile",
  "知识笔记": "Knowledge Notes",
  "应用数据库": "Application Database",
  "存在超过轮转阈值的运行日志":
    "Some runtime logs exceed the rotation threshold",
  "当前可执行文件与本地源码版本不一致":
    "The current executable does not match the local source revision",
  "rDevTool 核心存储与当前可执行文件状态正常":
    "rDevTool core storage and the current executable are healthy",
  "发现 {count} 个需要关注的问题":
    "Found {count} issue(s) that need attention",
  "无法完整统计{label}": "Could not fully inspect {label}",
  "{count} 个文件，共 {bytes} 字节": "{count} files, {bytes} bytes total",
  "{path}（{bytes} 字节）将在对应项目下次启动或重启时轮转":
    "{path} ({bytes} bytes) will rotate the next time its project starts or restarts",
  "无法完整统计运行日志": "Could not fully inspect Runtime Logs",
  "无法完整统计代理运行记录": "Could not fully inspect Proxy Runtime Records",
  "无法完整统计受控浏览器档案": "Could not fully inspect Managed Browser Profile",
  "无法完整统计知识笔记": "Could not fully inspect Knowledge Notes",
  "无法完整统计应用数据库": "Could not fully inspect Application Database",
  "先查看日志归属与活动状态，再决定是否清理；活跃日志不会被直接删除":
    "Review log ownership and activity before cleanup; active logs are never deleted directly",
  "系统诊断": "System Diagnostics",
  "可执行文件身份、受管数据占用与健康风险":
    "Executable identity, managed storage usage, and health risks",
  "工作区检查、可执行文件身份、受管数据占用与健康风险":
    "Workspace checks, executable identity, managed storage usage, and health risks",
  "环境检查": "Environment Checks",
  "检查范围": "Check Scope",
  "检查汇总": "Check Summary",
  "需关注": "Attention",
  "全部": "All",
  "错误": "Errors",
  "警告": "Warnings",
  "通过": "Passed",
  "检查失败": "Check failed",
  "需要处理": "Action required",
  "检查通过": "Check passed",
  "发现 {errorCount} 个错误和 {warningCount} 个警告":
    "Found {errorCount} errors and {warningCount} warnings",
  "发现 {count} 个需要关注的环境检查":
    "Found {count} environment checks that need attention",
  "环境检查均通过": "All environment checks passed",
  "共 {count} 项": "{count} checks",
  "工作区：{name} · 共 {count} 项": "Workspace: {name} · {count} checks",
  "没有需要关注的环境检查": "No environment checks need attention",
  "当前工作区的配置、路径和服务检查均通过。":
    "Configuration, path, and service checks all pass for this workspace.",
  "项目标识": "Project Identifiers",
  "项目仓库路径": "Project Repository Paths",
  "工作区偏好": "Workspace Preferences",
  "工作区目录": "Workspace Catalog",
  "工作区项目范围": "Workspace Project Scope",
  "配置源": "Configuration Sources",
  "代理配置源": "Proxy Configuration Source",
  "代理运行版本": "Proxy Runtime Versions",
  "代理配置": "Proxy Configuration",
  "代理工作区引用": "Proxy Workspace References",
  "代理监听端口": "Proxy Listening Ports",
  "本地数据库": "Local Database",
  "网页动作": "Web Actions",
  "执行文件与源码": "Executable and Source",
  "项目运行环境": "Project Runtime Environment",
  "检查项目配置是否可读取且格式有效。":
    "Check that the project configuration is readable and valid.",
  "为重复项目标识改用唯一值。": "Assign unique values to duplicate project identifiers.",
  "检查项目配置中的仓库路径是否存在。":
    "Check that repository paths in the project configuration exist.",
  "检查当前工作区偏好配置。": "Check the current workspace preferences.",
  "检查工作区目录中的配置文件。":
    "Check the configuration files in the workspace directory.",
  "移除工作区中不存在的项目引用。":
    "Remove references to projects that do not exist from the workspace.",
  "确认当前工作区仍存在且可读取。":
    "Confirm that the current workspace still exists and is readable.",
  "检查资源入口配置是否可读取。":
    "Check that the resource navigation configuration is readable.",
  "检查配置源登记及文件路径。":
    "Check configuration source registrations and file paths.",
  "检查当前工作区的代理配置源。":
    "Check the proxy configuration source for the current workspace.",
  "重启旧版本代理进程后重新检查。":
    "Restart outdated proxy processes, then run the checks again.",
  "检查代理配置格式与规则引用。":
    "Check the proxy configuration format and rule references.",
  "更新代理配置中的工作区引用。":
    "Update workspace references in the proxy configuration.",
  "确认代理监听端口未被其他进程占用。":
    "Confirm that no other process is using the proxy listening port.",
  "检查本地数据库路径和访问权限。":
    "Check the local database path and access permissions.",
  "检查网页动作配置是否可读取。":
    "Check that the web actions configuration is readable.",
  "确认当前执行文件来源与构建信息。":
    "Confirm the source and build metadata of the current executable.",
  "先确认日志不再活跃，再评估清理。":
    "Confirm that the log is inactive before evaluating cleanup.",
  "重新构建或安装与当前源码一致的执行文件。":
    "Build or install an executable that matches the current source.",
  "根据详情补齐项目运行环境配置。":
    "Complete the project runtime configuration using the check details.",
  "打开项目配置": "Open Project Configuration",
  "打开工作区偏好": "Open Workspace Preferences",
  "打开工作区目录": "Open Workspace Directory",
  "打开资源配置": "Open Resource Configuration",
  "打开配置源": "Open Configuration Sources",
  "打开代理配置": "Open Proxy Configuration",
  "打开网页动作配置": "Open Web Actions Configuration",
  "打开源码目录": "Open Source Directory",
  "打开执行文件": "Open Executable",
  "重新检查": "Recheck",
  "正在重新检查": "Rechecking",
  "重新检查完成": "Recheck Complete",
  "已解决 {count}": "Resolved {count}",
  "新增 {count}": "New {count}",
  "仍存在 {count}": "Remaining {count}",
  "已解决：{items}": "Resolved: {items}",
  "新增": "New",
  "仍存在": "Remaining",
  "刷新": "Refresh",
  "刷新系统诊断": "Refresh System Diagnostics",
  "复制诊断报告": "Copy Diagnostic Report",
  "已复制诊断报告": "Diagnostic Report Copied",
  "检查时间：{time}": "Checked: {time}",
  "正在收集本机状态": "Collecting local system status",
  "当前执行文件": "Current Executable",
  "受管数据": "Managed Data",
  "日志、代理事件、浏览器档案、知识文件与应用数据库。":
    "Logs, proxy events, browser profiles, knowledge files, and application databases.",
  "存储明细": "Storage Details",
  "技术详情": "Technical Details",
  "展开技术详情": "Expand Technical Details",
  "收起技术详情": "Collapse Technical Details",
  "建议动作": "Recommended Actions",
  "只读": "Read-only",
  "查看相关产物": "View Related Artifacts",
  "核对当前 CLI 与 rDevTool Skill 的命令和能力契约，再决定是否更新":
    "Verify the CLI and rDevTool Skill command contract before updating.",
  "需要关注": "Needs Attention",
  "最大文件：{path}（{size}）": "Largest file: {path} ({size})",
  "installed": "installed",
  "bundled": "bundled",
  "development": "development",
  "clean": "clean",
  "dirty": "dirty",
  "mismatch": "mismatch",
  "unknown": "unknown",
  "未创建": "Not Created",
  "{count} 个文件": "{count} files",
};
