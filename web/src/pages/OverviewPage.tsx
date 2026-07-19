import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import type {
  CreateProjectWorkspacePayload,
  InitDemandWorkspacePayload,
  InitDemandWorkspaceResult,
  LinkExecutionReport,
  LinkPlan,
  LinkRuntimeSummary,
  ProjectManagementViewKey,
  ProjectRuntimeEntry,
  ProjectWorkspaceEditorDraft,
  ProjectWorkspaceEditorState,
  ProjectWorkspaceState,
  ProjectWorkspaceSummary,
} from "../app-types";
import { resolveProjectRuntimeDebugProfile } from "../hooks/useProjectsModule";
import {
  CheckIcon,
  CollapseIcon,
  ClearIcon,
  CopyIcon,
  ExpandIcon,
  FolderIcon,
  AppWindowIcon,
  LocateIcon,
  OpenExternalIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  ReplayIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  WebsiteIcon,
  WorkflowIcon,
} from "../components/AppIcons";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppListEndState } from "../components/AppListEndState";
import {
  LinkPlanDialog,
  type LinkPlanDialogAction,
  type LinkPlanDialogState,
} from "../components/LinkPlanDialog";
import { AppToast } from "../components/AppToast";
import { WorkspaceTypeSelect } from "../components/WorkspaceTypeSelect";
import {
  WorkspacePageToolbar,
  WorkspacePageToolbarAction,
} from "../components/WorkspacePageToolbar";
import { useWorkspaceTypeOptions } from "../hooks/useWorkspaceTypeOptions";
import {
  AI_CONTEXT_LIMIT_OPTIONS,
  AI_CONTEXT_SCOPE_OPTIONS,
  BUILTIN_AI_CONTEXT_PRESETS,
  DEFAULT_AI_CONTEXT_OPTIONS,
  isSameAiContextOptions,
  loadAiContextPresets,
  normalizeAiContextPresetKey,
  persistAiContextCustomPresets as persistAiContextTemplatePresets,
  subscribeAiContextPresets,
  type AiContextOptions as WorkspaceAiContextOptions,
  type AiContextPreset as WorkspaceAiContextPreset,
} from "../lib/aiContextTemplates";
import type { TrayPinnedAction } from "../lib/trayPins";
import {
  DEFAULT_NEW_WORKSPACE_TYPE,
  normalizeWorkspaceType,
  workspaceTypeCountOptions,
  workspaceTypeLabel,
  workspaceTypeOptionsWithValues,
} from "../lib/workspaceTypes";
import { configSourceIdForWorkspace } from "../lib/configSources";

export type OverviewPageProps = {
  projectWorkspaces: ProjectWorkspaceSummary[];
  activeProjectWorkspaceKey: string;
  onProjectWorkspaceChange: (workspaceKey: string) => Promise<void> | void;
  onNavigateToPage: (page: OverviewNavigationPage) => void;
  onProjectManagementViewChange: (view: ProjectManagementViewKey) => void;
  onProjectChange: (projectKey: string) => void;
  onCreateProjectWorkspace: (payload: CreateProjectWorkspacePayload) => Promise<void> | void;
  onInitDemandWorkspace: (
    payload: InitDemandWorkspacePayload,
  ) => Promise<InitDemandWorkspaceResult> | InitDemandWorkspaceResult;
  onProjectConfigSaved: () => Promise<void> | void;
  workspaceConfigOpenSignal?: number;
  runtimeEntries: ProjectRuntimeEntry[];
  selectedDebugProfileKeys: Record<string, string>;
  projectRuntimePreferencesHydrated: boolean;
  onStartProjectRuntime: (
    projectKey: string,
    debugProfileKey?: string,
  ) => Promise<unknown> | unknown;
  onStartProxyProfile: (profileId: string) => Promise<unknown> | unknown;
  onStopProxyProfile: (profileId: string) => Promise<unknown> | unknown;
  onFocusProjectRuntime: (projectKey: string) => Promise<unknown> | unknown;
  onExecutePinnedAction: (action: TrayPinnedAction) => Promise<void>;
};

type OverviewNavigationPage = "projectManagement" | "resources" | "proxy";

type OverviewSectionQuickAction = {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => Promise<void> | void;
  disabled?: boolean;
};

type WorkspacePinnedActionItem = {
  action: TrayPinnedAction;
  kindLabel: string;
  label: string;
  detail?: string | null;
  projectKey?: string | null;
  params: Array<{
    label: string;
    value: string;
  }>;
  confirmRequired: boolean;
  updatedAtMs: number;
};

type WorkspacePinnedActionsOverview = {
  key: string;
  name: string;
  description?: string | null;
  system: boolean;
  rootDir?: string | null;
  workspaceKind: string;
  workspaceType: string;
  workspaceTypeLabel: string;
  projectCount: number;
  entryCount: number;
  actionCount: number;
  proxyProfileCount: number;
  resources: WorkspaceResourceShortcutItem[];
  projectDirectories: WorkspaceProjectDirectoryItem[];
  proxyProfiles: WorkspaceProxyProfileItem[];
  actions: WorkspacePinnedActionItem[];
};

function systemWorkspaceThenCurrent<T extends { key: string; system: boolean }>(
  items: T[],
  currentKey: string,
) {
  return [...items].sort((left, right) => {
    if (left.system !== right.system) {
      return left.system ? -1 : 1;
    }
    const leftCurrent = Boolean(currentKey) && left.key === currentKey;
    const rightCurrent = Boolean(currentKey) && right.key === currentKey;
    if (leftCurrent !== rightCurrent) {
      return leftCurrent ? -1 : 1;
    }
    return 0;
  });
}

type WorkspaceAiContextResponse = {
  workspaceKey: string;
  workspaceName: string;
  markdown: string;
  json: unknown;
};

type OverviewQueryToken = {
  field: string | null;
  value: string;
};

type WorkspaceStateItem = {
  label: string;
  tone: "active" | "info" | "warning" | "muted";
};

const workspaceTypeSelectMenuProps = {
  PaperProps: {
    className: "workspace-type-menu-paper",
  },
  MenuListProps: {
    className: "workspace-type-menu-list",
  },
};

type WorkspaceResourceShortcutItem = {
  key: string;
  configSourceId: string;
  category: string;
  label: string;
  kind: string;
  kindLabel: string;
  value?: string | null;
  detail?: string | null;
  tool?: string | null;
  toolKey?: string | null;
  toolAction?: string | null;
  linkRuntime?: LinkRuntimeSummary | null;
  openKind?: "url" | "localPath" | string | null;
  openable: boolean;
};

type WorkspaceProjectDirectoryItem = {
  projectKey: string;
  projectName: string;
  mode: "global" | "managed" | "bound" | string;
  modeLabel: string;
  path?: string | null;
  managed: boolean;
  statusKey: string;
  statusLabel: string;
  running: boolean;
  canStart: boolean;
  canStop: boolean;
  canFocusRuntime: boolean;
};

type WorkspaceProxyProfileItem = {
  id: string;
  name: string;
  listenHost: string;
  listenPort: number;
  listenUrl: string;
  workspaceKey?: string | null;
  workspaceLabel: string;
  ruleCount: number;
  running: boolean;
  startedAt?: string | null;
};

const COLLAPSED_WORKSPACES_STORAGE_KEY = "rdevtool:overview:collapsed-workspaces";
const COLLAPSED_WORKSPACES_DEFAULTED_KEY =
  "rdevtool:overview:collapsed-workspaces:v3-system-defaulted";
const SYSTEM_WORKSPACE_KEY = "system";

const NAVIGATION_ENTRY_KIND_LABELS: Record<string, string> = {
  url: "网站",
  directory: "目录",
  app: "应用",
  script: "脚本",
  tool: "工具",
};

function defaultCollapsedWorkspaceKeys() {
  return new Set<string>([SYSTEM_WORKSPACE_KEY]);
}

function readCollapsedWorkspaceKeys() {
  if (typeof window === "undefined") {
    return defaultCollapsedWorkspaceKeys();
  }
  try {
    const stored = window.localStorage.getItem(COLLAPSED_WORKSPACES_STORAGE_KEY);
    const values = stored ? JSON.parse(stored) : [];
    const keys = new Set<string>(
      Array.isArray(values) ? values.filter((value) => typeof value === "string") : [],
    );
    if (!window.localStorage.getItem(COLLAPSED_WORKSPACES_DEFAULTED_KEY)) {
      keys.add(SYSTEM_WORKSPACE_KEY);
      window.localStorage.setItem(COLLAPSED_WORKSPACES_STORAGE_KEY, JSON.stringify([...keys]));
      window.localStorage.setItem(COLLAPSED_WORKSPACES_DEFAULTED_KEY, "1");
    }
    return keys;
  } catch {
    return defaultCollapsedWorkspaceKeys();
  }
}

function normalizeWorkspaceKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function formatUpdatedAt(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (next: number) => String(next).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function actionTone(kindLabel: string): "default" | "primary" | "warning" {
  if (kindLabel === "分支") {
    return "warning";
  }
  if (kindLabel === "构建" || kindLabel === "启动") {
    return "primary";
  }
  return "default";
}

function actionGroupKind(item: WorkspacePinnedActionItem): "build" | "git" | "other" {
  const kind = item.action.kind.toLowerCase();
  if (
    item.kindLabel === "构建" ||
    kind === "build.replay" ||
    kind === "deploy.replay" ||
    kind.startsWith("project.build.")
  ) {
    return "build";
  }
  if (item.kindLabel === "分支" || kind === "branch.replay" || kind.startsWith("git.")) {
    return "git";
  }
  return "other";
}

const ACTION_LABEL_PARAM_ORDER = [
  "目标",
  "环境",
  "分支",
  "源分支",
  "目标分支",
  "类型",
  "Job",
  "Profile",
  "目录",
  "提交",
  "提交信息",
];

function actionLabelParams(item: WorkspacePinnedActionItem) {
  return item.params
    .filter((param) => param.label !== "项目" && param.value.trim())
    .sort((left, right) => {
      const leftIndex = ACTION_LABEL_PARAM_ORDER.indexOf(left.label);
      const rightIndex = ACTION_LABEL_PARAM_ORDER.indexOf(right.label);
      return (
        (leftIndex === -1 ? ACTION_LABEL_PARAM_ORDER.length : leftIndex) -
        (rightIndex === -1 ? ACTION_LABEL_PARAM_ORDER.length : rightIndex)
      );
    });
}

function projectDirectoryTone(mode: string): "default" | "primary" | "success" {
  if (mode === "managed") {
    return "primary";
  }
  if (mode === "bound") {
    return "success";
  }
  return "default";
}

function projectDirectoryLabel(label: string) {
  if (label.includes("副本")) {
    return "副本";
  }
  if (label.includes("绑定")) {
    return "绑定";
  }
  if (label.includes("全局")) {
    return "全局";
  }
  return label;
}

function workspaceProjectRuntimeProfileInfo(
  entry: ProjectRuntimeEntry | undefined,
  requestedKey: string | undefined,
) {
  const selection = resolveProjectRuntimeDebugProfile(entry, requestedKey);
  const profile = selection.profile;
  return {
    debugProfileKey: selection.key,
    summary: [
      `档案 ${profile?.label?.trim() || "默认"}`,
      `端口 ${profile?.expectedPort ?? "自动"}`,
      `Runtime ${profile?.runtimeProfile?.trim() || "默认"}`,
      `网络代理 ${profile?.networkProxy?.enabled ? "开" : "关"}`,
      `本地代理 ${profile?.localProxy?.enabled ? "开" : "关"}`,
    ].join(" · "),
  };
}

async function copyPlainText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function workspaceSearchText(group: WorkspacePinnedActionsOverview) {
  return [
    group.key,
    group.name,
    group.description,
    group.rootDir,
    group.workspaceKind,
    group.workspaceType,
    group.workspaceTypeLabel,
    ...group.resources.flatMap((resource) => [
      resource.key,
      resource.category,
      resource.label,
      resource.kind,
      resource.kindLabel,
      resource.value,
    ]),
    ...group.projectDirectories.flatMap((directory) => [
      directory.projectKey,
      directory.projectName,
      directory.mode,
      directory.modeLabel,
      directory.path,
    ]),
    ...group.proxyProfiles.flatMap((profile) => [
      profile.id,
      profile.name,
      profile.listenHost,
      String(profile.listenPort),
      profile.listenUrl,
      profile.workspaceKey,
      profile.workspaceLabel,
      profile.running ? "运行中" : "未启动",
    ]),
    ...group.actions.flatMap((item) => [
      item.label,
      item.detail,
      item.kindLabel,
      item.projectKey,
      item.action.label,
      item.action.detail,
      item.action.projectKey,
      ...item.params.flatMap((param) => [param.label, param.value]),
    ]),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

function normalizeOverviewQueryField(value: string) {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "key":
    case "id":
      return "key";
    case "type":
    case "类型":
      return "type";
    case "project":
    case "项目":
    case "p":
      return "project";
    case "entry":
    case "resource":
    case "入口":
      return "entry";
    case "proxy":
    case "代理":
    case "代理服务":
      return "proxy";
    case "action":
    case "动作":
      return "action";
    case "path":
    case "dir":
    case "目录":
      return "path";
    default:
      return "";
  }
}

function parseOverviewQuery(query: string): OverviewQueryToken[] {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => {
      const match = part.match(/^([^:：]+)[:：](.+)$/);
      if (!match) {
        return { field: null, value: part.trim().toLowerCase() };
      }
      const field = normalizeOverviewQueryField(match[1]);
      return {
        field: field || null,
        value: match[2].trim().toLowerCase(),
      };
    })
    .filter((token) => token.value.length > 0);
}

function textIncludes(values: Array<string | null | undefined>, value: string) {
  const needle = value.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return values.some(
    (item) => typeof item === "string" && item.trim().toLowerCase().includes(needle),
  );
}

function workspaceSearchValuesForField(group: WorkspacePinnedActionsOverview, field: string) {
  switch (field) {
    case "key":
      return [group.key];
    case "type":
      return [
        group.workspaceKind,
        group.workspaceType,
        group.workspaceTypeLabel,
        group.system ? "全局" : "",
      ];
    case "project":
      return group.projectDirectories.flatMap((directory) => [
        directory.projectKey,
        directory.projectName,
        directory.mode,
        directory.modeLabel,
        directory.path,
      ]);
    case "entry":
      return group.resources.flatMap((resource) => [
        resource.key,
        resource.category,
        resource.label,
        resource.kind,
        resource.kindLabel,
        resource.value,
      ]);
    case "proxy":
      return group.proxyProfiles.flatMap((profile) => [
        profile.id,
        profile.name,
        profile.listenHost,
        String(profile.listenPort),
        profile.listenUrl,
        profile.workspaceKey,
        profile.workspaceLabel,
        profile.running ? "运行中" : "未启动",
      ]);
    case "action":
      return group.actions.flatMap((item) => [
        item.label,
        item.detail,
        item.kindLabel,
        item.projectKey,
        item.action.label,
        item.action.detail,
        item.action.projectKey,
        ...item.params.flatMap((param) => [param.label, param.value]),
      ]);
    case "path":
      return [
        group.rootDir,
        ...group.projectDirectories.flatMap((directory) => [
          directory.path,
          directory.projectName,
          directory.projectKey,
        ]),
        ...group.resources
          .filter((resource) => resource.kind === "directory")
          .map((resource) => resource.value),
      ];
    default:
      return [workspaceSearchText(group)];
  }
}

function workspaceMatchesOverviewQuery(
  group: WorkspacePinnedActionsOverview,
  query: string,
) {
  const tokens = parseOverviewQuery(query);
  if (tokens.length === 0) {
    return true;
  }
  const text = workspaceSearchText(group);
  return tokens.every((token) =>
    token.field
      ? textIncludes(workspaceSearchValuesForField(group, token.field), token.value)
      : text.includes(token.value),
  );
}

function workspaceStateItems(
  group: WorkspacePinnedActionsOverview,
  active: boolean,
): WorkspaceStateItem[] {
  const missingDirectories = group.projectDirectories.filter((directory) => !directory.path).length;
  const items: WorkspaceStateItem[] = [];
  if (active) {
    items.push({ label: "当前", tone: "active" });
  }
  if (group.entryCount === 0 && group.projectCount === 0 && group.proxyProfileCount === 0) {
    items.push({ label: "空工作区", tone: "warning" });
  } else {
    if (group.projectCount === 0) {
      items.push({ label: "无项目", tone: "warning" });
    } else if (missingDirectories > 0) {
      items.push({ label: `${missingDirectories} 目录待配`, tone: "warning" });
    }
    if (group.entryCount === 0 && group.proxyProfileCount === 0) {
      items.push({ label: "无入口", tone: "muted" });
    }
  }
  return items.slice(0, 2);
}

function navigationEntryKindLabel(kind: string) {
  return NAVIGATION_ENTRY_KIND_LABELS[kind] ?? "入口";
}

function shortcutIcon(kind: string) {
  switch (kind) {
    case "directory":
      return <FolderIcon fontSize="small" />;
    case "url":
      return <WebsiteIcon fontSize="small" />;
    case "app":
      return <AppWindowIcon fontSize="small" />;
    case "script":
      return <TerminalIcon fontSize="small" />;
    case "tool":
      return <WorkflowIcon fontSize="small" />;
    default:
      return <LocateIcon fontSize="small" />;
  }
}

function panelSx(theme: Theme) {
  return {
    border: "1px solid",
    borderColor:
      theme.palette.mode === "dark"
        ? "rgba(255,255,255,0.06)"
        : "color-mix(in srgb, var(--line-soft) 92%, transparent)",
    borderRadius: "12px",
    background:
      theme.palette.mode === "dark"
        ? "linear-gradient(180deg, rgba(255,255,255,0.024), transparent 72%), rgba(255,255,255,0.012)"
        : "linear-gradient(180deg, rgba(255,255,255,0.64), rgba(244,248,253,0.86) 78%), rgba(241,246,252,0.78)",
    boxShadow:
      theme.palette.mode === "dark"
        ? "inset 0 1px 0 rgba(255,255,255,0.035)"
        : "inset 0 1px 0 rgba(255,255,255,0.72), 0 10px 28px rgba(31,55,90,0.045)",
  };
}

function directoryActionButtonSx(theme: Theme) {
  const isDark = theme.palette.mode === "dark";
  return {
    minHeight: 30,
    px: 1.1,
    borderRadius: "9px",
    borderColor: isDark
      ? "rgba(255,255,255,0.07)"
      : "color-mix(in srgb, var(--line-soft) 84%, transparent)",
    color: "var(--muted)",
    bgcolor: isDark ? "rgba(255,255,255,0.018)" : "color-mix(in srgb, var(--side-pane-control) 28%, transparent)",
    fontWeight: 780,
    boxShadow: isDark ? "none" : "inset 0 1px 0 color-mix(in srgb, #ffffff 28%, transparent)",
    "&:hover": {
      color: "var(--text)",
      borderColor: alpha(theme.palette.primary.main, isDark ? 0.24 : 0.32),
      bgcolor: alpha(theme.palette.primary.main, isDark ? 0.1 : 0.07),
    },
    "&.Mui-disabled": {
      borderColor: isDark ? "rgba(255,255,255,0.045)" : "color-mix(in srgb, var(--line-soft) 62%, transparent)",
      color: theme.palette.text.disabled,
      bgcolor: isDark ? "rgba(255,255,255,0.01)" : "color-mix(in srgb, var(--panel-strong) 40%, transparent)",
    },
  };
}

export function OverviewPage({
  projectWorkspaces,
  activeProjectWorkspaceKey,
  onProjectWorkspaceChange,
  onNavigateToPage,
  onProjectManagementViewChange,
  onProjectChange,
  onCreateProjectWorkspace,
  onInitDemandWorkspace,
  onProjectConfigSaved,
  workspaceConfigOpenSignal,
  runtimeEntries,
  selectedDebugProfileKeys,
  projectRuntimePreferencesHydrated,
  onStartProjectRuntime,
  onStartProxyProfile,
  onStopProxyProfile,
  onFocusProjectRuntime,
  onExecutePinnedAction,
}: OverviewPageProps) {
  const [groups, setGroups] = useState<WorkspacePinnedActionsOverview[]>([]);
  const [workspaceEditor, setWorkspaceEditor] = useState<ProjectWorkspaceEditorState | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState<ProjectWorkspaceEditorDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceDirectoryBusy, setWorkspaceDirectoryBusy] = useState("");
  const [collapsedWorkspaceKeys, setCollapsedWorkspaceKeys] = useState<Set<string>>(() =>
    readCollapsedWorkspaceKeys(),
  );
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedWorkspaceScope, setExpandedWorkspaceScope] = useState<
    "projects" | "navigation" | "proxy"
  >("projects");
  const [createWorkspaceMode, setCreateWorkspaceMode] = useState<"basic" | "demand">("basic");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceKey, setNewWorkspaceKey] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [newWorkspaceType, setNewWorkspaceType] = useState(DEFAULT_NEW_WORKSPACE_TYPE);
  const [newWorkspaceIndependentDir, setNewWorkspaceIndependentDir] = useState(false);
  const [newWorkspaceRootDir, setNewWorkspaceRootDir] = useState("");
  const [copyCurrentWorkspace, setCopyCurrentWorkspace] = useState(true);
  const [demandId, setDemandId] = useState("");
  const [demandRequirementDir, setDemandRequirementDir] = useState("");
  const [demandRepoPath, setDemandRepoPath] = useState("");
  const [demandBranch, setDemandBranch] = useState("");
  const [demandProjectKey, setDemandProjectKey] = useState("");
  const [error, setErrorValue] = useState("");
  const [status, setStatusValue] = useState("");
  const [toastNonce, setToastNonce] = useState(0);
  const [runningKey, setRunningKey] = useState("");
  const [aiContextOpen, setAiContextOpen] = useState(false);
  const [aiContextGroup, setAiContextGroup] = useState<WorkspacePinnedActionsOverview | null>(null);
  const [aiContextResponse, setAiContextResponse] = useState<WorkspaceAiContextResponse | null>(null);
  const [aiContextLoading, setAiContextLoading] = useState(false);
  const [linkPlanDialog, setLinkPlanDialog] = useState<LinkPlanDialogState | null>(null);
  const [aiContextView, setAiContextView] = useState<"markdown" | "json">("markdown");
  const [aiContextPresets, setAiContextPresets] = useState<WorkspaceAiContextPreset[]>(
    BUILTIN_AI_CONTEXT_PRESETS,
  );
  const [aiContextPresetKey, setAiContextPresetKey] = useState(BUILTIN_AI_CONTEXT_PRESETS[0].key);
  const [aiContextPresetName, setAiContextPresetName] = useState("");
  const [aiContextOptions, setAiContextOptions] =
    useState<WorkspaceAiContextOptions>(DEFAULT_AI_CONTEXT_OPTIONS);
  const [overviewQuery, setOverviewQuery] = useState("");
  const [workspaceTypeFilter, setWorkspaceTypeFilter] = useState("all");
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const {
    options: workspaceTypeOptions,
    addWorkspaceType,
    removeWorkspaceType,
  } = useWorkspaceTypeOptions();
  const runtimeEntryByProjectKey = useMemo(
    () => new Map(runtimeEntries.map((entry) => [entry.key, entry])),
    [runtimeEntries],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      COLLAPSED_WORKSPACES_STORAGE_KEY,
      JSON.stringify(Array.from(collapsedWorkspaceKeys)),
    );
  }, [collapsedWorkspaceKeys]);

  useEffect(() => {
    let cancelled = false;
    async function loadPresets() {
      const nextPresets = await loadAiContextPresets();
      if (cancelled) {
        return;
      }
      setAiContextPresets(nextPresets);
      setAiContextPresetKey((current) =>
        nextPresets.some((preset) => preset.key === current)
          ? current
          : BUILTIN_AI_CONTEXT_PRESETS[0].key,
      );
    }
    void loadPresets();

    const unsubscribe = subscribeAiContextPresets((presets) => {
      setAiContextPresets(presets);
      setAiContextPresetKey((current) =>
        presets.some((preset) => preset.key === current)
          ? current
          : BUILTIN_AI_CONTEXT_PRESETS[0].key,
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function bumpToast(value: string) {
    if (value.trim()) {
      setToastNonce((current) => current + 1);
    }
  }

  function setError(value: string) {
    setErrorValue(value);
    bumpToast(value);
  }

  function setStatus(value: string) {
    setStatusValue(value);
    bumpToast(value);
  }

  function toggleWorkspaceCollapsed(workspaceKey: string) {
    setCollapsedWorkspaceKeys((current) => {
      const next = new Set(current);
      if (next.has(workspaceKey)) {
        next.delete(workspaceKey);
      } else {
        next.add(workspaceKey);
      }
      return next;
    });
  }

  const activeGroup = useMemo(
    () => groups.find((group) => group.key === activeProjectWorkspaceKey) ?? groups[0] ?? null,
    [activeProjectWorkspaceKey, groups],
  );
  const editingWorkspaceKey =
    workspaceDraft?.key ?? workspaceEditor?.workspace.key ?? activeProjectWorkspaceKey;
  const editingWorkspaceSummary = useMemo(
    () =>
      projectWorkspaces.find((workspace) => workspace.key === editingWorkspaceKey) ??
      projectWorkspaces[0] ??
      null,
    [editingWorkspaceKey, projectWorkspaces],
  );
  const workspaceTypeUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups) {
      if (group.system) {
        continue;
      }
      const key = normalizeWorkspaceType(group.workspaceType);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [groups]);
  const workspaceTypeFilterOptions = useMemo(
    () => workspaceTypeCountOptions(groups, workspaceTypeOptions),
    [groups, workspaceTypeOptions],
  );
  const workspaceToolbarTypeTags = useMemo(
    () => workspaceTypeFilterOptions.filter((option) => option.count > 0),
    [workspaceTypeFilterOptions],
  );
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
  const filteredGroups = useMemo(
    () =>
      systemWorkspaceThenCurrent(
        groups.filter(
          (group) =>
            (workspaceTypeFilter === "all" ||
              normalizeWorkspaceType(group.workspaceType) === workspaceTypeFilter) &&
            workspaceMatchesOverviewQuery(group, overviewQuery),
        ),
        activeProjectWorkspaceKey,
      ),
    [groups, activeProjectWorkspaceKey, workspaceTypeFilter, overviewQuery],
  );
  const orderedProjectWorkspaces = useMemo(
    () => systemWorkspaceThenCurrent(projectWorkspaces, activeProjectWorkspaceKey),
    [activeProjectWorkspaceKey, projectWorkspaces],
  );
  const overviewFilterActive =
    workspaceTypeFilter !== "all" || overviewQuery.trim().length > 0;
  const aiContextJsonText = useMemo(
    () => (aiContextResponse ? JSON.stringify(aiContextResponse.json, null, 2) : ""),
    [aiContextResponse],
  );
  const aiContextPreviewText =
    aiContextView === "json" ? aiContextJsonText : aiContextResponse?.markdown ?? "";
  const aiContextPreviewLineCount = aiContextPreviewText
    ? aiContextPreviewText.split("\n").length
    : 0;
  const selectedAiContextPreset = useMemo(
    () =>
      aiContextPresets.find((preset) => preset.key === aiContextPresetKey) ??
      BUILTIN_AI_CONTEXT_PRESETS[0],
    [aiContextPresetKey, aiContextPresets],
  );
  const aiContextPresetDirty = !isSameAiContextOptions(
    selectedAiContextPreset.options,
    aiContextOptions,
  );

  const workspaceDirty = Boolean(
    workspaceEditor &&
      workspaceDraft &&
      JSON.stringify(workspaceDraft) !== JSON.stringify(workspaceEditor.workspace),
  );

  const projectTotal = workspaceEditor?.projects.length ?? 0;
  const entryTotal =
    workspaceEditor?.navigationCategories.reduce(
      (total, category) => total + category.entries.length,
      0,
    ) ?? 0;
  const navigationTotal = (workspaceEditor?.navigationCategories.length ?? 0) + entryTotal;
  const proxyTotal = workspaceEditor?.proxyProfiles.length ?? 0;
  const selectedProjects = workspaceDraft
    ? workspaceDraft.system
      ? projectTotal
      : selectedCount(workspaceDraft.projects, projectTotal, workspaceDraft.includeAllProjects)
    : 0;
  const selectedNavigation = workspaceDraft
    ? workspaceDraft.system
      ? navigationTotal
      : selectedCount(
          [...workspaceDraft.navigationCategories, ...workspaceDraft.navigationEntries],
          navigationTotal,
          workspaceDraft.includeAllNavigation,
        )
    : 0;
  const selectedProxyProfiles = workspaceDraft
    ? workspaceDraft.system
      ? proxyTotal
      : workspaceDraft.proxyProfiles.length
    : 0;
  const workspaceScopeReadOnly = Boolean(workspaceDraft?.system);
  const workspaceInstanceByProject = useMemo(
    () =>
      new Map(
        (workspaceDraft?.projectInstances ?? []).map((instance) => [instance.project, instance]),
      ),
    [workspaceDraft?.projectInstances],
  );
  const scopedWorkspaceProjects = useMemo(
    () =>
      (workspaceEditor?.projects ?? []).filter(
        (project) =>
          workspaceDraft?.includeAllProjects || workspaceDraft?.projects.includes(project.key),
      ),
    [workspaceDraft?.includeAllProjects, workspaceDraft?.projects, workspaceEditor?.projects],
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await invoke<WorkspacePinnedActionsOverview[]>(
        "get_workspace_pinned_actions_overview",
      );
      setGroups(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjectWorkspaceEditor = useCallback(async (workspaceKey?: string) => {
    setWorkspaceLoading(true);
    setError("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>("get_project_workspace_editor", {
        workspaceKey: workspaceKey || activeProjectWorkspaceKey,
      });
      setWorkspaceEditor(nextState);
      setWorkspaceDraft(nextState.workspace);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [activeProjectWorkspaceKey]);

  const refreshWorkbench = useCallback(async () => {
    await Promise.all([loadOverview(), loadProjectWorkspaceEditor()]);
  }, [loadOverview, loadProjectWorkspaceEditor]);

  useEffect(() => {
    void refreshWorkbench();
  }, [refreshWorkbench]);

  useEffect(() => {
    if ((workspaceConfigOpenSignal ?? 0) > 0) {
      setManageOpen(true);
      void loadProjectWorkspaceEditor(activeProjectWorkspaceKey);
    }
  }, [activeProjectWorkspaceKey, loadProjectWorkspaceEditor, workspaceConfigOpenSignal]);

  async function executeAction(item: WorkspacePinnedActionItem) {
    if (item.confirmRequired) {
      const confirmed = await confirm({
        title: "确认运行",
        description: `确认运行“${item.label}”？`,
        confirmLabel: "运行",
      });
      if (!confirmed) {
        return;
      }
    }

    setRunningKey(item.action.dedupeKey);
    setError("");
    try {
      await onExecutePinnedAction(item.action);
      await loadOverview();
      setStatus(`已运行 ${item.label}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function openWorkbenchTarget(kind: string, value: string, label: string) {
    if (!kind || !value) {
      return;
    }
    await invoke("open_external_resource", { kind, value });
    setStatus(`已打开 ${label}`);
  }

  async function openWorkspaceResource(resource: WorkspaceResourceShortcutItem) {
    if (!resource.openable || !resource.openKind || !resource.value) {
      return;
    }
    const key = `resource:${resource.key}`;
    setRunningKey(key);
    setError("");
    try {
      await openWorkbenchTarget(resource.openKind, resource.value, resource.label);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  function isLinkToolResource(resource: WorkspaceResourceShortcutItem) {
    return resource.kind === "tool" && (resource.tool ?? "link").toLowerCase() === "link";
  }

  function linkSourceIdForResource(resource?: WorkspaceResourceShortcutItem | null) {
    return resource?.configSourceId || configSourceIdForWorkspace(activeProjectWorkspaceKey);
  }

  function linkRuntimeAction(resource: WorkspaceResourceShortcutItem): "run" | "stop" {
    const runtime = resource.linkRuntime;
    return runtime?.canStop && runtime.status !== "stopped" && runtime.status !== "planned"
      ? "stop"
      : "run";
  }

  function linkRuntimeLabel(resource: WorkspaceResourceShortcutItem) {
    const runtime = resource.linkRuntime;
    if (!runtime) {
      return "";
    }
    if (runtime.status === "planned") {
      return "";
    }
    return runtime.label;
  }

  async function openWorkspaceLinkPlan(resource: WorkspaceResourceShortcutItem) {
    const key = (resource.toolKey || resource.value || "").trim();
    const sourceId = linkSourceIdForResource(resource);
    if (!key) {
      setLinkPlanDialog({
        entryName: resource.label,
        key: "",
        sourceId,
        plan: null,
        report: null,
        runtime: resource.linkRuntime ?? null,
        loading: false,
        action: null,
        error: "缺少 Link Key",
      });
      return;
    }
    setLinkPlanDialog({
      entryName: resource.label,
      key,
      sourceId,
      plan: null,
      report: null,
      runtime: resource.linkRuntime ?? null,
      loading: true,
      action: null,
      error: "",
    });
    try {
      const plan = await invoke<LinkPlan>("plan_link", { sourceId, key });
      setLinkPlanDialog({
        entryName: resource.label,
        key,
        sourceId,
        plan,
        report: null,
        runtime: resource.linkRuntime ?? null,
        loading: false,
        action: null,
        error: "",
      });
    } catch (reason) {
      setLinkPlanDialog({
        entryName: resource.label,
        key,
        sourceId,
        plan: null,
        report: null,
        runtime: resource.linkRuntime ?? null,
        loading: false,
        action: null,
        error: String(reason),
      });
    }
  }

  async function runLinkDialogAction(action: LinkPlanDialogAction) {
    const key = linkPlanDialog?.key.trim();
    if (!key || linkPlanDialog?.loading || linkPlanDialog?.action) {
      return;
    }
    const command =
      action === "check" ? "check_link" : action === "run" ? "run_link" : "stop_link";
    const sourceId = linkPlanDialog?.sourceId ?? configSourceIdForWorkspace(activeProjectWorkspaceKey);
    setLinkPlanDialog((current) =>
      current
        ? {
            ...current,
            action,
            error: "",
          }
        : current,
    );
    try {
      const report = await invoke<LinkExecutionReport>(command, { sourceId, key });
      setLinkPlanDialog((current) =>
        current
          ? {
              ...current,
              report,
              action: null,
              error: "",
            }
          : current,
      );
      if (action === "run" || action === "stop") {
        await loadOverview();
      }
    } catch (reason) {
      setLinkPlanDialog((current) =>
        current
          ? {
              ...current,
              action: null,
              error: String(reason),
            }
          : current,
      );
    }
  }

  async function executeWorkspaceLinkAction(
    resource: WorkspaceResourceShortcutItem,
    action: "run" | "stop",
  ) {
    const key = (resource.toolKey || resource.value || "").trim();
    const sourceId = linkSourceIdForResource(resource);
    if (!key) {
      setError("缺少 Link Key");
      return;
    }
    const actionLabel = action === "stop" ? "停止" : "启动";
    const command = action === "stop" ? "stop_link" : "run_link";

    setRunningKey(`tool:${resource.key}`);
    setError("");
    setStatus("");

    try {
      const report = await invoke<LinkExecutionReport>(command, { sourceId, key });
      const failedStep = report.steps.find((step) => step.status === "failed");
      if (failedStep) {
        setError(`${failedStep.label} ${actionLabel}失败：${failedStep.summary}`);
      } else {
        setStatus(`已${actionLabel}：${resource.label}`);
      }
      try {
        await loadOverview();
      } catch (refreshReason) {
        setError(`已${actionLabel}，但刷新状态失败：${String(refreshReason)}`);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function openWorkspaceRootDirectory(group: WorkspacePinnedActionsOverview) {
    if (!group.rootDir) {
      return;
    }
    const key = `root:${group.key}`;
    setRunningKey(key);
    setError("");
    try {
      await openWorkbenchTarget("localPath", group.rootDir, "工作区目录");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function toggleWorkspaceProject(
    group: WorkspacePinnedActionsOverview,
    directory: WorkspaceProjectDirectoryItem,
  ) {
    if (group.key !== activeProjectWorkspaceKey) {
      setError("请先切换到该工作区再操作项目");
      return;
    }
    const projectKey = directory.projectKey.trim();
    if (!projectKey) {
      return;
    }
    const running = directory.running || directory.canStop;
    const key = `project:${group.key}:${projectKey}:${running ? "stop" : "start"}`;
    setRunningKey(key);
    setError("");
    setStatus("");
    try {
      if (running) {
        await invoke("stop_project_runtime", {
          project: projectKey,
        });
        setStatus(`已停止 ${directory.projectName || projectKey}`);
      } else {
        const profileInfo = workspaceProjectRuntimeProfileInfo(
          runtimeEntryByProjectKey.get(projectKey),
          selectedDebugProfileKeys[projectKey],
        );
        await onStartProjectRuntime(
          projectKey,
          profileInfo.debugProfileKey || undefined,
        );
      }
      await loadOverview();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function focusWorkspaceProjectRuntime(
    group: WorkspacePinnedActionsOverview,
    directory: WorkspaceProjectDirectoryItem,
  ) {
    if (group.key !== activeProjectWorkspaceKey) {
      setError("请先切换到该工作区再打开项目");
      return;
    }
    const projectKey = directory.projectKey.trim();
    if (!projectKey || !directory.canFocusRuntime) {
      return;
    }
    const key = `project:${group.key}:${projectKey}:focus`;
    setRunningKey(key);
    setError("");
    setStatus("");
    try {
      await onFocusProjectRuntime(projectKey);
      setStatus(`已打开 ${directory.projectName || projectKey}`);
      await loadOverview();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function toggleWorkspaceProxyProfile(
    group: WorkspacePinnedActionsOverview,
    profile: WorkspaceProxyProfileItem,
  ) {
    const key = `proxy:${group.key}:${profile.id}:${profile.running ? "stop" : "start"}`;
    setRunningKey(key);
    setError("");
    setStatus("");
    try {
      if (profile.running) {
        await onStopProxyProfile(profile.id);
        setStatus(`已停止 ${profile.name}`);
      } else {
        await onStartProxyProfile(profile.id);
        setStatus(`已启动 ${profile.name}`);
      }
      await loadOverview();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function loadWorkspaceAiContext(
    group: WorkspacePinnedActionsOverview,
    options: WorkspaceAiContextOptions = aiContextOptions,
  ) {
    setAiContextLoading(true);
    setError("");
    try {
      const response = await invoke<WorkspaceAiContextResponse>("get_workspace_ai_context", {
        workspaceKey: group.key,
        options,
      });
      setAiContextResponse(response);
      return response;
    } catch (reason) {
      setError(String(reason));
      return null;
    } finally {
      setAiContextLoading(false);
    }
  }

  async function openWorkspaceAiContext(group: WorkspacePinnedActionsOverview) {
    setAiContextGroup(group);
    setAiContextResponse(null);
    setAiContextView("markdown");
    setAiContextOpen(true);
    await loadWorkspaceAiContext(group, aiContextOptions);
  }

  async function refreshWorkspaceAiContext() {
    if (!aiContextGroup) {
      return;
    }
    await loadWorkspaceAiContext(aiContextGroup, aiContextOptions);
  }

  async function updateAiContextOptions(patch: Partial<WorkspaceAiContextOptions>) {
    const nextOptions = { ...aiContextOptions, ...patch };
    setAiContextOptions(nextOptions);
    if (aiContextOpen && aiContextGroup) {
      await loadWorkspaceAiContext(aiContextGroup, nextOptions);
    }
  }

  async function applyAiContextPreset(presetKey: string) {
    const preset =
      aiContextPresets.find((item) => item.key === presetKey) ?? BUILTIN_AI_CONTEXT_PRESETS[0];
    setAiContextPresetKey(preset.key);
    setAiContextPresetName("");
    setAiContextOptions(preset.options);
    if (aiContextOpen && aiContextGroup) {
      await loadWorkspaceAiContext(aiContextGroup, preset.options);
    }
  }

  async function persistAiContextCustomPresets(nextPresets: WorkspaceAiContextPreset[]) {
    const merged = await persistAiContextTemplatePresets(nextPresets);
    setAiContextPresets(merged);
    return merged;
  }

  async function saveAiContextPreset() {
    const currentPreset =
      aiContextPresets.find((preset) => preset.key === aiContextPresetKey) ??
      BUILTIN_AI_CONTEXT_PRESETS[0];
    const label = aiContextPresetName.trim() || (currentPreset.custom ? currentPreset.label : "");
    if (!label) {
      setError("请填写场景名");
      return;
    }
    const nextPreset: WorkspaceAiContextPreset = {
      key: currentPreset.custom ? currentPreset.key : normalizeAiContextPresetKey(label),
      label,
      options: aiContextOptions,
      custom: true,
    };
    const nextPresets = [
      ...aiContextPresets.filter(
        (preset) => preset.custom && preset.key !== nextPreset.key,
      ),
      nextPreset,
    ];
    await persistAiContextCustomPresets(nextPresets);
    setAiContextPresetKey(nextPreset.key);
    setAiContextPresetName("");
    setStatus(`已保存场景 ${nextPreset.label}`);
  }

  async function deleteAiContextPreset() {
    const currentPreset = aiContextPresets.find((preset) => preset.key === aiContextPresetKey);
    if (!currentPreset?.custom) {
      return;
    }
    const nextPresets = aiContextPresets.filter(
      (preset) => preset.custom && preset.key !== currentPreset.key,
    );
    await persistAiContextCustomPresets(nextPresets);
    await applyAiContextPreset(BUILTIN_AI_CONTEXT_PRESETS[0].key);
    setStatus(`已删除场景 ${currentPreset.label}`);
  }

  async function copyAiContext(format: "markdown" | "json") {
    if (!aiContextResponse) {
      return;
    }
    try {
      await copyPlainText(format === "json" ? aiContextJsonText : aiContextResponse.markdown);
      setStatus(
        `已复制 ${aiContextResponse.workspaceName || aiContextGroup?.name || "工作区"} ${
          format === "json" ? "JSON" : "Markdown"
        } 上下文`,
      );
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function selectWorkspaceConfig(workspaceKey: string) {
    const currentEditingKey = workspaceDraft?.key ?? workspaceEditor?.workspace.key ?? "";
    if (!workspaceKey || workspaceKey === currentEditingKey) {
      if (createOpen) {
        setCreateOpen(false);
      }
      return;
    }
    const workspaceName =
      projectWorkspaces.find((workspace) => workspace.key === workspaceKey)?.name ?? workspaceKey;
    if (workspaceDirty) {
      const confirmed = await confirm({
        title: "切换配置对象",
        description: `当前配置有未保存修改，查看“${workspaceName}”会丢弃修改。`,
        confirmLabel: "查看配置",
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    setError("");
    setStatus("");
    try {
      setCreateOpen(false);
      await loadProjectWorkspaceEditor(workspaceKey);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function deleteWorkspaceConfig(workspaceKey: string, workspaceName: string) {
    if (!workspaceKey || workspaceKey === "system") {
      return;
    }
    const confirmed = await confirm({
      title: "删除工作区配置",
      description: `删除“${workspaceName}”的工作区配置。项目代码目录不会被删除，已绑定到该工作区的代理会解除绑定。`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    const wasEditing = workspaceKey === editingWorkspaceKey;
    setError("");
    setStatus("");
    try {
      await invoke<ProjectWorkspaceState>("delete_project_workspace_config", { workspaceKey });
      if (wasEditing) {
        setCreateOpen(false);
        await loadProjectWorkspaceEditor("system");
      }
      await onProjectConfigSaved();
      await loadOverview();
      setStatus(`已删除工作区配置：${workspaceName}`);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function createWorkspace() {
    const name = newWorkspaceName.trim();
    const key = normalizeWorkspaceKey(newWorkspaceKey || name);
    const description = newWorkspaceDescription.trim();
    if (!name) {
      setError("请填写工作区名称");
      return;
    }
    if (!key) {
      setError("请填写工作区 key");
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
        independentDir: newWorkspaceIndependentDir,
        copyCurrent: copyCurrentWorkspace,
        activate: false,
      });
      setNewWorkspaceName("");
      setNewWorkspaceKey("");
      setNewWorkspaceDescription("");
      setNewWorkspaceType(DEFAULT_NEW_WORKSPACE_TYPE);
      setNewWorkspaceIndependentDir(false);
      setNewWorkspaceRootDir("");
      setCopyCurrentWorkspace(true);
      setCreateOpen(false);
      await loadOverview();
      await loadProjectWorkspaceEditor(key);
      setStatus(`已创建：${name}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function createDemandWorkspace() {
    const name = newWorkspaceName.trim();
    const key = normalizeWorkspaceKey(newWorkspaceKey || name);
    const description = newWorkspaceDescription.trim();
    const requirementDir = demandRequirementDir.trim();
    const repoPath = demandRepoPath.trim();
    if (!name) {
      setError("请填写工作区名称");
      return;
    }
    if (!requirementDir) {
      setError("请填写需求目录");
      return;
    }
    if (!repoPath) {
      setError("请填写项目目录");
      return;
    }

    setCreatingWorkspace(true);
    setError("");
    setStatus("");
    try {
      const result = await onInitDemandWorkspace({
        key: key || null,
        demandId: demandId.trim() || null,
        name,
        description: description || null,
        workspaceType: newWorkspaceType,
        requirementDir,
        repoPath,
        project: demandProjectKey.trim() || null,
        branch: demandBranch.trim() || null,
        rootDir: newWorkspaceIndependentDir ? newWorkspaceRootDir.trim() || null : null,
        activate: false,
      });
      setNewWorkspaceName("");
      setNewWorkspaceKey("");
      setNewWorkspaceDescription("");
      setNewWorkspaceType(DEFAULT_NEW_WORKSPACE_TYPE);
      setNewWorkspaceIndependentDir(false);
      setNewWorkspaceRootDir("");
      setCopyCurrentWorkspace(true);
      setDemandId("");
      setDemandRequirementDir("");
      setDemandRepoPath("");
      setDemandBranch("");
      setDemandProjectKey("");
      setCreateWorkspaceMode("basic");
      setCreateOpen(false);
      await loadOverview();
      await loadProjectWorkspaceEditor(result.key);
      const branchWarning =
        result.branch.expected && result.branch.matches === false
          ? `，当前分支 ${result.branch.current || "-"} 与目标分支不一致`
          : "";
      setStatus(`已初始化：${result.name} · ${result.project.name}${branchWarning}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function chooseDemandDirectory(kind: "requirement" | "repo") {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath:
        kind === "requirement"
          ? demandRequirementDir.trim() || undefined
          : demandRepoPath.trim() || undefined,
    });
    if (typeof selected !== "string" || !selected.trim()) {
      return;
    }
    if (kind === "requirement") {
      setDemandRequirementDir(selected);
    } else {
      setDemandRepoPath(selected);
    }
  }

  async function saveWorkspaceEditor() {
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
      await onProjectConfigSaved();
      await loadOverview();
      setStatus(`已更新工作区 ${nextState.workspace.name}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function applyWorkspaceEditorState(nextState: ProjectWorkspaceEditorState) {
    setWorkspaceEditor(nextState);
    setWorkspaceDraft(nextState.workspace);
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
        { project: projectKey },
      );
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
      setStatus("已创建工作区副本");
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
        { project: projectKey, path: selected },
      );
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
      setStatus("已绑定已有目录");
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
        { project: projectKey },
      );
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
      setStatus("已恢复使用全局目录");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceDirectoryBusy("");
    }
  }

  async function openWorkspaceProjectDirectory(path: string) {
    if (!path.trim() || path === "未配置目录") {
      return;
    }
    setError("");
    try {
      await invoke("open_local_path", { path });
      setStatus("已打开项目目录");
    } catch (reason) {
      setError(String(reason));
    }
  }

  function updateDraft(patch: Partial<ProjectWorkspaceEditorDraft>) {
    setWorkspaceDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleCreateWorkspaceType(label: string) {
    try {
      const option = await addWorkspaceType(label);
      setStatus(`已新增类型 ${option.label}`);
      return option;
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function handleRemoveWorkspaceType(optionKey: string, label: string) {
    const usedCount = workspaceTypeUsageCounts.get(optionKey) ?? 0;
    if (usedCount > 0) {
      setError(`已有 ${usedCount} 个工作区使用 ${label}`);
      return;
    }
    try {
      await removeWorkspaceType(optionKey);
      if (newWorkspaceType === optionKey) {
        setNewWorkspaceType(DEFAULT_NEW_WORKSPACE_TYPE);
      }
      setWorkspaceDraft((current) =>
        current?.workspaceType === optionKey
          ? {
              ...current,
              workspaceType: DEFAULT_NEW_WORKSPACE_TYPE,
              workspaceTypeLabel: workspaceTypeLabel(
                DEFAULT_NEW_WORKSPACE_TYPE,
                null,
                workspaceTypeOptions,
              ),
            }
          : current,
      );
      setStatus(`已删除类型 ${label}`);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function closeManageDialog() {
    setManageOpen(false);
    setCreateOpen(false);
  }

  const featuredGroup = overviewFilterActive
    ? filteredGroups.find((group) => group.system) ??
      filteredGroups.find((group) => group.key === activeProjectWorkspaceKey) ??
      filteredGroups[0] ??
      null
    : filteredGroups.find((group) => group.system) ?? activeGroup ?? filteredGroups[0] ?? null;
  const listedGroups = featuredGroup
    ? filteredGroups.filter((group) => group.key !== featuredGroup.key)
    : filteredGroups;

  async function openWorkspaceModule(
    group: WorkspacePinnedActionsOverview,
    target: {
      page: OverviewNavigationPage;
      label: string;
      projectManagementView?: ProjectManagementViewKey;
      projectKey?: string | null;
    },
  ) {
    setError("");
    setStatus("");
    try {
      if (group.key && group.key !== activeProjectWorkspaceKey) {
        await onProjectWorkspaceChange(group.key);
      }
      if (target.projectKey?.trim()) {
        onProjectChange(target.projectKey.trim());
      }
      if (target.projectManagementView) {
        onProjectManagementViewChange(target.projectManagementView);
      }
      onNavigateToPage(target.page);
      setStatus(`已打开 ${target.label}`);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function workspaceDefaultProjectKey(group: WorkspacePinnedActionsOverview) {
    const projectKeys = group.projectDirectories
      .map((directory) => directory.projectKey.trim())
      .filter(Boolean);
    return projectKeys.length === 1 ? projectKeys[0] : null;
  }

  function projectSectionQuickActions(
    group: WorkspacePinnedActionsOverview,
  ): OverviewSectionQuickAction[] {
    const projectKey = workspaceDefaultProjectKey(group);
    return [
      {
        key: "projects",
        label: "项目",
        title: "打开项目管理",
        icon: <AppWindowIcon fontSize="small" />,
        onClick: () =>
          openWorkspaceModule(group, {
            page: "projectManagement",
            label: "项目管理",
            projectManagementView: "projects",
            projectKey,
          }),
      },
    ];
  }

  function moduleQuickActions(
    group: WorkspacePinnedActionsOverview,
    page: OverviewNavigationPage,
    label: string,
    icon: ReactNode,
    projectManagementView?: ProjectManagementViewKey,
  ): OverviewSectionQuickAction[] {
    return [
      {
        key: page,
        label,
        title: `打开${label}`,
        icon,
        onClick: () =>
          openWorkspaceModule(group, {
            page,
            label,
            projectManagementView,
            projectKey:
              page === "projectManagement" ? workspaceDefaultProjectKey(group) : null,
          }),
      },
    ];
  }

  function renderSectionHeading(
    title: string,
    actions: OverviewSectionQuickAction[] = [],
    count?: number,
  ) {
    return (
      <div className="overview-section-heading">
        <div className="overview-section-heading-copy">
          <Typography className="overview-section-label">{title}</Typography>
          {typeof count === "number" ? (
            <Chip size="small" className="overview-count-chip" label={count} />
          ) : null}
        </div>
        {actions.length > 0 ? (
          <div className="overview-section-actions" aria-label={`${title}快捷入口`}>
            {actions.map((action) => (
              <Tooltip key={action.key} title={action.title}>
                <span>
                  <IconButton
                    size="small"
                    className="overview-section-action-button"
                    onClick={() => void action.onClick()}
                    disabled={action.disabled}
                    aria-label={action.title}
                  >
                    {action.icon}
                  </IconButton>
                </span>
              </Tooltip>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderActionPanel(
    title: string,
    actions: WorkspacePinnedActionItem[],
    className = "",
    sectionActions: OverviewSectionQuickAction[] = [],
  ) {
    if (actions.length === 0) {
      return null;
    }
    return (
      <div className={`overview-actions-panel ${className}`.trim()}>
        {renderSectionHeading(title, sectionActions, actions.length)}
        <div className="overview-action-list">
          {actions.map((item) => {
            const running = runningKey === item.action.dedupeKey;
            const updatedAt = formatUpdatedAt(item.updatedAtMs);
            const labelParams = actionLabelParams(item);
            const paramTag =
              labelParams.length > 0 ? (
                <Tooltip
                  arrow
                  placement="top-start"
                  title={
                    <Stack className="overview-action-param-tooltip" spacing={0.4}>
                      {labelParams.map((param) => (
                        <span
                          key={`${item.action.dedupeKey}:${param.label}:${param.value}`}
                          className="overview-action-param-tooltip-row"
                        >
                          <b>{param.label}</b>
                          <span>{param.value}</span>
                        </span>
                      ))}
                    </Stack>
                  }
                >
                  <span className="overview-action-param-label" tabIndex={0}>
                    参数 {labelParams.length}
                  </span>
                </Tooltip>
              ) : null;
            return (
              <Box key={item.action.dedupeKey} className="overview-action-row">
                <Stack className="overview-action-copy" minWidth={0}>
                  <Stack
                    className="overview-action-title-row"
                    direction="row"
                    alignItems="center"
                    minWidth={0}
                  >
                    <Chip
                      size="small"
                      color={actionTone(item.kindLabel)}
                      variant="outlined"
                      className="overview-action-chip"
                      label={item.kindLabel}
                    />
                    {paramTag}
                    <Typography className="overview-action-title" noWrap title={item.label}>
                      {item.label}
                    </Typography>
                  </Stack>
                  <Stack
                    direction="row"
                    className="overview-action-meta"
                    minWidth={0}
                    flexWrap="wrap"
                    useFlexGap
                  >
                    {item.projectKey ? (
                      <Typography component="span" noWrap>
                        {item.projectKey}
                      </Typography>
                    ) : null}
                    {item.detail ? (
                      <Typography component="span" noWrap>
                        {item.detail}
                      </Typography>
                    ) : null}
                  </Stack>
                </Stack>
                <div className="overview-action-tools">
                  {updatedAt ? (
                    <Typography className="overview-action-time" noWrap>
                      {updatedAt}
                    </Typography>
                  ) : null}
                  <Tooltip title={item.confirmRequired ? "确认后运行" : "运行"}>
                    <span>
                      <IconButton
                        size="small"
                        className="overview-action-run"
                        onClick={() => void executeAction(item)}
                        disabled={Boolean(runningKey)}
                        aria-label={`运行 ${item.label}`}
                      >
                        {running ? (
                          <CircularProgress size={15} thickness={5} />
                        ) : (
                          <ReplayIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                </div>
              </Box>
            );
          })}
        </div>
      </div>
    );
  }

  function renderWorkspaceCard(group: WorkspacePinnedActionsOverview, featured = false) {
    const active = group.key === activeProjectWorkspaceKey;
    const collapsed = collapsedWorkspaceKeys.has(group.key);
    const stateItems = workspaceStateItems(group, active);
    const visibleResources = group.resources.filter((resource) => resource.kind !== "tool");
    const visibleTools = group.resources.filter((resource) => resource.kind === "tool");
    const visibleDirectories = group.projectDirectories;
    const visibleProxyProfiles = group.proxyProfiles;
    const visibleBuildActions = group.actions.filter((item) => actionGroupKind(item) === "build");
    const visibleGitActions = group.actions.filter((item) => actionGroupKind(item) === "git");
    const visibleOtherActions = group.actions.filter((item) => actionGroupKind(item) === "other");
    const showDirectoryPanel = visibleDirectories.length > 0;
    const showProxyPanel = visibleProxyProfiles.length > 0 || (active && !group.system);
    const showRootDirectoryShortcut = Boolean(
      group.rootDir && !showDirectoryPanel && !group.system,
    );
    const showShortcutPanel = visibleResources.length > 0 || showRootDirectoryShortcut;
    const showToolPanel = visibleTools.length > 0;
    const showContentPanel =
      showShortcutPanel || showToolPanel || showDirectoryPanel || showProxyPanel;
    const showBuildActionsPanel = visibleBuildActions.length > 0;
    const showGitActionsPanel = visibleGitActions.length > 0;
    const showOtherActionsPanel = visibleOtherActions.length > 0;
    const showActionsPanel = showBuildActionsPanel || showGitActionsPanel || showOtherActionsPanel;
    const showBodyPanel = showContentPanel || showActionsPanel;
    const actionSummaryCount =
      visibleBuildActions.length + visibleGitActions.length + visibleOtherActions.length;
    const typeLabel = workspaceTypeLabel(
      group.workspaceType,
      group.workspaceTypeLabel,
      workspaceTypeOptions,
    );
    const showTypeChip = !group.system && typeLabel.trim().length > 0;
    const summaryItems = [
      group.entryCount > 0 ? `${group.entryCount} 入口` : "",
      group.projectCount > 0 ? `${group.projectCount} 项目` : "",
      group.proxyProfileCount > 0 ? `${group.proxyProfileCount} 代理` : "",
      actionSummaryCount > 0 ? `${actionSummaryCount} 动作` : "",
    ].filter(Boolean);

    return (
      <Box
        key={group.key}
        component="section"
        className={`overview-workspace-card${group.system ? " is-system" : ""}${active ? " is-active" : ""}${featured ? " is-featured" : ""}${collapsed ? " is-collapsed" : ""}`}
      >
        <div className="overview-workspace-header">
          <div className="overview-workspace-heading">
            <div className="overview-workspace-title-row">
              <Typography component={featured ? "h2" : "h3"} className="overview-workspace-title" noWrap>
                {group.name}
              </Typography>
              {showTypeChip ? (
                <Chip size="small" className="overview-workspace-type-chip" label={typeLabel} />
              ) : null}
              {stateItems.map((item) => (
                <span key={`${item.tone}:${item.label}`} className={`overview-workspace-state-chip is-${item.tone}`}>
                  {item.label}
                </span>
              ))}
            </div>
          </div>
          <div className="overview-workspace-tools">
            {summaryItems.length > 0 ? (
              <div className="overview-workspace-summary" aria-label={summaryItems.join("，")}>
                {summaryItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
            <Tooltip title="提取 AI 上下文">
              <span>
                <IconButton
                  size="small"
                  className="overview-context-button"
                  onClick={() => void openWorkspaceAiContext(group)}
                  disabled={aiContextLoading}
                  aria-label={`提取 ${group.name} 的 AI 上下文`}
                >
                  {aiContextLoading && aiContextGroup?.key === group.key ? (
                    <CircularProgress size={15} thickness={5} />
                  ) : (
                    <CopyIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={collapsed ? "展开" : "收起"}>
              <IconButton
                size="small"
                className="overview-collapse-toggle"
                onClick={() => toggleWorkspaceCollapsed(group.key)}
                aria-label={`${collapsed ? "展开" : "收起"} ${group.name}`}
                aria-expanded={!collapsed}
              >
                {collapsed ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {!collapsed && showBodyPanel ? (
          <div className="overview-workspace-body">
            {showContentPanel ? (
              <div className="overview-workspace-content">
                {showShortcutPanel ? (
                  <div className="overview-shortcut-panel">
                    {renderSectionHeading(
                      "入口",
                      moduleQuickActions(
                        group,
                        "resources",
                        "资源入口",
                        <WebsiteIcon fontSize="small" />,
                      ),
                    )}
                    <div className={`overview-shortcut-grid${group.system ? " is-system" : ""}`}>
                      {visibleResources.map((resource) => {
                        const running = runningKey === `resource:${resource.key}`;
                        const shortcutDetail =
                          resource.category && resource.category !== resource.label
                            ? resource.category
                            : resource.kindLabel;
                        return (
                          <button
                            key={resource.key}
                            type="button"
                            className={`overview-shortcut overview-shortcut--${resource.kind}`}
                            onClick={() => void openWorkspaceResource(resource)}
                            disabled={Boolean(runningKey) || !resource.openable}
                            title={resource.value ?? resource.label}
                          >
                            <span className="overview-shortcut-icon" aria-hidden="true">
                              {running ? <CircularProgress size={14} /> : shortcutIcon(resource.kind)}
                            </span>
                            <span className="overview-shortcut-copy">
                              <strong>{resource.label}</strong>
                              <small>{shortcutDetail}</small>
                            </span>
                            <span className="overview-shortcut-chevron" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        );
                      })}

                      {showRootDirectoryShortcut ? (
                        <button
                          type="button"
                          className="overview-shortcut overview-shortcut--directory"
                          onClick={() => void openWorkspaceRootDirectory(group)}
                          disabled={Boolean(runningKey)}
                          title={group.rootDir ?? undefined}
                        >
                          <span className="overview-shortcut-icon" aria-hidden="true">
                            <FolderIcon fontSize="small" />
                          </span>
                          <span className="overview-shortcut-copy">
                            <strong>工作目录</strong>
                            <small>{group.rootDir}</small>
                          </span>
                          <span className="overview-shortcut-chevron" aria-hidden="true">
                            ›
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showToolPanel ? (
                  <div className="overview-shortcut-panel">
                    {renderSectionHeading(
                      "工具",
                      moduleQuickActions(
                        group,
                        "resources",
                        "资源入口",
                        <WorkflowIcon fontSize="small" />,
                      ),
                    )}
                    <div className={`overview-shortcut-grid${group.system ? " is-system" : ""}`}>
                      {visibleTools.map((resource) => {
                        const running = runningKey === `tool:${resource.key}`;
                        const canPlan = isLinkToolResource(resource);
                        const disabled = Boolean(runningKey) || (!canPlan && !resource.openable);
                        if (canPlan) {
                          const runtimeAction = linkRuntimeAction(resource);
                          const runtimeStatus = linkRuntimeLabel(resource);
                          const actionTitle =
                            runtimeAction === "stop" ? "一键停止" : "一键启动";
                          const actionDisabled =
                            Boolean(runningKey) ||
                            (runtimeAction === "stop"
                              ? !resource.linkRuntime?.canStop
                              : resource.linkRuntime
                                ? !resource.linkRuntime.canRun
                                : false);
                          return (
                            <div
                              key={resource.key}
                              className={`overview-shortcut overview-shortcut--${resource.kind} overview-shortcut--with-run`}
                              title={resource.detail ?? resource.value ?? resource.label}
                            >
                              <button
                                type="button"
                                className="overview-shortcut-main"
                                onClick={() => void openWorkspaceLinkPlan(resource)}
                                disabled={Boolean(runningKey)}
                              >
                                <span className="overview-shortcut-icon" aria-hidden="true">
                                  {running ? (
                                    <CircularProgress size={14} />
                                  ) : (
                                    shortcutIcon(resource.kind)
                                  )}
                                </span>
                                <span className="overview-shortcut-copy">
                                  <strong>{resource.label}</strong>
                                  <small>
                                    {[resource.detail || resource.value || resource.kindLabel, runtimeStatus]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                </span>
                              </button>
                              <Tooltip title={actionTitle}>
                                <span className="overview-shortcut-run-shell">
                                  <IconButton
                                    size="small"
                                    className="overview-shortcut-run-button"
                                    onClick={() =>
                                      void executeWorkspaceLinkAction(resource, runtimeAction)
                                    }
                                    disabled={actionDisabled}
                                    aria-label={`${runtimeAction === "stop" ? "停止" : "启动"} ${resource.label}`}
                                  >
                                    {running ? (
                                      <CircularProgress size={14} thickness={5} />
                                    ) : runtimeAction === "stop" ? (
                                      <StopIcon fontSize="small" />
                                    ) : (
                                      <PlayIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </div>
                          );
                        }
                        return (
                          <button
                            key={resource.key}
                            type="button"
                            className={`overview-shortcut overview-shortcut--${resource.kind}`}
                            onClick={() =>
                              void openWorkspaceResource(resource)
                            }
                            disabled={disabled}
                            title={resource.detail ?? resource.value ?? resource.label}
                          >
                            <span className="overview-shortcut-icon" aria-hidden="true">
                              {running ? <CircularProgress size={14} /> : shortcutIcon(resource.kind)}
                            </span>
                            <span className="overview-shortcut-copy">
                              <strong>{resource.label}</strong>
                              <small>{resource.detail || resource.value || resource.kindLabel}</small>
                            </span>
                            <span className="overview-shortcut-chevron" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {showDirectoryPanel ? (
                  <div className="overview-directory-panel">
                    {renderSectionHeading("项目", projectSectionQuickActions(group))}
                    <div className="overview-directory-list">
                      {visibleDirectories.map((directory) => {
                        const projectRunning = directory.running || directory.canStop;
                        const profileInfo = workspaceProjectRuntimeProfileInfo(
                          runtimeEntryByProjectKey.get(directory.projectKey),
                          selectedDebugProfileKeys[directory.projectKey],
                        );
                        const profileSummary = projectRuntimePreferencesHydrated
                          ? profileInfo.summary
                          : "正在读取启动档案";
                        const projectAction = projectRunning ? "stop" : "start";
                        const actionRunning =
                          runningKey ===
                          `project:${group.key}:${directory.projectKey}:${projectAction}`;
                        const focusRunning =
                          runningKey === `project:${group.key}:${directory.projectKey}:focus`;
                        const canToggleProject =
                          active &&
                          Boolean(directory.projectKey) &&
                          (projectRunning ||
                            (projectRuntimePreferencesHydrated && directory.canStart));
                        const canFocusProject =
                          active &&
                          Boolean(directory.projectKey) &&
                          projectRunning &&
                          directory.canFocusRuntime;
                        const projectToggleTitle = projectRunning
                          ? "停止项目"
                          : canToggleProject
                            ? "启动项目"
                            : !projectRuntimePreferencesHydrated
                              ? "正在读取启动档案"
                              : active
                                ? "项目暂不可启动"
                                : "设为当前工作区后启动";
                        const projectOpenTitle = canFocusProject
                          ? "打开运行中的项目"
                          : active
                            ? "未配置打开地址，且未识别到启动 URL"
                            : "设为当前工作区后打开";
                        return (
                          <div
                            key={directory.projectKey}
                            className={`overview-directory-row${
                              projectRunning ? " is-running" : ""
                            }`}
                            title={[profileSummary, directory.path].filter(Boolean).join(" · ")}
                          >
                            <button
                              type="button"
                              className="overview-directory-main"
                              onClick={() => void openWorkspaceProjectDirectory(directory.path ?? "")}
                              disabled={!directory.path || Boolean(runningKey)}
                            >
                              <span className="overview-shortcut-icon" aria-hidden="true">
                                <FolderIcon fontSize="small" />
                              </span>
                              <span className="overview-shortcut-copy">
                                <span className="overview-directory-name-row">
                                  <strong>{directory.projectName}</strong>
                                  <span
                                    className={`overview-directory-chip is-${projectDirectoryTone(directory.mode)}`}
                                  >
                                    {projectDirectoryLabel(directory.modeLabel)}
                                  </span>
                                  {projectRunning ? (
                                    <span className="overview-directory-chip is-success">
                                      {directory.statusLabel || "运行中"}
                                    </span>
                                  ) : null}
                                </span>
                                <small>
                                  {[profileSummary, directory.path || "目录未配置"].join(" · ")}
                                </small>
                              </span>
                            </button>
                            <span className="overview-directory-actions">
                              {projectRunning ? (
                                <Tooltip title={projectOpenTitle}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      className="overview-project-start overview-project-open"
                                      onClick={() =>
                                        void focusWorkspaceProjectRuntime(group, directory)
                                      }
                                      disabled={!canFocusProject || Boolean(runningKey)}
                                      aria-label={`打开 ${directory.projectName}`}
                                    >
                                      {focusRunning ? (
                                        <CircularProgress size={15} thickness={5} />
                                      ) : (
                                        <OpenExternalIcon fontSize="small" />
                                      )}
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              ) : null}
                              <Tooltip title={projectToggleTitle}>
                                <span>
                                  <IconButton
                                    size="small"
                                    className={`overview-project-start overview-project-toggle${
                                      projectRunning ? " is-running" : ""
                                    }`}
                                    onClick={() => void toggleWorkspaceProject(group, directory)}
                                    disabled={!canToggleProject || Boolean(runningKey)}
                                    aria-label={`${projectRunning ? "停止" : "启动"} ${
                                      directory.projectName
                                    }`}
                                  >
                                    {actionRunning ? (
                                      <CircularProgress size={15} thickness={5} />
                                    ) : projectRunning ? (
                                      <StopIcon fontSize="small" />
                                    ) : (
                                      <PlayIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {showProxyPanel ? (
                  <div className="overview-directory-panel overview-proxy-panel">
                    {renderSectionHeading(
                      "本地代理",
                      moduleQuickActions(
                        group,
                        "proxy",
                        "本地代理",
                        <TerminalIcon fontSize="small" />,
                      ),
                    )}
                    <div className="overview-directory-list overview-proxy-list">
                      {visibleProxyProfiles.length === 0 ? (
                        <div className="overview-directory-row overview-proxy-row overview-proxy-empty-row">
                          <div className="overview-directory-main overview-proxy-main">
                            <span
                              className="overview-shortcut-icon overview-proxy-icon"
                              aria-hidden="true"
                            >
                              <TerminalIcon fontSize="small" />
                            </span>
                            <span className="overview-shortcut-copy">
                              <span className="overview-directory-name-row">
                                <strong>暂无绑定代理</strong>
                              </span>
                              <small>当前工作区未绑定代理</small>
                            </span>
                          </div>
                        </div>
                      ) : null}
                      {visibleProxyProfiles.map((profile) => {
                        const running =
                          runningKey ===
                          `proxy:${group.key}:${profile.id}:${profile.running ? "stop" : "start"}`;
                        const statusLabel = profile.running ? "运行中" : "未启动";
                        const ruleLabel = `${profile.ruleCount} 条规则`;
                        return (
                          <div
                            key={profile.id}
                            className={`overview-directory-row overview-proxy-row${
                              profile.running ? " is-running" : ""
                            }`}
                            title={`${profile.listenUrl} · ${ruleLabel}`}
                          >
                            <div className="overview-directory-main overview-proxy-main">
                              <span
                                className="overview-shortcut-icon overview-proxy-icon"
                                aria-hidden="true"
                              >
                                <TerminalIcon fontSize="small" />
                              </span>
                              <span className="overview-shortcut-copy">
                                <span className="overview-directory-name-row">
                                  <strong>{profile.name}</strong>
                                  <span
                                    className={`overview-directory-chip overview-proxy-state${
                                      profile.running ? " is-success" : ""
                                    }`}
                                  >
                                    {statusLabel}
                                  </span>
                                </span>
                                <small>
                                  {profile.listenUrl} · {ruleLabel}
                                </small>
                              </span>
                            </div>
                            <Tooltip title={profile.running ? "停止代理服务" : "启动代理服务"}>
                              <span>
                                <IconButton
                                  size="small"
                                  className={`overview-project-start overview-proxy-toggle${
                                    profile.running ? " is-running" : ""
                                  }`}
                                  onClick={() => void toggleWorkspaceProxyProfile(group, profile)}
                                  disabled={Boolean(runningKey)}
                                  aria-label={`${profile.running ? "停止" : "启动"} ${profile.name}`}
                                >
                                  {running ? (
                                    <CircularProgress size={15} thickness={5} />
                                  ) : profile.running ? (
                                    <StopIcon fontSize="small" />
                                  ) : (
                                    <PlayIcon fontSize="small" />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showActionsPanel ? (
              <>
                {renderActionPanel(
                  "构建",
                  visibleBuildActions,
                  "overview-build-actions-panel",
                  moduleQuickActions(
                    group,
                    "projectManagement",
                    "构建",
                    <PackageIcon fontSize="small" />,
                    "build",
                  ),
                )}
                {renderActionPanel(
                  "Git",
                  visibleGitActions,
                  "overview-git-actions-panel",
                  moduleQuickActions(
                    group,
                    "projectManagement",
                    "Git",
                    <WorkflowIcon fontSize="small" />,
                    "git",
                  ),
                )}
                {renderActionPanel("其他动作", visibleOtherActions)}
              </>
            ) : null}
          </div>
        ) : null}
      </Box>
    );
  }

  return (
    <Box className="overview-page">
      <Stack className="overview-page-stack" minWidth={0}>
        <AppToast
          message={error || status}
          severity={error ? "error" : "success"}
          autoHideDuration={error ? 5200 : 2800}
          nonce={toastNonce}
        />

        {confirmDialog}

        <LinkPlanDialog
          state={linkPlanDialog}
          onClose={() => setLinkPlanDialog(null)}
          onAction={(action) => void runLinkDialogAction(action)}
        />

        <WorkspacePageToolbar
          ariaLabel="工作区概览与配置"
          metrics={[
            {
              key: "workspaces",
              label: "工作区",
              value: groups.length,
              icon: <PackageIcon fontSize="small" />,
              tone: "blue" as const,
            },
            ...workspaceToolbarTypeTags.map((option, index) => ({
              key: option.key,
              label: option.label,
              value: option.count,
              tone: (["cyan", "violet", "green"] as const)[index % 3],
            })),
          ]}
          actions={
            <WorkspacePageToolbarAction
              startIcon={<SettingsIcon fontSize="small" />}
              onClick={() => setManageOpen(true)}
            >
              工作区配置
            </WorkspacePageToolbarAction>
          }
        />

        <Box className="overview-filter-bar">
          <TextField
            className="overview-search-field"
            size="small"
            value={overviewQuery}
            onChange={(event) => setOverviewQuery(event.target.value)}
            placeholder="搜索工作区、项目、入口、代理或动作"
            inputProps={{ "aria-label": "搜索工作区" }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" className="overview-search-adornment">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: overviewQuery.trim() ? (
                <InputAdornment position="end">
                  <Tooltip title="清空搜索">
                    <IconButton
                      size="small"
                      className="overview-search-clear"
                      onClick={() => setOverviewQuery("")}
                      aria-label="清空工作区搜索"
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            }}
          />
          <TextField
            select
            size="small"
            className="overview-type-select"
            value={workspaceTypeFilter}
            onChange={(event) => setWorkspaceTypeFilter(event.target.value)}
            aria-label="按工作区类型筛选"
            SelectProps={{ MenuProps: workspaceTypeSelectMenuProps }}
          >
            <MenuItem value="all">全部类型 {groups.length}</MenuItem>
            {workspaceTypeFilterOptions.map((option) => (
              <MenuItem key={option.key} value={option.key}>
                {option.label} {option.count}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box className="overview-workspace-list">
          {featuredGroup ? renderWorkspaceCard(featuredGroup, true) : null}

          {loading && groups.length === 0 ? (
            <Box className="overview-loading-state">
              <CircularProgress size={20} thickness={5} />
            </Box>
          ) : null}

          {!loading && groups.length === 0 ? (
            <Box className="overview-empty-state">
              <Typography variant="body2" color="text.secondary">
                还没有工作区
              </Typography>
            </Box>
          ) : null}

          {!loading && groups.length > 0 && filteredGroups.length === 0 ? (
            <AppEmptyState
              className="overview-filter-empty-state"
              compact
              title="没有匹配工作区"
              description="换个关键词或筛选项。"
            />
          ) : null}

          {listedGroups.map((group) => renderWorkspaceCard(group))}
        </Box>

        <Dialog
          open={aiContextOpen}
          onClose={() => setAiContextOpen(false)}
          maxWidth={false}
          PaperProps={{ className: "overview-ai-context-paper" }}
        >
          <DialogTitle className="overview-ai-context-title">
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                <Box className="overview-ai-context-icon">
                  <CopyIcon fontSize="small" />
                </Box>
                <Stack spacing={0.12} minWidth={0}>
                  <Typography variant="subtitle1" className="overview-ai-context-heading" noWrap>
                    AI 上下文
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {aiContextResponse?.workspaceName || aiContextGroup?.name || "工作区"}
                  </Typography>
                </Stack>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                {aiContextGroup ? (
                  <>
                    <Chip size="small" label={`${aiContextGroup.projectCount} 项目`} />
                    <Chip size="small" label={`${aiContextGroup.entryCount} 入口`} />
                    <Chip size="small" label={`${aiContextGroup.proxyProfileCount} 代理`} />
                    <Chip size="small" label={`${aiContextGroup.actionCount} 动作`} />
                  </>
                ) : null}
                <Tooltip title="关闭">
                  <IconButton
                    size="small"
                    onClick={() => setAiContextOpen(false)}
                    aria-label="关闭 AI 上下文"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </DialogTitle>
          <DialogContent className="overview-ai-context-content">
            <div className="overview-ai-context-toolbar">
              <div className="overview-ai-context-tabs" role="tablist" aria-label="AI 上下文格式">
                <button
                  type="button"
                  className={aiContextView === "markdown" ? "is-active" : ""}
                  onClick={() => setAiContextView("markdown")}
                >
                  Markdown
                </button>
                <button
                  type="button"
                  className={aiContextView === "json" ? "is-active" : ""}
                  onClick={() => setAiContextView("json")}
                >
                  JSON
                </button>
              </div>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography className="overview-ai-context-meta" noWrap>
                  {aiContextPreviewLineCount ? `${aiContextPreviewLineCount} 行` : "生成中"}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={aiContextLoading ? <CircularProgress size={13} /> : <ReplayIcon fontSize="small" />}
                  onClick={() => void refreshWorkspaceAiContext()}
                  disabled={aiContextLoading || !aiContextGroup}
                >
                  刷新
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<CopyIcon fontSize="small" />}
                  onClick={() => void copyAiContext(aiContextView)}
                  disabled={!aiContextResponse || aiContextLoading}
                >
                  复制
                </Button>
              </Stack>
            </div>

            <div className="overview-ai-context-options">
              <div className="overview-ai-context-config-row">
                <div className="overview-ai-context-preset-row">
                  <TextField
                    select
                    size="small"
                    className="overview-ai-context-preset-select"
                    label="场景"
                    value={aiContextPresetKey}
                    onChange={(event) => void applyAiContextPreset(event.target.value)}
                    disabled={aiContextLoading}
                  >
                    {aiContextPresets.map((preset) => (
                      <MenuItem key={preset.key} value={preset.key}>
                        {preset.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    className="overview-ai-context-preset-name"
                    label="场景名"
                    value={aiContextPresetName}
                    placeholder={selectedAiContextPreset.custom ? selectedAiContextPreset.label : "保存为自定义"}
                    onChange={(event) => setAiContextPresetName(event.target.value)}
                    disabled={aiContextLoading}
                  />
                  {aiContextPresetDirty ? <Chip size="small" label="已调整" /> : null}
                  <Button
                    size="small"
                    variant={aiContextPresetDirty ? "contained" : "outlined"}
                    startIcon={<CheckIcon fontSize="small" />}
                    onClick={() => void saveAiContextPreset()}
                    disabled={
                      aiContextLoading ||
                      (!aiContextPresetName.trim() && !selectedAiContextPreset.custom)
                    }
                  >
                    保存
                  </Button>
                  {selectedAiContextPreset.custom ? (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => void deleteAiContextPreset()}
                      disabled={aiContextLoading}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
                <div className="overview-ai-context-limit-row">
                  <Tooltip title="项目、入口、目录、动作这些内容每类最多输出多少条">
                    <TextField
                      select
                      size="small"
                      className="overview-ai-context-limit-select"
                      label="内容上限"
                      value={aiContextOptions.itemLimit}
                      onChange={(event) =>
                        void updateAiContextOptions({ itemLimit: Number(event.target.value) })
                      }
                      disabled={aiContextLoading}
                    >
                      {AI_CONTEXT_LIMIT_OPTIONS.map((value) => (
                        <MenuItem key={value} value={value}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Tooltip>
                  <Tooltip title="构建、合并、可回放动作这些历史记录最多输出多少条">
                    <TextField
                      select
                      size="small"
                      className="overview-ai-context-limit-select"
                      label="历史上限"
                      value={aiContextOptions.historyLimit}
                      onChange={(event) =>
                        void updateAiContextOptions({ historyLimit: Number(event.target.value) })
                      }
                      disabled={aiContextLoading}
                    >
                      {AI_CONTEXT_LIMIT_OPTIONS.map((value) => (
                        <MenuItem key={value} value={value}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Tooltip>
                </div>
              </div>

              <div className="overview-ai-context-scope-row">
                <span className="overview-ai-context-section-label">范围</span>
                <div className="overview-ai-context-checks">
                  {AI_CONTEXT_SCOPE_OPTIONS.map((option) => (
                    <FormControlLabel
                      key={option.key}
                      className="overview-ai-context-check"
                      control={
                        <Checkbox
                          size="small"
                          checked={Boolean(aiContextOptions[option.key])}
                          onChange={(event) =>
                            void updateAiContextOptions({ [option.key]: event.target.checked })
                          }
                          disabled={aiContextLoading}
                        />
                      }
                      label={option.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="overview-ai-context-preview">
              {aiContextLoading && !aiContextResponse ? (
                <Box className="overview-ai-context-loading">
                  <CircularProgress size={22} thickness={5} />
                </Box>
              ) : aiContextPreviewText ? (
                <pre>{aiContextPreviewText}</pre>
              ) : (
                <AppEmptyState compact title="暂无上下文" description="刷新后可复制给 AI 使用。" />
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={manageOpen}
          onClose={closeManageDialog}
          maxWidth="lg"
          fullWidth
          className="overview-workspace-config-dialog"
          PaperProps={{
            className: "overview-workspace-config-paper",
          }}
        >
          <DialogTitle className="overview-workspace-config-title">
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Stack
                className="overview-workspace-config-title-copy"
                direction="row"
                alignItems="center"
                spacing={0.75}
                minWidth={0}
              >
                <Box
                  className="overview-workspace-config-title-icon"
                  sx={(theme) => ({
                    width: 28,
                    height: 28,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "9px",
                    color: theme.palette.primary.main,
                    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.12 : 0.08),
                  })}
                >
                  <SettingsIcon fontSize="small" />
                </Box>
                <Stack className="overview-workspace-config-title-text" spacing={0.1} minWidth={0}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 860, lineHeight: 1.2 }}>
                    工作区配置
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {workspaceDraft?.name ?? editingWorkspaceSummary?.name ?? activeGroup?.name ?? activeProjectWorkspaceKey}
                  </Typography>
                </Stack>
                {workspaceDirty ? <Chip size="small" color="primary" label="未保存" /> : null}
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <Tooltip title="关闭">
                  <IconButton
                    className="overview-workspace-config-close"
                    size="small"
                    onClick={closeManageDialog}
                    aria-label="关闭工作区配置"
                    sx={(theme) => ({
                      width: 32,
                      height: 32,
                      borderRadius: "10px",
                      color: theme.palette.text.secondary,
                      "&:hover": {
                        color: theme.palette.text.primary,
                        bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.08 : 0.06),
                      },
                    })}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </DialogTitle>

          <DialogContent className="overview-workspace-config-content">
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" },
                gridTemplateRows: { xs: "auto minmax(0, 1fr)", md: "minmax(0, 1fr)" },
                width: "100%",
                height: "100%",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <Stack
                className="overview-workspace-config-sidebar"
                spacing={0.8}
                sx={{
                  minHeight: 0,
                  overflow: "hidden",
                  p: 1,
                }}
              >
                <Stack
                  className="overview-workspace-config-menu-head"
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Stack className="overview-workspace-config-menu-copy" spacing={0.05}>
                    <Typography className="overview-workspace-config-menu-title" variant="caption">
                      工作区
                    </Typography>
                    <Typography className="overview-workspace-config-menu-count" variant="caption">
                      {projectWorkspaces.length} 个
                    </Typography>
                  </Stack>
                  <Tooltip title="新建工作区">
                    <IconButton
                      size="small"
                      color={createOpen ? "primary" : "default"}
                      onClick={() => setCreateOpen(true)}
                      aria-label="新建工作区"
                      aria-pressed={createOpen}
                      sx={(theme) => ({
                        width: 32,
                        height: 32,
                        border: "1px solid",
                        borderColor: createOpen
                          ? alpha(theme.palette.primary.main, 0.32)
                          : theme.palette.divider,
                        borderRadius: "10px",
                        bgcolor: createOpen
                          ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.12 : 0.08)
                          : "transparent",
                      })}
                    >
                      <PlusIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                <Stack
                  className="overview-workspace-config-menu-list"
                  spacing={0.25}
                  sx={{ overflow: "auto", minHeight: 0, flex: 1 }}
                >
                  {orderedProjectWorkspaces.map((workspace) => {
                    const group = groups.find((item) => item.key === workspace.key);
                    const isEditing = workspace.key === editingWorkspaceKey;
                    return (
                      <Box
                        key={workspace.key}
                        className={`overview-workspace-config-item${isEditing ? " is-editing" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isEditing}
                        onClick={() => void selectWorkspaceConfig(workspace.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void selectWorkspaceConfig(workspace.key);
                          }
                        }}
                      >
                        <Stack
                          className="overview-workspace-config-item-row"
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={1}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.85} minWidth={0} flex={1}>
                            <span
                              className={`overview-workspace-config-item-icon${
                                isEditing ? " is-active" : ""
                              }`}
                              aria-hidden="true"
                            >
                              {workspace.system ? (
                                <WebsiteIcon fontSize="small" />
                              ) : (
                                <FolderIcon fontSize="small" />
                              )}
                            </span>
                            <Stack
                              className="overview-workspace-config-item-copy"
                              spacing={0.18}
                              minWidth={0}
                            >
                              <Stack
                                className="overview-workspace-config-item-name-row"
                                direction="row"
                                spacing={0.45}
                                alignItems="center"
                                minWidth={0}
                              >
                                <Typography
                                  className="overview-workspace-config-item-title"
                                  variant="body2"
                                  noWrap
                                  title={workspace.name}
                                >
                                  {workspace.name}
                                </Typography>
                              </Stack>
                              <Typography
                                className="overview-workspace-config-item-meta"
                                variant="caption"
                                noWrap
                                title={
                                  workspace.system
                                    ? "全部项目"
                                    : `${workspace.projectScopeLabel} · ${workspace.navigationScopeLabel}`
                                }
                              >
                                {workspace.system
                                  ? "全部项目"
                                  : `${workspace.projectScopeLabel} · ${workspace.navigationScopeLabel}`}
                              </Typography>
                            </Stack>
                          </Stack>
                          <Stack direction="row" spacing={0.45} alignItems="center" flex="0 0 auto">
                            <Chip
                              className="overview-workspace-config-count-chip"
                              size="small"
                              label={group?.actionCount ?? 0}
                            />
                            {!workspace.system ? (
                              <Tooltip title="删除工作区配置">
                                <IconButton
                                  className="overview-workspace-config-delete"
                                  size="small"
                                  aria-label={`删除工作区配置 ${workspace.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void deleteWorkspaceConfig(workspace.key, workspace.name);
                                  }}
                                  onKeyDown={(event) => {
                                    event.stopPropagation();
                                  }}
                                >
                                  <TrashIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Box>
                    );
                  })}
                  <AppListEndState className="overview-workspace-config-list-end" />
                </Stack>
              </Stack>

              <Stack
                className="overview-workspace-config-main"
                spacing={0.95}
                sx={{ minHeight: 0, overflow: "auto", p: 1.05 }}
              >
                {createOpen ? (
                  <Box
                    component="section"
                    className="overview-workspace-config-card overview-workspace-config-create-card"
                    sx={panelSx}
                  >
                    <Stack spacing={0.85} sx={{ p: 0.9 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                        <Stack spacing={0.05}>
                          <Typography variant="caption" sx={{ fontWeight: 850 }}>
                            新建工作区
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {createWorkspaceMode === "demand" ? "需求初始化" : "名称与目录"}
                          </Typography>
                        </Stack>
                        <Tooltip title="收起">
                          <IconButton onClick={() => setCreateOpen(false)} aria-label="收起新建工作区">
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={0.6}
                        sx={{
                          p: 0.35,
                          borderRadius: 2,
                          border: (theme) => `1px solid ${theme.palette.divider}`,
                          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.64),
                        }}
                      >
                        <Button
                          size="small"
                          variant={createWorkspaceMode === "basic" ? "contained" : "text"}
                          onClick={() => setCreateWorkspaceMode("basic")}
                          disabled={creatingWorkspace}
                          sx={{ flex: 1 }}
                        >
                          普通
                        </Button>
                        <Button
                          size="small"
                          variant={createWorkspaceMode === "demand" ? "contained" : "text"}
                          onClick={() => {
                            setCreateWorkspaceMode("demand");
                            if (newWorkspaceType === DEFAULT_NEW_WORKSPACE_TYPE) {
                              setNewWorkspaceType("business");
                            }
                          }}
                          disabled={creatingWorkspace}
                          sx={{ flex: 1 }}
                        >
                          需求
                        </Button>
                      </Stack>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", md: "1fr 0.8fr" },
                          gap: 0.75,
                        }}
                      >
                        <TextField
                          size="small"
                          label="名称"
                          value={newWorkspaceName}
                          onChange={(event) => setNewWorkspaceName(event.target.value)}
                          disabled={creatingWorkspace}
                        />
                        <TextField
                          size="small"
                          label="key"
                          value={newWorkspaceKey}
                          placeholder={normalizeWorkspaceKey(newWorkspaceName) || "r-series"}
                          onChange={(event) => setNewWorkspaceKey(event.target.value)}
                          disabled={creatingWorkspace}
                        />
                        <TextField
                          size="small"
                          label="备注"
                          value={newWorkspaceDescription}
                          onChange={(event) => setNewWorkspaceDescription(event.target.value)}
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
                        {createWorkspaceMode === "demand" ? (
                          <>
                            <TextField
                              size="small"
                              label="需求号"
                              value={demandId}
                              placeholder="可选，如 CR2606150041"
                              onChange={(event) => setDemandId(event.target.value)}
                              disabled={creatingWorkspace}
                            />
                            <TextField
                              size="small"
                              label="分支"
                              value={demandBranch}
                              placeholder="feature-CR..."
                              onChange={(event) => setDemandBranch(event.target.value)}
                              disabled={creatingWorkspace}
                            />
                            <TextField
                              size="small"
                              label="需求目录"
                              value={demandRequirementDir}
                              onChange={(event) => setDemandRequirementDir(event.target.value)}
                              disabled={creatingWorkspace}
                              sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <Button
                                      size="small"
                                      onClick={() => void chooseDemandDirectory("requirement")}
                                      disabled={creatingWorkspace}
                                    >
                                      选择
                                    </Button>
                                  </InputAdornment>
                                ),
                              }}
                            />
                            <TextField
                              size="small"
                              label="项目目录"
                              value={demandRepoPath}
                              onChange={(event) => setDemandRepoPath(event.target.value)}
                              disabled={creatingWorkspace}
                              sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <Button
                                      size="small"
                                      onClick={() => void chooseDemandDirectory("repo")}
                                      disabled={creatingWorkspace}
                                    >
                                      选择
                                    </Button>
                                  </InputAdornment>
                                ),
                              }}
                            />
                            <TextField
                              size="small"
                              label="项目 key"
                              value={demandProjectKey}
                              placeholder="可选，自动匹配失败时填写"
                              onChange={(event) => setDemandProjectKey(event.target.value)}
                              disabled={creatingWorkspace}
                              sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                            />
                          </>
                        ) : null}
                        <FormControlLabel
                          sx={{ m: 0, whiteSpace: "nowrap" }}
                          control={
                            <Checkbox
                              size="small"
                              checked={newWorkspaceIndependentDir}
                              onChange={(event) =>
                                setNewWorkspaceIndependentDir(event.target.checked)
                              }
                              disabled={creatingWorkspace}
                            />
                          }
                          label="独立目录"
                        />
                        {newWorkspaceIndependentDir ? (
                          <TextField
                            size="small"
                            label="工作区目录"
                            value={newWorkspaceRootDir}
                            placeholder="默认：~/Documents/rdevtool-workspaces/<key>"
                            onChange={(event) => setNewWorkspaceRootDir(event.target.value)}
                            disabled={creatingWorkspace}
                            sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                          />
                        ) : null}
                      </Box>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                        {createWorkspaceMode === "basic" ? (
                          <FormControlLabel
                            sx={{ m: 0, whiteSpace: "nowrap" }}
                            control={
                              <Checkbox
                                size="small"
                                checked={copyCurrentWorkspace}
                                onChange={(event) => setCopyCurrentWorkspace(event.target.checked)}
                                disabled={creatingWorkspace}
                              />
                            }
                            label="复制当前配置"
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            自动匹配项目并挂载需求目录
                          </Typography>
                        )}
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={
                            creatingWorkspace ? (
                              <CircularProgress size={14} />
                            ) : (
                              <CheckIcon fontSize="small" />
                            )
                          }
                          onClick={() =>
                            void (createWorkspaceMode === "demand"
                              ? createDemandWorkspace()
                              : createWorkspace())
                          }
                          disabled={
                            creatingWorkspace ||
                            !newWorkspaceName.trim() ||
                            (createWorkspaceMode === "demand" &&
                              (!demandRequirementDir.trim() || !demandRepoPath.trim()))
                          }
                        >
                          {createWorkspaceMode === "demand" ? "初始化" : "创建"}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                ) : null}

                {!createOpen ? (
                <Box
                  component="section"
                  className="overview-workspace-config-card overview-workspace-config-detail-card"
                  sx={panelSx}
                >
                  <Stack spacing={0.95} sx={{ p: 1 }}>
                    <Stack
                      direction="row"
                      justifyContent="flex-end"
                      alignItems="center"
                      spacing={0.75}
                    >
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={`${selectedProjects}/${projectTotal} 项目`} />
                        <Chip size="small" label={`${selectedNavigation}/${navigationTotal} 入口`} />
                        <Chip size="small" label={`${selectedProxyProfiles}/${proxyTotal} 代理`} />
                        {workspaceDraft && workspaceDraft.projectInstances.length > 0 ? (
                          <Chip size="small" label={`${workspaceDraft.projectInstances.length} 实例`} />
                        ) : null}
                      </Stack>
                    </Stack>

                    {workspaceLoading && !workspaceDraft ? (
                      <Box sx={{ minHeight: 160, display: "grid", placeItems: "center" }}>
                        <CircularProgress size={20} thickness={5} />
                      </Box>
                    ) : null}

                    {workspaceDraft?.system ? (
                      <Stack spacing={0.9}>
                        <Alert severity="info" variant="outlined" sx={{ borderRadius: "12px" }}>
                          全局工作区始终包含全部项目、入口和代理，以下内容仅供查看。
                        </Alert>
                        <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<PlusIcon fontSize="small" />}
                            onClick={() => setCreateOpen(true)}
                          >
                            新建可配置工作区
                          </Button>
                          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                            或从左侧选择非全局工作区来配置项目、入口和代理范围。
                          </Typography>
                        </Stack>
                      </Stack>
                    ) : null}

                    {workspaceDraft ? (
                      <>
                        {!workspaceScopeReadOnly ? (
                          <>
                            <Stack direction={{ xs: "column", md: "row" }} spacing={0.75}>
                              <TextField
                                size="small"
                                label="名称"
                                value={workspaceDraft.name}
                                onChange={(event) => updateDraft({ name: event.target.value })}
                                disabled={workspaceSaving}
                                sx={{ flex: 1 }}
                              />
                              <Box sx={{ flex: 0.8, minWidth: 0 }}>
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
                                  onDelete={handleRemoveWorkspaceType}
                                />
                              </Box>
                              <TextField
                                size="small"
                                label="备注"
                                value={workspaceDraft.description ?? ""}
                                onChange={(event) => updateDraft({ description: event.target.value })}
                                disabled={workspaceSaving}
                                sx={{ flex: 1.4 }}
                              />
                            </Stack>
                            <TextField
                              className="overview-workspace-root-field"
                              size="small"
                              label="工作区目录"
                              value={workspaceDraft.rootDir ?? ""}
                              placeholder="可选：独立工作目录"
                              onChange={(event) => updateDraft({ rootDir: event.target.value })}
                              disabled={workspaceSaving}
                              InputProps={{
                                startAdornment: (
                                  <InputAdornment position="start">
                                    <FolderIcon fontSize="small" />
                                  </InputAdornment>
                                ),
                                endAdornment: workspaceDraft.rootDir ? (
                                  <InputAdornment position="end">
                                    <Tooltip title="复制工作区目录">
                                      <IconButton
                                        size="small"
                                        aria-label="复制工作区目录"
                                        onClick={() =>
                                          void copyPlainText(workspaceDraft.rootDir ?? "")
                                        }
                                        disabled={workspaceSaving}
                                      >
                                        <CopyIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  </InputAdornment>
                                ) : undefined,
                              }}
                            />
                          </>
                        ) : null}
                        <Stack className="overview-workspace-project-dir-list" spacing={0.65}>
                          <Stack direction="row" spacing={0.5} alignItems="baseline">
                            <Typography variant="caption" color="text.secondary">
                              项目目录
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              全局目录 / 工作区副本 / 绑定目录
                            </Typography>
                          </Stack>
                          {scopedWorkspaceProjects.length > 0 ? (
                            scopedWorkspaceProjects.map((project) => {
                              const instance = workspaceInstanceByProject.get(project.key);
                              const modeLabel = instance
                                ? instance.managed
                                  ? "工作区副本"
                                  : "绑定目录"
                                : "使用全局目录";
                              const path = instance?.path || project.repoPath || "未配置目录";
                              const busy = workspaceDirectoryBusy === project.key;
                              return (
                                <Box
                                  key={project.key}
                                  className="overview-workspace-project-dir-row"
                                  sx={(theme) => ({
                                    display: "grid",
                                    gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
                                    gap: 0.75,
                                    alignItems: "center",
                                    border: "1px solid",
                                    borderColor:
                                      theme.palette.mode === "dark"
                                        ? "rgba(143,184,234,0.09)"
                                        : "rgba(15,23,42,0.09)",
                                    borderRadius: "12px",
                                    px: 1,
                                    py: 0.72,
                                    bgcolor:
                                      theme.palette.mode === "dark"
                                        ? "rgba(255,255,255,0.016)"
                                        : "rgba(255,255,255,0.62)",
                                    boxShadow:
                                      theme.palette.mode === "dark"
                                        ? "inset 0 1px 0 rgba(255,255,255,0.018)"
                                        : "inset 0 1px 0 rgba(255,255,255,0.7)",
                                  })}
                                >
                                  <Stack spacing={0.15} minWidth={0}>
                                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                                      <Typography variant="subtitle2" noWrap>
                                        {project.name || project.key}
                                      </Typography>
                                      <Chip size="small" label={modeLabel} variant="outlined" />
                                      {instance?.managed ? (
                                        <Chip size="small" label="托管" variant="outlined" />
                                      ) : null}
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary" noWrap>
                                      {path}
                                    </Typography>
                                  </Stack>
                                  {!workspaceScopeReadOnly ? (
                                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                      {instance ? (
                                        <Button
                                          size="small"
                                          variant="outlined"
                                          sx={directoryActionButtonSx}
                                          onClick={() => void unbindWorkspaceProjectDirectory(project.key)}
                                          disabled={workspaceSaving || Boolean(workspaceDirectoryBusy)}
                                        >
                                          {busy ? "处理中" : "解绑"}
                                        </Button>
                                      ) : (
                                        <>
                                          <Button
                                            size="small"
                                            variant="outlined"
                                            sx={directoryActionButtonSx}
                                            onClick={() => void createWorkspaceProjectCopy(project.key)}
                                            disabled={
                                              workspaceSaving ||
                                              Boolean(workspaceDirectoryBusy) ||
                                              !workspaceDraft.rootDir ||
                                              !project.repoPath
                                            }
                                          >
                                            {busy ? "创建中" : "创建副本"}
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="outlined"
                                            sx={directoryActionButtonSx}
                                            onClick={() => void bindWorkspaceProjectDirectory(project.key)}
                                            disabled={workspaceSaving || Boolean(workspaceDirectoryBusy)}
                                          >
                                            绑定目录
                                          </Button>
                                        </>
                                      )}
                                    </Stack>
                                  ) : null}
                                </Box>
                              );
                            })
                          ) : (
                            <AppEmptyState
                              compact
                              title="暂无项目目录"
                              description="先选择项目，再配置目录。"
                            />
                          )}
                        </Stack>

                        <Stack spacing={0.8}>
                          <ScopePane
                            title="项目"
                            hint={`${selectedProjects}/${projectTotal}`}
                            expanded={expandedWorkspaceScope === "projects"}
                            onToggle={() =>
                              setExpandedWorkspaceScope((current) =>
                                current === "projects" ? "navigation" : "projects",
                              )
                            }
                            checked={workspaceScopeReadOnly ? true : workspaceDraft.includeAllProjects}
                            onCheckedChange={(checked) =>
                              updateDraft({
                                includeAllProjects: checked,
                                projects: checked ? [] : workspaceDraft.projects,
                              })
                            }
                            disabled={workspaceSaving || workspaceScopeReadOnly}
                          >
                            {expandedWorkspaceScope === "projects" &&
                            (workspaceScopeReadOnly || !workspaceDraft.includeAllProjects) ? (
                              <CheckList>
                                {workspaceEditor?.projects.map((project) => {
                                  const checked =
                                    workspaceScopeReadOnly ||
                                    workspaceDraft.projects.includes(project.key);
                                  return (
                                    <FormControlLabel
                                      key={project.key}
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
                                          disabled={workspaceSaving || workspaceScopeReadOnly}
                                        />
                                      }
                                      label={`${project.name || project.key} · ${project.category}`}
                                    />
                                  );
                                })}
                              </CheckList>
                            ) : null}
                          </ScopePane>

                          <ScopePane
                            title="入口"
                            hint={`${selectedNavigation}/${navigationTotal}`}
                            expanded={expandedWorkspaceScope === "navigation"}
                            onToggle={() =>
                              setExpandedWorkspaceScope((current) =>
                                current === "navigation" ? "projects" : "navigation",
                              )
                            }
                            checked={workspaceScopeReadOnly ? true : workspaceDraft.includeAllNavigation}
                            onCheckedChange={(checked) =>
                              updateDraft({
                                includeAllNavigation: checked,
                                navigationCategories: checked ? [] : workspaceDraft.navigationCategories,
                                navigationEntries: checked ? [] : workspaceDraft.navigationEntries,
                              })
                            }
                            disabled={workspaceSaving || workspaceScopeReadOnly}
                          >
                            {expandedWorkspaceScope === "navigation" &&
                            (workspaceScopeReadOnly || !workspaceDraft.includeAllNavigation) ? (
                              <CheckList>
                                {workspaceEditor?.navigationCategories.map((category) => {
                                  const categoryChecked =
                                    workspaceScopeReadOnly ||
                                    workspaceDraft.navigationCategories.includes(category.title);
                                  return (
                                    <Box key={category.title}>
                                      <FormControlLabel
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
                                            disabled={workspaceSaving || workspaceScopeReadOnly}
                                          />
                                        }
                                        label={category.title}
                                      />
                                      {workspaceScopeReadOnly || !categoryChecked
                                        ? category.entries.map((entry) => {
                                            const checked =
                                              workspaceScopeReadOnly ||
                                              workspaceDraft.navigationEntries.includes(
                                                entry.scopedName,
                                              ) ||
                                              workspaceDraft.navigationEntries.includes(entry.name);
                                            return (
                                              <FormControlLabel
                                                key={entry.scopedName}
                                                sx={{ pl: 2 }}
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
                                                    disabled={workspaceSaving || workspaceScopeReadOnly}
                                                  />
                                                }
                                                label={`${entry.name} · ${navigationEntryKindLabel(
                                                  entry.kind,
                                                )}`}
                                              />
                                            );
                                          })
                                        : null}
                                    </Box>
                                  );
                                })}
                              </CheckList>
                            ) : null}
                          </ScopePane>

                          <ScopePane
                            title="代理"
                            hint={`${selectedProxyProfiles}/${proxyTotal}`}
                            expanded={expandedWorkspaceScope === "proxy"}
                            onToggle={() =>
                              setExpandedWorkspaceScope((current) =>
                                current === "proxy" ? "projects" : "proxy",
                              )
                            }
                          >
                            {expandedWorkspaceScope === "proxy" ? (
                              <CheckList maxHeight={150}>
                                {workspaceEditor?.proxyProfiles.length ? (
                                  workspaceEditor.proxyProfiles.map((profile) => {
                                    const checked =
                                      workspaceScopeReadOnly ||
                                      workspaceDraft.proxyProfiles.includes(profile.id);
                                    const endpoint = `${profile.listenHost}:${profile.listenPort}`;
                                    return (
                                      <FormControlLabel
                                        key={profile.id}
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
                                            disabled={workspaceSaving || workspaceScopeReadOnly}
                                          />
                                        }
                                        label={`${profile.name} · ${endpoint}`}
                                      />
                                    );
                                  })
                                ) : (
                                  <AppEmptyState
                                    compact
                                    title="暂无代理配置"
                                    description="添加代理后可纳入工作区。"
                                  />
                                )}
                              </CheckList>
                            ) : null}
                          </ScopePane>
                        </Stack>
                      </>
                    ) : null}
                  </Stack>
                </Box>
                ) : null}
              </Stack>
            </Box>
          </DialogContent>

          <DialogActions className="overview-workspace-config-actions">
            <Box sx={{ flex: 1 }} />
            <Button onClick={closeManageDialog}>取消</Button>
            <Button
              variant="contained"
              startIcon={workspaceSaving ? <CircularProgress size={14} /> : <CheckIcon fontSize="small" />}
              onClick={() => void saveWorkspaceEditor()}
              disabled={!workspaceDraft || workspaceDraft.system || workspaceSaving || !workspaceDirty}
            >
              保存
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Box>
  );
}

function ScopePane({
  title,
  hint,
  expanded,
  onToggle,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  title: string;
  hint: string;
  expanded: boolean;
  onToggle: () => void;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Box
      className="overview-workspace-scope-pane"
      sx={(theme) => ({
        border: "1px solid",
        borderColor:
          theme.palette.mode === "dark" ? "rgba(143,184,234,0.1)" : "rgba(15,23,42,0.09)",
        borderRadius: "12px",
        overflow: "hidden",
        bgcolor:
          theme.palette.mode === "dark" ? "rgba(255,255,255,0.018)" : "rgba(255,255,255,0.66)",
      })}
    >
      <Stack
        className="overview-workspace-scope-head"
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ px: 0.85, py: 0.62, borderBottom: children ? "1px solid" : 0, borderColor: "divider" }}
      >
        <Stack direction="row" alignItems="center" spacing={0.55}>
          <Typography variant="caption" sx={{ fontWeight: 820 }}>
            {title}
          </Typography>
          <Typography className="overview-workspace-scope-hint" variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Stack>
        {typeof checked === "boolean" && onCheckedChange ? (
          <Stack direction="row" spacing={0.2} alignItems="center">
            <FormControlLabel
              className="overview-workspace-scope-all"
              sx={{ m: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={checked}
                  onChange={(event) => onCheckedChange(event.target.checked)}
                  disabled={disabled}
                />
              }
              label="全部"
            />
            <Tooltip title={expanded ? "收起" : "展开"}>
              <IconButton
                className="overview-workspace-scope-toggle"
                size="small"
                aria-label={`${expanded ? "收起" : "展开"}${title}`}
                aria-expanded={expanded}
                onClick={onToggle}
              >
                {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          <Tooltip title={expanded ? "收起" : "展开"}>
            <IconButton
              className="overview-workspace-scope-toggle"
              size="small"
              aria-label={`${expanded ? "收起" : "展开"}${title}`}
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {children}
    </Box>
  );
}

function CheckList({
  children,
  maxHeight = 190,
}: {
  children: ReactNode;
  maxHeight?: number;
}) {
  return (
    <Box
      className="overview-workspace-check-list"
      sx={{
        display: "grid",
        gap: 0.15,
        maxHeight,
        overflow: "auto",
        px: 0.75,
        py: 0.55,
        "& .MuiFormControlLabel-root": {
          m: 0,
          minWidth: 0,
          borderRadius: "8px",
          px: 0.25,
        },
        "& .MuiFormControlLabel-label": {
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.78rem",
          fontWeight: 680,
        },
      }}
    >
      {children}
    </Box>
  );
}
