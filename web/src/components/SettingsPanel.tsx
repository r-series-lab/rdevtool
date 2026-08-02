import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ReactNode,
} from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceTypeOptions } from "../hooks/useWorkspaceTypeOptions";
import { useConfigSource } from "../hooks/useConfigSource";
import { useConfirmationPreferences } from "../hooks/useConfirmationPreferences";
import { useActivityPreferences } from "../hooks/useActivityPreferences";
import { useI18n, type AppLanguagePreference, type Translate } from "../i18n";
import type {
  AppExitRuntimePolicy,
  CreateProjectWorkspacePayload,
  DeployParamConfigKind,
  DeployParamConfigSummary,
  DeployTargetConfigSummary,
  NavigationEditorCategory,
  NavigationEditorEntry,
  NavigationEditorEntryKind,
  NavigationEditorState,
  ProjectBranchRulesDraft,
  ProjectCommandConfigDraft,
  ProjectConfigDraft,
  ProjectConfigEditorState,
  ProjectWorkspaceEditorDraft,
  ProjectWorkspaceEditorState,
  ProjectWorkspaceSummary,
  ProjectAuthHelperDraft,
  ProjectAuthHelperItemDraft,
  ProjectDebugLocalFileDraft,
  ProjectDebugProfileDraft,
  ProjectLocalProxyDraft,
  ProjectLocalProxyRouteDraft,
  ProjectNetworkProxyDraft,
} from "../app-types";
import type { AppStyleMode } from "../theme";
import {
  DEFAULT_NEW_WORKSPACE_TYPE,
  normalizeWorkspaceType,
  workspaceTypeLabel,
  workspaceTypeOptionsWithValues,
} from "../lib/workspaceTypes";
import { configSourceIdForWorkspace } from "../lib/configSources";
import {
  CONFIRMATION_PREFERENCE_DEFINITIONS,
  confirmationEnabled,
  type ConfirmationMode,
  type ConfirmationPreferenceKey,
} from "../lib/confirmationPreferences";
import {
  CheckIcon,
  ClearIcon,
  CopyIcon,
  FolderIcon,
  OpenExternalIcon,
  RefreshIcon,
  TrashIcon,
} from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";
import { AppToast } from "./AppToast";
import { ConfigSourceBar } from "./ConfigSourceBar";
import { ConfigSourceManagerDialog } from "./ConfigSourceManagerDialog";
import { ManagedArtifactsPanel } from "./ManagedArtifactsPanel";
import { SystemDiagnosticsPanel } from "./SystemDiagnosticsPanel";
import { WorkspaceTypeSelect } from "./WorkspaceTypeSelect";

export type SettingsSection =
  | "general"
  | "menu"
  | "confirmation"
  | "appearance"
  | "access"
  | "artifacts"
  | "diagnostics"
  | "workspace"
  | "projects"
  | "projectBasics"
  | "projectLocal"
  | "projectRuntime"
  | "projectBuild"
  | "projectBranch"
  | "finder"
  | "branch"
  | "build";
type PageKey =
  | "overview"
  | "knowledge"
  | "projectManagement"
  | "resources"
  | "merge"
  | "build"
  | "proxy";

const SETTINGS_ALL_PAGE_KEYS: PageKey[] = [
  "overview",
  "knowledge",
  "projectManagement",
  "resources",
  "proxy",
];

const SETTINGS_NAV_ITEM_MAP: Record<PageKey, { label: string; shortLabel: string }> = {
  overview: { label: "工作区", shortLabel: "工作区" },
  knowledge: { label: "知识库", shortLabel: "知识库" },
  projectManagement: { label: "项目管理", shortLabel: "项目管理" },
  resources: { label: "资源入口", shortLabel: "资源入口" },
  proxy: { label: "本地代理", shortLabel: "本地代理" },
  build: { label: "构建任务", shortLabel: "构建任务" },
  merge: { label: "Git工作流", shortLabel: "Git工作流" },
};

export type SettingsPanelProps = {
  surface?: "settings" | "projectManagement";
  styleMode: AppStyleMode;
  onStyleModeChange: (mode: AppStyleMode) => void;
  exitRuntimePolicy: AppExitRuntimePolicy;
  onExitRuntimePolicyChange: (policy: AppExitRuntimePolicy) => void;
  selectedProjectKey: string;
  onOpenConfigDir: () => void;
  onOpenConfigFile: () => void;
  onOpenProjectWorkspacesDir: () => void;
  onOpenNavigationConfigFile: () => void;
  onCreateProjectWorkspace: (payload: CreateProjectWorkspacePayload) => Promise<void> | void;
  projectWorkspaces: ProjectWorkspaceSummary[];
  activeProjectWorkspaceKey: string;
  initialSection?: SettingsSection;
  activePage: PageKey;
  enabledPages: PageKey[];
  onEnabledPagesChange: (pages: PageKey[]) => void;
  defaultPage: PageKey;
  onDefaultPageChange: (page: PageKey) => void;
  onProjectConfigSaved: () => Promise<void> | void;
  onOpenProjectManagement?: () => void;
  onClose: () => void;
};

type SettingsConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "normal" | "danger";
  onConfirm: () => void | Promise<void>;
};

const SECTION_ITEMS: Array<{ key: SettingsSection; label: string }> = [
  { key: "menu", label: "通用" },
  { key: "confirmation", label: "操作确认" },
  { key: "access", label: "快捷入口" },
  { key: "artifacts", label: "受管产物" },
  { key: "diagnostics", label: "系统诊断" },
];

const DEPLOY_PARAM_KIND_OPTIONS: Array<{ value: DeployParamConfigKind; label: string }> = [
  { value: "text", label: "文本" },
  { value: "select", label: "选项" },
  { value: "branch", label: "分支" },
  { value: "boolean", label: "布尔" },
  { value: "hidden", label: "隐藏" },
];

const BUILD_ADAPTER_OPTIONS: Array<{ value: DeployTargetConfigSummary["adapter"]; label: string }> =
  [
    { value: "jenkins", label: "Jenkins" },
    { value: "local_command", label: "本地命令" },
    { value: "r_series_package", label: "R 系列打包" },
  ];

const BUILD_ACTION_KIND_OPTIONS: Array<{
  value: DeployTargetConfigSummary["actionKind"];
  label: string;
}> = [
  { value: "deploy", label: "部署" },
  { value: "build", label: "构建" },
  { value: "package", label: "产物构建" },
  { value: "release", label: "发布" },
];

type BuildAdapterDetail = {
  title: string;
  meta: string;
  commandLabel: string;
  commandPlaceholder: string;
  emptyJobText: string;
};

const BUILD_ADAPTER_DETAILS: Record<DeployTargetConfigSummary["adapter"], BuildAdapterDetail> = {
  jenkins: {
    title: "Jenkins",
    meta: "Profile / Job",
    commandLabel: "Job Name",
    commandPlaceholder: "Marketing/example-web",
    emptyJobText: "未设置 Job Name",
  },
  local_command: {
    title: "本地命令",
    meta: "Command",
    commandLabel: "命令覆盖",
    commandPlaceholder: "留空继承项目构建命令",
    emptyJobText: "继承项目构建命令",
  },
  r_series_package: {
    title: "R 系列打包",
    meta: "Package",
    commandLabel: "构建命令覆盖",
    commandPlaceholder: "留空继承项目构建命令",
    emptyJobText: "继承项目构建命令",
  },
};

const R_SERIES_PACKAGE_PARAM_PRESETS: DeployParamConfigSummary[] = [
  {
    key: "platform",
    label: "系统",
    kind: "select",
    defaultValue: "macos",
    options: ["macos", "windows", "linux"],
    required: false,
    trueValue: null,
    falseValue: null,
    impactPaths: [],
  },
  {
    key: "profile",
    label: "配置",
    kind: "select",
    defaultValue: "release",
    options: ["release", "debug"],
    required: false,
    trueValue: null,
    falseValue: null,
    impactPaths: [],
  },
  {
    key: "channel",
    label: "渠道",
    kind: "select",
    defaultValue: "stable",
    options: ["stable", "beta"],
    required: false,
    trueValue: null,
    falseValue: null,
    impactPaths: [],
  },
];

const NAVIGATION_ENTRY_KIND_OPTIONS: Array<{
  value: NavigationEditorEntryKind;
  label: string;
}> = [
  { value: "url", label: "网站" },
  { value: "directory", label: "目录" },
  { value: "file", label: "文件" },
  { value: "app", label: "应用" },
  { value: "script", label: "脚本" },
  { value: "tool", label: "工具" },
];

const NAVIGATION_ENTRY_CREATE_OPTIONS: Array<{
  value: NavigationEditorEntryKind;
  label: string;
}> = [
  { value: "url", label: "网站" },
  { value: "directory", label: "目录" },
  { value: "file", label: "文件" },
  { value: "app", label: "应用" },
  { value: "script", label: "脚本" },
  { value: "tool", label: "工具" },
];

function navigationEntryKindLabel(kind: string, t: Translate) {
  return t(NAVIGATION_ENTRY_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? "入口");
}

function buildActionKindLabel(
  actionKind: DeployTargetConfigSummary["actionKind"],
  t: Translate,
) {
  return t(BUILD_ACTION_KIND_OPTIONS.find((item) => item.value === actionKind)?.label ?? "构建");
}

function defaultBuildActionKindForAdapter(
  adapter: DeployTargetConfigSummary["adapter"],
): DeployTargetConfigSummary["actionKind"] {
  if (adapter === "r_series_package") {
    return "package";
  }
  if (adapter === "local_command") {
    return "build";
  }
  return "deploy";
}

function missingBuildParamPresets(
  target: DeployTargetConfigSummary,
  presets: DeployParamConfigSummary[],
) {
  const keys = new Set(target.params.map((param) => param.key));
  return presets.filter((param) => !keys.has(param.key));
}

const CUSTOM_NAVIGATION_BROWSER_VALUE = "__custom_browser__";
const NAVIGATION_BROWSER_OPTIONS = [
  { value: "current_chrome", label: "当前 Chrome 窗口" },
  { value: "system", label: "系统默认浏览器" },
  { value: "Google Chrome", label: "Google Chrome" },
  { value: "Microsoft Edge", label: "Microsoft Edge" },
  { value: "Safari", label: "Safari" },
  { value: "Arc", label: "Arc" },
] as const;

const DEBUG_LOCAL_FILE_MODE_OPTIONS = [
  { value: "overwrite", label: "覆盖文件" },
  { value: "append_block", label: "标记区块" },
] as const;

const AUTH_HELPER_STORAGE_OPTIONS = [
  { value: "localStorage", label: "localStorage" },
  { value: "sessionStorage", label: "sessionStorage" },
  { value: "cookie", label: "Cookie" },
] as const;

function commandValue(command: ProjectCommandConfigDraft | undefined) {
  return command ?? { command: "", cwd: null, outputDir: null, envCount: 0 };
}

function emptyDebugLocalFile(): ProjectDebugLocalFileDraft {
  return {
    path: ".env.local",
    mode: "overwrite",
    content: "",
    enabled: true,
  };
}

function emptyNetworkProxy(): ProjectNetworkProxyDraft {
  return {
    enabled: false,
    proxyUrl: "",
    injectEnv: true,
    nodeHook: false,
    noProxy: "localhost,127.0.0.1,::1",
  };
}

function emptyLocalProxy(): ProjectLocalProxyDraft {
  return {
    enabled: false,
    listen: "127.0.0.1:3000",
    frontendUrl: "http://127.0.0.1:3001",
    upstreamProxy: "",
    routes: [],
    authHelper: emptyAuthHelper(),
  };
}

function emptyLocalProxyRoute(): ProjectLocalProxyRouteDraft {
  return {
    enabled: true,
    matchPrefix: "/api",
    target: "http://127.0.0.1:8080",
    rewritePrefix: "",
    headersText: "",
  };
}

function emptyAuthHelper(): ProjectAuthHelperDraft {
  return {
    enabled: false,
    path: "/__auth-helper",
    redirectPath: "/#/",
    items: [],
  };
}

function emptyAuthHelperItem(): ProjectAuthHelperItemDraft {
  return {
    enabled: true,
    storage: "localStorage",
    key: "token",
    fromJsonPath: "$.token",
    value: "",
    cookiePath: "/",
    cookieMaxAgeSeconds: null,
    cookieSameSite: "Lax",
  };
}

function emptyDebugProfile(existingKeys: string[]): ProjectDebugProfileDraft {
  const key = uniqueConfigKey("debug", existingKeys);
  return {
    key,
    label: "项目启动档案",
    command: null,
    cwd: null,
    expectedPort: null,
    focusUrl: null,
    readyProbe: null,
    runtimeProfile: null,
    envText: "",
    localFiles: [],
    browser: null,
    browserProfile: null,
    browserUserDataDir: null,
    browserArgsText: "",
    networkProxy: emptyNetworkProxy(),
    localProxy: emptyLocalProxy(),
  };
}

function uniqueConfigKey(prefix: string, existingKeys: string[]) {
  const existing = new Set(existingKeys);
  let index = existing.size + 1;
  let key = `${prefix}-${index}`;
  while (existing.has(key)) {
    index += 1;
    key = `${prefix}-${index}`;
  }
  return key;
}

function uniqueCopiedConfigKey(sourceKey: string, existingKeys: string[]) {
  const existing = new Set(existingKeys);
  const normalizedSource = sourceKey.trim().replace(/\s+/g, "-") || "build";
  const baseKey = `${normalizedSource}-copy`;
  if (!existing.has(baseKey)) {
    return baseKey;
  }
  let index = 2;
  let key = `${baseKey}-${index}`;
  while (existing.has(key)) {
    index += 1;
    key = `${baseKey}-${index}`;
  }
  return key;
}

function normalizeWorkspaceKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function copyPlainText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function toggleStringValue(values: string[], value: string, checked: boolean) {
  const next = new Set(values);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return Array.from(next);
}

function selectedCount(values: string[], total: number, includeAll: boolean) {
  return includeAll ? total : values.length;
}

function parseParamOptions(value: string) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseKeywordList(value: string) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function debugProfileMeta(profile: ProjectDebugProfileDraft, t: Translate) {
  const enabledFiles = (profile.localFiles ?? []).filter((file) => file.enabled).length;
  const envCount = profile.envText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .length;
  const parts = [
    profile.runtimeProfile ? t("继承 {name}", { name: profile.runtimeProfile }) : "",
    profile.cwd ? t("独有目录") : "",
    profile.readyProbe ? "HTTP Ready" : "",
    envCount > 0 ? `${envCount} env` : "",
    enabledFiles > 0 ? t("{count} 个文件", { count: enabledFiles }) : "",
    profile.browserUserDataDir || profile.browserArgsText?.trim()
      ? t("浏览器参数")
      : "",
    profile.networkProxy?.enabled ? t("代理") : "",
    profile.localProxy?.enabled ? t("本地代理") : "",
    profile.localProxy?.authHelper?.enabled ? "Token Helper" : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : t("默认");
}

function navigationBrowserSelectValue(browser?: string | null) {
  const normalized = browser?.trim() ?? "";
  if (!normalized) {
    return "current_chrome";
  }
  return NAVIGATION_BROWSER_OPTIONS.some((item) => item.value === normalized)
    ? normalized
    : CUSTOM_NAVIGATION_BROWSER_VALUE;
}

function navigationBrowserSupportsProfile(browser?: string | null) {
  const normalized = browser?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("chrome") ||
    normalized.includes("edge") ||
    normalized.includes("chromium") ||
    normalized.includes("brave")
  );
}

function navigationBrowserLabel(entry: NavigationEditorEntry, t: Translate) {
  if (entry.runtimeProfile?.trim()) {
    return t("运行环境 {name}", { name: entry.runtimeProfile.trim() });
  }
  const browser = entry.browser?.trim();
  if (!browser || browser === "current_chrome") {
    return t("当前 Chrome");
  }
  if (browser === "system") {
    return t("系统默认");
  }
  return entry.browserProfile ? `${browser} · ${entry.browserProfile}` : browser;
}

function emptyNavigationEntry(kind: NavigationEditorEntryKind = "url"): NavigationEditorEntry {
  return {
    name: "新入口",
    kind,
    url: "",
    browser: null,
    browserProfile: null,
    runtimeProfile: null,
    bundleId: null,
    appName: null,
    script: null,
    tool: kind === "tool" ? "link" : null,
    toolKey: null,
    toolAction: kind === "tool" ? "plan" : null,
    path: null,
    cwd: null,
    note: null,
  };
}

function uniqueNavigationCategoryTitle(categories: NavigationEditorCategory[]) {
  const existing = new Set(categories.map((category) => category.title.trim()));
  let index = categories.length + 1;
  let title = `新分类 ${index}`;
  while (existing.has(title)) {
    index += 1;
    title = `新分类 ${index}`;
  }
  return title;
}

function sectionForPage(page: PageKey): SettingsSection {
  void page;
  return "general";
}

