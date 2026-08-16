import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { EN_PROXY_MESSAGES } from "./enProxy";
import { EN_RESOURCES_MESSAGES } from "./enResources";
import { EN_BUILD_MESSAGES } from "./enBuild";
import { EN_MERGE_MESSAGES } from "./enMerge";
import { EN_RUNTIME_MESSAGES } from "./enRuntime";
import { EN_LINK_MESSAGES } from "./enLink";
import { EN_PROJECTS_MESSAGES } from "./enProjects";
import { EN_WEB_ACTION_MESSAGES } from "./enWebActions";
import { EN_CONFIG_SOURCE_MESSAGES } from "./enConfigSources";
import { EN_OVERVIEW_MESSAGES } from "./enOverview";
import { EN_SETTINGS_MESSAGES } from "./enSettings";
import { EN_NAVIGATION_MESSAGES } from "./enNavigation";
import { EN_DIAGNOSTICS_MESSAGES } from "./enDiagnostics";
import { EN_WORKFLOW_MESSAGES } from "./enWorkflow";
import { EN_PROJECT_RUNTIME_MESSAGES } from "./enProjectRuntime";
import { EN_BRANCH_MESSAGES } from "./enBranch";
import { EN_FETCH_IMPORT_MESSAGES } from "./enFetchImport";
import { EN_KNOWLEDGE_MESSAGES } from "./enKnowledge";
import { EN_INTERNAL_MESSAGES } from "./enInternal";

export type AppLanguage = "zh-CN" | "en-US";
export type AppLanguagePreference = "system" | AppLanguage;
export type TranslationParams = Record<string, string | number>;
export type Translate = (message: string, params?: TranslationParams) => string;

export const APP_LANGUAGE_STORAGE_KEY = "rdevtool.language";
export const APP_LANGUAGE_CHANGE_EVENT = "rdevtool:language-preference-changed";
const APP_LANGUAGE_CACHE_UPDATED_AT_KEY = "rdevtool.language.updatedAt";
const APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION = 1;

export type AppLanguagePreferenceRecord = {
  schemaVersion: number;
  preference: AppLanguagePreference;
  updatedAtMs: number;
};

