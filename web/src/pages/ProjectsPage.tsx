import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type UIEvent,
} from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import type {
  AppExitRuntimePolicy,
  CreateProjectWorkspacePayload,
  FinderEntry,
  FinderShortcutItem,
  LinkExecutionReport,
  LinkSummary,
  LinkPlan,
  NavigationEditorEntry,
  NavigationEditorState,
  ProjectDebugProfileSummary,
  ProjectWorkspaceSummary,
  ProjectWorkflowAction,
  ProjectRuntimeEntry,
  ProjectRuntimeLogKind,
  ProjectRuntimeLogResponse,
  ProjectRuntimeLogSessionSummary,
  ProjectRuntimePreflightCheck,
  ProjectRuntimePreflightResponse,
  ProjectRuntimeReadySummary,
  ProxyProfile,
  RuntimeProfileDraft,
} from "../app-types";
import type { AppStyleMode } from "../theme";
import {
  AppWindowIcon,
  CheckIcon,
  ClearIcon,
  CopyIcon,
  EditIcon,
  FolderIcon,
  MoreIcon,
  OpenExternalIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ReplayIcon,
  SettingsIcon,
  StarIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  WebsiteIcon,
  WorkflowIcon,
} from "../components/AppIcons";
import { AppEmptyState } from "../components/AppEmptyState";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { AppListEndState } from "../components/AppListEndState";
import {
  LinkPlanDialog,
  type LinkPlanDialogAction,
  type LinkPlanDialogState,
} from "../components/LinkPlanDialog";
import { SettingsPanel } from "../components/SettingsPanel";
import { ConfigSourceBar } from "../components/ConfigSourceBar";
import { ConfigSourceManagerDialog } from "../components/ConfigSourceManagerDialog";
import { WorkflowLinkSummaryButton } from "../components/WorkflowLinkButton";
import {
  WorkspacePageToolbar,
  WorkspacePageToolbarAction,
  type WorkspacePageMetric,
} from "../components/WorkspacePageToolbar";
import {
  WorkflowLinksDialog,
  type WorkflowLinkListItem,
} from "../components/WorkflowLinksDialog";
import { WorkflowRulesConfigDialog } from "../components/WorkflowRulesConfigDialog";
import {
  RuntimePanelDrawer,
  WebActionsPanel,
  type WebActionsDialogContext,
} from "../components/WebActionsDialog";
import {
  defaultSignalIdForReplay,
  workflowProjectActionLabel,
  workflowReplayFromProjectRuntime,
  type WorkflowBroadcastRule,
  type WorkflowReceiveRule,
} from "../lib/workflowSignals";
import { useConfigSource } from "../hooks/useConfigSource";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";
import { useRuntimeProfiles } from "../hooks/useRuntimeProfiles";

type FinderType = "项目" | "网站" | "目录" | "工具";
type ProjectsPageMode = "projectManagement" | "resources";
type RuntimePanelTab = "overview" | "config" | "logs" | "webActions";
type ProjectConfigPanelPageKey =
  | "overview"
  | "projectManagement"
  | "resources"
  | "merge"
  | "build"
  | "proxy";
type ProjectConfigPanelProps = {
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
  activePage: ProjectConfigPanelPageKey;
  enabledPages: ProjectConfigPanelPageKey[];
  onEnabledPagesChange: (pages: ProjectConfigPanelPageKey[]) => void;
  defaultPage: ProjectConfigPanelPageKey;
  onDefaultPageChange: (page: ProjectConfigPanelPageKey) => void;
  onProjectConfigSaved: () => Promise<void> | void;
};

const FINDER_LOAD_BATCH_SIZE = 20;

type RuntimeLogState = {
  projectKey: string;
  kind: ProjectRuntimeLogKind;
  path: string;
  lines: string[];
  truncated: boolean;
  readySummary: ProjectRuntimeReadySummary;
  sessionSummary: ProjectRuntimeLogSessionSummary;
  loading: boolean;
  error: string;
};

type RuntimePreflightState = {
  projectKey: string;
  debugProfileKey: string;
  response: ProjectRuntimePreflightResponse | null;
  loading: boolean;
  error: string;
};

const EMPTY_RUNTIME_READY_SUMMARY: ProjectRuntimeReadySummary = {
  enabled: false,
  ready: false,
  failed: false,
  statusKey: "disabled",
  statusLabel: "未启用",
  detail: null,
  url: null,
  localUrl: null,
  networkUrl: null,
};

const EMPTY_RUNTIME_SESSION_SUMMARY: ProjectRuntimeLogSessionSummary = {
  active: false,
  runId: null,
  projectKey: null,
  kind: null,
  startedAtMs: null,
  cwd: null,
  command: null,
  pid: null,
  currentLineCount: 0,
  totalLineCount: 0,
};

export type ProjectsPageProps = {
  mode: ProjectsPageMode;
  finderTypeOptions: readonly FinderType[];
  finderType: FinderType;
  finderTypeCounts: Record<FinderType, number>;
  onFinderTypeChange: (value: FinderType) => void;
  finderCategories: string[];
  finderCategory: string;
  finderCategoryCounts: Record<string, number>;
  onFinderCategoryChange: (value: string) => void;
  finderQuery: string;
  onFinderQueryChange: (value: string) => void;
  runtimeEntries: ProjectRuntimeEntry[];
  filteredRuntimeEntries: ProjectRuntimeEntry[];
  shortcutEntries: FinderShortcutItem[];
  filteredShortcutEntries: FinderShortcutItem[];
  favoriteProjectKeys: string[];
  recentProjectKeys: string[];
  favoriteShortcutKeys: string[];
  recentShortcutKeys: string[];
  selectedDebugProfileKeys: Record<string, string>;
  workflowReceiveRules: WorkflowReceiveRule[];
  workflowBroadcastRules: WorkflowBroadcastRule[];
  workflowSignalOptions: string[];
  workflowSignalSummaries: WorkflowSignalSummary[];
  workflowReceiveSignalIdsForProjectReplay: (
    entry: ProjectRuntimeEntry,
    action: ProjectWorkflowAction,
  ) => string[];
  workflowBroadcastSignalIdsForProjectReplay: (
    entry: ProjectRuntimeEntry,
    action: ProjectWorkflowAction,
  ) => string[];
  onWorkflowProjectReplayRulesChange: (
    entry: ProjectRuntimeEntry,
    action: ProjectWorkflowAction,
    value: {
      receiveSignalIds: string[];
      broadcastSignalIds: string[];
    },
  ) => void;
  onWorkflowReceiveRulesEnabledChange: (ruleIds: string[], enabled: boolean) => void;
  onWorkflowReceiveRulesDelete: (ruleIds: string[]) => void;
  onWorkflowBroadcastRulesEnabledChange: (ruleIds: string[], enabled: boolean) => void;
  onWorkflowBroadcastRulesDelete: (ruleIds: string[]) => void;
  onWorkflowSignalDelete: (signalId: string) => void;
  onWorkflowSignalsClear: () => void;
  onToggleProjectFavorite: (projectKey: string) => void;
  onToggleShortcutFavorite: (item: FinderShortcutItem) => void;
  onProjectDebugProfileChange: (projectKey: string, profileKey: string) => void;
  onMarkShortcutUsed: (item: FinderShortcutItem) => void;
  onRefresh: () => void;
  onOpenFinderEntry: (entry: FinderEntry) => Promise<boolean> | boolean;
  onStartRuntime: (
    projectKey: string,
    debugProfileKey?: string,
    envOverrides?: Record<string, string>,
  ) => void;
  onStopRuntime: (projectKey: string) => void;
  onAdoptRuntime: (projectKey: string, debugProfileKey?: string) => void;
  onOpenBuildOutput: (projectKey: string) => void;
  onFocusRuntime: (projectKey: string, debugProfileKey?: string) => void;
  onOpenProjectDirectory: (projectKey: string) => void;
  onOpenResourceConfig?: () => void;
  configWorkspaceKey?: string;
  projectConfigPanel?: ProjectConfigPanelProps;
};

const SHORTCUT_CONFIRM_MS = 1100;
const RUNTIME_LOG_MAX_LINES = 120;
const RUNTIME_LOG_AUTO_REFRESH_ACTIVE_MS = 2000;
const RUNTIME_LOG_AUTO_REFRESH_READY_MS = 6000;
const DEFAULT_RUNTIME_PROFILE_VALUE = "__default__";
const RUNTIME_PROXY_MANUAL_VALUE = "__manual__";
const PROJECT_WORKFLOW_ACTIONS: ProjectWorkflowAction[] = [
  "project.runtime.start",
  "project.runtime.stop",
  "project.build.run",
  "project.build.stop",
  "project.build.openOutput",
  "project.runtime.focus",
  "project.openDirectory",
];

type RuntimeEnvParseResult = {
  values: Record<string, string>;
  error: string;
};

type RuntimeProfileDialogState = {
  mode: "create" | "edit";
  index: number;
  draft: RuntimeProfileDraft;
};

function formatRuntimeEnvText(env?: Record<string, string> | null) {
  if (!env) {
    return "";
  }
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseRuntimeEnvText(text: string): RuntimeEnvParseResult {
  const values: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const [index, sourceLine] of lines.entries()) {
    let line = sourceLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      return {
        values: {},
        error: `第 ${index + 1} 行缺少 =`,
      };
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return {
        values: {},
        error: `第 ${index + 1} 行变量名无效`,
      };
    }
    values[key] = value;
  }
  return { values, error: "" };
}

function uniqueRuntimeProfileKey(profiles: RuntimeProfileDraft[]) {
  const existing = new Set(profiles.map((profile) => profile.key.trim()));
  let index = profiles.length + 1;
  let key = `runtime-${index}`;
  while (existing.has(key)) {
    index += 1;
    key = `runtime-${index}`;
  }
  return key;
}

function emptyRuntimeProfileDraft(profiles: RuntimeProfileDraft[]): RuntimeProfileDraft {
  const key = uniqueRuntimeProfileKey(profiles);
  return {
    key,
    label: "通用运行配置",
    browser: "Google Chrome",
    browserProfile: null,
    browserUserDataDir: "",
    webActionsEnabled: false,
    webActionsPort: 9223,
    webActionsUserDataDir: "",
    browserArgsText: "",
    proxyUrl: "",
    rdevProxyProfileId: null,
    proxyBypass: "localhost;127.0.0.1;::1",
    hostResolverRulesText: "MAP app.example.test 127.0.0.1",
    networkProxy: {
      enabled: false,
      proxyUrl: "",
      injectEnv: true,
      nodeHook: false,
      noProxy: "localhost,127.0.0.1,::1",
    },
  };
}

function proxyProfileListenUrl(profile: ProxyProfile) {
  return `http://${profile.listenHost}:${profile.listenPort}`;
}

function proxyProfileLabel(profile: ProxyProfile) {
  return profile.name || profile.id;
}

function projectSelectedProfileKey(
  item: ProjectRuntimeEntry,
  selectedDebugProfileKeys: Record<string, string>,
) {
  const candidate = selectedDebugProfileKeys[item.key] ?? "";
  return item.debugProfiles.some((profile) => profile.key === candidate)
    ? candidate
    : "";
}

function findDebugProfile(
  profiles: ProjectDebugProfileSummary[],
  profileKey: string,
) {
  return profiles.find((profile) => profile.key === profileKey) ?? null;
}

function projectRuntimeWebActionEntry(
  item: ProjectRuntimeEntry,
  url: string,
  runtimeProfile?: string | null,
): FinderEntry {
  return {
    name: item.name,
    kind: "url",
    targetLabel: item.category || "项目",
    url,
    browser: null,
    browserProfile: null,
    runtimeProfile: runtimeProfile?.trim() || null,
    bundleId: null,
    appName: null,
    script: null,
    path: null,
    cwd: item.cwd || item.repoPath || null,
    note: "项目调试页面",
  };
}

function insertWebActionContextParam(
  params: Record<string, string>,
  key: string,
  value?: string | number | null,
) {
  const normalized = String(value ?? "").trim();
  if (normalized) {
    params[key] = normalized;
  }
}

function buildProjectWebActionContextParams(
  item: ProjectRuntimeEntry,
  url: string,
  debugProfile: ProjectDebugProfileSummary | null,
  runtimeProfile: RuntimeProfileDraft | null,
) {
  const params: Record<string, string> = {};
  insertWebActionContextParam(params, "project.key", item.key);
  insertWebActionContextParam(params, "project.name", item.name);
  insertWebActionContextParam(params, "project.category", item.category);
  insertWebActionContextParam(params, "project.repoPath", item.repoPath);
  insertWebActionContextParam(params, "project.repo_path", item.repoPath);
  insertWebActionContextParam(params, "project.cwd", item.cwd);
  insertWebActionContextParam(params, "project.command", item.command);
  insertWebActionContextParam(params, "project.focusUrl", item.focusUrl);
  insertWebActionContextParam(params, "project.focus_url", item.focusUrl);
  insertWebActionContextParam(params, "project.readyUrl", url);
  insertWebActionContextParam(params, "project.ready_url", url);
  insertWebActionContextParam(params, "context.url", url);

  if (debugProfile) {
    insertWebActionContextParam(params, "debugProfile.key", debugProfile.key);
    insertWebActionContextParam(params, "debug_profile.key", debugProfile.key);
    insertWebActionContextParam(params, "debugProfile.label", debugProfile.label);
    insertWebActionContextParam(params, "debug_profile.label", debugProfile.label);
    insertWebActionContextParam(
      params,
      "debugProfile.runtimeProfile",
      debugProfile.runtimeProfile,
    );
    insertWebActionContextParam(
      params,
      "debug_profile.runtime_profile",
      debugProfile.runtimeProfile,
    );
    Object.entries(debugProfile.env ?? {}).forEach(([key, value]) => {
      insertWebActionContextParam(params, `debugProfile.env.${key}`, value);
      insertWebActionContextParam(params, `debug_profile.env.${key}`, value);
    });
  }

  if (runtimeProfile) {
    insertWebActionContextParam(params, "runtimeProfile.key", runtimeProfile.key);
    insertWebActionContextParam(params, "runtime_profile.key", runtimeProfile.key);
    insertWebActionContextParam(params, "runtimeProfile.label", runtimeProfile.label);
    insertWebActionContextParam(params, "runtime_profile.label", runtimeProfile.label);
    insertWebActionContextParam(
      params,
      "runtimeProfile.webActionsPort",
      runtimeProfile.webActionsPort,
    );
    insertWebActionContextParam(
      params,
      "runtime_profile.web_actions_port",
      runtimeProfile.webActionsPort,
    );
    insertWebActionContextParam(params, "runtimeProfile.proxyUrl", runtimeProfile.proxyUrl);
    insertWebActionContextParam(params, "runtime_profile.proxy_url", runtimeProfile.proxyUrl);
  }

  return params;
}

function groupWorkflowRules(
  rules: Array<WorkflowReceiveRule | WorkflowBroadcastRule>,
  ruleKind: "receive" | "broadcast",
): WorkflowLinkListItem[] {
  const groups = new Map<string, WorkflowLinkListItem & { enabledCount: number }>();

  for (const rule of rules) {
    const groupKey = rule.replayKey || rule.id;
    const current = groups.get(groupKey) ?? {
      key: `${ruleKind}:${groupKey}`,
      title: rule.label || rule.signalId,
      kind: ruleKind === "receive" ? "Receive" : "Broadcast",
      ruleKind,
      signalIds: [] as string[],
      enabled: false,
      enabledCount: 0,
      ruleIds: [] as string[],
    };
    current.ruleIds.push(rule.id);
    current.signalIds.push(rule.signalId);
    if (rule.enabled) {
      current.enabledCount += 1;
    }
    current.enabled = current.enabledCount === current.ruleIds.length;
    groups.set(groupKey, current);
  }

  return Array.from(groups.values()).map(({ enabledCount: _, ...item }) => ({
    ...item,
    signalIds: Array.from(new Set(item.signalIds)),
  }));
}

function buildStatusPalette(statusKey: string, mono: boolean) {
  if (!mono) {
    switch (statusKey) {
      case "running":
        return {
          dot: "#3f6b4f",
          pillBg: "rgba(63, 107, 79, 0.1)",
          pillBorder: "rgba(63, 107, 79, 0.18)",
          pillColor: "#2f5a3d",
        };
      case "external":
        return {
          dot: "#4f72a8",
          pillBg: "rgba(79, 114, 168, 0.1)",
          pillBorder: "rgba(79, 114, 168, 0.2)",
          pillColor: "#345d96",
        };
      case "notConfigured":
        return {
          dot: "#b78334",
          pillBg: "rgba(183, 131, 52, 0.1)",
          pillBorder: "rgba(183, 131, 52, 0.16)",
          pillColor: "#8d5d17",
        };
      case "succeeded":
        return {
          dot: "#6c9075",
          pillBg: "rgba(108, 144, 117, 0.1)",
          pillBorder: "rgba(108, 144, 117, 0.16)",
          pillColor: "#41634a",
        };
      case "invalidConfig":
      case "exited":
      case "failed":
        return {
          dot: "#c16b76",
          pillBg: "rgba(193, 107, 118, 0.1)",
          pillBorder: "rgba(193, 107, 118, 0.16)",
          pillColor: "#8e3f4b",
        };
      default:
        return {
          dot: "rgba(63, 72, 87, 0.28)",
          pillBg: "rgba(63, 72, 87, 0.04)",
          pillBorder: "rgba(63, 72, 87, 0.08)",
          pillColor: "rgba(54, 63, 77, 0.68)",
        };
    }
  }

  switch (statusKey) {
    case "running":
      return {
        dot: "#5f8068",
        pillBg: "rgba(95, 128, 104, 0.14)",
        pillBorder: "rgba(95, 128, 104, 0.24)",
        pillColor: "#c6d8c9",
      };
    case "external":
      return {
        dot: "#7fa7e4",
        pillBg: "rgba(88, 137, 214, 0.14)",
        pillBorder: "rgba(107, 157, 232, 0.24)",
        pillColor: "#c8dbf8",
      };
    case "notConfigured":
      return {
        dot: "#c9ab72",
        pillBg: "rgba(201, 171, 114, 0.11)",
        pillBorder: "rgba(201, 171, 114, 0.16)",
        pillColor: "#e8d4a8",
      };
    case "succeeded":
      return {
        dot: "#b8d7bf",
        pillBg: "rgba(184, 215, 191, 0.12)",
        pillBorder: "rgba(184, 215, 191, 0.18)",
        pillColor: "#d9ecdd",
      };
    case "invalidConfig":
    case "exited":
    case "failed":
      return {
        dot: "#c98f99",
        pillBg: "rgba(201, 143, 153, 0.11)",
        pillBorder: "rgba(201, 143, 153, 0.16)",
        pillColor: "#ebc5cb",
      };
    default:
      return {
        dot: "rgba(229, 233, 240, 0.32)",
        pillBg: "rgba(229, 233, 240, 0.035)",
        pillBorder: "rgba(229, 233, 240, 0.055)",
        pillColor: "rgba(234, 238, 244, 0.68)",
      };
  }
}

function buildPreflightPalette(statusKey: string, mono: boolean) {
  switch (statusKey) {
    case "ok":
      return buildStatusPalette("succeeded", mono);
    case "warning":
      return buildStatusPalette("notConfigured", mono);
    case "error":
      return buildStatusPalette("failed", mono);
    default:
      return buildStatusPalette("idle", mono);
  }
}

function preflightPriority(check: ProjectRuntimePreflightCheck) {
  switch (check.statusKey) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "ok":
      return 2;
    default:
      return 3;
  }
}

