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
  ProjectWorkspaceEditorDraft,
  ProjectWorkspaceEditorState,
  ProjectWorkspaceSummary,
} from "../app-types";
import {
  CheckIcon,
  CollapseIcon,
  ClearIcon,
  CopyIcon,
  ExpandIcon,
  FolderIcon,
  AppWindowIcon,
  LocateIcon,
  PlayIcon,
  PlusIcon,
  ReplayIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  TerminalIcon,
  WebsiteIcon,
} from "../components/AppIcons";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppToast } from "../components/AppToast";
import { WorkspaceTypeSelect } from "../components/WorkspaceTypeSelect";
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

export type OverviewPageProps = {
  projectWorkspaces: ProjectWorkspaceSummary[];
  activeProjectWorkspaceKey: string;
  onProjectWorkspaceChange: (workspaceKey: string) => Promise<void> | void;
  onCreateProjectWorkspace: (payload: CreateProjectWorkspacePayload) => Promise<void> | void;
  onInitDemandWorkspace: (
    payload: InitDemandWorkspacePayload,
  ) => Promise<InitDemandWorkspaceResult> | InitDemandWorkspaceResult;
  onProjectConfigSaved: () => Promise<void> | void;
  onStartProxyProfile: (profileId: string) => Promise<unknown> | unknown;
  onStopProxyProfile: (profileId: string) => Promise<unknown> | unknown;
};

type WorkspacePinnedActionItem = {
  action: TrayPinnedAction;
  kindLabel: string;
  label: string;
  detail?: string | null;
  projectKey?: string | null;
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
  category: string;
  label: string;
  kind: string;
  kindLabel: string;
  value?: string | null;
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
  if (group.system) {
    items.push({ label: "全局", tone: "muted" });
  }
  if (group.projectCount === 0) {
    items.push({ label: "无项目", tone: "warning" });
  } else if (missingDirectories > 0) {
    items.push({ label: `${missingDirectories} 目录待配`, tone: "warning" });
  }
  if (group.entryCount === 0 && group.projectCount === 0 && group.proxyProfileCount === 0) {
    items.push({ label: "空工作区", tone: "warning" });
  } else if (group.entryCount === 0 && group.proxyProfileCount === 0) {
    items.push({ label: "无入口", tone: "muted" });
  }
  if (items.length === 0 && (group.actions.length > 0 || group.proxyProfileCount > 0)) {
    items.push({ label: "可执行", tone: "info" });
  }
  return items.slice(0, 3);
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
    default:
      return <LocateIcon fontSize="small" />;
  }
}

function panelSx(theme: Theme) {
  return {
    border: "1px solid",
    borderColor:
      theme.palette.mode === "dark" ? "rgba(143,184,234,0.11)" : "rgba(15,23,42,0.1)",
    borderRadius: "14px",
    bgcolor:
      theme.palette.mode === "dark" ? "rgba(13,16,21,0.52)" : "rgba(255,255,255,0.72)",
    boxShadow:
      theme.palette.mode === "dark"
        ? "inset 0 1px 0 rgba(255,255,255,0.03)"
        : "inset 0 1px 0 rgba(255,255,255,0.82), 0 1px 2px rgba(15,23,42,0.04)",
    backdropFilter: "blur(18px) saturate(1.08)",
    WebkitBackdropFilter: "blur(18px) saturate(1.08)",
  };
}

function directoryActionButtonSx(theme: Theme) {
  const isDark = theme.palette.mode === "dark";
  return {
    minHeight: 30,
    px: 1.1,
    borderRadius: "10px",
    borderColor: isDark ? "rgba(143,184,234,0.14)" : "rgba(15,23,42,0.14)",
    color: isDark ? "rgba(226,232,240,0.78)" : "#475569",
    bgcolor: isDark ? "rgba(255,255,255,0.018)" : "rgba(255,255,255,0.62)",
    fontWeight: 780,
    boxShadow: isDark ? "none" : "inset 0 1px 0 rgba(255,255,255,0.72)",
    "&:hover": {
      borderColor: alpha(theme.palette.primary.main, 0.32),
      bgcolor: alpha(theme.palette.primary.main, isDark ? 0.12 : 0.08),
    },
    "&.Mui-disabled": {
      borderColor: isDark ? "rgba(143,184,234,0.08)" : "rgba(15,23,42,0.09)",
      color: theme.palette.text.disabled,
      bgcolor: isDark ? "rgba(255,255,255,0.012)" : "rgba(241,245,249,0.68)",
    },
  };
}