const EN_MESSAGES: Record<string, string> = {
  ...EN_PROXY_MESSAGES,
  ...EN_RESOURCES_MESSAGES,
  ...EN_BUILD_MESSAGES,
  ...EN_MERGE_MESSAGES,
  ...EN_RUNTIME_MESSAGES,
  ...EN_LINK_MESSAGES,
  ...EN_PROJECTS_MESSAGES,
  ...EN_WEB_ACTION_MESSAGES,
  ...EN_CONFIG_SOURCE_MESSAGES,
  ...EN_OVERVIEW_MESSAGES,
  ...EN_SETTINGS_MESSAGES,
  ...EN_NAVIGATION_MESSAGES,
  ...EN_DIAGNOSTICS_MESSAGES,
  ...EN_WORKFLOW_MESSAGES,
  ...EN_PROJECT_RUNTIME_MESSAGES,
  ...EN_BRANCH_MESSAGES,
  ...EN_FETCH_IMPORT_MESSAGES,
  ...EN_KNOWLEDGE_MESSAGES,
  ...EN_INTERNAL_MESSAGES,
  "开发工作台": "Development Workbench",
  "工作台": "Workbench",
  "工作区": "Workspace",
  "知识库": "Knowledge Base",
  "知识": "Knowledge",
  "项目管理": "Projects",
  "资源入口": "Resources",
  "构建任务": "Builds",
  "Git工作流": "Git Workflow",
  "本地代理": "Local Proxy",
  "项目": "Projects",
  "构建": "Build",
  "网站": "Website",
  "应用": "Application",
  "脚本": "Script",
  "工具": "Tool",
  "目录": "Directory",
  "文件": "File",
  "入口": "Resource",
  "页面": "Pages",
  "项目动作": "Project Actions",
  "快捷入口": "Quick Access",
  "当前页面": "Current page",
  "当前工作区": "Current Workspace",
  "切换工作区": "Switch Workspace",
  "全局": "Global",
  "未分类": "Uncategorized",
  "全部项目": "All Projects",
  "{count} 个项目": "{count} projects",
  "搜索工作区名称或 ID": "Search workspace name or ID",
  "清空搜索": "Clear Search",
  "未找到相关工作区": "No matching workspace",
  "请尝试其他关键词": "Try another keyword",
  "查看全部结果": "Show All Results",
  "工作区设置...": "Workspace Settings...",
  "范围、目录与入口配置": "Scope, directories, and resource settings",
  "切换到 {page}": "Switch to {page}",
  "项目管理 / 构建": "Projects / Build",
  "项目管理 / Git": "Projects / Git",
  "项目构建概览与配置": "Project build overview and configuration",
  "项目 Git 概览与配置": "Project Git overview and configuration",
  "Git配置": "Git Configuration",
  "切换到项目构建": "Open project builds",
  "切换到 Git 工作流": "Open Git workflow",
  "{name} · 知识库": "{name} · Knowledge Base",
  "打开项目经验与共享手册": "Open project notes and shared handbook",
  "窗口工具": "Window Tools",
  "主菜单": "Main Menu",
  "项目管理二级菜单": "Project Submenu",
  "展开导航栏": "Expand Navigation",
  "收起导航栏": "Collapse Navigation",
  "活动": "Activity",
  "活动中心": "Activity Center",
  "运行与活动": "Runtime & Activity",
  "运行与活动中心": "Runtime & Activity Center",
  "运行与活动视图": "Runtime & Activity View",
  "管理当前会话与操作记录": "Manage current sessions and operation history",
  "刷新运行状态": "Refresh Runtime Status",
  "收起运行与活动中心": "Collapse Runtime & Activity Center",
  "运行中 {count}": "Running {count}",
  "活动记录 {count}": "Activity {count}",
  "项目服务": "Project Service",
  "项目会话": "Project Sessions",
  "共享服务": "Shared Services",
  "正在读取运行状态": "Loading Runtime Status",
  "当前没有运行中的资源": "No Resources Running",
  "项目服务、本地构建、Action 和代理启动后会出现在这里。":
    "Project services, local builds, Actions, and proxies appear here after they start.",
  "部分运行状态暂不可用": "Some Runtime Status Is Unavailable",
  "{count} 个运行资源": "{count} Running Resources",
  "{count} 个活跃端口": "{count} Active Ports",
  "其他工作区": "Other Workspaces",
  "刚刚更新": "Updated just now",
  "{count} 秒前更新": "Updated {count} seconds ago",
  "{count} 分钟前更新": "Updated {count} minutes ago",
  "本次 {count} 个请求": "{count} requests this session",
  "{count} 个异常": "{count} errors",
  "认领并纳入管理": "Claim and Manage",
  "已纳入 rDevTool 管理": "Claimed by rDevTool",
  "运行资源已停止": "Running resource stopped",
  "Action 已请求停止": "Action stop requested",
  "操作未完成，请查看活动记录或页面提示。":
    "The action did not complete. Check Activity or the page message.",
  "外部进程": "External Process",
  "已运行 {duration}": "Running for {duration}",
  "打开日志": "Open Log",
  "查看详情": "View Details",
  "停止运行资源？": "Stop Running Resource?",
  "停止后，对应的本地服务或任务将立即中断。":
    "The corresponding local service or task will stop immediately.",
  "关闭运行与活动中心": "Close Runtime & Activity Center",
  "打开运行与活动中心": "Open Runtime & Activity Center",
  "管理和跟踪所有活动": "Manage and track all activity",
  "全部来源": "All Sources",
  "托盘": "Tray",
  "全部": "All",
  "待办": "Pending",
  "成功": "Success",
  "失败": "Failed",
  "活动筛选": "Activity Filters",
  "活动来源筛选": "Activity Source Filters",
  "标记全部失败已处理": "Mark All Failures Handled",
  "刷新活动状态": "Refresh Activity Status",
  "清理已处理记录": "Clear Handled Activity",
  "收起活动中心": "Collapse Activity Center",
  "查看诊断详情": "View Diagnostic Details",
  "暂无待处理": "Nothing Pending",
  "没有匹配记录": "No Matching Activity",
  "未处理失败和需要人工操作的活动会出现在这里。":
    "Unhandled failures and activity requiring action appear here.",
  "换个筛选条件看看其他活动。": "Try another filter to view more activity.",
  "检查并重试": "Check and Retry",
  "忽略全部待处理项？": "Ignore All Pending Items?",
  "共 {count} 条。忽略后不再提醒，记录仍可在“全部”中查看。":
    "{count} items. They will stop generating reminders and remain available under All.",
  "忽略全部": "Ignore All",
  "清理已处理记录？": "Clear Handled Activity?",
  "将移除成功、信息和已确认失败记录；待处理与正在运行的任务会保留。":
    "Removes successful, informational, and acknowledged failure records. Pending and running tasks remain.",
  "清理": "Clear",
  "待处理": "Pending",
  "停止重试": "Stopped Retrying",
  "同步失败": "Sync Failed",
  "已确认": "Acknowledged",
  "进行中": "Running",
  "完成": "Complete",
  "记录": "Record",
  "联调链路": "Integration Chain",
  "配置变更": "Configuration Change",
  "可执行": "Ready",
  "已阻止": "Blocked",
  "已检查": "Checked",
  "已启动": "Started",
  "已停止": "Stopped",
  "已跳过": "Skipped",
  "构建参数": "Build Parameters",
  "参数": "Parameters",
  "失败原因": "Failure Reason",
  "失败原因：{reason}": "Failure reason: {reason}",
  "定位": "Locate",
  "定位活动": "Locate Activity",
  "打开关联资源": "Open Related Resource",
  "打开工作区": "Open Workspace",
  "标记已处理": "Mark as Handled",
  "收起执行详情": "Collapse Execution Details",
  "展开执行详情": "Expand Execution Details",
  "执行 {count} 次": "Executed {count} times",
  "历史失败 {count}": "{count} previous failures",
  "成功 {successCount} / 失败 {failureCount}":
    "{successCount} succeeded / {failureCount} failed",
  "执行详情已收起": "Execution details collapsed",
  "第{count}次": "Attempt {count}",
  "仅显示最近 {count} 次": "Show latest {count} only",
  "查看其余 {count} 次记录": "View {count} more records",
  "本页已全部显示": "All items on this page are shown",
  "活动详情": "Activity Details",
  "警告": "Warning",
  "风险：{risk}": "Risk: {risk}",
  "刚刚": "Just now",
  "{count} 分钟前": "{count} minutes ago",
  "{count} 小时前": "{count} hours ago",
  "{count} 天前": "{count} days ago",
  "待处理队列": "Attention Queue",
  "{count} 个分组": "{count} groups",
  "全部重新加载 {count}": "Reload All {count}",
  "· {count} 条": "· {count} items",
  "查看其余 {count} 个分组": "View {count} more groups",
  "配置更新": "Configuration Update",
  "需重新加载": "Reload Required",
  "需重新加载 {count}": "Reload Required {count}",
  "需查看差异": "Review Diff Required",
  "可重试": "Retry Available",
  "需确认失败": "Failure Confirmation Required",
  "需确认失败 {count}": "Failure Confirmation Required {count}",
  "忽略": "Ignore",
  "确认重试 Git 操作？": "Retry Git operation?",
  "确认重新规划并重试构建？": "Replan and retry build?",
  "确认检查并重新停止？": "Check and stop again?",
  "确认检查并重新启动？": "Check and start again?",
  "确认检查并重试？": "Check and retry?",
  "确认重试？": "Retry?",
  "将重新检查当前状态，并在检查通过后重试。":
    "Recheck the current state and retry only after the check passes.",
  "将按失败项目的原参数重新执行 Git 操作，并重新进行项目、工作区和分支校验；校验未通过时不会继续。":
    "Rerun the Git operation with its original parameters and revalidate the project, workspace, and branch. It will not continue if validation fails.",
  "将按失败时的目标和参数重新生成 {projectName} 的构建计划。如当前不在记录所属工作区，将先切换到原工作区；只有工作区、项目、分支、环境和参数检查通过后才会触发新的构建。":
    "Recreate the build plan for {projectName} using the failed run's target and parameters. A new build starts only after all checks pass.",
  "将重新读取 {projectName} 的运行状态，并校验项目与受管进程后重新停止；归属校验未通过时不会终止进程。":
    "Reload the runtime state for {projectName} and validate the managed process before stopping it again.",
  "将使用失败时的项目、启动档案和本次覆盖，对 {projectName} 重新执行启动前检查；只有检查通过后才会启动。":
    "Rerun preflight checks for {projectName} using the original launch settings. It starts only if all checks pass.",
  "将重新读取 {profileName} 的代理配置，并由守护进程校验配置、端口和监听归属后重新停止。":
    "Reload the proxy configuration for {profileName} and validate it before stopping the proxy again.",
  "将重新读取 {profileName} 的代理配置，并由守护进程校验配置、端口和监听归属后重新启动。":
    "Reload the proxy configuration for {profileName} and validate it before starting the proxy again.",
  "将先对 {linkName} 执行只读检查。只有检查通过后，才会重新停止。":
    "Run read-only checks for {linkName}, then stop it again only if the checks pass.",
  "将先对 {linkName} 执行只读检查。只有检查通过后，才会重新启动。":
    "Run read-only checks for {linkName}, then start it again only if the checks pass.",
  "打开活动中心": "Open Activity Center",
  "关闭活动中心": "Close Activity Center",
  "打开设置": "Open Settings",
  "设置": "Settings",
  "关闭设置": "Close Settings",
  "退出确认": "Exit Confirmation",
  "退出失败": "Exit Failed",
  "监听{label}事件失败：{reason}":
    "Failed to listen for {label} event: {reason}",
  "退出 rDevTool？": "Exit rDevTool?",
  "本次启动的 {count} 个项目仍在运行。":
    "{count} projects started in this session are still running.",
  "正在退出": "Exiting",
  "保持运行并退出": "Keep Running and Exit",
  "正在停止": "Stopping",
  "停止并退出": "Stop and Exit",
  "记住我的选择": "Remember my choice",
  "已标记": "Pinned",
  "页面渲染失败：": "Page render failed: ",
  "关闭设置？": "Close Settings?",
  "当前有未保存的配置修改，关闭后这些修改不会生效。":
    "There are unsaved configuration changes. Closing now will discard them.",
  "切换配置对象？": "Switch Configuration?",
  "当前配置有未保存修改，查看「{name}」会丢弃这些修改。":
    "The current configuration has unsaved changes. Opening “{name}” will discard them.",
  "查看": "View",
  "删除访达分类？": "Delete Resource Category?",
  "将删除「{name}」以及里面的入口。":
    "This will delete “{name}” and its resources.",
  "未命名": "Untitled",
  "删除项目配置？": "Delete Project Configuration?",
  "将删除「{name}」的项目配置。":
    "This will delete the project configuration for “{name}”.",
  "设置分类": "Settings Categories",
  "应用偏好与行为": "App preferences and behavior",
  "项目配置": "Project Settings",
  "通用": "General",
  "菜单、外观与应用行为": "Navigation, appearance, and app behavior",
  "菜单": "Navigation",
  "未启用的菜单不会展示": "Disabled items stay hidden",
  "展示菜单": "Visible Navigation",
  "至少保留一个工作区菜单。": "Keep at least one workspace item enabled.",
  "默认菜单": "Default Page",
  "应用启动后优先进入此菜单。": "Open this page when the app starts.",
  "外观": "Appearance",
  "主题": "Theme",
  "系统": "System",
  "亮色": "Light",
  "暗色": "Dark",
  "跟随系统主题": "Follow System Theme",
  "亮色主题": "Light Theme",
  "暗色主题": "Dark Theme",
  "语言": "Language",
  "界面语言": "Interface Language",
  "选择应用界面的显示语言。": "Choose the language used by the app interface.",
  "跟随系统": "Follow System",
  "中文": "Chinese",
  "英文": "English",
  "配置监听保持开启": "Configuration monitoring stays active",
  "配置变更活动": "Configuration Changes",
  "未处理提醒会保留；完成或忽略后进入全部记录。":
    "Pending reminders stay visible; completed or ignored items move to all activity.",
  "配置变更活动显示": "Configuration activity visibility",
  "仅待处理": "Pending Only",
  "全部记录": "All Activity",
  "配置变更活动已设为 {mode}": "Configuration activity set to {mode}",
  "运行": "Runtime",
  "退出行为": "Exit Behavior",
  "退出时项目": "Projects on Exit",
  "控制关闭应用时已启动项目的处理方式。":
    "Choose what happens to projects started by rDevTool when the app closes.",
  "每次询问": "Ask Every Time",
  "保持项目运行": "Keep Projects Running",
  "停止本次启动项目": "Stop Projects Started This Session",
  "操作安全": "Operation Safety",
  "管理高风险操作的确认与执行规则":
    "Manage confirmation and execution rules for high-risk operations",
  "安全模式": "Safety Mode",
  "关键操作始终受安全底线保护": "Critical operations are always protected by guardrails",
  "恢复推荐": "Restore Recommended",
  "已恢复推荐安全策略": "Recommended safety policy restored",
  "已切换为 {mode} 安全策略": "Safety policy changed to {mode}",
  "已更新 {label} 确认策略": "Updated confirmation policy for {label}",
  "安全优先": "Safety First",
  "推荐": "Recommended",
  "高效": "Efficient",
  "自定义": "Custom",
  "始终确认": "Always Confirm",
  "直接执行": "Run Directly",
  "执行前确认": "Confirm Before Running",
  "安全底线": "Safety Guardrail",
  "可调整操作": "Configurable Operations",
  "关键写入、发布和数据丢失操作不可跳过确认":
    "Confirmation cannot be skipped for critical writes, releases, or data loss",
  "可按使用习惯选择直接执行或执行前确认":
    "Choose direct execution or confirmation to fit your workflow",
  "所有可调整操作均在执行前确认":
    "Confirm before every configurable operation",
  "仅安全底线操作需要确认": "Only guardrail operations require confirmation",
  "按下方各操作的独立规则执行": "Use the individual rules below",
  "构建、运行与导入确认，代理启停直接执行":
    "Confirm builds, runtimes, and imports; run proxy changes directly",
  "涉及仓库写入或分支历史变更": "Changes repository state or branch history",
  "涉及远端环境与发布结果": "Affects remote environments and release outcomes",
  "可能移除持久化配置或工作区数据":
    "May remove persistent configuration or workspace data",
  "未保存内容无法自动恢复": "Unsaved content cannot be recovered automatically",
  "分支合并与重放": "Branch Merge and Replay",
  "合并、批量合并及分支任务重放":
    "Merge, batch merge, and branch task replay",
  "部署与发布": "Deployment and Release",
  "触发远端部署、发布或历史部署重放":
    "Remote deployment, release, and deployment replay",
  "删除与移除": "Delete and Remove",
  "删除工作区、代理规则或配置源":
    "Delete workspaces, proxy rules, or configuration sources",
  "放弃未保存改动": "Discard Unsaved Changes",
  "关闭配置时丢弃尚未保存的内容":
    "Discard pending changes when closing configuration",
  "构建与构建重放": "Build and Build Replay",
  "本地构建、打包及构建记录重放":
    "Local builds, packages, and build history replay",
  "运行环境启停": "Runtime Start and Stop",
  "启动或停止项目运行环境": "Start or stop project runtimes",
  "代理与联调启停": "Proxy and Integration Start and Stop",
  "启动或停止代理服务、联调链":
    "Start or stop proxy services and integration chains",
  "导入外部配置": "Import External Configuration",
  "导入代理包或其他外部配置":
    "Import proxy packages or other external configuration",
  "查看常用命令并打开配置文件": "View common commands and open configuration files",
  "命令面板": "Command Palette",
  "搜索页面、项目、快捷入口和常用动作。":
    "Search pages, projects, quick access, and common actions.",
  "配置文件夹": "Configuration Folder",
  "打开当前配置目录": "Open the active configuration directory",
  "项目与构建配置": "Project and build configuration",
  "访达快捷入口": "Finder quick access",
  "受管产物": "Managed Artifacts",
  "活动中": "Active",
  "路径缺失": "Path Missing",
  "归属已验证": "Ownership Verified",
  "归属待验证": "Ownership Pending Verification",
  "工作区 {key}": "Workspace {key}",
  "未映射工作区": "Unmapped Workspace",
  "项目 {key}": "Project {key}",
  "仅引用": "Reference Only",
  "盘点概览": "Inventory Overview",
  "受管产物盘点概览": "Managed Artifact Inventory Overview",
  "托管记录": "Managed Records",
  "已存在": "Present",
  "托管产物": "Managed Artifacts",
  "{count} 条": "{count} items",
  "没有匹配的托管产物": "No Matching Managed Artifacts",
  "调整搜索或工作区范围后重试。":
    "Adjust the search or workspace scope and try again.",
  "非托管引用": "Unmanaged References",
  "汇总工作区副本、Runtime 与 Proxy daemon 的持久化产物":
    "Inventory persistent artifacts from workspace copies, Runtime, and Proxy daemons.",
  "刷新受管产物": "Refresh Managed Artifacts",
  "范围": "Scope",
  "筛选当前盘点结果": "Filter Current Inventory",
  "搜索与工作区": "Search and Workspace",
  "按类型、路径、工作区或项目快速定位。":
    "Quickly locate artifacts by type, path, workspace, or project.",
  "搜索类型、路径、工作区或项目":
    "Search type, path, workspace, or project",
  "搜索受管产物": "Search Managed Artifacts",
  "查看全部工作区产物": "Show Artifacts from All Workspaces",
  "全部工作区": "All Workspaces",
  "仅提供盘点视图，不执行删除或清理；cleanup-plan 同样只生成只读计划。":
    "This inventory is read-only and does not delete or clean up artifacts; cleanup-plan also generates a read-only plan.",
  "正在读取受管产物台账…": "Loading Managed Artifact Inventory…",
  "刷新": "Refresh",
  "取消": "Cancel",
  "确认": "Confirm",
  "关闭": "Close",
  "关闭弹窗": "Close Dialog",
  "保存": "Save",
  "删除": "Delete",
  "编辑": "Edit",
  "打开": "Open",
  "重试": "Retry",
  "未保存": "Unsaved",
  "放弃未保存的改动？": "Discard unsaved changes?",
  "关闭后，本次尚未保存的配置修改将丢失。":
    "Closing now will discard the configuration changes from this session.",
  "放弃改动": "Discard Changes",
  "以后直接执行此类操作": "Run this type of operation directly in the future",
  "页面概览与操作": "Page Overview and Actions",
  "命令结果": "Command Results",
  "正在加载页面模块": "Loading page module",
  "搜索命令": "Search Commands",
  "搜索页面、项目、快捷入口或动作":
    "Search pages, projects, quick access, or actions",
  "没有匹配命令": "No matching commands",
  "换个关键词试试。": "Try another keyword.",
  "没有更多了": "No more items",
  "项目目录": "Project Directory",
  "运行 dev 服务": "Run development service",
  "停止 dev 服务": "Stop development service",
  "执行构建命令": "Run build command",
  "中止构建任务": "Stop build",
  "构建产物目录": "Build Output Directory",
  "唤起运行中的项目": "Focus running project",
  "产物": "Output",
  "聚焦": "Focus",
  "正在刷新": "Refreshing",
  "正在同步分支": "Syncing branches",
  "正在同步状态": "Syncing status",
  "打开 {name}": "Open {name}",
  "启动 {name}": "Start {name}",
  "停止 {name}": "Stop {name}",
  "构建 {name}": "Build {name}",
  "停止构建 {name}": "Stop build for {name}",
  "打开产物 {name}": "Open output for {name}",
  "聚焦 {name}": "Focus {name}",
  "操作安全策略": "Operation Safety Policy",
  "{label}执行方式": "Execution mode for {label}",
  "基础信息": "Basics",
  "本地命令": "Local Commands",
  "启动档案": "Runtime Profiles",
  "构建目标": "Build Targets",
  "构建记录": "Build History",
  "分支规则": "Branch Rules",
  "rDevTool 启动失败": "rDevTool failed to start",
};

