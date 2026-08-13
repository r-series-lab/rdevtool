import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  Menu,
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
  ProjectManagementOpenRequest,
  ProjectManagementViewKey,
  ProjectRuntimeEntry,
  ProjectRuntimeStartPromptMode,
  ProjectWorkspaceDirectoryInspection,
  ProjectWorkspaceEditorDraft,
  ProjectWorkspaceEditorState,
  ProjectWorkspaceState,
  ProjectWorkspaceSummary,
  WorkspaceConfigFocusRequest,
} from "../app-types";
import {
  CheckIcon,
  CollapseIcon,
  ClearIcon,
  CopyIcon,
  ExpandIcon,
  ActionIcon,
  AppWindowIcon,
  FolderIcon,
  LocateIcon,
  MoreIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  ReplayIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon,
  StopIcon,
  WebsiteIcon,
  WorkflowIcon,
} from "../components/AppIcons";
import { WorkspaceConfigSidebar } from "../components/WorkspaceConfigSidebar";
import {
  WorkspaceWorkflowPanel,
  type WorkspaceWorkflowActionOption,
} from "../components/WorkspaceWorkflowPanel";
import {
  WorkspaceProjectRuntimeRow,
  type WorkspaceProjectDirectoryItem,
} from "../components/WorkspaceProjectRuntimeRow";
import type { WorkspaceRuntimePreflightAction } from "../lib/workspaceRuntimePreflightActions";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppListEndState } from "../components/AppListEndState";
import {
  LinkPlanDialog,
  type LinkPlanDialogAction,
  type LinkPlanDialogState,
} from "../components/LinkPlanDialog";
import {
  ResourceActionDialog,
  type ResourceActionDialogTarget,
} from "../components/ResourceActionDialog";
import { AppToast } from "../components/AppToast";
import { WorkspaceTypeSelect } from "../components/WorkspaceTypeSelect";
import {
  WorkspacePageToolbar,
  WorkspacePageToolbarAction,
} from "../components/WorkspacePageToolbar";
import { useWorkspaceTypeOptions } from "../hooks/useWorkspaceTypeOptions";
import { useConfirmationPreferences } from "../hooks/useConfirmationPreferences";
import { useWorkspaceLifecycle } from "../hooks/useWorkspaceLifecycle";
import { useWorkspaceOverviewData } from "../hooks/useWorkspaceOverviewData";
import { useWorkspaceProjectInstanceStatuses } from "../hooks/useWorkspaceProjectInstanceStatuses";
import { useProjectRuntimeStartDialog } from "../hooks/useProjectRuntimeStartDialog";
import { requestOpenManagedArtifacts } from "../components/settingsEvents";
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
  missingDirectoryCountLabel,
  workspaceDisplayName,
  workspaceLinkToolSummary,
  workspaceSummaryCountLabel,
} from "../lib/workspacePresentation";
import {
  isWorkspaceWorkflowActionSupported,
  type WorkspaceWorkflowChain,
  type WorkspaceWorkflowRunState,
} from "../lib/workflowChains";
import type { ActivityRecorder, ActivityUpdater } from "../lib/activityCenter";
import {
  linkActivityDraft,
  linkActivityFailurePatch,
  linkActivityResultPatch,
  linkExecutionStepBlocks,
} from "../lib/linkActivities";
import { translateInternalMessage } from "../i18n/internalMessages";
import {
  DEFAULT_NEW_WORKSPACE_TYPE,
  normalizeWorkspaceType,
  workspaceTypeCountOptions,
  workspaceTypeLabel,
  workspaceTypeOptionsWithValues,
} from "../lib/workspaceTypes";
import { configSourceIdForWorkspace } from "../lib/configSources";
import {
  resolveWorkspaceOverviewScope,
  workspaceActionPreview,
} from "../lib/workspaceOverviewSync";
import { localizedResourceActionText } from "../lib/resourceActions";
import {
  confirmationEnabled,
  confirmationPreferenceKeyForTrayAction,
} from "../lib/confirmationPreferences";
import { useI18n, type Translate } from "../i18n";