export function SettingsPanel({
  surface = "settings",
  styleMode,
  onStyleModeChange,
  exitRuntimePolicy,
  onExitRuntimePolicyChange,
  selectedProjectKey,
  onOpenConfigDir,
  onOpenConfigFile,
  onOpenProjectWorkspacesDir,
  onOpenNavigationConfigFile,
  onCreateProjectWorkspace,
  projectWorkspaces,
  activeProjectWorkspaceKey,
  initialSection,
  activePage,
  enabledPages,
  onEnabledPagesChange,
  defaultPage,
  onDefaultPageChange,
  onProjectConfigSaved,
  onOpenProjectManagement,
  onClose,
}: SettingsPanelProps) {
  const { preference: languagePreference, setPreference: setLanguagePreference, t } =
    useI18n();
  const normalizeProjectManagementSection = (section?: SettingsSection): SettingsSection => {
    switch (section) {
      case "build":
      case "projectBuild":
        return "projectBuild";
      case "branch":
      case "projectBranch":
        return "projectBranch";
      case "projectLocal":
        return "projectLocal";
      case "projectRuntime":
        return "projectRuntime";
      case "projects":
      case "projectBasics":
      default:
        return "projectBasics";
    }
  };
  const normalizeSettingsSection = (section?: SettingsSection): SettingsSection => {
    switch (section) {
      case "appearance":
        return "menu";
      case "menu":
      case "confirmation":
      case "access":
      case "artifacts":
      case "diagnostics":
        return section;
      case "general":
      default:
        return "menu";
    }
  };
  const [activeSection, setActiveSection] = useState<SettingsSection>(() =>
    surface === "projectManagement"
      ? normalizeProjectManagementSection(initialSection)
      : normalizeSettingsSection(initialSection ?? sectionForPage(activePage)),
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(
    typeof document === "undefined" || !(document.activeElement instanceof HTMLElement)
      ? null
      : document.activeElement,
  );
  const [editorState, setEditorState] = useState<ProjectConfigEditorState | null>(null);
  const [navigationEditor, setNavigationEditor] = useState<NavigationEditorState | null>(null);
  const [selectedKey, setSelectedKey] = useState(selectedProjectKey);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [dirtyDeployProjectKeys, setDirtyDeployProjectKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [defaultBranchRulesDirty, setDefaultBranchRulesDirty] = useState(false);
  const [selectedDeployTargetIndex, setSelectedDeployTargetIndex] = useState(0);
  const [selectedDebugProfileIndex, setSelectedDebugProfileIndex] = useState(0);
  const [selectedNavigationCategoryIndex, setSelectedNavigationCategoryIndex] = useState(0);
  const [navigationDirty, setNavigationDirty] = useState(false);
  const [newProjectKey, setNewProjectKey] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceKey, setNewWorkspaceKey] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [newWorkspaceType, setNewWorkspaceType] = useState(DEFAULT_NEW_WORKSPACE_TYPE);
  const [newWorkspaceIndependentDir, setNewWorkspaceIndependentDir] = useState(false);
  const [newWorkspaceRootDir, setNewWorkspaceRootDir] = useState("");
  const [newWorkspaceResourceDir, setNewWorkspaceResourceDir] = useState("");
  const [createWorkspaceWorklog, setCreateWorkspaceWorklog] = useState(true);
  const [autoRecordWorkspaceWorklog, setAutoRecordWorkspaceWorklog] = useState(true);
  const [copyCurrentWorkspace, setCopyCurrentWorkspace] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceEditor, setWorkspaceEditor] = useState<ProjectWorkspaceEditorState | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState<ProjectWorkspaceEditorDraft | null>(null);
  const [workspaceEditorKey, setWorkspaceEditorKey] = useState(
    activeProjectWorkspaceKey || "system",
  );
  const navigationConfigSourceId = useMemo(
    () => configSourceIdForWorkspace(activeProjectWorkspaceKey),
    [activeProjectWorkspaceKey],
  );
  const {
    sources: runtimeConfigSources,
    selectedSource: selectedRuntimeConfigSource,
    selectedSourceId: selectedRuntimeConfigSourceId,
    preferredSourceId: preferredRuntimeConfigSourceId,
    sourceBusy: runtimeConfigSourceBusy,
    sourceError: runtimeConfigSourceError,
    sourceStatus: runtimeConfigSourceStatus,
    refreshSources: refreshRuntimeConfigSources,
    adoptSources: adoptRuntimeConfigSources,
    selectSource: selectRuntimeConfigSource,
  } = useConfigSource({
    workspaceKey: activeProjectWorkspaceKey,
    requiredCapability: "runtime",
  });
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceDirectoryBusy, setWorkspaceDirectoryBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatusValue] = useState("");
  const [error, setErrorValue] = useState("");
  const [toastNonce, setToastNonce] = useState(0);
  const [confirmState, setConfirmState] = useState<SettingsConfirmState | null>(null);
  const [runtimeConfigSourceManagerOpen, setRuntimeConfigSourceManagerOpen] = useState(false);
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [deployParamOptionsDrafts, setDeployParamOptionsDrafts] = useState<Record<string, string>>({});
  const {
    options: workspaceTypeOptions,
    addWorkspaceType,
    removeWorkspaceType,
  } = useWorkspaceTypeOptions();
  const {
    preferences: confirmationPreferences,
    loading: confirmationPreferencesLoading,
    setMode: setConfirmationMode,
    setCategoryEnabled: setConfirmationCategoryEnabled,
    reset: resetConfirmationPreferences,
  } = useConfirmationPreferences();
  const {
    preferences: activityPreferences,
    loading: activityPreferencesLoading,
    setConfigActivityVisibility,
  } = useActivityPreferences();

  function bumpToast(value: string) {
    if (value.trim()) {
      setToastNonce((current) => current + 1);
    }
  }

  function setStatus(value: string) {
    setStatusValue(value);
    bumpToast(value);
  }

  function setError(value: string) {
    setErrorValue(value);
    bumpToast(value);
  }

  function persistConfirmationPreference(
    operation: Promise<unknown>,
    successMessage: string,
  ) {
    void operation
      .then(() => setStatus(successMessage))
      .catch((reason) => setError(String(reason)));
  }

  function persistActivityPreference(
    operation: Promise<unknown>,
    successMessage: string,
  ) {
    void operation
      .then(() => setStatus(successMessage))
      .catch((reason) => setError(String(reason)));
  }

  const selectedProject = useMemo(
    () => editorState?.projects.find((project) => project.key === selectedKey) ?? null,
    [editorState, selectedKey],
  );
  const visibleSectionItems =
    surface === "projectManagement"
      ? [
          { key: "projectBasics" as const, label: "基础信息" },
          { key: "projectLocal" as const, label: "本地命令" },
          { key: "projectRuntime" as const, label: "启动档案" },
          { key: "projectBuild" as const, label: "构建目标" },
          { key: "projectBranch" as const, label: "分支规则" },
        ]
      : SECTION_ITEMS;
  const jenkinsProfileOptions = editorState?.jenkinsProfiles ?? [];
  const runtimeProfiles = editorState?.runtimeProfiles ?? [];
  const defaultBranchRules = editorState?.defaultBranchRules ?? {
    sourceKeywords: [],
    targetKeywords: [],
  };
  const selectedDebugProfile =
    selectedProject?.debugProfiles?.[selectedDebugProfileIndex] ?? null;
  const hasDirtySelectedProject = Boolean(selectedProject && dirtyKeys.has(selectedProject.key));
  const hasDirtySelectedDeployProject = Boolean(
    selectedProject && dirtyDeployProjectKeys.has(selectedProject.key),
  );
  const workspaceDirty = Boolean(
    workspaceEditor &&
      workspaceDraft &&
      JSON.stringify(workspaceDraft) !== JSON.stringify(workspaceEditor.workspace),
  );
  const workspaceTypeUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workspace of projectWorkspaces) {
      const key = normalizeWorkspaceType(workspace.workspaceType);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [projectWorkspaces]);
  const workspaceTypeSelectOptions = useMemo(
    () =>
      workspaceTypeOptionsWithValues(workspaceTypeOptions, [
        { value: newWorkspaceType },
        {
          value: workspaceDraft?.workspaceType,
          label: workspaceDraft?.workspaceTypeLabel,
        },
      ]),
    [
      newWorkspaceType,
      workspaceDraft?.workspaceType,
      workspaceDraft?.workspaceTypeLabel,
      workspaceTypeOptions,
    ],
  );
  const hasUnsavedChanges =
    dirtyKeys.size > 0 ||
    dirtyDeployProjectKeys.size > 0 ||
    defaultBranchRulesDirty ||
    navigationDirty ||
    workspaceDirty;

  async function loadProjectConfig(
    preferredKey = selectedKey || selectedProjectKey,
    sourceId = selectedRuntimeConfigSourceId,
  ) {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("get_project_config_editor", {
        sourceId,
      });
      setEditorState(nextState);
      setDirtyKeys(new Set());
      setDirtyDeployProjectKeys(new Set());
      setDefaultBranchRulesDirty(false);
      const preferred =
        (preferredKey && nextState.projects.find((project) => project.key === preferredKey)?.key) ||
        (selectedProjectKey &&
          nextState.projects.find((project) => project.key === selectedProjectKey)?.key) ||
        nextState.projects[0]?.key ||
        "";
      setSelectedKey(preferred);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function loadNavigationEditor() {
    setNavigationLoading(true);
    setError("");
    try {
      const nextState = await invoke<NavigationEditorState>("get_navigation_editor", {
        sourceId: navigationConfigSourceId,
      });
      setNavigationEditor(nextState);
      setNavigationDirty(false);
      const preferredIndex = nextState.preferredCategory
        ? nextState.categories.findIndex(
            (category) => category.title === nextState.preferredCategory,
          )
        : -1;
      setSelectedNavigationCategoryIndex(preferredIndex >= 0 ? preferredIndex : 0);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setNavigationLoading(false);
    }
  }

  async function openNavigationEditorFile() {
    const path = navigationEditor?.filePath;
    if (!path) {
      onOpenNavigationConfigFile();
      return;
    }
    try {
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function loadProjectWorkspaceEditor(workspaceKey = workspaceEditorKey) {
    setWorkspaceLoading(true);
    setError("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>("get_project_workspace_editor", {
        workspaceKey,
      });
      setWorkspaceEditor(nextState);
      setWorkspaceDraft(nextState.workspace);
      setWorkspaceEditorKey(nextState.workspace.key);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function saveProjectWorkspaceEditor() {
    if (!workspaceDraft || workspaceDraft.system) {
      return;
    }
    setWorkspaceSaving(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>(
        "save_project_workspace_editor",
        { draft: workspaceDraft },
      );
      setWorkspaceEditor(nextState);
      setWorkspaceDraft(nextState.workspace);
      setWorkspaceEditorKey(nextState.workspace.key);
      await onProjectConfigSaved();
      setStatus(t("已更新工作区 {name}", { name: nextState.workspace.name }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function applyProjectWorkspaceEditorState(nextState: ProjectWorkspaceEditorState) {
    setWorkspaceEditor(nextState);
    setWorkspaceDraft(nextState.workspace);
    setWorkspaceEditorKey(nextState.workspace.key);
  }

  async function createWorkspaceProjectCopy(projectKey: string) {
    if (!workspaceDraft || workspaceDraft.system) {
      return;
    }
    setWorkspaceDirectoryBusy(projectKey);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>(
        "create_project_workspace_project_copy",
        { workspaceKey: workspaceDraft.key, project: projectKey },
      );
      applyProjectWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      setStatus(t("已创建工作区副本"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceDirectoryBusy("");
    }
  }

  async function bindWorkspaceProjectDirectory(projectKey: string) {
    if (!workspaceDraft || workspaceDraft.system) {
      return;
    }
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: workspaceDraft.rootDir ?? undefined,
    });
    if (typeof selected !== "string" || !selected.trim()) {
      return;
    }
    setWorkspaceDirectoryBusy(projectKey);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>(
        "bind_project_workspace_project_directory",
        { workspaceKey: workspaceDraft.key, project: projectKey, path: selected },
      );
      applyProjectWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      setStatus(t("已绑定已有目录"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceDirectoryBusy("");
    }
  }

  async function unbindWorkspaceProjectDirectory(projectKey: string) {
    if (!workspaceDraft || workspaceDraft.system) {
      return;
    }
    setWorkspaceDirectoryBusy(projectKey);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>(
        "unbind_project_workspace_project_directory",
        { workspaceKey: workspaceDraft.key, project: projectKey },
      );
      applyProjectWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      setStatus(t("已恢复使用全局目录"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceDirectoryBusy("");
    }
  }

  async function chooseWorkspaceResourceDirectory(target: "create" | "edit") {
    const defaultPath =
      target === "create"
        ? newWorkspaceResourceDir.trim() || newWorkspaceRootDir.trim() || undefined
        : workspaceDraft?.resourceDir || workspaceDraft?.rootDir || undefined;
    const selected = await open({ directory: true, multiple: false, defaultPath });
    if (typeof selected !== "string" || !selected.trim()) {
      return;
    }
    if (target === "create") {
      setNewWorkspaceResourceDir(selected);
    } else {
      setWorkspaceDraft((current) =>
        current ? { ...current, resourceDir: selected } : current,
      );
    }
  }

  async function openWorkspaceProjectDirectory(path: string) {
    if (!path.trim() || path === "未配置项目目录") {
      return;
    }
    setError("");
    try {
      await invoke("open_local_path", { path });
      setStatus(t("已打开项目目录"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function copyWorkspaceProjectDirectory(path: string) {
    if (!path.trim() || path === "未配置项目目录") {
      return;
    }
    try {
      await copyPlainText(path);
      setStatus(t("已复制项目目录路径"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function handleCreateWorkspace() {
    const name = newWorkspaceName.trim();
    const key = normalizeWorkspaceKey(newWorkspaceKey || name);
    const description = newWorkspaceDescription.trim();
    if (!name) {
      setError(t("请填写工作区名称"));
      return;
    }
    if (!key) {
      setError(t("请填写工作区 key"));
      return;
    }
    setCreatingWorkspace(true);
    setError("");
    setStatus("");
    try {
      await onCreateProjectWorkspace({
        key,
        name,
        description: description || null,
        workspaceType: newWorkspaceType,
        rootDir: newWorkspaceIndependentDir ? newWorkspaceRootDir.trim() || null : null,
        resourceDir: newWorkspaceResourceDir.trim() || null,
        worklogFile: "WORKLOG.md",
        createWorklog: createWorkspaceWorklog,
        worklogAutoRecord: createWorkspaceWorklog && autoRecordWorkspaceWorklog,
        independentDir: newWorkspaceIndependentDir,
        copyCurrent: copyCurrentWorkspace,
        copyFromWorkspaceKey: workspaceDraft?.key ?? workspaceEditorKey,
        activate: false,
      });
      setNewWorkspaceName("");
      setNewWorkspaceKey("");
      setNewWorkspaceDescription("");
      setNewWorkspaceType(DEFAULT_NEW_WORKSPACE_TYPE);
      setNewWorkspaceIndependentDir(false);
      setNewWorkspaceRootDir("");
      setNewWorkspaceResourceDir("");
      setCreateWorkspaceWorklog(true);
      setAutoRecordWorkspaceWorklog(true);
      setCopyCurrentWorkspace(false);
      await loadProjectWorkspaceEditor(key);
      setStatus(t("已创建工作区 {name}", { name }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function handleCreateWorkspaceType(label: string) {
    try {
      const option = await addWorkspaceType(label);
      setStatus(t("已新增类型 {name}", { name: option.label }));
      return option;
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function handleRemoveWorkspaceType(
    optionKey: string,
    label: string,
    updateDraft?: (patch: Partial<ProjectWorkspaceEditorDraft>) => void,
  ) {
    const usedCount = workspaceTypeUsageCounts.get(optionKey) ?? 0;
    if (usedCount > 0) {
      setError(t("已有 {count} 个工作区使用 {name}", { count: usedCount, name: label }));
      return;
    }
    try {
      await removeWorkspaceType(optionKey);
      if (newWorkspaceType === optionKey) {
        setNewWorkspaceType(DEFAULT_NEW_WORKSPACE_TYPE);
      }
      if (workspaceDraft?.workspaceType === optionKey) {
        const fallbackTypePatch = {
          workspaceType: DEFAULT_NEW_WORKSPACE_TYPE,
          workspaceTypeLabel: workspaceTypeLabel(
            DEFAULT_NEW_WORKSPACE_TYPE,
            null,
            workspaceTypeOptions,
          ),
        };
        if (updateDraft) {
          updateDraft(fallbackTypePatch);
        } else {
          setWorkspaceDraft((current) =>
            current?.workspaceType === optionKey ? { ...current, ...fallbackTypePatch } : current,
          );
        }
      }
      setStatus(t("已删除类型 {name}", { name: label }));
    } catch (reason) {
      setError(String(reason));
    }
  }

  function switchProjectWorkspace(workspaceKey: string) {
    const currentKey = workspaceDraft?.key ?? workspaceEditorKey;
    if (!workspaceKey || workspaceKey === currentKey) {
      return;
    }
    const workspaceName =
      projectWorkspaces.find((workspace) => workspace.key === workspaceKey)?.name ?? workspaceKey;
    if (workspaceDirty) {
      setConfirmState({
        title: t("切换配置对象？"),
        message: t("当前配置有未保存修改，查看「{name}」会丢弃这些修改。", {
          name: workspaceName,
        }),
        confirmLabel: t("查看"),
        onConfirm: () => switchProjectWorkspaceConfirmed(workspaceKey),
      });
      return;
    }
    void switchProjectWorkspaceConfirmed(workspaceKey);
  }

  async function switchProjectWorkspaceConfirmed(workspaceKey: string) {
    setError("");
    setStatus("");
    try {
      await loadProjectWorkspaceEditor(workspaceKey);
    } catch (reason) {
      setError(String(reason));
    }
  }

  useEffect(() => {
    if (surface !== "projectManagement") {
      return;
    }
    void (async () => {
      try {
        const result = await refreshRuntimeConfigSources();
        await loadProjectConfig(selectedKey || selectedProjectKey, result?.sourceId ?? "default");
      } catch (reason) {
        setError(String(reason));
        await loadProjectConfig(selectedKey || selectedProjectKey, "default");
      }
    })();
  }, [preferredRuntimeConfigSourceId, surface]);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(
        surface === "projectManagement"
          ? normalizeProjectManagementSection(initialSection)
          : normalizeSettingsSection(initialSection),
      );
    }
  }, [initialSection, surface]);

  useEffect(() => {
    document.documentElement.classList.add("settings-scroll-lock");
    document.body.classList.add("settings-scroll-lock");
    return () => {
      document.documentElement.classList.remove("settings-scroll-lock");
      document.body.classList.remove("settings-scroll-lock");
    };
  }, []);

  useEffect(() => {
    if (!editorState || selectedKey) {
      return;
    }
    setSelectedKey(selectedProjectKey || editorState.projects[0]?.key || "");
  }, [editorState, selectedKey, selectedProjectKey]);

  useEffect(() => {
    setSelectedDeployTargetIndex(0);
    setSelectedDebugProfileIndex(0);
  }, [selectedProject?.key]);

  useEffect(() => {
    const targetCount = selectedProject?.deployTargets.length ?? 0;
    if (targetCount === 0) {
      setSelectedDeployTargetIndex(0);
      return;
    }
    setSelectedDeployTargetIndex((current) =>
      Math.min(Math.max(current, 0), targetCount - 1),
    );
  }, [selectedProject?.deployTargets.length]);

  useEffect(() => {
    const profileCount = selectedProject?.debugProfiles?.length ?? 0;
    if (profileCount === 0) {
      setSelectedDebugProfileIndex(0);
      return;
    }
    setSelectedDebugProfileIndex((current) =>
      Math.min(Math.max(current, 0), profileCount - 1),
    );
  }, [selectedProject?.debugProfiles?.length]);

  useEffect(() => {
    const categoryCount = navigationEditor?.categories.length ?? 0;
    if (categoryCount === 0) {
      setSelectedNavigationCategoryIndex(0);
      return;
    }
    setSelectedNavigationCategoryIndex((current) =>
      Math.min(Math.max(current, 0), categoryCount - 1),
    );
  }, [navigationEditor?.categories.length]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeTab = panelRef.current?.querySelector<HTMLElement>(
        '.settings-section-nav [role="tab"][aria-selected="true"]',
      );
      activeTab?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      openerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Tab" &&
        !runtimeConfigSourceManagerOpen &&
        !confirmState
      ) {
        const focusable = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.hasAttribute("hidden"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          panelRef.current?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape") {
        if (runtimeConfigSourceManagerOpen) {
          return;
        }
        if (confirmState) {
          setConfirmState(null);
          return;
        }
        requestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmState, hasUnsavedChanges, onClose, runtimeConfigSourceManagerOpen]);

  function requestClose() {
    if (hasUnsavedChanges) {
      setConfirmState({
        title: t("关闭设置？"),
        message: t("当前有未保存的配置修改，关闭后这些修改不会生效。"),
        confirmLabel: t("关闭"),
        onConfirm: onClose,
      });
      return;
    }
    onClose();
  }

  async function runConfirmAction() {
    const action = confirmState?.onConfirm;
    if (!action) {
      return;
    }
    setConfirmState(null);
    await action();
  }

  function markDirty(key: string) {
    setDirtyKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  function markDeployProjectDirty(projectKey: string) {
    setDirtyDeployProjectKeys((current) => {
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }

  function applyProjectEditorState(nextState: ProjectConfigEditorState) {
    setEditorState((current) => {
      if (!current) {
        return nextState;
      }
      return {
        ...nextState,
        runtimeProfiles: current.runtimeProfiles,
        runtimeConfigPath: current.runtimeConfigPath,
        runtimeProfileScope: current.runtimeProfileScope,
        defaultBranchRules: defaultBranchRulesDirty
          ? current.defaultBranchRules
          : nextState.defaultBranchRules,
      };
    });
  }

  async function handleRuntimeConfigSourceChange(nextSourceId: string) {
    if (nextSourceId === selectedRuntimeConfigSourceId || runtimeConfigSourceBusy) {
      return;
    }
    if (hasUnsavedChanges) {
      setError(t("请先保存或取消当前项目改动，再切换运行环境配置源。"));
      return;
    }
    setError("");
    try {
      const source = await selectRuntimeConfigSource(nextSourceId);
      if (!source) return;
      await loadProjectConfig(selectedKey, source.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function updateSelectedProject(updater: (project: ProjectConfigDraft) => ProjectConfigDraft) {
    if (!selectedProject) {
      return;
    }
    setEditorState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) =>
          project.key === selectedProject.key ? updater(project) : project,
        ),
      };
    });
    markDirty(selectedProject.key);
  }

  function updateDefaultBranchRules(patch: Partial<ProjectBranchRulesDraft>) {
    setEditorState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        defaultBranchRules: {
          ...current.defaultBranchRules,
          ...patch,
        },
      };
    });
    setDefaultBranchRulesDirty(true);
  }

  function updateSelectedProjectBranchRules(patch: Partial<ProjectBranchRulesDraft>) {
    updateSelectedProject((project) => ({
      ...project,
      branchRules: {
        ...project.branchRules,
        ...patch,
      },
    }));
  }

  function useDefaultBranchRulesForProject() {
    updateSelectedProject((project) => ({
      ...project,
      branchRules: {
        sourceKeywords: [],
        targetKeywords: [],
      },
    }));
    setStatus(t("当前项目将继承默认分支规则，保存后生效"));
  }

  function updateCommand(
    commandKey: "dev" | "build",
    patch: Partial<ProjectCommandConfigDraft>,
  ) {
    updateSelectedProject((project) => ({
      ...project,
      [commandKey]: {
        ...commandValue(project[commandKey]),
        ...patch,
      },
    }));
  }

  function updateDebugProfiles(
    updater: (profiles: ProjectDebugProfileDraft[]) => ProjectDebugProfileDraft[],
  ) {
    updateSelectedProject((project) => ({
      ...project,
      debugProfiles: updater(project.debugProfiles ?? []),
    }));
  }

  function addDebugProfile() {
    if (!selectedProject) {
      return;
    }
    const profiles = selectedProject.debugProfiles ?? [];
    const nextProfile = emptyDebugProfile(profiles.map((profile) => profile.key));
    updateDebugProfiles((current) => [...current, nextProfile]);
    setSelectedDebugProfileIndex(profiles.length);
    setStatus(t("已新增项目启动档案，保存后生效"));
  }

  function updateDebugProfileAt(
    profileIndex: number,
    patch: Partial<ProjectDebugProfileDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) =>
        index === profileIndex ? { ...profile, ...patch } : profile,
      ),
    );
  }

  function updateDebugProfileNetworkProxy(
    profileIndex: number,
    patch: Partial<ProjectNetworkProxyDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) =>
        index === profileIndex
          ? {
              ...profile,
              networkProxy: {
                ...emptyNetworkProxy(),
                ...(profile.networkProxy ?? {}),
                ...patch,
              },
            }
          : profile,
      ),
    );
  }

  function updateDebugProfileLocalProxy(
    profileIndex: number,
    patch: Partial<ProjectLocalProxyDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) =>
        index === profileIndex
          ? {
              ...profile,
              localProxy: {
                ...emptyLocalProxy(),
                ...(profile.localProxy ?? {}),
                ...patch,
              },
            }
          : profile,
      ),
    );
  }

  function updateDebugProfileAuthHelper(
    profileIndex: number,
    patch: Partial<ProjectAuthHelperDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            authHelper: {
              ...emptyAuthHelper(),
              ...(localProxy.authHelper ?? {}),
              ...patch,
            },
          },
        };
      }),
    );
  }

  function addLocalProxyRoute(profileIndex: number) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            routes: [...(localProxy.routes ?? []), emptyLocalProxyRoute()],
          },
        };
      }),
    );
  }

  function updateLocalProxyRouteAt(
    profileIndex: number,
    routeIndex: number,
    patch: Partial<ProjectLocalProxyRouteDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            routes: (localProxy.routes ?? []).map((route, nextRouteIndex) =>
              nextRouteIndex === routeIndex ? { ...route, ...patch } : route,
            ),
          },
        };
      }),
    );
  }

  function deleteLocalProxyRouteAt(profileIndex: number, routeIndex: number) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            routes: (localProxy.routes ?? []).filter((_, index) => index !== routeIndex),
          },
        };
      }),
    );
  }

  function addAuthHelperItem(profileIndex: number) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        const authHelper = {
          ...emptyAuthHelper(),
          ...(localProxy.authHelper ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            authHelper: {
              ...authHelper,
              items: [...(authHelper.items ?? []), emptyAuthHelperItem()],
            },
          },
        };
      }),
    );
  }

  function updateAuthHelperItemAt(
    profileIndex: number,
    itemIndex: number,
    patch: Partial<ProjectAuthHelperItemDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        const authHelper = {
          ...emptyAuthHelper(),
          ...(localProxy.authHelper ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            authHelper: {
              ...authHelper,
              items: (authHelper.items ?? []).map((item, nextItemIndex) =>
                nextItemIndex === itemIndex ? { ...item, ...patch } : item,
              ),
            },
          },
        };
      }),
    );
  }

  function deleteAuthHelperItemAt(profileIndex: number, itemIndex: number) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }
        const localProxy = {
          ...emptyLocalProxy(),
          ...(profile.localProxy ?? {}),
        };
        const authHelper = {
          ...emptyAuthHelper(),
          ...(localProxy.authHelper ?? {}),
        };
        return {
          ...profile,
          localProxy: {
            ...localProxy,
            authHelper: {
              ...authHelper,
              items: (authHelper.items ?? []).filter((_, index) => index !== itemIndex),
            },
          },
        };
      }),
    );
  }

  function deleteDebugProfileAt(profileIndex: number) {
    const profiles = selectedProject?.debugProfiles ?? [];
    const nextIndex = Math.max(0, Math.min(profileIndex, profiles.length - 2));
    updateDebugProfiles((current) => current.filter((_, index) => index !== profileIndex));
    setSelectedDebugProfileIndex(nextIndex);
  }

  function addDebugLocalFile(profileIndex: number) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) =>
        index === profileIndex
          ? {
              ...profile,
              localFiles: [...(profile.localFiles ?? []), emptyDebugLocalFile()],
            }
          : profile,
      ),
    );
  }

  function updateDebugLocalFileAt(
    profileIndex: number,
    fileIndex: number,
    patch: Partial<ProjectDebugLocalFileDraft>,
  ) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) =>
        index === profileIndex
          ? {
              ...profile,
              localFiles: (profile.localFiles ?? []).map((file, nextFileIndex) =>
                nextFileIndex === fileIndex ? { ...file, ...patch } : file,
              ),
            }
          : profile,
      ),
    );
  }

  function deleteDebugLocalFileAt(profileIndex: number, fileIndex: number) {
    updateDebugProfiles((profiles) =>
      profiles.map((profile, index) =>
        index === profileIndex
          ? {
              ...profile,
              localFiles: (profile.localFiles ?? []).filter(
                (_, nextFileIndex) => nextFileIndex !== fileIndex,
              ),
            }
          : profile,
      ),
    );
  }

  function updateNavigationEditor(
    updater: (current: NavigationEditorState) => NavigationEditorState,
  ) {
    setNavigationEditor((current) => {
      if (!current) {
        return current;
      }
      return updater(current);
    });
    setNavigationDirty(true);
  }

  function updateNavigationCategoryAt(
    categoryIndex: number,
    patch: Partial<NavigationEditorCategory>,
  ) {
    updateNavigationEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) =>
        index === categoryIndex ? { ...category, ...patch } : category,
      ),
    }));
  }

  function addNavigationCategory() {
    const categories = navigationEditor?.categories ?? [];
    const title = uniqueNavigationCategoryTitle(categories);
    const nextIndex = categories.length;
    updateNavigationEditor((current) => ({
      ...current,
      preferredCategory: current.preferredCategory || title,
      categories: [
        ...current.categories,
        {
          title,
          shortLabel: "入口",
          entries: [emptyNavigationEntry()],
        },
      ],
    }));
    setSelectedNavigationCategoryIndex(nextIndex);
  }

  function deleteNavigationCategoryAt(categoryIndex: number) {
    const category = navigationEditor?.categories[categoryIndex];
    if (!category) {
      return;
    }
    if (category.entries.length > 0) {
      setConfirmState({
        title: t("删除访达分类？"),
        message: t("将删除「{name}」以及里面的入口。", {
          name: category.title || t("未命名"),
        }),
        confirmLabel: t("删除"),
        tone: "danger",
        onConfirm: () => deleteNavigationCategoryConfirmed(categoryIndex),
      });
      return;
    }
    deleteNavigationCategoryConfirmed(categoryIndex);
  }

  function deleteNavigationCategoryConfirmed(categoryIndex: number) {
    const nextIndex = Math.max(
      0,
      Math.min(categoryIndex, (navigationEditor?.categories.length ?? 1) - 2),
    );
    updateNavigationEditor((current) => {
      const categories = current.categories.filter((_, index) => index !== categoryIndex);
      const preferredCategory = categories.some(
        (item) => item.title === current.preferredCategory,
      )
        ? current.preferredCategory
        : categories[0]?.title ?? null;
      return {
        ...current,
        preferredCategory,
        categories,
      };
    });
    setSelectedNavigationCategoryIndex(nextIndex);
  }

  function addNavigationEntry(
    categoryIndex: number,
    kind: NavigationEditorEntryKind = "url",
  ) {
    updateNavigationEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) =>
        index === categoryIndex
          ? {
              ...category,
              entries: [...category.entries, emptyNavigationEntry(kind)],
            }
          : category,
      ),
    }));
  }

  function updateNavigationEntryAt(
    categoryIndex: number,
    entryIndex: number,
    patch: Partial<NavigationEditorEntry>,
  ) {
    updateNavigationEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) => {
        if (index !== categoryIndex) {
          return category;
        }
        return {
          ...category,
          entries: category.entries.map((entry, nextEntryIndex) =>
            nextEntryIndex === entryIndex ? { ...entry, ...patch } : entry,
          ),
        };
      }),
    }));
  }

  function deleteNavigationEntryAt(categoryIndex: number, entryIndex: number) {
    updateNavigationEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) =>
        index === categoryIndex
          ? {
              ...category,
              entries: category.entries.filter((_, nextEntryIndex) => nextEntryIndex !== entryIndex),
            }
          : category,
      ),
    }));
  }

  async function chooseNavigationPath(
    categoryIndex: number,
    entryIndex: number,
    directory: boolean,
  ) {
    try {
      const selected = await open({
        title: t(directory ? "选择目录入口" : "选择文件入口"),
        multiple: false,
        directory,
      });
      if (typeof selected !== "string") {
        return;
      }
      updateNavigationEntryAt(categoryIndex, entryIndex, {
        path: selected,
      });
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  }

  function updateDeployTargets(
    updater: (deployTargets: DeployTargetConfigSummary[]) => DeployTargetConfigSummary[],
  ) {
    if (!selectedProject) {
      return;
    }
    setEditorState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.key !== selectedProject.key) {
            return project;
          }
          return {
            ...project,
            deployTargets: updater(project.deployTargets),
          };
        }),
      };
    });
    markDeployProjectDirty(selectedProject.key);
  }

  function updateDeployTargetAt(
    targetIndex: number,
    patch: Partial<DeployTargetConfigSummary>,
  ) {
    updateDeployTargets((deployTargets) =>
      deployTargets.map((target, index) =>
        index === targetIndex ? { ...target, ...patch } : target,
      ),
    );
  }

  function updateDeployTargetAdapterAt(
    targetIndex: number,
    adapter: DeployTargetConfigSummary["adapter"],
  ) {
    const current = selectedProject?.deployTargets[targetIndex];
    updateDeployTargetAt(targetIndex, {
      adapter,
      actionKind: defaultBuildActionKindForAdapter(adapter),
      jenkinsProfile:
        adapter === "jenkins" ? current?.jenkinsProfile || jenkinsProfileOptions[0] || "" : "",
    });
  }

  function updateDeployParamAt(
    targetIndex: number,
    paramIndex: number,
    patch: Partial<DeployParamConfigSummary>,
  ) {
    updateDeployTargets((deployTargets) =>
      deployTargets.map((target, index) => {
        if (index !== targetIndex) {
          return target;
        }
        return {
          ...target,
          params: target.params.map((param, nextParamIndex) =>
            nextParamIndex === paramIndex ? { ...param, ...patch } : param,
          ),
        };
      }),
    );
  }

  function addDeployTarget() {
    const nextIndex = selectedProject?.deployTargets.length ?? 0;
    updateDeployTargets((deployTargets) => [
      ...deployTargets,
      {
        key: uniqueConfigKey("build", deployTargets.map((target) => target.key)),
        label: "新构建配置",
        adapter: "local_command",
        actionKind: "build",
        jenkinsProfile: "",
        jobName: "",
        artifactOutputDir: null,
        params: [],
      },
    ]);
    setSelectedDeployTargetIndex(nextIndex);
  }

  function duplicateDeployTargetAt(targetIndex: number) {
    if (!selectedProject) {
      return;
    }
    updateDeployTargets((deployTargets) => {
      const source = deployTargets[targetIndex];
      if (!source) {
        return deployTargets;
      }
      const nextKey = uniqueCopiedConfigKey(
        source.key || "build",
        deployTargets.map((target) => target.key),
      );
      const nextLabel = `${source.label || source.key || "构建配置"} 副本`;
      const copiedTarget: DeployTargetConfigSummary = {
        ...source,
        key: nextKey,
        label: nextLabel,
        params: source.params.map((param) => ({
          ...param,
          options: [...param.options],
          impactPaths: [...param.impactPaths],
        })),
      };

      return [
        ...deployTargets.slice(0, targetIndex + 1),
        copiedTarget,
        ...deployTargets.slice(targetIndex + 1),
      ];
    });
    setSelectedDeployTargetIndex(targetIndex + 1);
    setError("");
    setStatus(t("已复制构建配置，调整 Key 和名称后保存"));
  }

  function deleteDeployTargetAt(targetIndex: number) {
    const nextIndex = Math.max(
      0,
      Math.min(targetIndex, (selectedProject?.deployTargets.length ?? 1) - 2),
    );
    updateDeployTargets((deployTargets) =>
      deployTargets.filter((_, index) => index !== targetIndex),
    );
    setSelectedDeployTargetIndex(nextIndex);
  }

  function setDeployTargetAsDefault(targetIndex: number) {
    if (targetIndex <= 0) {
      return;
    }
    updateDeployTargets((deployTargets) => {
      const target = deployTargets[targetIndex];
      if (!target) {
        return deployTargets;
      }
      return [
        target,
        ...deployTargets.slice(0, targetIndex),
        ...deployTargets.slice(targetIndex + 1),
      ];
    });
    setSelectedDeployTargetIndex(0);
    setStatus(t("已设为默认构建配置，保存后生效"));
  }

  function addDeployParam(targetIndex: number) {
    const target = selectedProject?.deployTargets[targetIndex];
    if (!target) {
      return;
    }
    updateDeployTargets((deployTargets) =>
      deployTargets.map((item, index) =>
        index === targetIndex
          ? {
              ...item,
              params: [
                ...item.params,
                {
                  key: uniqueConfigKey(
                    "param",
                    item.params.map((param) => param.key),
                  ),
                  label: "新参数",
                  kind: "text",
                  defaultValue: "",
                  options: [],
                  required: false,
                  trueValue: null,
                  falseValue: null,
                  impactPaths: [],
                },
              ],
            }
          : item,
      ),
    );
  }

  function addDeployParamPresets(targetIndex: number, presets: DeployParamConfigSummary[]) {
    const target = selectedProject?.deployTargets[targetIndex];
    if (!target) {
      return;
    }
    const missingParams = missingBuildParamPresets(target, presets);
    if (missingParams.length === 0) {
      setStatus(t("参数已完整"));
      return;
    }
    updateDeployTargets((deployTargets) =>
      deployTargets.map((item, index) =>
        index === targetIndex
          ? {
              ...item,
              params: [
                ...item.params,
                ...missingParams.map((param) => ({
                  ...param,
                  options: [...param.options],
                  impactPaths: [...param.impactPaths],
                })),
              ],
            }
          : item,
      ),
    );
    setStatus(t("已补齐 {count} 个参数，保存后生效", { count: missingParams.length }));
  }

  function deleteDeployParamAt(targetIndex: number, paramIndex: number) {
    updateDeployTargets((deployTargets) =>
      deployTargets.map((target, index) =>
        index === targetIndex
          ? {
              ...target,
              params: target.params.filter((_, nextParamIndex) => nextParamIndex !== paramIndex),
            }
          : target,
      ),
    );
  }

  async function saveSelectedProject() {
    if (!selectedProject) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("save_project_config_basics", {
        request: {
          ...selectedProject,
          debugProfiles: selectedProject.debugProfiles ?? [],
        },
      });
      applyProjectEditorState(nextState);
      setDirtyKeys((current) => {
        const next = new Set(current);
        next.delete(selectedProject.key);
        return next;
      });
      setSelectedKey(selectedProject.key);
      await onProjectConfigSaved();
      setStatus(t("已保存项目配置"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveDefaultBranchRules() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("save_default_branch_rules", {
        request: {
          branchRules: defaultBranchRules,
        },
      });
      setEditorState(nextState);
      setDefaultBranchRulesDirty(false);
      await onProjectConfigSaved();
      setStatus(t("已保存默认分支规则"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function addProject() {
    const key = newProjectKey.trim();
    const name = newProjectName.trim();
    if (!key || !name) {
      setError(t("项目 key 和名称不能为空"));
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("add_project_config", {
        request: { key, name },
      });
      applyProjectEditorState(nextState);
      setDirtyKeys(new Set());
      setDirtyDeployProjectKeys(new Set());
      setSelectedKey(key);
      setNewProjectKey("");
      setNewProjectName("");
      await onProjectConfigSaved();
      setStatus(t("已新增项目"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedProject() {
    if (!selectedProject) {
      return;
    }
    const projectName = selectedProject.name || selectedProject.key;
    setConfirmState({
      title: t("删除项目配置？"),
      message: t("将删除「{name}」的项目配置。", {
        name: projectName,
      }),
      confirmLabel: t("删除"),
      tone: "danger",
      onConfirm: deleteSelectedProjectConfirmed,
    });
  }

  async function deleteSelectedProjectConfirmed() {
    if (!selectedProject) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const deletedKey = selectedProject.key;
      const nextState = await invoke<ProjectConfigEditorState>("delete_project_config", {
        request: { key: deletedKey },
      });
      applyProjectEditorState(nextState);
      setDirtyKeys(new Set());
      setDirtyDeployProjectKeys(new Set());
      setSelectedKey(nextState.projects[0]?.key ?? "");
      await onProjectConfigSaved();
      setStatus(t("已删除项目配置"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveDeployTargets() {
    if (!selectedProject) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const projectKey = selectedProject.key;
      const nextState = await invoke<ProjectConfigEditorState>("save_project_deploy_targets", {
        request: {
          projectKey,
          deployTargets: selectedProject.deployTargets,
        },
      });
      applyProjectEditorState(nextState);
      setDirtyDeployProjectKeys((current) => {
        const next = new Set(current);
        next.delete(projectKey);
        return next;
      });
      setSelectedKey(projectKey);
      await onProjectConfigSaved();
      setStatus(t("已保存构建配置"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveNavigationEditor() {
    if (!navigationEditor) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await invoke("save_navigation_editor", {
        sourceId: navigationConfigSourceId,
        data: navigationEditor,
      });
      const nextState = await invoke<NavigationEditorState>("get_navigation_editor", {
        sourceId: navigationConfigSourceId,
      });
      setNavigationEditor(nextState);
      setNavigationDirty(false);
      await onProjectConfigSaved();
      setStatus(t("已保存访达配置"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  function handleMenuEnabledChange(page: PageKey, enabled: boolean) {
    const nextEnabledPages = SETTINGS_ALL_PAGE_KEYS.filter((item) =>
      item === page ? enabled : enabledPages.includes(item),
    );
    if (nextEnabledPages.length === 0) {
      return;
    }
    onEnabledPagesChange(nextEnabledPages);
    if (!nextEnabledPages.includes(defaultPage)) {
      onDefaultPageChange(nextEnabledPages[0]);
    }
  }

  function renderWorkspaceScopeEditor() {
    if (workspaceLoading && !workspaceDraft) {
      return (
        <div className="settings-list-row">
          <span className="settings-list-icon">
            <RefreshIcon fontSize="small" />
          </span>
          <div className="settings-overview-copy">
            <Typography variant="subtitle2">{t("当前工作区")}</Typography>
            <Typography variant="caption">{t("正在读取范围配置")}</Typography>
          </div>
        </div>
      );
    }
    if (!workspaceEditor || !workspaceDraft) {
      return null;
    }

    const projectTotal = workspaceEditor.projects.length;
    const entryTotal = workspaceEditor.navigationCategories.reduce(
      (total, category) => total + category.entries.length,
      0,
    );
    const navigationTotal = workspaceEditor.navigationCategories.length + entryTotal;
    const proxyTotal = workspaceEditor.proxyProfiles.length;
    const selectedProjects = selectedCount(
      workspaceDraft.projects,
      projectTotal,
      workspaceDraft.includeAllProjects,
    );
    const selectedNavigation = selectedCount(
      [...workspaceDraft.navigationCategories, ...workspaceDraft.navigationEntries],
      navigationTotal,
      workspaceDraft.includeAllNavigation,
    );
    const selectedProxyProfiles = workspaceDraft.system
      ? proxyTotal
      : workspaceDraft.proxyProfiles.length;
    const instanceByProject = new Map(
      workspaceDraft.projectInstances.map((instance) => [instance.project, instance]),
    );
    const scopedProjects = workspaceEditor.projects.filter(
      (project) =>
        workspaceDraft.includeAllProjects || workspaceDraft.projects.includes(project.key),
    );
    const directoryBusy = Boolean(workspaceDirectoryBusy);
    const updateDraft = (patch: Partial<ProjectWorkspaceEditorDraft>) => {
      setWorkspaceDraft((current) => (current ? { ...current, ...patch } : current));
    };

    return (
      <div className="settings-list-row settings-workspace-editor-row">
        <span className="settings-list-icon">
          <FolderIcon fontSize="small" />
        </span>
        <div className="settings-workspace-editor">
          <div className="settings-workspace-editor-head">
            <div className="settings-overview-copy">
              <Typography component="span" variant="subtitle2">
                {t("当前工作区")}
              </Typography>
              <Typography component="span" variant="caption">
                {workspaceDraft.key}
              </Typography>
            </div>
            <div className="settings-workspace-editor-actions">
              <Chip
                className="settings-workspace-stat"
                size="small"
                label={
                  workspaceDraft.system
                    ? t("全局")
                    : t("{selected}/{total} 项目", {
                        selected: selectedProjects,
                        total: projectTotal,
                      })
                }
              />
              {!workspaceDraft.system ? (
                <Chip
                  className="settings-workspace-stat"
                  size="small"
                  label={workspaceTypeLabel(
                    workspaceDraft.workspaceType,
                    workspaceDraft.workspaceTypeLabel,
                    workspaceTypeOptions,
                  )}
                />
              ) : null}
              {!workspaceDraft.system ? (
                <Chip
                  className="settings-workspace-stat"
                  size="small"
                  label={t("{selected}/{total} 入口", {
                    selected: selectedNavigation,
                    total: navigationTotal,
                  })}
                />
              ) : null}
              {!workspaceDraft.system ? (
                <Chip
                  className="settings-workspace-stat"
                  size="small"
                  label={t("{selected}/{total} 代理", {
                    selected: selectedProxyProfiles,
                    total: proxyTotal,
                  })}
                />
              ) : null}
              {!workspaceDraft.system && workspaceDraft.projectInstances.length > 0 ? (
                <Chip
                  className="settings-workspace-stat"
                  size="small"
                  label={t("{count} 实例", {
                    count: workspaceDraft.projectInstances.length,
                  })}
                />
              ) : null}
              <Button
                variant="contained"
                size="small"
                startIcon={<CheckIcon fontSize="small" />}
                onClick={() => void saveProjectWorkspaceEditor()}
                disabled={workspaceDraft.system || workspaceSaving || !workspaceDirty}
              >
                {t("保存")}
              </Button>
            </div>
          </div>
          {workspaceDraft.system ? (
            <Typography className="settings-workspace-system-note" variant="caption">
              {t("全局工作区显示全部项目、入口和代理。")}
            </Typography>
          ) : (
            <>
              <div className="settings-workspace-meta-grid">
                <TextField
                  size="small"
                  label={t("名称")}
                  value={workspaceDraft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  disabled={workspaceSaving}
                />
                <WorkspaceTypeSelect
                  value={workspaceDraft.workspaceType}
                  options={workspaceTypeSelectOptions}
                  usageCounts={workspaceTypeUsageCounts}
                  disabled={workspaceSaving}
                  onChange={(key, nextLabel) =>
                    updateDraft({
                      workspaceType: key,
                      workspaceTypeLabel: nextLabel,
                    })
                  }
                  onCreate={handleCreateWorkspaceType}
                  onDelete={(key, nextLabel) =>
                    handleRemoveWorkspaceType(key, nextLabel, updateDraft)
                  }
                />
                <TextField
                  size="small"
                  label={t("备注")}
                  value={workspaceDraft.description ?? ""}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  disabled={workspaceSaving}
                />
                <TextField
                  size="small"
                  label={t("工作区目录")}
                  value={workspaceDraft.rootDir ?? ""}
                  placeholder={t("留空为轻量范围工作区")}
                  onChange={(event) => updateDraft({ rootDir: event.target.value })}
                  disabled={workspaceSaving}
                />
                <TextField
                  size="small"
                  label={t("资料目录")}
                  value={workspaceDraft.resourceDir ?? ""}
                  placeholder={t("默认：工作区目录/resources")}
                  onChange={(event) => updateDraft({ resourceDir: event.target.value })}
                  disabled={workspaceSaving}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label={t("选择资料目录")}
                          onClick={() => void chooseWorkspaceResourceDirectory("edit")}
                          disabled={workspaceSaving}
                        >
                          <FolderIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  size="small"
                  label={t("工作日志文件")}
                  value={workspaceDraft.worklogFile ?? "WORKLOG.md"}
                  onChange={(event) => updateDraft({ worklogFile: event.target.value })}
                  disabled={workspaceSaving}
                />
                <FormControlLabel
                  className="settings-workspace-copy"
                  control={
                    <Checkbox
                      size="small"
                      checked={workspaceDraft.worklogAutoRecord}
                      onChange={(event) =>
                        updateDraft({ worklogAutoRecord: event.target.checked })
                      }
                      disabled={workspaceSaving || !workspaceDraft.resourceDir}
                    />
                  }
                  label={t("自动记录关键操作")}
                />
              </div>
              <div className="settings-workspace-project-dir-list">
                <div className="settings-workspace-project-dir-head">
                  <Typography variant="caption">{t("项目目录")}</Typography>
                  <Typography className="settings-workspace-scope-hint" variant="caption">
                    {t("全局目录 / 工作区副本 / 绑定目录")}
                  </Typography>
                </div>
                {scopedProjects.length > 0 ? (
                  scopedProjects.map((project) => {
                    const instance = instanceByProject.get(project.key);
                    const modeLabel = instance
                      ? instance.managed
                        ? t("工作区副本")
                        : t("绑定目录")
                      : t("使用全局目录");
                    const path = instance?.path || project.repoPath || "";
                    const busy = workspaceDirectoryBusy === project.key;
                    const canUsePath = Boolean(path.trim());
                    return (
                      <div key={project.key} className="settings-workspace-project-dir-row">
                        <div className="settings-workspace-project-dir-main">
                          <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                            <Typography variant="subtitle2">
                              {project.name || project.key}
                            </Typography>
                            <Chip size="small" label={modeLabel} variant="outlined" />
                            {instance?.managed ? (
                              <Chip size="small" label={t("托管")} variant="outlined" />
                            ) : null}
                          </Stack>
                          <Typography className="settings-workspace-project-dir-path" variant="caption">
                            {path || t("未配置项目目录")}
                          </Typography>
                        </div>
                        <div className="settings-workspace-project-dir-actions">
                          <Tooltip title={t("打开目录")}>
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => void openWorkspaceProjectDirectory(path)}
                                disabled={!canUsePath || workspaceSaving}
                                aria-label={t("打开项目目录")}
                              >
                                <OpenExternalIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t("复制路径")}>
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => void copyWorkspaceProjectDirectory(path)}
                                disabled={!canUsePath || workspaceSaving}
                                aria-label={t("复制项目目录路径")}
                              >
                                <CopyIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {instance ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => void unbindWorkspaceProjectDirectory(project.key)}
                              disabled={workspaceSaving || directoryBusy}
                            >
                              {busy ? t("处理中") : t("解绑")}
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => void createWorkspaceProjectCopy(project.key)}
                                disabled={
                                  workspaceSaving ||
                                  directoryBusy ||
                                  !workspaceDraft.rootDir ||
                                  !project.repoPath
                                }
                              >
                                {busy ? t("创建中") : t("创建副本")}
                              </Button>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => void bindWorkspaceProjectDirectory(project.key)}
                                disabled={workspaceSaving || directoryBusy}
                              >
                                {t("绑定目录")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Typography className="settings-workspace-system-note" variant="caption">
                    {t("先在项目范围里选择项目，再配置项目目录策略。")}
                  </Typography>
                )}
              </div>
              <div className="settings-workspace-scope-grid">
                <section className="settings-workspace-scope-pane">
                  <header className="settings-workspace-scope-head">
                    <Typography variant="caption">{t("项目")}</Typography>
                    <FormControlLabel
                      className="settings-workspace-copy"
                      control={
                        <Checkbox
                          size="small"
                          checked={workspaceDraft.includeAllProjects}
                          onChange={(event) =>
                            updateDraft({
                              includeAllProjects: event.target.checked,
                              projects: event.target.checked ? [] : workspaceDraft.projects,
                            })
                          }
                          disabled={workspaceSaving}
                        />
                      }
                      label={t("全部")}
                    />
                  </header>
                  {!workspaceDraft.includeAllProjects ? (
                    <div className="settings-workspace-check-list">
                      {workspaceEditor.projects.map((project) => {
                        const checked = workspaceDraft.projects.includes(project.key);
                        return (
                          <FormControlLabel
                            key={project.key}
                            className="settings-workspace-check"
                            control={
                              <Checkbox
                                size="small"
                                checked={checked}
                                onChange={(event) =>
                                  updateDraft({
                                    projects: toggleStringValue(
                                      workspaceDraft.projects,
                                      project.key,
                                      event.target.checked,
                                    ),
                                  })
                                }
                                disabled={workspaceSaving}
                              />
                            }
                            label={`${project.name || project.key} · ${project.category}`}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </section>

                <section className="settings-workspace-scope-pane">
                  <header className="settings-workspace-scope-head">
                    <span>
                      <Typography variant="caption">{t("入口")}</Typography>
                      <Typography className="settings-workspace-scope-hint" variant="caption">
                        {t("网站 / 目录 / 工具")}
                      </Typography>
                    </span>
                    <FormControlLabel
                      className="settings-workspace-copy"
                      control={
                        <Checkbox
                          size="small"
                          checked={workspaceDraft.includeAllNavigation}
                          onChange={(event) =>
                            updateDraft({
                              includeAllNavigation: event.target.checked,
                              navigationCategories: event.target.checked
                                ? []
                                : workspaceDraft.navigationCategories,
                              navigationEntries: event.target.checked
                                ? []
                                : workspaceDraft.navigationEntries,
                            })
                          }
                          disabled={workspaceSaving}
                        />
                      }
                      label={t("全部")}
                    />
                  </header>
                  {!workspaceDraft.includeAllNavigation ? (
                    <div className="settings-workspace-check-list">
                      {workspaceEditor.navigationCategories.map((category) => {
                        const categoryChecked = workspaceDraft.navigationCategories.includes(
                          category.title,
                        );
                        return (
                          <div key={category.title} className="settings-workspace-nav-group">
                            <FormControlLabel
                              className="settings-workspace-check settings-workspace-check--strong"
                              control={
                                <Checkbox
                                  size="small"
                                  checked={categoryChecked}
                                  onChange={(event) =>
                                    updateDraft({
                                      navigationCategories: toggleStringValue(
                                        workspaceDraft.navigationCategories,
                                        category.title,
                                        event.target.checked,
                                      ),
                                    })
                                  }
                                  disabled={workspaceSaving}
                                />
                              }
                              label={category.title}
                            />
                            {!categoryChecked
                              ? category.entries.map((entry) => {
                                  const checked =
                                    workspaceDraft.navigationEntries.includes(entry.scopedName) ||
                                    workspaceDraft.navigationEntries.includes(entry.name);
                                  return (
                                    <FormControlLabel
                                      key={entry.scopedName}
                                      className="settings-workspace-check settings-workspace-check--entry"
                                      control={
                                        <Checkbox
                                          size="small"
                                          checked={checked}
                                          onChange={(event) =>
                                            updateDraft({
                                              navigationEntries: toggleStringValue(
                                                workspaceDraft.navigationEntries.filter(
                                                  (value) => value !== entry.name,
                                                ),
                                                entry.scopedName,
                                                event.target.checked,
                                              ),
                                            })
                                          }
                                          disabled={workspaceSaving}
                                        />
                                      }
                                      label={`${entry.name} · ${navigationEntryKindLabel(entry.kind, t)}`}
                                    />
                                  );
                                })
                              : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>

                <section className="settings-workspace-scope-pane">
                  <header className="settings-workspace-scope-head">
                    <Typography variant="caption">{t("代理")}</Typography>
                    <Typography className="settings-workspace-scope-hint" variant="caption">
                      {t("归属当前")}
                    </Typography>
                  </header>
                  <div className="settings-workspace-check-list">
                    {workspaceEditor.proxyProfiles.length > 0 ? (
                      workspaceEditor.proxyProfiles.map((profile) => {
                        const checked = workspaceDraft.proxyProfiles.includes(profile.id);
                        const endpoint = `${profile.listenHost}:${profile.listenPort}`;
                        const label =
                          profile.workspaceKey && profile.workspaceKey !== workspaceDraft.key
                            ? `${profile.name} · ${endpoint} · ${profile.workspaceLabel}`
                            : `${profile.name} · ${endpoint}`;
                        return (
                          <FormControlLabel
                            key={profile.id}
                            className="settings-workspace-check"
                            control={
                              <Checkbox
                                size="small"
                                checked={checked}
                                onChange={(event) =>
                                  updateDraft({
                                    proxyProfiles: toggleStringValue(
                                      workspaceDraft.proxyProfiles,
                                      profile.id,
                                      event.target.checked,
                                    ),
                                  })
                                }
                                disabled={workspaceSaving}
                              />
                            }
                            label={label}
                          />
                        );
                      })
                    ) : (
                      <Typography className="settings-workspace-empty-note" variant="caption">
                        {t("暂无代理配置")}
                      </Typography>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderWorkspaceSection() {
    return (
      <Stack className="settings-overview" spacing={1.15}>
        <section
          className="settings-list-section settings-list-section--workspace"
          aria-labelledby="settings-workspace-title"
        >
          <header className="settings-list-head">
            <span className="settings-list-head-copy">
              <Typography id="settings-workspace-title" variant="subtitle2">
                {t("工作区")}
              </Typography>
              <Typography variant="caption">{t("需求上下文与范围配置")}</Typography>
            </span>
            <Button
              className="settings-workspace-head-action"
              variant="outlined"
              color="inherit"
              size="small"
              startIcon={<OpenExternalIcon fontSize="small" />}
              onClick={onOpenProjectWorkspacesDir}
            >
              {t("目录")}
            </Button>
          </header>
          <div className="settings-workspace-layout">
            <div className="settings-workspace-selector-panel">
              {projectWorkspaces.length > 0 ? (
                <>
                  <span className="settings-list-icon">
                    <FolderIcon fontSize="small" />
                  </span>
                  <TextField
                    className="settings-workspace-select"
                    select
                    fullWidth
                    size="small"
                    value={workspaceDraft?.key ?? workspaceEditorKey}
                    onChange={(event) => switchProjectWorkspace(event.target.value)}
                    inputProps={{ "aria-label": t("当前工作区") }}
                  >
                    {projectWorkspaces.map((workspace) => (
                      <MenuItem key={workspace.key} value={workspace.key}>
                        {workspace.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </>
              ) : (
                <AppEmptyState
                  compact
                  title={t("暂无工作区")}
                  description={t("先创建一个需求上下文。")}
                />
              )}
            </div>

            <div className="settings-workspace-detail">
              <div className="settings-list settings-workspace-list module-list-scroll">
                <div className="settings-list-row settings-workspace-create-row">
                  <span className="settings-list-icon">
                    <CopyIcon fontSize="small" />
                  </span>
                  <div className="settings-workspace-create">
                    <div className="settings-workspace-create-head">
                      <div className="settings-overview-copy">
                        <Typography component="span" variant="subtitle2">
                          {t("新建工作区")}
                        </Typography>
                        <Typography component="span" variant="caption">
                          {t("生成 TOML 并切换")}
                        </Typography>
                      </div>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<CheckIcon fontSize="small" />}
                        onClick={() => void handleCreateWorkspace()}
                        disabled={creatingWorkspace || !newWorkspaceName.trim()}
                      >
                        {t("创建")}
                      </Button>
                    </div>
                    <div className="settings-workspace-create-fields">
                      <TextField
                        size="small"
                        label={t("名称")}
                        value={newWorkspaceName}
                        onChange={(event) => setNewWorkspaceName(event.target.value)}
                        disabled={creatingWorkspace}
                      />
                      <TextField
                        size="small"
                        label="key"
                        value={newWorkspaceKey}
                        placeholder={normalizeWorkspaceKey(newWorkspaceName) || "marketing-rework"}
                        onChange={(event) => setNewWorkspaceKey(event.target.value)}
                        disabled={creatingWorkspace}
                      />
                      <WorkspaceTypeSelect
                        value={newWorkspaceType}
                        options={workspaceTypeSelectOptions}
                        usageCounts={workspaceTypeUsageCounts}
                        disabled={creatingWorkspace}
                        onChange={(key) => setNewWorkspaceType(key)}
                        onCreate={handleCreateWorkspaceType}
                        onDelete={handleRemoveWorkspaceType}
                      />
                      <TextField
                        size="small"
                        label={t("备注")}
                        value={newWorkspaceDescription}
                        onChange={(event) => setNewWorkspaceDescription(event.target.value)}
                        disabled={creatingWorkspace}
                      />
                      <FormControlLabel
                        className="settings-workspace-copy"
                        control={
                          <Checkbox
                            size="small"
                            checked={newWorkspaceIndependentDir}
                            onChange={(event) => setNewWorkspaceIndependentDir(event.target.checked)}
                            disabled={creatingWorkspace}
                          />
                        }
                        label={t("独立目录")}
                      />
                      {newWorkspaceIndependentDir ? (
                        <TextField
                          size="small"
                          label={t("工作区目录")}
                          value={newWorkspaceRootDir}
                          placeholder={t("默认：~/Documents/rdevtool-workspaces/<key>")}
                          onChange={(event) => setNewWorkspaceRootDir(event.target.value)}
                          disabled={creatingWorkspace}
                        />
                      ) : null}
                      <TextField
                        size="small"
                        label={t("资料目录")}
                        value={newWorkspaceResourceDir}
                        placeholder={t("默认：工作区目录/resources")}
                        onChange={(event) => setNewWorkspaceResourceDir(event.target.value)}
                        disabled={creatingWorkspace}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                aria-label={t("选择资料目录")}
                                onClick={() => void chooseWorkspaceResourceDirectory("create")}
                                disabled={creatingWorkspace}
                              >
                                <FolderIcon fontSize="small" />
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                      <FormControlLabel
                        className="settings-workspace-copy"
                        control={
                          <Checkbox
                            size="small"
                            checked={createWorkspaceWorklog}
                            onChange={(event) => setCreateWorkspaceWorklog(event.target.checked)}
                            disabled={creatingWorkspace}
                          />
                        }
                        label={t("初始化工作日志")}
                      />
                      <FormControlLabel
                        className="settings-workspace-copy"
                        control={
                          <Checkbox
                            size="small"
                            checked={autoRecordWorkspaceWorklog}
                            onChange={(event) =>
                              setAutoRecordWorkspaceWorklog(event.target.checked)
                            }
                            disabled={creatingWorkspace || !createWorkspaceWorklog}
                          />
                        }
                        label={t("自动记录关键操作")}
                      />
                      <FormControlLabel
                        className="settings-workspace-copy"
                        control={
                          <Checkbox
                            size="small"
                            checked={copyCurrentWorkspace}
                            onChange={(event) => setCopyCurrentWorkspace(event.target.checked)}
                            disabled={creatingWorkspace}
                          />
                        }
                        label={t("复制当前范围")}
                      />
                    </div>
                  </div>
                </div>
                {renderWorkspaceScopeEditor()}
              </div>
            </div>
          </div>
        </section>
      </Stack>
    );
  }

  function renderGlobalSettingsSection(
    title: string,
    description: string,
    content: ReactNode,
  ) {
    return (
      <Stack className="settings-overview" spacing={1.15}>
        <section
          className="settings-list-section settings-list-section--global-combined"
          aria-labelledby={`settings-${activeSection}-title`}
        >
          <header className="settings-list-head">
            <Typography id={`settings-${activeSection}-title`} variant="subtitle2">
              {t(title)}
            </Typography>
            <Typography variant="caption">{t(description)}</Typography>
          </header>
          <div className="settings-list settings-global-combined-list">{content}</div>
        </section>
      </Stack>
    );
  }

  function renderStyleModeChoices() {
    return (
      <div className="settings-style-choice" role="group" aria-label={t("主题")}>
        <button
          type="button"
          className={`settings-style-card settings-style-card--system${
            styleMode === "system" ? " is-active" : ""
          }`}
          aria-label={t("跟随系统主题")}
          aria-pressed={styleMode === "system"}
          title={t("跟随系统主题")}
          onClick={() => onStyleModeChange("system")}
        >
          <span className="settings-style-card-icon" aria-hidden="true">
            <span className="settings-style-system" />
          </span>
          <span className="settings-style-card-copy">
            <span>{t("系统")}</span>
          </span>
        </button>
        <button
          type="button"
          className={`settings-style-card settings-style-card--light${
            styleMode === "light" ? " is-active" : ""
          }`}
          aria-label={t("亮色主题")}
          aria-pressed={styleMode === "light"}
          title={t("亮色主题")}
          onClick={() => onStyleModeChange("light")}
        >
          <span className="settings-style-card-icon" aria-hidden="true">
            <span className="settings-style-sun" />
          </span>
          <span className="settings-style-card-copy">
            <span>{t("亮色")}</span>
          </span>
        </button>
        <button
          type="button"
          className={`settings-style-card settings-style-card--mono${
            styleMode === "mono" ? " is-active" : ""
          }`}
          aria-label={t("暗色主题")}
          aria-pressed={styleMode === "mono"}
          title={t("暗色主题")}
          onClick={() => onStyleModeChange("mono")}
        >
          <span className="settings-style-card-icon" aria-hidden="true">
            <span className="settings-style-moon" />
          </span>
          <span className="settings-style-card-copy">
            <span>{t("暗色")}</span>
          </span>
        </button>
      </div>
    );
  }

  function renderLanguageChoices() {
    const options: Array<{
      value: AppLanguagePreference;
      label: string;
      code: string;
    }> = [
      { value: "system", label: "跟随系统", code: "AUTO" },
      { value: "zh-CN", label: "中文", code: "中" },
      { value: "en-US", label: "英文", code: "EN" },
    ];

    return (
      <div
        className="settings-language-choice"
        role="group"
        aria-label={t("界面语言")}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={languagePreference === option.value}
            className={languagePreference === option.value ? "is-active" : ""}
            onClick={() => setLanguagePreference(option.value)}
          >
            <span className="settings-language-code" aria-hidden="true">
              {option.code}
            </span>
            <span>{t(option.label)}</span>
          </button>
        ))}
      </div>
    );
  }

  function renderMenuSettingsSection() {
    return renderGlobalSettingsSection(
      "通用",
      "菜单、外观与应用行为",
      <>
            <div className="settings-list-group-head">
              <Typography variant="caption">{t("菜单")}</Typography>
              <Typography variant="caption">{t("未启用的菜单不会展示")}</Typography>
            </div>
            <div className="settings-list-row settings-list-row--split">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("展示菜单")}</Typography>
                <Typography variant="caption">{t("至少保留一个工作区菜单。")}</Typography>
              </div>
              <Stack
                className="settings-menu-choice"
                direction="row"
                spacing={0.4}
                useFlexGap
                flexWrap="wrap"
                justifyContent="flex-end"
              >
                {SETTINGS_ALL_PAGE_KEYS.map((page) => {
                  const checked = enabledPages.includes(page);
                  return (
                    <FormControlLabel
                      key={page}
                      className={`settings-menu-option${checked ? " is-active" : ""}`}
                      control={
                        <Checkbox
                          size="small"
                          checked={checked}
                          disabled={checked && enabledPages.length === 1}
                          onChange={(event) =>
                            handleMenuEnabledChange(page, event.target.checked)
                          }
                        />
                      }
                      label={t(SETTINGS_NAV_ITEM_MAP[page].shortLabel)}
                      sx={{ m: 0 }}
                    />
                  );
                })}
              </Stack>
            </div>
            <div className="settings-list-row settings-list-row--split">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("默认菜单")}</Typography>
                <Typography variant="caption">{t("应用启动后优先进入此菜单。")}</Typography>
              </div>
              <TextField
                select
                size="small"
                value={defaultPage}
                onChange={(event) =>
                  onDefaultPageChange(event.target.value as PageKey)
                }
                sx={{ width: "min(220px, 100%)", flexShrink: 0 }}
                inputProps={{ "aria-label": t("默认菜单") }}
              >
                {enabledPages.map((page) => (
                  <MenuItem key={page} value={page}>
                    {t(SETTINGS_NAV_ITEM_MAP[page].label)}
                  </MenuItem>
                ))}
              </TextField>
            </div>
            <div className="settings-list-group-head settings-list-group-head--single">
              <Typography variant="caption">{t("外观")}</Typography>
            </div>
            <div className="settings-list-row settings-list-row--split settings-list-row--appearance">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("主题")}</Typography>
              </div>
              {renderStyleModeChoices()}
            </div>
            <div className="settings-list-row settings-list-row--split settings-list-row--appearance">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("界面语言")}</Typography>
                <Typography variant="caption">
                  {t("选择应用界面的显示语言。")}
                </Typography>
              </div>
              {renderLanguageChoices()}
            </div>
            <div className="settings-list-group-head">
              <Typography variant="caption">{t("活动中心")}</Typography>
              <Typography variant="caption">{t("配置监听保持开启")}</Typography>
            </div>
            <div className="settings-list-row settings-list-row--split">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("配置变更活动")}</Typography>
                <Typography variant="caption">
                  {t("未处理提醒会保留；完成或忽略后进入全部记录。")}
                </Typography>
              </div>
              <div
                className="settings-activity-mode"
                role="radiogroup"
                aria-label={t("配置变更活动显示")}
              >
                {(
                  [
                    { value: "actionable", label: "仅待处理" },
                    { value: "all", label: "全部记录" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={
                      activityPreferences.configActivityVisibility === option.value
                    }
                    className={
                      activityPreferences.configActivityVisibility === option.value
                        ? "is-active"
                        : ""
                    }
                    onClick={() =>
                      persistActivityPreference(
                        setConfigActivityVisibility(option.value),
                        t("配置变更活动已设为 {mode}", {
                          mode: t(option.label),
                        }),
                      )
                    }
                    disabled={activityPreferencesLoading}
                  >
                    {t(option.label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-list-group-head">
              <Typography variant="caption">{t("运行")}</Typography>
              <Typography variant="caption">{t("退出行为")}</Typography>
            </div>
            <div className="settings-list-row settings-list-row--split">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("退出时项目")}</Typography>
                <Typography variant="caption">{t("控制关闭应用时已启动项目的处理方式。")}</Typography>
              </div>
              <TextField
                select
                size="small"
                value={exitRuntimePolicy}
                onChange={(event) =>
                  onExitRuntimePolicyChange(
                    event.target.value as AppExitRuntimePolicy,
                  )
                }
                sx={{ width: "min(240px, 100%)", flexShrink: 0 }}
                inputProps={{ "aria-label": t("退出时项目") }}
              >
                <MenuItem value="ask">{t("每次询问")}</MenuItem>
                <MenuItem value="keep">{t("保持项目运行")}</MenuItem>
                <MenuItem value="stop">{t("停止本次启动项目")}</MenuItem>
              </TextField>
            </div>
      </>,
    );
  }

  function renderConfirmationSettingsSection() {
    return renderGlobalSettingsSection(
      "操作确认",
      "统一控制不同风险操作的确认方式",
      <>
            <div className="settings-list-group-head settings-list-group-head--confirmation">
              <div>
                <Typography variant="caption">{t("确认策略")}</Typography>
                <Typography variant="caption">{t("高风险动作始终需要确认")}</Typography>
              </div>
              <Button
                size="small"
                color="inherit"
                onClick={() =>
                  persistConfirmationPreference(
                    resetConfirmationPreferences(),
                    t("已恢复平衡确认策略"),
                  )
                }
                disabled={confirmationPreferencesLoading}
              >
                {t("恢复平衡")}
              </Button>
            </div>
            <div className="settings-list-row settings-list-row--split">
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("确认策略")}</Typography>
                <Typography variant="caption">{t("高风险动作始终需要确认。")}</Typography>
              </div>
              <div
                className="settings-confirmation-mode"
                role="radiogroup"
                aria-label={t("操作确认策略")}
              >
                {(
                  [
                    { value: "strict", label: "严格" },
                    { value: "balanced", label: "平衡" },
                    { value: "fast", label: "快捷" },
                  ] as Array<{
                    value: Exclude<ConfirmationMode, "custom">;
                    label: string;
                  }>
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={confirmationPreferences.mode === option.value}
                    className={
                      confirmationPreferences.mode === option.value ? "is-active" : ""
                    }
                    onClick={() =>
                      persistConfirmationPreference(
                        setConfirmationMode(option.value),
                        t("已切换为 {mode} 确认策略", {
                          mode: t(option.label),
                        }),
                      )
                    }
                    disabled={confirmationPreferencesLoading}
                  >
                    {t(option.label)}
                  </button>
                ))}
                {confirmationPreferences.mode === "custom" ? (
                  <Chip size="small" label={t("自定义")} />
                ) : null}
              </div>
            </div>
            <div className="settings-confirmation-list">
              {CONFIRMATION_PREFERENCE_DEFINITIONS.map((definition) => (
                <div
                  key={definition.key}
                  className="settings-list-row settings-list-row--split settings-confirmation-row"
                >
                  <div className="settings-overview-copy">
                    <Typography variant="subtitle2">{t(definition.label)}</Typography>
                    <Typography variant="caption">{t(definition.description)}</Typography>
                  </div>
                  {definition.required ? (
                    <Chip size="small" variant="outlined" label={t("始终确认")} />
                  ) : (
                    <Switch
                      size="small"
                      checked={confirmationEnabled(confirmationPreferences, definition.key)}
                      onChange={(event) =>
                        persistConfirmationPreference(
                          setConfirmationCategoryEnabled(
                            definition.key as ConfirmationPreferenceKey,
                            event.target.checked,
                          ),
                          t("已更新 {label} 确认策略", {
                            label: t(definition.label),
                          }),
                        )
                      }
                      disabled={confirmationPreferencesLoading}
                      slotProps={{
                        input: { "aria-label": t("{label}确认", { label: t(definition.label) }) },
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
      </>,
    );
  }

  function renderAccessSettingsSection() {
    return renderGlobalSettingsSection(
      "快捷入口",
      "查看常用命令并打开配置文件",
      <>
            <div className="settings-list-row">
              <div className="settings-list-icon">
                <span>⌘</span>
              </div>
              <div className="settings-overview-copy">
                <Typography variant="subtitle2">{t("命令面板")}</Typography>
                <Typography variant="caption">{t("搜索页面、项目、快捷入口和常用动作。")}</Typography>
              </div>
              <kbd>Cmd/Ctrl&nbsp;K</kbd>
            </div>
            <Button
              className="settings-list-row settings-list-button"
              variant="outlined"
              color="inherit"
              onClick={onOpenConfigDir}
            >
              <span className="settings-list-icon">
                <FolderIcon fontSize="small" />
              </span>
              <span className="settings-overview-copy">
                <Typography component="span" variant="subtitle2">{t("配置文件夹")}</Typography>
                <Typography component="span" variant="caption">{t("打开当前配置目录")}</Typography>
              </span>
              <OpenExternalIcon className="settings-list-action-icon" fontSize="small" />
            </Button>
            <Button
              className="settings-list-row settings-list-button"
              variant="outlined"
              color="inherit"
              onClick={onOpenConfigFile}
            >
              <span className="settings-list-icon">
                <OpenExternalIcon fontSize="small" />
              </span>
              <span className="settings-overview-copy">
                <Typography component="span" variant="subtitle2">projects.toml</Typography>
                <Typography component="span" variant="caption">{t("项目与构建配置")}</Typography>
              </span>
              <OpenExternalIcon className="settings-list-action-icon" fontSize="small" />
            </Button>
            <Button
              className="settings-list-row settings-list-button"
              variant="outlined"
              color="inherit"
              onClick={onOpenNavigationConfigFile}
            >
              <span className="settings-list-icon">
                <OpenExternalIcon fontSize="small" />
              </span>
              <span className="settings-overview-copy">
                <Typography component="span" variant="subtitle2">navigation.toml</Typography>
                <Typography component="span" variant="caption">{t("访达快捷入口")}</Typography>
              </span>
              <OpenExternalIcon className="settings-list-action-icon" fontSize="small" />
            </Button>
      </>,
    );
  }

  function renderGeneralSection() {
    switch (activeSection) {
      case "confirmation":
        return renderConfirmationSettingsSection();
      case "access":
        return renderAccessSettingsSection();
      case "artifacts":
        return <ManagedArtifactsPanel activeWorkspaceKey={activeProjectWorkspaceKey} />;
      case "diagnostics":
        return <SystemDiagnosticsPanel />;
      case "menu":
      default:
        return renderMenuSettingsSection();
    }
  }

  function renderProjectSelector() {
    return (
      <div className="settings-project-toolbar">
        <TextField
          select
          size="small"
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          disabled={loading || saving || !editorState?.projects.length}
          inputProps={{ "aria-label": t("项目") }}
        >
          {(editorState?.projects ?? []).map((project) => (
            <MenuItem key={project.key} value={project.key}>
              {project.name || project.key}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={() => void loadProjectConfig(selectedKey)}
          disabled={loading || saving}
        >
          {t("刷新")}
        </Button>
      </div>
    );
  }

  function renderProjectManagementRedirectSection() {
    return (
      <Stack spacing={1.2}>
        <section className="settings-list-section">
          <header className="settings-list-head">
            <Typography variant="subtitle2">{t("项目配置已迁移")}</Typography>
            <Typography variant="caption">
              {t("项目、构建与分支规则统一在项目管理中维护")}
            </Typography>
          </header>
          <div className="settings-list">
            <Button
              className="settings-list-row settings-list-button"
              variant="outlined"
              color="inherit"
              onClick={onOpenProjectManagement}
              disabled={!onOpenProjectManagement}
            >
              <span className="settings-list-icon">
                <OpenExternalIcon fontSize="small" />
              </span>
              <span className="settings-overview-copy">
                <Typography component="span" variant="subtitle2">
                  {t("打开项目管理")}
                </Typography>
                <Typography component="span" variant="caption">
                  {t("管理项目身份、基础命令、启动档案、构建目标和 Git 分支规则")}
                </Typography>
              </span>
              <OpenExternalIcon className="settings-list-action-icon" fontSize="small" />
            </Button>
          </div>
        </section>
      </Stack>
    );
  }

  function renderCommandFields(commandKey: "dev" | "build", label: string) {
    const command = commandValue(selectedProject?.[commandKey]);
    return (
      <div className="settings-sub-block">
        <div className="settings-form-block-head">
          <Typography variant="subtitle2">{t(label)}</Typography>
          {command.envCount > 0 ? (
            <Chip size="small" label={`${command.envCount} env`} variant="outlined" />
          ) : null}
        </div>
        <div className="settings-form-grid">
          <TextField
            size="small"
            label={t("命令")}
            value={command.command}
            onChange={(event) => updateCommand(commandKey, { command: event.target.value })}
          />
          <TextField
            size="small"
            label={t("工作目录")}
            value={command.cwd ?? ""}
            onChange={(event) => updateCommand(commandKey, { cwd: event.target.value })}
          />
          <TextField
            size="small"
            label={t("输出目录")}
            value={command.outputDir ?? ""}
            onChange={(event) => updateCommand(commandKey, { outputDir: event.target.value })}
          />
        </div>
      </div>
    );
  }

  function renderDebugProfilesBlock() {
    const profiles = selectedProject?.debugProfiles ?? [];
    const selectedNetworkProxy = selectedDebugProfile
      ? {
          ...emptyNetworkProxy(),
          ...(selectedDebugProfile.networkProxy ?? {}),
        }
      : emptyNetworkProxy();
    const selectedLocalProxy = selectedDebugProfile
      ? {
          ...emptyLocalProxy(),
          ...(selectedDebugProfile.localProxy ?? {}),
        }
      : emptyLocalProxy();
    const selectedAuthHelper = {
      ...emptyAuthHelper(),
      ...(selectedLocalProxy.authHelper ?? {}),
    };
    return renderProjectSectionBlock(
      "项目启动档案",
      "在项目基础命令上保存环境、端口、本地文件和共享运行环境等差异",
      <Stack spacing={1}>
        <div className="settings-deploy-switcher settings-debug-profile-switcher">
          {profiles.map((profile, index) => (
            <button
              key={profile.key || index}
              type="button"
              className={index === selectedDebugProfileIndex ? "is-active" : ""}
              onClick={() => setSelectedDebugProfileIndex(index)}
            >
              <Typography variant="caption">
                {profile.label || profile.key || t("档案 {index}", { index: index + 1 })}
              </Typography>
              <Typography variant="caption">{debugProfileMeta(profile, t)}</Typography>
            </button>
          ))}
          <Button
            variant="outlined"
            color="inherit"
            onClick={addDebugProfile}
            disabled={saving}
          >
            {t("新增档案")}
          </Button>
        </div>

        {profiles.length === 0 ? (
          <div className="settings-empty-row">
            {t("暂无启动档案。项目仍可使用基础命令启动，也可新增 UAT、联调等档案。")}
          </div>
        ) : null}

        {selectedDebugProfile ? (
          <div className="settings-sub-block">
            <div className="settings-form-block-head">
              <div>
                <Typography variant="subtitle2">
                  {selectedDebugProfile.label || selectedDebugProfile.key}
                </Typography>
                <Typography variant="caption">{t("保存后会写入 projects.toml")}</Typography>
              </div>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<TrashIcon fontSize="small" />}
                onClick={() => deleteDebugProfileAt(selectedDebugProfileIndex)}
                disabled={saving}
              >
                {t("删除档案")}
              </Button>
            </div>

            <div className="settings-form-grid">
              <TextField
                size="small"
                label="Key"
                value={selectedDebugProfile.key}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    key: event.target.value,
                  })
                }
              />
              <TextField
                size="small"
                label={t("名称")}
                value={selectedDebugProfile.label}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    label: event.target.value,
                  })
                }
              />
              <TextField
                select
                size="small"
                label={t("共享运行环境")}
                value={selectedDebugProfile.runtimeProfile ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    runtimeProfile: event.target.value || null,
                  })
                }
                helperText={t("复用浏览器、代理、域名映射和网页动作。")}
              >
                <MenuItem value="">{t("不绑定共享环境")}</MenuItem>
                {runtimeProfiles.map((profile) => (
                  <MenuItem key={profile.key} value={profile.key}>
                    {profile.label || profile.key}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                className="settings-form-grid-wide"
                size="small"
                label={t("启动命令覆盖")}
                value={selectedDebugProfile.command ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    command: event.target.value || null,
                  })
                }
                placeholder={t("留空时使用项目默认 dev 命令")}
                helperText={t("仅对该启动档案生效，不修改项目基础启动命令。")}
              />
              <TextField
                className="settings-form-grid-wide"
                size="small"
                label={t("独有工作目录")}
                value={selectedDebugProfile.cwd ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    cwd: event.target.value || null,
                  })
                }
                placeholder={t("留空时使用项目 dev.cwd；相对路径基于 repoPath")}
                helperText={t("用于同一项目的不同 worktree、副本或子应用运行目录。")}
              />
              <TextField
                size="small"
                type="number"
                label={t("预期端口")}
                value={selectedDebugProfile.expectedPort ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    expectedPort: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
                inputProps={{ min: 1, max: 65535 }}
                helperText={t("被占用时直接阻止启动。")}
              />
              <TextField
                className="settings-form-grid-wide"
                size="small"
                label={t("启动页面 URL")}
                value={selectedDebugProfile.focusUrl ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    focusUrl: event.target.value || null,
                  })
                }
                placeholder="http://127.0.0.1:5173/#/debug"
                helperText={t("覆盖项目 focus.url，仅用于该启动档案的聚焦与 Ready 回退。")}
              />
              <FormControlLabel
                className="settings-form-grid-wide settings-checkbox-row"
                control={
                  <Checkbox
                    size="small"
                    checked={Boolean(selectedDebugProfile.readyProbe)}
                    onChange={(event) =>
                      updateDebugProfileAt(selectedDebugProfileIndex, {
                        readyProbe: event.target.checked
                          ? {
                              url: null,
                              path: null,
                              expectedStatuses: [],
                              timeoutMs: null,
                            }
                          : null,
                      })
                    }
                  />
                }
                label={t("启用该档案的 HTTP Ready 探测")}
              />
              {selectedDebugProfile.readyProbe ? (
                <>
                  <TextField
                    size="small"
                    label="Ready URL"
                    value={selectedDebugProfile.readyProbe.url ?? ""}
                    onChange={(event) =>
                      updateDebugProfileAt(selectedDebugProfileIndex, {
                        readyProbe: {
                          ...selectedDebugProfile.readyProbe!,
                          url: event.target.value || null,
                        },
                      })
                    }
                    placeholder={t("留空时使用启动页面或监听端口")}
                  />
                  <TextField
                    size="small"
                    label={t("Ready 路径")}
                    value={selectedDebugProfile.readyProbe.path ?? ""}
                    onChange={(event) =>
                      updateDebugProfileAt(selectedDebugProfileIndex, {
                        readyProbe: {
                          ...selectedDebugProfile.readyProbe!,
                          path: event.target.value || null,
                        },
                      })
                    }
                    placeholder="/health"
                  />
                  <TextField
                    size="small"
                    label={t("成功状态码")}
                    value={selectedDebugProfile.readyProbe.expectedStatuses.join(",")}
                    onChange={(event) =>
                      updateDebugProfileAt(selectedDebugProfileIndex, {
                        readyProbe: {
                          ...selectedDebugProfile.readyProbe!,
                          expectedStatuses: parseParamOptions(event.target.value)
                            .map(Number)
                            .filter(Number.isInteger),
                        },
                      })
                    }
                    placeholder={t("留空表示 200-399；或 200,204")}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={t("Ready 超时 (ms)")}
                    value={selectedDebugProfile.readyProbe.timeoutMs ?? ""}
                    onChange={(event) =>
                      updateDebugProfileAt(selectedDebugProfileIndex, {
                        readyProbe: {
                          ...selectedDebugProfile.readyProbe!,
                          timeoutMs: event.target.value
                            ? Number(event.target.value)
                            : null,
                        },
                      })
                    }
                    inputProps={{ min: 100, max: 600000 }}
                    placeholder="180000"
                  />
                </>
              ) : null}
              <TextField
                size="small"
                label={t("浏览器覆盖（可选）")}
                value={selectedDebugProfile.browser ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    browser: event.target.value,
                  })
                }
                placeholder="Google Chrome"
              />
              <TextField
                size="small"
                label={t("Profile 覆盖（可选）")}
                value={selectedDebugProfile.browserProfile ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    browserProfile: event.target.value,
                  })
                }
                placeholder="Profile 2"
              />
              <TextField
                size="small"
                label={t("数据目录覆盖（可选）")}
                value={selectedDebugProfile.browserUserDataDir ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    browserUserDataDir: event.target.value,
                  })
                }
                placeholder="/tmp/rdevtool-browser-profile"
              />
              <TextField
                className="settings-form-grid-wide"
                size="small"
                label={t("额外浏览器参数")}
                value={selectedDebugProfile.browserArgsText ?? ""}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    browserArgsText: event.target.value,
                  })
                }
                placeholder={
                  "--host-resolver-rules=MAP app.example.test 127.0.0.1"
                }
                helperText={t("每行一个 Chrome 参数；参数值不要额外包 shell 引号。")}
                multiline
                minRows={2}
              />
              <TextField
                className="settings-form-grid-wide"
                size="small"
                label={t("档案环境变量")}
                value={selectedDebugProfile.envText}
                onChange={(event) =>
                  updateDebugProfileAt(selectedDebugProfileIndex, {
                    envText: event.target.value,
                  })
                }
                placeholder={"APP_ENV=local\nFEATURE_FLAG=true"}
                multiline
                minRows={3}
              />
            </div>

            <div
              className={`settings-param-editor settings-network-proxy${
                selectedNetworkProxy.enabled ? " is-enabled" : ""
              }`}
              aria-label={t("网络代理")}
            >
              <div className="settings-param-editor-head">
                <FormControlLabel
                  className="settings-checkbox-row"
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedNetworkProxy.enabled}
                      onChange={(event) =>
                        updateDebugProfileNetworkProxy(selectedDebugProfileIndex, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                  }
                  label={t("覆盖共享环境的网络代理")}
                />
                <Chip
                  size="small"
                  label={
                    selectedNetworkProxy.enabled
                      ? selectedNetworkProxy.nodeHook
                        ? "env + Node Hook"
                        : "env"
                      : t("直连")
                  }
                  variant="outlined"
                />
              </div>
              <div className="settings-form-grid settings-form-grid-tight">
                <TextField
                  className="settings-form-grid-wide"
                  size="small"
                  label={t("代理地址")}
                  value={selectedNetworkProxy.proxyUrl}
                  onChange={(event) =>
                    updateDebugProfileNetworkProxy(selectedDebugProfileIndex, {
                      proxyUrl: event.target.value,
                    })
                  }
                  placeholder="http://127.0.0.1:7897"
                  disabled={!selectedNetworkProxy.enabled}
                />
                <TextField
                  size="small"
                  label="NO_PROXY"
                  value={selectedNetworkProxy.noProxy}
                  onChange={(event) =>
                    updateDebugProfileNetworkProxy(selectedDebugProfileIndex, {
                      noProxy: event.target.value,
                    })
                  }
                  placeholder="localhost,127.0.0.1,::1"
                  disabled={!selectedNetworkProxy.enabled || !selectedNetworkProxy.injectEnv}
                />
                <div className="settings-network-proxy-toggles">
                  <FormControlLabel
                    className="settings-checkbox-row"
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedNetworkProxy.injectEnv}
                        onChange={(event) =>
                          updateDebugProfileNetworkProxy(selectedDebugProfileIndex, {
                            injectEnv: event.target.checked,
                          })
                        }
                        disabled={!selectedNetworkProxy.enabled}
                      />
                    }
                    label={t("注入 env")}
                  />
                  <FormControlLabel
                    className="settings-checkbox-row"
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedNetworkProxy.nodeHook}
                        onChange={(event) =>
                          updateDebugProfileNetworkProxy(selectedDebugProfileIndex, {
                            nodeHook: event.target.checked,
                          })
                        }
                        disabled={!selectedNetworkProxy.enabled}
                      />
                    }
                    label="Node Hook"
                  />
                </div>
              </div>
            </div>

            <div
              className={`settings-param-editor settings-network-proxy${
                selectedLocalProxy.enabled ? " is-enabled" : ""
              }`}
              aria-label={t("本地 API 代理")}
            >
              <div className="settings-param-editor-head">
                <FormControlLabel
                  className="settings-checkbox-row"
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedLocalProxy.enabled}
                      onChange={(event) =>
                        updateDebugProfileLocalProxy(selectedDebugProfileIndex, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                  }
                  label={t("启用本地 API 代理")}
                />
                <Chip
                  size="small"
                  label={selectedLocalProxy.enabled ? selectedLocalProxy.listen : t("关闭")}
                  variant="outlined"
                />
              </div>
              <div className="settings-form-grid settings-form-grid-tight">
                <TextField
                  size="small"
                  label={t("监听地址")}
                  value={selectedLocalProxy.listen}
                  onChange={(event) =>
                    updateDebugProfileLocalProxy(selectedDebugProfileIndex, {
                      listen: event.target.value,
                    })
                  }
                  placeholder="127.0.0.1:3000"
                  disabled={!selectedLocalProxy.enabled}
                />
                <TextField
                  size="small"
                  label={t("前端地址")}
                  value={selectedLocalProxy.frontendUrl}
                  onChange={(event) =>
                    updateDebugProfileLocalProxy(selectedDebugProfileIndex, {
                      frontendUrl: event.target.value,
                    })
                  }
                  placeholder="http://127.0.0.1:3001"
                  disabled={!selectedLocalProxy.enabled}
                />
                <TextField
                  className="settings-form-grid-wide"
                  size="small"
                  label={t("上游 HTTP 代理")}
                  value={selectedLocalProxy.upstreamProxy}
                  onChange={(event) =>
                    updateDebugProfileLocalProxy(selectedDebugProfileIndex, {
                      upstreamProxy: event.target.value,
                    })
                  }
                  placeholder="http://127.0.0.1:7897"
                  disabled={!selectedLocalProxy.enabled}
                  helperText={t("内网 API 需要走代理时填写；留空表示直连。")}
                />
              </div>

              <div className="settings-param-list" aria-label={t("本地 API 代理路由")}>
                <div className="settings-param-list-head">
                  <Typography variant="caption">
                    {t("{count} 条路由", {
                      count: (selectedLocalProxy.routes ?? []).length,
                    })}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="inherit"
                    onClick={() => addLocalProxyRoute(selectedDebugProfileIndex)}
                    disabled={saving || !selectedLocalProxy.enabled}
                  >
                    {t("添加路由")}
                  </Button>
                </div>
                {(selectedLocalProxy.routes ?? []).length === 0 ? (
                  <div className="settings-empty-row">{t("暂无 API 路由")}</div>
                ) : (
                  (selectedLocalProxy.routes ?? []).map((route, routeIndex) => (
                    <div
                      key={`local-proxy-route-${selectedDebugProfileIndex}-${routeIndex}`}
                      className="settings-param-editor"
                    >
                      <div className="settings-param-editor-head">
                        <FormControlLabel
                          className="settings-checkbox-row"
                          control={
                            <Checkbox
                              size="small"
                              checked={route.enabled}
                              onChange={(event) =>
                                updateLocalProxyRouteAt(
                                  selectedDebugProfileIndex,
                                  routeIndex,
                                  { enabled: event.target.checked },
                                )
                              }
                              disabled={!selectedLocalProxy.enabled}
                            />
                          }
                          label={t("启用")}
                        />
                        <Button
                          variant="outlined"
                          color="inherit"
                          startIcon={<TrashIcon fontSize="small" />}
                          onClick={() =>
                            deleteLocalProxyRouteAt(selectedDebugProfileIndex, routeIndex)
                          }
                          disabled={saving}
                        >
                          {t("删除路由")}
                        </Button>
                      </div>
                      <div className="settings-form-grid settings-form-grid-tight">
                        <TextField
                          size="small"
                          label={t("匹配前缀")}
                          value={route.matchPrefix}
                          onChange={(event) =>
                            updateLocalProxyRouteAt(
                              selectedDebugProfileIndex,
                              routeIndex,
                              { matchPrefix: event.target.value },
                            )
                          }
                          placeholder="/api"
                          disabled={!selectedLocalProxy.enabled || !route.enabled}
                        />
                        <TextField
                          size="small"
                          label={t("目标地址")}
                          value={route.target}
                          onChange={(event) =>
                            updateLocalProxyRouteAt(
                              selectedDebugProfileIndex,
                              routeIndex,
                              { target: event.target.value },
                            )
                          }
                          placeholder="http://nginx-api.example.com"
                          disabled={!selectedLocalProxy.enabled || !route.enabled}
                        />
                        <TextField
                          size="small"
                          label={t("改写前缀")}
                          value={route.rewritePrefix}
                          onChange={(event) =>
                            updateLocalProxyRouteAt(
                              selectedDebugProfileIndex,
                              routeIndex,
                              { rewritePrefix: event.target.value },
                            )
                          }
                          placeholder="/api-v2"
                          disabled={!selectedLocalProxy.enabled || !route.enabled}
                        />
                        <TextField
                          className="settings-form-grid-wide"
                          size="small"
                          label={t("注入 Header")}
                          value={route.headersText}
                          onChange={(event) =>
                            updateLocalProxyRouteAt(
                              selectedDebugProfileIndex,
                              routeIndex,
                              { headersText: event.target.value },
                            )
                          }
                          placeholder={"x-debug-user=example\nx-debug=true"}
                          multiline
                          minRows={2}
                          disabled={!selectedLocalProxy.enabled || !route.enabled}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="settings-param-list" aria-label={t("Token Helper")}>
                <div className="settings-param-list-head">
                  <FormControlLabel
                    className="settings-checkbox-row"
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedAuthHelper.enabled}
                        onChange={(event) =>
                          updateDebugProfileAuthHelper(selectedDebugProfileIndex, {
                            enabled: event.target.checked,
                          })
                        }
                        disabled={!selectedLocalProxy.enabled}
                      />
                    }
                    label={t("启用 Token Helper")}
                  />
                  <Button
                    variant="outlined"
                    color="inherit"
                    onClick={() => addAuthHelperItem(selectedDebugProfileIndex)}
                    disabled={
                      saving || !selectedLocalProxy.enabled || !selectedAuthHelper.enabled
                    }
                  >
                    {t("添加写入项")}
                  </Button>
                </div>
                <div className="settings-form-grid settings-form-grid-tight">
                  <TextField
                    size="small"
                    label={t("Helper 路径")}
                    value={selectedAuthHelper.path}
                    onChange={(event) =>
                      updateDebugProfileAuthHelper(selectedDebugProfileIndex, {
                        path: event.target.value,
                      })
                    }
                    placeholder="/__auth-helper"
                    disabled={!selectedLocalProxy.enabled || !selectedAuthHelper.enabled}
                  />
                  <TextField
                    size="small"
                    label={t("写入后跳转")}
                    value={selectedAuthHelper.redirectPath}
                    onChange={(event) =>
                      updateDebugProfileAuthHelper(selectedDebugProfileIndex, {
                        redirectPath: event.target.value,
                      })
                    }
                    placeholder="/#/"
                    disabled={!selectedLocalProxy.enabled || !selectedAuthHelper.enabled}
                  />
                </div>
                {(selectedAuthHelper.items ?? []).length === 0 ? (
                  <div className="settings-empty-row">{t("暂无写入项")}</div>
                ) : (
                  (selectedAuthHelper.items ?? []).map((item, itemIndex) => (
                    <div
                      key={`auth-helper-item-${selectedDebugProfileIndex}-${itemIndex}`}
                      className="settings-param-editor"
                    >
                      <div className="settings-param-editor-head">
                        <FormControlLabel
                          className="settings-checkbox-row"
                          control={
                            <Checkbox
                              size="small"
                              checked={item.enabled}
                              onChange={(event) =>
                                updateAuthHelperItemAt(
                                  selectedDebugProfileIndex,
                                  itemIndex,
                                  { enabled: event.target.checked },
                                )
                              }
                              disabled={!selectedLocalProxy.enabled || !selectedAuthHelper.enabled}
                            />
                          }
                          label={t("启用")}
                        />
                        <Button
                          variant="outlined"
                          color="inherit"
                          startIcon={<TrashIcon fontSize="small" />}
                          onClick={() =>
                            deleteAuthHelperItemAt(selectedDebugProfileIndex, itemIndex)
                          }
                          disabled={saving}
                        >
                          {t("删除写入项")}
                        </Button>
                      </div>
                      <div className="settings-form-grid settings-form-grid-tight">
                        <TextField
                          select
                          size="small"
                          label={t("存储位置")}
                          value={item.storage}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              { storage: event.target.value },
                            )
                          }
                          disabled={
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        >
                          {AUTH_HELPER_STORAGE_OPTIONS.map((storage) => (
                            <MenuItem key={storage.value} value={storage.value}>
                              {storage.label}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label="Key"
                          value={item.key}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              { key: event.target.value },
                            )
                          }
                          placeholder="token"
                          disabled={
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        />
                        <TextField
                          size="small"
                          label={t("JSON 路径")}
                          value={item.fromJsonPath}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              { fromJsonPath: event.target.value },
                            )
                          }
                          placeholder="$.token"
                          disabled={
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        />
                        <TextField
                          size="small"
                          label={t("固定值")}
                          value={item.value}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              { value: event.target.value },
                            )
                          }
                          placeholder={t("留空则从 JSON 路径读取")}
                          disabled={
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        />
                        <TextField
                          size="small"
                          label="Cookie Path"
                          value={item.cookiePath}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              { cookiePath: event.target.value },
                            )
                          }
                          disabled={
                            item.storage !== "cookie" ||
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        />
                        <TextField
                          size="small"
                          type="number"
                          label="Cookie Max-Age"
                          value={item.cookieMaxAgeSeconds ?? ""}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              {
                                cookieMaxAgeSeconds: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              },
                            )
                          }
                          disabled={
                            item.storage !== "cookie" ||
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        />
                        <TextField
                          size="small"
                          label="Cookie SameSite"
                          value={item.cookieSameSite}
                          onChange={(event) =>
                            updateAuthHelperItemAt(
                              selectedDebugProfileIndex,
                              itemIndex,
                              { cookieSameSite: event.target.value },
                            )
                          }
                          placeholder="Lax"
                          disabled={
                            item.storage !== "cookie" ||
                            !selectedLocalProxy.enabled ||
                            !selectedAuthHelper.enabled ||
                            !item.enabled
                          }
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="settings-param-list" aria-label={t("本地覆盖文件")}>
              <div className="settings-param-list-head">
                <Typography variant="caption">
                  {t("{count} 个本地文件", {
                    count: (selectedDebugProfile.localFiles ?? []).length,
                  })}
                </Typography>
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={() => addDebugLocalFile(selectedDebugProfileIndex)}
                  disabled={saving}
                >
                  {t("新增文件")}
                </Button>
              </div>
              {(selectedDebugProfile.localFiles ?? []).length === 0 ? (
                <div className="settings-empty-row">{t("暂无本地覆盖文件")}</div>
              ) : (
                (selectedDebugProfile.localFiles ?? []).map((file, fileIndex) => (
                  <div
                    key={`${selectedDebugProfile.key || selectedDebugProfileIndex}-${fileIndex}`}
                    className="settings-param-editor"
                  >
                    <div className="settings-param-editor-head">
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={file.enabled}
                            onChange={(event) =>
                              updateDebugLocalFileAt(selectedDebugProfileIndex, fileIndex, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                        }
                        label={t("启用")}
                      />
                      <Button
                        variant="outlined"
                        color="inherit"
                        startIcon={<TrashIcon fontSize="small" />}
                        onClick={() =>
                          deleteDebugLocalFileAt(selectedDebugProfileIndex, fileIndex)
                        }
                        disabled={saving}
                      >
                        {t("删除文件")}
                      </Button>
                    </div>
                    <div className="settings-form-grid settings-form-grid-tight">
                      <TextField
                        size="small"
                        label={t("路径")}
                        value={file.path}
                        onChange={(event) =>
                          updateDebugLocalFileAt(selectedDebugProfileIndex, fileIndex, {
                            path: event.target.value,
                          })
                        }
                        placeholder=".env.local"
                      />
                      <TextField
                        select
                        size="small"
                        label={t("写入方式")}
                        value={file.mode || "overwrite"}
                        onChange={(event) =>
                          updateDebugLocalFileAt(selectedDebugProfileIndex, fileIndex, {
                            mode: event.target.value,
                          })
                        }
                      >
                        {DEBUG_LOCAL_FILE_MODE_OPTIONS.map((mode) => (
                          <MenuItem key={mode.value} value={mode.value}>
                            {t(mode.label)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        className="settings-form-grid-wide"
                        size="small"
                        label={t("内容")}
                        value={file.content}
                        onChange={(event) =>
                          updateDebugLocalFileAt(selectedDebugProfileIndex, fileIndex, {
                            content: event.target.value,
                          })
                        }
                        placeholder={t("写入这个本地文件的内容")}
                        multiline
                        minRows={4}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </Stack>,
    );
  }

  function renderProjectSectionBlock(
    title: string,
    caption: string,
    children: ReactNode,
  ) {
    return (
      <div className="settings-form-block">
        <div className="settings-form-block-head">
          <div>
            <Typography variant="subtitle2">{t(title)}</Typography>
            <Typography variant="caption">{t(caption)}</Typography>
          </div>
        </div>
        {children}
      </div>
    );
  }

  function renderNewProjectBlock() {
    return (
      <div className="settings-form-block settings-compact-block">
        <div className="settings-form-block-head">
          <Typography variant="subtitle2">{t("新增项目")}</Typography>
        </div>
        <div className="settings-form-grid">
          <TextField
            size="small"
            label="Key"
            value={newProjectKey}
            onChange={(event) => setNewProjectKey(event.target.value)}
            disabled={saving}
          />
          <TextField
            size="small"
            label={t("名称")}
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            disabled={saving}
          />
        </div>
        <div className="settings-save-row">
          <Typography variant="caption">{t("写入 projects.toml")}</Typography>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => void addProject()}
            disabled={saving || !newProjectKey.trim() || !newProjectName.trim()}
          >
            {t("新增")}
          </Button>
        </div>
      </div>
    );
  }

  function renderProjectSaveRow(showDelete = false) {
    return (
      <div className="settings-save-row">
        <Typography variant="caption">{editorState?.configPath}</Typography>
        <div className="settings-inline-actions">
          {showDelete ? (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<TrashIcon fontSize="small" />}
              onClick={() => void deleteSelectedProject()}
              disabled={saving}
            >
              {t("删除")}
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CheckIcon fontSize="small" />}
            onClick={() => void saveSelectedProject()}
            disabled={!hasDirtySelectedProject || saving}
          >
            {t("保存")}
          </Button>
        </div>
      </div>
    );
  }

  function renderNoProjectSection(description: string) {
    if (loading && !editorState) {
      return <Alert severity="info">{t("正在读取项目配置")}</Alert>;
    }
    if (!selectedProject) {
      return (
        <Stack spacing={1.3}>
          <AppEmptyState compact title={t("暂无项目配置")} description={t(description)} />
          {renderNewProjectBlock()}
        </Stack>
      );
    }
    return null;
  }

  function renderProjectIdentityBlock() {
    if (!selectedProject) {
      return null;
    }
    return (
      renderProjectSectionBlock(
        "项目身份",
        "分支、构建和本地运行共用这组项目基础信息",
        <div className="settings-form-grid">
          <TextField size="small" label="Key" value={selectedProject.key} disabled />
          <TextField
            size="small"
            label={t("名称")}
            value={selectedProject.name}
            onChange={(event) =>
              updateSelectedProject((project) => ({ ...project, name: event.target.value }))
            }
          />
          <TextField
            size="small"
            label={t("分类")}
            value={selectedProject.category}
            onChange={(event) =>
              updateSelectedProject((project) => ({ ...project, category: event.target.value }))
            }
          />
          <TextField
            size="small"
            label="Git URL"
            value={selectedProject.gitUrl}
            onChange={(event) =>
              updateSelectedProject((project) => ({ ...project, gitUrl: event.target.value }))
            }
          />
          <TextField
            size="small"
            label={t("仓库路径")}
            value={selectedProject.repoPath ?? ""}
            onChange={(event) =>
              updateSelectedProject((project) => ({ ...project, repoPath: event.target.value }))
            }
          />
        </div>,
      )
    );
  }

  function renderProjectLocalCommandsBlock() {
    return renderProjectSectionBlock(
      "项目基础命令",
      "所有启动档案共同继承的 dev 与 build 命令",
      <Stack spacing={1}>
        {renderCommandFields("dev", "dev 服务")}
        {renderCommandFields("build", "本地构建")}
      </Stack>,
    );
  }

  function renderProjectFocusBlock() {
    if (!selectedProject) {
      return null;
    }
    return renderProjectSectionBlock(
      "聚焦",
      "项目页唤起运行中的项目时使用",
      <div className="settings-form-grid">
        <TextField
          size="small"
          label="URL"
          value={selectedProject.focus.url ?? ""}
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: { ...project.focus, url: event.target.value },
            }))
          }
        />
        <TextField
          size="small"
          label="Bundle ID"
          value={selectedProject.focus.bundleId ?? ""}
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: { ...project.focus, bundleId: event.target.value },
            }))
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={Boolean(selectedProject.focus.autoOnStart)}
              onChange={(event) =>
                updateSelectedProject((project) => ({
                  ...project,
                  focus: {
                    ...project.focus,
                    autoOnStart: event.target.checked,
                  },
                }))
              }
            />
          }
          label={t("启动成功后自动唤起")}
          sx={{ alignSelf: "center" }}
        />
        <TextField
          size="small"
          select
          label={t("自动打开")}
          value={selectedProject.focus.autoOpenMode ?? "ready"}
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: {
                ...project.focus,
                autoOpenMode: event.target.value,
              },
            }))
          }
        >
          <MenuItem value="ready">{t("识别成功后打开")}</MenuItem>
          <MenuItem value="started">{t("进程启动后打开")}</MenuItem>
          <MenuItem value="manual">{t("手动打开")}</MenuItem>
        </TextField>
        <TextField
          size="small"
          label={t("识别超时 ms")}
          type="number"
          value={selectedProject.focus.readyTimeoutMs ?? 180000}
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: {
                ...project.focus,
                readyTimeoutMs: Number(event.target.value) || 180000,
              },
            }))
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={selectedProject.focus.readyEnabled ?? true}
              onChange={(event) =>
                updateSelectedProject((project) => ({
                  ...project,
                  focus: {
                    ...project.focus,
                    readyEnabled: event.target.checked,
                  },
                }))
              }
            />
          }
          label={t("启用启动识别")}
          sx={{ alignSelf: "center" }}
        />
        <TextField
          size="small"
          className="settings-form-grid-wide"
          label={t("启动后动作")}
          helperText={t("一行一个网页动作 key，在项目 ready 后按顺序执行")}
          value={selectedProject.focus.afterReadyActionsText ?? ""}
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: {
                ...project.focus,
                afterReadyActionsText: event.target.value,
              },
            }))
          }
          multiline
          minRows={2}
        />
        <TextField
          size="small"
          className="settings-form-grid-wide"
          label={t("URL 提取模板")}
          value={
            selectedProject.focus.readyUrlPatternsText ??
            "- Local: {url}\nLocal: {url}\n- Network: {url}\nNetwork: {url}\nready - {url}"
          }
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: {
                ...project.focus,
                readyUrlPatternsText: event.target.value,
              },
            }))
          }
          multiline
          minRows={2}
        />
        <TextField
          size="small"
          className="settings-form-grid-wide"
          label={t("成功标记（可选）")}
          value={selectedProject.focus.readySuccessMarkersText ?? ""}
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: {
                ...project.focus,
                readySuccessMarkersText: event.target.value,
              },
            }))
          }
          multiline
          minRows={2}
        />
        <TextField
          size="small"
          className="settings-form-grid-wide"
          label={t("失败标记")}
          value={
            selectedProject.focus.readyFailureMarkersText ??
            "Failed to compile\nCompilation failed\nEADDRINUSE"
          }
          onChange={(event) =>
            updateSelectedProject((project) => ({
              ...project,
              focus: {
                ...project.focus,
                readyFailureMarkersText: event.target.value,
              },
            }))
          }
          multiline
          minRows={2}
        />
      </div>,
    );
  }

  function renderProjectBasicsSection() {
    const empty = renderNoProjectSection("新增项目后可维护基础信息。");
    if (empty) {
      return empty;
    }
    return (
      <Stack spacing={1.3}>
        {renderProjectSelector()}
        {renderNewProjectBlock()}
        {renderProjectIdentityBlock()}
        {renderProjectSaveRow(true)}
      </Stack>
    );
  }

  function renderProjectLocalSection() {
    const empty = renderNoProjectSection("新增项目后可配置基础命令和聚焦。");
    if (empty) {
      return empty;
    }
    return (
      <Stack spacing={1.3}>
        {renderProjectSelector()}
        {renderProjectLocalCommandsBlock()}
        {renderProjectFocusBlock()}
        {renderProjectSaveRow()}
      </Stack>
    );
  }

  function renderProjectRuntimeSection() {
    const empty = renderNoProjectSection("新增项目后可配置启动档案。");
    if (empty) {
      return empty;
    }
    const runtimeConfigPath =
      editorState?.runtimeProfileScope === "global"
        ? editorState.configPath
        : editorState?.runtimeConfigPath || selectedRuntimeConfigSource?.files.runtimeOverrides;
    return (
      <Stack spacing={1.3}>
        {renderProjectSelector()}
        {runtimeConfigSources.length > 0 ? (
          <Stack spacing={0.55}>
            <Typography variant="caption" color="text.secondary" fontWeight={750}>
              {t("共享运行环境来源")}
            </Typography>
            <ConfigSourceBar
              sources={runtimeConfigSources}
              selectedSourceId={selectedRuntimeConfigSourceId}
              selectedSource={selectedRuntimeConfigSource}
              path={runtimeConfigPath}
              requiredCapability="runtime"
              profileFallback="runtime"
              disabled={loading || saving || runtimeConfigSourceBusy}
              status={runtimeConfigSourceStatus}
              error={runtimeConfigSourceError}
              showReadyStatus
              manageDisabled={hasUnsavedChanges}
              manageDisabledReason={t("请先保存或取消当前项目改动")}
              onSourceChange={(sourceId) =>
                void handleRuntimeConfigSourceChange(sourceId)
              }
              onManage={() => setRuntimeConfigSourceManagerOpen(true)}
            />
          </Stack>
        ) : null}
        {renderDebugProfilesBlock()}
        {renderProjectSaveRow()}
      </Stack>
    );
  }

  function renderProjectsSection() {
    return renderProjectBasicsSection();
  }

  function renderNavigationEntryTargetFields(
    entry: NavigationEditorEntry,
    categoryIndex: number,
    entryIndex: number,
  ) {
    if (entry.kind === "app") {
      return (
        <>
          <TextField
            size="small"
            label="Bundle ID"
            value={entry.bundleId ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                bundleId: event.target.value,
              })
            }
          />
          <TextField
            size="small"
            label={t("应用名")}
            value={entry.appName ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                appName: event.target.value,
              })
            }
          />
        </>
      );
    }

    if (entry.kind === "script") {
      return (
        <>
          <TextField
            size="small"
            label={t("脚本路径")}
            value={entry.script ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                script: event.target.value,
              })
            }
          />
          <TextField
            size="small"
            label={t("工作目录")}
            value={entry.cwd ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                cwd: event.target.value,
              })
            }
          />
        </>
      );
    }

    if (entry.kind === "tool") {
      return (
        <>
          <TextField
            select
            size="small"
            label={t("工具类型")}
            value={entry.tool ?? "link"}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                tool: event.target.value,
                toolAction: event.target.value === "link" ? "plan" : entry.toolAction,
              })
            }
          >
            <MenuItem value="link">Link</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Link Key"
            value={entry.toolKey ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                toolKey: event.target.value,
              })
            }
          />
          <TextField
            select
            size="small"
            label={t("动作")}
            value={entry.toolAction ?? "plan"}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                toolAction: event.target.value,
              })
            }
          >
            <MenuItem value="plan">{t("查看计划")}</MenuItem>
          </TextField>
        </>
      );
    }

    if (entry.kind === "directory" || entry.kind === "file") {
      const directory = entry.kind === "directory";
      return (
        <div className="settings-path-field settings-form-grid-wide">
          <TextField
            size="small"
            label={t(directory ? "目录路径" : "文件路径")}
            value={entry.path ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                path: event.target.value,
              })
            }
          />
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FolderIcon fontSize="small" />}
            onClick={() => void chooseNavigationPath(categoryIndex, entryIndex, directory)}
            disabled={saving}
          >
            {t("选择")}
          </Button>
        </div>
      );
    }

    const browserSelectValue = navigationBrowserSelectValue(entry.browser);
    const browserSupportsProfile = navigationBrowserSupportsProfile(entry.browser);
    const isCustomBrowser = browserSelectValue === CUSTOM_NAVIGATION_BROWSER_VALUE;

    return (
      <>
        <TextField
          className="settings-form-grid-wide"
          size="small"
          label="URL"
          value={entry.url ?? ""}
          onChange={(event) =>
            updateNavigationEntryAt(categoryIndex, entryIndex, {
              url: event.target.value,
            })
          }
        />
        <div className="settings-browser-route settings-form-grid-wide">
          <div className="settings-browser-route-head">
            <div>
              <Typography variant="caption">{t("打开方式")}</Typography>
              <Typography variant="caption">
                {t("默认沿用当前 Chrome；指定 Chrome / Edge 时可填写 Profile。")}
              </Typography>
            </div>
            <Chip size="small" label={navigationBrowserLabel(entry, t)} variant="outlined" />
          </div>
          <div className="settings-form-grid settings-form-grid-tight">
            <TextField
              select
              size="small"
              label={t("运行环境")}
              value={entry.runtimeProfile ?? ""}
              onChange={(event) =>
                updateNavigationEntryAt(categoryIndex, entryIndex, {
                  runtimeProfile: event.target.value || null,
                })
              }
            >
              <MenuItem value="">{t("不使用")}</MenuItem>
              {runtimeProfiles.map((profile) => (
                <MenuItem key={profile.key} value={profile.key}>
                  {profile.label || profile.key}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t("浏览器")}
              value={browserSelectValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "current_chrome") {
                  updateNavigationEntryAt(categoryIndex, entryIndex, {
                    browser: null,
                    browserProfile: null,
                  });
                  return;
                }
                if (nextValue === CUSTOM_NAVIGATION_BROWSER_VALUE) {
                  updateNavigationEntryAt(categoryIndex, entryIndex, {
                    browser:
                      isCustomBrowser
                        ? entry.browser
                        : "",
                    browserProfile: null,
                  });
                  return;
                }
                updateNavigationEntryAt(categoryIndex, entryIndex, {
                  browser: nextValue,
                  browserProfile: navigationBrowserSupportsProfile(nextValue)
                    ? entry.browserProfile
                    : null,
                });
              }}
            >
              {NAVIGATION_BROWSER_OPTIONS.map((item) => (
                <MenuItem key={item.value} value={item.value}>
                  {t(item.label)}
                </MenuItem>
              ))}
              <MenuItem value={CUSTOM_NAVIGATION_BROWSER_VALUE}>
                {t("自定义应用名")}
              </MenuItem>
            </TextField>
            {isCustomBrowser ? (
              <TextField
                size="small"
                label={t("浏览器应用")}
                value={entry.browser ?? ""}
                onChange={(event) =>
                  updateNavigationEntryAt(categoryIndex, entryIndex, {
                    browser: event.target.value,
                    browserProfile: navigationBrowserSupportsProfile(event.target.value)
                      ? entry.browserProfile
                      : null,
                  })
                }
              />
            ) : null}
            {browserSupportsProfile ? (
              <TextField
                size="small"
                label="Profile"
                value={entry.browserProfile ?? ""}
                helperText={t("例如 Default 或 Profile 2")}
                onChange={(event) =>
                  updateNavigationEntryAt(categoryIndex, entryIndex, {
                    browserProfile: event.target.value,
                  })
                }
              />
            ) : null}
          </div>
        </div>
      </>
    );
  }

  function renderNavigationEntryEditor(
    categoryIndex: number,
    entry: NavigationEditorEntry,
    entryIndex: number,
  ) {
    const kindLabel = navigationEntryKindLabel(entry.kind, t);

    return (
      <div className="settings-param-editor settings-finder-entry" key={`entry-${categoryIndex}-${entryIndex}`}>
        <div className="settings-param-editor-head">
          <div className="settings-finder-entry-title">
            <Typography variant="caption">{entry.name || t("未命名入口")}</Typography>
            <Chip size="small" label={kindLabel} variant="outlined" />
          </div>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<TrashIcon fontSize="small" />}
            onClick={() => deleteNavigationEntryAt(categoryIndex, entryIndex)}
            disabled={saving}
          >
            {t("删除")}
          </Button>
        </div>
        <div className="settings-form-grid settings-form-grid-tight">
          <TextField
            size="small"
            label={t("名称")}
            value={entry.name}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                name: event.target.value,
              })
            }
          />
          <TextField
            select
            size="small"
            label={t("类型")}
            value={entry.kind}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                kind: event.target.value as NavigationEditorEntryKind,
              })
            }
          >
            {NAVIGATION_ENTRY_KIND_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {t(item.label)}
              </MenuItem>
            ))}
          </TextField>
          {renderNavigationEntryTargetFields(entry, categoryIndex, entryIndex)}
          <TextField
            className="settings-form-grid-wide"
            size="small"
            label={t("备注")}
            value={entry.note ?? ""}
            onChange={(event) =>
              updateNavigationEntryAt(categoryIndex, entryIndex, {
                note: event.target.value,
              })
            }
          />
        </div>
      </div>
    );
  }

  function renderFinderSection() {
    if (navigationLoading && !navigationEditor) {
      return <Alert severity="info">{t("正在读取访达配置")}</Alert>;
    }
    if (!navigationEditor) {
      return (
        <Stack spacing={1.3}>
          <AppEmptyState
            compact
            title={t("暂无访达配置")}
            description={t("读取配置后可维护快捷入口。")}
          />
          <div className="settings-action-grid">
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => void loadNavigationEditor()}
              disabled={navigationLoading}
            >
              {t("重新读取")}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<OpenExternalIcon fontSize="small" />}
              onClick={() => void openNavigationEditorFile()}
            >
              navigation.toml
            </Button>
          </div>
        </Stack>
      );
    }

    const categoryCount = navigationEditor.categories.length;
    const activeCategoryIndex =
      categoryCount === 0
        ? 0
        : Math.min(selectedNavigationCategoryIndex, categoryCount - 1);
    const activeCategory = navigationEditor.categories[activeCategoryIndex] ?? null;
    const preferredCategoryValue = navigationEditor.categories.some(
      (category) => category.title === navigationEditor.preferredCategory,
    )
      ? (navigationEditor.preferredCategory ?? "")
      : "";

    return (
      <Stack spacing={1.3}>
        {renderProjectSectionBlock(
          "访达配置",
          "管理访达页的网站、目录和工具入口",
          <>
            <div className="settings-finder-toolbar">
              <TextField
                select
                size="small"
                label={t("默认分类")}
                value={preferredCategoryValue}
                onChange={(event) =>
                  updateNavigationEditor((current) => ({
                    ...current,
                    preferredCategory: event.target.value,
                  }))
                }
                disabled={categoryCount === 0}
              >
                <MenuItem value="" disabled>
                  {t("选择默认分类")}
                </MenuItem>
                {navigationEditor.categories.map((category) => (
                  <MenuItem key={category.title} value={category.title}>
                    {category.title || t("未命名分类")}
                  </MenuItem>
                ))}
              </TextField>
              <div className="settings-inline-actions">
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={addNavigationCategory}
                  disabled={saving}
                >
                  {t("新增分类")}
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<RefreshIcon fontSize="small" />}
                  onClick={() => void loadNavigationEditor()}
                  disabled={navigationLoading || saving}
                >
                  {t("刷新")}
                </Button>
              </div>
            </div>
            {categoryCount === 0 ? (
              <div className="settings-empty-row">
                {t("暂无分类，先新增一个访达分类")}
              </div>
            ) : (
              <div
                className="settings-deploy-switcher settings-finder-switcher"
                role="tablist"
                aria-label={t("访达分类")}
              >
                {navigationEditor.categories.map((category, categoryIndex) => (
                  <button
                    key={`${category.title}-${categoryIndex}`}
                    type="button"
                    className={activeCategoryIndex === categoryIndex ? "is-active" : ""}
                    onClick={() => setSelectedNavigationCategoryIndex(categoryIndex)}
                    aria-selected={activeCategoryIndex === categoryIndex}
                  >
                    <span>{category.title || t("未命名分类")}</span>
                    <small>{t("{count} 个入口", { count: category.entries.length })}</small>
                  </button>
                ))}
              </div>
            )}
          </>,
        )}

        {activeCategory ? (
          <div className="settings-form-block">
            <div className="settings-form-block-head">
              <div>
                <Typography variant="subtitle2">
                  {activeCategory.title || t("未命名分类")}
                </Typography>
                <Typography variant="caption">
                  {t("{count} 个入口", { count: activeCategory.entries.length })} ·{" "}
                  {activeCategory.shortLabel || t("无短名")}
                </Typography>
              </div>
              <div className="settings-inline-actions">
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<TrashIcon fontSize="small" />}
                  onClick={() => deleteNavigationCategoryAt(activeCategoryIndex)}
                  disabled={saving}
                >
                  {t("删除分类")}
                </Button>
              </div>
            </div>
            <div className="settings-form-grid">
              <TextField
                size="small"
                label={t("分类名称")}
                value={activeCategory.title}
                onChange={(event) => {
                  const nextTitle = event.target.value;
                  const previousTitle = activeCategory.title;
                  updateNavigationEditor((current) => ({
                    ...current,
                    preferredCategory:
                      current.preferredCategory === previousTitle
                        ? nextTitle
                        : current.preferredCategory,
                    categories: current.categories.map((category, index) =>
                      index === activeCategoryIndex
                        ? { ...category, title: nextTitle }
                        : category,
                    ),
                  }));
                }}
              />
              <TextField
                size="small"
                label={t("短名")}
                value={activeCategory.shortLabel}
                onChange={(event) =>
                  updateNavigationCategoryAt(activeCategoryIndex, {
                    shortLabel: event.target.value,
                  })
                }
              />
            </div>
            <div className="settings-param-list">
              <div className="settings-param-list-head">
                <Typography variant="caption">{t("入口")}</Typography>
                <div className="settings-inline-actions">
                  {NAVIGATION_ENTRY_CREATE_OPTIONS.map((item) => (
                    <Button
                      key={item.value}
                      variant="outlined"
                      color="inherit"
                      onClick={() => addNavigationEntry(activeCategoryIndex, item.value)}
                      disabled={saving}
                    >
                      {t("新增{kind}", { kind: t(item.label) })}
                    </Button>
                  ))}
                </div>
              </div>
              {activeCategory.entries.length === 0 ? (
                <div className="settings-empty-row">{t("暂无入口")}</div>
              ) : (
                activeCategory.entries.map((entry, entryIndex) =>
                  renderNavigationEntryEditor(activeCategoryIndex, entry, entryIndex),
                )
              )}
            </div>
          </div>
        ) : null}

        <div className="settings-save-row">
          <Typography variant="caption">{navigationEditor.filePath}</Typography>
          <div className="settings-inline-actions">
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<OpenExternalIcon fontSize="small" />}
              onClick={() => void openNavigationEditorFile()}
            >
              {t("打开文件")}
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              onClick={() => void saveNavigationEditor()}
              disabled={!navigationDirty || saving}
            >
              {t("保存")}
            </Button>
          </div>
        </div>
      </Stack>
    );
  }

  function renderBranchSection() {
    if (loading && !editorState) {
      return <Alert severity="info">{t("正在读取分支配置")}</Alert>;
    }
    function keywordListFieldProps(
      draftKey: string,
      keywords: string[],
      onUpdate: (keywords: string[]) => void,
    ) {
      const text = keywordDrafts[draftKey] ?? keywords.join(", ");
      return {
        value: text,
        onFocus: () =>
          setKeywordDrafts((current) => ({
            ...current,
            [draftKey]: text,
          })),
        onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          onUpdate(parseKeywordList(event.target.value));
          setKeywordDrafts((current) => {
            const next = { ...current };
            delete next[draftKey];
            return next;
          });
        },
        onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          const value = event.target.value;
          setKeywordDrafts((current) => ({
            ...current,
            [draftKey]: value,
          }));
        },
        inputProps: {
          autoCapitalize: "none",
          autoComplete: "off",
          autoCorrect: "off",
          spellCheck: false,
        },
      };
    }

    const projectOverridesSourceRules = Boolean(
      selectedProject?.branchRules.sourceKeywords.length,
    );
    const projectOverridesTargetRules = Boolean(
      selectedProject?.branchRules.targetKeywords.length,
    );
    const projectOverridesBranchRules =
      projectOverridesSourceRules || projectOverridesTargetRules;
    const projectSourceKeywords = projectOverridesSourceRules
      ? selectedProject?.branchRules.sourceKeywords ?? []
      : defaultBranchRules.sourceKeywords;
    const projectTargetKeywords = projectOverridesTargetRules
      ? selectedProject?.branchRules.targetKeywords ?? []
      : defaultBranchRules.targetKeywords;

    if (!selectedProject) {
      return (
        <Stack spacing={1.3}>
          {renderProjectSectionBlock(
            "默认分支规则",
            "所有项目默认使用这组规则，项目额外配置会覆盖它",
            <div className="settings-form-grid">
              <TextField
                size="small"
                label={t("默认源分支关键词")}
                {...keywordListFieldProps(
                  "default-branch-source",
                  defaultBranchRules.sourceKeywords,
                  (sourceKeywords) => {
                    updateDefaultBranchRules({
                      sourceKeywords,
                    });
                  },
                )}
              />
              <TextField
                size="small"
                label={t("默认目标分支关键词")}
                {...keywordListFieldProps(
                  "default-branch-target",
                  defaultBranchRules.targetKeywords,
                  (targetKeywords) => {
                    updateDefaultBranchRules({
                      targetKeywords,
                    });
                  },
                )}
              />
            </div>,
          )}
          <div className="settings-save-row">
            <Typography variant="caption">{editorState?.configPath}</Typography>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              onClick={() => void saveDefaultBranchRules()}
              disabled={!defaultBranchRulesDirty || saving}
            >
              {t("保存默认")}
            </Button>
          </div>
          <AppEmptyState
            compact
            title={t("暂无项目配置")}
            description={t("新增项目后可配置分支规则。")}
          />
          {renderNewProjectBlock()}
        </Stack>
      );
    }

    return (
      <Stack spacing={1.3}>
        {renderProjectSectionBlock(
          "默认分支规则",
          "所有项目默认使用这组规则，项目额外配置会覆盖它",
          <div className="settings-form-grid">
            <TextField
              size="small"
              label={t("默认源分支关键词")}
              {...keywordListFieldProps(
                "default-branch-source",
                defaultBranchRules.sourceKeywords,
                (sourceKeywords) => {
                  updateDefaultBranchRules({
                    sourceKeywords,
                  });
                },
              )}
            />
            <TextField
              size="small"
              label={t("默认目标分支关键词")}
              {...keywordListFieldProps(
                "default-branch-target",
                defaultBranchRules.targetKeywords,
                (targetKeywords) => {
                  updateDefaultBranchRules({
                    targetKeywords,
                  });
                },
              )}
            />
          </div>,
        )}
        <div className="settings-save-row">
          <Typography variant="caption">{editorState?.configPath}</Typography>
          <Button
            variant="contained"
            startIcon={<CheckIcon fontSize="small" />}
            onClick={() => void saveDefaultBranchRules()}
            disabled={!defaultBranchRulesDirty || saving}
          >
            {t("保存默认")}
          </Button>
        </div>
        {renderProjectSelector()}
        {renderProjectSectionBlock(
          "项目分支规则",
          "留空继承默认规则；当前项目填写后会优先使用项目规则",
          <Stack spacing={1}>
            <div className="settings-inline-actions">
              <Chip
                size="small"
                label={t(projectOverridesBranchRules ? "项目覆盖默认" : "继承默认设置")}
                color={projectOverridesBranchRules ? "primary" : "default"}
                variant={projectOverridesBranchRules ? "filled" : "outlined"}
              />
              <Button
                variant="outlined"
                color="inherit"
                onClick={useDefaultBranchRulesForProject}
                disabled={!projectOverridesBranchRules || saving}
              >
                {t("使用默认设置")}
              </Button>
            </div>
            <div className="settings-form-grid">
              <TextField
                size="small"
                label={t(
                  projectOverridesSourceRules
                    ? "源分支关键词"
                    : "源分支关键词（继承默认）",
                )}
                {...keywordListFieldProps(
                  `project-branch-source:${selectedProject.key}`,
                  projectSourceKeywords,
                  (sourceKeywords) => {
                    updateSelectedProjectBranchRules({
                      sourceKeywords,
                    });
                  },
                )}
              />
              <TextField
                size="small"
                label={t(
                  projectOverridesTargetRules
                    ? "目标分支关键词"
                    : "目标分支关键词（继承默认）",
                )}
                {...keywordListFieldProps(
                  `project-branch-target:${selectedProject.key}`,
                  projectTargetKeywords,
                  (targetKeywords) => {
                    updateSelectedProjectBranchRules({
                      targetKeywords,
                    });
                  },
                )}
              />
            </div>
          </Stack>,
        )}
        {renderProjectSaveRow()}
      </Stack>
    );
  }

  function renderDeployParamEditor(
    targetIndex: number,
    param: DeployParamConfigSummary,
    paramIndex: number,
  ) {
    const showOptions = param.kind === "select";
    const showBooleanValues = param.kind === "boolean";
    const targetKey = selectedProject?.deployTargets[targetIndex]?.key ?? String(targetIndex);
    const optionsDraftKey = `${selectedProject?.key ?? ""}:${targetKey}:${paramIndex}:${param.key}`;
    const optionsText = deployParamOptionsDrafts[optionsDraftKey] ?? param.options.join(", ");

    return (
      <div className="settings-param-editor" key={`deploy-param-${targetIndex}-${paramIndex}`}>
        <div className="settings-param-editor-head">
          <Typography variant="caption">{param.label || param.key}</Typography>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<TrashIcon fontSize="small" />}
            onClick={() => deleteDeployParamAt(targetIndex, paramIndex)}
            disabled={saving}
          >
            {t("删除")}
          </Button>
        </div>
        <div className="settings-form-grid settings-form-grid-tight">
          <TextField
            size="small"
            label="Key"
            value={param.key}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, { key: event.target.value })
            }
          />
          <TextField
            size="small"
            label={t("名称")}
            value={param.label}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, { label: event.target.value })
            }
          />
          <TextField
            select
            size="small"
            label={t("类型")}
            value={param.kind}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, {
                kind: event.target.value as DeployParamConfigKind,
              })
            }
          >
            {DEPLOY_PARAM_KIND_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {t(item.label)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t("默认值")}
            value={param.defaultValue ?? ""}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, {
                defaultValue: event.target.value,
              })
            }
          />
          {showOptions ? (
            <TextField
              size="small"
              label={t("选项")}
              className="settings-form-grid-wide"
              value={optionsText}
              onFocus={() =>
                setDeployParamOptionsDrafts((current) => ({
                  ...current,
                  [optionsDraftKey]: optionsText,
                }))
              }
              onBlur={(event) => {
                updateDeployParamAt(targetIndex, paramIndex, {
                  options: parseParamOptions(event.target.value),
                });
                setDeployParamOptionsDrafts((current) => {
                  const next = { ...current };
                  delete next[optionsDraftKey];
                  return next;
                });
              }}
              onChange={(event) => {
                const value = event.target.value;
                setDeployParamOptionsDrafts((current) => ({
                  ...current,
                  [optionsDraftKey]: value,
                }));
              }}
              inputProps={{
                autoCapitalize: "none",
                autoComplete: "off",
                autoCorrect: "off",
                spellCheck: false,
              }}
            />
          ) : null}
          {showBooleanValues ? (
            <>
              <TextField
                size="small"
                label={t("True 值")}
                value={param.trueValue ?? ""}
                onChange={(event) =>
                  updateDeployParamAt(targetIndex, paramIndex, {
                    trueValue: event.target.value,
                  })
                }
              />
              <TextField
                size="small"
                label={t("False 值")}
                value={param.falseValue ?? ""}
                onChange={(event) =>
                  updateDeployParamAt(targetIndex, paramIndex, {
                    falseValue: event.target.value,
                  })
                }
              />
              <TextField
                size="small"
                multiline
                minRows={2}
                label={t("影响路径")}
                className="settings-form-grid-wide"
                value={param.impactPaths.join("\n")}
                onChange={(event) =>
                  updateDeployParamAt(targetIndex, paramIndex, {
                    impactPaths: event.target.value.split(/\r?\n|[,，]/),
                  })
                }
                onBlur={(event) =>
                  updateDeployParamAt(targetIndex, paramIndex, {
                    impactPaths: event.target.value
                      .split(/\r?\n|[,，]/)
                      .map((path) => path.trim())
                      .filter(Boolean),
                  })
                }
                helperText={t(
                  "每行一个仓库相对路径，可用 mobile/** 这类目录模式；命中后要求启用该构建项。",
                )}
                inputProps={{
                  autoCapitalize: "none",
                  autoComplete: "off",
                  autoCorrect: "off",
                  spellCheck: false,
                }}
              />
            </>
          ) : null}
        </div>
        <FormControlLabel
          className="settings-checkbox-row"
          control={
            <Checkbox
              size="small"
              checked={param.required}
              onChange={(event) =>
                updateDeployParamAt(targetIndex, paramIndex, { required: event.target.checked })
              }
            />
          }
          label={t("必填")}
        />
      </div>
    );
  }

  function renderDeploySection() {
    if (loading && !editorState) {
      return <Alert severity="info">{t("正在读取构建配置")}</Alert>;
    }
    if (!selectedProject) {
      return (
        <AppEmptyState
          compact
          title={t("暂无项目配置")}
          description={t("新增项目后可配置构建任务。")}
        />
      );
    }
    const deployTargetCount = selectedProject.deployTargets.length;
    const activeDeployTargetIndex =
      deployTargetCount === 0
        ? 0
        : Math.min(selectedDeployTargetIndex, deployTargetCount - 1);
    const activeDeployTarget = selectedProject.deployTargets[activeDeployTargetIndex] ?? null;
    const activeDeployTargetDetail = activeDeployTarget
      ? BUILD_ADAPTER_DETAILS[activeDeployTarget.adapter]
      : null;
    const missingRSeriesPackageParams = activeDeployTarget
      ? missingBuildParamPresets(activeDeployTarget, R_SERIES_PACKAGE_PARAM_PRESETS)
      : [];

    return (
      <Stack spacing={1.2}>
        {renderProjectSelector()}
        <div className="settings-save-row">
          <Typography variant="caption">
            {t("{count} 个构建配置", {
              count: selectedProject.deployTargets.length,
            })}
          </Typography>
          <div className="settings-inline-actions">
            <Button
              variant="outlined"
              color="inherit"
              onClick={addDeployTarget}
              disabled={saving}
            >
              {t("新增配置")}
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              onClick={() => void saveDeployTargets()}
              disabled={!hasDirtySelectedDeployProject || saving}
            >
              {t("保存构建")}
            </Button>
          </div>
        </div>
        {deployTargetCount === 0 ? (
          <Alert severity="info">{t("该项目未配置构建目标")}</Alert>
        ) : activeDeployTarget ? (
          <>
            <div
              className="settings-deploy-switcher"
              role="tablist"
              aria-label={t("构建配置")}
            >
              {selectedProject.deployTargets.map((target, targetIndex) => (
                <button
                  key={`${target.key}-${targetIndex}`}
                  type="button"
                  className={activeDeployTargetIndex === targetIndex ? "is-active" : ""}
                  onClick={() => setSelectedDeployTargetIndex(targetIndex)}
                  aria-selected={activeDeployTargetIndex === targetIndex}
                >
                  <span>{target.label || target.key || t("未命名")}</span>
                  <small>
                    {targetIndex === 0 ? `${t("默认")} · ` : ""}
                    {target.key || "new"}
                  </small>
                </button>
              ))}
            </div>
            <div className="settings-deploy-item">
              <div className="settings-deploy-item-head">
                <div>
                  <Typography variant="subtitle2">
                    {activeDeployTarget.label || activeDeployTarget.key}
                  </Typography>
                  <Typography variant="caption">
                    {activeDeployTarget.jobName ||
                      (activeDeployTargetDetail
                        ? t(activeDeployTargetDetail.emptyJobText)
                        : t("未设置任务"))}
                  </Typography>
                </div>
                <div className="settings-inline-actions">
                  <Chip
                    size="small"
                    label={
                      activeDeployTargetIndex === 0
                        ? `${t("默认")} · ${activeDeployTarget.key || "new"}`
                        : activeDeployTarget.key || "new"
                    }
                    color={activeDeployTargetIndex === 0 ? "primary" : "default"}
                    variant="outlined"
                  />
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<CheckIcon fontSize="small" />}
                    onClick={() => setDeployTargetAsDefault(activeDeployTargetIndex)}
                    disabled={saving || activeDeployTargetIndex === 0}
                  >
                    {t("设为默认")}
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<CopyIcon fontSize="small" />}
                    onClick={() => duplicateDeployTargetAt(activeDeployTargetIndex)}
                    disabled={saving}
                  >
                    {t("复制当前")}
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<TrashIcon fontSize="small" />}
                    onClick={() => deleteDeployTargetAt(activeDeployTargetIndex)}
                    disabled={saving}
                  >
                    {t("删除")}
                  </Button>
                </div>
              </div>
              <div className="settings-build-config-stack">
                <section className="settings-build-config-block">
                  <div className="settings-build-config-head">
                    <Typography variant="caption">{t("基础")}</Typography>
                  </div>
                  <div className="settings-form-grid">
                    <TextField
                      size="small"
                      label="Key"
                      value={activeDeployTarget.key}
                      onChange={(event) =>
                        updateDeployTargetAt(activeDeployTargetIndex, { key: event.target.value })
                      }
                    />
                    <TextField
                      size="small"
                      label={t("名称")}
                      value={activeDeployTarget.label}
                      onChange={(event) =>
                        updateDeployTargetAt(activeDeployTargetIndex, { label: event.target.value })
                      }
                    />
                    <TextField
                      select
                      size="small"
                      label="Adapter"
                      value={activeDeployTarget.adapter}
                      onChange={(event) =>
                        updateDeployTargetAdapterAt(
                          activeDeployTargetIndex,
                          event.target.value as DeployTargetConfigSummary["adapter"],
                        )
                      }
                    >
                      {BUILD_ADAPTER_OPTIONS.map((item) => (
                        <MenuItem key={item.value} value={item.value}>
                          {t(item.label)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={t("动作")}
                      value={activeDeployTarget.actionKind}
                      onChange={(event) =>
                        updateDeployTargetAt(activeDeployTargetIndex, {
                          actionKind: event.target.value as DeployTargetConfigSummary["actionKind"],
                        })
                      }
                    >
                      {BUILD_ACTION_KIND_OPTIONS.map((item) => (
                        <MenuItem key={item.value} value={item.value}>
                          {t(item.label)}
                        </MenuItem>
                      ))}
                    </TextField>
                  </div>
                </section>

                {activeDeployTargetDetail ? (
                  <section className="settings-build-config-block">
                    <div className="settings-build-config-head">
                      <div>
                        <Typography variant="subtitle2">
                          {t(activeDeployTargetDetail.title)}
                        </Typography>
                        <Typography variant="caption">
                          {activeDeployTargetDetail.meta}
                        </Typography>
                      </div>
                      <div className="settings-inline-actions">
                        <Chip
                          size="small"
                          label={buildActionKindLabel(activeDeployTarget.actionKind, t)}
                          variant="outlined"
                        />
                        {activeDeployTarget.adapter === "r_series_package" ? (
                          <Button
                            variant="outlined"
                            color="inherit"
                            onClick={() =>
                              addDeployParamPresets(
                                activeDeployTargetIndex,
                                R_SERIES_PACKAGE_PARAM_PRESETS,
                              )
                            }
                            disabled={saving || missingRSeriesPackageParams.length === 0}
                          >
                            {t("补齐 R 参数")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {activeDeployTarget.adapter === "jenkins" ? (
                      <div className="settings-form-grid">
                        <TextField
                          select={jenkinsProfileOptions.length > 0}
                          size="small"
                          label="Jenkins Profile"
                          value={activeDeployTarget.jenkinsProfile}
                          onChange={(event) =>
                            updateDeployTargetAt(activeDeployTargetIndex, {
                              jenkinsProfile: event.target.value,
                            })
                          }
                        >
                          {jenkinsProfileOptions.map((profileKey) => (
                            <MenuItem key={profileKey} value={profileKey}>
                              {profileKey}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label={t(activeDeployTargetDetail.commandLabel)}
                          placeholder={t(activeDeployTargetDetail.commandPlaceholder)}
                          value={activeDeployTarget.jobName}
                          onChange={(event) =>
                            updateDeployTargetAt(activeDeployTargetIndex, {
                              jobName: event.target.value,
                            })
                          }
                        />
                      </div>
                    ) : (
                      <TextField
                        size="small"
                        className="settings-form-grid-wide"
                        label={t(activeDeployTargetDetail.commandLabel)}
                        placeholder={t(activeDeployTargetDetail.commandPlaceholder)}
                        value={activeDeployTarget.jobName}
                        onChange={(event) =>
                          updateDeployTargetAt(activeDeployTargetIndex, {
                            jobName: event.target.value,
                          })
                        }
                      />
                    )}
                  </section>
                ) : null}
                <section className="settings-build-config-block">
                  <div className="settings-build-config-head">
                    <Typography variant="caption">{t("产物")}</Typography>
                  </div>
                  <TextField
                    size="small"
                    className="settings-form-grid-wide"
                    label={t("产物目录")}
                    value={activeDeployTarget.artifactOutputDir ?? ""}
                    onChange={(event) =>
                      updateDeployTargetAt(activeDeployTargetIndex, {
                        artifactOutputDir: event.target.value || null,
                      })
                    }
                    placeholder={t("留空时使用项目构建输出目录")}
                    helperText={
                      activeDeployTarget.adapter === "jenkins"
                        ? t("仅用于产物定位，不会作为 Jenkins 参数发送。")
                        : t("相对路径基于构建目录；留空时使用项目构建输出目录。")
                    }
                  />
                </section>
              </div>
              <div
                className="settings-param-list"
                aria-label={t("{name} 参数", { name: activeDeployTarget.label })}
              >
                <div className="settings-param-list-head">
                  <Typography variant="caption">
                    {t("{count} 个参数", { count: activeDeployTarget.params.length })}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="inherit"
                    onClick={() => addDeployParam(activeDeployTargetIndex)}
                    disabled={saving}
                  >
                    {t("新增参数")}
                  </Button>
                </div>
                {activeDeployTarget.params.length === 0 ? (
                  <div className="settings-empty-row">{t("无参数")}</div>
                ) : (
                  activeDeployTarget.params.map((param, paramIndex) =>
                    renderDeployParamEditor(activeDeployTargetIndex, param, paramIndex),
                  )
                )}
              </div>
            </div>
          </>
        ) : null}
        <div className="settings-save-row">
          <Typography variant="caption">{editorState?.configPath}</Typography>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<OpenExternalIcon fontSize="small" />}
            onClick={onOpenConfigFile}
          >
            {t("原始配置")}
          </Button>
        </div>
      </Stack>
    );
  }

  return (
    <div
      className={`settings-overlay${surface === "projectManagement" ? " settings-overlay--drawer" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`settings-panel settings-panel-wide${
          surface === "projectManagement" ? " settings-panel--project-config" : " settings-panel--global"
        }`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={t(surface === "projectManagement" ? "项目配置" : "设置")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-panel-head">
          <div>
            <Typography variant="subtitle2">
              {t(surface === "projectManagement" ? "项目配置" : "设置")}
            </Typography>
            <Typography variant="caption">
              {t(surface === "projectManagement" ? "项目管理" : "应用偏好与行为")}
            </Typography>
          </div>
          <button
            type="button"
            className="settings-close-button"
            aria-label={t("关闭设置")}
            onClick={requestClose}
          >
            <ClearIcon fontSize="small" />
          </button>
        </div>

        <div className="settings-panel-body">
          <div className="settings-section-nav" role="tablist" aria-label={t("设置分类")}>
            {visibleSectionItems.map((item) => (
              <button
                key={item.key}
                id={`settings-${item.key}-tab`}
                type="button"
                role="tab"
                aria-selected={activeSection === item.key}
                aria-controls={`settings-${item.key}-panel`}
                className={activeSection === item.key ? "is-active" : ""}
                onClick={() => setActiveSection(item.key)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>

          <div
            id={`settings-${activeSection}-panel`}
            className="settings-section-content"
            role="tabpanel"
            aria-labelledby={`settings-${activeSection}-tab`}
          >
            <AppToast
              message={error || status}
              severity={error ? "error" : "success"}
              autoHideDuration={error ? 5200 : 2800}
              nonce={toastNonce}
            />
            {surface === "projectManagement" ? (
              <>
                {activeSection === "workspace" ? renderWorkspaceSection() : null}
                {activeSection === "projects"
                  ? renderProjectsSection()
                  : null}
                {activeSection === "projectBasics"
                  ? renderProjectBasicsSection()
                  : null}
                {activeSection === "projectLocal"
                  ? renderProjectLocalSection()
                  : null}
                {activeSection === "projectRuntime"
                  ? renderProjectRuntimeSection()
                  : null}
                {activeSection === "finder" ? renderFinderSection() : null}
                {activeSection === "branch" || activeSection === "projectBranch"
                  ? renderBranchSection()
                  : null}
                {activeSection === "build" || activeSection === "projectBuild"
                  ? renderDeploySection()
                  : null}
              </>
            ) : (
              renderGeneralSection()
            )}
          </div>
        </div>
      </div>
      <ConfigSourceManagerDialog
        open={runtimeConfigSourceManagerOpen}
        initialSourceId={selectedRuntimeConfigSourceId}
        onClose={() => setRuntimeConfigSourceManagerOpen(false)}
        onChanged={async (sources) => {
          try {
            const result = adoptRuntimeConfigSources(
              sources,
              selectedRuntimeConfigSourceId,
            );
            await loadProjectConfig(selectedKey, result.sourceId);
          } catch (reason) {
            setError(String(reason));
          }
        }}
      />
      {confirmState ? (
        <div
          className="settings-confirm-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmState(null);
            }
          }}
        >
          <div
            className="settings-confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-label={t(confirmState.title)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Typography variant="subtitle2">{t(confirmState.title)}</Typography>
            <Typography variant="body2">{t(confirmState.message)}</Typography>
            <div className="settings-confirm-actions">
              <Button variant="outlined" color="inherit" onClick={() => setConfirmState(null)}>
                {t("取消")}
              </Button>
              <Button
                variant="contained"
                color={confirmState.tone === "danger" ? "error" : "primary"}
                onClick={() => void runConfirmAction()}
              >
                {t(confirmState.confirmLabel)}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