function buildProjectsTone(mono: boolean) {
  const shared = {
    outerBorder: "var(--line)",
    outerBg: "var(--panel)",
    outerColor: "var(--text)",
    outerShadow: "var(--shadow)",
    outerOverlay: "transparent",
    topDivider: "var(--line-soft)",
    stageOverlay: "transparent",
    searchInputFocusBorder: "var(--accent-border)",
    categoryChipActiveBg: "var(--accent-soft)",
    categoryChipActiveBorder: "var(--accent-border)",
    startButtonBg: "var(--accent)",
    startButtonColor: "#ffffff",
    startButtonBorder: "var(--accent-border)",
    startButtonHoverBg: "var(--accent-hover)",
  };

  if (mono) {
    return {
      ...shared,
      statChipPrimaryBg: "rgba(255,255,255,0.026)",
      statChipPrimaryColor: "rgba(232,236,242,0.54)",
      statChipPrimaryBorder: "var(--line-soft)",
      statChipSecondaryBg: "rgba(255,255,255,0.018)",
      statChipSecondaryColor: "rgba(225,230,237,0.42)",
      statChipSecondaryBorder: "var(--line-soft)",
      menuBg: "rgba(17,21,27,0.96)",
      menuBorder: "rgba(226,232,240,0.13)",
      menuShadow:
        "0 22px 52px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.035)",
      toolButtonColor: "rgba(226,238,250,0.72)",
      toolButtonBorder: "rgba(156,185,220,0.14)",
      toolButtonBg: "rgba(143,184,234,0.06)",
      toolButtonHoverColor: "rgba(248,251,255,0.94)",
      toolButtonHoverBg: "rgba(143,184,234,0.12)",
      toolButtonHoverBorder: "rgba(182,210,244,0.26)",
      stageBorder: "var(--line-soft)",
      stageBg: "rgba(255,255,255,0.012)",
      stageShadow:
        "inset 0 1px 0 rgba(255,255,255,0.022), inset 0 -1px 0 rgba(0,0,0,0.18)",
      searchWrapBorder: "var(--line-soft)",
      searchWrapBg: "rgba(255,255,255,0.012)",
      searchWrapShadow: "inset 0 1px 0 rgba(255,255,255,0.012)",
      searchInputBg: "rgba(255,255,255,0.018)",
      searchInputColor: "var(--text)",
      searchInputBorder: "var(--line-soft)",
      searchInputHoverBorder: "var(--line)",
      searchPlaceholder: "rgba(225,230,237,0.34)",
      clearButtonColor: "rgba(228,233,240,0.54)",
      clearButtonBorder: "var(--line-soft)",
      clearButtonBg: "rgba(255,255,255,0.014)",
      clearButtonHoverBg: "rgba(255,255,255,0.028)",
      clearButtonHoverBorder: "var(--line)",
      categoryChipBg: "rgba(255,255,255,0.018)",
      categoryChipColor: "rgba(225,230,237,0.58)",
      categoryChipBorder: "var(--line-soft)",
      categoryChipHoverBg: "rgba(255,255,255,0.032)",
      categoryChipActiveColor: "#eaf4ff",
      successPillBg: "rgba(115, 185, 143, 0.12)",
      successPillColor: "rgba(204, 238, 216, 0.88)",
      successPillBorder: "rgba(115, 185, 143, 0.22)",
      dangerPillBg: "rgba(216, 116, 130, 0.12)",
      dangerPillColor: "rgba(244, 202, 208, 0.9)",
      dangerPillBorder: "rgba(216, 116, 130, 0.22)",
      emptyBorder: "var(--line-soft)",
      emptyBg: "rgba(255,255,255,0.018)",
      emptyShadow: "inset 0 1px 0 rgba(255,255,255,0.014)",
      emptyText: "var(--muted)",
      rowBorderStrong: "var(--line)",
      rowBorder: "var(--line-soft)",
      rowBgEven: "rgba(255,255,255,0.02)",
      rowBgOdd: "rgba(255,255,255,0.012)",
      rowShadow: "inset 0 1px 0 rgba(255,255,255,0.012)",
      rowHoverBorder: "var(--accent-border)",
      rowHoverBg: "var(--accent-soft)",
      rowHoverShadow: "inset 0 1px 0 rgba(255,255,255,0.016)",
      rowTitle: "var(--text)",
      rowKey: "rgba(214,220,228,0.36)",
      rowMeta: "rgba(218,224,232,0.5)",
      rowHint: "rgba(226,229,234,0.46)",
      actionGroupBorder: "rgba(156,185,220,0.13)",
      actionGroupBg: "rgba(143,184,234,0.045)",
      actionGroupShadow: "inset 0 1px 0 rgba(255,255,255,0.022)",
      startButtonDisabledColor: "rgba(225,230,237,0.28)",
      stopButtonBg: "rgba(143,184,234,0.08)",
      stopButtonColor: "rgba(235,242,250,0.82)",
      stopButtonBorder: "rgba(156,185,220,0.18)",
      stopButtonHoverBg: "rgba(143,184,234,0.14)",
      stopButtonDisabledColor: "rgba(225,230,237,0.2)",
      buildButtonBg: "rgba(143,184,234,0.07)",
      buildButtonColor: "rgba(238,245,252,0.84)",
      buildButtonBorder: "rgba(156,185,220,0.17)",
      buildButtonHoverBg: "rgba(143,184,234,0.13)",
      buildButtonBusyBg: "rgba(143,184,234,0.12)",
      buildButtonBusyColor: "rgba(236,244,252,0.72)",
      buildButtonDisabledColor: "rgba(225,230,237,0.2)",
      runningDotHalo: "0 0 0 4px rgba(95,128,104,0.16)",
      mobileMeta: "rgba(218,224,232,0.44)",
    };
  }

  return {
    ...shared,
    statChipPrimaryBg: "rgba(92,112,133,0.075)",
    statChipPrimaryColor: "rgba(51,59,73,0.66)",
    statChipPrimaryBorder: "rgba(52,76,96,0.1)",
    statChipSecondaryBg: "rgba(92,112,133,0.045)",
    statChipSecondaryColor: "rgba(70,80,96,0.54)",
    statChipSecondaryBorder: "rgba(52,76,96,0.08)",
    menuBg: "rgba(248,251,255,0.96)",
    menuBorder: "rgba(52,76,96,0.16)",
    menuShadow:
      "0 22px 52px rgba(28,48,68,0.18), inset 0 1px 0 rgba(255,255,255,0.72)",
    toolButtonColor: "rgba(64,72,84,0.58)",
    toolButtonBorder: "rgba(52,76,96,0.09)",
    toolButtonBg: "rgba(246,249,252,0.42)",
    toolButtonHoverColor: "rgba(35,40,53,0.82)",
    toolButtonHoverBg: "rgba(246,249,252,0.62)",
    toolButtonHoverBorder: "rgba(52,76,96,0.14)",
    stageBorder: "rgba(84,111,140,0.18)",
    stageBg: "rgba(238,245,252,0.78)",
    stageShadow:
      "inset 0 1px 0 rgba(255,255,255,0.72), 0 18px 44px rgba(31,55,90,0.075)",
    stageOverlay:
      "linear-gradient(180deg, rgba(255,255,255,0.52), rgba(255,255,255,0.08) 36%, rgba(219,232,246,0.08) 100%)",
    searchWrapBorder: "rgba(84,111,140,0.18)",
    searchWrapBg: "rgba(250,253,255,0.78)",
    searchWrapShadow:
      "inset 0 1px 0 rgba(255,255,255,0.82), 0 10px 26px rgba(31,55,90,0.055)",
    searchInputBg: "rgba(255,255,255,0.94)",
    searchInputColor: "var(--text)",
    searchInputBorder: "rgba(84,111,140,0.16)",
    searchInputHoverBorder: "rgba(66,96,130,0.24)",
    searchPlaceholder: "rgba(92,104,118,0.52)",
    clearButtonColor: "rgba(75,87,104,0.64)",
    clearButtonBorder: "rgba(84,111,140,0.16)",
    clearButtonBg: "rgba(246,250,254,0.86)",
    clearButtonHoverBg: "rgba(255,255,255,0.96)",
    clearButtonHoverBorder: "rgba(66,96,130,0.25)",
    categoryChipBg: "rgba(255,255,255,0.68)",
    categoryChipColor: "rgba(70,84,102,0.72)",
    categoryChipBorder: "rgba(84,111,140,0.15)",
    categoryChipHoverBg: "rgba(255,255,255,0.92)",
    categoryChipActiveBg: "rgba(228,238,249,0.94)",
    categoryChipActiveColor: "rgba(66,88,112,0.95)",
    categoryChipActiveBorder: "rgba(110,139,172,0.32)",
    successPillBg: "rgba(222, 246, 230, 0.84)",
    successPillColor: "rgba(42, 104, 68, 0.86)",
    successPillBorder: "rgba(88, 158, 112, 0.22)",
    dangerPillBg: "rgba(252, 232, 235, 0.86)",
    dangerPillColor: "rgba(150, 58, 72, 0.86)",
    dangerPillBorder: "rgba(194, 88, 104, 0.22)",
    emptyBorder: "rgba(84,111,140,0.15)",
    emptyBg: "rgba(250,253,255,0.72)",
    emptyShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 10px 26px rgba(31,55,90,0.045)",
    emptyText: "var(--muted)",
    rowBorderStrong: "rgba(84,111,140,0.22)",
    rowBorder: "rgba(84,111,140,0.15)",
    rowBgEven:
      "linear-gradient(180deg, rgba(255,255,255,0.82), rgba(248,252,255,0.84) 72%), rgba(245,250,255,0.88)",
    rowBgOdd:
      "linear-gradient(180deg, rgba(255,255,255,0.76), rgba(246,251,255,0.8) 72%), rgba(243,249,255,0.82)",
    rowShadow:
      "inset 0 1px 0 rgba(255,255,255,0.86), 0 12px 28px rgba(31,55,90,0.06)",
    rowHoverBorder: "rgba(76,111,151,0.28)",
    rowHoverBg:
      "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,252,255,0.9) 72%), rgba(247,251,255,0.96)",
    rowHoverShadow:
      "inset 0 1px 0 rgba(255,255,255,0.96), 0 16px 34px rgba(31,55,90,0.09)",
    rowTitle: "var(--text)",
    rowKey: "rgba(90,98,112,0.6)",
    rowMeta: "rgba(83,92,106,0.72)",
    rowHint: "rgba(92,100,112,0.7)",
    actionGroupBorder: "rgba(84,111,140,0.16)",
    actionGroupBg: "rgba(248,252,255,0.78)",
    actionGroupShadow:
      "inset 0 1px 0 rgba(255,255,255,0.78), 0 4px 12px rgba(31,55,90,0.045)",
    startButtonDisabledColor: "rgba(120,126,136,0.32)",
    stopButtonBg: "rgba(248,252,255,0.86)",
    stopButtonColor: "rgba(52,60,74,0.76)",
    stopButtonBorder: "rgba(84,111,140,0.16)",
    stopButtonHoverBg: "rgba(255,255,255,0.98)",
    stopButtonDisabledColor: "rgba(120,126,136,0.24)",
    buildButtonBg: "rgba(246,249,252,0.46)",
    buildButtonColor: "rgba(52,60,74,0.8)",
    buildButtonBorder: "rgba(52,76,96,0.09)",
    buildButtonHoverBg: "rgba(246,249,252,0.68)",
    buildButtonBusyBg: "rgba(246,249,252,0.56)",
    buildButtonBusyColor: "rgba(52,60,74,0.62)",
    buildButtonDisabledColor: "rgba(120,126,136,0.24)",
    runningDotHalo: "0 0 0 4px rgba(63,107,79,0.14)",
    mobileMeta: "rgba(83,92,106,0.7)",
  };
}

function finderPlaceholder(type: FinderType): string {
  switch (type) {
    case "网站":
      return "搜索网站、地址或备注";
    case "目录":
      return "搜索目录、路径或备注";
    case "工具":
      return "搜索应用、脚本、Link 或备注";
    default:
      return "搜索项目、路径、命令";
  }
}

function compareMarkedFirst(leftMarked: boolean, rightMarked: boolean) {
  return Number(rightMarked) - Number(leftMarked);
}

function buildRuntimeHaystack(item: ProjectRuntimeEntry): string {
  return [
    item.name,
    item.key,
    item.category,
    item.repoPath ?? "",
    item.command ?? "",
    item.cwd ?? "",
    item.buildCommand ?? "",
    item.buildCwd ?? "",
    item.statusLabel,
    item.detail,
    item.buildStatusLabel,
    item.buildDetail,
  ]
    .join(" ")
    .toLowerCase();
}

function finderEntryKindLabel(kind: string): string {
  switch (kind) {
    case "app":
      return "应用";
    case "script":
      return "脚本";
    case "tool":
      return "工具";
    case "directory":
      return "目录";
    default:
      return "网站";
  }
}

function finderEntryIconVariant(entry: FinderEntry): string {
  const kind = (entry.kind || "website").toLowerCase();
  if (kind === "tool") {
    const tool = (entry.tool || "link").toLowerCase();
    const action = (entry.toolAction || "").toLowerCase();
    if (tool === "link") {
      return "link";
    }
    if (tool.includes("build") || tool.includes("package") || action.includes("build")) {
      return "package";
    }
    if (tool.includes("script") || tool.includes("command") || action.includes("run")) {
      return "script";
    }
    return "tool";
  }
  if (kind === "directory") {
    return "directory";
  }
  if (kind === "app") {
    return "app";
  }
  if (kind === "script") {
    return "script";
  }
  return "website";
}

function FinderEntryIcon({ kind, entry }: { kind: string; entry?: FinderEntry }) {
  const variant = entry ? finderEntryIconVariant(entry) : kind;
  switch (variant) {
    case "app":
      return <AppWindowIcon fontSize="inherit" />;
    case "script":
      return <TerminalIcon fontSize="inherit" />;
    case "link":
      return <WorkflowIcon fontSize="inherit" />;
    case "package":
      return <PackageIcon fontSize="inherit" />;
    case "tool":
      return <SettingsIcon fontSize="inherit" />;
    case "directory":
      return <FolderIcon fontSize="inherit" />;
    default:
      return <WebsiteIcon fontSize="inherit" />;
  }
}

function finderEntryActionIcon(kind: string) {
  switch (kind) {
    case "app":
    case "script":
    case "tool":
      return <PlayIcon fontSize="small" />;
    default:
      return <OpenExternalIcon fontSize="small" />;
  }
}

function finderTypeIcon(type: FinderType): ReactElement {
  switch (type) {
    case "网站":
      return <WebsiteIcon fontSize="small" />;
    case "目录":
      return <FolderIcon fontSize="small" />;
    case "工具":
      return <TerminalIcon fontSize="small" />;
    default:
      return <PackageIcon fontSize="small" />;
  }
}

function buildFinderEntryDetails(item: FinderShortcutItem): string[] {
  const entry = item.entry;
  const detailLines: string[] = [
    `${finderEntryKindLabel(entry.kind)} · ${item.categoryLabel || item.categoryTitle}`,
  ];
  const seen = new Set(detailLines);
  const addDetail = (label: string, value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized) {
      return;
    }
    const line = `${label}：${normalized}`;
    if (!seen.has(line)) {
      seen.add(line);
      detailLines.push(line);
    }
  };

  addDetail("说明", entry.note);
  addDetail("目标", entry.targetLabel);
  addDetail("地址", entry.url);
  addDetail("浏览器", entry.browser);
  addDetail("Profile", entry.browserProfile);
  addDetail("运行配置", entry.runtimeProfile);
  addDetail("Bundle ID", entry.bundleId);
  addDetail("应用", entry.appName);
  addDetail("脚本", entry.script);
  addDetail("工具", entry.tool);
  addDetail("Link Key", entry.toolKey);
  addDetail("动作", entry.toolAction);
  addDetail("路径", entry.path);
  addDetail("工作目录", entry.cwd);

  return detailLines;
}

function isLinkToolEntry(entry: FinderEntry): boolean {
  return entry.kind === "tool" && (entry.tool ?? "link").toLowerCase() === "link";
}

function linkToolKey(entry: FinderEntry): string {
  return (entry.toolKey || entry.targetLabel || "").trim();
}

function linkSummaryForEntry(
  entry: FinderEntry,
  summaries: Map<string, LinkSummary>,
): LinkSummary | null {
  const key = linkToolKey(entry);
  return key ? summaries.get(key) ?? null : null;
}

function linkEntrySubtitle(entry: FinderEntry, summary: LinkSummary | null): string {
  if (summary) {
    const parts = [`${summary.stepCount} 步骤`];
    const proxyPorts = summary.proxyProfiles
      .map((profile) => {
        const match = profile.listenUrl.match(/:(\d+)(?:\/)?$/);
        return match?.[1] ? `代理 ${match[1]}` : profile.name;
      })
      .filter(Boolean);
    if (proxyPorts.length > 0) {
      parts.push(proxyPorts.join(" / "));
    }
    if (summary.project) {
      parts.push(`运行 ${summary.project}`);
    }
    if (summary.runtime?.label && summary.runtime.status !== "planned") {
      parts.push(summary.runtime.label);
    }
    if (summary.warnings.length > 0) {
      parts.push(`${summary.warnings.length} 条提示`);
    }
    return parts.join(" · ");
  }
  return entry.note?.trim() || linkToolKey(entry) || entry.targetLabel;
}

function linkEntryStatusLabel(summary: LinkSummary | null): string {
  if (!summary) {
    return "计划";
  }
  if (summary.runtime?.status === "running") {
    return "运行中";
  }
  if (summary.runtime?.status === "partial") {
    return "部分运行";
  }
  if (summary.runtime?.status === "warning") {
    return "有风险";
  }
  if (summary.runtime?.status === "invalid") {
    return "配置异常";
  }
  if (summary.warnings.length > 0) {
    return `${summary.warnings.length} 提示`;
  }
  return "可执行";
}

function navigationEditorEntryMatchesShortcut(
  entry: NavigationEditorEntry,
  item: FinderShortcutItem,
) {
  if (entry.kind !== item.entry.kind || entry.name !== item.entry.name) {
    return false;
  }
  if (item.entry.kind === "url") {
    return (entry.url ?? "").trim() === (item.entry.url ?? "").trim();
  }
  if (item.entry.kind === "app") {
    return (
      (entry.bundleId ?? "").trim() === (item.entry.bundleId ?? "").trim() &&
      (entry.appName ?? "").trim() === (item.entry.appName ?? "").trim()
    );
  }
  if (item.entry.kind === "directory") {
    return (entry.path ?? "").trim() === (item.entry.path ?? "").trim();
  }
  if (item.entry.kind === "tool") {
    return (
      (entry.tool ?? "").trim() === (item.entry.tool ?? "").trim() &&
      (entry.toolKey ?? "").trim() === (item.entry.toolKey ?? "").trim()
    );
  }
  return (entry.script ?? "").trim() === (item.entry.script ?? "").trim();
}

function withShortcutRuntimeProfile(
  data: NavigationEditorState,
  item: FinderShortcutItem,
  runtimeProfile: string | null,
): NavigationEditorState | null {
  let updated = false;
  const patchEntry = (entry: NavigationEditorEntry) => {
    if (updated || !navigationEditorEntryMatchesShortcut(entry, item)) {
      return entry;
    }
    updated = true;
    return { ...entry, runtimeProfile };
  };
  const patchCategory = (categoryOnly: boolean) =>
    data.categories.map((category) => {
      if (categoryOnly && category.title !== item.categoryTitle) {
        return category;
      }
      return {
        ...category,
        entries: category.entries.map(patchEntry),
      };
    });

  const preferredCategories = patchCategory(true);
  if (updated) {
    return { ...data, categories: preferredCategories };
  }
  const fallbackCategories = patchCategory(false);
  return updated ? { ...data, categories: fallbackCategories } : null;
}

function runtimeProfileLabel(profile: RuntimeProfileDraft | null | undefined) {
  return profile?.label?.trim() || profile?.key || "";
}

function runtimeProfileScopeLabel(scope?: string | null) {
  switch (scope) {
    case "override":
      return "工作区覆盖";
    case "inherited":
      return "继承全局";
    case "unsupported":
      return "不支持覆盖";
    default:
      return "全局定义";
  }
}

function runtimeProfileScopeDescription(scope?: string | null) {
  switch (scope) {
    case "override":
      return "当前工作区使用独立运行配置。";
    case "inherited":
      return "当前继承全局配置，保存后会创建工作区覆盖。";
    case "unsupported":
      return "当前配置源未声明运行配置能力。";
    default:
      return "运行配置保存在全局项目配置中。";
  }
}

function runtimeProfileHasCdp(profile: RuntimeProfileDraft | null | undefined) {
  return Boolean(profile?.webActionsEnabled);
}

function buildFinderShortcutKey(item: FinderShortcutItem): string {
  return [
    item.categoryTitle,
    item.categoryLabel,
    item.entry.kind,
    item.entry.name,
    item.entry.targetLabel,
    item.entry.tool ?? "",
    item.entry.toolKey ?? "",
  ].join("\u0000");
}

function slugWebActionScopePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.[a-z0-9-]+$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function webActionScopeForShortcut(item: FinderShortcutItem): string {
  const url = item.entry.url?.trim();
  if (url) {
    try {
      const host = new URL(url).hostname;
      const slug = slugWebActionScopePart(host);
      if (slug) {
        return `url:${slug}`;
      }
    } catch {
      // Fall through to the entry name.
    }
  }
  const slug = slugWebActionScopePart(item.entry.name);
  return slug ? `url:${slug}` : "url";
}

async function copyPlainText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatDateTime(value?: number | null): string {
  if (!value || !Number.isFinite(value)) {
    return "未记录";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatElapsedTime(startedAtMs?: number | null, nowMs = Date.now()): string {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) {
    return "未运行";
  }
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function projectDisplayPath(item: ProjectRuntimeEntry): string {
  const rawPath = (item.cwd || item.repoPath || "").trim();
  if (!rawPath) {
    return "未配置目录";
  }
  const homeCompact = rawPath.replace(/^\/Users\/[^/]+/, "~");
  const parts = homeCompact.split("/").filter(Boolean);
  if (parts.length <= 3) {
    return homeCompact;
  }
  return `${parts[0]}/.../${parts.slice(-2).join("/")}`;
}

function projectDisplayCommand(item: ProjectRuntimeEntry): string {
  const command = (item.command || item.buildCommand || "").trim();
  if (!command) {
    return "未配置启动命令";
  }
  return command.replace(/\s+/g, " ");
}

function projectMonogram(item: ProjectRuntimeEntry): string {
  const source = (item.name || item.key || "P").trim();
  const firstChinese = source.match(/[\u4e00-\u9fa5]/)?.[0];
  if (firstChinese) {
    return firstChinese;
  }
  const firstAlpha = source.match(/[a-zA-Z0-9]/)?.[0];
  return (firstAlpha || "P").toUpperCase();
}

function projectAccentColor(item: ProjectRuntimeEntry): string {
  const accents = [
    "#5f8fd9",
    "#42b883",
    "#8b7cf6",
    "#f59e52",
    "#4bb7c9",
    "#6f8aa7",
  ];
  const seed = [...(item.key || item.name)].reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  return accents[seed % accents.length];
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function isInteractiveClickTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [role="button"], [role="menuitem"], [data-project-row-action="true"]',
    ),
  );
}