export type OverviewPageProps = {
  projectWorkspaces: ProjectWorkspaceSummary[];
  archivedProjectWorkspaces: ProjectWorkspaceSummary[];
  activeProjectWorkspaceKey: string;
  onProjectWorkspaceChange: (workspaceKey: string) => Promise<void> | void;
  onNavigateToPage: (page: OverviewNavigationPage) => void;
  onProjectManagementViewChange: (view: ProjectManagementViewKey) => void;
  onProjectChange: (projectKey: string) => void;
  onOpenProjectManagementTarget: (
    projectKey: string,
    target: ProjectManagementOpenRequest["target"],
  ) => void;
  onCreateProjectWorkspace: (
    payload: CreateProjectWorkspacePayload,
  ) => Promise<void> | void;
  onInitDemandWorkspace: (
    payload: InitDemandWorkspacePayload,
  ) => Promise<InitDemandWorkspaceResult> | InitDemandWorkspaceResult;
  onProjectConfigSaved: () => Promise<void> | void;
  workspaceConfigOpenSignal?: number;
  workspaceConfigFocusRequest?: WorkspaceConfigFocusRequest | null;
  onWorkspaceConfigOpenHandled?: (signal: number) => void;
  runtimeEntries: ProjectRuntimeEntry[];
  selectedDebugProfileKeys: Record<string, string>;
  runtimeStartPromptMode: ProjectRuntimeStartPromptMode;
  projectRuntimePreferencesHydrated: boolean;
  onProjectDebugProfileChange: (projectKey: string, profileKey: string) => void;
  onRuntimeStartPromptModeChange: (
    mode: ProjectRuntimeStartPromptMode,
  ) => void;
  onStartProjectRuntime: (
    projectKey: string,
    debugProfileKey?: string,
    envOverrides?: Record<string, string>,
    expectedPort?: number | null,
  ) => Promise<unknown> | unknown;
  onStartProxyProfile: (
    profileId: string,
    sourceId?: string,
  ) => Promise<unknown> | unknown;
  onStopProxyProfile: (profileId: string) => Promise<unknown> | unknown;
  onFocusProjectRuntime: (projectKey: string) => Promise<unknown> | unknown;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
  onExecutePinnedAction: (action: TrayPinnedAction) => Promise<void>;
  workflowChains: WorkspaceWorkflowChain[];
  workflowRunStates: WorkspaceWorkflowRunState[];
  onSaveWorkflowChain: (chain: WorkspaceWorkflowChain) => Promise<void>;
  onDeleteWorkflowChain: (chainId: string) => Promise<void>;
  onWorkflowChainEnabledChange: (
    chainId: string,
    enabled: boolean,
  ) => Promise<void>;
  onRunWorkflowChain: (chain: WorkspaceWorkflowChain) => Promise<string>;
  onCancelWorkflowRun: (runId: string) => Promise<void>;
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

type OverviewModuleKey =
  | "resources"
  | "tools"
  | "projects"
  | "proxy"
  | "workflow"
  | "build"
  | "git"
  | "other"
  | "workspaces";

type OverviewSectionCollapse = {
  collapsed: boolean;
  onToggle: () => void;
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
  occurredAt?: string | null;
  isLatest?: boolean;
  isPinned?: boolean;
  sourceWorkspaceKey?: string;
  sourceWorkspaceName?: string;
};

type WorkspacePinnedActionsOverview = {
  key: string;
  name: string;
  description?: string | null;
  system: boolean;
  runtimeConfigSourceId: string;
  runtimeConfigSourceName: string;
  runtimeConfigSourceKind: string;
  runtimeConfigPath?: string | null;
  runtimeProfileScope: string;
  rootDir?: string | null;
  resourceDir?: string | null;
  worklogPath?: string | null;
  worklogExists: boolean;
  worklogAutoRecord: boolean;
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
  workspaceKey: string;
  configSourceId: string;
  toolConfigSourceId?: string | null;
  toolProxySourceId?: string | null;
  toolRuntimeSourceId?: string | null;
  category: string;
  label: string;
  kind: string;
  kindLabel: string;
  value?: string | null;
  detail?: string | null;
  note?: string | null;
  tool?: string | null;
  toolKey?: string | null;
  toolAction?: string | null;
  linkRuntime?: LinkRuntimeSummary | null;
  openKind?: "url" | "localPath" | string | null;
  openable: boolean;
};

function resourceActionResourceName(
  resource: WorkspaceResourceShortcutItem,
  t: Translate,
) {
  const actionKey = resource.toolKey?.trim();
  return actionKey
    ? localizedResourceActionText(actionKey, "name", resource.label, t)
    : resource.label;
}

function legacyResourceActionNote(resource: WorkspaceResourceShortcutItem) {
  const detail = resource.detail?.trim() ?? "";
  if (!detail) {
    return "";
  }
  const prefix = [
    resource.tool ? `工具 ${resource.tool}` : "",
    resource.toolKey?.trim() ?? "",
    resource.toolAction ? `动作 ${resource.toolAction}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (detail === prefix) {
    return "";
  }
  return prefix && detail.startsWith(`${prefix} · `)
    ? detail.slice(prefix.length + 3)
    : detail;
}

function resourceActionResourceDetail(
  resource: WorkspaceResourceShortcutItem,
  t: Translate,
) {
  const actionKey = resource.toolKey?.trim() ?? "";
  const note = resource.note?.trim() || legacyResourceActionNote(resource);
  const localizedNote = note
    ? actionKey
      ? localizedResourceActionText(actionKey, "resourceNote", note, t)
      : note
    : "";
  return [
    resource.tool ? t("工具 {tool}", { tool: resource.tool }) : "",
    actionKey,
    resource.toolAction
      ? t("动作 {action}", { action: resource.toolAction })
      : "",
    localizedNote,
  ]
    .filter(Boolean)
    .join(" · ");
}

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

const COLLAPSED_WORKSPACES_STORAGE_KEY =
  "rdevtool:overview:collapsed-workspaces";
const COLLAPSED_WORKSPACES_DEFAULTED_KEY =
  "rdevtool:overview:collapsed-workspaces:v4-global-index-expanded";
const COLLAPSED_WORKSPACE_MODULES_STORAGE_KEY =
  "rdevtool:overview:collapsed-workspace-modules:v1";
const SYSTEM_WORKSPACE_KEY = "system";

const NAVIGATION_ENTRY_KIND_LABELS: Record<string, string> = {
  url: "网站",
  directory: "目录",
  app: "应用",
  script: "脚本",
  tool: "工具",
};

function defaultCollapsedWorkspaceKeys() {
  return new Set<string>();
}

function readCollapsedWorkspaceKeys() {
  if (typeof window === "undefined") {
    return defaultCollapsedWorkspaceKeys();
  }
  try {
    const stored = window.localStorage.getItem(
      COLLAPSED_WORKSPACES_STORAGE_KEY,
    );
    const values = stored ? JSON.parse(stored) : [];
    const keys = new Set<string>(
      Array.isArray(values)
        ? values.filter((value) => typeof value === "string")
        : [],
    );
    if (!window.localStorage.getItem(COLLAPSED_WORKSPACES_DEFAULTED_KEY)) {
      keys.delete(SYSTEM_WORKSPACE_KEY);
      window.localStorage.setItem(
        COLLAPSED_WORKSPACES_STORAGE_KEY,
        JSON.stringify([...keys]),
      );
      window.localStorage.setItem(COLLAPSED_WORKSPACES_DEFAULTED_KEY, "1");
    }
    return keys;
  } catch {
    return defaultCollapsedWorkspaceKeys();
  }
}

function workspaceModuleStorageKey(
  workspaceKey: string,
  moduleKey: OverviewModuleKey,
) {
  return `${workspaceKey}:${moduleKey}`;
}

function readCollapsedWorkspaceModuleKeys() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }
  try {
    const stored = window.localStorage.getItem(
      COLLAPSED_WORKSPACE_MODULES_STORAGE_KEY,
    );
    if (stored) {
      const values = JSON.parse(stored);
      return new Set<string>(
        Array.isArray(values)
          ? values.filter((value) => typeof value === "string")
          : [],
      );
    }
  } catch {
    // Ignore malformed local state and use the responsive defaults below.
  }
  if (window.matchMedia("(max-width: 720px)").matches) {
    return new Set(
      ([
        "tools",
        "proxy",
        "workflow",
        "build",
        "git",
        "other",
      ] as OverviewModuleKey[]).map((moduleKey) =>
        workspaceModuleStorageKey(SYSTEM_WORKSPACE_KEY, moduleKey),
      ),
    );
  }
  return new Set<string>();
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

function formatActionUpdatedAt(item: WorkspacePinnedActionItem) {
  const occurredAt = item.occurredAt?.trim();
  if (occurredAt) {
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(
      occurredAt,
    )
      ? `${occurredAt.replace(" ", "T")}${occurredAt.length === 16 ? ":00" : ""}Z`
      : occurredAt;
    const timestamp = Date.parse(normalized);
    if (Number.isFinite(timestamp)) {
      return formatUpdatedAt(timestamp);
    }
  }
  return formatUpdatedAt(item.updatedAtMs);
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

function actionGroupKind(
  item: WorkspacePinnedActionItem,
): "build" | "git" | "other" {
  const kind = item.action.kind.toLowerCase();
  if (
    item.kindLabel === "构建" ||
    kind === "build.replay" ||
    kind === "deploy.replay" ||
    kind.startsWith("project.build.")
  ) {
    return "build";
  }
  if (
    item.kindLabel === "分支" ||
    kind === "branch.replay" ||
    kind.startsWith("git.")
  ) {
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
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
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
    (item) =>
      typeof item === "string" && item.trim().toLowerCase().includes(needle),
  );
}

function workspaceSearchValuesForField(
  group: WorkspacePinnedActionsOverview,
  field: string,
) {
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
      ? textIncludes(
          workspaceSearchValuesForField(group, token.field),
          token.value,
        )
      : text.includes(token.value),
  );
}

function overviewEntityMatchesQuery(
  query: string,
  valuesByField: Partial<
    Record<
      "key" | "type" | "project" | "entry" | "proxy" | "action" | "path",
      Array<string | null | undefined>
    >
  >,
) {
  const tokens = parseOverviewQuery(query);
  if (tokens.length === 0) {
    return true;
  }
  const allValues = Object.values(valuesByField).flat();
  return tokens.every((token) =>
    token.field
      ? textIncludes(
          valuesByField[token.field as keyof typeof valuesByField] ?? [],
          token.value,
        )
      : textIncludes(allValues, token.value),
  );
}

function workspaceStateItems(
  group: WorkspacePinnedActionsOverview,
  active: boolean,
): WorkspaceStateItem[] {
  const missingDirectories = group.projectDirectories.filter(
    (directory) => !directory.path,
  ).length;
  const items: WorkspaceStateItem[] = [];
  if (active) {
    items.push({ label: "当前", tone: "active" });
  }
  if (
    group.entryCount === 0 &&
    group.projectCount === 0 &&
    group.proxyProfileCount === 0
  ) {
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

function workspaceStateItemLabel(
  item: WorkspaceStateItem,
  language: "zh-CN" | "en-US",
  t: (message: string, params?: Record<string, string | number>) => string,
) {
  const missingDirectoriesMatch = item.label.match(/^(\d+)\s+目录待配$/);
  if (missingDirectoriesMatch) {
    return missingDirectoryCountLabel(
      language,
      Number(missingDirectoriesMatch[1]),
    );
  }
  return t(item.label);
}

function navigationEntryKindLabel(kind: string) {
  return NAVIGATION_ENTRY_KIND_LABELS[kind] ?? "入口";
}

function shortcutIcon(kind: string) {
  switch (kind) {
    case "directory":
      return <FolderIcon fontSize="small" />;
    case "file":
      return <LocateIcon fontSize="small" />;
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
    bgcolor: isDark
      ? "rgba(255,255,255,0.018)"
      : "color-mix(in srgb, var(--side-pane-control) 28%, transparent)",
    fontWeight: 780,
    boxShadow: isDark
      ? "none"
      : "inset 0 1px 0 color-mix(in srgb, #ffffff 28%, transparent)",
    "&:hover": {
      color: "var(--text)",
      borderColor: alpha(theme.palette.primary.main, isDark ? 0.24 : 0.32),
      bgcolor: alpha(theme.palette.primary.main, isDark ? 0.1 : 0.07),
    },
    "&.Mui-disabled": {
      borderColor: isDark
        ? "rgba(255,255,255,0.045)"
        : "color-mix(in srgb, var(--line-soft) 62%, transparent)",
      color: theme.palette.text.disabled,
      bgcolor: isDark
        ? "rgba(255,255,255,0.01)"
        : "color-mix(in srgb, var(--panel-strong) 40%, transparent)",
    },
  };
}

export function OverviewPage({
  projectWorkspaces,
  archivedProjectWorkspaces,
  activeProjectWorkspaceKey,
  onProjectWorkspaceChange,
  onNavigateToPage,
  onProjectManagementViewChange,
  onProjectChange,
  onOpenProjectManagementTarget,
  onCreateProjectWorkspace,
  onInitDemandWorkspace,
  onProjectConfigSaved,
  workspaceConfigOpenSignal,
  workspaceConfigFocusRequest,
  onWorkspaceConfigOpenHandled,
  runtimeEntries,
  selectedDebugProfileKeys,
  runtimeStartPromptMode,
  projectRuntimePreferencesHydrated,
  onProjectDebugProfileChange,
  onRuntimeStartPromptModeChange,
  onStartProjectRuntime,
  onStartProxyProfile,
  onStopProxyProfile,
  onFocusProjectRuntime,
  recordActivity,
  updateActivity,
  onExecutePinnedAction,
  workflowChains,
  workflowRunStates,
  onSaveWorkflowChain,
  onDeleteWorkflowChain,
  onWorkflowChainEnabledChange,
  onRunWorkflowChain,
  onCancelWorkflowRun,
}: OverviewPageProps) {
  const { language, t } = useI18n();
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceDirectoryBusy, setWorkspaceDirectoryBusy] = useState("");
  const [collapsedWorkspaceKeys, setCollapsedWorkspaceKeys] = useState<
    Set<string>
  >(() => readCollapsedWorkspaceKeys());
  const [collapsedWorkspaceModuleKeys, setCollapsedWorkspaceModuleKeys] =
    useState<Set<string>>(() => readCollapsedWorkspaceModuleKeys());
  const searchCollapsedWorkspaceModuleKeysRef = useRef<Set<string> | null>(
    null,
  );
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedWorkspaceScope, setExpandedWorkspaceScope] = useState<
    "projects" | "navigation" | "proxy"
  >("projects");
  const [createWorkspaceMode, setCreateWorkspaceMode] = useState<
    "basic" | "demand"
  >("basic");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceKey, setNewWorkspaceKey] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [newWorkspaceType, setNewWorkspaceType] = useState(
    DEFAULT_NEW_WORKSPACE_TYPE,
  );
  const [newWorkspaceIndependentDir, setNewWorkspaceIndependentDir] =
    useState(false);
  const [newWorkspaceRootDir, setNewWorkspaceRootDir] = useState("");
  const [newWorkspaceResourceDir, setNewWorkspaceResourceDir] = useState("");
  const [createWorkspaceWorklog, setCreateWorkspaceWorklog] = useState(true);
  const [autoRecordWorkspaceWorklog, setAutoRecordWorkspaceWorklog] =
    useState(true);
  const [copyCurrentWorkspace, setCopyCurrentWorkspace] = useState(false);
  const [demandId, setDemandId] = useState("");
  const [demandRequirementDir, setDemandRequirementDir] = useState("");
  const [demandRepoPath, setDemandRepoPath] = useState("");
  const [demandBranch, setDemandBranch] = useState("");
  const [demandProjectKey, setDemandProjectKey] = useState("");
  const [reuseDemandDependencies, setReuseDemandDependencies] = useState(true);
  const [error, setErrorValue] = useState("");
  const [status, setStatusValue] = useState("");
  const [toastNonce, setToastNonce] = useState(0);
  const [runningKey, setRunningKey] = useState("");
  const [openingWorkspaceKey, setOpeningWorkspaceKey] = useState("");
  const [workspaceIndexMenu, setWorkspaceIndexMenu] = useState<{
    anchorEl: HTMLElement;
    group: WorkspacePinnedActionsOverview;
  } | null>(null);
  const [workspaceModuleMenu, setWorkspaceModuleMenu] = useState<{
    anchorEl: HTMLElement;
    workspaceKey: string;
    moduleKeys: OverviewModuleKey[];
  } | null>(null);
  const [runningChainId, setRunningChainId] = useState("");
  const [aiContextOpen, setAiContextOpen] = useState(false);
  const [aiContextGroup, setAiContextGroup] =
    useState<WorkspacePinnedActionsOverview | null>(null);
  const [aiContextResponse, setAiContextResponse] =
    useState<WorkspaceAiContextResponse | null>(null);
  const [aiContextLoading, setAiContextLoading] = useState(false);
  const [linkPlanDialog, setLinkPlanDialog] =
    useState<LinkPlanDialogState | null>(null);
  const [resourceActionDialog, setResourceActionDialog] =
    useState<ResourceActionDialogTarget | null>(null);
  const [aiContextView, setAiContextView] = useState<"markdown" | "json">(
    "markdown",
  );
  const [aiContextPresets, setAiContextPresets] = useState<
    WorkspaceAiContextPreset[]
  >(BUILTIN_AI_CONTEXT_PRESETS);
  const [aiContextPresetKey, setAiContextPresetKey] = useState(
    BUILTIN_AI_CONTEXT_PRESETS[0].key,
  );
  const [aiContextPresetName, setAiContextPresetName] = useState("");
  const [aiContextOptions, setAiContextOptions] =
    useState<WorkspaceAiContextOptions>(DEFAULT_AI_CONTEXT_OPTIONS);
  const [overviewQuery, setOverviewQuery] = useState("");
  const [workspaceTypeFilter, setWorkspaceTypeFilter] = useState("all");
  const [expandedActionPanelKeys, setExpandedActionPanelKeys] = useState<
    Set<string>
  >(new Set());
  const {
    groups,
    loading,
    loadOverview,
    workspaceEditor,
    workspaceDraft,
    setWorkspaceDraft,
    workspaceLoading,
    loadProjectWorkspaceEditor,
    applyWorkspaceEditorState,
  } = useWorkspaceOverviewData<WorkspacePinnedActionsOverview>({
    activeWorkspaceKey: activeProjectWorkspaceKey,
    editorOpen: manageOpen,
    onError: setError,
  });
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const { preferences: confirmationPreferences } = useConfirmationPreferences();
  const {
    options: workspaceTypeOptions,
    addWorkspaceType,
    removeWorkspaceType,
  } = useWorkspaceTypeOptions();
  const workspaceLifecycle = useWorkspaceLifecycle({
    onChanged: onProjectConfigSaved,
    setError,
    setStatus,
  });
  const runtimeEntryByProjectKey = useMemo(
    () => new Map(runtimeEntries.map((entry) => [entry.key, entry])),
    [runtimeEntries],
  );
  const runtimeStartLauncher = useProjectRuntimeStartDialog({
    promptMode: runtimeStartPromptMode,
    selectedDebugProfileKeys,
    onSetDefaultProfile: onProjectDebugProfileChange,
    onPromptModeChange: onRuntimeStartPromptModeChange,
    onStart: async (
      projectKey,
      debugProfileKey,
      _envOverrides,
      expectedPort,
    ) => {
      const group = groups.find(
        (item) => item.key === activeProjectWorkspaceKey,
      );
      const directory = group?.projectDirectories.find(
        (item) => item.projectKey === projectKey,
      );
      if (!group || !directory) {
        setError("当前工作区中未找到要启动的项目");
        return false;
      }
      return toggleWorkspaceProject(
        group,
        directory,
        debugProfileKey,
        expectedPort ?? undefined,
      );
    },
  });

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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      COLLAPSED_WORKSPACE_MODULES_STORAGE_KEY,
      JSON.stringify(Array.from(collapsedWorkspaceModuleKeys)),
    );
  }, [collapsedWorkspaceModuleKeys]);

  useEffect(() => {
    const queryActive = overviewQuery.trim().length > 0;
    if (queryActive) {
      if (!searchCollapsedWorkspaceModuleKeysRef.current) {
        searchCollapsedWorkspaceModuleKeysRef.current = new Set(
          collapsedWorkspaceModuleKeys,
        );
      }
      setCollapsedWorkspaceModuleKeys((current) => {
        const next = new Set(current);
        let changed = false;
        for (const key of next) {
          if (key.startsWith(`${SYSTEM_WORKSPACE_KEY}:`)) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : current;
      });
      return;
    }
    const previous = searchCollapsedWorkspaceModuleKeysRef.current;
    if (previous) {
      searchCollapsedWorkspaceModuleKeysRef.current = null;
      setCollapsedWorkspaceModuleKeys(previous);
    }
  }, [overviewQuery]);

  useEffect(() => {
    if (
      !activeProjectWorkspaceKey ||
      activeProjectWorkspaceKey === SYSTEM_WORKSPACE_KEY
    ) {
      return;
    }
    setCollapsedWorkspaceKeys((current) => {
      if (!current.has(activeProjectWorkspaceKey)) {
        return current;
      }
      const next = new Set(current);
      next.delete(activeProjectWorkspaceKey);
      return next;
    });
  }, [activeProjectWorkspaceKey]);

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

  function isWorkspaceModuleCollapsed(
    workspaceKey: string,
    moduleKey: OverviewModuleKey,
  ) {
    return collapsedWorkspaceModuleKeys.has(
      workspaceModuleStorageKey(workspaceKey, moduleKey),
    );
  }

  function toggleWorkspaceModuleCollapsed(
    workspaceKey: string,
    moduleKey: OverviewModuleKey,
  ) {
    const storageKey = workspaceModuleStorageKey(workspaceKey, moduleKey);
    setCollapsedWorkspaceModuleKeys((current) => {
      const next = new Set(current);
      if (next.has(storageKey)) {
        next.delete(storageKey);
      } else {
        next.add(storageKey);
      }
      return next;
    });
  }

  function setWorkspaceModulesCollapsed(
    workspaceKey: string,
    moduleKeys: OverviewModuleKey[],
    collapsed: boolean,
  ) {
    setCollapsedWorkspaceModuleKeys((current) => {
      const next = new Set(current);
      for (const moduleKey of moduleKeys) {
        const storageKey = workspaceModuleStorageKey(workspaceKey, moduleKey);
        if (collapsed) {
          next.add(storageKey);
        } else {
          next.delete(storageKey);
        }
      }
      return next;
    });
  }

  const overviewScope = useMemo(
    () => resolveWorkspaceOverviewScope(groups, activeProjectWorkspaceKey),
    [activeProjectWorkspaceKey, groups],
  );
  const activeGroup = overviewScope.activeGroup;
  const isSystemWorkspaceActive = overviewScope.systemScope;
  const workspaceIndexGroups = overviewScope.workspaceIndexGroups;
  const activeOverviewGroup = useMemo(() => {
    if (!activeGroup?.system) {
      return activeGroup;
    }

    const focusedGroups = groups.filter((group) => !group.system);
    const uniqueBy = <T,>(items: T[], keyFor: (item: T) => string) => {
      const unique = new Map<string, T>();
      for (const item of items) {
        const key = keyFor(item);
        if (key && !unique.has(key)) {
          unique.set(key, item);
        }
      }
      return Array.from(unique.values());
    };
    const resources = uniqueBy(
      [...activeGroup.resources, ...focusedGroups.flatMap((group) => group.resources)],
      (resource) => resource.key,
    );
    const projectDirectories = uniqueBy(
      [
        ...activeGroup.projectDirectories,
        ...focusedGroups.flatMap((group) => group.projectDirectories),
      ],
      (directory) => directory.projectKey,
    );
    const proxyProfiles = uniqueBy(
      [
        ...activeGroup.proxyProfiles,
        ...focusedGroups.flatMap((group) => group.proxyProfiles),
      ],
      (profile) => `${profile.id}:${profile.listenUrl}`,
    );
    const actions = uniqueBy(
      [
        ...focusedGroups.flatMap((group) =>
          group.actions.map((item) => ({
            ...item,
            sourceWorkspaceKey: group.key,
            sourceWorkspaceName: workspaceDisplayName(group, t),
          })),
        ),
        ...activeGroup.actions.map((item) => ({
          ...item,
          sourceWorkspaceKey: activeGroup.key,
          sourceWorkspaceName: workspaceDisplayName(activeGroup, t),
        })),
      ],
      (item) => item.action.dedupeKey,
    );

    return {
      ...activeGroup,
      resources,
      projectDirectories,
      proxyProfiles,
      actions,
      actionCount: Math.max(activeGroup.actionCount, actions.length),
      proxyProfileCount: Math.max(
        activeGroup.proxyProfileCount,
        proxyProfiles.length,
      ),
    };
  }, [activeGroup, groups, t]);
  const editingWorkspaceKey =
    workspaceDraft?.key ??
    workspaceEditor?.workspace.key ??
    activeProjectWorkspaceKey;
  const editingWorkspaceSummary = useMemo(
    () =>
      projectWorkspaces.find(
        (workspace) => workspace.key === editingWorkspaceKey,
      ) ??
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
    () => workspaceTypeCountOptions(workspaceIndexGroups, workspaceTypeOptions),
    [workspaceIndexGroups, workspaceTypeOptions],
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
  const filteredWorkspaceIndexGroups = useMemo(
    () =>
      systemWorkspaceThenCurrent(
        workspaceIndexGroups.filter(
          (group) =>
            (workspaceTypeFilter === "all" ||
              normalizeWorkspaceType(group.workspaceType) ===
                workspaceTypeFilter) &&
            workspaceMatchesOverviewQuery(group, overviewQuery),
        ),
        activeProjectWorkspaceKey,
      ),
    [
      workspaceIndexGroups,
      activeProjectWorkspaceKey,
      workspaceTypeFilter,
      overviewQuery,
    ],
  );
  const orderedProjectWorkspaces = useMemo(
    () =>
      systemWorkspaceThenCurrent(projectWorkspaces, activeProjectWorkspaceKey),
    [activeProjectWorkspaceKey, projectWorkspaces],
  );
  const workspaceActionCounts = useMemo(
    () =>
      Object.fromEntries(
        groups.map((group) => [group.key, group.actionCount] as const),
      ),
    [groups],
  );
  const aiContextJsonText = useMemo(
    () =>
      aiContextResponse ? JSON.stringify(aiContextResponse.json, null, 2) : "",
    [aiContextResponse],
  );
  const aiContextPreviewText =
    aiContextView === "json"
      ? aiContextJsonText
      : (aiContextResponse?.markdown ?? "");
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
    JSON.stringify(workspaceDraft) !==
      JSON.stringify(workspaceEditor.workspace),
  );

  const projectTotal = workspaceEditor?.projects.length ?? 0;
  const entryTotal =
    workspaceEditor?.navigationCategories.reduce(
      (total, category) => total + category.entries.length,
      0,
    ) ?? 0;
  const navigationTotal =
    (workspaceEditor?.navigationCategories.length ?? 0) + entryTotal;
  const proxyTotal = workspaceEditor?.proxyProfiles.length ?? 0;
  const selectedProjects = workspaceDraft
    ? workspaceDraft.system
      ? projectTotal
      : selectedCount(
          workspaceDraft.projects,
          projectTotal,
          workspaceDraft.includeAllProjects,
        )
    : 0;
  const selectedNavigation = workspaceDraft
    ? workspaceDraft.system
      ? navigationTotal
      : selectedCount(
          [
            ...workspaceDraft.navigationCategories,
            ...workspaceDraft.navigationEntries,
          ],
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
        (workspaceDraft?.projectInstances ?? []).map((instance) => [
          instance.project,
          instance,
        ]),
      ),
    [workspaceDraft?.projectInstances],
  );
  const workspaceInstanceStatuses = useWorkspaceProjectInstanceStatuses({
    enabled: manageOpen && Boolean(workspaceDraft),
    workspaceKey: workspaceDraft?.key ?? "",
    instances: workspaceDraft?.projectInstances ?? [],
  });
  const scopedWorkspaceProjects = useMemo(
    () =>
      (workspaceEditor?.projects ?? []).filter(
        (project) =>
          workspaceDraft?.includeAllProjects ||
          workspaceDraft?.projects.includes(project.key),
      ),
    [
      workspaceDraft?.includeAllProjects,
      workspaceDraft?.projects,
      workspaceEditor?.projects,
    ],
  );

  useEffect(() => {
    const signal = workspaceConfigOpenSignal ?? 0;
    if (signal <= 0) {
      return;
    }
    setManageOpen(true);
    onWorkspaceConfigOpenHandled?.(signal);
  }, [
    onWorkspaceConfigOpenHandled,
    workspaceConfigOpenSignal,
  ]);

  async function executeAction(item: WorkspacePinnedActionItem) {
    const preferenceKey = confirmationPreferenceKeyForTrayAction(
      item.action.kind,
    );
    if (preferenceKey || item.confirmRequired) {
      const confirmed = await confirm({
        title: t("确认运行"),
        description: t("确认运行“{label}”？", { label: item.label }),
        confirmLabel: t("运行"),
        preferenceKey: preferenceKey ?? undefined,
      });
      if (!confirmed) {
        return;
      }
    }

    setRunningKey(item.action.dedupeKey);
    setError("");
    try {
      await onExecutePinnedAction(item.action);
      await loadOverview({ silent: true });
      setStatus(t("已运行 {label}", { label: item.label }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function runWorkflowChain(chain: WorkspaceWorkflowChain) {
    const confirmed = await confirm({
      title: t("运行“{name}”", { name: chain.name }),
      description: chain.steps.map((step) => step.label).join(" → "),
      confirmLabel: t("开始运行"),
    });
    if (!confirmed) {
      return;
    }

    setRunningChainId(chain.id);
    setError("");
    try {
      await onRunWorkflowChain(chain);
      setStatus(t("已启动联动操作：{name}", { name: chain.name }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningChainId("");
    }
  }

  async function cancelWorkflowRun(run: WorkspaceWorkflowRunState) {
    const confirmed = await confirm({
      title: t("停止后续联动"),
      description: t("将阻止尚未开始的后续步骤。当前已经启动的任务会继续执行。"),
      confirmLabel: t("停止后续步骤"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setError("");
    try {
      await onCancelWorkflowRun(run.runId);
      setStatus(t("已停止后续联动步骤"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function deleteWorkflowChain(chainId: string) {
    const chain = workflowChains.find((item) => item.id === chainId);
    const confirmed = await confirm({
      title: t("删除联动流程"),
      description: t("确认删除“{name}”？已标记的原始动作不会被删除。", {
        name: chain?.name || t("此联动流程"),
      }),
      confirmLabel: t("删除"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setError("");
    try {
      await onDeleteWorkflowChain(chainId);
      setStatus(t("联动流程已删除"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function setWorkflowChainEnabled(
    chainId: string,
    enabled: boolean,
  ) {
    setError("");
    try {
      await onWorkflowChainEnabledChange(chainId, enabled);
      setStatus(t(enabled ? "联动流程已启用" : "联动流程已停用"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function openWorkbenchTarget(
    kind: string,
    value: string,
    label: string,
  ) {
    if (!kind || !value) {
      return;
    }
    await invoke("open_external_resource", { kind, value });
    setStatus(t("已打开 {label}", { label }));
  }

  async function openWorkspaceResource(
    resource: WorkspaceResourceShortcutItem,
  ) {
    if (!resource.openable || !resource.openKind || !resource.value) {
      return;
    }
    const key = `resource:${resource.key}`;
    setRunningKey(key);
    setError("");
    try {
      await openWorkbenchTarget(
        resource.openKind,
        resource.value,
        resource.label,
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  function isLinkToolResource(resource: WorkspaceResourceShortcutItem) {
    return (
      resource.kind === "tool" &&
      (resource.tool ?? "link").toLowerCase() === "link"
    );
  }

  function isActionToolResource(resource: WorkspaceResourceShortcutItem) {
    return (
      resource.kind === "tool" &&
      resource.tool?.toLowerCase() === "action"
    );
  }

  function toolSourceIdForResource(
    resource?: WorkspaceResourceShortcutItem | null,
  ) {
    return (
      resource?.toolConfigSourceId ||
      configSourceIdForWorkspace(
        resource?.workspaceKey || activeProjectWorkspaceKey,
      )
    );
  }

  function linkRuntimeAction(
    resource: WorkspaceResourceShortcutItem,
  ): "run" | "stop" {
    const runtime = resource.linkRuntime;
    return runtime?.canStop &&
      runtime.status !== "stopped" &&
      runtime.status !== "planned"
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

  async function openWorkspaceLinkPlan(
    resource: WorkspaceResourceShortcutItem,
  ) {
    const key = (resource.toolKey || resource.value || "").trim();
    const sourceId = toolSourceIdForResource(resource);
    const proxySourceId = resource.toolProxySourceId ?? null;
    const runtimeSourceId = resource.toolRuntimeSourceId ?? null;
    const workspaceKey = resource.workspaceKey;
    if (!key) {
      setLinkPlanDialog({
        entryName: resource.label,
        key: "",
        sourceId,
        proxySourceId,
        runtimeSourceId,
        workspaceKey,
        plan: null,
        report: null,
        runtime: resource.linkRuntime ?? null,
        loading: false,
        action: null,
        error: t("缺少 Link Key"),
      });
      return;
    }
    setLinkPlanDialog({
      entryName: resource.label,
      key,
      sourceId,
      proxySourceId,
      runtimeSourceId,
      workspaceKey,
      plan: null,
      report: null,
      runtime: resource.linkRuntime ?? null,
      loading: true,
      action: null,
      error: "",
    });
    try {
      const plan = await invoke<LinkPlan>("plan_link", {
        sourceId,
        proxySourceId,
        runtimeSourceId,
        workspaceKey,
        key,
      });
      setLinkPlanDialog({
        entryName: resource.label,
        key,
        sourceId: plan.sourceContext?.linkSourceId || sourceId,
        proxySourceId: plan.sourceContext?.proxySourceId || proxySourceId,
        runtimeSourceId: plan.sourceContext?.runtimeSourceId || runtimeSourceId,
        workspaceKey,
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
        proxySourceId,
        runtimeSourceId,
        workspaceKey,
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
      action === "check"
        ? "check_link"
        : action === "run"
          ? "run_link"
          : "stop_link";
    const sourceId =
      linkPlanDialog?.sourceId ??
      configSourceIdForWorkspace(activeProjectWorkspaceKey);
    const proxySourceId = linkPlanDialog?.proxySourceId ?? null;
    const runtimeSourceId = linkPlanDialog?.runtimeSourceId ?? null;
    const workspaceKey =
      linkPlanDialog?.workspaceKey ?? activeProjectWorkspaceKey;
    const linkName = linkPlanDialog?.entryName.trim() || key;
    const activityId =
      action === "check"
        ? ""
        : (recordActivity?.(
            linkActivityDraft(key, linkName, action, sourceId),
          ) ?? "");
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
      const report = await invoke<LinkExecutionReport>(
        command,
        action === "check"
          ? { sourceId, proxySourceId, runtimeSourceId, workspaceKey, key }
          : {
              sourceId,
              proxySourceId,
              runtimeSourceId,
              workspaceKey,
              key,
              activityId: activityId || null,
              operationOrigin: "app",
            },
      );
      if (activityId && action !== "check") {
        updateActivity?.(
          activityId,
          linkActivityResultPatch(
            report,
            action,
            sourceId,
            workspaceKey,
            proxySourceId,
            runtimeSourceId,
          ),
        );
      }
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
      if (activityId && action !== "check") {
        updateActivity?.(
          activityId,
          linkActivityFailurePatch(
            key,
            linkName,
            action,
            sourceId,
            reason,
            workspaceKey,
            proxySourceId,
            runtimeSourceId,
          ),
        );
      }
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
    const sourceId = toolSourceIdForResource(resource);
    const proxySourceId = resource.toolProxySourceId ?? null;
    const runtimeSourceId = resource.toolRuntimeSourceId ?? null;
    if (!key) {
      setError(t("缺少 Link Key"));
      return;
    }
    const actionLabel = t(action === "stop" ? "停止" : "启动");
    const command = action === "stop" ? "stop_link" : "run_link";
    const activityId =
      recordActivity?.(
        linkActivityDraft(key, resource.label, action, sourceId),
      ) ?? "";

    setRunningKey(`tool:${resource.key}`);
    setError("");
    setStatus("");

    try {
      const report = await invoke<LinkExecutionReport>(command, {
        sourceId,
        proxySourceId,
        runtimeSourceId,
        workspaceKey: resource.workspaceKey,
        key,
        activityId: activityId || null,
        operationOrigin: "app",
      });
      if (activityId) {
        updateActivity?.(
          activityId,
          linkActivityResultPatch(
            report,
            action,
            sourceId,
            resource.workspaceKey,
            proxySourceId,
            runtimeSourceId,
          ),
        );
      }
      const blockingStep = report.steps.find(linkExecutionStepBlocks);
      if (blockingStep) {
        setError(
          t("{label} {action}失败：{reason}", {
            label: translateInternalMessage(blockingStep.label, t),
            action: actionLabel,
            reason: translateInternalMessage(blockingStep.summary, t),
          }),
        );
      } else {
        setStatus(t("已{action}：{label}", {
          action: actionLabel,
          label: resource.label,
        }));
      }
      try {
        await loadOverview();
      } catch (refreshReason) {
        setError(t("已{action}，但刷新状态失败：{reason}", {
          action: actionLabel,
          reason: String(refreshReason),
        }));
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(
          activityId,
          linkActivityFailurePatch(
            key,
            resource.label,
            action,
            sourceId,
            reason,
            resource.workspaceKey,
            proxySourceId,
            runtimeSourceId,
          ),
        );
      }
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  function openWorkspaceAction(resource: WorkspaceResourceShortcutItem) {
    const key = (resource.toolKey || resource.value || "").trim();
    if (!key) {
      return;
    }
    setResourceActionDialog({
      key,
      sourceId: toolSourceIdForResource(resource),
      entryName: resource.label,
      mode: resource.toolAction === "inspect" ? "inspect" : "run",
    });
  }

  async function openWorkspaceRootDirectory(
    group: WorkspacePinnedActionsOverview,
  ) {
    if (!group.rootDir) {
      return;
    }
    const key = `root:${group.key}`;
    setRunningKey(key);
    setError("");
    try {
      await openWorkbenchTarget("localPath", group.rootDir, t("工作区目录"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunningKey("");
    }
  }

  async function toggleWorkspaceProject(
    group: WorkspacePinnedActionsOverview,
    directory: WorkspaceProjectDirectoryItem,
    debugProfileKey?: string,
    expectedPort?: number,
  ) {
    if (group.key !== activeProjectWorkspaceKey) {
      setError(t("请先切换到该工作区再操作项目"));
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
        setStatus(t("已停止 {name}", {
          name: directory.projectName || projectKey,
        }));
      } else {
        const started = await onStartProjectRuntime(
          projectKey,
          debugProfileKey === undefined
            ? selectedDebugProfileKeys[projectKey] || ""
            : debugProfileKey,
          undefined,
          expectedPort,
        );
        if (started === false) {
          return false;
        }
      }
      await loadOverview();
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      setRunningKey("");
    }
  }

  async function focusWorkspaceProjectRuntime(
    group: WorkspacePinnedActionsOverview,
    directory: WorkspaceProjectDirectoryItem,
  ) {
    if (group.key !== activeProjectWorkspaceKey) {
      setError(t("请先切换到该工作区再打开项目"));
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
      setStatus(t("已打开 {label}", {
        label: directory.projectName || projectKey,
      }));
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
        setStatus(t("已停止 {name}", { name: profile.name }));
      } else {
        await onStartProxyProfile(profile.id);
        setStatus(t("已启动 {name}", { name: profile.name }));
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
      const response = await invoke<WorkspaceAiContextResponse>(
        "get_workspace_ai_context",
        {
          workspaceKey: group.key,
          options,
        },
      );
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

  async function updateAiContextOptions(
    patch: Partial<WorkspaceAiContextOptions>,
  ) {
    const nextOptions = { ...aiContextOptions, ...patch };
    setAiContextOptions(nextOptions);
    if (aiContextOpen && aiContextGroup) {
      await loadWorkspaceAiContext(aiContextGroup, nextOptions);
    }
  }

  async function applyAiContextPreset(presetKey: string) {
    const preset =
      aiContextPresets.find((item) => item.key === presetKey) ??
      BUILTIN_AI_CONTEXT_PRESETS[0];
    setAiContextPresetKey(preset.key);
    setAiContextPresetName("");
    setAiContextOptions(preset.options);
    if (aiContextOpen && aiContextGroup) {
      await loadWorkspaceAiContext(aiContextGroup, preset.options);
    }
  }

  async function persistAiContextCustomPresets(
    nextPresets: WorkspaceAiContextPreset[],
  ) {
    const merged = await persistAiContextTemplatePresets(nextPresets);
    setAiContextPresets(merged);
    return merged;
  }

  async function saveAiContextPreset() {
    const currentPreset =
      aiContextPresets.find((preset) => preset.key === aiContextPresetKey) ??
      BUILTIN_AI_CONTEXT_PRESETS[0];
    const label =
      aiContextPresetName.trim() ||
      (currentPreset.custom ? currentPreset.label : "");
    if (!label) {
      setError(t("请填写场景名"));
      return;
    }
    const nextPreset: WorkspaceAiContextPreset = {
      key: currentPreset.custom
        ? currentPreset.key
        : normalizeAiContextPresetKey(label),
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
    setStatus(t("已保存场景 {name}", { name: nextPreset.label }));
  }

  async function deleteAiContextPreset() {
    const currentPreset = aiContextPresets.find(
      (preset) => preset.key === aiContextPresetKey,
    );
    if (!currentPreset?.custom) {
      return;
    }
    const nextPresets = aiContextPresets.filter(
      (preset) => preset.custom && preset.key !== currentPreset.key,
    );
    await persistAiContextCustomPresets(nextPresets);
    await applyAiContextPreset(BUILTIN_AI_CONTEXT_PRESETS[0].key);
    setStatus(t("已删除场景 {name}", { name: currentPreset.label }));
  }

  async function copyAiContext(format: "markdown" | "json") {
    if (!aiContextResponse) {
      return;
    }
    try {
      await copyPlainText(
        format === "json" ? aiContextJsonText : aiContextResponse.markdown,
      );
      setStatus(
        t("已复制 {name} {format} 上下文", {
          name: aiContextResponse.workspaceName || aiContextGroup?.name || t("工作区"),
          format: format === "json" ? "JSON" : "Markdown",
        }),
      );
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function selectWorkspaceConfig(workspaceKey: string) {
    const currentEditingKey =
      workspaceDraft?.key ?? workspaceEditor?.workspace.key ?? "";
    if (!workspaceKey || workspaceKey === currentEditingKey) {
      if (createOpen) {
        setCreateOpen(false);
      }
      return;
    }
    const workspaceName =
      projectWorkspaces.find((workspace) => workspace.key === workspaceKey)
        ?.name ?? workspaceKey;
    if (workspaceDirty) {
      const confirmed = await confirm({
        title: t("切换配置对象"),
        description: t("当前配置有未保存修改，查看“{name}”会丢弃修改。", {
          name: workspaceName,
        }),
        confirmLabel: t("查看配置"),
        tone: "danger",
        preferenceKey: "configuration.discard",
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

  async function deleteWorkspaceConfig(
    workspaceKey: string,
    workspaceName: string,
  ) {
    if (!workspaceKey || workspaceKey === "system") {
      return;
    }
    const confirmed = await confirm({
      title: t("永久删除已归档工作区"),
      description: t("永久删除“{name}”的工作区配置。项目代码和资源目录不会被删除，但已绑定代理会解除归属；此操作不能通过“恢复工作区”撤销。", {
        name: workspaceName,
      }),
      confirmLabel: t("永久删除"),
      tone: "danger",
      preferenceKey: "destructive.delete",
    });
    if (!confirmed) {
      return;
    }

    const wasEditing = workspaceKey === editingWorkspaceKey;
    setError("");
    setStatus("");
    try {
      await invoke<ProjectWorkspaceState>("delete_project_workspace_config", {
        workspaceKey,
      });
      if (wasEditing) {
        setCreateOpen(false);
        await loadProjectWorkspaceEditor("system");
      }
      await onProjectConfigSaved();
      await loadOverview();
      setStatus(t("已删除工作区配置：{name}", { name: workspaceName }));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function createWorkspace() {
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
        rootDir: newWorkspaceIndependentDir
          ? newWorkspaceRootDir.trim() || null
          : null,
        resourceDir: newWorkspaceResourceDir.trim() || null,
        worklogFile: "WORKLOG.md",
        createWorklog: createWorkspaceWorklog,
        worklogAutoRecord: createWorkspaceWorklog && autoRecordWorkspaceWorklog,
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
      setNewWorkspaceResourceDir("");
      setCreateWorkspaceWorklog(true);
      setAutoRecordWorkspaceWorklog(true);
      setCopyCurrentWorkspace(false);
      setCreateOpen(false);
      await loadOverview();
      await loadProjectWorkspaceEditor(key);
      setStatus(t("已创建：{name}", { name }));
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
      setError(t("请填写工作区名称"));
      return;
    }
    if (!requirementDir) {
      setError(t("请填写需求目录"));
      return;
    }
    if (!repoPath) {
      setError(t("请填写项目目录"));
      return;
    }
    if (newWorkspaceIndependentDir && !demandBranch.trim()) {
      setError(t("独立需求工作区需要填写分支"));
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
        rootDir: newWorkspaceIndependentDir
          ? newWorkspaceRootDir.trim() || null
          : null,
        copyMode: newWorkspaceIndependentDir ? "worktree" : "existing",
        dependencyMode:
          newWorkspaceIndependentDir && reuseDemandDependencies
            ? "auto-link"
            : "none",
        resourceDir: newWorkspaceResourceDir.trim() || null,
        worklogFile: "WORKLOG.md",
        createWorklog: createWorkspaceWorklog,
        worklogAutoRecord: createWorkspaceWorklog && autoRecordWorkspaceWorklog,
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
      setDemandId("");
      setDemandRequirementDir("");
      setDemandRepoPath("");
      setDemandBranch("");
      setDemandProjectKey("");
      setReuseDemandDependencies(true);
      setCreateWorkspaceMode("basic");
      setCreateOpen(false);
      await loadOverview();
      await loadProjectWorkspaceEditor(result.key);
      const branchWarning =
        result.branch.expected && result.branch.matches === false
          ? t("，当前分支 {current} 与目标分支不一致", {
              current: result.branch.current || "-",
            })
          : "";
      setStatus(
        t("已初始化：{workspace} · {project}{warning}", {
          workspace: result.name,
          project: result.project.name,
          warning: branchWarning,
        }),
      );
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

  async function chooseWorkspaceResourceDirectory(
    target: "create" | "edit" = "create",
  ) {
    const currentResourceDir =
      target === "edit"
        ? (workspaceDraft?.resourceDir ?? "")
        : newWorkspaceResourceDir;
    const currentRootDir =
      target === "edit" ? (workspaceDraft?.rootDir ?? "") : newWorkspaceRootDir;
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath:
        currentResourceDir.trim() || currentRootDir.trim() || undefined,
    });
    if (typeof selected === "string" && selected.trim()) {
      if (target === "edit") {
        setWorkspaceDraft((current) =>
          current ? { ...current, resourceDir: selected } : current,
        );
      } else {
        setNewWorkspaceResourceDir(selected);
      }
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
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
      setStatus(t("已更新工作区 {name}", { name: nextState.workspace.name }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceSaving(false);
    }
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
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
      setStatus(t("已创建工作区副本"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceDirectoryBusy("");
    }
  }

  async function repairWorkspaceProjectInstance(projectKey: string) {
    if (!workspaceDraft || workspaceDraft.system) {
      return;
    }
    const instanceStatus = workspaceInstanceStatuses.byProject.get(projectKey);
    if (!instanceStatus?.repairSupported || !instanceStatus.repairBranch) {
      return;
    }
    const projectName =
      workspaceEditor?.projects.find((project) => project.key === projectKey)
        ?.name ?? projectKey;
    const confirmed = await confirm({
      title: t("修复 {name} 的工作区副本？", { name: projectName }),
      description: t(
        "将按 Git 登记在原路径 {path} 重建分支 {branch}。不会删除其他目录，也不会切换项目的全局目录。",
        {
          path: instanceStatus.path,
          branch: instanceStatus.repairBranch,
        },
      ),
      confirmLabel: t("修复"),
      tone: "warning",
    });
    if (!confirmed) {
      return;
    }
    setWorkspaceDirectoryBusy(projectKey);
    setError("");
    setStatus("");
    try {
      const nextState = await workspaceInstanceStatuses.repair(projectKey);
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await Promise.all([
        loadOverview(),
        workspaceInstanceStatuses.refresh(),
      ]);
      setStatus(t("已修复工作区副本"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceDirectoryBusy("");
    }
  }

  function inspectWorkspaceProjectInstanceCleanup(
    projectKey: string,
    path: string,
  ) {
    if (!workspaceDraft || workspaceDraft.system) {
      return;
    }
    setManageOpen(false);
    requestOpenManagedArtifacts({
      workspaceKey: workspaceDraft.key,
      projectKey,
      path,
      kind: "workspaceProjectInstance",
    });
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
      const inspection = await invoke<ProjectWorkspaceDirectoryInspection>(
        "inspect_project_workspace_project_directory",
        {
          workspaceKey: workspaceDraft.key,
          project: projectKey,
          path: selected,
        },
      );
      let allowRemoteMismatch = false;
      if (inspection.requiresRemoteMismatchConfirmation) {
        const projectName =
          workspaceEditor?.projects.find((project) => project.key === projectKey)
            ?.name ?? projectKey;
        const confirmed = await confirm({
          title: t("目录 Remote 不匹配，仍然绑定？"),
          description: t(
            "{name} 的项目配置与所选目录 Remote 不一致。继续后，Git、构建和运行操作都会使用该目录。",
            { name: projectName },
          ),
          confirmLabel: t("仍然绑定"),
          tone: "warning",
        });
        if (!confirmed) {
          return;
        }
        allowRemoteMismatch = true;
      }
      const nextState = await invoke<ProjectWorkspaceEditorState>(
        "bind_project_workspace_project_directory",
        {
          workspaceKey: workspaceDraft.key,
          project: projectKey,
          path: selected,
          allowRemoteMismatch,
        },
      );
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
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
    const instance = workspaceInstanceByProject.get(projectKey);
    const projectName =
      workspaceEditor?.projects.find((project) => project.key === projectKey)
        ?.name ?? projectKey;
    const confirmed = await confirm({
      title: t("解除 {name} 的项目实例关联？", { name: projectName }),
      description: instance?.managed
        ? t("只解除工作区关联，不会删除托管目录或其中的代码。")
        : t("解除后，该工作区将恢复使用项目的全局目录。"),
      confirmLabel: t("解除关联"),
      tone: "warning",
    });
    if (!confirmed) {
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
      applyWorkspaceEditorState(nextState);
      await onProjectConfigSaved();
      await loadOverview();
      setStatus(t("已恢复使用全局目录"));
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
      setStatus(t("已打开项目目录"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function runWorkspaceRuntimePreflightAction(
    group: WorkspacePinnedActionsOverview,
    directory: WorkspaceProjectDirectoryItem,
    action: WorkspaceRuntimePreflightAction,
  ) {
    if (action.target === "quickFix") {
      return;
    }
    setError("");
    setStatus("");
    try {
      if (group.key && group.key !== activeProjectWorkspaceKey) {
        await onProjectWorkspaceChange(group.key);
      }
      if (action.target === "projectDirectory") {
        if (directory.path?.trim()) {
          await openWorkspaceProjectDirectory(directory.path);
        } else {
          onOpenProjectManagementTarget(directory.projectKey, {
            kind: "projectSettings",
            section: "projectBasics",
          });
        }
        return;
      }
      if (action.target === "proxy") {
        onNavigateToPage("proxy");
        setStatus(t("已打开本地代理"));
        return;
      }
      if (action.target === "projectSettings") {
        onOpenProjectManagementTarget(directory.projectKey, {
          kind: "projectSettings",
          section: action.section,
        });
        setStatus(t("已打开 {name} 配置", { name: directory.projectName }));
        return;
      }
      onOpenProjectManagementTarget(directory.projectKey, {
        kind: "runtimePanel",
        tab: "config",
      });
      setStatus(t("已打开 {name} 运行配置", { name: directory.projectName }));
    } catch (reason) {
      setError(String(reason));
    }
  }

  function updateDraft(patch: Partial<ProjectWorkspaceEditorDraft>) {
    setWorkspaceDraft((current) =>
      current ? { ...current, ...patch } : current,
    );
  }

  async function handleCreateWorkspaceType(label: string) {
    try {
      const option = await addWorkspaceType(label);
      setStatus(t("已新增类型 {label}", { label: option.label }));
      return option;
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function handleRemoveWorkspaceType(optionKey: string, label: string) {
    const usedCount = workspaceTypeUsageCounts.get(optionKey) ?? 0;
    if (usedCount > 0) {
      setError(t("已有 {count} 个工作区使用 {label}", {
        count: usedCount,
        label,
      }));
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
      setStatus(t("已删除类型 {label}", { label }));
    } catch (reason) {
      setError(String(reason));
    }
  }

  function closeManageDialog() {
    setManageOpen(false);
    setCreateOpen(false);
  }

  const workspaceToolbarMetrics = isSystemWorkspaceActive
    ? [
        {
          key: "workspaces",
          label: t("工作区"),
          value: workspaceIndexGroups.length,
          icon: <PackageIcon fontSize="small" />,
          tone: "blue" as const,
        },
        {
          key: "projects",
          label: t("项目"),
          value: activeOverviewGroup?.projectCount ?? 0,
          icon: <AppWindowIcon fontSize="small" />,
          tone: "cyan" as const,
        },
        {
          key: "entries",
          label: t("入口"),
          value: activeOverviewGroup?.entryCount ?? 0,
          icon: <WebsiteIcon fontSize="small" />,
          tone: "green" as const,
        },
        {
          key: "proxies",
          label: t("本地代理"),
          value: activeOverviewGroup?.proxyProfileCount ?? 0,
          icon: <TerminalIcon fontSize="small" />,
          tone: "violet" as const,
        },
        {
          key: "actions",
          label: t("动作"),
          value: activeOverviewGroup?.actionCount ?? 0,
          icon: <WorkflowIcon fontSize="small" />,
          tone: "blue" as const,
        },
      ]
    : [
        {
          key: "projects",
          label: t("项目"),
          value: activeOverviewGroup?.projectCount ?? 0,
          icon: <PackageIcon fontSize="small" />,
          tone: "blue" as const,
        },
        {
          key: "entries",
          label: t("入口"),
          value: activeOverviewGroup?.entryCount ?? 0,
          icon: <WebsiteIcon fontSize="small" />,
          tone: "cyan" as const,
        },
        {
          key: "proxies",
          label: t("本地代理"),
          value: activeOverviewGroup?.proxyProfileCount ?? 0,
          icon: <TerminalIcon fontSize="small" />,
          tone: "green" as const,
        },
        {
          key: "actions",
          label: t("动作"),
          value: activeOverviewGroup?.actionCount ?? 0,
          icon: <WorkflowIcon fontSize="small" />,
          tone: "violet" as const,
        },
      ];

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
      setStatus(t("已打开 {label}", { label: target.label }));
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
        label: t("项目"),
        title: t("打开项目管理"),
        icon: <AppWindowIcon fontSize="small" />,
        onClick: () =>
          openWorkspaceModule(group, {
            page: "projectManagement",
            label: t("项目管理"),
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
        title: t("打开{label}", { label }),
        icon,
        onClick: () =>
          openWorkspaceModule(group, {
            page,
            label,
            projectManagementView,
            projectKey:
              page === "projectManagement"
                ? workspaceDefaultProjectKey(group)
                : null,
          }),
      },
    ];
  }

  function renderSectionHeading(
    title: string,
    actions: OverviewSectionQuickAction[] = [],
    count?: number,
    collapse?: OverviewSectionCollapse,
  ) {
    return (
      <div className="overview-section-heading">
        <div className="overview-section-heading-copy">
          <Typography className="overview-section-label">{title}</Typography>
          {typeof count === "number" ? (
            <Chip size="small" className="overview-count-chip" label={count} />
          ) : null}
        </div>
        {actions.length > 0 || collapse ? (
          <div
            className="overview-section-actions"
            aria-label={t("{title}快捷入口", { title })}
          >
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
            {collapse ? (
              <Tooltip title={t(collapse.collapsed ? "展开" : "收起")}>
                <IconButton
                  size="small"
                  className="overview-section-action-button overview-section-collapse-button"
                  onClick={collapse.onToggle}
                  aria-label={t(
                    collapse.collapsed ? "展开 {name}" : "收起 {name}",
                    { name: title },
                  )}
                  aria-expanded={!collapse.collapsed}
                >
                  {collapse.collapsed ? (
                    <ExpandIcon fontSize="small" />
                  ) : (
                    <CollapseIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderActionPanel(
    group: WorkspacePinnedActionsOverview,
    moduleKey: OverviewModuleKey,
    title: string,
    actions: WorkspacePinnedActionItem[],
    className = "",
    sectionActions: OverviewSectionQuickAction[] = [],
  ) {
    if (actions.length === 0) {
      return null;
    }
    const collapsed = isWorkspaceModuleCollapsed(group.key, moduleKey);
    const actionPanelKey = `${group.key}:${moduleKey}`;
    const recordsExpanded = expandedActionPanelKeys.has(actionPanelKey);
    const {
      items: visiblePanelActions,
      hiddenCount: hiddenActionCount,
      expandable: panelExpandable,
    } = workspaceActionPreview(actions, recordsExpanded);
    return (
      <div
        className={`overview-actions-panel${collapsed ? " is-collapsed" : ""} ${className}`.trim()}
        data-overview-module={moduleKey}
      >
        {renderSectionHeading(title, sectionActions, actions.length, {
          collapsed,
          onToggle: () =>
            toggleWorkspaceModuleCollapsed(group.key, moduleKey),
        })}
        {!collapsed ? <div className="overview-action-list">
          {visiblePanelActions.map((item) => {
            const running = runningKey === item.action.dedupeKey;
            const updatedAt = formatActionUpdatedAt(item);
            const displayKindLabel = translateInternalMessage(
              item.kindLabel,
              t,
            );
            const displayLabel = translateInternalMessage(item.label, t);
            const displayDetail = item.detail
              ? translateInternalMessage(item.detail, t)
              : "";
            const confirmationPreferenceKey =
              confirmationPreferenceKeyForTrayAction(item.action.kind);
            const actionNeedsConfirmation = confirmationPreferenceKey
              ? confirmationEnabled(
                  confirmationPreferences,
                  confirmationPreferenceKey,
                )
              : item.confirmRequired;
            const labelParams = actionLabelParams(item);
            const paramTag =
              labelParams.length > 0 ? (
                <Tooltip
                  arrow
                  placement="top-start"
                  title={
                    <Stack
                      className="overview-action-param-tooltip"
                      spacing={0.4}
                    >
                      {labelParams.map((param) => (
                        <span
                          key={`${item.action.dedupeKey}:${param.label}:${param.value}`}
                          className="overview-action-param-tooltip-row"
                        >
                          <b>{translateInternalMessage(param.label, t)}</b>
                          <span>{param.value}</span>
                        </span>
                      ))}
                    </Stack>
                  }
                >
                  <span className="overview-action-param-label" tabIndex={0}>
                    {t("参数 {count}", { count: labelParams.length })}
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
                      label={displayKindLabel}
                    />
                    {item.isLatest ? (
                      <span className="overview-action-origin is-latest">
                        {t("最近")}
                      </span>
                    ) : null}
                    {(item.isPinned ?? true) ? (
                      <span className="overview-action-origin is-pinned">
                        {t("已标记")}
                      </span>
                    ) : null}
                    {paramTag}
                    <Typography
                      className="overview-action-title"
                      noWrap
                      title={displayLabel}
                    >
                      {displayLabel}
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
                    {group.system && item.sourceWorkspaceName ? (
                      <Typography
                        component="span"
                        className="overview-action-workspace"
                        noWrap
                      >
                        {item.sourceWorkspaceName}
                      </Typography>
                    ) : null}
                    {displayDetail ? (
                      <Typography component="span" noWrap>
                        {displayDetail}
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
                  <Tooltip
                    title={
                      actionNeedsConfirmation ? t("确认后运行") : t("运行")
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        className="overview-action-run"
                        onClick={() => void executeAction(item)}
                        disabled={Boolean(runningKey)}
                        aria-label={t("运行 {label}", { label: item.label })}
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
          {panelExpandable ? (
            <Button
              size="small"
              variant="text"
              className="overview-action-more"
              startIcon={
                recordsExpanded ? (
                  <CollapseIcon fontSize="small" />
                ) : (
                  <ExpandIcon fontSize="small" />
                )
              }
              aria-expanded={recordsExpanded}
              onClick={() =>
                setExpandedActionPanelKeys((current) => {
                  const next = new Set(current);
                  if (recordsExpanded) {
                    next.delete(actionPanelKey);
                  } else {
                    next.add(actionPanelKey);
                  }
                  return next;
                })
              }
            >
              {recordsExpanded
                ? t("收起其余记录")
                : t("还有 {count} 条", { count: hiddenActionCount })}
            </Button>
          ) : null}
        </div> : null}
      </div>
    );
  }

  function renderWorkspaceCard(
    group: WorkspacePinnedActionsOverview,
    featured = false,
  ) {
    const active = group.key === activeProjectWorkspaceKey;
    const collapsed = collapsedWorkspaceKeys.has(group.key);
    const stateItems = workspaceStateItems(group, active);
    const filterGlobalItems = group.system && overviewQuery.trim().length > 0;
    const filteredResources = filterGlobalItems
      ? group.resources.filter((resource) =>
          overviewEntityMatchesQuery(overviewQuery, {
            key: [resource.key],
            entry: [
              resource.key,
              resource.workspaceKey,
              resource.category,
              resource.label,
              resource.kind,
              resource.kindLabel,
              resource.value,
              resource.detail,
              resource.toolKey,
            ],
            path:
              resource.kind === "directory"
                ? [resource.value, resource.detail]
                : [],
          }),
        )
      : group.resources;
    const visibleResources = filteredResources.filter(
      (resource) => resource.kind !== "tool",
    );
    const visibleTools = filteredResources.filter(
      (resource) => resource.kind === "tool",
    );
    const visibleDirectories = filterGlobalItems
      ? group.projectDirectories.filter((directory) =>
          overviewEntityMatchesQuery(overviewQuery, {
            key: [directory.projectKey],
            project: [
              directory.projectKey,
              directory.projectName,
              directory.mode,
              directory.modeLabel,
              directory.statusKey,
              directory.statusLabel,
              directory.path,
            ],
            path: [directory.path, directory.projectKey, directory.projectName],
          }),
        )
      : group.projectDirectories;
    const visibleProxyProfiles = filterGlobalItems
      ? group.proxyProfiles.filter((profile) =>
          overviewEntityMatchesQuery(overviewQuery, {
            key: [profile.id],
            proxy: [
              profile.id,
              profile.name,
              profile.listenHost,
              String(profile.listenPort),
              profile.listenUrl,
              profile.workspaceKey,
              profile.workspaceLabel,
              profile.running ? "运行中" : "未启动",
            ],
          }),
        )
      : group.proxyProfiles;
    const visibleActions = filterGlobalItems
      ? group.actions.filter((item) =>
          overviewEntityMatchesQuery(overviewQuery, {
            key: [item.action.dedupeKey],
            project: [item.projectKey, item.action.projectKey],
            action: [
              item.label,
              item.detail,
              item.kindLabel,
              item.projectKey,
              item.action.label,
              item.action.detail,
              item.action.projectKey,
              item.isLatest ? "最近" : "",
              (item.isPinned ?? true) ? "已标记" : "",
              item.sourceWorkspaceKey,
              item.sourceWorkspaceName,
              ...item.params.flatMap((param) => [param.label, param.value]),
            ],
          }),
        )
      : group.actions;
    const visibleBuildActions = visibleActions.filter(
      (item) => actionGroupKind(item) === "build",
    );
    const visibleGitActions = visibleActions.filter(
      (item) => actionGroupKind(item) === "git",
    );
    const visibleOtherActions = visibleActions.filter(
      (item) => actionGroupKind(item) === "other",
    );
    const groupWorkflowChains = workflowChains.filter(
      (chain) => chain.workspaceKey === group.key,
    );
    const workflowActionOptions: WorkspaceWorkflowActionOption[] = [
      ...visibleGitActions,
      ...visibleBuildActions,
      ...visibleOtherActions,
    ]
      .filter((item) => isWorkspaceWorkflowActionSupported(item.action))
      .map((item) => ({
        action: item.action,
        label: item.label,
        kindLabel: item.kindLabel,
      }));
    const showWorkflowPanel =
      !group.system &&
      (groupWorkflowChains.length > 0 || workflowActionOptions.length > 0);
    const showDirectoryPanel = visibleDirectories.length > 0;
    const showProxyPanel =
      visibleProxyProfiles.length > 0 || (active && !group.system);
    const showRootDirectoryShortcut = Boolean(
      group.rootDir && !showDirectoryPanel && !group.system,
    );
    const showShortcutPanel =
      visibleResources.length > 0 || showRootDirectoryShortcut;
    const showToolPanel = visibleTools.length > 0;
    const showContentPanel =
      showShortcutPanel ||
      showToolPanel ||
      showDirectoryPanel ||
      showProxyPanel;
    const showBuildActionsPanel = visibleBuildActions.length > 0;
    const showGitActionsPanel = visibleGitActions.length > 0;
    const showOtherActionsPanel = visibleOtherActions.length > 0;
    const showActionsPanel =
      showBuildActionsPanel || showGitActionsPanel || showOtherActionsPanel;
    const showBodyPanel =
      showContentPanel ||
      showWorkflowPanel ||
      showActionsPanel;
    const typeLabel = workspaceTypeLabel(
      group.workspaceType,
      group.workspaceTypeLabel,
      workspaceTypeOptions,
    );
    const displayTypeLabel = t(typeLabel);
    const showTypeChip = !group.system && typeLabel.trim().length > 0;
    const displayName = workspaceDisplayName(group, t);
    const summaryItems = [
      group.entryCount > 0
        ? workspaceSummaryCountLabel(language, "entry", group.entryCount)
        : "",
      group.projectCount > 0
        ? workspaceSummaryCountLabel(language, "project", group.projectCount)
        : "",
      group.proxyProfileCount > 0
        ? workspaceSummaryCountLabel(language, "proxy", group.proxyProfileCount)
        : "",
      group.actionCount > 0
        ? workspaceSummaryCountLabel(language, "action", group.actionCount)
        : "",
    ].filter(Boolean);
    const moduleKeys = [
      showShortcutPanel ? "resources" : null,
      showToolPanel ? "tools" : null,
      showDirectoryPanel ? "projects" : null,
      showProxyPanel ? "proxy" : null,
      showWorkflowPanel ? "workflow" : null,
      showBuildActionsPanel ? "build" : null,
      showGitActionsPanel ? "git" : null,
      showOtherActionsPanel ? "other" : null,
    ].filter((key): key is OverviewModuleKey => Boolean(key));
    const moduleCollapsed = (moduleKey: OverviewModuleKey) =>
      isWorkspaceModuleCollapsed(group.key, moduleKey);

    return (
      <Box
        key={group.key}
        component="section"
        className={`overview-workspace-card${group.system ? " overview-global-workspace-panel is-system" : ""}${active ? " is-active" : ""}${featured ? " is-featured" : ""}${collapsed ? " is-collapsed" : ""}`}
      >
        <div className="overview-workspace-header">
          <div className="overview-workspace-heading">
            <div className="overview-workspace-title-row">
              <Typography
                component={featured ? "h2" : "h3"}
                className="overview-workspace-title"
                noWrap
              >
                {displayName}
              </Typography>
              {showTypeChip ? (
                <Chip
                  size="small"
                  className="overview-workspace-type-chip"
                  label={displayTypeLabel}
                />
              ) : null}
              {stateItems.map((item) => (
                <span
                  key={`${item.tone}:${item.label}`}
                  className={`overview-workspace-state-chip is-${item.tone}`}
                >
                  {workspaceStateItemLabel(item, language, t)}
                </span>
              ))}
            </div>
          </div>
          <div className="overview-workspace-tools">
            {summaryItems.length > 0 ? (
              <div
                className="overview-workspace-summary"
                aria-label={summaryItems.join("，")}
              >
                {summaryItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
            {!collapsed && moduleKeys.length > 1 ? (
              <Tooltip title={t("模块布局")}>
                <IconButton
                  size="small"
                  className="overview-module-menu-button"
                  onClick={(event) =>
                    setWorkspaceModuleMenu({
                      anchorEl: event.currentTarget,
                      workspaceKey: group.key,
                      moduleKeys,
                    })
                  }
                  aria-label={t("{name} 的模块布局", { name: displayName })}
                  aria-haspopup="menu"
                  aria-expanded={
                    workspaceModuleMenu?.workspaceKey === group.key
                  }
                >
                  <MoreIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title={t("提取 AI 上下文")}>
              <span>
                <IconButton
                  size="small"
                  className="overview-context-button"
                  onClick={() => void openWorkspaceAiContext(group)}
                  disabled={aiContextLoading}
                  aria-label={t("提取 {name} 的 AI 上下文", {
                    name: displayName,
                  })}
                >
                  {aiContextLoading && aiContextGroup?.key === group.key ? (
                    <CircularProgress size={15} thickness={5} />
                  ) : (
                    <CopyIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={collapsed ? t("展开") : t("收起")}>
              <IconButton
                size="small"
                className="overview-collapse-toggle"
                onClick={() => toggleWorkspaceCollapsed(group.key)}
                aria-label={t(
                  collapsed ? "展开 {name}" : "收起 {name}",
                  { name: displayName },
                )}
                aria-expanded={!collapsed}
              >
                {collapsed ? (
                  <ExpandIcon fontSize="small" />
                ) : (
                  <CollapseIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {!collapsed && showBodyPanel ? (
          <div className="overview-workspace-body">
            {showContentPanel ? (
              <div className="overview-workspace-content">
                {showShortcutPanel ? (
                  <div
                    className={`overview-shortcut-panel${moduleCollapsed("resources") ? " is-collapsed" : ""}`}
                    data-overview-module="resources"
                  >
                    {renderSectionHeading(
                      t("入口"),
                      moduleQuickActions(
                        group,
                        "resources",
                        t("资源入口"),
                        <WebsiteIcon fontSize="small" />,
                      ),
                      visibleResources.length +
                        (showRootDirectoryShortcut ? 1 : 0),
                      {
                        collapsed: moduleCollapsed("resources"),
                        onToggle: () =>
                          toggleWorkspaceModuleCollapsed(
                            group.key,
                            "resources",
                          ),
                      },
                    )}
                    {!moduleCollapsed("resources") ? <div
                      className={`overview-shortcut-grid${group.system ? " is-system" : ""}`}
                    >
                      {visibleResources.map((resource) => {
                        const running =
                          runningKey === `resource:${resource.key}`;
                        const shortcutDetail =
                          resource.category &&
                          resource.category !== resource.label
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
                            <span
                              className="overview-shortcut-icon"
                              aria-hidden="true"
                            >
                              {running ? (
                                <CircularProgress size={14} />
                              ) : (
                                shortcutIcon(resource.kind)
                              )}
                            </span>
                            <span className="overview-shortcut-copy">
                              <strong>{resource.label}</strong>
                              <small>{shortcutDetail}</small>
                            </span>
                            <span
                              className="overview-shortcut-chevron"
                              aria-hidden="true"
                            >
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
                          <span
                            className="overview-shortcut-icon"
                            aria-hidden="true"
                          >
                            <FolderIcon fontSize="small" />
                          </span>
                          <span className="overview-shortcut-copy">
                            <strong>{t("工作目录")}</strong>
                            <small>{group.rootDir}</small>
                          </span>
                          <span
                            className="overview-shortcut-chevron"
                            aria-hidden="true"
                          >
                            ›
                          </span>
                        </button>
                      ) : null}
                    </div> : null}
                  </div>
                ) : null}

                {showToolPanel ? (
                  <div
                    className={`overview-shortcut-panel${moduleCollapsed("tools") ? " is-collapsed" : ""}`}
                    data-overview-module="tools"
                  >
                    {renderSectionHeading(
                      t("工具"),
                      moduleQuickActions(
                        group,
                        "resources",
                        t("资源入口"),
                        <WorkflowIcon fontSize="small" />,
                      ),
                      visibleTools.length,
                      {
                        collapsed: moduleCollapsed("tools"),
                        onToggle: () =>
                          toggleWorkspaceModuleCollapsed(group.key, "tools"),
                      },
                    )}
                    {!moduleCollapsed("tools") ? <div
                      className={`overview-shortcut-grid${group.system ? " is-system" : ""}`}
                    >
                      {visibleTools.map((resource) => {
                        const running = runningKey === `tool:${resource.key}`;
                        const canPlan = isLinkToolResource(resource);
                        const isResourceAction = isActionToolResource(resource);
                        const displayLabel = isResourceAction
                          ? resourceActionResourceName(resource, t)
                          : resource.label;
                        const displayDetail = isResourceAction
                          ? resourceActionResourceDetail(resource, t)
                          : resource.detail;
                        const disabled =
                          Boolean(runningKey) ||
                          (!canPlan && !isResourceAction && !resource.openable);
                        if (canPlan) {
                          const runtimeAction = linkRuntimeAction(resource);
                          const displaySummary = workspaceLinkToolSummary(
                            resource.detail,
                            resource.value ||
                              translateInternalMessage(resource.kindLabel, t),
                            linkRuntimeLabel(resource),
                            t,
                          );
                          const actionTitle =
                            runtimeAction === "stop"
                              ? t("一键停止")
                              : t("一键启动");
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
                              title={
                                displaySummary || resource.label
                              }
                            >
                              <button
                                type="button"
                                className="overview-shortcut-main"
                                onClick={() =>
                                  void openWorkspaceLinkPlan(resource)
                                }
                                disabled={Boolean(runningKey)}
                              >
                                <span
                                  className="overview-shortcut-icon"
                                  aria-hidden="true"
                                >
                                  {running ? (
                                    <CircularProgress size={14} />
                                  ) : (
                                    shortcutIcon(resource.kind)
                                  )}
                                </span>
                                <span className="overview-shortcut-copy">
                                  <strong>{resource.label}</strong>
                                  <small>{displaySummary}</small>
                                </span>
                              </button>
                              <Tooltip title={actionTitle}>
                                <span className="overview-shortcut-run-shell">
                                  <IconButton
                                    size="small"
                                    className="overview-shortcut-run-button"
                                    onClick={() =>
                                      void executeWorkspaceLinkAction(
                                        resource,
                                        runtimeAction,
                                      )
                                    }
                                    disabled={actionDisabled}
                                    aria-label={t(
                                      runtimeAction === "stop"
                                        ? "停止 {name}"
                                        : "启动 {name}",
                                      { name: resource.label },
                                    )}
                                  >
                                    {running ? (
                                      <CircularProgress
                                        size={14}
                                        thickness={5}
                                      />
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
                        if (isResourceAction) {
                          const actionKey = (
                            resource.toolKey ||
                            resource.value ||
                            ""
                          ).trim();
                          const inspectOnly = resource.toolAction === "inspect";
                          const actionTitle = t(
                            inspectOnly ? "打开 {name}" : "配置并运行 {name}",
                            { name: displayLabel },
                          );
                          const actionDisabled =
                            Boolean(runningKey) || !actionKey;
                          return (
                            <div
                              key={resource.key}
                              className={`overview-shortcut overview-shortcut--${resource.kind} overview-shortcut--with-run`}
                              title={
                                displayDetail ??
                                resource.value ??
                                displayLabel
                              }
                            >
                              <button
                                type="button"
                                className="overview-shortcut-main"
                                onClick={() => openWorkspaceAction(resource)}
                                disabled={actionDisabled}
                              >
                                <span
                                  className="overview-shortcut-icon"
                                  aria-hidden="true"
                                >
                                  {shortcutIcon(resource.kind)}
                                </span>
                                <span className="overview-shortcut-copy">
                                  <strong>{displayLabel}</strong>
                                  <small>
                                    {displayDetail ||
                                      resource.value ||
                                      t(resource.kindLabel)}
                                  </small>
                                </span>
                              </button>
                              <Tooltip title={actionTitle}>
                                <span className="overview-shortcut-run-shell">
                                  <IconButton
                                    size="small"
                                    className="overview-shortcut-run-button"
                                    onClick={() => openWorkspaceAction(resource)}
                                    disabled={actionDisabled}
                                    aria-label={actionTitle}
                                  >
                                    {inspectOnly ? (
                                      <SearchIcon fontSize="small" />
                                    ) : (
                                      <ActionIcon fontSize="small" />
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
                            onClick={() => void openWorkspaceResource(resource)}
                            disabled={disabled}
                            title={
                              resource.detail ??
                              resource.value ??
                              resource.label
                            }
                          >
                            <span
                              className="overview-shortcut-icon"
                              aria-hidden="true"
                            >
                              {running ? (
                                <CircularProgress size={14} />
                              ) : (
                                shortcutIcon(resource.kind)
                              )}
                            </span>
                            <span className="overview-shortcut-copy">
                              <strong>{resource.label}</strong>
                              <small>
                                {resource.detail ||
                                  resource.value ||
                                  resource.kindLabel}
                              </small>
                            </span>
                            <span
                              className="overview-shortcut-chevron"
                              aria-hidden="true"
                            >
                              ›
                            </span>
                          </button>
                        );
                      })}
                    </div> : null}
                  </div>
                ) : null}

                {showDirectoryPanel ? (
                  <div
                    className={`overview-directory-panel${moduleCollapsed("projects") ? " is-collapsed" : ""}`}
                    data-overview-module="projects"
                  >
                    {renderSectionHeading(
                      t("项目"),
                      projectSectionQuickActions(group),
                      visibleDirectories.length,
                      {
                        collapsed: moduleCollapsed("projects"),
                        onToggle: () =>
                          toggleWorkspaceModuleCollapsed(
                            group.key,
                            "projects",
                          ),
                      },
                    )}
                    {!moduleCollapsed("projects") ? <div className="overview-directory-list">
                      {visibleDirectories.map((directory) => {
                        const projectRunning =
                          directory.running || directory.canStop;
                        const projectAction = projectRunning ? "stop" : "start";
                        const actionRunning =
                          runningKey ===
                          `project:${group.key}:${directory.projectKey}:${projectAction}`;
                        const focusRunning =
                          runningKey ===
                          `project:${group.key}:${directory.projectKey}:focus`;
                        const runtimeEntry = runtimeEntryByProjectKey.get(
                          directory.projectKey,
                        );
                        return (
                          <WorkspaceProjectRuntimeRow
                            key={directory.projectKey}
                            workspace={group}
                            directory={directory}
                            runtimeEntry={runtimeEntry}
                            selectedDebugProfileKey={
                              selectedDebugProfileKeys[directory.projectKey]
                            }
                            active={active}
                            preferencesHydrated={
                              projectRuntimePreferencesHydrated
                            }
                            actionRunning={actionRunning}
                            focusRunning={focusRunning}
                            anyActionRunning={Boolean(runningKey)}
                            onOpenDirectory={openWorkspaceProjectDirectory}
                            onStart={(debugProfileKey, expectedPort) =>
                              toggleWorkspaceProject(
                                group,
                                directory,
                                debugProfileKey,
                                expectedPort,
                              )
                            }
                            onRequestStart={(forceConfirm = false) => {
                              if (!runtimeEntry) {
                                return toggleWorkspaceProject(group, directory);
                              }
                              return runtimeStartLauncher.requestStart(
                                runtimeEntry,
                                { forceConfirm },
                              );
                            }}
                            onStop={() => {
                              void toggleWorkspaceProject(group, directory);
                            }}
                            onFocus={() =>
                              focusWorkspaceProjectRuntime(group, directory)
                            }
                            onPreflightAction={(action) =>
                              runWorkspaceRuntimePreflightAction(
                                group,
                                directory,
                                action,
                              )
                            }
                            onStartProxy={async (profileId, sourceId) => {
                              await onStartProxyProfile(profileId, sourceId);
                              await loadOverview();
                            }}
                            onProjectConfigSaved={onProjectConfigSaved}
                            onSelectDebugProfile={(profileKey) =>
                              onProjectDebugProfileChange(
                                directory.projectKey,
                                profileKey,
                              )
                            }
                          />
                        );
                      })}
                    </div> : null}
                  </div>
                ) : null}

                {showProxyPanel ? (
                  <div
                    className={`overview-directory-panel overview-proxy-panel${moduleCollapsed("proxy") ? " is-collapsed" : ""}`}
                    data-overview-module="proxy"
                  >
                    {renderSectionHeading(
                      t("本地代理"),
                      moduleQuickActions(
                        group,
                        "proxy",
                        t("本地代理"),
                        <TerminalIcon fontSize="small" />,
                      ),
                      visibleProxyProfiles.length,
                      {
                        collapsed: moduleCollapsed("proxy"),
                        onToggle: () =>
                          toggleWorkspaceModuleCollapsed(group.key, "proxy"),
                      },
                    )}
                    {!moduleCollapsed("proxy") ? <div className="overview-directory-list overview-proxy-list">
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
                                <strong>{t("暂无绑定代理")}</strong>
                              </span>
                              <small>{t("当前工作区未绑定代理")}</small>
                            </span>
                          </div>
                        </div>
                      ) : null}
                      {visibleProxyProfiles.map((profile) => {
                        const running =
                          runningKey ===
                          `proxy:${group.key}:${profile.id}:${profile.running ? "stop" : "start"}`;
                        const statusLabel = profile.running
                          ? t("运行中")
                          : t("未启动");
                        const ruleLabel = t("{count} 条规则", {
                          count: profile.ruleCount,
                        });
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
                            <Tooltip
                              title={
                                profile.running
                                  ? t("停止代理服务")
                                  : t("启动代理服务")
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  className={`overview-project-start overview-proxy-toggle${
                                    profile.running ? " is-running" : ""
                                  }`}
                                  onClick={() =>
                                    void toggleWorkspaceProxyProfile(
                                      group,
                                      profile,
                                    )
                                  }
                                  disabled={Boolean(runningKey)}
                                  aria-label={t(
                                    profile.running
                                      ? "停止 {name}"
                                      : "启动 {name}",
                                    { name: profile.name },
                                  )}
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
                    </div> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {showWorkflowPanel ? (
              <WorkspaceWorkflowPanel
                workspaceKey={group.key}
                chains={groupWorkflowChains}
                actions={workflowActionOptions}
                runStates={workflowRunStates}
                runningChainId={runningChainId}
                onSave={onSaveWorkflowChain}
                onDelete={deleteWorkflowChain}
                onEnabledChange={setWorkflowChainEnabled}
                onRun={runWorkflowChain}
                onCancelRun={cancelWorkflowRun}
                collapsed={moduleCollapsed("workflow")}
                onCollapsedChange={() =>
                  toggleWorkspaceModuleCollapsed(group.key, "workflow")
                }
              />
            ) : null}

            {showActionsPanel ? (
              <>
                {renderActionPanel(
                  group,
                  "build",
                  t("构建"),
                  visibleBuildActions,
                  "overview-build-actions-panel",
                  moduleQuickActions(
                    group,
                    "projectManagement",
                    t("构建"),
                    <PackageIcon fontSize="small" />,
                    "build",
                  ),
                )}
                {renderActionPanel(
                  group,
                  "git",
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
                {renderActionPanel(
                  group,
                  "other",
                  t("其他动作"),
                  visibleOtherActions,
                )}
              </>
            ) : null}

          </div>
        ) : null}
      </Box>
    );
  }

  async function openWorkspaceFromIndex(
    group: WorkspacePinnedActionsOverview,
  ) {
    if (group.key === activeProjectWorkspaceKey || openingWorkspaceKey) {
      return;
    }
    setOpeningWorkspaceKey(group.key);
    setError("");
    setStatus("");
    try {
      await onProjectWorkspaceChange(group.key);
      setStatus(t("已进入工作区 {name}", { name: group.name }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setOpeningWorkspaceKey("");
    }
  }

  function renderWorkspaceIndexCard(
    group: WorkspacePinnedActionsOverview,
    index: number,
  ) {
    const typeLabel = workspaceTypeLabel(
      group.workspaceType,
      group.workspaceTypeLabel,
      workspaceTypeOptions,
    );
    const summaryItems = [
      group.projectCount > 0
        ? workspaceSummaryCountLabel(language, "project", group.projectCount)
        : "",
      group.entryCount > 0
        ? workspaceSummaryCountLabel(language, "entry", group.entryCount)
        : "",
      group.actionCount > 0
        ? workspaceSummaryCountLabel(language, "action", group.actionCount)
        : "",
    ].filter(Boolean);
    const opening = openingWorkspaceKey === group.key;

    return (
      <Box
        key={group.key}
        component="article"
        className="overview-workspace-index-card"
        data-index-tone={(["blue", "violet", "cyan", "amber"] as const)[
          index % 4
        ]}
        data-workspace-type={normalizeWorkspaceType(group.workspaceType)}
      >
        <span className="overview-workspace-index-icon" aria-hidden="true">
          <PackageIcon fontSize="small" />
        </span>
        <div className="overview-workspace-index-copy">
          <div className="overview-workspace-index-title-row">
            <Typography
              component="h3"
              className="overview-workspace-index-title"
              noWrap
            >
              {workspaceDisplayName(group, t)}
            </Typography>
            {typeLabel.trim() ? (
              <Chip
                size="small"
                className="overview-workspace-type-chip"
                label={t(typeLabel)}
              />
            ) : null}
          </div>
          {group.description ? (
            <Typography
              className="overview-workspace-index-description"
              noWrap
            >
              {group.description}
            </Typography>
          ) : (
            <Typography
              className="overview-workspace-index-description"
              noWrap
            >
              {group.key}
            </Typography>
          )}
        </div>
        {summaryItems.length > 0 ? (
          <div className="overview-workspace-summary overview-workspace-index-summary">
            {summaryItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : (
          <span className="overview-workspace-index-empty">{t("空工作区")}</span>
        )}
        <Button
          size="small"
          variant="text"
          className="overview-workspace-index-enter"
          disabled={Boolean(openingWorkspaceKey)}
          onClick={() => void openWorkspaceFromIndex(group)}
        >
          {opening ? <CircularProgress size={14} thickness={5} /> : t("进入")}
        </Button>
        <Tooltip title={t("更多操作")}>
          <IconButton
            size="small"
            className="overview-workspace-index-menu-button"
            aria-label={t("{name} 的更多操作", {
              name: workspaceDisplayName(group, t),
            })}
            aria-haspopup="menu"
            aria-expanded={workspaceIndexMenu?.group.key === group.key}
            onClick={(event) =>
              setWorkspaceIndexMenu({
                anchorEl: event.currentTarget,
                group,
              })
            }
          >
            <MoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  function renderWorkspaceDirectoryPanel() {
    const collapsed = isWorkspaceModuleCollapsed(
      SYSTEM_WORKSPACE_KEY,
      "workspaces",
    );
    return (
      <Box
        component="section"
        className={`overview-directory-panel overview-workspace-index-panel overview-workspace-directory-panel${collapsed ? " is-collapsed" : ""}`}
        data-overview-module="workspaces"
      >
        {renderSectionHeading(
          t("工作区"),
          [
            {
              key: "workspace-config",
              label: t("工作区配置"),
              title: t("工作区配置"),
              icon: <SettingsIcon fontSize="small" />,
              onClick: () => setManageOpen(true),
            },
          ],
          filteredWorkspaceIndexGroups.length,
          {
            collapsed,
            onToggle: () =>
              toggleWorkspaceModuleCollapsed(
                SYSTEM_WORKSPACE_KEY,
                "workspaces",
              ),
          },
        )}
        {!collapsed ? (
          filteredWorkspaceIndexGroups.length > 0 ? (
            <div className="overview-workspace-index-grid">
              {filteredWorkspaceIndexGroups.map((workspace, index) =>
                renderWorkspaceIndexCard(workspace, index),
              )}
            </div>
          ) : (
            <AppEmptyState
              className="overview-workspace-module-empty"
              compact
              title={t(
                workspaceIndexGroups.length > 0
                  ? "没有匹配工作区"
                  : "还没有具体工作区",
              )}
              description={t(
                workspaceIndexGroups.length > 0
                  ? "换个关键词或筛选项。"
                  : "新建工作区后会显示在这里。",
              )}
            />
          )
        ) : null}
      </Box>
    );
  }

  return (
    <Box
      className={`overview-page${
        isSystemWorkspaceActive ? " is-global-workspace" : ""
      }`}
    >
      <Stack className="overview-page-stack" minWidth={0}>
        <AppToast
          message={error || status}
          severity={error ? "error" : "success"}
          autoHideDuration={error ? 5200 : 2800}
          nonce={toastNonce}
        />

        {confirmDialog}
        {runtimeStartLauncher.dialog}
        {workspaceLifecycle.confirmDialog}

        <LinkPlanDialog
          state={linkPlanDialog}
          onClose={() => setLinkPlanDialog(null)}
          onAction={(action) => void runLinkDialogAction(action)}
        />

        <ResourceActionDialog
          open={Boolean(resourceActionDialog)}
          target={resourceActionDialog}
          onClose={() => setResourceActionDialog(null)}
          recordActivity={recordActivity}
          updateActivity={updateActivity}
        />

        <WorkspacePageToolbar
          className={isSystemWorkspaceActive ? "overview-global-toolbar" : ""}
          ariaLabel={t(
            isSystemWorkspaceActive
              ? "全局工作区概览与配置"
              : "当前工作区概览与配置",
          )}
          metrics={workspaceToolbarMetrics}
          actions={
            <WorkspacePageToolbarAction
              startIcon={<SettingsIcon fontSize="small" />}
              onClick={() => setManageOpen(true)}
            >
              {t("工作区配置")}
            </WorkspacePageToolbarAction>
          }
        />

        <Box
          className="overview-filter-bar"
          hidden={!isSystemWorkspaceActive}
        >
          <TextField
            className="overview-search-field"
            size="small"
            value={overviewQuery}
            onChange={(event) => setOverviewQuery(event.target.value)}
            placeholder={t("搜索工作区、项目、入口、代理或动作")}
            inputProps={{ "aria-label": t("搜索工作区") }}
            InputProps={{
              startAdornment: (
                <InputAdornment
                  position="start"
                  className="overview-search-adornment"
                >
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: overviewQuery.trim() ? (
                <InputAdornment position="end">
                  <Tooltip title={t("清空搜索")}>
                    <IconButton
                      size="small"
                      className="overview-search-clear"
                      onClick={() => setOverviewQuery("")}
                      aria-label={t("清空工作区搜索")}
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
            aria-label={t("按工作区类型筛选")}
            SelectProps={{ MenuProps: workspaceTypeSelectMenuProps }}
          >
            <MenuItem value="all">
              {t("全部类型 {count}", {
                count: workspaceIndexGroups.length,
              })}
            </MenuItem>
            {workspaceTypeFilterOptions.map((option) => (
              <MenuItem key={option.key} value={option.key}>
                {t("{label} {count}", {
                  label: t(option.label),
                  count: option.count,
                })}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box className="overview-workspace-list">
          {activeOverviewGroup
            ? renderWorkspaceCard(activeOverviewGroup, true)
            : null}

          {isSystemWorkspaceActive && activeOverviewGroup
            ? renderWorkspaceDirectoryPanel()
            : null}

          {loading && groups.length === 0 ? (
            <Box className="overview-loading-state">
              <CircularProgress size={20} thickness={5} />
            </Box>
          ) : null}

          {!loading && groups.length === 0 ? (
            <Box className="overview-empty-state">
              <Typography variant="body2" color="text.secondary">
                {t("还没有工作区")}
              </Typography>
            </Box>
          ) : null}

          {!loading &&
          isSystemWorkspaceActive &&
          activeOverviewGroup &&
          !isWorkspaceModuleCollapsed(SYSTEM_WORKSPACE_KEY, "workspaces") ? (
            <AppListEndState className="overview-workspace-index-end" />
          ) : null}
        </Box>

        <Menu
          anchorEl={workspaceIndexMenu?.anchorEl ?? null}
          open={Boolean(workspaceIndexMenu)}
          onClose={() => setWorkspaceIndexMenu(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{
            paper: {
              className: "overview-workspace-index-menu-paper",
            },
          }}
        >
          <MenuItem
            className="overview-workspace-index-menu-item"
            disabled={!workspaceIndexMenu}
            onClick={() => {
              const group = workspaceIndexMenu?.group;
              setWorkspaceIndexMenu(null);
              if (group) {
                void openWorkspaceAiContext(group);
              }
            }}
          >
            <CopyIcon fontSize="small" />
            {t("提取 AI 上下文")}
          </MenuItem>
          <MenuItem
            className="overview-workspace-index-menu-item"
            disabled={!workspaceIndexMenu}
            onClick={() => {
              const group = workspaceIndexMenu?.group;
              setWorkspaceIndexMenu(null);
              if (group) {
                setManageOpen(true);
                void selectWorkspaceConfig(group.key);
              }
            }}
          >
            <SettingsIcon fontSize="small" />
            {t("工作区配置")}
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={workspaceModuleMenu?.anchorEl ?? null}
          open={Boolean(workspaceModuleMenu)}
          onClose={() => setWorkspaceModuleMenu(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{
            paper: {
              className: "overview-workspace-index-menu-paper",
            },
          }}
        >
          <MenuItem
            className="overview-workspace-index-menu-item"
            disabled={
              !workspaceModuleMenu ||
              workspaceModuleMenu.moduleKeys.every(
                (moduleKey) =>
                  !collapsedWorkspaceModuleKeys.has(
                    workspaceModuleStorageKey(
                      workspaceModuleMenu.workspaceKey,
                      moduleKey,
                    ),
                  ),
              )
            }
            onClick={() => {
              if (workspaceModuleMenu) {
                setWorkspaceModulesCollapsed(
                  workspaceModuleMenu.workspaceKey,
                  workspaceModuleMenu.moduleKeys,
                  false,
                );
              }
              setWorkspaceModuleMenu(null);
            }}
          >
            <ExpandIcon fontSize="small" />
            {t("展开全部模块")}
          </MenuItem>
          <MenuItem
            className="overview-workspace-index-menu-item"
            disabled={
              !workspaceModuleMenu ||
              workspaceModuleMenu.moduleKeys.every((moduleKey) =>
                collapsedWorkspaceModuleKeys.has(
                  workspaceModuleStorageKey(
                    workspaceModuleMenu.workspaceKey,
                    moduleKey,
                  ),
                ),
              )
            }
            onClick={() => {
              if (workspaceModuleMenu) {
                setWorkspaceModulesCollapsed(
                  workspaceModuleMenu.workspaceKey,
                  workspaceModuleMenu.moduleKeys,
                  true,
                );
              }
              setWorkspaceModuleMenu(null);
            }}
          >
            <CollapseIcon fontSize="small" />
            {t("收起全部模块")}
          </MenuItem>
        </Menu>

        <Dialog
          open={aiContextOpen}
          onClose={() => setAiContextOpen(false)}
          maxWidth={false}
          PaperProps={{ className: "overview-ai-context-paper" }}
        >
          <DialogTitle className="overview-ai-context-title">
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
              <Stack
                direction="row"
                alignItems="center"
                spacing={0.75}
                minWidth={0}
              >
                <Box className="overview-ai-context-icon">
                  <CopyIcon fontSize="small" />
                </Box>
                <Stack spacing={0.12} minWidth={0}>
                  <Typography
                    variant="subtitle1"
                    className="overview-ai-context-heading"
                    noWrap
                  >
                    {t("AI 上下文")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {aiContextResponse?.workspaceName ||
                      aiContextGroup?.name ||
                      t("工作区")}
                  </Typography>
                </Stack>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                {aiContextGroup ? (
                  <>
                    <Chip
                      size="small"
                      label={t("{count} 个项目", {
                        count: aiContextGroup.projectCount,
                      })}
                    />
                    <Chip
                      size="small"
                      label={t("{count} 个入口", {
                        count: aiContextGroup.entryCount,
                      })}
                    />
                    <Chip
                      size="small"
                      label={t("{count} 个代理", {
                        count: aiContextGroup.proxyProfileCount,
                      })}
                    />
                    <Chip
                      size="small"
                      label={t("{count} 个动作", {
                        count: aiContextGroup.actionCount,
                      })}
                    />
                  </>
                ) : null}
                <Tooltip title={t("关闭")}>
                  <IconButton
                    size="small"
                    onClick={() => setAiContextOpen(false)}
                    aria-label={t("关闭 AI 上下文")}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </DialogTitle>
          <DialogContent className="overview-ai-context-content">
            <div className="overview-ai-context-toolbar">
              <div
                className="overview-ai-context-tabs"
                role="tablist"
                aria-label={t("AI 上下文格式")}
              >
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
                  {aiContextPreviewLineCount
                    ? t("{count} 行", { count: aiContextPreviewLineCount })
                    : t("生成中")}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={
                    aiContextLoading ? (
                      <CircularProgress size={13} />
                    ) : (
                      <ReplayIcon fontSize="small" />
                    )
                  }
                  onClick={() => void refreshWorkspaceAiContext()}
                  disabled={aiContextLoading || !aiContextGroup}
                >
                  {t("刷新")}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<CopyIcon fontSize="small" />}
                  onClick={() => void copyAiContext(aiContextView)}
                  disabled={!aiContextResponse || aiContextLoading}
                >
                  {t("复制")}
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
                    label={t("场景")}
                    value={aiContextPresetKey}
                    onChange={(event) =>
                      void applyAiContextPreset(event.target.value)
                    }
                    disabled={aiContextLoading}
                  >
                    {aiContextPresets.map((preset) => (
                      <MenuItem key={preset.key} value={preset.key}>
                        {t(preset.label)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    className="overview-ai-context-preset-name"
                    label={t("场景名")}
                    value={aiContextPresetName}
                    placeholder={
                      selectedAiContextPreset.custom
                        ? selectedAiContextPreset.label
                        : t("保存为自定义")
                    }
                    onChange={(event) =>
                      setAiContextPresetName(event.target.value)
                    }
                    disabled={aiContextLoading}
                  />
                  {aiContextPresetDirty ? (
                    <Chip size="small" label={t("已调整")} />
                  ) : null}
                  <Button
                    size="small"
                    variant={aiContextPresetDirty ? "contained" : "outlined"}
                    startIcon={<CheckIcon fontSize="small" />}
                    onClick={() => void saveAiContextPreset()}
                    disabled={
                      aiContextLoading ||
                      (!aiContextPresetName.trim() &&
                        !selectedAiContextPreset.custom)
                    }
                  >
                    {t("保存")}
                  </Button>
                  {selectedAiContextPreset.custom ? (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => void deleteAiContextPreset()}
                      disabled={aiContextLoading}
                    >
                      {t("删除")}
                    </Button>
                  ) : null}
                </div>
                <div className="overview-ai-context-limit-row">
                  <Tooltip title={t("项目、入口、目录、动作这些内容每类最多输出多少条")}>
                    <TextField
                      select
                      size="small"
                      className="overview-ai-context-limit-select"
                      label={t("内容上限")}
                      value={aiContextOptions.itemLimit}
                      onChange={(event) =>
                        void updateAiContextOptions({
                          itemLimit: Number(event.target.value),
                        })
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
                  <Tooltip title={t("构建、合并、可回放动作这些历史记录最多输出多少条")}>
                    <TextField
                      select
                      size="small"
                      className="overview-ai-context-limit-select"
                      label={t("历史上限")}
                      value={aiContextOptions.historyLimit}
                      onChange={(event) =>
                        void updateAiContextOptions({
                          historyLimit: Number(event.target.value),
                        })
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
                <span className="overview-ai-context-section-label">{t("范围")}</span>
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
                            void updateAiContextOptions({
                              [option.key]: event.target.checked,
                            })
                          }
                          disabled={aiContextLoading}
                        />
                      }
                      label={t(option.label)}
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
                <AppEmptyState
                  compact
                  title={t("暂无上下文")}
                  description={t("刷新后可复制给 AI 使用。")}
                />
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
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
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
                    bgcolor: alpha(
                      theme.palette.primary.main,
                      theme.palette.mode === "dark" ? 0.12 : 0.08,
                    ),
                  })}
                >
                  <SettingsIcon fontSize="small" />
                </Box>
                <Stack
                  className="overview-workspace-config-title-text"
                  spacing={0.1}
                  minWidth={0}
                >
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 860, lineHeight: 1.2 }}
                  >
                    {t("工作区配置")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {workspaceDraft?.name ??
                      editingWorkspaceSummary?.name ??
                      activeGroup?.name ??
                      activeProjectWorkspaceKey}
                  </Typography>
                </Stack>
                {workspaceDirty ? (
                  <Chip size="small" color="primary" label={t("未保存")} />
                ) : null}
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <Tooltip title={t("关闭")}>
                  <IconButton
                    className="overview-workspace-config-close"
                    size="small"
                    onClick={closeManageDialog}
                    aria-label={t("关闭工作区配置")}
                    sx={(theme) => ({
                      width: 32,
                      height: 32,
                      borderRadius: "10px",
                      color: theme.palette.text.secondary,
                      "&:hover": {
                        color: theme.palette.text.primary,
                        bgcolor: alpha(
                          theme.palette.text.primary,
                          theme.palette.mode === "dark" ? 0.08 : 0.06,
                        ),
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
                gridTemplateRows: {
                  xs: "auto minmax(0, 1fr)",
                  md: "minmax(0, 1fr)",
                },
                width: "100%",
                height: "100%",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <WorkspaceConfigSidebar
                workspaces={orderedProjectWorkspaces}
                archivedWorkspaces={archivedProjectWorkspaces}
                editingWorkspaceKey={editingWorkspaceKey}
                actionCounts={workspaceActionCounts}
                createOpen={createOpen}
                busyKey={workspaceLifecycle.busyKey}
                focusRequest={workspaceConfigFocusRequest}
                onCreate={() => setCreateOpen(true)}
                onSelect={(workspaceKey) =>
                  void selectWorkspaceConfig(workspaceKey)
                }
                onArchive={(workspace) =>
                  void workspaceLifecycle.archiveWorkspace(workspace)
                }
                onRestore={(workspace) =>
                  void workspaceLifecycle.restoreWorkspace(workspace)
                }
                onDelete={(workspace) =>
                  void deleteWorkspaceConfig(workspace.key, workspace.name)
                }
              />

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
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Stack spacing={0.05}>
                          <Typography
                            variant="caption"
                            sx={{ fontWeight: 850 }}
                          >
                            {t("新建工作区")}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {createWorkspaceMode === "demand"
                              ? t("需求初始化")
                              : t("名称与目录")}
                          </Typography>
                        </Stack>
                        <Tooltip title={t("收起")}>
                          <IconButton
                            onClick={() => setCreateOpen(false)}
                            aria-label={t("收起新建工作区")}
                          >
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
                          border: (theme) =>
                            `1px solid ${theme.palette.divider}`,
                          bgcolor: (theme) =>
                            alpha(theme.palette.background.paper, 0.64),
                        }}
                      >
                        <Button
                          size="small"
                          variant={
                            createWorkspaceMode === "basic"
                              ? "contained"
                              : "text"
                          }
                          onClick={() => setCreateWorkspaceMode("basic")}
                          disabled={creatingWorkspace}
                          sx={{ flex: 1 }}
                        >
                          {t("普通")}
                        </Button>
                        <Button
                          size="small"
                          variant={
                            createWorkspaceMode === "demand"
                              ? "contained"
                              : "text"
                          }
                          onClick={() => {
                            setCreateWorkspaceMode("demand");
                            if (
                              newWorkspaceType === DEFAULT_NEW_WORKSPACE_TYPE
                            ) {
                              setNewWorkspaceType("business");
                            }
                          }}
                          disabled={creatingWorkspace}
                          sx={{ flex: 1 }}
                        >
                          {t("需求")}
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
                          label={t("名称")}
                          value={newWorkspaceName}
                          onChange={(event) =>
                            setNewWorkspaceName(event.target.value)
                          }
                          disabled={creatingWorkspace}
                        />
                        <TextField
                          size="small"
                          label="key"
                          value={newWorkspaceKey}
                          placeholder={
                            normalizeWorkspaceKey(newWorkspaceName) ||
                            "r-series"
                          }
                          onChange={(event) =>
                            setNewWorkspaceKey(event.target.value)
                          }
                          disabled={creatingWorkspace}
                        />
                        <TextField
                          size="small"
                          label={t("备注")}
                          value={newWorkspaceDescription}
                          onChange={(event) =>
                            setNewWorkspaceDescription(event.target.value)
                          }
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
                              label={t("需求号")}
                              value={demandId}
                              placeholder={t("可选，如 REQ-1234")}
                              onChange={(event) =>
                                setDemandId(event.target.value)
                              }
                              disabled={creatingWorkspace}
                            />
                            <TextField
                              size="small"
                              label={t("分支")}
                              value={demandBranch}
                              placeholder="feature-CR..."
                              onChange={(event) =>
                                setDemandBranch(event.target.value)
                              }
                              disabled={creatingWorkspace}
                            />
                            <TextField
                              size="small"
                              label={t("需求目录")}
                              value={demandRequirementDir}
                              onChange={(event) =>
                                setDemandRequirementDir(event.target.value)
                              }
                              disabled={creatingWorkspace}
                              sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <Button
                                      size="small"
                                      onClick={() =>
                                        void chooseDemandDirectory(
                                          "requirement",
                                        )
                                      }
                                      disabled={creatingWorkspace}
                                    >
                                      {t("选择")}
                                    </Button>
                                  </InputAdornment>
                                ),
                              }}
                            />
                            <TextField
                              size="small"
                              label={t("项目目录")}
                              value={demandRepoPath}
                              onChange={(event) =>
                                setDemandRepoPath(event.target.value)
                              }
                              disabled={creatingWorkspace}
                              sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <Button
                                      size="small"
                                      onClick={() =>
                                        void chooseDemandDirectory("repo")
                                      }
                                      disabled={creatingWorkspace}
                                    >
                                      {t("选择")}
                                    </Button>
                                  </InputAdornment>
                                ),
                              }}
                            />
                            <TextField
                              size="small"
                              label={t("项目 key")}
                              value={demandProjectKey}
                              placeholder={t("可选，自动匹配失败时填写")}
                              onChange={(event) =>
                                setDemandProjectKey(event.target.value)
                              }
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
                                setNewWorkspaceIndependentDir(
                                  event.target.checked,
                                )
                              }
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
                            placeholder={t(
                              "默认：~/Documents/rdevtool-workspaces/<key>",
                            )}
                            onChange={(event) =>
                              setNewWorkspaceRootDir(event.target.value)
                            }
                            disabled={creatingWorkspace}
                            sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                          />
                        ) : null}
                        {createWorkspaceMode === "demand" &&
                        newWorkspaceIndependentDir ? (
                          <FormControlLabel
                            sx={{ m: 0, whiteSpace: "nowrap" }}
                            control={
                              <Checkbox
                                size="small"
                                checked={reuseDemandDependencies}
                                onChange={(event) =>
                                  setReuseDemandDependencies(
                                    event.target.checked,
                                  )
                                }
                                disabled={creatingWorkspace}
                              />
                            }
                            label={t("锁文件一致时复用源项目依赖")}
                          />
                        ) : null}
                        <TextField
                          size="small"
                          label={t("资料目录")}
                          value={newWorkspaceResourceDir}
                          placeholder={t("默认：工作区目录/resources")}
                          onChange={(event) =>
                            setNewWorkspaceResourceDir(event.target.value)
                          }
                          disabled={creatingWorkspace}
                          sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <Button
                                  size="small"
                                  onClick={() =>
                                    void chooseWorkspaceResourceDirectory()
                                  }
                                  disabled={creatingWorkspace}
                                >
                                  {t("选择")}
                                </Button>
                              </InputAdornment>
                            ),
                          }}
                        />
                      </Box>
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.8}
                        >
                          {createWorkspaceMode === "basic" ? (
                            <FormControlLabel
                              sx={{ m: 0, whiteSpace: "nowrap" }}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={copyCurrentWorkspace}
                                  onChange={(event) =>
                                    setCopyCurrentWorkspace(
                                      event.target.checked,
                                    )
                                  }
                                  disabled={creatingWorkspace}
                                />
                              }
                              label={t("复制当前配置")}
                            />
                          ) : null}
                          <FormControlLabel
                            sx={{ m: 0, whiteSpace: "nowrap" }}
                            control={
                              <Checkbox
                                size="small"
                                checked={createWorkspaceWorklog}
                                onChange={(event) =>
                                  setCreateWorkspaceWorklog(
                                    event.target.checked,
                                  )
                                }
                                disabled={creatingWorkspace}
                              />
                            }
                            label={t("初始化工作日志")}
                          />
                          <FormControlLabel
                            sx={{ m: 0, whiteSpace: "nowrap" }}
                            control={
                              <Checkbox
                                size="small"
                                checked={autoRecordWorkspaceWorklog}
                                onChange={(event) =>
                                  setAutoRecordWorkspaceWorklog(
                                    event.target.checked,
                                  )
                                }
                                disabled={
                                  creatingWorkspace || !createWorkspaceWorklog
                                }
                              />
                            }
                            label={t("自动记录关键操作")}
                          />
                        </Stack>
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
                              (!demandRequirementDir.trim() ||
                                !demandRepoPath.trim() ||
                                (newWorkspaceIndependentDir &&
                                  !demandBranch.trim())))
                          }
                        >
                          {t(createWorkspaceMode === "demand" ? "初始化" : "创建")}
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
                        <Stack
                          direction="row"
                          spacing={0.5}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Chip
                            size="small"
                            label={t("{selected}/{total} 个项目", {
                              selected: selectedProjects,
                              total: projectTotal,
                            })}
                          />
                          <Chip
                            size="small"
                            label={t("{selected}/{total} 个入口", {
                              selected: selectedNavigation,
                              total: navigationTotal,
                            })}
                          />
                          <Chip
                            size="small"
                            label={t("{selected}/{total} 个代理", {
                              selected: selectedProxyProfiles,
                              total: proxyTotal,
                            })}
                          />
                          {workspaceDraft &&
                          workspaceDraft.projectInstances.length > 0 ? (
                            <Chip
                              size="small"
                              label={t("{count} 个实例", {
                                count: workspaceDraft.projectInstances.length,
                              })}
                            />
                          ) : null}
                        </Stack>
                      </Stack>

                      {workspaceLoading && !workspaceDraft ? (
                        <Box
                          sx={{
                            minHeight: 160,
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          <CircularProgress size={20} thickness={5} />
                        </Box>
                      ) : null}

                      {workspaceDraft?.system ? (
                        <Stack spacing={0.9}>
                          <Alert
                            severity="info"
                            variant="outlined"
                            sx={{ borderRadius: "12px" }}
                          >
                            {t("全局工作区始终包含全部项目、入口和代理，以下内容仅供查看。")}
                          </Alert>
                          <Stack
                            direction="row"
                            spacing={0.8}
                            flexWrap="wrap"
                            useFlexGap
                          >
                            <Button
                              size="small"
                              variant="outlined"
                              color="inherit"
                              startIcon={<PlusIcon fontSize="small" />}
                              onClick={() => setCreateOpen(true)}
                            >
                              {t("新建可配置工作区")}
                            </Button>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ alignSelf: "center" }}
                            >
                              {t("或从左侧选择非全局工作区来配置项目、入口和代理范围。")}
                            </Typography>
                          </Stack>
                        </Stack>
                      ) : null}

                      {workspaceDraft ? (
                        <>
                          {!workspaceScopeReadOnly ? (
                            <>
                              <Stack
                                direction={{ xs: "column", md: "row" }}
                                spacing={0.75}
                              >
                                <TextField
                                  size="small"
                                  label={t("名称")}
                                  value={workspaceDraft.name}
                                  onChange={(event) =>
                                    updateDraft({ name: event.target.value })
                                  }
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
                                  label={t("备注")}
                                  value={workspaceDraft.description ?? ""}
                                  onChange={(event) =>
                                    updateDraft({
                                      description: event.target.value,
                                    })
                                  }
                                  disabled={workspaceSaving}
                                  sx={{ flex: 1.4 }}
                                />
                              </Stack>
                              <TextField
                                className="overview-workspace-root-field"
                                size="small"
                                label={t("工作区目录")}
                                value={workspaceDraft.rootDir ?? ""}
                                placeholder={t("可选：独立工作目录")}
                                onChange={(event) =>
                                  updateDraft({ rootDir: event.target.value })
                                }
                                disabled={workspaceSaving}
                                InputProps={{
                                  startAdornment: (
                                    <InputAdornment position="start">
                                      <FolderIcon fontSize="small" />
                                    </InputAdornment>
                                  ),
                                  endAdornment: workspaceDraft.rootDir ? (
                                    <InputAdornment position="end">
                                      <Tooltip title={t("复制工作区目录")}>
                                        <IconButton
                                          size="small"
                                          aria-label={t("复制工作区目录")}
                                          onClick={() =>
                                            void copyPlainText(
                                              workspaceDraft.rootDir ?? "",
                                            )
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
                              <Stack
                                direction={{ xs: "column", md: "row" }}
                                spacing={0.75}
                              >
                                <TextField
                                  size="small"
                                  label={t("资料目录")}
                                  value={workspaceDraft.resourceDir ?? ""}
                                  placeholder={t("默认：工作区目录/resources")}
                                  onChange={(event) =>
                                    updateDraft({
                                      resourceDir: event.target.value,
                                    })
                                  }
                                  disabled={workspaceSaving}
                                  sx={{ flex: 1.5 }}
                                  InputProps={{
                                    endAdornment: (
                                      <InputAdornment position="end">
                                        <Tooltip title={t("选择资料目录")}>
                                          <IconButton
                                            size="small"
                                            aria-label={t("选择资料目录")}
                                            onClick={() =>
                                              void chooseWorkspaceResourceDirectory(
                                                "edit",
                                              )
                                            }
                                            disabled={workspaceSaving}
                                          >
                                            <FolderIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </InputAdornment>
                                    ),
                                  }}
                                />
                                <TextField
                                  size="small"
                                  label={t("工作日志文件")}
                                  value={
                                    workspaceDraft.worklogFile ?? "WORKLOG.md"
                                  }
                                  onChange={(event) =>
                                    updateDraft({
                                      worklogFile: event.target.value,
                                    })
                                  }
                                  disabled={workspaceSaving}
                                  sx={{ flex: 0.7 }}
                                />
                                <FormControlLabel
                                  sx={{ m: 0, minWidth: 176 }}
                                  control={
                                    <Checkbox
                                      size="small"
                                      checked={workspaceDraft.worklogAutoRecord}
                                      onChange={(event) =>
                                        updateDraft({
                                          worklogAutoRecord:
                                            event.target.checked,
                                        })
                                      }
                                      disabled={
                                        workspaceSaving ||
                                        !workspaceDraft.resourceDir
                                      }
                                    />
                                  }
                                  label={t("自动记录关键操作")}
                                />
                              </Stack>
                            </>
                          ) : null}
                          <Stack
                            className="overview-workspace-project-dir-list"
                            spacing={0.65}
                          >
                            <Stack
                              direction="row"
                              spacing={0.5}
                              alignItems="baseline"
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {t("项目目录")}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {t("全局目录 / 工作区副本 / 绑定目录")}
                              </Typography>
                              {workspaceInstanceStatuses.loading ? (
                                <CircularProgress size={12} thickness={5} />
                              ) : null}
                            </Stack>
                            {workspaceInstanceStatuses.error ? (
                              <Typography
                                className="overview-workspace-instance-status-error"
                                variant="caption"
                              >
                                {t("部分项目实例状态暂不可用")}
                              </Typography>
                            ) : null}
                            {scopedWorkspaceProjects.length > 0 ? (
                              scopedWorkspaceProjects.map((project) => {
                                const instance = workspaceInstanceByProject.get(
                                  project.key,
                                );
                                const instanceStatus =
                                  workspaceInstanceStatuses.byProject.get(
                                    project.key,
                                  );
                                const modeLabel = instance
                                  ? instance.managed
                                    ? t("工作区副本")
                                    : t("绑定目录")
                                  : t("使用全局目录");
                                const path =
                                  instance?.path ||
                                  project.repoPath ||
                                  t("未配置目录");
                                const busy =
                                  workspaceDirectoryBusy === project.key;
                                return (
                                  <Box
                                    key={project.key}
                                    className="overview-workspace-project-dir-row"
                                    sx={(theme) => ({
                                      display: "grid",
                                      gridTemplateColumns: {
                                        xs: "1fr",
                                        md: "minmax(0, 1fr) auto",
                                      },
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
                                      <Stack
                                        direction="row"
                                        spacing={0.5}
                                        alignItems="center"
                                        flexWrap="wrap"
                                      >
                                        <Typography variant="subtitle2" noWrap>
                                          {project.name || project.key}
                                        </Typography>
                                        <Chip
                                          size="small"
                                          label={modeLabel}
                                          variant="outlined"
                                        />
                                        {instance?.managed ? (
                                          <Chip
                                            size="small"
                                            label={t("托管")}
                                            variant="outlined"
                                          />
                                        ) : null}
                                        {instanceStatus ? (
                                          <Chip
                                            size="small"
                                            className={`overview-workspace-instance-status is-${instanceStatus.statusKey}`}
                                            label={translateInternalMessage(
                                              instanceStatus.statusLabel,
                                              t,
                                            )}
                                            title={translateInternalMessage(
                                              instanceStatus.detail,
                                              t,
                                            )}
                                          />
                                        ) : null}
                                      </Stack>
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        noWrap
                                      >
                                        {path}
                                      </Typography>
                                      {instanceStatus &&
                                      instanceStatus.statusKey !== "healthy" ? (
                                        <Typography
                                          className="overview-workspace-instance-detail"
                                          variant="caption"
                                        >
                                          {translateInternalMessage(
                                            instanceStatus.detail,
                                            t,
                                          )}
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                    {!workspaceScopeReadOnly ? (
                                      <Stack
                                        direction="row"
                                        spacing={0.5}
                                        justifyContent="flex-end"
                                      >
                                        {instance ? (
                                          <>
                                            {instanceStatus?.canOpen ? (
                                              <Tooltip title={t("打开项目目录")}>
                                                <span>
                                                  <IconButton
                                                    size="small"
                                                    aria-label={t("打开项目目录")}
                                                    onClick={() =>
                                                      void openWorkspaceProjectDirectory(
                                                        instance.path,
                                                      )
                                                    }
                                                    disabled={
                                                      workspaceSaving ||
                                                      Boolean(
                                                        workspaceDirectoryBusy,
                                                      )
                                                    }
                                                  >
                                                    <FolderIcon fontSize="small" />
                                                  </IconButton>
                                                </span>
                                              </Tooltip>
                                            ) : null}
                                            {!instance.managed ? (
                                              <Button
                                                size="small"
                                                variant="outlined"
                                                sx={directoryActionButtonSx}
                                                onClick={() =>
                                                  void bindWorkspaceProjectDirectory(
                                                    project.key,
                                                  )
                                                }
                                                disabled={
                                                  workspaceSaving ||
                                                  Boolean(
                                                    workspaceDirectoryBusy,
                                                  )
                                                }
                                              >
                                                {t("更换目录")}
                                              </Button>
                                            ) : null}
                                            {instanceStatus?.repairSupported ? (
                                              <Button
                                                size="small"
                                                variant="outlined"
                                                startIcon={
                                                  <ReplayIcon fontSize="small" />
                                                }
                                                sx={directoryActionButtonSx}
                                                onClick={() =>
                                                  void repairWorkspaceProjectInstance(
                                                    project.key,
                                                  )
                                                }
                                                disabled={
                                                  workspaceSaving ||
                                                  Boolean(
                                                    workspaceDirectoryBusy,
                                                  )
                                                }
                                              >
                                                {t(
                                                  busy
                                                    ? "处理中"
                                                    : "修复副本",
                                                )}
                                              </Button>
                                            ) : null}
                                            {instance.managed ? (
                                              <Tooltip
                                                title={t(
                                                  "评估托管副本清理",
                                                )}
                                              >
                                                <span>
                                                  <IconButton
                                                    size="small"
                                                    aria-label={t(
                                                      "评估托管副本清理",
                                                    )}
                                                    onClick={() =>
                                                      inspectWorkspaceProjectInstanceCleanup(
                                                        project.key,
                                                        instance.path,
                                                      )
                                                    }
                                                    disabled={
                                                      workspaceSaving ||
                                                      Boolean(
                                                        workspaceDirectoryBusy,
                                                      )
                                                    }
                                                  >
                                                    <PackageIcon fontSize="small" />
                                                  </IconButton>
                                                </span>
                                              </Tooltip>
                                            ) : null}
                                            <Button
                                              size="small"
                                              variant="outlined"
                                              sx={directoryActionButtonSx}
                                              onClick={() =>
                                                void unbindWorkspaceProjectDirectory(
                                                  project.key,
                                                )
                                              }
                                              disabled={
                                                workspaceSaving ||
                                                Boolean(workspaceDirectoryBusy)
                                              }
                                            >
                                              {t(busy ? "处理中" : "解除关联")}
                                            </Button>
                                          </>
                                        ) : (
                                          <>
                                            <Button
                                              size="small"
                                              variant="outlined"
                                              sx={directoryActionButtonSx}
                                              onClick={() =>
                                                void createWorkspaceProjectCopy(
                                                  project.key,
                                                )
                                              }
                                              disabled={
                                                workspaceSaving ||
                                                Boolean(
                                                  workspaceDirectoryBusy,
                                                ) ||
                                                !workspaceDraft.rootDir ||
                                                !project.repoPath
                                              }
                                            >
                                              {t(busy ? "创建中" : "创建副本")}
                                            </Button>
                                            <Button
                                              size="small"
                                              variant="outlined"
                                              sx={directoryActionButtonSx}
                                              onClick={() =>
                                                void bindWorkspaceProjectDirectory(
                                                  project.key,
                                                )
                                              }
                                              disabled={
                                                workspaceSaving ||
                                                Boolean(workspaceDirectoryBusy)
                                              }
                                            >
                                              {t("绑定目录")}
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
                                title={t("暂无项目目录")}
                                description={t("先选择项目，再配置目录。")}
                              />
                            )}
                          </Stack>

                          <Stack spacing={0.8}>
                            <ScopePane
                              title={t("项目")}
                              hint={`${selectedProjects}/${projectTotal}`}
                              expanded={expandedWorkspaceScope === "projects"}
                              onToggle={() =>
                                setExpandedWorkspaceScope((current) =>
                                  current === "projects"
                                    ? "navigation"
                                    : "projects",
                                )
                              }
                              checked={
                                workspaceScopeReadOnly
                                  ? true
                                  : workspaceDraft.includeAllProjects
                              }
                              onCheckedChange={(checked) =>
                                updateDraft({
                                  includeAllProjects: checked,
                                  projects: checked
                                    ? []
                                    : workspaceDraft.projects,
                                })
                              }
                              disabled={
                                workspaceSaving || workspaceScopeReadOnly
                              }
                            >
                              {expandedWorkspaceScope === "projects" &&
                              (workspaceScopeReadOnly ||
                                !workspaceDraft.includeAllProjects) ? (
                                <CheckList>
                                  {workspaceEditor?.projects.map((project) => {
                                    const checked =
                                      workspaceScopeReadOnly ||
                                      workspaceDraft.projects.includes(
                                        project.key,
                                      );
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
                                            disabled={
                                              workspaceSaving ||
                                              workspaceScopeReadOnly
                                            }
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
                              title={t("入口")}
                              hint={`${selectedNavigation}/${navigationTotal}`}
                              expanded={expandedWorkspaceScope === "navigation"}
                              onToggle={() =>
                                setExpandedWorkspaceScope((current) =>
                                  current === "navigation"
                                    ? "projects"
                                    : "navigation",
                                )
                              }
                              checked={
                                workspaceScopeReadOnly
                                  ? true
                                  : workspaceDraft.includeAllNavigation
                              }
                              onCheckedChange={(checked) =>
                                updateDraft({
                                  includeAllNavigation: checked,
                                  navigationCategories: checked
                                    ? []
                                    : workspaceDraft.navigationCategories,
                                  navigationEntries: checked
                                    ? []
                                    : workspaceDraft.navigationEntries,
                                })
                              }
                              disabled={
                                workspaceSaving || workspaceScopeReadOnly
                              }
                            >
                              {expandedWorkspaceScope === "navigation" &&
                              (workspaceScopeReadOnly ||
                                !workspaceDraft.includeAllNavigation) ? (
                                <CheckList>
                                  {workspaceEditor?.navigationCategories.map(
                                    (category) => {
                                      const categoryChecked =
                                        workspaceScopeReadOnly ||
                                        workspaceDraft.navigationCategories.includes(
                                          category.title,
                                        );
                                      return (
                                        <Box key={category.title}>
                                          <FormControlLabel
                                            control={
                                              <Checkbox
                                                size="small"
                                                checked={categoryChecked}
                                                onChange={(event) =>
                                                  updateDraft({
                                                    navigationCategories:
                                                      toggleStringValue(
                                                        workspaceDraft.navigationCategories,
                                                        category.title,
                                                        event.target.checked,
                                                      ),
                                                  })
                                                }
                                                disabled={
                                                  workspaceSaving ||
                                                  workspaceScopeReadOnly
                                                }
                                              />
                                            }
                                            label={category.title}
                                          />
                                          {workspaceScopeReadOnly ||
                                          !categoryChecked
                                            ? category.entries.map((entry) => {
                                                const checked =
                                                  workspaceScopeReadOnly ||
                                                  workspaceDraft.navigationEntries.includes(
                                                    entry.scopedName,
                                                  ) ||
                                                  workspaceDraft.navigationEntries.includes(
                                                    entry.name,
                                                  );
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
                                                            navigationEntries:
                                                              toggleStringValue(
                                                                workspaceDraft.navigationEntries.filter(
                                                                  (value) =>
                                                                    value !==
                                                                    entry.name,
                                                                ),
                                                                entry.scopedName,
                                                                event.target
                                                                  .checked,
                                                              ),
                                                          })
                                                        }
                                                        disabled={
                                                          workspaceSaving ||
                                                          workspaceScopeReadOnly
                                                        }
                                                      />
                                                    }
                                                    label={`${entry.name} · ${t(
                                                      navigationEntryKindLabel(
                                                        entry.kind,
                                                      ),
                                                    )}`}
                                                  />
                                                );
                                              })
                                            : null}
                                        </Box>
                                      );
                                    },
                                  )}
                                </CheckList>
                              ) : null}
                            </ScopePane>

                            <ScopePane
                              title={t("代理")}
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
                                    workspaceEditor.proxyProfiles.map(
                                      (profile) => {
                                        const checked =
                                          workspaceScopeReadOnly ||
                                          workspaceDraft.proxyProfiles.includes(
                                            profile.id,
                                          );
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
                                                    proxyProfiles:
                                                      toggleStringValue(
                                                        workspaceDraft.proxyProfiles,
                                                        profile.id,
                                                        event.target.checked,
                                                      ),
                                                  })
                                                }
                                                disabled={
                                                  workspaceSaving ||
                                                  workspaceScopeReadOnly
                                                }
                                              />
                                            }
                                            label={`${profile.name} · ${endpoint}`}
                                          />
                                        );
                                      },
                                    )
                                  ) : (
                                    <AppEmptyState
                                      compact
                                      title={t("暂无代理配置")}
                                      description={t("添加代理后可纳入工作区。")}
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
            <Button onClick={closeManageDialog}>{t("取消")}</Button>
            <Button
              variant="contained"
              startIcon={
                workspaceSaving ? (
                  <CircularProgress size={14} />
                ) : (
                  <CheckIcon fontSize="small" />
                )
              }
              onClick={() => void saveWorkspaceEditor()}
              disabled={
                !workspaceDraft ||
                workspaceDraft.system ||
                workspaceSaving ||
                !workspaceDirty
              }
            >
              {t("保存")}
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
  const { t } = useI18n();
  const translatedTitle = t(title);
  const toggleLabel = t(expanded ? "收起" : "展开");

  return (
    <Box
      className="overview-workspace-scope-pane"
      sx={(theme) => ({
        border: "1px solid",
        borderColor:
          theme.palette.mode === "dark"
            ? "rgba(143,184,234,0.1)"
            : "rgba(15,23,42,0.09)",
        borderRadius: "12px",
        overflow: "hidden",
        bgcolor:
          theme.palette.mode === "dark"
            ? "rgba(255,255,255,0.018)"
            : "rgba(255,255,255,0.66)",
      })}
    >
      <Stack
        className="overview-workspace-scope-head"
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{
          px: 0.85,
          py: 0.62,
          borderBottom: children ? "1px solid" : 0,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.55}>
          <Typography variant="caption" sx={{ fontWeight: 820 }}>
            {translatedTitle}
          </Typography>
          <Typography
            className="overview-workspace-scope-hint"
            variant="caption"
            color="text.secondary"
          >
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
              label={t("全部")}
            />
            <Tooltip title={toggleLabel}>
              <IconButton
                className="overview-workspace-scope-toggle"
                size="small"
                aria-label={`${toggleLabel}${translatedTitle}`}
                aria-expanded={expanded}
                onClick={onToggle}
              >
                {expanded ? (
                  <CollapseIcon fontSize="small" />
                ) : (
                  <ExpandIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          <Tooltip title={toggleLabel}>
            <IconButton
              className="overview-workspace-scope-toggle"
              size="small"
              aria-label={`${toggleLabel}${translatedTitle}`}
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {expanded ? (
                <CollapseIcon fontSize="small" />
              ) : (
                <ExpandIcon fontSize="small" />
              )}
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