export function OverviewPage({
  projectWorkspaces,
  activeProjectWorkspaceKey,
  onProjectWorkspaceChange,
  onCreateProjectWorkspace,
  onInitDemandWorkspace,
  onProjectConfigSaved,
  onStartProxyProfile,
  onStopProxyProfile,
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
      groups.filter(
        (group) =>
          (workspaceTypeFilter === "all" ||
            normalizeWorkspaceType(group.workspaceType) === workspaceTypeFilter) &&
          workspaceMatchesOverviewQuery(group, overviewQuery),
      ),
    [groups, workspaceTypeFilter, overviewQuery],
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
    ? selectedCount(workspaceDraft.projects, projectTotal, workspaceDraft.includeAllProjects)
    : 0;
  const selectedNavigation = workspaceDraft
    ? selectedCount(
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

  const loadProjectWorkspaceEditor = useCallback(async () => {
    setWorkspaceLoading(true);
    setError("");
    try {
      const nextState = await invoke<ProjectWorkspaceEditorState>("get_project_workspace_editor");
      setWorkspaceEditor(nextState);
      setWorkspaceDraft(nextState.workspace);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  const refreshWorkbench = useCallback(async () => {
    await Promise.all([loadOverview(), loadProjectWorkspaceEditor()]);
  }, [loadOverview, loadProjectWorkspaceEditor]);

  useEffect(() => {
    void refreshWorkbench();
  }, [refreshWorkbench]);

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
      await invoke("execute_tray_pinned_action", { action: item.action });
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
        await invoke("start_project_runtime", {
          project: projectKey,
          debugProfile: null,
          envOverrides: null,
        });
        setStatus(`已启动 ${directory.projectName || projectKey}`);
      }
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

  async function switchProjectWorkspace(workspaceKey: string) {
    if (!workspaceKey || workspaceKey === activeProjectWorkspaceKey) {
      return;
    }
    const workspaceName =
      projectWorkspaces.find((workspace) => workspace.key === workspaceKey)?.name ?? workspaceKey;
    if (workspaceDirty) {
      const confirmed = await confirm({
        title: "切换工作区",
        description: `当前工作区有未保存修改，设为“${workspaceName}”会丢弃修改。`,
        confirmLabel: "继续切换",
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    setError("");
    setStatus("");
    try {
      await onProjectWorkspaceChange(workspaceKey);
      await refreshWorkbench();
      setStatus(`已设为当前：${workspaceName}`);
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
        activate: true,
      });
      setNewWorkspaceName("");
      setNewWorkspaceKey("");
      setNewWorkspaceDescription("");
      setNewWorkspaceType(DEFAULT_NEW_WORKSPACE_TYPE);
      setNewWorkspaceIndependentDir(false);
      setNewWorkspaceRootDir("");
      setCopyCurrentWorkspace(true);
      setCreateOpen(false);
      await refreshWorkbench();
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
        activate: true,
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
      await refreshWorkbench();
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
    ? filteredGroups.find((group) => group.key === activeProjectWorkspaceKey) ??
      filteredGroups[0] ??
      null
    : activeGroup ?? filteredGroups[0] ?? null;
  const listedGroups = featuredGroup
    ? filteredGroups.filter((group) => group.key !== featuredGroup.key)
    : filteredGroups;

  function renderWorkspaceCard(group: WorkspacePinnedActionsOverview, featured = false) {
    const active = group.key === activeProjectWorkspaceKey;
    const collapsed = collapsedWorkspaceKeys.has(group.key);
    const stateItems = workspaceStateItems(group, active);
    const visibleResources = group.resources;
    const visibleDirectories = group.projectDirectories;
    const visibleProxyProfiles = group.proxyProfiles;
    const showDirectoryPanel = visibleDirectories.length > 0;
    const showProxyPanel = visibleProxyProfiles.length > 0;
    const showRootDirectoryShortcut = Boolean(
      group.rootDir && !showDirectoryPanel && !group.system,
    );
    const showShortcutPanel = visibleResources.length > 0 || showRootDirectoryShortcut;
    const showContentPanel = showShortcutPanel || showDirectoryPanel || showProxyPanel;
    const showActionsPanel = group.actions.length > 0;
    const showBodyPanel = showContentPanel || showActionsPanel;
    const summaryItems = [
      group.entryCount > 0 ? `${group.entryCount} 入口` : "",
      group.projectCount > 0 ? `${group.projectCount} 项目` : "",
      group.proxyProfileCount > 0 ? `${group.proxyProfileCount} 代理` : "",
      group.actionCount > 0 ? `${group.actionCount} 动作` : "",
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
              <Chip
                size="small"
                className="overview-workspace-type-chip"
                label={workspaceTypeLabel(
                  group.workspaceType,
                  group.workspaceTypeLabel,
                  workspaceTypeOptions,
                )}
              />
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
                    <Typography className="overview-section-label">入口</Typography>
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

                {showDirectoryPanel ? (
                  <div className="overview-directory-panel">
                    <Typography className="overview-section-label">项目</Typography>
                    <div className="overview-directory-list">
                      {visibleDirectories.map((directory) => {
                        const projectRunning = directory.running || directory.canStop;
                        const projectAction = projectRunning ? "stop" : "start";
                        const actionRunning =
                          runningKey ===
                          `project:${group.key}:${directory.projectKey}:${projectAction}`;
                        const canToggleProject =
                          active &&
                          Boolean(directory.projectKey) &&
                          (projectRunning || directory.canStart);
                        const projectToggleTitle = projectRunning
                          ? "停止项目"
                          : canToggleProject
                            ? "启动项目"
                            : active
                              ? "项目暂不可启动"
                              : "设为当前工作区后启动";
                        return (
                          <div
                            key={directory.projectKey}
                            className={`overview-directory-row${
                              projectRunning ? " is-running" : ""
                            }`}
                            title={directory.path ?? directory.projectName}
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
                                <small>{directory.path || "未配置"}</small>
                              </span>
                            </button>
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
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {showProxyPanel ? (
                  <div className="overview-directory-panel overview-proxy-panel">
                    <Typography className="overview-section-label">代理服务</Typography>
                    <div className="overview-directory-list overview-proxy-list">
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
              <div className="overview-actions-panel">
                <div className="overview-section-heading">
                  <Typography className="overview-section-label">动作</Typography>
                  <Chip size="small" className="overview-count-chip" label={group.actionCount} />
                </div>
                <div className="overview-action-list">
                  {group.actions.map((item) => {
                    const running = runningKey === item.action.dedupeKey;
                    const updatedAt = formatUpdatedAt(item.updatedAtMs);
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
                            <Typography className="overview-action-title" noWrap>
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

        <Box className="overview-filter-bar">
          <TextField
            className="overview-search-field"
            size="small"
            value={overviewQuery}
            onChange={(event) => setOverviewQuery(event.target.value)}
            placeholder="搜索工作区、project:、entry:、proxy:、action:"
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
          PaperProps={{
            sx: (theme) => ({
              width: "min(980px, calc(100vw - 28px))",
              height: "min(760px, calc(100vh - 40px))",
              maxHeight: "min(760px, calc(100vh - 40px))",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: "18px",
              border: "1px solid",
              borderColor:
                theme.palette.mode === "dark"
                  ? "rgba(143,184,234,0.15)"
                  : "rgba(15,23,42,0.1)",
              bgcolor:
                theme.palette.mode === "dark"
                  ? "rgba(14,18,24,0.96)"
                  : "rgba(248,250,252,0.98)",
              boxShadow:
                theme.palette.mode === "dark"
                  ? "0 28px 80px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.04)"
                  : "0 24px 64px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.92)",
            }),
          }}
        >
          <DialogTitle
            sx={(theme) => ({
              px: 1.2,
              py: 0.85,
              borderBottom: "1px solid",
              borderColor:
                theme.palette.mode === "dark" ? "rgba(143,184,234,0.1)" : "rgba(15,23,42,0.08)",
              bgcolor:
                theme.palette.mode === "dark"
                  ? "rgba(255,255,255,0.018)"
                  : "rgba(255,255,255,0.72)",
              flex: "0 0 auto",
            })}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                <Box
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
                <Stack spacing={0.1} minWidth={0}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 860, lineHeight: 1.2 }}>
                    工作区配置
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {activeGroup?.name ?? workspaceDraft?.name ?? activeProjectWorkspaceKey}
                  </Typography>
                </Stack>
                {workspaceDirty ? <Chip size="small" color="primary" label="未保存" /> : null}
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <Tooltip title="关闭">
                  <IconButton
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

          <DialogContent sx={{ p: 0, overflow: "hidden", flex: "1 1 auto", minHeight: 0, display: "flex" }}>
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
                spacing={0.8}
                sx={(theme) => ({
                  minHeight: 0,
                  overflow: "hidden",
                  p: 1,
                  borderRight: { xs: 0, md: "1px solid" },
                  borderBottom: { xs: "1px solid", md: 0 },
                  borderColor: "divider",
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.018)"
                      : "rgba(241,245,249,0.72)",
                })}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Stack spacing={0.05}>
                    <Typography variant="caption" sx={{ fontWeight: 850 }}>
                      工作区
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {projectWorkspaces.length} 个
                    </Typography>
                  </Stack>
                  <Tooltip title={createOpen ? "收起新建" : "新建工作区"}>
                    <IconButton
                      size="small"
                      color={createOpen ? "primary" : "default"}
                      onClick={() => setCreateOpen((current) => !current)}
                      aria-label={createOpen ? "收起新建工作区" : "新建工作区"}
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

                <Stack spacing={0.55} sx={{ overflow: "auto", pr: 0.15, minHeight: 0, flex: 1 }}>
                  {projectWorkspaces.map((workspace) => {
                    const group = groups.find((item) => item.key === workspace.key);
                    const active = workspace.key === activeProjectWorkspaceKey;
                    return (
                      <Box
                        key={workspace.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => void switchProjectWorkspace(workspace.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void switchProjectWorkspace(workspace.key);
                          }
                        }}
                        sx={(theme) => ({
                          cursor: active ? "default" : "pointer",
                          border: "1px solid",
                          borderColor: active
                            ? alpha(theme.palette.primary.main, 0.4)
                            : theme.palette.divider,
                          borderRadius: "12px",
                          px: 0.9,
                          py: 0.72,
                          bgcolor: active
                            ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.13 : 0.09)
                            : theme.palette.mode === "dark"
                              ? "rgba(255,255,255,0.018)"
                              : "rgba(255,255,255,0.64)",
                          boxShadow: active
                            ? `inset 2px 0 0 ${alpha(theme.palette.primary.main, 0.75)}`
                            : "none",
                        })}
                      >
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                          <Stack spacing={0.18} minWidth={0}>
                            <Stack direction="row" spacing={0.45} alignItems="center" minWidth={0}>
                              <Typography variant="body2" noWrap sx={{ fontWeight: 820 }}>
                                {workspace.name}
                              </Typography>
                              <Chip
                                size="small"
                                label={workspaceTypeLabel(
                                  workspace.workspaceType,
                                  workspace.workspaceTypeLabel,
                                  workspaceTypeOptions,
                                )}
                                sx={{
                                  height: 19,
                                  borderRadius: "7px",
                                  fontSize: "0.66rem",
                                  fontWeight: 780,
                                }}
                              />
                              {active ? <CheckIcon fontSize="small" color="primary" /> : null}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {workspace.system
                                ? "全部项目"
                                : `${workspace.projectScopeLabel} · ${workspace.navigationScopeLabel}`}
                            </Typography>
                          </Stack>
                          <Chip
                            size="small"
                            label={group?.actionCount ?? 0}
                            sx={{ height: 22, minWidth: 28, borderRadius: "999px", fontWeight: 760 }}
                          />
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Stack>

              <Stack spacing={0.95} sx={{ minHeight: 0, overflow: "auto", p: 1.05 }}>
                {createOpen ? (
                  <Box component="section" sx={panelSx}>
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

                <Box component="section" sx={panelSx}>
                  <Stack spacing={0.95} sx={{ p: 1 }}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      justifyContent="space-between"
                      alignItems={{ xs: "stretch", sm: "center" }}
                      spacing={0.75}
                    >
                      <Stack spacing={0.12} minWidth={0}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 860 }}>
                          当前工作区
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {workspaceDraft?.key ?? activeProjectWorkspaceKey}
                        </Typography>
                      </Stack>
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
                      <Alert severity="info" variant="outlined" sx={{ borderRadius: "12px" }}>
                        全局范围包含全部项目、入口和代理。
                      </Alert>
                    ) : null}

                    {workspaceDraft && !workspaceDraft.system ? (
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
                          size="small"
                          label="工作区目录"
                          value={workspaceDraft.rootDir ?? ""}
                          placeholder="可选：独立工作目录"
                          onChange={(event) => updateDraft({ rootDir: event.target.value })}
                          disabled={workspaceSaving}
                        />
                        <Stack spacing={0.65}>
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
                            checked={workspaceDraft.includeAllProjects}
                            onCheckedChange={(checked) =>
                              updateDraft({
                                includeAllProjects: checked,
                                projects: checked ? [] : workspaceDraft.projects,
                              })
                            }
                            disabled={workspaceSaving}
                          >
                            {!workspaceDraft.includeAllProjects ? (
                              <CheckList>
                                {workspaceEditor?.projects.map((project) => {
                                  const checked = workspaceDraft.projects.includes(project.key);
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
                                          disabled={workspaceSaving}
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
                            checked={workspaceDraft.includeAllNavigation}
                            onCheckedChange={(checked) =>
                              updateDraft({
                                includeAllNavigation: checked,
                                navigationCategories: checked ? [] : workspaceDraft.navigationCategories,
                                navigationEntries: checked ? [] : workspaceDraft.navigationEntries,
                              })
                            }
                            disabled={workspaceSaving}
                          >
                            {!workspaceDraft.includeAllNavigation ? (
                              <CheckList>
                                {workspaceEditor?.navigationCategories.map((category) => {
                                  const categoryChecked = workspaceDraft.navigationCategories.includes(
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
                                                    disabled={workspaceSaving}
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

                          <ScopePane title="代理" hint={`${selectedProxyProfiles}/${proxyTotal}`}>
                            <CheckList maxHeight={150}>
                              {workspaceEditor?.proxyProfiles.length ? (
                                workspaceEditor.proxyProfiles.map((profile) => {
                                  const checked = workspaceDraft.proxyProfiles.includes(profile.id);
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
                                          disabled={workspaceSaving}
                                        />
                                      }
                                      label={`${profile.name} · ${endpoint}`}
                                    />
                                  );
                                })
                              ) : (
                                <AppEmptyState compact title="暂无代理配置" description="添加代理后可纳入工作区。" />
                              )}
                            </CheckList>
                          </ScopePane>
                        </Stack>
                      </>
                    ) : null}
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </DialogContent>

          <DialogActions
            sx={(theme) => ({
              px: 1.25,
              py: 0.85,
              borderTop: "1px solid",
              borderColor:
                theme.palette.mode === "dark" ? "rgba(143,184,234,0.1)" : "rgba(15,23,42,0.08)",
              bgcolor:
                theme.palette.mode === "dark"
                  ? "rgba(255,255,255,0.014)"
                  : "rgba(255,255,255,0.74)",
              flex: "0 0 auto",
            })}
          >
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
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  title: string;
  hint: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Box
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
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Stack>
        {typeof checked === "boolean" && onCheckedChange ? (
          <FormControlLabel
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
        ) : null}
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