export function ProjectsPage({
  mode,
  finderTypeOptions,
  finderType,
  finderTypeCounts,
  onFinderTypeChange,
  finderCategories,
  finderCategory,
  finderCategoryCounts,
  onFinderCategoryChange,
  finderQuery,
  onFinderQueryChange,
  runtimeEntries,
  filteredRuntimeEntries,
  shortcutEntries,
  filteredShortcutEntries,
  favoriteProjectKeys,
  recentProjectKeys,
  favoriteShortcutKeys,
  selectedDebugProfileKeys,
  workflowReceiveRules,
  workflowBroadcastRules,
  workflowSignalOptions,
  workflowSignalSummaries,
  workflowReceiveSignalIdsForProjectReplay,
  workflowBroadcastSignalIdsForProjectReplay,
  onWorkflowProjectReplayRulesChange,
  onWorkflowReceiveRulesEnabledChange,
  onWorkflowReceiveRulesDelete,
  onWorkflowBroadcastRulesEnabledChange,
  onWorkflowBroadcastRulesDelete,
  onWorkflowSignalDelete,
  onWorkflowSignalsClear,
  onToggleProjectFavorite,
  onToggleShortcutFavorite,
  onProjectDebugProfileChange,
  onMarkShortcutUsed,
  onRefresh,
  onOpenFinderEntry,
  onStartRuntime,
  onStopRuntime,
  onAdoptRuntime,
  onOpenBuildOutput,
  onFocusRuntime,
  onOpenProjectDirectory,
  onOpenResourceConfig,
  configWorkspaceKey,
  projectConfigPanel,
}: ProjectsPageProps) {
  const theme = useTheme();
  const mono = theme.palette.mode === "dark";
  const tone = buildProjectsTone(mono);
  const runtimePanelActionButtonSx = {
    width: 32,
    height: 32,
    flex: "0 0 32px",
    borderRadius: "999px",
    bgcolor: tone.stopButtonBg,
    color: tone.stopButtonColor,
    border: `1px solid ${tone.stopButtonBorder}`,
    transition: "none",
    "&:hover": {
      bgcolor: tone.stopButtonBg,
    },
    "&.Mui-disabled": {
      bgcolor: tone.stopButtonBg,
      color: tone.stopButtonDisabledColor,
      borderColor: tone.stopButtonBorder,
      opacity: 0.58,
    },
    "& .MuiTouchRipple-root": {
      display: "none",
    },
  };
  const [confirmedShortcutKey, setConfirmedShortcutKey] = useState<string | null>(
    null,
  );
  const [projectMenuAnchor, setProjectMenuAnchor] =
    useState<HTMLElement | null>(null);
  const [projectMenuKey, setProjectMenuKey] = useState("");
  const [shortcutMenuAnchor, setShortcutMenuAnchor] =
    useState<HTMLElement | null>(null);
  const [shortcutMenuKey, setShortcutMenuKey] = useState("");
  const [shortcutRuntimePanelItem, setShortcutRuntimePanelItem] =
    useState<FinderShortcutItem | null>(null);
  const [shortcutPanelTab, setShortcutPanelTab] =
    useState<RuntimePanelTab>("webActions");
  const [shortcutRuntimeSaving, setShortcutRuntimeSaving] = useState(false);
  const [shortcutRuntimeError, setShortcutRuntimeError] = useState("");
  const [runtimeOptionsProfileKey, setRuntimeOptionsProfileKey] = useState("");
  const [runtimeOptionsEnvText, setRuntimeOptionsEnvText] = useState("");
  const [detailsProjectKey, setDetailsProjectKey] = useState("");
  const [detailsPanelTab, setDetailsPanelTab] =
    useState<RuntimePanelTab>("overview");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowProjectKey, setWorkflowProjectKey] = useState("");
  const [workflowAction, setWorkflowAction] =
    useState<ProjectWorkflowAction>("project.runtime.start");
  const [projectConfigOpen, setProjectConfigOpen] = useState(false);
  const [projectConfigKey, setProjectConfigKey] = useState("");
  const [copiedProjectAction, setCopiedProjectAction] = useState("");
  const [runtimeLogKind, setRuntimeLogKind] =
    useState<ProjectRuntimeLogKind>("dev");
  const [runtimeLog, setRuntimeLog] = useState<RuntimeLogState>({
    projectKey: "",
    kind: "dev",
    path: "",
    lines: [],
    truncated: false,
    readySummary: EMPTY_RUNTIME_READY_SUMMARY,
    sessionSummary: EMPTY_RUNTIME_SESSION_SUMMARY,
    loading: false,
    error: "",
  });
  const [runtimePreflight, setRuntimePreflight] =
    useState<RuntimePreflightState>({
      projectKey: "",
      debugProfileKey: "",
      response: null,
      loading: false,
      error: "",
    });
  const [runtimePreflightRefreshKey, setRuntimePreflightRefreshKey] = useState(0);
  const [runtimeLogRefreshKey, setRuntimeLogRefreshKey] = useState(0);
  const [runtimeLogClearing, setRuntimeLogClearing] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const [runtimeProfileDialog, setRuntimeProfileDialog] =
    useState<RuntimeProfileDialogState | null>(null);
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const [linkPlanDialog, setLinkPlanDialog] = useState<LinkPlanDialogState | null>(null);
  const [linkSummaries, setLinkSummaries] = useState<LinkSummary[]>([]);
  const resolvedConfigWorkspaceKey =
    configWorkspaceKey ?? projectConfigPanel?.activeProjectWorkspaceKey ?? "system";
  const {
    selectedSourceId: linkConfigSourceId,
    preferredSourceId: preferredLinkConfigSourceId,
    refreshSources: refreshLinkConfigSources,
  } = useConfigSource({
    workspaceKey: resolvedConfigWorkspaceKey,
    requiredCapability: "link",
  });
  const {
    sources: runtimeConfigSources,
    selectedSource: selectedRuntimeConfigSource,
    selectedSourceId: runtimeConfigSourceId,
    preferredSourceId: preferredRuntimeConfigSourceId,
    sourceBusy: runtimeConfigSourceBusy,
    sourceError: runtimeConfigSourceError,
    sourceStatus: runtimeConfigSourceStatus,
    refreshSources: refreshRuntimeConfigSources,
    adoptSources: adoptRuntimeConfigSources,
    selectSource: selectRuntimeConfigSource,
  } = useConfigSource({
    workspaceKey: resolvedConfigWorkspaceKey,
    requiredCapability: "runtime",
  });
  const [runtimeConfigSourceManagerOpen, setRuntimeConfigSourceManagerOpen] = useState(false);
  const {
    profiles: runtimeProfileDrafts,
    proxyProfiles: runtimeProxyProfiles,
    profileIndex: runtimeProfileIndex,
    setProfileIndex: setRuntimeProfileIndex,
    loaded: runtimeProfilesLoaded,
    loading: runtimeProfilesLoading,
    saving: runtimeProfilesSaving,
    error: runtimeProfilesError,
    setError: setRuntimeProfilesError,
    scope: runtimeProfileScope,
    configPath: runtimeProfileConfigPath,
    readOnly: runtimeProfilesReadOnly,
    loadProfiles: loadRuntimeProfiles,
    persistProfiles: persistRuntimePanelProfiles,
    restoreInheritance: restoreRuntimeProfilesInheritance,
  } = useRuntimeProfiles({ sourceId: runtimeConfigSourceId, onRefresh });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [finderVisibleCount, setFinderVisibleCount] = useState(
    FINDER_LOAD_BATCH_SIZE,
  );
  const finderListRef = useRef<HTMLDivElement | null>(null);
  const runtimeLogBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const finderIsProjects = mode === "projectManagement";
  useEffect(() => {
    setRuntimeProfileDialog(null);
  }, [runtimeConfigSourceId]);

  useEffect(() => {
    void refreshLinkConfigSources().catch(() => setLinkSummaries([]));
  }, [preferredLinkConfigSourceId, refreshLinkConfigSources]);

  useEffect(() => {
    void refreshRuntimeConfigSources().catch((reason) =>
      setRuntimeProfilesError(String(reason)),
    );
  }, [preferredRuntimeConfigSourceId, refreshRuntimeConfigSources, setRuntimeProfilesError]);

  useEffect(() => {
    if (mode === "projectManagement") {
      if (finderType !== "项目") {
        onFinderTypeChange("项目");
      }
      return;
    }
    if (finderType === "项目") {
      const nextType = finderTypeOptions.find((type) => type !== "项目") ?? "网站";
      onFinderTypeChange(nextType);
    }
  }, [finderType, finderTypeOptions, mode, onFinderTypeChange]);
  const runningCount = runtimeEntries.filter(
    (item) => item.statusKey === "running" || item.statusKey === "external",
  ).length;
  const configurableCount = runtimeEntries.filter(
    (item) => item.command,
  ).length;
  const totalShortcutCount = shortcutEntries.length;
  const currentResourceTypeCount = finderTypeCounts[finderType] ?? totalShortcutCount;
  const pageToolbarMetrics: WorkspacePageMetric[] = finderIsProjects
    ? [
        {
          key: "projects",
          label: "项目",
          value: runtimeEntries.length,
          icon: <PackageIcon fontSize="small" />,
          tone: "blue",
        },
        {
          key: "running",
          label: "运行中",
          value: runningCount,
          tone: "green",
        },
        {
          key: "configurable",
          label: "可启动",
          value: configurableCount,
          icon: <PlayIcon fontSize="small" />,
          tone: "violet",
        },
      ]
    : [
        {
          key: "entries",
          label: "入口",
          value: totalShortcutCount,
          icon: <AppWindowIcon fontSize="small" />,
          tone: "blue",
        },
        ...(["网站", "目录", "工具"] as FinderType[])
          .filter((type) => finderTypeOptions.includes(type))
          .map((type) => ({
            key: type,
            label: type,
            value: finderTypeCounts[type] ?? 0,
            icon:
              type === "网站" ? (
                <WebsiteIcon fontSize="small" />
              ) : type === "目录" ? (
                <FolderIcon fontSize="small" />
              ) : (
                <TerminalIcon fontSize="small" />
              ),
            tone:
              type === "网站"
                ? ("cyan" as const)
                : type === "目录"
                  ? ("green" as const)
                  : ("violet" as const),
          })),
      ];
  const resourceEmptyCopy = useMemo(() => {
    switch (finderType) {
      case "网站":
        return {
          title: "暂无网站入口",
          description: "当前工作区还没有可打开的网站入口。",
        };
      case "目录":
        return {
          title: "暂无目录入口",
          description: "当前工作区还没有本地目录入口。",
        };
      case "工具":
        return {
          title: "暂无工具入口",
          description: "当前工作区还没有脚本、应用或链路类工具入口。",
        };
      default:
        return {
          title: "暂无入口",
          description: "当前工作区还没有快捷入口。",
        };
    }
  }, [finderType]);
  const favoriteProjectKeySet = new Set(favoriteProjectKeys);
  const recentProjectKeySet = new Set(recentProjectKeys);
  const projectRuntimeEntries = useMemo(() => {
    const keyword = finderQuery.trim().toLowerCase();
    const filtered = runtimeEntries.filter((item) => {
      if (!keyword) {
        return true;
      }
      return buildRuntimeHaystack(item).includes(keyword);
    });
    return [...filtered].sort((left, right) => {
      const favoriteOrder = compareMarkedFirst(
        favoriteProjectKeySet.has(left.key),
        favoriteProjectKeySet.has(right.key),
      );
      if (favoriteOrder !== 0) {
        return favoriteOrder;
      }
      return compareMarkedFirst(
        recentProjectKeySet.has(left.key),
        recentProjectKeySet.has(right.key),
      );
    });
  }, [favoriteProjectKeySet, finderQuery, recentProjectKeySet, runtimeEntries]);
  const filteredFinderEntryCount = finderIsProjects
    ? projectRuntimeEntries.length
    : filteredShortcutEntries.length;
  const visibleFinderEntryCount = Math.min(
    finderVisibleCount,
    filteredFinderEntryCount,
  );
  const visibleRuntimeEntries = projectRuntimeEntries.slice(
    0,
    visibleFinderEntryCount,
  );
  const visibleShortcutEntries = filteredShortcutEntries.slice(
    0,
    visibleFinderEntryCount,
  );
  const hasMoreFinderEntries = finderVisibleCount < filteredFinderEntryCount;
  const linkToolKeysSignature = useMemo(
    () =>
      filteredShortcutEntries
        .filter((item) => isLinkToolEntry(item.entry))
        .map((item) => linkToolKey(item.entry))
        .filter(Boolean)
        .sort()
        .join("|"),
    [filteredShortcutEntries],
  );
  const linkSummaryMap = useMemo(
    () => new Map(linkSummaries.map((summary) => [summary.key, summary])),
    [linkSummaries],
  );
  const showFinderCategories =
    mode === "resources" && finderCategories.length > 1;
  const favoriteShortcutKeySet = new Set(favoriteShortcutKeys);
  const projectMenuEntry =
    runtimeEntries.find((item) => item.key === projectMenuKey) ?? null;
  const shortcutMenuItem =
    shortcutEntries.find((item) => buildFinderShortcutKey(item) === shortcutMenuKey) ??
    null;
  const shortcutRuntimePanelKey = shortcutRuntimePanelItem
    ? buildFinderShortcutKey(shortcutRuntimePanelItem)
    : "";
  const shortcutRuntimePanelCurrentItem = shortcutRuntimePanelKey
    ? shortcutEntries.find((item) => buildFinderShortcutKey(item) === shortcutRuntimePanelKey) ??
      shortcutRuntimePanelItem
    : null;
  const detailsProjectEntry =
    runtimeEntries.find((item) => item.key === detailsProjectKey) ?? null;
  const workflowProjectEntry =
    runtimeEntries.find((item) => item.key === workflowProjectKey) ?? null;
  const workflowReplay = workflowProjectEntry
    ? workflowReplayFromProjectRuntime(workflowProjectEntry, workflowAction)
    : null;

  useEffect(() => {
    if (finderIsProjects || !linkToolKeysSignature) {
      setLinkSummaries([]);
      return;
    }
    let active = true;
    void invoke<LinkSummary[]>("list_links", { sourceId: linkConfigSourceId })
      .then((summaries) => {
        if (active) {
          setLinkSummaries(summaries);
        }
      })
      .catch(() => {
        if (active) {
          setLinkSummaries([]);
        }
      });
    return () => {
      active = false;
    };
  }, [finderIsProjects, linkConfigSourceId, linkToolKeysSignature]);
  const projectMenuFavorite = projectMenuEntry
    ? favoriteProjectKeySet.has(projectMenuEntry.key)
    : false;
  const shortcutMenuFavorite = shortcutMenuItem
    ? favoriteShortcutKeySet.has(buildFinderShortcutKey(shortcutMenuItem))
    : false;
  const runtimeOptionsEntry = detailsProjectEntry;
  const runtimeOptionsProfiles = runtimeOptionsEntry?.debugProfiles ?? [];
  const runtimeOptionsSelectedProfile =
    findDebugProfile(runtimeOptionsProfiles, runtimeOptionsProfileKey) ?? null;
  const runtimeOptionsSavedProfileKey = runtimeOptionsEntry
    ? projectSelectedProfileKey(runtimeOptionsEntry, selectedDebugProfileKeys)
    : "";
  const runtimeOptionsDefaultSaved =
    runtimeOptionsProfileKey === runtimeOptionsSavedProfileKey;
  const runtimePanelProfile = runtimeProfileDrafts[runtimeProfileIndex] ?? null;
  const runtimeProxyProfileById = useMemo(
    () => new Map(runtimeProxyProfiles.map((profile) => [profile.id, profile])),
    [runtimeProxyProfiles],
  );
  const runtimePanelBoundProxy = runtimePanelProfile?.rdevProxyProfileId
    ? runtimeProxyProfileById.get(runtimePanelProfile.rdevProxyProfileId) ?? null
    : null;
  const runtimeOptionsParseResult = useMemo(
    () => parseRuntimeEnvText(runtimeOptionsEnvText),
    [runtimeOptionsEnvText],
  );
  const detailsProjectPath =
    detailsProjectEntry?.cwd || detailsProjectEntry?.repoPath || "";
  const detailsWebActionsContext = useMemo<WebActionsDialogContext | null>(() => {
    const logReadyUrl =
      runtimeLog.projectKey === detailsProjectEntry?.key && runtimeLog.kind === "dev"
        ? runtimeLog.readySummary.url?.trim() ||
          runtimeLog.readySummary.localUrl?.trim() ||
          ""
        : "";
    const url =
      detailsProjectEntry?.readyUrl?.trim() ||
      logReadyUrl ||
      detailsProjectEntry?.focusUrl?.trim();
    if (!detailsProjectEntry || !url) {
      return null;
    }
    const runtimeProfile = runtimeOptionsSelectedProfile?.runtimeProfile ?? null;
    const runtimeProfileDraft =
      runtimeProfileDrafts.find((profile) => profile.key === runtimeProfile) ?? null;
    return {
      title: detailsProjectEntry.name,
      scope: `project:${detailsProjectEntry.key}`,
      url,
      entry: projectRuntimeWebActionEntry(detailsProjectEntry, url, runtimeProfile),
      contextParams: buildProjectWebActionContextParams(
        detailsProjectEntry,
        url,
        runtimeOptionsSelectedProfile,
        runtimeProfileDraft,
      ),
    };
  }, [
    detailsProjectEntry?.category,
    detailsProjectEntry?.cwd,
    detailsProjectEntry?.focusUrl,
    detailsProjectEntry?.key,
    detailsProjectEntry?.name,
    detailsProjectEntry?.readyUrl,
    detailsProjectEntry?.repoPath,
    runtimeLog.kind,
    runtimeLog.projectKey,
    runtimeLog.readySummary.localUrl,
    runtimeLog.readySummary.url,
    runtimeProfileDrafts,
    runtimeOptionsSelectedProfile?.runtimeProfile,
    runtimeOptionsSelectedProfile?.key,
  ]);
  const shortcutRuntimeProfileKey =
    shortcutRuntimePanelCurrentItem?.entry.runtimeProfile?.trim() ?? "";
  const shortcutRuntimeProfile =
    runtimeProfileDrafts.find((profile) => profile.key === shortcutRuntimeProfileKey) ??
    null;
  const shortcutBoundProxy = shortcutRuntimeProfile?.rdevProxyProfileId
    ? runtimeProxyProfileById.get(shortcutRuntimeProfile.rdevProxyProfileId) ?? null
    : null;
  const shortcutWebActionsContext = useMemo<WebActionsDialogContext | null>(() => {
    const url = shortcutRuntimePanelCurrentItem?.entry.url?.trim();
    if (!shortcutRuntimePanelCurrentItem || !url) {
      return null;
    }
    return {
      title: shortcutRuntimePanelCurrentItem.entry.name,
      scope: webActionScopeForShortcut(shortcutRuntimePanelCurrentItem),
      url,
      entry: shortcutRuntimePanelCurrentItem.entry,
    };
  }, [shortcutRuntimePanelCurrentItem]);
  const workflowReceiveGroups = useMemo(
    () => groupWorkflowRules(workflowReceiveRules, "receive"),
    [workflowReceiveRules],
  );
  const workflowBroadcastGroups = useMemo(
    () => groupWorkflowRules(workflowBroadcastRules, "broadcast"),
    [workflowBroadcastRules],
  );
  const workflowGroups = useMemo(
    () => [...workflowReceiveGroups, ...workflowBroadcastGroups],
    [workflowBroadcastGroups, workflowReceiveGroups],
  );

  useEffect(() => {
    setFinderVisibleCount(FINDER_LOAD_BATCH_SIZE);
    if (finderListRef.current) {
      finderListRef.current.scrollTop = 0;
    }
  }, [finderCategory, finderQuery, finderType]);

  useEffect(() => {
    setFinderVisibleCount((current) => {
      if (current <= FINDER_LOAD_BATCH_SIZE) {
        return FINDER_LOAD_BATCH_SIZE;
      }
      return Math.min(
        current,
        Math.max(FINDER_LOAD_BATCH_SIZE, filteredFinderEntryCount),
      );
    });
  }, [filteredFinderEntryCount]);

  function loadMoreFinderEntries() {
    setFinderVisibleCount((current) =>
      Math.min(
        current + FINDER_LOAD_BATCH_SIZE,
        filteredFinderEntryCount,
      ),
    );
  }

  function handleFinderListScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreFinderEntries) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 84) {
      loadMoreFinderEntries();
    }
  }

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current != null) {
        window.clearTimeout(confirmTimerRef.current);
      }
      if (copiedTimerRef.current != null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!detailsProjectKey) {
      return;
    }

    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 10000);
    return () => window.clearInterval(timer);
  }, [detailsProjectKey]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setPageVisible(document.visibilityState === "visible");
    };
    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (detailsProjectKey && !detailsProjectEntry) {
      setDetailsProjectKey("");
      setDetailsPanelTab("overview");
    }
  }, [detailsProjectEntry, detailsProjectKey]);

  useEffect(() => {
    if (!detailsProjectEntry) {
      setRuntimeOptionsProfileKey("");
      setRuntimeOptionsEnvText("");
      return;
    }
    const profileKey = projectSelectedProfileKey(
      detailsProjectEntry,
      selectedDebugProfileKeys,
    );
    const profile = findDebugProfile(detailsProjectEntry.debugProfiles ?? [], profileKey);
    setRuntimeOptionsProfileKey(profileKey);
    setRuntimeOptionsEnvText(formatRuntimeEnvText(profile?.env));
  }, [detailsProjectEntry?.key]);

  useEffect(() => {
    if (!detailsProjectEntry) {
      setRuntimePreflight({
        projectKey: "",
        debugProfileKey: "",
        response: null,
        loading: false,
        error: "",
      });
      return;
    }

    let cancelled = false;
    const profileKey = runtimeOptionsProfileKey || "";
    setRuntimePreflight((current) => ({
      ...current,
      projectKey: detailsProjectEntry.key,
      debugProfileKey: profileKey,
      loading: true,
      error: "",
    }));
    void invoke<ProjectRuntimePreflightResponse>("preflight_project_runtime", {
      project: detailsProjectEntry.key,
      debugProfile: profileKey || null,
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRuntimePreflight({
          projectKey: detailsProjectEntry.key,
          debugProfileKey: profileKey,
          response,
          loading: false,
          error: "",
        });
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }
        setRuntimePreflight({
          projectKey: detailsProjectEntry.key,
          debugProfileKey: profileKey,
          response: null,
          loading: false,
          error: String(reason),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [detailsProjectEntry?.key, runtimeOptionsProfileKey, runtimePreflightRefreshKey]);

  useEffect(() => {
    if (detailsPanelTab === "webActions" && !detailsWebActionsContext) {
      setDetailsPanelTab("overview");
    }
  }, [detailsPanelTab, detailsWebActionsContext]);

  useEffect(() => {
    if (!shortcutRuntimePanelKey) {
      return;
    }
    const exists = shortcutEntries.some(
      (item) => buildFinderShortcutKey(item) === shortcutRuntimePanelKey,
    );
    if (!exists) {
      setShortcutRuntimePanelItem(null);
      setShortcutPanelTab("webActions");
    }
  }, [shortcutEntries, shortcutRuntimePanelKey]);

  useEffect(() => {
    if (
      detailsPanelTab !== "config" ||
      !detailsProjectEntry ||
      runtimeProfilesLoaded ||
      runtimeProfilesLoading
    ) {
      return;
    }
    void loadRuntimeProfiles(runtimeOptionsSelectedProfile?.runtimeProfile);
  }, [
    detailsPanelTab,
    detailsProjectEntry?.key,
    linkConfigSourceId,
    runtimeOptionsSelectedProfile?.runtimeProfile,
    runtimeProfilesLoaded,
    runtimeProfilesLoading,
  ]);

  useEffect(() => {
    if (
      !shortcutRuntimePanelCurrentItem ||
      shortcutPanelTab !== "config" ||
      runtimeProfilesLoaded ||
      runtimeProfilesLoading
    ) {
      return;
    }
    void loadRuntimeProfiles(shortcutRuntimePanelCurrentItem.entry.runtimeProfile);
  }, [
    linkConfigSourceId,
    shortcutPanelTab,
    shortcutRuntimePanelCurrentItem,
    runtimeProfilesLoaded,
    runtimeProfilesLoading,
  ]);

  useEffect(() => {
    if (!detailsProjectEntry) {
      return;
    }
    if (runtimeLogKind === "build" && !detailsProjectEntry.buildLogPath) {
      setRuntimeLogKind("dev");
    }
  }, [detailsProjectEntry, runtimeLogKind]);

  useEffect(() => {
    if (!detailsProjectEntry) {
      setRuntimeLog((current) => ({
        ...current,
        projectKey: "",
        lines: [],
        path: "",
        readySummary: EMPTY_RUNTIME_READY_SUMMARY,
        sessionSummary: EMPTY_RUNTIME_SESSION_SUMMARY,
        error: "",
        loading: false,
      }));
      return;
    }

    let cancelled = false;
    setRuntimeLog((current) => ({
      ...current,
      projectKey: detailsProjectEntry.key,
      kind: runtimeLogKind,
      loading: true,
      error: "",
    }));
    void invoke<ProjectRuntimeLogResponse>("read_project_runtime_log", {
      project: detailsProjectEntry.key,
      kind: runtimeLogKind,
      maxLines: RUNTIME_LOG_MAX_LINES,
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRuntimeLog({
          projectKey: detailsProjectEntry.key,
          kind: runtimeLogKind,
          path: response.path,
          lines: response.lines,
          truncated: response.truncated,
          readySummary: response.readySummary ?? EMPTY_RUNTIME_READY_SUMMARY,
          sessionSummary: response.sessionSummary ?? EMPTY_RUNTIME_SESSION_SUMMARY,
          loading: false,
          error: "",
        });
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }
        setRuntimeLog({
          projectKey: detailsProjectEntry.key,
          kind: runtimeLogKind,
          path:
            runtimeLogKind === "build"
              ? detailsProjectEntry.buildLogPath ?? ""
              : detailsProjectEntry.logPath ?? "",
          lines: [],
          truncated: false,
          readySummary: EMPTY_RUNTIME_READY_SUMMARY,
          sessionSummary: EMPTY_RUNTIME_SESSION_SUMMARY,
          loading: false,
          error: String(reason),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    detailsProjectEntry?.buildLogPath,
    detailsProjectEntry?.key,
    detailsProjectEntry?.logPath,
    runtimeLogKind,
    runtimeLogRefreshKey,
  ]);

  const runtimeLogAutoRefreshMs = useMemo(() => {
    if (
      !detailsProjectEntry ||
      detailsPanelTab !== "logs" ||
      !pageVisible ||
      runtimeLog.loading ||
      runtimeLogClearing
    ) {
      return null;
    }
    if (runtimeLogKind === "build") {
      return detailsProjectEntry.buildStatusKey === "running"
        ? RUNTIME_LOG_AUTO_REFRESH_ACTIVE_MS
        : null;
    }
    if (detailsProjectEntry.statusKey !== "running") {
      return null;
    }
    return runtimeLog.readySummary.ready
      ? RUNTIME_LOG_AUTO_REFRESH_READY_MS
      : RUNTIME_LOG_AUTO_REFRESH_ACTIVE_MS;
  }, [
    detailsPanelTab,
    detailsProjectEntry?.buildStatusKey,
    detailsProjectEntry?.key,
    detailsProjectEntry?.statusKey,
    pageVisible,
    runtimeLog.loading,
    runtimeLog.readySummary.ready,
    runtimeLogClearing,
    runtimeLogKind,
  ]);

  useEffect(() => {
    if (runtimeLogAutoRefreshMs == null) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      setRuntimeLogRefreshKey((current) => current + 1);
    }, runtimeLogAutoRefreshMs);
    return () => window.clearInterval(timer);
  }, [runtimeLogAutoRefreshMs]);

  useEffect(() => {
    if (detailsPanelTab !== "logs") {
      return;
    }
    const logBox = runtimeLogBoxRef.current;
    if (!logBox) {
      return;
    }
    window.requestAnimationFrame(() => {
      logBox.scrollTop = logBox.scrollHeight;
    });
  }, [
    detailsPanelTab,
    runtimeLog.kind,
    runtimeLog.lines,
    runtimeLog.loading,
    runtimeLogClearing,
  ]);

  useEffect(() => {
    function handleFinderKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTextEditingTarget(event.target)
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (
        event.key === "Escape" &&
        (detailsProjectKey || finderQuery || finderCategory !== "全部")
      ) {
        event.preventDefault();
        if (detailsProjectKey) {
          setDetailsProjectKey("");
          return;
        }
        if (finderQuery) {
          onFinderQueryChange("");
          return;
        }
        if (finderCategory !== "全部") {
          onFinderCategoryChange("全部");
        }
        return;
      }
    }

    window.addEventListener("keydown", handleFinderKeyDown);
    return () => window.removeEventListener("keydown", handleFinderKeyDown);
  }, [
    detailsProjectKey,
    finderCategory,
    finderQuery,
    onFinderCategoryChange,
    onFinderQueryChange,
  ]);

  function closeProjectMenu() {
    setProjectMenuAnchor(null);
    setProjectMenuKey("");
  }

  function closeShortcutMenu() {
    setShortcutMenuAnchor(null);
    setShortcutMenuKey("");
  }

  function selectRuntimeProfileIndex(profileKey?: string | null) {
    const key = profileKey?.trim();
    if (!key) {
      setRuntimeProfileIndex(0);
      return;
    }
    const nextIndex = runtimeProfileDrafts.findIndex((profile) => profile.key === key);
    setRuntimeProfileIndex(nextIndex >= 0 ? nextIndex : 0);
  }

  function openShortcutRuntimePanel(item: FinderShortcutItem) {
    const url = item.entry.url?.trim();
    if (!url) {
      return;
    }
    setShortcutRuntimePanelItem(item);
    setShortcutPanelTab("webActions");
    setShortcutRuntimeError("");
    if (runtimeProfilesLoaded) {
      selectRuntimeProfileIndex(item.entry.runtimeProfile);
    } else {
      void loadRuntimeProfiles(item.entry.runtimeProfile);
    }
  }

  function closeShortcutRuntimePanel() {
    setShortcutRuntimePanelItem(null);
    setShortcutPanelTab("webActions");
    setShortcutRuntimeError("");
  }

  async function saveShortcutRuntimeProfile(profileKey: string) {
    if (!shortcutRuntimePanelCurrentItem) {
      return;
    }
    const nextRuntimeProfile = profileKey.trim() || null;
    setShortcutRuntimeSaving(true);
    setShortcutRuntimeError("");
    try {
      const editor = await invoke<NavigationEditorState>("get_navigation_editor");
      const nextEditor = withShortcutRuntimeProfile(
        editor,
        shortcutRuntimePanelCurrentItem,
        nextRuntimeProfile,
      );
      if (!nextEditor) {
        throw new Error("未找到可更新的访达入口");
      }
      await invoke("save_navigation_editor", { data: nextEditor });
      const nextItem: FinderShortcutItem = {
        ...shortcutRuntimePanelCurrentItem,
        entry: {
          ...shortcutRuntimePanelCurrentItem.entry,
          runtimeProfile: nextRuntimeProfile,
        },
      };
      setShortcutRuntimePanelItem(nextItem);
      selectRuntimeProfileIndex(nextRuntimeProfile);
      onRefresh();
    } catch (reason) {
      setShortcutRuntimeError(String(reason));
    } finally {
      setShortcutRuntimeSaving(false);
    }
  }

  function openRuntimePanel(item: ProjectRuntimeEntry, tab: RuntimePanelTab = "overview") {
    setDetailsProjectKey(item.key);
    setDetailsPanelTab(tab);
  }

  function closeRuntimePanel() {
    setDetailsProjectKey("");
    setDetailsPanelTab("overview");
  }

  async function handleRuntimeConfigSourceChange(nextSourceId: string) {
    if (nextSourceId === runtimeConfigSourceId || runtimeConfigSourceBusy) {
      return;
    }
    if (runtimeProfileDialog) {
      setRuntimeProfilesError("请先保存或取消当前运行配置改动，再切换配置源。");
      return;
    }
    setRuntimeProfilesError("");
    try {
      await selectRuntimeConfigSource(nextSourceId);
    } catch (reason) {
      setRuntimeProfilesError(String(reason));
    }
  }

  function renderRuntimeConfigSourceBar() {
    if (runtimeConfigSources.length === 0) {
      return null;
    }
    return (
      <ConfigSourceBar
        sources={runtimeConfigSources}
        selectedSourceId={runtimeConfigSourceId}
        selectedSource={selectedRuntimeConfigSource}
        path={runtimeProfileConfigPath || selectedRuntimeConfigSource?.files.runtimeOverrides}
        requiredCapability="runtime"
        profileFallback="runtime"
        disabled={
          runtimeConfigSourceBusy ||
          runtimeProfilesLoading ||
          runtimeProfilesSaving ||
          shortcutRuntimeSaving
        }
        status={runtimeProfilesLoading ? "loading" : runtimeConfigSourceStatus}
        error={runtimeConfigSourceError}
        showReadyStatus
        manageDisabled={Boolean(runtimeProfileDialog)}
        manageDisabledReason="请先保存或取消当前运行配置改动"
        onSourceChange={(sourceId) => void handleRuntimeConfigSourceChange(sourceId)}
        onManage={() => setRuntimeConfigSourceManagerOpen(true)}
      />
    );
  }

  function addRuntimePanelProfile() {
    if (runtimeProfilesReadOnly) {
      setRuntimeProfilesError("当前配置源不支持运行配置覆盖。");
      return;
    }
    setRuntimeProfileDialog({
      mode: "create",
      index: -1,
      draft: emptyRuntimeProfileDraft(runtimeProfileDrafts),
    });
    setRuntimeProfilesError("");
  }

  function editRuntimePanelProfile() {
    if (!runtimePanelProfile || runtimeProfilesReadOnly) {
      return;
    }
    setRuntimeProfileDialog({
      mode: "edit",
      index: runtimeProfileIndex,
      draft: {
        ...runtimePanelProfile,
        networkProxy: { ...runtimePanelProfile.networkProxy },
      },
    });
    setRuntimeProfilesError("");
  }

  function editRuntimePanelProfileByKey(profileKey?: string | null) {
    if (runtimeProfilesReadOnly) {
      setRuntimeProfilesError("当前配置源不支持运行配置覆盖。");
      return;
    }
    const key = profileKey?.trim();
    if (!key) {
      return;
    }
    const index = runtimeProfileDrafts.findIndex((profile) => profile.key === key);
    const profile = index >= 0 ? runtimeProfileDrafts[index] : null;
    if (!profile) {
      return;
    }
    setRuntimeProfileIndex(index);
    setRuntimeProfileDialog({
      mode: "edit",
      index,
      draft: {
        ...profile,
        networkProxy: { ...profile.networkProxy },
      },
    });
    setRuntimeProfilesError("");
  }

  function updateRuntimeProfileDialog(patch: Partial<RuntimeProfileDraft>) {
    setRuntimeProfileDialog((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              ...patch,
            },
          }
        : current,
    );
  }

  async function restoreRuntimeProfileInheritance() {
    if (runtimeProfileScope !== "override") return;
    const accepted = await confirm({
      title: "恢复继承全局运行配置？",
      description: "当前工作区的 runtime_overrides.toml 会被删除，并立即改用全局运行配置。",
      confirmLabel: "恢复继承",
      tone: "danger",
    });
    if (!accepted) return;
    const restored = await restoreRuntimeProfilesInheritance();
    if (restored) {
      setRuntimeProfileDialog(null);
    }
  }

  async function saveRuntimeProfileDialog() {
    if (!runtimeProfileDialog) {
      return;
    }
    const draft = {
      ...runtimeProfileDialog.draft,
      key: runtimeProfileDialog.draft.key.trim(),
      label: runtimeProfileDialog.draft.label.trim(),
      rdevProxyProfileId: runtimeProfileDialog.draft.rdevProxyProfileId?.trim() || null,
    };
    const duplicate = runtimeProfileDrafts.some(
      (profile, index) =>
        profile.key.trim() === draft.key &&
        (runtimeProfileDialog.mode !== "edit" ||
          index !== runtimeProfileDialog.index),
    );
    if (duplicate) {
      setRuntimeProfilesError("运行配置 Key 已存在");
      return;
    }
    const nextProfiles =
      runtimeProfileDialog.mode === "edit" && runtimeProfileDialog.index >= 0
        ? runtimeProfileDrafts.map((profile, index) =>
            index === runtimeProfileDialog.index ? draft : profile,
          )
        : [...runtimeProfileDrafts, draft];
    const saved = await persistRuntimePanelProfiles(nextProfiles, draft.key);
    if (saved) {
      setRuntimeProfileDialog(null);
    }
  }

  function handleRuntimeOptionsProfileChange(profileKey: string) {
    const nextProfileKey =
      profileKey === DEFAULT_RUNTIME_PROFILE_VALUE ? "" : profileKey;
    const profile = findDebugProfile(runtimeOptionsProfiles, nextProfileKey);
    setRuntimeOptionsProfileKey(nextProfileKey);
    setRuntimeOptionsEnvText(formatRuntimeEnvText(profile?.env));
  }

  function showProjectActionFeedback(label: string) {
    setCopiedProjectAction(label);
    if (copiedTimerRef.current != null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedProjectAction("");
      copiedTimerRef.current = null;
    }, SHORTCUT_CONFIRM_MS);
  }

  function handleRuntimeOptionsSaveDefault() {
    if (!runtimeOptionsEntry) {
      return;
    }
    onProjectDebugProfileChange(runtimeOptionsEntry.key, runtimeOptionsProfileKey);
    showProjectActionFeedback("runtime-default");
  }

  function handleRuntimeOptionsStart() {
    if (!runtimeOptionsEntry || runtimeOptionsParseResult.error) {
      return;
    }
    onProjectDebugProfileChange(runtimeOptionsEntry.key, runtimeOptionsProfileKey);
    onStartRuntime(
      runtimeOptionsEntry.key,
      runtimeOptionsProfileKey || undefined,
      runtimeOptionsParseResult.values,
    );
    setDetailsPanelTab("logs");
  }

  async function handleCopyProjectValue(value: string, label: string) {
    if (!value) {
      return;
    }
    await copyPlainText(value);
    showProjectActionFeedback(label);
  }

  async function handleClearRuntimeLog() {
    if (!detailsProjectEntry || runtimeLogClearing) {
      return;
    }
    setRuntimeLogClearing(true);
    try {
      const response = await invoke<ProjectRuntimeLogResponse>(
        "clear_project_runtime_log",
        {
          project: detailsProjectEntry.key,
          kind: runtimeLogKind,
        },
      );
      setRuntimeLog({
        projectKey: detailsProjectEntry.key,
        kind: runtimeLogKind,
        path: response.path,
        lines: response.lines,
        truncated: response.truncated,
        readySummary: response.readySummary ?? EMPTY_RUNTIME_READY_SUMMARY,
        sessionSummary: response.sessionSummary ?? EMPTY_RUNTIME_SESSION_SUMMARY,
        loading: false,
        error: "",
      });
      setRuntimeLogRefreshKey((current) => current + 1);
    } catch (reason) {
      setRuntimeLog((current) => ({
        ...current,
        loading: false,
        error: String(reason),
      }));
    } finally {
      setRuntimeLogClearing(false);
    }
  }

  async function openLinkPlan(entry: FinderEntry) {
    const key = linkToolKey(entry);
    const summary = key ? linkSummaryMap.get(key) ?? null : null;
    if (!key) {
      setLinkPlanDialog({
        entryName: entry.name,
        key: "",
        sourceId: linkConfigSourceId,
        plan: null,
        report: null,
        runtime: null,
        loading: false,
        action: null,
        error: "缺少 Link Key",
      });
      return false;
    }
    setLinkPlanDialog({
      entryName: entry.name,
      key,
      sourceId: linkConfigSourceId,
      plan: null,
      report: null,
      runtime: summary?.runtime ?? null,
      loading: true,
      action: null,
      error: "",
    });
    try {
      const plan = await invoke<LinkPlan>("plan_link", { sourceId: linkConfigSourceId, key });
      setLinkPlanDialog({
        entryName: entry.name,
        key,
        sourceId: linkConfigSourceId,
        plan,
        report: null,
        runtime: summary?.runtime ?? null,
        loading: false,
        action: null,
        error: "",
      });
      return true;
    } catch (reason) {
      setLinkPlanDialog({
        entryName: entry.name,
        key,
        sourceId: linkConfigSourceId,
        plan: null,
        report: null,
        runtime: summary?.runtime ?? null,
        loading: false,
        action: null,
        error: String(reason),
      });
      return false;
    }
  }

  async function runLinkDialogAction(action: LinkPlanDialogAction) {
    const key = linkPlanDialog?.key.trim();
    if (!key || linkPlanDialog?.loading || linkPlanDialog?.action) {
      return;
    }
    const command =
      action === "check" ? "check_link" : action === "run" ? "run_link" : "stop_link";
    const sourceId = linkPlanDialog?.sourceId ?? linkConfigSourceId;
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
      const report = await invoke<LinkExecutionReport>(command, {
        sourceId,
        key,
      });
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
        try {
          const summaries = await invoke<LinkSummary[]>("list_links", {
            sourceId,
          });
          setLinkSummaries(summaries);
        } catch {
          setLinkSummaries([]);
        }
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

  async function handleOpenShortcut(item: FinderShortcutItem, shortcutKey: string) {
    try {
      if (isLinkToolEntry(item.entry)) {
        const opened = await openLinkPlan(item.entry);
        if (!opened) {
          return;
        }
        onMarkShortcutUsed(item);
        setConfirmedShortcutKey(shortcutKey);
        return;
      }
      const succeeded = await onOpenFinderEntry(item.entry);
      if (!succeeded) {
        return;
      }
      onMarkShortcutUsed(item);
      setConfirmedShortcutKey(shortcutKey);
      if (confirmTimerRef.current != null) {
        window.clearTimeout(confirmTimerRef.current);
      }
      confirmTimerRef.current = window.setTimeout(() => {
        setConfirmedShortcutKey((current) =>
          current === shortcutKey ? null : current,
        );
        confirmTimerRef.current = null;
      }, SHORTCUT_CONFIRM_MS);
    } catch {
      // The module already reports the failure; no success checkmark is shown.
    }
  }

  function projectWorkflowActionAvailable(
    item: ProjectRuntimeEntry,
    action: ProjectWorkflowAction,
  ) {
    switch (action) {
      case "project.runtime.start":
      case "project.runtime.stop":
        return Boolean(item.command);
      case "project.build.run":
      case "project.build.stop":
        return Boolean(item.buildCommand);
      case "project.build.openOutput":
        return Boolean(item.buildOutputDir);
      case "project.runtime.focus":
        return item.canFocusRuntime;
      case "project.openDirectory":
        return Boolean(item.cwd || item.repoPath);
      case "finder.shortcut.open":
        return false;
    }
  }

  function defaultProjectWorkflowAction(item: ProjectRuntimeEntry): ProjectWorkflowAction {
    if (item.command) {
      return "project.runtime.start";
    }
    if (item.buildCommand) {
      return "project.build.run";
    }
    return "project.openDirectory";
  }

  function openProjectWorkflowDialog(item: ProjectRuntimeEntry) {
    setWorkflowProjectKey(item.key);
    setWorkflowAction(defaultProjectWorkflowAction(item));
    setWorkflowOpen(true);
  }

  function openProjectConfig(projectKey = "") {
    if (!projectConfigPanel) {
      return;
    }
    setProjectConfigKey(projectKey);
    setProjectConfigOpen(true);
  }

  return (
    <Box
      className={`workspace workspace--finder workspace--finder-${mode}`}
      sx={{
        height: "100%",
        minHeight: 0,
        maxHeight: "100%",
        overflow: "hidden",
        "@media (max-width: 900px)": {
          height: "100%",
          minHeight: 0,
        },
      }}
    >
      <Box
        className="finder-workbench-surface"
        sx={{
          position: "relative",
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          borderRadius: { xs: "16px", md: "18px" },
          overflow: "hidden",
          border: `1px solid ${tone.stageBorder}`,
          bgcolor: tone.stageBg,
          color: tone.outerColor,
          boxShadow: tone.stageShadow,
          p: { xs: 0.55, md: 0.65 },
          backdropFilter: "blur(22px) saturate(1.12)",
          WebkitBackdropFilter: "blur(22px) saturate(1.12)",
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: "inherit",
            background: tone.stageOverlay,
            opacity: 1,
          },
        }}
      >
        <Box
          className="finder-workbench-inner"
          sx={{
            position: "relative",
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            p: 0,
          }}
        >
          <WorkspacePageToolbar
            className={`finder-toolbar finder-toolbar--${mode}`}
            ariaLabel={finderIsProjects ? "项目概览与配置" : "资源入口概览与配置"}
            metrics={pageToolbarMetrics}
            actions={
              <>
              {finderIsProjects ? (
                <WorkflowLinkSummaryButton
                  count={workflowGroups.length}
                  onClick={() => setWorkflowListOpen(true)}
                />
              ) : null}
              {finderIsProjects && projectConfigPanel ? (
                <WorkspacePageToolbarAction
                  startIcon={<SettingsIcon sx={{ fontSize: 14 }} />}
                  onClick={() => openProjectConfig()}
                >
                  项目配置
                </WorkspacePageToolbarAction>
              ) : null}
              {!finderIsProjects && onOpenResourceConfig ? (
                <WorkspacePageToolbarAction
                  startIcon={<SettingsIcon sx={{ fontSize: 14 }} />}
                  onClick={onOpenResourceConfig}
                >
                  入口配置
                </WorkspacePageToolbarAction>
              ) : null}
              </>
            }
          />

          <Box
            sx={{
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              position: "relative",
              borderRadius: "20px",
              border: 0,
              background: "transparent",
              boxShadow: "none",
              backdropFilter: "none",
              "&::before": {
                display: "none",
              },
            }}
          >
            <Box
              sx={{
                position: "relative",
                flex: "1 1 auto",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                p: 0,
              }}
            >
              <Box
                className="finder-search-shell"
                sx={{
                  mb: 0.52,
                  p: 0.32,
                  borderRadius: "14px",
                  border: `1px solid ${tone.searchWrapBorder}`,
                  backgroundColor: tone.searchWrapBg,
                  boxShadow: tone.searchWrapShadow,
                  backdropFilter: "blur(12px)",
                }}
              >
                <Stack direction="row" spacing={0.65} alignItems="center">
                  <TextField
                    fullWidth
                    inputRef={searchInputRef}
                    value={finderQuery}
                    onChange={(event) =>
                      onFinderQueryChange(event.target.value)
                    }
                    placeholder={finderIsProjects ? finderPlaceholder("项目") : finderPlaceholder(finderType)}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        minHeight: 40,
                        borderRadius: "12px",
                        backgroundColor: tone.searchInputBg,
                        color: tone.searchInputColor,
                        "& .MuiOutlinedInput-notchedOutline": {
                          borderColor: tone.searchInputBorder,
                        },
                        "&:hover .MuiOutlinedInput-notchedOutline": {
                          borderColor: tone.searchInputHoverBorder,
                        },
                        "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                          borderColor: tone.searchInputFocusBorder,
                        },
                      },
                      "& .MuiInputBase-input": {
                        paddingTop: "8.5px",
                        paddingBottom: "8.5px",
                      },
                      "& .MuiInputBase-input::placeholder": {
                        color: tone.searchPlaceholder,
                        opacity: 1,
                      },
                    }}
                  />
                  <Tooltip title="清空搜索">
                    <span>
                      <IconButton
                        onClick={() => onFinderQueryChange("")}
                        disabled={!finderQuery}
                        aria-label={finderIsProjects ? "清空项目搜索" : "清空入口搜索"}
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: "11px",
                          color: tone.clearButtonColor,
                          border: `1px solid ${tone.clearButtonBorder}`,
                          backgroundColor: tone.clearButtonBg,
                          "&:hover": {
                            backgroundColor: tone.clearButtonHoverBg,
                            borderColor: tone.clearButtonHoverBorder,
                          },
                        }}
                      >
                        <ClearIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={finderIsProjects ? "刷新项目状态" : "刷新入口"}>
                    <span>
                      <IconButton
                        aria-label={finderIsProjects ? "刷新项目状态" : "刷新入口"}
                        onClick={onRefresh}
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: "11px",
                          color: tone.clearButtonColor,
                          border: `1px solid ${tone.clearButtonBorder}`,
                          backgroundColor: tone.clearButtonBg,
                          "&:hover": {
                            color: tone.toolButtonHoverColor,
                            backgroundColor: tone.clearButtonHoverBg,
                            borderColor: tone.clearButtonHoverBorder,
                          },
                        }}
                      >
                        <RefreshIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Box>

              {mode === "resources" ? (
                <Tabs
                  className="finder-type-tabs-shell"
                  value={finderType}
                  onChange={(_, value) => onFinderTypeChange(value as FinderType)}
                  variant="fullWidth"
                  aria-label="入口类型筛选"
                  sx={{
                    mb: 0.52,
                    minHeight: 40,
                    p: 0.5,
                    borderRadius: "14px",
                    border: `1px solid ${tone.searchWrapBorder}`,
                    backgroundColor: tone.searchWrapBg,
                    boxShadow: tone.searchWrapShadow,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  {finderTypeOptions.map((type) => (
                    <Tab
                      key={type}
                      value={type}
                      icon={finderTypeIcon(type)}
                      iconPosition="start"
                      label={(
                        <Box component="span" className="finder-type-tab-label">
                          <Box component="span">{type}</Box>
                          <Box component="span" className="finder-type-tab-count">
                            {finderTypeCounts[type] ?? 0}
                          </Box>
                        </Box>
                      )}
                      aria-label={`${type} ${finderTypeCounts[type] ?? 0}`}
                    />
                  ))}
                </Tabs>
              ) : null}

              {showFinderCategories ? (
                <Box
                  sx={{
                    mb: 0.55,
                    p: 0.48,
                    borderRadius: "11px",
                    border: `1px solid ${tone.searchWrapBorder}`,
                    backgroundColor: tone.searchWrapBg,
                    boxShadow: tone.searchWrapShadow,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <Stack spacing={0.42}>
                    <Box
                      sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 0.42,
                      }}
                    >
                      {finderCategories.map((category) => {
                        const active = category === finderCategory;
                        return (
                          <Chip
                            key={category}
                            size="small"
                            label={
                              finderCategoryCounts[category] != null
                                ? `${category} ${finderCategoryCounts[category]}`
                                : category
                            }
                            onClick={() => onFinderCategoryChange(category)}
                            sx={{
                              height: 20,
                              bgcolor: active
                                ? tone.categoryChipActiveBg
                                : tone.categoryChipBg,
                              color: active
                                ? tone.categoryChipActiveColor
                                : tone.categoryChipColor,
                              border: `1px solid ${
                                active
                                  ? tone.categoryChipActiveBorder
                                  : tone.categoryChipBorder
                              }`,
                              backdropFilter: "blur(10px)",
                              "&:hover": {
                                bgcolor: active
                                  ? tone.categoryChipActiveBg
                                  : tone.categoryChipHoverBg,
                              },
                              "& .MuiChip-label": {
                                px: 0.7,
                                fontSize: "0.62rem",
                                fontWeight: active ? 700 : 600,
                                letterSpacing: "0.02em",
                              },
                            }}
                          />
                        );
                      })}
                    </Box>
                  </Stack>
                </Box>
              ) : null}

              {finderIsProjects && runtimeEntries.length === 0 ? (
                <AppEmptyState compact title="暂无项目" description="检查 projects.toml 是否可读。" />
              ) : null}

              {finderIsProjects &&
              runtimeEntries.length > 0 &&
              projectRuntimeEntries.length === 0 ? (
                <AppEmptyState compact title="没有匹配项目" description="调整搜索词再试。" />
              ) : null}

              {finderIsProjects &&
              runtimeEntries.length > 0 &&
              projectRuntimeEntries.length > 0 ? (
                <Stack
                  spacing={0.4}
                  minWidth={0}
                  minHeight={0}
                  flex="1 1 auto"
                  overflow="hidden"
                >
                  <Box
                    ref={finderListRef}
                    className="module-list-scroll finder-list-scroll"
                    onScroll={handleFinderListScroll}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.46,
                      flex: "1 1 auto",
                      minHeight: 0,
                    }}
                  >
                    {visibleRuntimeEntries.map((item, index) => {
                    const runtimeRunning =
                      item.statusKey === "running" ||
                      item.statusKey === "external" ||
                      item.canStop;
                    const runtimeAvailable =
                      item.canStart || item.canStop || item.canAdopt;
                    const runtimeTooltip = item.canAdopt
                      ? "认领外部项目"
                      : runtimeRunning
                      ? "停止项目"
                      : "启动项目";
                    const runtimeAriaLabel = item.canAdopt
                      ? `认领 ${item.name}`
                      : runtimeRunning
                      ? `停止 ${item.name}`
                      : `启动 ${item.name}`;
                    const statusPalette = buildStatusPalette(
                      item.statusKey,
                      mono,
                    );
                    const debugProfiles = item.debugProfiles ?? [];
                    const projectFavorite = favoriteProjectKeySet.has(item.key);
                    const selectedDebugProfileKey = projectSelectedProfileKey(
                      item,
                      selectedDebugProfileKeys,
                    );
                    const selectedDebugProfile =
                      debugProfiles.find((profile) => profile.key === selectedDebugProfileKey) ??
                      null;
                    const selectedRuntimeProfileKey =
                      selectedDebugProfile?.runtimeProfile?.trim() ?? "";
                    const selectedRuntimeProfile =
                      runtimeProfileDrafts.find(
                        (profile) => profile.key === selectedRuntimeProfileKey,
                      ) ?? null;
                    const commonRuntimeProfileLabel =
                      runtimeProfileLabel(selectedRuntimeProfile) ||
                      selectedRuntimeProfileKey ||
                      "默认";
                    const projectDebugProfileLabel =
                      selectedDebugProfile?.label?.trim() || "默认";
                    const commonRuntimeChipLabel = `通用 ${commonRuntimeProfileLabel}`;
                    const projectDebugChipLabel = `项目 ${projectDebugProfileLabel}`;
                    const runtimeStartTooltip =
                      !runtimeRunning && selectedDebugProfile
                        ? `启动项目 · ${selectedDebugProfile.label}`
                        : runtimeTooltip;
                    const focusableRuntimeRow =
                      runtimeRunning && item.canFocusRuntime;
                    const runtimeFocusTooltip = item.canFocusRuntime
                      ? "打开运行中的项目"
                      : "未配置打开地址，且未识别到启动 URL";
                    const runtimeFocusGlow = mono
                      ? "rgba(117, 151, 255, 0.2)"
                      : "rgba(77, 123, 214, 0.16)";
                    const projectAccent = projectAccentColor(item);
                    const projectPath = projectDisplayPath(item);
                    const projectCommand = projectDisplayCommand(item);
                    return (
                      <Box
                        key={item.key}
                        className={`project-runtime-row${runtimeRunning ? " is-running" : ""}${focusableRuntimeRow ? " is-focusable" : ""}${projectFavorite ? " is-favorite" : ""}`}
                        title={focusableRuntimeRow ? "点击唤起项目" : undefined}
                        onClick={(event) => {
                          if (
                            !focusableRuntimeRow ||
                            isInteractiveClickTarget(event.target)
                          ) {
                            return;
                          }
                          onFocusRuntime(
                            item.key,
                            selectedDebugProfileKey || undefined,
                          );
                        }}
                        sx={{
                          "--project-accent": projectAccent,
                          "--project-status-dot": statusPalette.dot,
                          "--project-status-bg": statusPalette.pillBg,
                          "--project-status-border": statusPalette.pillBorder,
                          "--project-status-color": statusPalette.pillColor,
                          borderColor:
                            projectFavorite
                              ? tone.categoryChipActiveBorder
                              : focusableRuntimeRow
                                ? tone.startButtonBorder
                              : index === 0
                                ? tone.rowBorderStrong
                                : tone.rowBorder,
                          background:
                            index % 2 === 0 ? tone.rowBgEven : tone.rowBgOdd,
                          boxShadow: focusableRuntimeRow
                            ? `${tone.rowShadow}, 0 0 0 1px ${tone.startButtonBorder}, 0 0 22px ${runtimeFocusGlow}`
                            : tone.rowShadow,
                          cursor: focusableRuntimeRow ? "pointer" : "default",
                          animation:
                            item.statusKey === "running"
                              ? "projectRuntimeStartGlow 920ms ease-out 1"
                              : "none",
                          transition:
                            "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease",
                          "&:hover": {
                            transform: "translateY(-1px)",
                            borderColor: focusableRuntimeRow
                              ? tone.startButtonBorder
                              : tone.rowHoverBorder,
                            background: tone.rowHoverBg,
                            boxShadow: focusableRuntimeRow
                              ? `${tone.rowHoverShadow}, 0 0 0 1px ${tone.startButtonBorder}, 0 0 24px ${runtimeFocusGlow}`
                              : tone.rowHoverShadow,
                          },
                          "@keyframes projectRuntimeStartGlow": {
                            "0%": {
                              boxShadow: `${tone.rowShadow}, 0 0 0 0 ${runtimeFocusGlow}`,
                            },
                            "42%": {
                              boxShadow: `${tone.rowShadow}, 0 0 0 2px ${tone.startButtonBorder}, 0 0 26px ${runtimeFocusGlow}`,
                            },
                            "100%": {
                              boxShadow: focusableRuntimeRow
                                ? `${tone.rowShadow}, 0 0 0 1px ${tone.startButtonBorder}, 0 0 22px ${runtimeFocusGlow}`
                              : tone.rowShadow,
                            },
                          },
                          "@media (prefers-reduced-motion: reduce)": {
                            animation: "none",
                            transition: "none",
                            "&:hover": {
                              transform: "none",
                            },
                          },
                        }}
                      >
                        <span className="project-runtime-avatar" aria-hidden="true">
                          {projectMonogram(item)}
                        </span>

                        <Box className="project-runtime-title-block">
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={0.45}
                            minWidth={0}
                            className="project-runtime-title-line"
                          >
                            <Typography
                              className="project-runtime-title"
                              noWrap
                              title={item.name}
                            >
                              {item.name}
                            </Typography>
                            {projectFavorite ? (
                              <StarIcon className="project-runtime-star" />
                            ) : null}
                          </Stack>
                          <Typography
                            className="project-runtime-key"
                            noWrap
                            title={item.key}
                          >
                            {item.key}
                          </Typography>
                        </Box>

                        <Box className="project-runtime-meta">
                          <span title={item.cwd || item.repoPath || projectPath}>
                            <FolderIcon fontSize="inherit" />
                            <span className="project-runtime-meta-text">
                              {projectPath}
                            </span>
                          </span>
                          <span title={item.command || item.buildCommand || projectCommand}>
                            <TerminalIcon fontSize="inherit" />
                            <span className="project-runtime-meta-text">
                              {projectCommand}
                            </span>
                          </span>
                        </Box>

                        <Box className="project-runtime-tags">
                          <Chip
                            size="small"
                            className="project-runtime-common-chip"
                            label={commonRuntimeChipLabel}
                            title={`通用运行配置：${commonRuntimeProfileLabel}`}
                          />
                          <Chip
                            size="small"
                            className="project-runtime-profile-chip"
                            label={projectDebugChipLabel}
                            title={`项目运行配置：${projectDebugProfileLabel}`}
                          />
                        </Box>

                        <Stack
                          direction="row"
                          spacing={0.38}
                          justifyContent="flex-end"
                          data-project-row-action="true"
                          className="project-runtime-actions"
                        >
                          {runtimeRunning ? (
                            <Tooltip title={runtimeFocusTooltip}>
                              <span>
                                <IconButton
                                  className="project-runtime-action is-focus"
                                  aria-label={`打开 ${item.name}`}
                                  disabled={!item.canFocusRuntime}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!item.canFocusRuntime) {
                                      return;
                                    }
                                    onFocusRuntime(
                                      item.key,
                                      selectedDebugProfileKey || undefined,
                                    );
                                  }}
                                >
                                  <OpenExternalIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ) : null}
                          <Tooltip title={runtimeStartTooltip}>
                            <span>
                              <IconButton
                                className={`project-runtime-action ${item.canAdopt ? "is-focus" : runtimeRunning ? "is-stop" : "is-run"}`}
                                aria-label={runtimeAriaLabel}
                                disabled={!runtimeAvailable}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (item.canAdopt && item.pid) {
                                    onAdoptRuntime(
                                      item.key,
                                      selectedDebugProfileKey || undefined,
                                    );
                                    return;
                                  }
                                  if (runtimeRunning) {
                                    onStopRuntime(item.key);
                                    return;
                                  }
                                  onStartRuntime(
                                    item.key,
                                    selectedDebugProfileKey || undefined,
                                  );
                                }}
                              >
                                {item.canAdopt ? (
                                  <WorkflowIcon fontSize="small" />
                                ) : runtimeRunning ? (
                                  <StopIcon fontSize="small" />
                                ) : (
                                  <PlayIcon fontSize="small" />
                                )}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={item.cwd || item.repoPath ? "打开项目目录" : "未配置项目目录"}>
                            <span>
                              <IconButton
                                className="project-runtime-action is-muted"
                                aria-label={`打开 ${item.name} 的项目目录`}
                                disabled={!item.cwd && !item.repoPath}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenProjectDirectory(item.key);
                                }}
                              >
                                <FolderIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="更多操作">
                            <span>
                              <IconButton
                                className="project-runtime-action is-muted"
                                aria-label={`${item.name} 更多操作`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setProjectMenuAnchor(event.currentTarget);
                                  setProjectMenuKey(item.key);
                                }}
                              >
                                <MoreIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>

                      </Box>
                    );
                    })}
                    <Stack
                      className={
                        hasMoreFinderEntries
                          ? "workflow-history-footer"
                          : "workflow-history-footer workflow-history-footer--done"
                      }
                    >
                      {hasMoreFinderEntries ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={loadMoreFinderEntries}
                          className="workflow-history-footer-action"
                        >
                          下滑加载更多
                        </Button>
                      ) : (
                        <AppListEndState />
                      )}
                    </Stack>
                  </Box>
                </Stack>
              ) : null}

              <Menu
                anchorEl={projectMenuAnchor}
                open={Boolean(projectMenuAnchor)}
                onClose={closeProjectMenu}
                slotProps={{
                  paper: {
                    sx: {
                      mt: 0.6,
                      minWidth: 190,
                      borderRadius: "14px",
                      border: `1px solid ${tone.menuBorder}`,
                      background: tone.menuBg,
                      color: tone.outerColor,
                      boxShadow: tone.menuShadow,
                      backdropFilter: "blur(18px) saturate(1.16)",
                      WebkitBackdropFilter: "blur(18px) saturate(1.16)",
                      backgroundImage: "none",
                      "& .MuiMenu-list": {
                        py: 0.55,
                      },
                      "& .MuiMenuItem-root": {
                        minHeight: 34,
                        px: 1.1,
                        gap: 0.4,
                        borderRadius: "10px",
                        mx: 0.45,
                      },
                    },
                  },
                }}
              >
                <MenuItem
                  disabled={!projectMenuEntry}
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    openRuntimePanel(projectMenuEntry);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <AppWindowIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="运行面板"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={!projectMenuEntry || !projectConfigPanel}
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    openProjectConfig(projectMenuEntry.key);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <SettingsIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="项目配置"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={!projectMenuEntry}
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    onToggleProjectFavorite(projectMenuEntry.key);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 30,
                      color: projectMenuFavorite
                        ? tone.categoryChipActiveColor
                        : "inherit",
                    }}
                  >
                    <StarIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={projectMenuFavorite ? "取消标记" : "标记项目"}
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={!projectMenuEntry}
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    openProjectWorkflowDialog(projectMenuEntry);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <WorkflowIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="配置联动"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
              </Menu>

              {detailsProjectEntry ? (
                <RuntimePanelDrawer
                  open
                  onClose={closeRuntimePanel}
                  title={detailsProjectEntry.name}
                  statusDotColor={
                    buildStatusPalette(detailsProjectEntry.statusKey, mono).dot
                  }
                  statusDotShadow={
                    detailsProjectEntry.statusKey === "running"
                      ? tone.runningDotHalo
                      : "none"
                  }
                  headerActions={
                    <Stack direction="row" spacing={0.5}>
                      {detailsProjectEntry.canAdopt && detailsProjectEntry.pid ? (
                        <Tooltip title="认领外部项目">
                          <IconButton
                            aria-label={`认领 ${detailsProjectEntry.name}`}
                            onClick={() =>
                              onAdoptRuntime(
                                detailsProjectEntry.key,
                                projectSelectedProfileKey(
                                  detailsProjectEntry,
                                  selectedDebugProfileKeys,
                                ) || undefined,
                              )
                            }
                            sx={{
                              width: 30,
                              height: 30,
                              borderRadius: "999px",
                              bgcolor: tone.startButtonBg,
                              color: tone.startButtonColor,
                              border: `1px solid ${tone.startButtonBorder}`,
                            }}
                          >
                            <WorkflowIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      <Tooltip
                        title={
                          detailsProjectPath ? "打开项目目录" : "未配置项目目录"
                        }
                      >
                        <span>
                          <IconButton
                            aria-label="打开项目目录"
                            disabled={!detailsProjectPath}
                            onClick={() =>
                              onOpenProjectDirectory(detailsProjectEntry.key)
                            }
                            sx={{
                              width: 30,
                              height: 30,
                              borderRadius: "999px",
                              bgcolor: tone.stopButtonBg,
                              color: detailsProjectPath
                                ? tone.stopButtonColor
                                : tone.stopButtonDisabledColor,
                              border: `1px solid ${tone.stopButtonBorder}`,
                            }}
                          >
                            <FolderIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  }
                  chips={
                    <>
                      <Chip
                        size="small"
                        label={detailsProjectEntry.statusLabel}
                        sx={{
                          bgcolor: buildStatusPalette(
                            detailsProjectEntry.statusKey,
                            mono,
                          ).pillBg,
                          color: buildStatusPalette(
                            detailsProjectEntry.statusKey,
                            mono,
                          ).pillColor,
                          border: `1px solid ${
                            buildStatusPalette(detailsProjectEntry.statusKey, mono)
                              .pillBorder
                          }`,
                        }}
                      />
                      {detailsProjectEntry.buildCommand ||
                      detailsProjectEntry.buildStatusKey !== "notConfigured" ? (
                        <Chip
                          size="small"
                          label={detailsProjectEntry.buildStatusLabel}
                          sx={{
                            bgcolor: buildStatusPalette(
                              detailsProjectEntry.buildStatusKey,
                              mono,
                            ).pillBg,
                            color: buildStatusPalette(
                              detailsProjectEntry.buildStatusKey,
                              mono,
                            ).pillColor,
                            border: `1px solid ${
                              buildStatusPalette(
                                detailsProjectEntry.buildStatusKey,
                                mono,
                              ).pillBorder
                            }`,
                          }}
                        />
                      ) : null}
                    </>
                  }
                  tabs={[
                    {
                      value: "overview",
                      label: "概览",
                      icon: <AppWindowIcon fontSize="small" />,
                    },
                    {
                      value: "config",
                      label: "运行配置",
                      icon: <SettingsIcon fontSize="small" />,
                    },
                    {
                      value: "logs",
                      label: "日志",
                      icon: <TerminalIcon fontSize="small" />,
                    },
                    ...(detailsWebActionsContext
                      ? [
                          {
                            value: "webActions" as const,
                            label: "网页动作",
                            icon: <WebsiteIcon fontSize="small" />,
                          },
                        ]
                      : []),
                  ]}
                  activeTab={detailsPanelTab}
                  onTabChange={(value) => setDetailsPanelTab(value)}
                  bodyOverflow={detailsPanelTab === "logs" ? "hidden" : "auto"}
                >
                      {detailsPanelTab === "overview" ? (
                        <>
                          {(() => {
                            const preflight = runtimePreflight.response;
                            const summaryPalette = buildPreflightPalette(
                              preflight?.statusKey ?? "info",
                              mono,
                            );
                            const checks = (preflight?.checks ?? [])
                              .slice()
                              .sort(
                                (left, right) =>
                                  preflightPriority(left) - preflightPriority(right),
                              );
                            const checkStats = {
                              error: checks.filter((check) => check.statusKey === "error")
                                .length,
                              warning: checks.filter(
                                (check) => check.statusKey === "warning",
                              ).length,
                              ok: checks.filter((check) => check.statusKey === "ok").length,
                            };
                            return (
                              <Box
                                sx={{
                                  border: `1px solid ${tone.searchWrapBorder}`,
                                  borderRadius: "14px",
                                  bgcolor: tone.searchWrapBg,
                                  boxShadow: tone.searchWrapShadow,
                                  overflow: "hidden",
                                }}
                              >
                                <Stack
                                  direction="row"
                                  alignItems="center"
                                  spacing={0.8}
                                  sx={{
                                    px: 1,
                                    py: 0.8,
                                    borderBottom: `1px solid ${tone.actionGroupBorder}`,
                                  }}
                                >
                                  <Box
                                    sx={{
                                      width: 5,
                                      height: 34,
                                      borderRadius: "999px",
                                      bgcolor: summaryPalette.dot,
                                      opacity: 0.72,
                                    }}
                                  />
                                  <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Stack
                                      direction="row"
                                      alignItems="center"
                                      spacing={0.6}
                                      sx={{ minWidth: 0 }}
                                    >
                                      <Typography
                                        variant="subtitle2"
                                        noWrap
                                        sx={{
                                          color: tone.rowTitle,
                                          fontWeight: 820,
                                          letterSpacing: 0,
                                        }}
                                      >
                                        链路预检
                                      </Typography>
                                      <Chip
                                        size="small"
                                        label={
                                          runtimePreflight.loading
                                            ? "检查中"
                                            : preflight?.statusLabel ||
                                              (runtimePreflight.error ? "异常" : "未检查")
                                        }
                                        sx={{
                                          height: 22,
                                          bgcolor: summaryPalette.pillBg,
                                          color: summaryPalette.pillColor,
                                          border: `1px solid ${summaryPalette.pillBorder}`,
                                          "& .MuiChip-label": {
                                            px: 0.75,
                                            fontSize: "0.62rem",
                                            fontWeight: 800,
                                          },
                                        }}
                                      />
                                      {[
                                        { label: "异常", value: checkStats.error },
                                        { label: "关注", value: checkStats.warning },
                                        { label: "正常", value: checkStats.ok },
                                      ].map((item) => (
                                        <Typography
                                          key={item.label}
                                          variant="caption"
                                          sx={{
                                            color: tone.rowHint,
                                            fontWeight: 760,
                                            fontVariantNumeric: "tabular-nums",
                                          }}
                                        >
                                          {item.label} {item.value}
                                        </Typography>
                                      ))}
                                    </Stack>
                                    <Typography
                                      variant="caption"
                                      noWrap
                                      sx={{
                                        display: "block",
                                        color: tone.rowHint,
                                        mt: 0.12,
                                      }}
                                    >
                                      {runtimePreflight.error ||
                                        preflight?.summary ||
                                        "检查启动命令、调试档案、代理和受控浏览器"}
                                    </Typography>
                                  </Box>
                                  <Tooltip title="刷新预检">
                                    <span>
                                      <IconButton
                                        aria-label="刷新链路预检"
                                        disabled={runtimePreflight.loading}
                                        onClick={() =>
                                          setRuntimePreflightRefreshKey(
                                            (current) => current + 1,
                                          )
                                        }
                                        sx={{
                                          width: 32,
                                          height: 32,
                                          borderRadius: "11px",
                                          color: tone.toolButtonColor,
                                          border: `1px solid ${tone.toolButtonBorder}`,
                                          bgcolor: tone.toolButtonBg,
                                          "&:hover": {
                                            color: tone.toolButtonHoverColor,
                                            bgcolor: tone.toolButtonHoverBg,
                                            borderColor: tone.toolButtonHoverBorder,
                                          },
                                        }}
                                      >
                                        <RefreshIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                </Stack>

                                <Box
                                  sx={{
                                    display: "grid",
                                    gridTemplateColumns: {
                                      xs: "minmax(0, 1fr)",
                                      md: "repeat(2, minmax(0, 1fr))",
                                    },
                                    gap: 0,
                                  }}
                                >
                                  {checks.slice(0, 8).map((check) => {
                                    const palette = buildPreflightPalette(
                                      check.statusKey,
                                      mono,
                                    );
                                    return (
                                      <Box
                                        key={check.key}
                                        sx={{
                                          minWidth: 0,
                                          px: 1,
                                          py: 0.68,
                                          borderTop: `1px solid ${tone.actionGroupBorder}`,
                                          borderRight: {
                                            md: `1px solid ${tone.actionGroupBorder}`,
                                          },
                                          "&:nth-of-type(2n)": {
                                            borderRight: { md: "none" },
                                          },
                                        }}
                                      >
                                        <Stack
                                          direction="row"
                                          alignItems="center"
                                          spacing={0.5}
                                          sx={{ minWidth: 0 }}
                                        >
                                          <Box
                                            sx={{
                                              width: 6,
                                              height: 6,
                                              borderRadius: "50%",
                                              bgcolor: palette.dot,
                                              flex: "0 0 auto",
                                              opacity: 0.9,
                                            }}
                                          />
                                          <Typography
                                            variant="caption"
                                            noWrap
                                            sx={{
                                              color: tone.rowTitle,
                                              fontWeight: 780,
                                              minWidth: 0,
                                              flex: 1,
                                            }}
                                          >
                                            {check.title}
                                          </Typography>
                                          <Typography
                                            variant="caption"
                                            sx={{
                                              color: palette.pillColor,
                                              fontWeight: 760,
                                              flex: "0 0 auto",
                                            }}
                                          >
                                            {check.statusLabel}
                                          </Typography>
                                        </Stack>
                                        <Typography
                                          variant="caption"
                                          sx={{
                                            display: "block",
                                            mt: 0.16,
                                            color: tone.rowMeta,
                                            overflowWrap: "anywhere",
                                            lineHeight: 1.45,
                                          }}
                                        >
                                          {check.detail}
                                        </Typography>
                                        {check.action ? (
                                          <Typography
                                            variant="caption"
                                            sx={{
                                              display: "block",
                                              mt: 0.12,
                                              color:
                                                check.statusKey === "ok"
                                                  ? tone.rowHint
                                                  : summaryPalette.pillColor,
                                              overflowWrap: "anywhere",
                                              lineHeight: 1.35,
                                            }}
                                          >
                                              {check.action}
                                          </Typography>
                                        ) : null}
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Box>
                            );
                          })()}
                          <Box
                            sx={{
                              display: "grid",
                              gridTemplateColumns: {
                                xs: "minmax(0, 1fr)",
                                lg: "repeat(2, minmax(0, 1fr))",
                              },
                              gap: 0.75,
                            }}
                          >
                            {[
                              {
                                title: "运行",
                                rows: [
                                  ["状态详情", detailsProjectEntry.detail || "无"],
                                  ["PID", detailsProjectEntry.pid?.toString() || "未运行"],
                                  [
                                    "启动时间",
                                    formatDateTime(detailsProjectEntry.startedAtMs),
                                  ],
                                  [
                                    "运行时长",
                                    formatElapsedTime(
                                      detailsProjectEntry.startedAtMs,
                                      nowMs,
                                    ),
                                  ],
                                  ["工作目录", detailsProjectEntry.cwd || "未配置"],
                                  ["仓库目录", detailsProjectEntry.repoPath || "未配置"],
                                  ["启动命令", detailsProjectEntry.command || "未配置"],
                                  ["日志路径", detailsProjectEntry.logPath || "未生成"],
                                ],
                              },
                              {
                                title: "构建",
                                rows: [
                                  [
                                    "构建状态",
                                    detailsProjectEntry.buildStatusLabel || "未配置",
                                  ],
                                  ["构建详情", detailsProjectEntry.buildDetail || "无"],
                                  [
                                    "构建 PID",
                                    detailsProjectEntry.buildPid?.toString() || "未运行",
                                  ],
                                  [
                                    "开始时间",
                                    formatDateTime(detailsProjectEntry.buildStartedAtMs),
                                  ],
                                  [
                                    "输出目录",
                                    detailsProjectEntry.buildOutputDir || "未配置",
                                  ],
                                  [
                                    "构建命令",
                                    detailsProjectEntry.buildCommand || "未配置",
                                  ],
                                  [
                                    "日志路径",
                                    detailsProjectEntry.buildLogPath || "未生成",
                                  ],
                                ],
                              },
                            ].map((section) => (
                              <Box
                                key={section.title}
                                sx={{
                                  border: `1px solid ${tone.searchWrapBorder}`,
                                  borderRadius: "14px",
                                  bgcolor: tone.searchWrapBg,
                                  boxShadow: tone.searchWrapShadow,
                                  overflow: "hidden",
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "block",
                                    px: 1,
                                    py: 0.72,
                                    color: tone.rowHint,
                                    fontWeight: 800,
                                    letterSpacing: "0.06em",
                                    borderBottom: `1px solid ${tone.actionGroupBorder}`,
                                  }}
                                >
                                  {section.title}
                                </Typography>
                                {section.rows.map(([label, value], index) => (
                                  <Box
                                    key={`${section.title}-${label}`}
                                    sx={{
                                      display: "grid",
                                      gridTemplateColumns: "72px minmax(0, 1fr)",
                                      gap: 0.8,
                                      alignItems: "start",
                                      px: 1,
                                      py: 0.58,
                                      borderTop:
                                        index === 0
                                          ? "none"
                                          : `1px solid ${tone.actionGroupBorder}`,
                                    }}
                                  >
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        color: tone.rowKey,
                                        fontWeight: 720,
                                      }}
                                    >
                                      {label}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        minWidth: 0,
                                        color: tone.rowMeta,
                                        overflowWrap: "anywhere",
                                        fontFamily:
                                          label.includes("目录") ||
                                          label.includes("日志") ||
                                          label.includes("命令") ||
                                          label.includes("PID")
                                            ? '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace'
                                            : undefined,
                                      }}
                                    >
                                      {value}
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ))}
                          </Box>
                        </>
                      ) : null}

                      {detailsPanelTab === "config" && runtimeOptionsEntry ? (
                        <>
                        <Box
                          sx={{
                            p: 1,
                            borderRadius: "16px",
                            border: `1px solid ${tone.searchWrapBorder}`,
                            bgcolor: tone.searchWrapBg,
                            boxShadow: tone.searchWrapShadow,
                            mb: 1,
                          }}
                        >
                          <Stack spacing={1}>
                            {renderRuntimeConfigSourceBar()}
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              alignItems={{ xs: "stretch", sm: "flex-start" }}
                              justifyContent="space-between"
                              spacing={0.8}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Stack
                                  direction="row"
                                  spacing={0.65}
                                  alignItems="center"
                                  flexWrap="wrap"
                                  useFlexGap
                                >
                                  <Typography
                                    variant="caption"
                                    sx={{ color: tone.rowMeta, fontWeight: 750 }}
                                  >
                                    通用运行配置
                                  </Typography>
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={runtimeProfileScopeLabel(runtimeProfileScope)}
                                    sx={{ height: 22 }}
                                  />
                                </Stack>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "block",
                                    color: tone.rowKey,
                                    mt: 0.15,
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  浏览器、代理和域名映射。
                                  {runtimeProfileScopeDescription(runtimeProfileScope)}
                                </Typography>
                              </Box>
                              <Stack
                                direction="row"
                                spacing={0.55}
                                flexWrap="wrap"
                                useFlexGap
                                justifyContent={{ xs: "flex-start", sm: "flex-end" }}
                              >
                                {runtimeProfileScope === "override" ? (
                                  <Tooltip title="恢复继承全局运行配置">
                                    <span>
                                      <IconButton
                                        aria-label="恢复继承全局运行配置"
                                        disableRipple
                                        disableFocusRipple
                                        disabled={runtimeProfilesSaving}
                                        onClick={() => void restoreRuntimeProfileInheritance()}
                                        sx={runtimePanelActionButtonSx}
                                      >
                                        <ReplayIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                ) : null}
                                <Tooltip title="刷新运行配置">
                                  <span>
                                    <IconButton
                                      aria-label="刷新运行配置"
                                      disableRipple
                                      disableFocusRipple
                                      disabled={runtimeProfilesSaving}
                                      onClick={() =>
                                        void loadRuntimeProfiles(
                                          runtimeOptionsSelectedProfile?.runtimeProfile,
                                        )
                                      }
                                      sx={runtimePanelActionButtonSx}
                                    >
                                      <RefreshIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="新增运行配置">
                                  <span>
                                    <IconButton
                                      aria-label="新增运行配置"
                                      disableRipple
                                      disableFocusRipple
                                      disabled={runtimeProfilesSaving || runtimeProfilesReadOnly}
                                      onClick={addRuntimePanelProfile}
                                      sx={runtimePanelActionButtonSx}
                                    >
                                      <PlusIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="编辑运行配置">
                                  <span>
                                    <IconButton
                                      aria-label="编辑运行配置"
                                      disableRipple
                                      disableFocusRipple
                                      disabled={
                                        !runtimePanelProfile ||
                                        runtimeProfilesSaving ||
                                        runtimeProfilesReadOnly
                                      }
                                      onClick={editRuntimePanelProfile}
                                      sx={runtimePanelActionButtonSx}
                                    >
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </Stack>
                            </Stack>

                            {runtimeProfilesError ? (
                              <Typography
                                variant="caption"
                                sx={{ color: "#b91c1c", overflowWrap: "anywhere" }}
                                aria-live="polite"
                              >
                                {runtimeProfilesError}
                              </Typography>
                            ) : null}

                            <TextField
                              select
                              size="small"
                              label="运行配置"
                              value={
                                runtimePanelProfile?.key ||
                                DEFAULT_RUNTIME_PROFILE_VALUE
                              }
                              onChange={(event) => {
                                const nextIndex = runtimeProfileDrafts.findIndex(
                                  (profile) => profile.key === event.target.value,
                                );
                                setRuntimeProfileIndex(nextIndex >= 0 ? nextIndex : 0);
                              }}
                              disabled={runtimeProfilesLoading || runtimeProfileDrafts.length === 0}
                              fullWidth
                              inputProps={{
                                "aria-label": "通用运行配置",
                                name: "runtime-profile",
                                autoComplete: "off",
                              }}
                            >
                              {runtimeProfileDrafts.length === 0 ? (
                                <MenuItem value={DEFAULT_RUNTIME_PROFILE_VALUE}>
                                  暂无运行配置
                                </MenuItem>
                              ) : null}
                              {runtimeProfileDrafts.map((profile) => (
                                <MenuItem key={profile.key} value={profile.key}>
                                  {profile.label || profile.key}
                                </MenuItem>
                              ))}
                            </TextField>

                            {runtimePanelProfile ? (
                              <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap>
                                {runtimePanelProfile.browser ? (
                                  <Chip
                                    size="small"
                                    label={runtimePanelProfile.browser}
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimePanelProfile.browserProfile ? (
                                  <Chip
                                    size="small"
                                    label={`Profile ${runtimePanelProfile.browserProfile}`}
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimePanelProfile.browserUserDataDir ? (
                                  <Chip size="small" label="独立数据目录" variant="outlined" />
                                ) : null}
                                {runtimePanelProfile.rdevProxyProfileId ? (
                                  <Chip
                                    size="small"
                                    label={
                                      runtimePanelBoundProxy
                                        ? `代理服务 ${proxyProfileLabel(runtimePanelBoundProxy)}`
                                        : "代理服务缺失"
                                    }
                                    variant="outlined"
                                  />
                                ) : runtimePanelProfile.proxyUrl ? (
                                  <Chip size="small" label="浏览器代理" variant="outlined" />
                                ) : null}
                                {runtimePanelProfile.hostResolverRulesText?.trim() ? (
                                  <Chip size="small" label="域名映射" variant="outlined" />
                                ) : null}
                                {runtimePanelProfile.webActionsEnabled ? (
                                  <Chip
                                    size="small"
                                    label={`受控 ${runtimePanelProfile.webActionsPort || 9223}`}
                                    variant="outlined"
                                  />
                                ) : null}
                              </Stack>
                            ) : null}
                          </Stack>
                        </Box>

                        <Box
                          sx={{
                            p: 1,
                            borderRadius: "16px",
                            border: `1px solid ${tone.searchWrapBorder}`,
                            bgcolor: tone.searchWrapBg,
                            boxShadow: tone.searchWrapShadow,
                          }}
                        >
                          <Stack spacing={1.05}>
                            <Stack
                              direction="row"
                              alignItems="center"
                              justifyContent="space-between"
                              spacing={0.8}
                            >
                              <Typography
                                variant="caption"
                                sx={{ color: tone.rowMeta, fontWeight: 750 }}
                              >
                                项目运行配置
                              </Typography>
                              <Button
                                size="small"
                                color="inherit"
                                onClick={() => setRuntimeOptionsEnvText("")}
                                disabled={!runtimeOptionsEnvText.trim()}
                                sx={{
                                  minWidth: 0,
                                  height: 28,
                                  px: 1.15,
                                  borderRadius: "10px",
                                  color: tone.rowKey,
                                  border: `1px solid ${tone.toolButtonBorder}`,
                                  bgcolor: tone.toolButtonBg,
                                  "&:hover": {
                                    bgcolor: tone.toolButtonHoverBg,
                                    borderColor: tone.toolButtonHoverBorder,
                                  },
                                  "&.Mui-disabled": {
                                    color: tone.rowHint,
                                    borderColor: tone.actionGroupBorder,
                                  },
                                }}
                              >
                                清空变量
                              </Button>
                            </Stack>

                            <Stack spacing={0.55}>
                              <Stack
                                direction={{ xs: "column", sm: "row" }}
                                spacing={0.65}
                                alignItems="stretch"
                              >
                                <TextField
                                  select
                                  size="small"
                                  value={
                                    runtimeOptionsProfileKey ||
                                    DEFAULT_RUNTIME_PROFILE_VALUE
                                  }
                                  onChange={(event) =>
                                    handleRuntimeOptionsProfileChange(
                                      event.target.value,
                                    )
                                  }
                                  fullWidth
                                  inputProps={{ "aria-label": "项目运行配置" }}
                                  sx={{
                                    flex: "1 1 auto",
                                    "& .MuiSelect-select": {
                                      minHeight: "unset",
                                      py: 1,
                                      fontSize: "0.82rem",
                                      fontWeight: 750,
                                    },
                                  }}
                                >
                                  <MenuItem value={DEFAULT_RUNTIME_PROFILE_VALUE}>
                                    默认启动
                                  </MenuItem>
                                  {runtimeOptionsProfiles.map((profile) => (
                                    <MenuItem key={profile.key} value={profile.key}>
                                      {profile.label || profile.key}
                                      {profile.envCount > 0
                                        ? ` · ${profile.envCount} env`
                                        : ""}
                                      {profile.localFileCount > 0
                                        ? ` · ${profile.localFileCount} 文件`
                                        : ""}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                <Button
                                  variant="outlined"
                                  color="inherit"
                                  disabled={runtimeOptionsDefaultSaved}
                                  startIcon={
                                    runtimeOptionsDefaultSaved ||
                                    copiedProjectAction === "runtime-default" ? (
                                      <CheckIcon fontSize="small" />
                                    ) : undefined
                                  }
                                  onClick={handleRuntimeOptionsSaveDefault}
                                  sx={{
                                    minWidth: { xs: "100%", sm: 112 },
                                    borderRadius: "10px",
                                    fontWeight: 780,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {copiedProjectAction === "runtime-default"
                                    ? "已设为默认"
                                    : runtimeOptionsDefaultSaved
                                      ? "当前默认"
                                      : "设为默认"}
                                </Button>
                              </Stack>
                            </Stack>

                            <Stack spacing={0.55}>
                              <Typography
                                variant="caption"
                                sx={{ color: tone.rowMeta, fontWeight: 750 }}
                              >
                                环境变量
                              </Typography>
                              <TextField
                                value={runtimeOptionsEnvText}
                                onChange={(event) =>
                                  setRuntimeOptionsEnvText(event.target.value)
                                }
                                fullWidth
                                multiline
                                minRows={8}
                                placeholder={"APP_ENV=local\nFEATURE_FLAG=true"}
                                error={Boolean(runtimeOptionsParseResult.error)}
                                helperText={
                                  runtimeOptionsParseResult.error ||
                                  "每行 KEY=VALUE；同名变量会覆盖档案默认值，仅本次启动生效。"
                                }
                                inputProps={{ "aria-label": "环境变量" }}
                                sx={{
                                  "& .MuiInputBase-root": {
                                    fontFamily:
                                      '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                    fontSize: "0.74rem",
                                    lineHeight: 1.45,
                                  },
                                  "& .MuiFormHelperText-root": {
                                    mx: 0.2,
                                    fontSize: "0.66rem",
                                  },
                                }}
                              />
                            </Stack>

                            {runtimeOptionsSelectedProfile?.browser ||
                            runtimeOptionsSelectedProfile?.browserProfile ||
                            runtimeOptionsSelectedProfile?.browserUserDataDir ||
                            runtimeOptionsSelectedProfile?.browserArgs?.length ||
                            runtimeOptionsSelectedProfile?.runtimeProfile ||
                            runtimeOptionsSelectedProfile?.networkProxy?.enabled ? (
                              <Stack
                                direction="row"
                                spacing={0.55}
                                flexWrap="wrap"
                                useFlexGap
                              >
                                {runtimeOptionsSelectedProfile.browser ? (
                                  <Chip
                                    size="small"
                                    label={`浏览器 ${runtimeOptionsSelectedProfile.browser}`}
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimeOptionsSelectedProfile.browserProfile ? (
                                  <Chip
                                    size="small"
                                    label={`Profile ${runtimeOptionsSelectedProfile.browserProfile}`}
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimeOptionsSelectedProfile.browserUserDataDir ? (
                                  <Chip
                                    size="small"
                                    label="独立数据目录"
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimeOptionsSelectedProfile.browserArgs?.length ? (
                                  <Chip
                                    size="small"
                                    label={`浏览器参数 ${runtimeOptionsSelectedProfile.browserArgs?.length ?? 0}`}
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimeOptionsSelectedProfile.runtimeProfile ? (
                                  <Chip
                                    size="small"
                                    label={`继承 ${runtimeOptionsSelectedProfile.runtimeProfile}`}
                                    variant="outlined"
                                  />
                                ) : null}
                                {runtimeOptionsSelectedProfile.networkProxy?.enabled ? (
                                  <Chip
                                    size="small"
                                    label={
                                      runtimeOptionsSelectedProfile.networkProxy.nodeHook
                                        ? "网络代理 · Node Hook"
                                        : "网络代理"
                                    }
                                    variant="outlined"
                                  />
                                ) : null}
                              </Stack>
                            ) : null}

                            <Stack
                              direction="row"
                              justifyContent="center"
                              sx={{ pt: 0.1 }}
                            >
                              <Button
                                size="medium"
                                variant="contained"
                                startIcon={<PlayIcon fontSize="small" />}
                                disabled={
                                  !runtimeOptionsEntry.canStart ||
                                  Boolean(runtimeOptionsParseResult.error)
                                }
                                onClick={handleRuntimeOptionsStart}
                                fullWidth
                                sx={{
                                  minHeight: 42,
                                  borderRadius: "12px",
                                  fontWeight: 820,
                                  boxShadow: mono
                                    ? "0 10px 24px rgba(0,0,0,0.22)"
                                    : "0 12px 28px rgba(84,111,140,0.16)",
                                }}
                              >
                                使用此配置启动
                              </Button>
                            </Stack>
                          </Stack>
                        </Box>
                        </>
                      ) : null}

                      {detailsPanelTab === "logs" ? (
                        <Box
                          sx={{
                            border: `1px solid ${tone.searchWrapBorder}`,
                            borderRadius: "16px",
                            bgcolor: tone.searchWrapBg,
                            boxShadow: tone.searchWrapShadow,
                            display: "flex",
                            flex: 1,
                            flexDirection: "column",
                            minHeight: 0,
                            p: 0.9,
                          }}
                        >
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={1}
                          sx={{ mb: 0.75 }}
                        >
                          <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                          >
                            <Typography
                              variant="caption"
                              sx={{
                                color: tone.rowHint,
                                fontWeight: 750,
                                letterSpacing: "0.07em",
                              }}
                            >
                              日志
                            </Typography>
                            {[
                              { key: "dev" as const, label: "dev" },
                              { key: "build" as const, label: "build" },
                            ].map((item) => {
                              const active = runtimeLogKind === item.key;
                              const disabled =
                                item.key === "build" &&
                                !detailsProjectEntry.buildLogPath;
                              return (
                                <Chip
                                  key={item.key}
                                  size="small"
                                  label={item.label}
                                  disabled={disabled}
                                  onClick={
                                    disabled
                                      ? undefined
                                      : () => setRuntimeLogKind(item.key)
                                  }
                                  sx={{
                                    height: 22,
                                    bgcolor: active
                                      ? tone.categoryChipActiveBg
                                      : tone.categoryChipBg,
                                    color: active
                                      ? tone.categoryChipActiveColor
                                      : tone.categoryChipColor,
                                    border: `1px solid ${
                                      active
                                        ? tone.categoryChipActiveBorder
                                        : tone.categoryChipBorder
                                    }`,
                                    "& .MuiChip-label": {
                                      px: 0.8,
                                      fontSize: "0.66rem",
                                      fontWeight: 700,
                                    },
                                  }}
                                />
                              );
                            })}
                          </Stack>
                          <Stack direction="row" spacing={0.45}>
                            <Tooltip title="刷新日志">
                              <span>
                                <IconButton
                                  aria-label="刷新运行日志"
                                  disabled={runtimeLog.loading || runtimeLogClearing}
                                  onClick={() =>
                                    setRuntimeLogRefreshKey((current) => current + 1)
                                  }
                                  sx={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "999px",
                                    bgcolor: tone.stopButtonBg,
                                    color: tone.stopButtonColor,
                                    border: `1px solid ${tone.stopButtonBorder}`,
                                  }}
                                >
                                  <RefreshIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={runtimeLog.path ? "清空当前日志" : "日志尚未生成"}>
                              <span>
                                <IconButton
                                  aria-label="清空当前运行日志"
                                  disabled={
                                    !runtimeLog.path ||
                                    runtimeLog.loading ||
                                    runtimeLogClearing
                                  }
                                  onClick={() => void handleClearRuntimeLog()}
                                  sx={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "999px",
                                    bgcolor: tone.stopButtonBg,
                                    color:
                                      runtimeLog.path && !runtimeLogClearing
                                        ? tone.stopButtonColor
                                        : tone.stopButtonDisabledColor,
                                    border: `1px solid ${tone.stopButtonBorder}`,
                                  }}
                                >
                                  <TrashIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={runtimeLog.path ? "复制日志路径" : "日志尚未生成"}>
                              <span>
                                <IconButton
                                  aria-label="复制日志路径"
                                  disabled={!runtimeLog.path || runtimeLogClearing}
                                  onClick={() =>
                                    void handleCopyProjectValue(runtimeLog.path, "log")
                                  }
                                  sx={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "999px",
                                    bgcolor: tone.stopButtonBg,
                                    color: runtimeLog.path
                                      ? tone.stopButtonColor
                                      : tone.stopButtonDisabledColor,
                                    border: `1px solid ${tone.stopButtonBorder}`,
                                  }}
                                >
                                  {copiedProjectAction === "log" ? (
                                    <CheckIcon fontSize="small" />
                                  ) : (
                                    <CopyIcon fontSize="small" />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Stack>
                        </Stack>

                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            mb: 0.65,
                            minHeight: 17,
                            color: tone.rowKey,
                            overflowWrap: "anywhere",
                            fontFamily:
                              '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                          }}
                        >
                          {runtimeLog.path || "日志会在下次运行后生成"}
                        </Typography>

                        <Stack
                          direction="row"
                          spacing={0.45}
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                          sx={{ mb: 0.65 }}
                        >
                          <Chip
                            size="small"
                            label={
                              runtimeLog.sessionSummary.active
                                ? `会话 ${formatDateTime(runtimeLog.sessionSummary.startedAtMs)}`
                                : "会话 未记录"
                            }
                            sx={{
                              height: 22,
                              bgcolor: tone.categoryChipBg,
                              color: tone.categoryChipColor,
                              border: `1px solid ${tone.categoryChipBorder}`,
                              "& .MuiChip-label": {
                                px: 0.75,
                                fontSize: "0.64rem",
                                fontWeight: 720,
                              },
                            }}
                          />
                          <Chip
                            size="small"
                            label={`PID ${
                              runtimeLog.sessionSummary.pid ??
                              (runtimeLog.kind === "build"
                                ? detailsProjectEntry.buildPid
                                : detailsProjectEntry.pid) ??
                              "未运行"
                            }`}
                            sx={{
                              height: 22,
                              bgcolor: tone.categoryChipBg,
                              color: tone.categoryChipColor,
                              border: `1px solid ${tone.categoryChipBorder}`,
                              "& .MuiChip-label": {
                                px: 0.75,
                                fontSize: "0.64rem",
                                fontWeight: 720,
                              },
                            }}
                          />
                          <Chip
                            size="small"
                            label={
                              runtimeLogAutoRefreshMs
                                ? `自动刷新 ${Math.round(runtimeLogAutoRefreshMs / 1000)}s`
                                : "自动刷新 暂停"
                            }
                            sx={{
                              height: 22,
                              bgcolor: runtimeLogAutoRefreshMs
                                ? tone.successPillBg
                                : tone.categoryChipBg,
                              color: runtimeLogAutoRefreshMs
                                ? tone.successPillColor
                                : tone.categoryChipColor,
                              border: `1px solid ${
                                runtimeLogAutoRefreshMs
                                  ? tone.successPillBorder
                                  : tone.categoryChipBorder
                              }`,
                              "& .MuiChip-label": {
                                px: 0.75,
                                fontSize: "0.64rem",
                                fontWeight: 720,
                              },
                            }}
                          />
                          <Chip
                            size="small"
                            label={`行 ${runtimeLog.sessionSummary.currentLineCount}/${runtimeLog.sessionSummary.totalLineCount}`}
                            sx={{
                              height: 22,
                              bgcolor: tone.categoryChipBg,
                              color: tone.categoryChipColor,
                              border: `1px solid ${tone.categoryChipBorder}`,
                              "& .MuiChip-label": {
                                px: 0.75,
                                fontSize: "0.64rem",
                                fontWeight: 720,
                              },
                            }}
                          />
                          {(runtimeLog.sessionSummary.cwd ||
                            runtimeLog.sessionSummary.command) && (
                            <Tooltip
                              title={[
                                runtimeLog.sessionSummary.cwd
                                  ? `cwd: ${runtimeLog.sessionSummary.cwd}`
                                  : "",
                                runtimeLog.sessionSummary.command
                                  ? `command: ${runtimeLog.sessionSummary.command}`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join("\n")}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  minWidth: 0,
                                  maxWidth: "100%",
                                  color: tone.rowHint,
                                  fontFamily:
                                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                }}
                              >
                                {runtimeLog.sessionSummary.cwd ||
                                  runtimeLog.sessionSummary.command}
                              </Typography>
                            </Tooltip>
                          )}
                        </Stack>

                        {runtimeLog.kind === "dev" &&
                        runtimeLog.readySummary.enabled ? (
                          <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                            sx={{ mb: 0.7 }}
                          >
                            <Chip
                              size="small"
                              label={runtimeLog.readySummary.statusLabel}
                              sx={{
                                height: 22,
                                bgcolor: runtimeLog.readySummary.ready
                                  ? tone.successPillBg
                                  : runtimeLog.readySummary.failed
                                  ? tone.dangerPillBg
                                  : tone.categoryChipBg,
                                color: runtimeLog.readySummary.ready
                                  ? tone.successPillColor
                                  : runtimeLog.readySummary.failed
                                  ? tone.dangerPillColor
                                  : tone.categoryChipColor,
                                border: `1px solid ${
                                  runtimeLog.readySummary.ready
                                    ? tone.successPillBorder
                                    : runtimeLog.readySummary.failed
                                    ? tone.dangerPillBorder
                                    : tone.categoryChipBorder
                                }`,
                                "& .MuiChip-label": {
                                  px: 0.8,
                                  fontSize: "0.66rem",
                                  fontWeight: 750,
                                },
                              }}
                            />
                            {(runtimeLog.readySummary.url ||
                              runtimeLog.readySummary.detail) && (
                              <Typography
                                variant="caption"
                                sx={{
                                  minWidth: 0,
                                  color: tone.rowHint,
                                  overflowWrap: "anywhere",
                                  fontFamily:
                                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                }}
                              >
                                {runtimeLog.readySummary.url ||
                                  runtimeLog.readySummary.detail}
                              </Typography>
                            )}
                          </Stack>
                        ) : null}

                        <Box
                          ref={runtimeLogBoxRef}
                          sx={{
                            flex: 1,
                            minHeight: 260,
                            overflow: "auto",
                            borderRadius: "13px",
                            border: `1px solid ${tone.actionGroupBorder}`,
                            bgcolor: mono ? "#080a0e" : "rgba(22,30,42,0.92)",
                            color: mono ? "#d8dee9" : "#eef4ff",
                            p: 0.9,
                            fontFamily:
                              '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                            fontSize: "0.69rem",
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {runtimeLogClearing ? (
                            "正在清空日志..."
                          ) : runtimeLog.loading ? (
                            "正在读取日志..."
                          ) : runtimeLog.error ? (
                            runtimeLog.error
                          ) : runtimeLog.lines.length > 0 ? (
                            `${runtimeLog.truncated ? "... 仅显示最近日志\n" : ""}${runtimeLog.lines.join("\n")}`
                          ) : (
                            "暂无日志输出"
                          )}
                        </Box>
                      </Box>
                      ) : null}

                      {detailsPanelTab === "webActions" &&
                      detailsWebActionsContext ? (
                        <Stack spacing={0.85}>
                          {(() => {
                            const preflight = runtimePreflight.response;
                            const webChecks = (preflight?.checks ?? []).filter(
                              (check) => check.category === "webActions",
                            );
                            const palette = buildPreflightPalette(
                              preflight?.statusKey ?? "info",
                              mono,
                            );
                            return (
                              <Box
                                sx={{
                                  px: 0.9,
                                  py: 0.72,
                                  borderRadius: "14px",
                                  border: `1px solid ${tone.searchWrapBorder}`,
                                  bgcolor: tone.searchWrapBg,
                                  boxShadow: tone.searchWrapShadow,
                                }}
                              >
                                <Stack
                                  direction="row"
                                  alignItems="center"
                                  spacing={0.65}
                                  sx={{ minWidth: 0 }}
                                >
                                  <Box
                                    sx={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      bgcolor: palette.dot,
                                      flex: "0 0 auto",
                                    }}
                                  />
                                  <Typography
                                    variant="caption"
                                    noWrap
                                    sx={{
                                      color: tone.rowTitle,
                                      fontWeight: 800,
                                      flex: "0 0 auto",
                                    }}
                                  >
                                    受控链路
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    noWrap
                                    sx={{
                                      color: tone.rowHint,
                                      minWidth: 0,
                                      flex: 1,
                                    }}
                                  >
                                    {runtimePreflight.loading
                                      ? "检查中"
                                      : webChecks
                                          .map(
                                            (check) =>
                                              `${check.title}: ${check.statusLabel}`,
                                          )
                                          .join(" · ") ||
                                        preflight?.summary ||
                                        "未检查"}
                                  </Typography>
                                  <IconButton
                                    aria-label="刷新受控链路预检"
                                    disabled={runtimePreflight.loading}
                                    onClick={() =>
                                      setRuntimePreflightRefreshKey(
                                        (current) => current + 1,
                                      )
                                    }
                                    sx={{
                                      width: 26,
                                      height: 26,
                                      borderRadius: "9px",
                                      color: tone.toolButtonColor,
                                    }}
                                  >
                                    <RefreshIcon fontSize="small" />
                                  </IconButton>
                                </Stack>
                              </Box>
                            );
                          })()}
                          <WebActionsPanel
                            active
                            compact
                            context={detailsWebActionsContext}
                          />
                        </Stack>
                      ) : null}
	                </RuntimePanelDrawer>
	              ) : null}

	              {shortcutRuntimePanelCurrentItem ? (
	                <RuntimePanelDrawer
	                  open
	                  onClose={closeShortcutRuntimePanel}
	                  title={shortcutRuntimePanelCurrentItem.entry.name}
	                  subtitle={
	                    shortcutRuntimePanelCurrentItem.categoryLabel ||
	                    shortcutRuntimePanelCurrentItem.categoryTitle
	                  }
	                  icon={<FinderEntryIcon kind={shortcutRuntimePanelCurrentItem.entry.kind} />}
	                  statusDotColor={
	                    shortcutRuntimeProfileKey ? tone.categoryChipActiveColor : tone.rowHint
	                  }
	                  statusDotShadow={
	                    shortcutRuntimeProfileKey
	                      ? `0 0 0 4px ${tone.categoryChipActiveBg}`
	                      : undefined
	                  }
	                  chips={
	                    <>
	                      <Chip
	                        size="small"
	                        label={finderEntryKindLabel(
	                          shortcutRuntimePanelCurrentItem.entry.kind,
	                        )}
	                        variant="outlined"
	                      />
	                      <Chip
	                        size="small"
	                        label={
	                          shortcutRuntimeProfile
	                            ? runtimeProfileLabel(shortcutRuntimeProfile)
	                            : shortcutRuntimeProfileKey || "默认打开"
	                        }
	                        variant={shortcutRuntimeProfileKey ? "filled" : "outlined"}
	                      />
	                    </>
	                  }
	                  tabs={[
	                    {
	                      value: "overview",
	                      label: "概览",
	                      icon: <AppWindowIcon fontSize="small" />,
	                    },
	                    {
	                      value: "config",
	                      label: "运行配置",
	                      icon: <SettingsIcon fontSize="small" />,
	                    },
	                    {
	                      value: "webActions",
	                      label: "网页动作",
	                      icon: <WebsiteIcon fontSize="small" />,
	                    },
	                  ]}
	                  activeTab={shortcutPanelTab}
	                  onTabChange={(value) => setShortcutPanelTab(value)}
	                >
	                  {shortcutPanelTab === "overview" ? (
	                    <Box
	                      sx={{
	                        border: `1px solid ${tone.searchWrapBorder}`,
	                        borderRadius: "16px",
	                        bgcolor: tone.searchWrapBg,
	                        boxShadow: tone.searchWrapShadow,
	                        p: 0.9,
	                      }}
	                    >
	                      <Typography
	                        variant="caption"
	                        sx={{
	                          display: "block",
	                          mb: 0.7,
	                          color: tone.rowHint,
	                          fontWeight: 750,
	                          letterSpacing: "0.07em",
	                        }}
	                      >
	                        入口
	                      </Typography>
	                      <Box sx={{ display: "grid", gap: 0.55 }}>
	                        {[
	                          [
	                            "分类",
	                            shortcutRuntimePanelCurrentItem.categoryLabel ||
	                              shortcutRuntimePanelCurrentItem.categoryTitle,
	                          ],
	                          ["地址", shortcutRuntimePanelCurrentItem.entry.url || "未配置"],
	                          [
	                            "打开方式",
	                            shortcutRuntimeProfile
	                              ? runtimeProfileLabel(shortcutRuntimeProfile)
	                              : shortcutRuntimeProfileKey || "当前 Chrome",
	                          ],
	                          [
	                            "浏览器",
	                            shortcutRuntimePanelCurrentItem.entry.browser || "当前 Chrome",
	                          ],
	                          [
	                            "Profile",
	                            shortcutRuntimePanelCurrentItem.entry.browserProfile || "未指定",
	                          ],
	                          ["说明", shortcutRuntimePanelCurrentItem.entry.note || "无"],
	                        ].map(([label, value]) => (
	                          <Box
	                            key={label}
	                            sx={{
	                              display: "grid",
	                              gridTemplateColumns: "74px minmax(0, 1fr)",
	                              gap: 0.8,
	                              alignItems: "start",
	                              px: 0.75,
	                              py: 0.65,
	                              borderRadius: "12px",
	                              bgcolor: mono
	                                ? "rgba(255,255,255,0.014)"
	                                : "rgba(255,255,255,0.48)",
	                              border: `1px solid ${tone.actionGroupBorder}`,
	                            }}
	                          >
	                            <Typography
	                              variant="caption"
	                              sx={{ color: tone.rowKey, fontWeight: 700 }}
	                            >
	                              {label}
	                            </Typography>
	                            <Typography
	                              variant="caption"
	                              sx={{
	                                minWidth: 0,
	                                color: tone.rowMeta,
	                                overflowWrap: "anywhere",
	                                fontFamily:
	                                  label === "地址"
	                                    ? '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace'
	                                    : undefined,
	                              }}
	                            >
	                              {value}
	                            </Typography>
	                          </Box>
	                        ))}
	                      </Box>
	                    </Box>
	                  ) : null}

	                  {shortcutPanelTab === "config" ? (
	                    <Box
	                      sx={{
	                        p: 1,
	                        borderRadius: "16px",
	                        border: `1px solid ${tone.searchWrapBorder}`,
	                        bgcolor: tone.searchWrapBg,
	                        boxShadow: tone.searchWrapShadow,
	                      }}
	                    >
	                      <Stack spacing={1}>
	                        {renderRuntimeConfigSourceBar()}
	                        <Stack
	                          direction={{ xs: "column", sm: "row" }}
	                          alignItems={{ xs: "stretch", sm: "flex-start" }}
	                          justifyContent="space-between"
	                          spacing={0.8}
	                        >
	                          <Box sx={{ minWidth: 0 }}>
	                            <Typography
	                              variant="caption"
	                              sx={{ color: tone.rowMeta, fontWeight: 750 }}
	                            >
	                              网站运行配置
	                            </Typography>
	                            <Typography
	                              variant="caption"
	                              sx={{
	                                display: "block",
	                                color: tone.rowKey,
	                                mt: 0.15,
	                                overflowWrap: "anywhere",
	                              }}
	                            >
	                              {shortcutRuntimePanelCurrentItem.entry.name}
	                            </Typography>
	                          </Box>
	                          <Stack
	                            direction="row"
	                            spacing={0.55}
	                            flexWrap="wrap"
	                            useFlexGap
	                            justifyContent={{ xs: "flex-start", sm: "flex-end" }}
	                          >
	                            <Tooltip title="刷新运行配置">
	                              <span>
	                                <IconButton
	                                  aria-label="刷新运行配置"
	                                  disableRipple
	                                  disableFocusRipple
	                                  disabled={runtimeProfilesSaving || shortcutRuntimeSaving}
	                                  onClick={() =>
	                                    void loadRuntimeProfiles(shortcutRuntimeProfileKey)
	                                  }
	                                  sx={runtimePanelActionButtonSx}
	                                >
	                                  <RefreshIcon fontSize="small" />
	                                </IconButton>
	                              </span>
	                            </Tooltip>
	                            <Tooltip title="新增运行配置">
	                              <span>
	                                <IconButton
	                                  aria-label="新增运行配置"
	                                  disableRipple
	                                  disableFocusRipple
	                                  disabled={runtimeProfilesSaving || shortcutRuntimeSaving}
	                                  onClick={addRuntimePanelProfile}
	                                  sx={runtimePanelActionButtonSx}
	                                >
	                                  <PlusIcon fontSize="small" />
	                                </IconButton>
	                              </span>
	                            </Tooltip>
	                            <Tooltip title="编辑运行配置">
	                              <span>
	                                <IconButton
	                                  aria-label="编辑运行配置"
	                                  disableRipple
	                                  disableFocusRipple
	                                  disabled={
	                                    !shortcutRuntimeProfile ||
	                                    runtimeProfilesSaving ||
	                                    shortcutRuntimeSaving
	                                  }
	                                  onClick={() =>
	                                    editRuntimePanelProfileByKey(shortcutRuntimeProfileKey)
	                                  }
	                                  sx={runtimePanelActionButtonSx}
	                                >
	                                  <EditIcon fontSize="small" />
	                                </IconButton>
	                              </span>
	                            </Tooltip>
	                          </Stack>
	                        </Stack>

	                        {shortcutRuntimeError || runtimeProfilesError ? (
	                          <Typography
	                            variant="caption"
	                            sx={{ color: "#b91c1c", overflowWrap: "anywhere" }}
	                            aria-live="polite"
	                          >
	                            {shortcutRuntimeError || runtimeProfilesError}
	                          </Typography>
	                        ) : null}

	                        <TextField
	                          select
	                          size="small"
	                          label="入口运行配置"
	                          value={
	                            shortcutRuntimeProfileKey || DEFAULT_RUNTIME_PROFILE_VALUE
	                          }
	                          onChange={(event) =>
	                            void saveShortcutRuntimeProfile(
	                              event.target.value === DEFAULT_RUNTIME_PROFILE_VALUE
	                                ? ""
	                                : event.target.value,
	                            )
	                          }
	                          disabled={runtimeProfilesLoading || shortcutRuntimeSaving}
	                          fullWidth
	                          inputProps={{
	                            "aria-label": "入口运行配置",
	                            name: "shortcut-runtime-profile",
	                            autoComplete: "off",
	                          }}
	                        >
	                          <MenuItem value={DEFAULT_RUNTIME_PROFILE_VALUE}>
	                            不使用运行配置
	                          </MenuItem>
	                          {runtimeProfileDrafts.map((profile) => (
	                            <MenuItem key={profile.key} value={profile.key}>
	                              {profile.label || profile.key}
	                            </MenuItem>
	                          ))}
	                        </TextField>

	                        {shortcutRuntimeProfile ? (
	                          <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap>
	                            {shortcutRuntimeProfile.browser ? (
	                              <Chip
	                                size="small"
	                                label={shortcutRuntimeProfile.browser}
	                                variant="outlined"
	                              />
	                            ) : null}
	                            {shortcutRuntimeProfile.browserProfile ? (
	                              <Chip
	                                size="small"
	                                label={`Profile ${shortcutRuntimeProfile.browserProfile}`}
	                                variant="outlined"
	                              />
	                            ) : null}
	                            {shortcutRuntimeProfile.browserUserDataDir ? (
	                              <Chip size="small" label="独立数据目录" variant="outlined" />
	                            ) : null}
	                            {shortcutRuntimeProfile.rdevProxyProfileId ? (
	                              <Chip
	                                size="small"
	                                label={
	                                  shortcutBoundProxy
	                                    ? `代理服务 ${proxyProfileLabel(shortcutBoundProxy)}`
	                                    : "代理服务缺失"
	                                }
	                                variant="outlined"
	                              />
	                            ) : shortcutRuntimeProfile.proxyUrl ? (
	                              <Chip size="small" label="浏览器代理" variant="outlined" />
	                            ) : null}
	                            {shortcutRuntimeProfile.hostResolverRulesText?.trim() ? (
	                              <Chip size="small" label="域名映射" variant="outlined" />
	                            ) : null}
	                            {runtimeProfileHasCdp(shortcutRuntimeProfile) ? (
	                              <Chip
	                                size="small"
	                                label={`受控 ${shortcutRuntimeProfile.webActionsPort || 9223}`}
	                                variant="outlined"
	                              />
	                            ) : null}
	                          </Stack>
	                        ) : shortcutRuntimeProfileKey && runtimeProfilesLoaded ? (
	                          <Typography
	                            variant="caption"
	                            sx={{ color: "#b91c1c", overflowWrap: "anywhere" }}
	                          >
	                            运行配置不存在：{shortcutRuntimeProfileKey}
	                          </Typography>
	                        ) : null}

	                        <Stack direction="row" justifyContent="flex-end">
	                          <Button
	                            size="small"
	                            variant="contained"
	                            startIcon={
                              isLinkToolEntry(shortcutRuntimePanelCurrentItem.entry) ? (
                                <WorkflowIcon fontSize="small" />
                              ) : (
                                <OpenExternalIcon fontSize="small" />
                              )
                            }
	                            disabled={shortcutRuntimeSaving}
	                            onClick={() =>
                              isLinkToolEntry(shortcutRuntimePanelCurrentItem.entry)
                                ? void openLinkPlan(shortcutRuntimePanelCurrentItem.entry)
                                : void onOpenFinderEntry(
                                    shortcutRuntimePanelCurrentItem.entry,
                                  )
	                            }
	                          >
	                            {isLinkToolEntry(shortcutRuntimePanelCurrentItem.entry)
                              ? "查看计划"
                              : "打开入口"}
	                          </Button>
	                        </Stack>
	                      </Stack>
	                    </Box>
	                  ) : null}

	                  {shortcutPanelTab === "webActions" && shortcutWebActionsContext ? (
	                    <WebActionsPanel
	                      active
	                      compact
	                      context={shortcutWebActionsContext}
	                    />
	                  ) : null}
	                </RuntimePanelDrawer>
	              ) : null}

	              <Dialog
                className="runtime-profile-dialog"
                open={Boolean(runtimeProfileDialog)}
                onClose={() => {
                  if (!runtimeProfilesSaving) {
                    setRuntimeProfileDialog(null);
                  }
                }}
                fullWidth
                maxWidth="sm"
                PaperProps={{
                  sx: {
                    borderRadius: "18px",
                    overscrollBehavior: "contain",
                  },
                }}
              >
                <DialogTitle className="runtime-profile-dialog-title">
                  <Stack spacing={0.15} minWidth={0}>
                    <Stack direction="row" spacing={0.65} alignItems="center" minWidth={0}>
                      <Typography variant="subtitle1" noWrap>
                        {runtimeProfileDialog?.mode === "create"
                          ? "新增运行配置"
                          : "编辑运行配置"}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={runtimeProfileScopeLabel(runtimeProfileScope)}
                      />
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      title={runtimeProfileConfigPath || undefined}
                    >
                      {runtimeProfileScopeDescription(runtimeProfileScope)}
                      {runtimeProfileConfigPath ? ` · ${runtimeProfileConfigPath}` : ""}
                    </Typography>
                  </Stack>
                </DialogTitle>
                <DialogContent sx={{ pt: 1 }}>
                  {runtimeProfileDialog ? (
                    <Stack spacing={1.1} sx={{ mt: 0.5 }}>
                      {runtimeProfilesError ? (
                        <Typography
                          variant="caption"
                          sx={{ color: "#b91c1c", overflowWrap: "anywhere" }}
                          aria-live="polite"
                        >
                          {runtimeProfilesError}
                        </Typography>
                      ) : null}
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "1fr",
                            sm: "repeat(2, minmax(0, 1fr))",
                          },
                          gap: 1,
                        }}
                      >
                        <TextField
                          size="small"
                          label="Key"
                          value={runtimeProfileDialog.draft.key}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({ key: event.target.value })
                          }
                          inputProps={{ name: "runtime-profile-key", autoComplete: "off" }}
                        />
                        <TextField
                          size="small"
                          label="名称"
                          value={runtimeProfileDialog.draft.label}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({ label: event.target.value })
                          }
                          inputProps={{ name: "runtime-profile-label", autoComplete: "off" }}
                        />
                        <TextField
                          size="small"
                          label="浏览器"
                          value={runtimeProfileDialog.draft.browser ?? ""}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({ browser: event.target.value })
                          }
                          placeholder="Google Chrome…"
                          inputProps={{ name: "runtime-profile-browser", autoComplete: "off" }}
                        />
                        <TextField
                          size="small"
                          label="Profile"
                          value={runtimeProfileDialog.draft.browserProfile ?? ""}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({
                              browserProfile: event.target.value,
                            })
                          }
                          placeholder="Default…"
                          inputProps={{
                            name: "runtime-profile-browser-profile",
                            autoComplete: "off",
                          }}
                        />
                        <TextField
                          select
                          size="small"
                          label="代理服务"
                          value={
                            runtimeProfileDialog.draft.rdevProxyProfileId ??
                            RUNTIME_PROXY_MANUAL_VALUE
                          }
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            if (nextValue === RUNTIME_PROXY_MANUAL_VALUE) {
                              updateRuntimeProfileDialog({
                                rdevProxyProfileId: null,
                              });
                              return;
                            }
                            const proxyProfile = runtimeProxyProfileById.get(nextValue);
                            updateRuntimeProfileDialog({
                              rdevProxyProfileId: nextValue,
                              proxyUrl: proxyProfile
                                ? proxyProfileListenUrl(proxyProfile)
                                : runtimeProfileDialog.draft.proxyUrl,
                            });
                          }}
                          inputProps={{
                            name: "runtime-profile-rdev-proxy",
                            autoComplete: "off",
                          }}
                        >
                          <MenuItem value={RUNTIME_PROXY_MANUAL_VALUE}>
                            手动代理或不使用
                          </MenuItem>
                          {runtimeProfileDialog.draft.rdevProxyProfileId &&
                          !runtimeProxyProfileById.has(runtimeProfileDialog.draft.rdevProxyProfileId) ? (
                            <MenuItem value={runtimeProfileDialog.draft.rdevProxyProfileId}>
                              已缺失：{runtimeProfileDialog.draft.rdevProxyProfileId}
                            </MenuItem>
                          ) : null}
                          {runtimeProxyProfiles.map((profile) => (
                            <MenuItem key={profile.id} value={profile.id}>
                              {proxyProfileLabel(profile)} · {proxyProfileListenUrl(profile)}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label="浏览器代理地址"
                          value={runtimeProfileDialog.draft.proxyUrl}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({ proxyUrl: event.target.value })
                          }
                          placeholder="http://127.0.0.1:7897…"
                          helperText={
                            runtimeProfileDialog.draft.rdevProxyProfileId
                              ? "打开项目或访达入口前会自动启动代理服务并使用最新地址。"
                              : "手动填写时不会自动启动 rDevTool 代理服务。"
                          }
                          disabled={Boolean(runtimeProfileDialog.draft.rdevProxyProfileId)}
                          inputProps={{
                            name: "runtime-profile-browser-proxy",
                            autoComplete: "off",
                          }}
                        />
                        <TextField
                          size="small"
                          label="代理绕过"
                          value={runtimeProfileDialog.draft.proxyBypass}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({ proxyBypass: event.target.value })
                          }
                          placeholder="localhost;127.0.0.1;::1…"
                          inputProps={{
                            name: "runtime-profile-proxy-bypass",
                            autoComplete: "off",
                          }}
                        />
                        <TextField
                          size="small"
                          label="浏览器数据目录"
                          value={runtimeProfileDialog.draft.browserUserDataDir ?? ""}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({
                              browserUserDataDir: event.target.value,
                            })
                          }
                          placeholder="/tmp/rdevtool-runtime-profile…"
                          inputProps={{
                            name: "runtime-profile-user-data-dir",
                            autoComplete: "off",
                          }}
                          sx={{ gridColumn: { sm: "1 / -1" } }}
                        />
                        <Box
                          sx={{
                            gridColumn: { sm: "1 / -1" },
                            display: "grid",
                            gridTemplateColumns: {
                              xs: "1fr",
                              sm: "minmax(0, 1fr) 120px",
                            },
                            gap: 1,
                            p: 1,
                            borderRadius: "12px",
                            border: `1px solid ${tone.actionGroupBorder}`,
                            bgcolor: mono
                              ? "rgba(255,255,255,0.018)"
                              : "rgba(255,255,255,0.42)",
                          }}
                        >
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={runtimeProfileDialog.draft.webActionsEnabled}
                                onChange={(event) =>
                                  updateRuntimeProfileDialog({
                                    webActionsEnabled: event.target.checked,
                                    webActionsPort:
                                      runtimeProfileDialog.draft.webActionsPort || 9223,
                                  })
                                }
                              />
                            }
                            label="网页动作受控模式"
                            sx={{
                              m: 0,
                              alignSelf: "center",
                              "& .MuiFormControlLabel-label": {
                                fontSize: "0.8rem",
                                fontWeight: 750,
                              },
                            }}
                          />
                          <TextField
                            size="small"
                            type="number"
                            label="调试端口"
                            value={runtimeProfileDialog.draft.webActionsPort || 9223}
                            onChange={(event) =>
                              updateRuntimeProfileDialog({
                                webActionsPort: Number(event.target.value) || 0,
                              })
                            }
                            disabled={!runtimeProfileDialog.draft.webActionsEnabled}
                            inputProps={{
                              min: 1,
                              max: 65535,
                              name: "runtime-profile-web-actions-port",
                            }}
                          />
                          <TextField
                            size="small"
                            label="受控数据目录"
                            value={runtimeProfileDialog.draft.webActionsUserDataDir ?? ""}
                            onChange={(event) =>
                              updateRuntimeProfileDialog({
                                webActionsUserDataDir: event.target.value,
                              })
                            }
                            disabled={!runtimeProfileDialog.draft.webActionsEnabled}
                            placeholder="空则使用 rDevTool 默认受控目录"
                            inputProps={{
                              name: "runtime-profile-web-actions-user-data-dir",
                              autoComplete: "off",
                            }}
                            sx={{ gridColumn: { sm: "1 / -1" } }}
                          />
                        </Box>
                        <TextField
                          size="small"
                          label="域名映射"
                          value={runtimeProfileDialog.draft.hostResolverRulesText}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({
                              hostResolverRulesText: event.target.value,
                            })
                          }
                          placeholder="MAP app.example.test 127.0.0.1…"
                          multiline
                          minRows={3}
                          inputProps={{
                            name: "runtime-profile-host-rules",
                            autoComplete: "off",
                            spellCheck: false,
                          }}
                          sx={{ gridColumn: { sm: "1 / -1" } }}
                        />
                        <TextField
                          size="small"
                          label="浏览器参数"
                          value={runtimeProfileDialog.draft.browserArgsText}
                          onChange={(event) =>
                            updateRuntimeProfileDialog({
                              browserArgsText: event.target.value,
                            })
                          }
                          placeholder="--disable-web-security…"
                          multiline
                          minRows={2}
                          inputProps={{
                            name: "runtime-profile-browser-args",
                            autoComplete: "off",
                            spellCheck: false,
                          }}
                          sx={{ gridColumn: { sm: "1 / -1" } }}
                        />
                      </Box>
                    </Stack>
                  ) : null}
                </DialogContent>
                <DialogActions className="runtime-profile-dialog-actions">
                  <Button
                    color="inherit"
                    onClick={() => setRuntimeProfileDialog(null)}
                    disabled={runtimeProfilesSaving}
                  >
                    取消
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<CheckIcon fontSize="small" />}
                    onClick={() => void saveRuntimeProfileDialog()}
                    disabled={
                      runtimeProfilesSaving ||
                      runtimeProfilesReadOnly ||
                      !runtimeProfileDialog?.draft.key.trim()
                    }
                  >
                    保存运行配置
                  </Button>
                </DialogActions>
              </Dialog>

              {confirmDialog}

              <LinkPlanDialog
                state={linkPlanDialog}
                onClose={() => setLinkPlanDialog(null)}
                onAction={(action) => void runLinkDialogAction(action)}
              />

              {!finderIsProjects && currentResourceTypeCount === 0 ? (
                <Stack className="finder-empty-fill" spacing={0.9}>
                  <AppEmptyState
                    compact
                    className="finder-empty-state"
                    title={resourceEmptyCopy.title}
                    description={resourceEmptyCopy.description}
                  />
                </Stack>
              ) : null}

              {!finderIsProjects &&
              currentResourceTypeCount > 0 &&
              filteredShortcutEntries.length === 0 ? (
                <AppEmptyState compact title="没有匹配入口" description="切换分类或调整搜索词。" />
              ) : null}

              {!finderIsProjects && filteredShortcutEntries.length > 0 ? (
                <Stack
                  spacing={0.4}
                  minWidth={0}
                  minHeight={0}
                  flex="1 1 auto"
                  overflow="hidden"
                >
                  <Box
                    ref={finderListRef}
                    className="module-list-scroll finder-list-scroll"
                    onScroll={handleFinderListScroll}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.32,
                      flex: "1 1 auto",
                      minHeight: 0,
                    }}
                  >
                    {visibleShortcutEntries.map((item, index) => {
                    const detailLines = buildFinderEntryDetails(item);
                    const shortcutKey = buildFinderShortcutKey(item);
                    const linkShortcut = isLinkToolEntry(item.entry);
                    const shortcutLinkSummary = linkShortcut
                      ? linkSummaryForEntry(item.entry, linkSummaryMap)
                      : null;
                    const shortcutSubtitle = linkShortcut
                      ? linkEntrySubtitle(item.entry, shortcutLinkSummary)
                      : item.entry.targetLabel;
                    const shortcutConfirmed =
                      confirmedShortcutKey === shortcutKey;
                    const shortcutFavorite =
                      favoriteShortcutKeySet.has(shortcutKey);
                    const shortcutKindLabel = finderEntryKindLabel(item.entry.kind);
                    const shortcutCategoryLabel =
                      item.categoryTitle && item.categoryTitle !== shortcutKindLabel
                        ? item.categoryTitle
                        : "";
                    const shortcutIconVariant = finderEntryIconVariant(item.entry);
                    return (
                      <Tooltip
                        key={`${item.categoryTitle}-${item.entry.kind}-${item.entry.name}`}
                        arrow
                        enterDelay={260}
                        title={
                          <Stack spacing={0.35} sx={{ maxWidth: 320 }}>
                            {detailLines.map((line) => (
                              <Typography
                                key={line}
                                variant="caption"
                                sx={{
                                  display: "block",
                                  color: "inherit",
                                  fontSize: "0.7rem",
                                  lineHeight: 1.35,
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Stack>
                        }
                        >
                        <Box
                          component="div"
                          role="button"
                          tabIndex={0}
                          className={`finder-entry-row${linkShortcut ? " is-link-tool" : ""}${
                            shortcutConfirmed ? " is-confirmed" : ""
                          }`}
                          aria-label={`打开 ${item.entry.name}`}
                          onClick={() =>
                            void handleOpenShortcut(item, shortcutKey)
                          }
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) {
                              return;
                            }
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }
                            event.preventDefault();
                            void handleOpenShortcut(item, shortcutKey);
                          }}
                          sx={{
                            position: "relative",
                            display: "grid",
                            gridTemplateColumns: {
                              xs: "36px minmax(0, 1fr)",
                              md: "38px minmax(220px, 0.98fr) minmax(104px, 0.24fr) max-content",
                            },
                            columnGap: { xs: 0.9, md: 1 },
                            rowGap: { xs: 0.8, md: 0 },
                            alignItems: "center",
                            alignContent: "center",
                            width: "100%",
                            minWidth: 0,
                            minHeight: { xs: 64, md: 64 },
                            px: 1.05,
                            py: { xs: 0.68, md: 0.68 },
                            pr: { xs: 1.05, md: 1.05 },
                            borderRadius: "15px",
                            cursor: "pointer",
                            textAlign: "left",
                            font: "inherit",
                            color: "inherit",
                            border: "1px solid",
                            borderColor:
                              shortcutFavorite
                                ? tone.categoryChipActiveBorder
                                : index === 0
                                ? tone.rowBorderStrong
                                : tone.rowBorder,
                            background:
                              index % 2 === 0 ? tone.rowBgEven : tone.rowBgOdd,
                            boxShadow: tone.rowShadow,
                            backdropFilter: "blur(16px)",
                            transition:
                              "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease",
                            "&:hover": {
                              transform: "translateY(-1px)",
                              borderColor: tone.rowHoverBorder,
                              background: tone.rowHoverBg,
                              boxShadow: tone.rowHoverShadow,
                            },
                            "@media (prefers-reduced-motion: reduce)": {
                              transition: "none",
                              "&:hover": {
                                transform: "none",
                              },
                            },
                          }}
                        >
                          <Box
                            aria-hidden="true"
                            className={`finder-entry-mark is-${shortcutIconVariant}`}
                          >
                            {shortcutConfirmed ? (
                              <CheckIcon fontSize="inherit" />
                            ) : (
                              <FinderEntryIcon kind={item.entry.kind} entry={item.entry} />
                            )}
                          </Box>

                          <Box className="finder-entry-body">
                              <Stack
                                direction="row"
                                alignItems="center"
                                spacing={0.55}
                                minWidth={0}
                                className="finder-entry-title-line"
                              >
                                <Typography
                                  variant="body2"
                                  noWrap
                                  className="finder-entry-title"
                                >
                                  {item.entry.name}
                                </Typography>
                                {shortcutFavorite ? (
                                  <StarIcon
                                    className="finder-entry-star"
                                  />
                                ) : null}
                                {linkShortcut ? (
                                  <Chip
                                    size="small"
                                    className={`finder-link-state-chip ${
                                      shortcutLinkSummary?.warnings.length ? "is-warning" : "is-ready"
                                    }`}
                                    label={linkEntryStatusLabel(shortcutLinkSummary)}
                                  />
                                ) : null}
                              </Stack>
                              <Typography
                                variant="caption"
                                noWrap
                                className="finder-entry-subtitle"
                              >
                                {shortcutSubtitle}
                              </Typography>
                          </Box>

                          <Box className="finder-entry-sidecar">
                            {shortcutCategoryLabel ? (
                              <span className="finder-entry-category-label">
                                {shortcutCategoryLabel}
                              </span>
                            ) : null}
                          </Box>

                          <Stack
                            direction="row"
                            spacing={0.38}
                            justifyContent={{ xs: "flex-start", md: "flex-end" }}
                            className="finder-entry-actions"
                            sx={{
                              gridColumn: { xs: "2 / 3", md: 4 },
                              width: "fit-content",
                              minWidth: "max-content",
                              flexShrink: 0,
                              justifySelf: { xs: "start", md: "end" },
                              alignSelf: "center",
                              zIndex: 1,
                            }}
                          >
                            <Tooltip title={`打开${finderEntryKindLabel(item.entry.kind)}`}>
                              <IconButton
                                className="finder-entry-action is-primary"
                                aria-label={`打开 ${item.entry.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleOpenShortcut(item, shortcutKey);
                                }}
                              >
                                {finderEntryActionIcon(item.entry.kind)}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="更多操作">
                              <IconButton
                                className="finder-entry-action is-muted"
                                aria-label={`${item.entry.name} 更多操作`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setShortcutMenuAnchor(event.currentTarget);
                                  setShortcutMenuKey(shortcutKey);
                                }}
                              >
                                <MoreIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </Box>
                      </Tooltip>
                    );
                    })}
                    <Stack
                      className={
                        hasMoreFinderEntries
                          ? "workflow-history-footer"
                          : "workflow-history-footer workflow-history-footer--done"
                      }
                    >
                      {hasMoreFinderEntries ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={loadMoreFinderEntries}
                          className="workflow-history-footer-action"
                        >
                          下滑加载更多
                        </Button>
                      ) : (
                        <AppListEndState />
                      )}
                    </Stack>
                  </Box>
                </Stack>
              ) : null}
              <Menu
                anchorEl={shortcutMenuAnchor}
                open={Boolean(shortcutMenuAnchor)}
                onClose={closeShortcutMenu}
                slotProps={{
                  paper: {
                    sx: {
                      mt: 0.5,
                      minWidth: 170,
                      borderRadius: "14px",
                      border: `1px solid ${tone.menuBorder}`,
                      background: tone.menuBg,
                      color: tone.outerColor,
                      boxShadow: tone.menuShadow,
                      backdropFilter: "blur(18px) saturate(1.16)",
                      WebkitBackdropFilter: "blur(18px) saturate(1.16)",
                      backgroundImage: "none",
                      "& .MuiMenu-list": {
                        py: 0.55,
                      },
                      "& .MuiMenuItem-root": {
                        minHeight: 34,
                        px: 1.1,
                        gap: 0.4,
                        borderRadius: "10px",
                        mx: 0.45,
                      },
                    },
                  },
                }}
              >
                <MenuItem
                  disabled={!shortcutMenuItem}
                  onClick={() => {
                    if (!shortcutMenuItem) {
                      return;
                    }
                    const shortcutKey = buildFinderShortcutKey(shortcutMenuItem);
                    closeShortcutMenu();
                    void handleOpenShortcut(shortcutMenuItem, shortcutKey);
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    {shortcutMenuItem && isLinkToolEntry(shortcutMenuItem.entry) ? (
                      <WorkflowIcon fontSize="small" />
                    ) : (
                      <OpenExternalIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      shortcutMenuItem && isLinkToolEntry(shortcutMenuItem.entry)
                        ? "查看计划"
                        : "打开入口"
                    }
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={
                    !shortcutMenuItem ||
                    shortcutMenuItem.entry.kind !== "url" ||
                    !shortcutMenuItem.entry.url
                  }
                  onClick={() => {
                    if (!shortcutMenuItem) {
                      return;
                    }
                    openShortcutRuntimePanel(shortcutMenuItem);
                    closeShortcutMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <AppWindowIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="运行面板"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={!shortcutMenuItem}
                  onClick={() => {
                    if (!shortcutMenuItem) {
                      return;
                    }
                    onToggleShortcutFavorite(shortcutMenuItem);
                    closeShortcutMenu();
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 30,
                      color: shortcutMenuFavorite
                        ? tone.categoryChipActiveColor
                        : "inherit",
                    }}
                  >
                    <StarIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={shortcutMenuFavorite ? "取消标记" : "标记入口"}
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
              </Menu>
	              <WorkflowRulesConfigDialog
                open={workflowOpen}
                title="联动配置"
                context={
                  workflowProjectEntry ? (
                    <Stack spacing={1}>
                      <Stack direction="row" flexWrap="wrap" gap={0.7}>
                        <Chip size="small" label={workflowProjectEntry.name} />
                        <Chip size="small" label={workflowProjectEntry.key} variant="outlined" />
                      </Stack>
                      <TextField
                        select
                        size="small"
                        label="动作"
                        value={workflowAction}
                        onChange={(event) =>
                          setWorkflowAction(event.target.value as ProjectWorkflowAction)
                        }
                      >
                        {PROJECT_WORKFLOW_ACTIONS.map((action) => (
                          <MenuItem
                            key={action}
                            value={action}
                            disabled={!projectWorkflowActionAvailable(workflowProjectEntry, action)}
                          >
                            {workflowProjectActionLabel(action)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Stack>
                  ) : null
                }
                receiveSignalIds={
                  workflowProjectEntry
                    ? workflowReceiveSignalIdsForProjectReplay(workflowProjectEntry, workflowAction)
                    : []
                }
                broadcastSignalIds={
                  workflowProjectEntry
                    ? workflowBroadcastSignalIdsForProjectReplay(workflowProjectEntry, workflowAction)
                    : []
                }
                signalOptions={workflowSignalOptions}
                signalSummaries={workflowSignalSummaries}
                defaultBroadcastSignalId={
                  workflowReplay ? defaultSignalIdForReplay(workflowReplay) : undefined
                }
                onDeleteSignal={onWorkflowSignalDelete}
                onClearSignals={onWorkflowSignalsClear}
                onClose={() => setWorkflowOpen(false)}
                onSave={({ receiveSignalIds, broadcastSignalIds }) => {
                  if (workflowProjectEntry) {
                    onWorkflowProjectReplayRulesChange(workflowProjectEntry, workflowAction, {
                      receiveSignalIds,
                      broadcastSignalIds,
                    });
                  }
                  setWorkflowOpen(false);
                }}
              />
              <WorkflowLinksDialog
                open={workflowListOpen}
                title="联动清单"
                items={workflowGroups}
                onClose={() => setWorkflowListOpen(false)}
                onEnabledChange={(item, enabled) => {
                  if (item.ruleKind === "receive") {
                    onWorkflowReceiveRulesEnabledChange(item.ruleIds, enabled);
                  } else {
                    onWorkflowBroadcastRulesEnabledChange(item.ruleIds, enabled);
                  }
                }}
                onDelete={(item) => {
                  if (item.ruleKind === "receive") {
                    onWorkflowReceiveRulesDelete(item.ruleIds);
                  } else {
                    onWorkflowBroadcastRulesDelete(item.ruleIds);
                  }
                }}
                onClearAll={(items) => {
                  const receiveRuleIds = items
                    .filter((item) => item.ruleKind === "receive")
                    .flatMap((item) => item.ruleIds);
                  const broadcastRuleIds = items
                    .filter((item) => item.ruleKind === "broadcast")
                    .flatMap((item) => item.ruleIds);
                  if (receiveRuleIds.length > 0) {
                    onWorkflowReceiveRulesDelete(receiveRuleIds);
                  }
                  if (broadcastRuleIds.length > 0) {
                    onWorkflowBroadcastRulesDelete(broadcastRuleIds);
                  }
                }}
              />
              <ConfigSourceManagerDialog
                open={runtimeConfigSourceManagerOpen}
                initialSourceId={runtimeConfigSourceId}
                onClose={() => setRuntimeConfigSourceManagerOpen(false)}
                onChanged={async (sources) => {
                  try {
                    const result = adoptRuntimeConfigSources(
                      sources,
                      runtimeConfigSourceId,
                    );
                    if (result.sourceId === runtimeConfigSourceId) {
                      await loadRuntimeProfiles(runtimePanelProfile?.key);
                    }
                  } catch (reason) {
                    setRuntimeProfilesError(String(reason));
                  }
                }}
              />
              {projectConfigOpen && projectConfigPanel
                ? createPortal(
                    <SettingsPanel
                      {...projectConfigPanel}
                      surface="projectManagement"
                      initialSection="projectBasics"
                      selectedProjectKey={
                        projectConfigKey || projectConfigPanel.selectedProjectKey
                      }
                      onClose={() => {
                        setProjectConfigOpen(false);
                        setProjectConfigKey("");
                      }}
                    />,
                    document.body,
                  )
                : null}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
