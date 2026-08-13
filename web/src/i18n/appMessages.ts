import type { AppMessage } from "../app-types";
import type { Translate } from "./index";
import { translateInternalMessage } from "./internalMessages";

const APP_MESSAGE_SOURCE_TEMPLATES: Record<string, string> = {
  "health.status.ok": "正常",
  "health.status.warning": "需要关注",
  "health.snapshot.ok": "rDevTool 核心存储与当前可执行文件状态正常",
  "health.snapshot.warning": "发现 {count} 个需要关注的问题",
  "health.storage.runtimeLogs.label": "运行日志",
  "health.storage.proxyRuntime.label": "代理运行记录",
  "health.storage.browserProfile.label": "受控浏览器档案",
  "health.storage.notes.label": "知识笔记",
  "health.storage.storage.label": "应用数据库",
  "health.storage.detail": "{count} 个文件，共 {bytes} 字节",
  "health.risk.runtime_log_oversized.summary": "存在超过轮转阈值的运行日志",
  "health.risk.runtime_log_oversized.detail":
    "{path}（{bytes} 字节）将在对应项目下次启动或重启时轮转",
  "health.risk.binary_source_mismatch.summary":
    "当前可执行文件与本地源码版本不一致",
  "health.risk.storage_inspect_failed.runtimeLogs.summary":
    "无法完整统计运行日志",
  "health.risk.storage_inspect_failed.proxyRuntime.summary":
    "无法完整统计代理运行记录",
  "health.risk.storage_inspect_failed.browserProfile.summary":
    "无法完整统计受控浏览器档案",
  "health.risk.storage_inspect_failed.notes.summary":
    "无法完整统计知识笔记",
  "health.risk.storage_inspect_failed.storage.summary":
    "无法完整统计应用数据库",
  "health.action.review_runtime_logs.reason":
    "先查看日志归属与活动状态，再决定是否清理；活跃日志不会被直接删除",
  "health.action.check_agent_compatibility.reason":
    "核对当前 CLI 与 rDevTool Skill 的命令和能力契约，再决定是否更新",
  "proxy.diagnosis.status.matched": "已命中",
  "proxy.diagnosis.status.matchedNotListening": "规则命中但端口未监听",
  "proxy.diagnosis.status.notMatched": "未命中",
  "proxy.diagnosis.summary.matched": "请求会命中规则 {name}",
  "proxy.diagnosis.summary.matched_not_listening":
    "请求会命中规则 {name}，但代理端口当前未监听",
  "proxy.diagnosis.summary.not_matched": "没有启用规则会处理这个请求",
  "proxy.diagnosis.reason.rule_disabled": "规则已停用",
  "proxy.diagnosis.reason.method_any": "未限制 method",
  "proxy.diagnosis.reason.method_required": "需要 {required}，当前 {current}",
  "proxy.diagnosis.reason.url_any": "未限制 URL 包含内容",
  "proxy.diagnosis.reason.url_contains": "需要 URL 包含 {value}",
  "proxy.diagnosis.reason.path_any": "未限制 pathPrefix",
  "proxy.diagnosis.reason.path_prefix":
    "需要路径以 {required} 开头，当前 {current}",
  "proxy.diagnosis.reason.header_found": "找到请求头 {name}={value}",
  "proxy.diagnosis.reason.header_contains":
    "请求头 {name} 需要包含 {required}，当前 {current}",
  "proxy.diagnosis.reason.header_missing": "缺少请求头 {name}",
  "proxy.diagnosis.reason.header_any": "未限制请求头",
  "proxy.diagnosis.warning.profile_not_listening": "{url} 当前没有监听",
  "proxy.diagnosis.warning.no_enabled_rules": "该 profile 没有启用中的规则",
  "proxy.diagnosis.warning.no_rule_matched":
    "请求进入该 profile 后会走默认转发，不会命中规则动作",
  "proxy.diagnosis.warning.specific_rule_shadowed":
    "更具体的规则也能命中，但排序在 {selected} 之后：{shadowed}",
  "proxy.diagnosis.action.start_profile_first":
    "先启动该代理 profile，再验证请求是否进入代理。",
  "proxy.diagnosis.action.enable_or_create_rule":
    "启用至少一条规则，或创建新的转发/Mock/阻断规则。",
  "proxy.diagnosis.action.check_rule_conditions":
    "检查 pathPrefix、method、urlContains 和 header 条件。",
  "proxy.diagnosis.action.raise_specific_rule_priority":
    "把更具体的 pathPrefix 规则设置为更小的 priority。",
  "runtime.preflight.status.error": "需要修复",
  "runtime.preflight.status.warning": "可优化",
  "runtime.preflight.status.ok": "可启动",
  "runtime.preflight.summary.errors": "{errors} 个异常 · {warnings} 个关注项",
  "runtime.preflight.summary.warnings": "{warnings} 个关注项",
  "runtime.preflight.summary.ok": "关键链路正常",
  "runtime.preflight.check.status.ok": "正常",
  "runtime.preflight.check.status.warning": "关注",
  "runtime.preflight.check.status.error": "异常",
  "runtime.preflight.check.status.info": "信息",
  "runtime.preflight.check.title.debug_profile": "启动档案",
  "runtime.preflight.check.title.dev_command": "启动命令",
  "runtime.preflight.check.title.dev_cwd": "工作目录",
  "runtime.preflight.check.title.dev_dependencies": "启动依赖",
  "runtime.preflight.check.title.node_version": "Node 版本",
  "runtime.preflight.check.title.dev_port": "预期端口",
  "runtime.preflight.check.title.local_files": "本地文件",
  "runtime.preflight.check.title.local_file": "本地覆盖文件",
  "runtime.preflight.check.title.network_proxy": "Node 网络代理",
  "runtime.preflight.check.title.node_outbound_proxy": "Node 出网代理",
  "runtime.preflight.check.title.runtime_proxy": "本地代理服务",
  "runtime.preflight.check.title.local_api_proxy": "本地 API 代理",
  "runtime.preflight.check.title.debug_local_proxy": "启动档案本地 API 代理",
  "runtime.preflight.check.title.browser_proxy": "浏览器代理",
  "runtime.preflight.check.title.local_proxy_topology": "本地代理拓扑",
  "runtime.preflight.check.title.proxy_topology": "代理拓扑",
  "runtime.preflight.check.title.proxy_layers": "代理分层",
  "runtime.preflight.check.title.web_actions_browser": "网页动作受控浏览器",
  "runtime.preflight.check.title.focus_url": "启动页面",
  "runtime.preflight.check.title.http_ready_probe": "HTTP Ready 探测",
  "runtime.preflight.check.title.ready_detection": "Ready 检测",
  "runtime.preflight.check.title.after_ready_actions": "启动后动作",
  "runtime.preflight.detail.debug_profile.selected": "使用 {label} ({key})",
  "runtime.preflight.detail.debug_profile.missing": "启动档案不存在: {key}",
  "runtime.preflight.detail.debug_profile.default": "使用项目默认启动配置",
  "runtime.preflight.action.debug_profile.select_or_create":
    "重新选择一个可用启动档案，或在运行环境里创建。",
  "runtime.preflight.action.debug_profile.choose_for_capabilities":
    "需要 Node 版本、代理或受控浏览器时，建议选择启动档案。",
  "runtime.preflight.detail.dev_command.missing": "未配置 dev 命令",
  "runtime.preflight.detail.dev_command.empty": "dev.command 为空",
  "runtime.preflight.action.dev_command.configure":
    "在项目配置里补充 dev.command。",
  "runtime.preflight.action.dev_command.add_executable":
    "补充可执行启动命令，例如 npm run serve。",
  "runtime.preflight.detail.dev_cwd.unresolved": "无法确定 dev 工作目录",
  "runtime.preflight.detail.dev_cwd.not_directory": "不是目录: {path}",
  "runtime.preflight.detail.dev_cwd.missing": "目录不存在: {path}",
  "runtime.preflight.action.dev_cwd.configure":
    "配置 repo_path，或为 dev.cwd 指定绝对路径。",
  "runtime.preflight.action.dev_cwd.fix_path":
    "修正 dev.cwd 或项目 repo_path。",
  "runtime.preflight.action.dev_cwd.create_or_fix":
    "修正 dev.cwd，或先拉取/创建项目目录。",
  "runtime.preflight.detail.dev_dependencies.entry_missing":
    "启动入口不存在: {paths}",
  "runtime.preflight.detail.dev_dependencies.directory_missing":
    "依赖目录不存在: {path}",
  "runtime.preflight.action.dev_dependencies.install_or_link":
    "先安装依赖，或为工作区安全复用锁文件一致的源项目 node_modules。",
  "runtime.preflight.detail.node_version.missing":
    "启动命令使用 Node 工具，但没有发现明确版本线索",
  "runtime.preflight.action.node_version.add_hint":
    "建议在命令中使用 nvm use，或在项目目录放置 .nvmrc。",
  "runtime.preflight.detail.dev_port.invalid": "预期端口必须在 1-65535 之间",
  "runtime.preflight.detail.dev_port.available": "端口 {port} 可用",
  "runtime.preflight.detail.dev_port.occupied": "端口 {port} 已被占用",
  "runtime.preflight.detail.dev_port.occupied_by":
    "端口 {port} 已被 {owner} 占用",
  "runtime.preflight.action.dev_port.fix":
    "修正启动档案或本次启动参数中的预期端口。",
  "runtime.preflight.action.dev_port.stop_or_change":
    "停止占用进程，或为本次启动选择其他预期端口。",
  "runtime.preflight.detail.network_proxy.missing_url":
    "代理已启用，但 proxy_url 为空",
  "runtime.preflight.detail.network_proxy.unsupported_node_hook":
    "Node Hook 当前只支持 http:// 代理",
  "runtime.preflight.detail.network_proxy.configured.env_and_hook":
    "{url} · 环境变量 + Node Hook",
  "runtime.preflight.detail.network_proxy.configured.env":
    "{url} · 环境变量",
  "runtime.preflight.detail.network_proxy.configured.node_hook":
    "{url} · Node Hook",
  "runtime.preflight.detail.network_proxy.configured.no_injection":
    "{url} · 未注入",
  "runtime.preflight.detail.network_proxy.disabled": "未启用 Node 侧代理注入",
  "runtime.preflight.action.network_proxy.configure_or_disable":
    "补充 proxy_url，或关闭网络代理。",
  "runtime.preflight.action.network_proxy.use_http_or_disable_hook":
    "改用 http:// 本地代理，或关闭 Node Hook。",
  "runtime.preflight.action.network_proxy.enable_when_needed":
    "如果 dev server 代理接口出现 ENOTFOUND，可在启动档案启用网络代理。",
  "runtime.preflight.detail.runtime_proxy.bound": "运行环境绑定代理服务 {id}",
  "runtime.preflight.detail.runtime_proxy.missing_profile":
    "绑定的代理配置不存在: {id}",
  "runtime.preflight.detail.runtime_proxy.listening":
    "{name} 正在监听 {url}",
  "runtime.preflight.detail.runtime_proxy.external":
    "{name} 的端口由 {owner} 占用：{url}",
  "runtime.preflight.detail.runtime_proxy.stopped":
    "{name} 尚未监听 {url}",
  "runtime.preflight.detail.runtime_proxy.unavailable": "{detail}",
  "runtime.preflight.action.runtime_proxy.restore_or_rebind":
    "打开本地代理，恢复该配置或重新绑定运行环境。",
  "runtime.preflight.action.runtime_proxy.resolve_external":
    "先确认并释放外部监听，或调整代理服务端口。",
  "runtime.preflight.action.runtime_proxy.start_then_retry":
    "可先启动该代理，再重新执行启动预检。",
  "runtime.preflight.action.runtime_proxy.fix_source":
    "检查当前工作区的代理配置源，修复后重新预检。",
};

export function translateAppMessage(
  message: AppMessage | null | undefined,
  fallback: string,
  t: Translate,
): string {
  const sourceTemplate = message
    ? APP_MESSAGE_SOURCE_TEMPLATES[message.key]
    : undefined;
  if (!sourceTemplate) {
    return translateInternalMessage(fallback, t);
  }
  return t(sourceTemplate, message?.params);
}