export function hasTranslationMessage(language: AppLanguage, message: string): boolean {
  return language === "zh-CN" || Object.prototype.hasOwnProperty.call(EN_MESSAGES, message);
}

type I18nContextValue = {
  language: AppLanguage;
  preference: AppLanguagePreference;
  setPreference: (preference: AppLanguagePreference) => void;
  t: Translate;
};

type I18nProviderProps = {
  children: ReactNode;
  systemLanguageOverride?: string;
};

function bridgeLanguagePreference(preference: AppLanguagePreference) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(APP_LANGUAGE_CHANGE_EVENT, { detail: preference }),
  );
}

const DEFAULT_I18N_CONTEXT: I18nContextValue = {
  language: "zh-CN",
  preference: "system",
  // Also works when a Vite HMR boundary temporarily retains an older provider.
  setPreference: bridgeLanguagePreference,
  t: (message, params) => translateMessage("zh-CN", message, params),
};

type I18nGlobal = typeof globalThis & {
  __RDEVTOOL_I18N_CONTEXT__?: Context<I18nContextValue | null>;
};

const i18nGlobal = globalThis as I18nGlobal;
const I18nContext =
  i18nGlobal.__RDEVTOOL_I18N_CONTEXT__ ??
  (i18nGlobal.__RDEVTOOL_I18N_CONTEXT__ =
    createContext<I18nContextValue | null>(null));

