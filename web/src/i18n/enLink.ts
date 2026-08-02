export const EN_LINK_MESSAGES: Record<string, string> = {
  "{count} 步": "{count} steps",
  "{count} 个参数": "{count} parameters",
  "{count} 个扩展步骤会按原顺序保留。":
    "{count} extension steps will be preserved in their original order.",
  "{count} 个步骤阻止重试": "{count} steps blocked retry",
  "{count} 条匹配": "{count} matches",
  "完成 {completedCount} / 失败 {failureCount} / 跳过 {skippedCount}":
    "{completedCount} completed / {failureCount} failed / {skippedCount} skipped",
  "CLI Link run 暂不打开浏览器页面；可使用 runtime focus 或 App 查看。":
    "CLI Link run does not open the browser page yet; use runtime focus or the app to view it.",
  "CLI detached runtime 暂无 Link stop 所有权语义，未执行停止。":
    "CLI detached runtime has no Link stop ownership semantics yet, so stop was not executed.",
  "按链路类型生成对应配置界面。":
    "Generate the appropriate configuration form for the selected link type.",
  "保留扩展步骤 {type}": "Preserved extension step {type}",
  "版本不兼容": "Incompatible Version",
  "保存后会从 v{sourceVersion} 升级为 v{targetVersion}。":
    "Saving will upgrade from v{sourceVersion} to v{targetVersion}.",
  "保存链路": "Save Link",
  "保存中": "Saving",
  "本地覆盖文件不会在 Link stop 中自动删除。":
    "Local override files are not automatically deleted during Link stop.",
  "本地覆盖文件不会由 Link CLI 直接写入；启动 runtime 时由调试配置应用。":
    "The Link CLI does not write the local override file directly; the debug configuration applies it when starting the runtime.",
  "本地覆盖文件由运行调试配置在启动前应用。":
    "The runtime debug configuration applies the local override file before launch.",
  "本地调试链路": "Local Debug Link",
  "本地覆盖文件": "Local Override File",
  "本地覆盖文件、代理服务、项目运行配置组合。":
    "Combines a local override file, proxy service, and project runtime profile.",
  "本地覆盖文件和项目运行步骤需要选择项目":
    "A project is required for local override and project runtime steps.",
  "编辑链路工具": "Edit Link Tool",
  "不绑定工作区": "Don't Bind Workspace",
  "不指定": "Not Specified",
  "不支持的 Link 执行模式：{mode}": "Unsupported Link execution mode: {mode}",
  "代理 {name}": "Proxy {name}",
  "代理 profile 不存在，无法检查监听。":
    "Proxy profile does not exist, so listening cannot be checked.",
  "代理 profile 不存在，无法启动。":
    "Proxy profile does not exist, so it cannot be started.",
  "代理 profile 不存在，无法停止。":
    "Proxy profile does not exist, so it cannot be stopped.",
  "代理 profile 不存在：{profile}": "Proxy profile does not exist: {profile}",
  "代理检查": "Proxy Check",
  "代理步骤需要选择代理服务": "The proxy step requires a proxy service.",
  "代理动作": "Proxy Action",
  "代理服务": "Proxy Service",
  "代理链路": "Proxy Link",
  "代理链路需要选择代理服务": "A proxy link requires a proxy service.",
  "代理端口由非 rDevTool 进程占用，无法安全接管。":
    "The proxy port is occupied by a non-rDevTool process and cannot be safely claimed.",
  "代理端口已被外部进程占用 {url}":
    "Proxy port is occupied by an external process {url}",
  "代理配置有效，可以启动 {url}":
    "Proxy configuration is valid and can start {url}",
  "代理配置源尚未就绪，请稍后重试":
    "The proxy configuration source is not ready. Try again shortly.",
  "代理启动失败：{reason}": "Proxy start failed: {reason}",
  "代理尚未启动：{url}": "Proxy is not started: {url}",
  "代理尚未启动，期望监听 {url}":
    "Proxy is not started; expected to listen on {url}",
  "代理已停止：{name}": "Proxy stopped: {name}",
  "代理已由共享守护进程启动：{url}":
    "Proxy started by the shared daemon: {url}",
  "代理正在监听 {url}": "Proxy is listening on {url}",
  "代理停止失败：{reason}": "Proxy stop failed: {reason}",
  "单次启动命令": "One-time Start Command",
  "动作 {name}": "Action {name}",
  "检查并重新停止": "Check and Stop Again",
  "检查并重新启动": "Check and Start Again",
  "检查代理监听与规则命中": "Check proxy listening and rule matching",
  "检查结果为空，未执行重试": "Check result is empty; retry was not run",
  "检查联调链路": "Check Integration Chain",
  "检查通过": "Check passed",
  "检查通过，可以安全重试": "Check passed. It is safe to retry.",
  "覆盖文件路径": "Override File Path",
  "该链路使用 v{sourceVersion}，当前应用仅支持到 v{targetVersion}。":
    "This link uses v{sourceVersion}, but the app only supports up to v{targetVersion}.",
  "工作区 {name}": "Workspace {name}",
  "记录项目运行动作，实际启动前仍会先展示计划。":
    "Records the project runtime action. A plan will still be shown before launch.",
  "记录需要准备的本地覆盖文件，只生成计划，不直接修改仓库文件。":
    "Records the local override file to prepare. This only generates a plan and does not modify repository files.",
  "检查代理": "Check Proxy",
  "可不绑定工作区。": "Binding a workspace is optional.",
  "来自当前可见的代理服务。": "From the currently visible proxy services.",
  "来自运行配置源 {source}；留空时继承 Debug Profile。":
    "From runtime source {source}; leave blank to inherit the Debug Profile.",
  "来自运行配置源 {source}。": "From runtime source {source}.",
  "链路类型": "Link Type",
  "链路名称": "Link Name",
  "链路名称不能为空": "Link name is required",
  "链路配置": "Link Configuration",
  "联调链路已启动": "Integration chain started",
  "联调链路已停止": "Integration chain stopped",
  "联调链路启动失败": "Integration chain start failed",
  "联调链路停止失败": "Integration chain stop failed",
  "联调链路检查未通过": "Integration chain check did not pass",
  "留空时继承 Debug Profile。": "Leave blank to inherit the Debug Profile.",
  "留空时使用档案或项目命令": "Leave blank to use the profile or project command.",
  "请先保存或关闭当前链路改动": "Save or close the current link changes first",
  "请先保存或关闭当前链路改动，再切换配置源。":
    "Save or close the current link changes before switching configuration sources.",
  "使用项目默认": "Use Project Default",
  "网页动作链路": "Web Action Link",
  "网页动作链路需要选择 Web Action": "A Web Action link requires a Web Action.",
  "未识别界面配置 {profile}，当前按 {fallback} 展示。":
    "Unrecognized UI profile {profile}; displaying it as {fallback}.",
  "无法从运行配置源 {source} 读取运行配置：{reason}":
    "Could not load runtime profiles from {source}: {reason}",
  "无法读取链路 {key}：{reason}": "Could not load link {key}: {reason}",
  "未命名步骤": "Unnamed Step",
  "项目 {name}": "Project {name}",
  "项目不存在：{project}": "Project does not exist: {project}",
  "项目启动": "Project Launch",
  "项目启动失败：{reason}": "Project start failed: {reason}",
  "新建链路工具": "New Link Tool",
  "已解析打开页面 {url}；CLI 检查模式不执行打开动作。":
    "Resolved page {url}; CLI check mode does not open pages.",
  "已保存 {name}，包含 {count} 个步骤。": "Saved {name} with {count} steps.",
  "已保存 {name}，包含 {stepCount} 个步骤，{warningCount} 条提示":
    "Saved {name} with {stepCount} steps and {warningCount} notices.",
  "引用代理 profile，后续可执行启动、检查或诊断。":
    "References a proxy profile for subsequent start, check, or diagnostics.",
  "引用已有 Web Action，并声明打开、执行或检查动作。":
    "References an existing Web Action and specifies whether to open, run, or check it.",
  "运行环境": "Runtime Environment",
  "运行前检查失败：{reason}": "Runtime preflight failed: {reason}",
  "预期端口": "Expected Port",
  "预期端口必须在 1-65535 之间": "Expected port must be between 1 and 65535",
  "源 {name}": "Source {name}",
  "确认本地覆盖文件": "Confirm Local Override File",
  "确认本地覆盖文件 {path}": "Confirm local override file {path}",
  "确认项目 {project} 使用 {path} 作为本地覆盖文件":
    "Confirm project {project} uses {path} as the local override file",
  "运行配置": "Runtime Profile",
  "运行配置源不能为空": "Runtime configuration source is required",
  "运行配置源尚未就绪，请检查提示后重试":
    "The runtime configuration source is not ready. Check the notice and try again.",
  "暂不选择代理": "Don't Select a Proxy Yet",
  "暂不选择项目": "Don't Select a Project Yet",
  "暂无可引用网页动作。": "No Web Actions are available to reference.",
  "占用时停止启动，避免自动换端口。":
    "Stop launch if the port is occupied instead of automatically switching ports.",
  "计划处理网页动作": "Plan web action handling",
  "计划处理网页动作 {action}": "Plan handling web action {action}",
  "计划打开项目调试页面": "Plan opening the project debug page",
  "计划打开项目调试页面 {url}":
    "Plan opening the project debug page {url}",
  "计划启动代理 {name}": "Plan starting proxy {name}",
  "计划启动代理 {name}，监听 {url}":
    "Plan starting proxy {name}, listening on {url}",
  "计划启动代理服务": "Plan starting proxy service",
  "计划启动项目 {project}": "Plan starting project {project}",
  "计划启动项目 {project}，cwd={cwd}":
    "Plan starting project {project}, cwd={cwd}",
  "计划启动项目运行环境": "Plan starting project runtime",
  "计划校验未通过，已跳过执行。":
    "Plan validation did not pass, so execution was skipped.",
  "计划用调试配置 {profile} 启动项目 {project}":
    "Plan starting project {project} with debug profile {profile}",
  "计划用调试配置 {profile} 启动项目 {project}，cwd={cwd}":
    "Plan starting project {project} with debug profile {profile}, cwd={cwd}",
  "计划用运行环境 {profile} 启动项目 {project}":
    "Plan starting project {project} with runtime profile {profile}",
  "计划用运行环境 {profile} 启动项目 {project}，cwd={cwd}":
    "Plan starting project {project} with runtime profile {profile}, cwd={cwd}",
  "这是旧版链路，保存后会升级为 v{version}。":
    "This is a legacy link. Saving will upgrade it to v{version}.",
  "缺少 action，无法定位网页动作。":
    "Missing action, so the web action cannot be located.",
  "缺少 path，无法定位本地覆盖文件。":
    "Missing path, so the local override file cannot be located.",
  "缺少 profile，无法定位代理服务。":
    "Missing profile, so the proxy service cannot be located.",
  "缺少 profile，无法检查代理服务。":
    "Missing profile, so the proxy service cannot be checked.",
  "缺少 project。": "Missing project.",
  "缺少 project，无法定位要聚焦的项目。":
    "Missing project, so the project to focus cannot be located.",
  "缺少 project，无法定位运行项目。":
    "Missing project, so the project runtime cannot be located.",
  "缺少 project，无法确认本地覆盖文件属于哪个项目。":
    "Missing project, so the local override file's project cannot be confirmed.",
  "缺少 type，无法识别步骤类型。":
    "Missing type, so the step type cannot be identified.",
  "缺少步骤类型": "Missing step type",
  "缺少项目，无法启动 runtime。": "Missing project, so runtime cannot be started.",
  "缺少项目，无法执行运行前检查。":
    "Missing project, so runtime preflight cannot be run.",
  "正在读取代理服务...": "Loading proxy services...",
  "正在读取工作区运行配置...": "Loading workspace runtime profiles...",
  "正在读取链路配置...": "Loading link configuration...",
  "正在执行重试前检查": "Running pre-retry check",
  "启动失败": "Start failed",
  "启动联调链路": "Start Integration Chain",
  "只记录代理启动或检查，适合把代理作为独立入口。":
    "Only records proxy startup or checking, suitable for using a proxy as a standalone entry.",
  "只引用已有网页动作，具体脚本和请求配置仍在网页动作面板维护。":
    "References existing web actions only. Maintain script and request settings in the Web Actions panel.",
  "至少选择一个链路步骤": "Select at least one link step",
  "停止失败": "Stop failed",
  "停止联调链路": "Stop Integration Chain",
  "警告：{warning}": "Warning: {warning}",
  "请在 App 中停止 Link，或用运行日志定位后手动停止明确归属的进程。":
    "Stop the Link in the app, or use runtime logs to locate and manually stop a clearly owned process.",
  "打开页面": "Open Page",
  "打开页面动作未在 Link CLI 中执行。":
    "The open-page action was not executed in the Link CLI.",
  "打开页面步骤已识别，CLI 检查模式不执行打开动作。":
    "Open-page step recognized; CLI check mode does not execute open actions.",
  "打开网页动作": "Open Web Action",
  "执行网页动作": "Run Web Action",
  "该步骤类型尚未接入 CLI 检查器。":
    "This step type is not yet connected to the CLI checker.",
  "该步骤类型尚未接入 CLI 执行器。":
    "This step type is not yet connected to the CLI executor.",
  "暂不支持的步骤类型：{type}": "Step type not supported yet: {type}",
  "重试前检查": "Pre-retry Check",
  "重试前检查失败": "Pre-retry check failed",
  "扩展步骤": "Extension Step",
  "自动继承": "Inherit Automatically",
  "Link 会记录该工作区。": "Link will record this workspace.",
  "Link Key": "Link Key",
  "Link Key 不能为空": "Link Key is required",
};
