export const EN_PROXY_MESSAGES: Record<string, string> = {
  "已命中": "Matched",
  "规则命中但端口未监听": "Rule Matched but Port Is Not Listening",
  "未命中": "Not Matched",
  "请求会命中规则 {name}": "The request will match rule {name}",
  "请求会命中规则 {name}，但代理端口当前未监听":
    "The request will match rule {name}, but the proxy port is not listening",
  "没有启用规则会处理这个请求":
    "No enabled rule will handle this request",
  "{url} 当前没有监听": "{url} is not listening",
  "该 profile 没有启用中的规则": "This profile has no enabled rules",
  "请求进入该 profile 后会走默认转发，不会命中规则动作":
    "The request will use default forwarding and will not match a rule action",
  "规则已停用": "Rule is disabled",
  "未限制 method": "Any method is allowed",
  "需要 {required}，当前 {current}": "Requires {required}; current: {current}",
  "未限制 URL 包含内容": "No URL content restriction",
  "需要 URL 包含 {value}": "URL must contain {value}",
  "未限制 pathPrefix": "No pathPrefix restriction",
  "需要路径以 {required} 开头，当前 {current}":
    "Path must start with {required}; current: {current}",
  "找到请求头 {name}={value}": "Found request header {name}={value}",
  "请求头 {name} 需要包含 {required}，当前 {current}":
    "Header {name} must contain {required}; current: {current}",
  "缺少请求头 {name}": "Missing request header {name}",
  "未限制请求头": "No request header restriction",
  "更具体的规则也能命中，但排序在 {selected} 之后：{shadowed}":
    "More specific rules also match but are ordered after {selected}: {shadowed}",
  "先启动该代理 profile，再验证请求是否进入代理。":
    "Start this proxy profile before verifying that requests reach it.",
  "启用至少一条规则，或创建新的转发/Mock/阻断规则。":
    "Enable at least one rule or create a forwarding, mock, or blocking rule.",
  "检查 pathPrefix、method、urlContains 和 header 条件。":
    "Check the pathPrefix, method, urlContains, and header conditions.",
  "把更具体的 pathPrefix 规则设置为更小的 priority。":
    "Give the more specific pathPrefix rule a smaller priority value.",
  "路径 / URL": "Path / URL",
  "{count} 个": "{count} items",
  "{count} 个 + 草稿": "{count} items + draft",
  "{count} 规则": "{count} rules",
  "{count} 请求": "{count} requests",
  "{count} 条规则匹配": "{count} matching rules",
  "{name} 启用状态": "{name} enabled state",
  "{visible} / {total} 条": "{visible} / {total} items",
  "保存服务": "Save Service",
  "保存规则": "Save Rule",
  "本地代理概览与配置": "Local Proxy Overview and Configuration",
  "编辑规则": "Edit Rule",
  "不支持代理": "Proxy Not Supported",
  "出站": "Outbound",
  "出站 {mode}": "Outbound: {mode}",
  "出站策略": "Outbound Strategy",
  "打开代理配置新增服务或导入代理包。":
    "Open Proxy Configuration to add a service or import a proxy pack.",
  "代理服务列表": "Proxy Service List",
  "代理服务配置列表": "Proxy Service Configuration List",
  "代理服务与规则": "Proxy Services and Rules",
  "代理服务未监听": "The proxy service is not listening",
  "代理服务由 rDevTool 管理并正在监听。":
    "The proxy service is managed by rDevTool and is listening.",
  "代理服务版本与当前应用不一致":
    "The proxy service version does not match the current app",
  "代理服务版本与当前应用不一致，停止后重新启动即可升级。":
    "The proxy service version does not match the current app. Stop and start it again to upgrade.",
  "代理端口由外部进程占用": "The proxy port is occupied by an external process",
  "代理规则列表": "Proxy Rule List",
  "代理名称不能为空": "Proxy name is required.",
  "代理配置": "Proxy Configuration",
  "代理请求记录": "Proxy Request Log",
  "代理收到请求后会显示在这里。":
    "Requests will appear here after the proxy receives them.",
  "代理中转": "Via Proxy",
  "导出代理包": "Export Proxy Pack",
  "导出选中": "Export Selected",
  "导入": "Import",
  "导入代理包": "Import Proxy Pack",
  "继续导出": "Continue Export",
  "导出的代理包会包含当前服务配置、规则、Header、Mock Body 和上游地址。请确认其中没有敏感信息。":
    "The exported pack contains the service configuration, rules, headers, mock body, and upstream addresses. Make sure it contains no sensitive information.",
  "导入会创建一个新的代理服务，并把包内规则归属到新服务，不会覆盖现有服务。":
    "Importing creates a new proxy service and assigns the packaged rules to it without overwriting existing services.",
  "第 {line} 行 header 名称无效": "Line {line}: invalid header name",
  "第 {line} 行缺少 header 名称或冒号":
    "Line {line}: missing header name or colon",
  "点击左侧请求查看头信息和响应内容。":
    "Select a request on the left to view its headers and response.",
  "调整搜索或筛选条件。": "Adjust the search or filter criteria.",
  "动作": "Action",
  "端口": "Port",
  "端口由 {owner} 占用，rDevTool 不会停止该进程。":
    "The port is occupied by {owner}. rDevTool will not stop that process.",
  "端口由非 rDevTool 进程监听":
    "The port is listening in a non-rDevTool process",
  "端口由外部进程占用，rDevTool 不会停止该进程。":
    "The port is occupied by an external process. rDevTool will not stop that process.",
  "端口监听中": "Port Listening",
  "端口未监听": "Port Not Listening",
  "方法": "Method",
  "服务": "Services",
  "服务配置": "Service Configuration",
  "复制到终端或项目启动档案里，让命令行请求走这个代理入口。":
    "Copy these into a terminal or project launch profile to route command-line requests through this proxy.",
  "关闭代理配置": "Close Proxy Configuration",
  "关闭请求面板": "Close Request Panel",
  "管理本地代理服务、默认转发和代理包。":
    "Manage local proxy services, default forwarding, and proxy packs.",
  "规则": "Rules",
  "规则名称": "Rule Name",
  "规则名称不能为空": "Rule name is required.",
  "规则配置": "Rule Configuration",
  "环境变量": "Environment Variables",
  "记录正文": "Capture Body",
  "继承默认": "Inherit Default",
  "监听地址": "Listen Address",
  "监听地址和端口不能为空": "Listen address and port are required.",
  "监听入口": "Listener",
  "仅这条规则走指定 HTTP/SOCKS 上游":
    "Use the specified HTTP/SOCKS upstream for this rule only",
  "可空。用于相对路径请求的默认目标；为空时按请求原目标转发。":
    "Optional. Used as the default target for relative paths; leave blank to forward to the original target.",
  "可空。作为服务默认出站代理；规则选择“继承默认”时使用。":
    "Optional. Used as the service's default outbound proxy when a rule inherits the default.",
  "控制请求面板里是否保存 Body 预览，Header 与基础信息会继续记录。":
    "Controls whether body previews are saved. Headers and basic request information are always recorded.",
  "例如 /mock-api": "For example, /mock-api",
  "路径改写": "Path Rewrite",
  "路径前缀": "Path Prefix",
  "没有被规则改写时使用；规则里的出站设置可以覆盖这里。":
    "Used when no rule rewrites the request; a rule's outbound setting can override it.",
  "没有匹配请求": "No Matching Requests",
  "每个请求/响应最多保留的正文预览大小。":
    "Maximum body preview retained for each request or response.",
  "名称": "Name",
  "默认直连": "Direct by Default",
  "默认转发": "Default Forwarding",
  "目标": "Target",
  "其他应用连接到这个本地地址后，请求会进入 rDevTool 代理服务。":
    "Requests enter the rDevTool proxy when another application connects to this local address.",
  "启动代理": "Start Proxy",
  "启用": "Enable",
  "启用规则": "Enable Rule",
  "清空": "Clear",
  "请求": "Requests",
  "请求记录": "Request Log",
  "请输入请求路径或 URL": "Enter a request path or URL.",
  "请先保存或取消当前代理改动，再切换配置源。":
    "Save or discard the current proxy changes before switching configuration sources.",
  "请先新建服务或导入代理包。":
    "Create a service or import a proxy pack first.",
  "请先在代理配置中新增服务": "Add a service in Proxy Configuration first",
  "请先在代理配置中新增服务。":
    "Add a service in Proxy Configuration first.",
  "请选择代理服务": "Select a proxy service.",
  "请选择服务": "Select a Service",
  "取消新建": "Cancel Creation",
  "任意": "Any",
  "筛选请求记录": "Filter Request Log",
  "删除“{name}”？": "Delete \"{name}\"?",
  "删除代理配置": "Delete Proxy Configuration",
  "删除“{name}”后，相关规则和记录也会被移除。":
    "Deleting \"{name}\" also removes its related rules and records.",
  "删除服务": "Delete Service",
  "删除规则": "Delete Rule",
  "上游代理": "Upstream Proxy",
  "上游地址": "Upstream URL",
  "使用服务配置里的上游代理；为空则直连":
    "Use the service's upstream proxy; connect directly when empty",
  "使用选中请求": "Use Selected Request",
  "刷新代理状态": "Refresh Proxy Status",
  "刷新请求记录": "Refresh Request Log",
  "刷新请求记录（打开时自动刷新）":
    "Refresh Request Log (auto-refreshes while open)",
  "搜索接口 / 路径 / 状态 / 规则":
    "Search endpoint / path / status / rule",
  "搜索请求记录": "Search Request Log",
  "隧道": "Tunnel",
  "停用": "Disable",
  "停用规则": "Disable Rule",
  "停止代理": "Stop Proxy",
  "为空则使用原请求地址": "Leave blank to use the original request URL",
  "未命名代理": "Unnamed Proxy",
  "外部进程占用，无法操作": "Occupied by an external process; actions are disabled",
  "外部占用": "External Occupancy",
  "下滑加载更多": "Scroll to Load More",
  "响应 Header": "Response Headers",
  "响应正文": "Response Body",
  "向左收起服务列表": "Collapse Service List",
  "新规则": "New Rule",
  "新建服务": "New Service",
  "新建规则": "New Rule",
  "匹配请求并决定转发、Mock 或阻断行为。":
    "Match requests and decide whether to forward, mock, or block them.",
  "新建服务或导入代理包后会显示在这里。":
    "Services will appear here after one is created or imported.",
  "新建规则后可转发、Mock 或阻断请求。":
    "Create rules to forward, mock, or block requests.",
  "选择请求": "Select a Request",
  "选择指定代理时，上游代理地址不能为空":
    "An upstream proxy address is required when using a specified proxy.",
  "延迟 ms": "Delay (ms)",
  "已关闭，只记录 URL、状态码、耗时和 Header。":
    "Disabled. Only URLs, status codes, duration, and headers are recorded.",
  "已开启，会保存请求与响应正文预览。":
    "Enabled. Request and response body previews are saved.",
  "优先级": "Priority",
  "运行中": "Running",
  "需要重启升级": "Restart to Upgrade",
  "暂无服务": "No Services",
  "暂无规则": "No Rules",
  "暂无请求记录": "No Request Log",
  "展开服务列表": "Expand Service List",
  "这个配置源不支持代理配置。":
    "This configuration source does not support proxy settings.",
  "这条规则不走任何上游代理":
    "This rule does not use an upstream proxy",
  "诊断": "Diagnose",
  "诊断请求路径或 URL": "Request Path or URL to Diagnose",
  "正文预览字节": "Body Preview Bytes",
  "正在加载代理配置…": "Loading Proxy Configuration…",
  "直连": "Direct",
  "只决定请求转发到哪里，不决定是否走代理。":
    "Controls where requests are forwarded, not whether a proxy is used.",
  "指定代理": "Specified Proxy",
  "指定上游代理": "Specified Upstream Proxy",
  "至少保留一个服务": "At least one service is required",
  "重置": "Reset",
  "转发": "Forward",
  "转发到": "Forward To",
  "状态码": "Status Code",
  "追加请求 Header": "Append Request Headers",
  "追加响应 Header": "Append Response Headers",
  "自定义匹配": "Custom Match",
  "阻断": "Block",
  "阻断响应": "Block Response",
  "Header 包含": "Header Contains",
  "Header 名": "Header Name",
  "URL 包含": "URL Contains",
};