export function normalizeLanguagePreference(
  value: unknown,
): AppLanguagePreference {
  return value === "zh-CN" || value === "en-US" || value === "system"
    ? value
    : "system";
}

export function systemLanguage(language?: string): AppLanguage {
  const candidate =
    language ??
    (typeof navigator === "undefined" ? "" : navigator.language ?? "");
  if (!candidate.trim()) {
    return "zh-CN";
  }
  return candidate.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function resolveLanguage(
  preference: AppLanguagePreference,
  browserLanguage?: string,
): AppLanguage {
  return preference === "system"
    ? systemLanguage(browserLanguage)
    : preference;
}

function interpolate(message: string, params?: TranslationParams): string {
  if (!params) {
    return message;
  }
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key)
      ? String(params[key])
      : match,
  );
}

export function translateMessage(
  language: AppLanguage,
  message: string,
  params?: TranslationParams,
): string {
  const template =
    language === "en-US" ? EN_MESSAGES[message] ?? message : message;
  return interpolate(template, params);
}

export function readStoredLanguagePreference(): AppLanguagePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    return normalizeLanguagePreference(
      window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY),
    );
  } catch {
    return "system";
  }
}

function normalizeLanguagePreferenceRecord(
  value: unknown,
): AppLanguagePreferenceRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<AppLanguagePreferenceRecord>;
  if (
    record.schemaVersion !== APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION ||
    (record.preference !== "system" &&
      record.preference !== "zh-CN" &&
      record.preference !== "en-US") ||
    typeof record.updatedAtMs !== "number" ||
    !Number.isFinite(record.updatedAtMs) ||
    record.updatedAtMs < 0
  ) {
    return null;
  }
  return {
    schemaVersion: APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION,
    preference: record.preference,
    updatedAtMs: Math.floor(record.updatedAtMs),
  };
}

export function resolveLanguagePreferenceRecord(
  cached: AppLanguagePreferenceRecord,
  persisted: AppLanguagePreferenceRecord | null,
  nowMs: number,
): { record: AppLanguagePreferenceRecord; shouldPersist: boolean } {
  if (!persisted) {
    return {
      record: {
        ...cached,
        updatedAtMs: cached.updatedAtMs || nowMs,
      },
      shouldPersist: true,
    };
  }
  if (cached.updatedAtMs > persisted.updatedAtMs) {
    return { record: cached, shouldPersist: true };
  }
  return { record: persisted, shouldPersist: false };
}

function readCachedLanguagePreferenceRecord(): AppLanguagePreferenceRecord {
  let updatedAtMs = 0;
  try {
    const storedUpdatedAt = Number(
      window.localStorage.getItem(APP_LANGUAGE_CACHE_UPDATED_AT_KEY),
    );
    if (Number.isFinite(storedUpdatedAt) && storedUpdatedAt > 0) {
      updatedAtMs = Math.floor(storedUpdatedAt);
    }
  } catch {
    // The legacy language value remains a usable startup fallback.
  }
  return {
    schemaVersion: APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION,
    preference: readStoredLanguagePreference(),
    updatedAtMs,
  };
}

function writeLanguagePreferenceCache(record: AppLanguagePreferenceRecord) {
  try {
    window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, record.preference);
    window.localStorage.setItem(
      APP_LANGUAGE_CACHE_UPDATED_AT_KEY,
      String(record.updatedAtMs),
    );
  } catch {
    // SQLite remains durable when WebView storage is unavailable.
  }
}

async function loadPersistedLanguagePreference() {
  const value = await invoke<unknown | null>("get_app_language_preference");
  return normalizeLanguagePreferenceRecord(value);
}

async function persistLanguagePreference(record: AppLanguagePreferenceRecord) {
  const value = await invoke<unknown>("save_app_language_preference", {
    record,
  });
  const persisted = normalizeLanguagePreferenceRecord(value);
  if (!persisted) {
    throw new Error("Invalid language preference returned by storage");
  }
  return persisted;
}

export function I18nProvider({
  children,
  systemLanguageOverride,
}: I18nProviderProps) {
  const [preference, setPreferenceState] =
    useState<AppLanguagePreference>(readStoredLanguagePreference);
  const preferenceRevisionRef = useRef(0);
  const preferenceTimestampRef = useRef(0);
  const [browserLanguage, setBrowserLanguage] = useState(() =>
    systemLanguageOverride ??
      (typeof window === "undefined" ? "" : navigator.language),
  );
  const language = resolveLanguage(preference, browserLanguage);

  const applyLanguagePreferenceRecord = useCallback(
    (record: AppLanguagePreferenceRecord, broadcast: boolean) => {
      preferenceTimestampRef.current = Math.max(
        preferenceTimestampRef.current,
        record.updatedAtMs,
      );
      setPreferenceState(record.preference);
      writeLanguagePreferenceCache(record);
      if (broadcast) {
        window.dispatchEvent(
          new CustomEvent(APP_LANGUAGE_CHANGE_EVENT, { detail: record }),
        );
      }
    },
    [],
  );

  const setPreference = useCallback(
    (nextPreference: AppLanguagePreference) => {
      const normalized = normalizeLanguagePreference(nextPreference);
      const record: AppLanguagePreferenceRecord = {
        schemaVersion: APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION,
        preference: normalized,
        updatedAtMs: Math.max(Date.now(), preferenceTimestampRef.current + 1),
      };
      preferenceRevisionRef.current += 1;
      applyLanguagePreferenceRecord(record, true);
      void persistLanguagePreference(record).catch((reason) => {
        console.warn("[i18n] failed to persist language preference", reason);
      });
    },
    [applyLanguagePreferenceRecord],
  );

  useEffect(() => {
    const syncStoredPreference = () => {
      const cached = readCachedLanguagePreferenceRecord();
      preferenceTimestampRef.current = Math.max(
        preferenceTimestampRef.current,
        cached.updatedAtMs,
      );
      setPreferenceState(cached.preference);
    };
    const syncChangedPreference = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const record = normalizeLanguagePreferenceRecord(detail);
      if (record) {
        setPreferenceState(record.preference);
        return;
      }

      // Bridges a setter retained by a pre-migration Vite HMR context.
      const migratedRecord: AppLanguagePreferenceRecord = {
        schemaVersion: APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION,
        preference: normalizeLanguagePreference(detail),
        updatedAtMs: Math.max(Date.now(), preferenceTimestampRef.current + 1),
      };
      preferenceRevisionRef.current += 1;
      applyLanguagePreferenceRecord(migratedRecord, false);
      void persistLanguagePreference(migratedRecord).catch((reason) => {
        console.warn("[i18n] failed to migrate language preference", reason);
      });
    };
    const syncStoragePreference = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === APP_LANGUAGE_STORAGE_KEY ||
        event.key === APP_LANGUAGE_CACHE_UPDATED_AT_KEY
      ) {
        syncStoredPreference();
      }
    };

    // Keeps multiple WebViews and stale Vite HMR contexts on one preference.
    syncStoredPreference();
    window.addEventListener(APP_LANGUAGE_CHANGE_EVENT, syncChangedPreference);
    window.addEventListener("storage", syncStoragePreference);
    return () => {
      window.removeEventListener(APP_LANGUAGE_CHANGE_EVENT, syncChangedPreference);
      window.removeEventListener("storage", syncStoragePreference);
    };
  }, [applyLanguagePreferenceRecord]);

  useEffect(() => {
    let disposed = false;
    const revisionAtStart = preferenceRevisionRef.current;
    const cached = readCachedLanguagePreferenceRecord();

    void loadPersistedLanguagePreference()
      .then((persisted) => {
        if (disposed || preferenceRevisionRef.current !== revisionAtStart) {
          return;
        }

        const resolved = resolveLanguagePreferenceRecord(
          cached,
          persisted,
          Date.now(),
        );
        applyLanguagePreferenceRecord(resolved.record, true);
        if (resolved.shouldPersist) {
          return persistLanguagePreference(resolved.record);
        }
      })
      .catch((reason) => {
        console.warn("[i18n] failed to hydrate language preference", reason);
      });

    return () => {
      disposed = true;
    };
  }, [applyLanguagePreferenceRecord]);

  useEffect(() => {
    if (systemLanguageOverride !== undefined) {
      setBrowserLanguage(systemLanguageOverride);
      return;
    }
    if (preference !== "system") {
      return;
    }
    const updateBrowserLanguage = () =>
      setBrowserLanguage(navigator.language ?? "");
    window.addEventListener("languagechange", updateBrowserLanguage);
    return () =>
      window.removeEventListener("languagechange", updateBrowserLanguage);
  }, [preference, systemLanguageOverride]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    document.documentElement.dataset.languagePreference = preference;
  }, [language, preference]);

  const t = useCallback<Translate>(
    (message, params) => translateMessage(language, message, params),
    [language],
  );
  const value = useMemo<I18nContextValue>(
    () => ({ language, preference, setPreference, t }),
    [language, preference, setPreference, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? DEFAULT_I18N_CONTEXT;
}

export function translateNode(node: ReactNode, t: Translate): ReactNode {
  return typeof node === "string" ? t(node) : node;
}
