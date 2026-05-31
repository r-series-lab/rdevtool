import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type {
  FinderEntry,
  FinderShortcutItem,
  ProjectWorkflowAction,
  ProjectRuntimeEntry,
  ProjectRuntimeLogKind,
  ProjectRuntimeLogResponse,
} from "../app-types";
import {
  AppWindowIcon,
  CheckIcon,
  ClearIcon,
  CopyIcon,
  FolderIcon,
  MoreIcon,
  OpenExternalIcon,
  PackageIcon,
  PlayIcon,
  RefreshIcon,
  StarIcon,
  StopIcon,
  TerminalIcon,
  WebsiteIcon,
  WorkflowIcon,
} from "../components/AppIcons";
import {
  WorkflowLinkButton,
  WorkflowLinkSummaryButton,
} from "../components/WorkflowLinkButton";
import {
  WorkflowLinksDialog,
  type WorkflowLinkListItem,
} from "../components/WorkflowLinksDialog";
import { WorkflowRulesConfigDialog } from "../components/WorkflowRulesConfigDialog";
import {
  defaultSignalIdForReplay,
  workflowProjectActionLabel,
  workflowReplayFromProjectRuntime,
  type WorkflowBroadcastRule,
  type WorkflowReceiveRule,
} from "../lib/workflowSignals";

type FinderType = "项目" | "网站" | "应用" | "脚本";
type FinderQuickFilter = "全部" | "收藏" | "最近";

type RuntimeLogState = {
  projectKey: string;
  kind: ProjectRuntimeLogKind;
  path: string;
  lines: string[];
  truncated: boolean;
  loading: boolean;
  error: string;
};

export type ProjectsPageProps = {
  finderTypeOptions: readonly FinderType[];
  finderType: FinderType;
  finderTypeCounts: Record<FinderType, number>;
  onFinderTypeChange: (value: FinderType) => void;
  finderQuickFilterOptions: readonly FinderQuickFilter[];
  finderQuickFilter: FinderQuickFilter;
  finderQuickFilterCounts: Record<FinderQuickFilter, number>;
  onFinderQuickFilterChange: (value: FinderQuickFilter) => void;
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
  branchProjectKeys: string[];
  deployProjectKeys: string[];
  workflowReceiveRules: WorkflowReceiveRule[];
  workflowBroadcastRules: WorkflowBroadcastRule[];
  workflowSignalOptions: string[];
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
  onToggleProjectFavorite: (projectKey: string) => void;
  onToggleShortcutFavorite: (item: FinderShortcutItem) => void;
  onMarkShortcutUsed: (item: FinderShortcutItem) => void;
  onOpenProjectBranch: (projectKey: string) => void;
  onOpenProjectDeploy: (projectKey: string) => void;
  onRefresh: () => void;
  onOpenFinderEntry: (entry: FinderEntry) => Promise<boolean> | boolean;
  onStartRuntime: (projectKey: string) => void;
  onStopRuntime: (projectKey: string) => void;
  onRunBuild: (projectKey: string) => void;
  onStopBuild: (projectKey: string) => void;
  onOpenBuildOutput: (projectKey: string) => void;
  onFocusRuntime: (projectKey: string) => void;
  onOpenProjectDirectory: (projectKey: string) => void;
};

const SHORTCUT_CONFIRM_MS = 1100;
const RUNTIME_LOG_MAX_LINES = 120;
const PROJECT_WORKFLOW_ACTIONS: ProjectWorkflowAction[] = [
  "project.runtime.start",
  "project.runtime.stop",
  "project.build.run",
  "project.build.stop",
  "project.build.openOutput",
  "project.runtime.focus",
  "project.openDirectory",
];

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
          dot: "#5f6978",
          pillBg: "rgba(55, 66, 82, 0.08)",
          pillBorder: "rgba(55, 66, 82, 0.14)",
          pillColor: "#2d3745",
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
        dot: "#eceff4",
        pillBg: "rgba(236, 239, 244, 0.1)",
        pillBorder: "rgba(236, 239, 244, 0.12)",
        pillColor: "#f3f5f8",
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
      toolButtonColor: "rgba(224,229,236,0.5)",
      toolButtonBorder: "var(--line-soft)",
      toolButtonBg: "rgba(255,255,255,0.014)",
      toolButtonHoverColor: "rgba(236,240,245,0.78)",
      toolButtonHoverBg: "rgba(255,255,255,0.03)",
      toolButtonHoverBorder: "var(--line)",
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
      categoryChipActiveColor: "var(--text)",
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
      actionGroupBorder: "var(--line-soft)",
      actionGroupBg: "rgba(255,255,255,0.018)",
      actionGroupShadow: "inset 0 1px 0 rgba(255,255,255,0.014)",
      startButtonDisabledColor: "rgba(225,230,237,0.24)",
      stopButtonBg: "rgba(255,255,255,0.028)",
      stopButtonColor: "rgba(232,236,242,0.7)",
      stopButtonBorder: "var(--line-soft)",
      stopButtonHoverBg: "rgba(255,255,255,0.044)",
      stopButtonDisabledColor: "rgba(225,230,237,0.2)",
      buildButtonBg: "rgba(255,255,255,0.03)",
      buildButtonColor: "rgba(236,240,245,0.76)",
      buildButtonBorder: "var(--line-soft)",
      buildButtonHoverBg: "rgba(255,255,255,0.048)",
      buildButtonBusyBg: "rgba(255,255,255,0.044)",
      buildButtonBusyColor: "rgba(236,240,245,0.62)",
      buildButtonDisabledColor: "rgba(225,230,237,0.2)",
      runningDotHalo: "0 0 0 4px rgba(79,140,255,0.1)",
      mobileMeta: "rgba(218,224,232,0.44)",
    };
  }

  return {
    ...shared,
    statChipPrimaryBg: "rgba(60,70,86,0.052)",
    statChipPrimaryColor: "rgba(51,59,73,0.66)",
    statChipPrimaryBorder: "var(--line-soft)",
    statChipSecondaryBg: "rgba(60,70,86,0.032)",
    statChipSecondaryColor: "rgba(70,80,96,0.54)",
    statChipSecondaryBorder: "var(--line-soft)",
    toolButtonColor: "rgba(64,72,84,0.58)",
    toolButtonBorder: "var(--line-soft)",
    toolButtonBg: "rgba(255,255,255,0.5)",
    toolButtonHoverColor: "rgba(35,40,53,0.82)",
    toolButtonHoverBg: "rgba(255,255,255,0.76)",
    toolButtonHoverBorder: "var(--line)",
    stageBorder: "var(--line-soft)",
    stageBg: "rgba(255,255,255,0.54)",
    stageShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
    searchWrapBorder: "var(--line-soft)",
    searchWrapBg: "rgba(255,255,255,0.42)",
    searchWrapShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
    searchInputBg: "rgba(255,255,255,0.9)",
    searchInputColor: "var(--text)",
    searchInputBorder: "var(--line-soft)",
    searchInputHoverBorder: "var(--line)",
    searchPlaceholder: "rgba(92,100,112,0.5)",
    clearButtonColor: "rgba(92,100,112,0.68)",
    clearButtonBorder: "var(--line-soft)",
    clearButtonBg: "rgba(255,255,255,0.78)",
    clearButtonHoverBg: "rgba(255,255,255,0.96)",
    clearButtonHoverBorder: "var(--line)",
    categoryChipBg: "rgba(255,255,255,0.56)",
    categoryChipColor: "rgba(70,80,96,0.7)",
    categoryChipBorder: "var(--line-soft)",
    categoryChipHoverBg: "rgba(255,255,255,0.78)",
    categoryChipActiveColor: "var(--accent)",
    emptyBorder: "var(--line-soft)",
    emptyBg: "rgba(255,255,255,0.48)",
    emptyShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
    emptyText: "var(--muted)",
    rowBorderStrong: "var(--line)",
    rowBorder: "var(--line-soft)",
    rowBgEven: "rgba(255,255,255,0.68)",
    rowBgOdd: "rgba(255,255,255,0.56)",
    rowShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
    rowHoverBorder: "var(--accent-border)",
    rowHoverBg: "var(--accent-soft)",
    rowHoverShadow: "inset 0 1px 0 rgba(255,255,255,0.64)",
    rowTitle: "var(--text)",
    rowKey: "rgba(90,98,112,0.6)",
    rowMeta: "rgba(83,92,106,0.72)",
    rowHint: "rgba(92,100,112,0.7)",
    actionGroupBorder: "var(--line-soft)",
    actionGroupBg: "rgba(255,255,255,0.66)",
    actionGroupShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
    startButtonDisabledColor: "rgba(120,126,136,0.32)",
    stopButtonBg: "rgba(255,255,255,0.54)",
    stopButtonColor: "rgba(52,60,74,0.76)",
    stopButtonBorder: "var(--line-soft)",
    stopButtonHoverBg: "rgba(255,255,255,0.84)",
    stopButtonDisabledColor: "rgba(120,126,136,0.24)",
    buildButtonBg: "rgba(255,255,255,0.58)",
    buildButtonColor: "rgba(52,60,74,0.8)",
    buildButtonBorder: "var(--line-soft)",
    buildButtonHoverBg: "rgba(255,255,255,0.9)",
    buildButtonBusyBg: "rgba(255,255,255,0.68)",
    buildButtonBusyColor: "rgba(52,60,74,0.62)",
    buildButtonDisabledColor: "rgba(120,126,136,0.24)",
    runningDotHalo: "0 0 0 4px rgba(37,99,235,0.1)",
    mobileMeta: "rgba(83,92,106,0.7)",
  };
}

function formatRuntimeHint(item: ProjectRuntimeEntry): string {
  return "";
}

function formatBuildHint(item: ProjectRuntimeEntry): string {
  return "";
}

function buildMetaSegments(item: ProjectRuntimeEntry): string[] {
  const segments: string[] = [];
  if (item.cwd || item.repoPath) {
    segments.push(item.cwd || item.repoPath || "");
  }
  if (item.command) {
    segments.push(item.command);
  }
  return segments.filter(Boolean);
}

function finderPlaceholder(type: FinderType): string {
  switch (type) {
    case "网站":
      return "搜索网站、地址或备注";
    case "应用":
      return "搜索应用、Bundle ID 或备注";
    case "脚本":
      return "搜索脚本、路径或备注";
    default:
      return "搜索项目、路径、命令";
  }
}

function finderEntryKindLabel(kind: string): string {
  switch (kind) {
    case "app":
      return "应用";
    case "script":
      return "脚本";
    default:
      return "网站";
  }
}

function FinderEntryIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "app":
      return <AppWindowIcon fontSize="inherit" />;
    case "script":
      return <TerminalIcon fontSize="inherit" />;
    default:
      return <WebsiteIcon fontSize="inherit" />;
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
  addDetail("Bundle ID", entry.bundleId);
  addDetail("应用", entry.appName);
  addDetail("脚本", entry.script);
  addDetail("目录", entry.cwd);

  return detailLines;
}

function buildFinderShortcutKey(item: FinderShortcutItem): string {
  return [
    item.categoryTitle,
    item.categoryLabel,
    item.entry.kind,
    item.entry.name,
    item.entry.targetLabel,
  ].join("\u0000");
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

export function ProjectsPage({
  finderTypeOptions,
  finderType,
  finderTypeCounts,
  onFinderTypeChange,
  finderQuickFilterOptions,
  finderQuickFilter,
  finderQuickFilterCounts,
  onFinderQuickFilterChange,
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
  recentShortcutKeys,
  branchProjectKeys,
  deployProjectKeys,
  workflowReceiveRules,
  workflowBroadcastRules,
  workflowSignalOptions,
  workflowReceiveSignalIdsForProjectReplay,
  workflowBroadcastSignalIdsForProjectReplay,
  onWorkflowProjectReplayRulesChange,
  onWorkflowReceiveRulesEnabledChange,
  onWorkflowReceiveRulesDelete,
  onWorkflowBroadcastRulesEnabledChange,
  onWorkflowBroadcastRulesDelete,
  onToggleProjectFavorite,
  onToggleShortcutFavorite,
  onMarkShortcutUsed,
  onOpenProjectBranch,
  onOpenProjectDeploy,
  onRefresh,
  onOpenFinderEntry,
  onStartRuntime,
  onStopRuntime,
  onRunBuild,
  onStopBuild,
  onOpenBuildOutput,
  onFocusRuntime,
  onOpenProjectDirectory,
}: ProjectsPageProps) {
  const theme = useTheme();
  const mono = theme.palette.mode === "dark";
  const tone = buildProjectsTone(mono);
  const [confirmedShortcutKey, setConfirmedShortcutKey] = useState<string | null>(
    null,
  );
  const [projectMenuAnchor, setProjectMenuAnchor] =
    useState<HTMLElement | null>(null);
  const [projectMenuKey, setProjectMenuKey] = useState("");
  const [detailsProjectKey, setDetailsProjectKey] = useState("");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowProjectKey, setWorkflowProjectKey] = useState("");
  const [workflowAction, setWorkflowAction] =
    useState<ProjectWorkflowAction>("project.runtime.start");
  const [copiedProjectAction, setCopiedProjectAction] = useState("");
  const [runtimeLogKind, setRuntimeLogKind] =
    useState<ProjectRuntimeLogKind>("dev");
  const [runtimeLog, setRuntimeLog] = useState<RuntimeLogState>({
    projectKey: "",
    kind: "dev",
    path: "",
    lines: [],
    truncated: false,
    loading: false,
    error: "",
  });
  const [runtimeLogRefreshKey, setRuntimeLogRefreshKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const finderIsProjects = finderType === "项目";
  const runningCount = runtimeEntries.filter(
    (item) => item.statusKey === "running",
  ).length;
  const configurableCount = runtimeEntries.filter(
    (item) => item.command,
  ).length;
  const activeShortcutCount = filteredShortcutEntries.length;
  const totalShortcutCount = shortcutEntries.length;
  const showFinderCategories =
    !finderIsProjects && finderCategories.length > 1;
  const favoriteProjectKeySet = new Set(favoriteProjectKeys);
  const recentProjectKeySet = new Set(recentProjectKeys);
  const favoriteShortcutKeySet = new Set(favoriteShortcutKeys);
  const recentShortcutKeySet = new Set(recentShortcutKeys);
  const branchProjectKeySet = new Set(branchProjectKeys);
  const deployProjectKeySet = new Set(deployProjectKeys);
  const projectMenuEntry =
    runtimeEntries.find((item) => item.key === projectMenuKey) ?? null;
  const detailsProjectEntry =
    runtimeEntries.find((item) => item.key === detailsProjectKey) ?? null;
  const workflowProjectEntry =
    runtimeEntries.find((item) => item.key === workflowProjectKey) ?? null;
  const workflowReplay = workflowProjectEntry
    ? workflowReplayFromProjectRuntime(workflowProjectEntry, workflowAction)
    : null;
  const projectMenuPath = projectMenuEntry?.cwd || projectMenuEntry?.repoPath || "";
  const detailsProjectPath =
    detailsProjectEntry?.cwd || detailsProjectEntry?.repoPath || "";
  const showQuickFilters =
    (finderIsProjects ? runtimeEntries.length : shortcutEntries.length) > 0;
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
    if (detailsProjectKey && !detailsProjectEntry) {
      setDetailsProjectKey("");
    }
  }, [detailsProjectEntry, detailsProjectKey]);

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
        (detailsProjectKey ||
          finderQuery ||
          finderQuickFilter !== "全部" ||
          finderCategory !== "全部")
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
        if (finderQuickFilter !== "全部") {
          onFinderQuickFilterChange("全部");
          return;
        }
        if (finderCategory !== "全部") {
          onFinderCategoryChange("全部");
        }
        return;
      }

      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !isTextEditingTarget(event.target)
      ) {
        const filterIndex = Number(event.key) - 1;
        const filter = finderQuickFilterOptions[filterIndex];
        if (!filter) {
          return;
        }
        const count = finderQuickFilterCounts[filter] ?? 0;
        if (filter !== "全部" && count === 0) {
          return;
        }
        event.preventDefault();
        onFinderQuickFilterChange(filter);
      }
    }

    window.addEventListener("keydown", handleFinderKeyDown);
    return () => window.removeEventListener("keydown", handleFinderKeyDown);
  }, [
    detailsProjectKey,
    finderCategory,
    finderQuery,
    finderQuickFilter,
    finderQuickFilterCounts,
    finderQuickFilterOptions,
    onFinderCategoryChange,
    onFinderQuickFilterChange,
    onFinderQueryChange,
  ]);

  function closeProjectMenu() {
    setProjectMenuAnchor(null);
    setProjectMenuKey("");
  }

  async function handleCopyProjectValue(value: string, label: string) {
    if (!value) {
      return;
    }
    await copyPlainText(value);
    setCopiedProjectAction(label);
    if (copiedTimerRef.current != null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedProjectAction("");
      copiedTimerRef.current = null;
    }, SHORTCUT_CONFIRM_MS);
  }

  async function handleOpenShortcut(item: FinderShortcutItem, shortcutKey: string) {
    try {
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

  function workflowSignalIdsForProject(item: ProjectRuntimeEntry) {
    return PROJECT_WORKFLOW_ACTIONS.flatMap((action) => [
      ...workflowReceiveSignalIdsForProjectReplay(item, action),
      ...workflowBroadcastSignalIdsForProjectReplay(item, action),
    ]);
  }

  function openProjectWorkflowDialog(item: ProjectRuntimeEntry) {
    setWorkflowProjectKey(item.key);
    setWorkflowAction(defaultProjectWorkflowAction(item));
    setWorkflowOpen(true);
  }

  return (
    <Box className="workspace">
      <Box
        sx={{
          position: "relative",
          borderRadius: "20px",
          overflow: "hidden",
          border: "1px solid",
          borderColor: tone.outerBorder,
          bgcolor: tone.outerBg,
          color: tone.outerColor,
          boxShadow: tone.outerShadow,
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            background: tone.outerOverlay,
            opacity: 0.98,
            pointerEvents: "none",
          },
        }}
      >
        <Box sx={{ position: "relative", p: 1.5 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="flex-end"
            spacing={0.8}
            mb={1.05}
            sx={{
              px: 0.2,
              pb: 0.95,
              borderBottom: `1px solid ${tone.topDivider}`,
            }}
          >
            <Stack
              direction="row"
              spacing={0.8}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip
                size="small"
                label={
                  finderIsProjects
                    ? `运行中 ${runningCount}`
                    : `${finderType} ${totalShortcutCount}`
                }
                sx={{
                  height: 19,
                  px: 0.15,
                  bgcolor: tone.statChipPrimaryBg,
                  color: tone.statChipPrimaryColor,
                  border: `1px solid ${tone.statChipPrimaryBorder}`,
                  boxShadow: "none",
                  "& .MuiChip-label": {
                    px: 0.8,
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                  },
                }}
              />
              <Chip
                size="small"
                label={
                  finderIsProjects
                    ? `可启动 ${configurableCount}`
                    : showFinderCategories
                      ? `分类 ${finderCategories.length}`
                      : `当前 ${activeShortcutCount}`
                }
                sx={{
                  height: 19,
                  px: 0.15,
                  bgcolor: tone.statChipSecondaryBg,
                  color: tone.statChipSecondaryColor,
                  border: `1px solid ${tone.statChipSecondaryBorder}`,
                  boxShadow: "none",
                  "& .MuiChip-label": {
                    px: 0.8,
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                  },
                }}
              />
              <WorkflowLinkSummaryButton
                count={workflowGroups.length}
                onClick={() => setWorkflowListOpen(true)}
              />
              <Tooltip title="刷新项目状态">
                <span>
                  <IconButton
                    aria-label="刷新项目状态"
                    onClick={onRefresh}
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: "10px",
                      color: tone.toolButtonColor,
                      border: `1px solid ${tone.toolButtonBorder}`,
                      backgroundColor: tone.toolButtonBg,
                      backdropFilter: "blur(8px)",
                      "&:hover": {
                        color: tone.toolButtonHoverColor,
                        backgroundColor: tone.toolButtonHoverBg,
                        borderColor: tone.toolButtonHoverBorder,
                      },
                    }}
                  >
                    <RefreshIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>

          <Box
            sx={{
              position: "relative",
              borderRadius: "20px",
              border: `1px solid ${tone.stageBorder}`,
              background: tone.stageBg,
              boxShadow: tone.stageShadow,
              backdropFilter: "blur(18px)",
              "&::before": {
                content: '""',
                position: "absolute",
                inset: 0,
                borderRadius: "inherit",
                background: tone.stageOverlay,
                pointerEvents: "none",
              },
            }}
          >
            <Box
              sx={{
                position: "relative",
                p: 0.9,
              }}
            >
              <Box
                sx={{
                  mb: 1.05,
                  p: 0.45,
                  borderRadius: "18px",
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
                    placeholder={finderPlaceholder(finderType)}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: "14px",
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
                        paddingTop: "9px",
                        paddingBottom: "9px",
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
                        aria-label="清空项目搜索"
                        sx={{
                          width: 32,
                          height: 32,
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
                </Stack>
              </Box>

              <Box
                sx={{
                  mb: 1.05,
                  p: 0.45,
                  borderRadius: "18px",
                  border: `1px solid ${tone.searchWrapBorder}`,
                  backgroundColor: tone.searchWrapBg,
                  boxShadow: tone.searchWrapShadow,
                  backdropFilter: "blur(12px)",
                }}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${finderTypeOptions.length}, minmax(0, 1fr))`,
                    gap: 0.55,
                  }}
                >
                  {finderTypeOptions.map((type) => {
                    const active = type === finderType;
                    return (
                      <Box
                        key={type}
                        component="button"
                        type="button"
                        onClick={() => onFinderTypeChange(type)}
                        sx={{
                          width: "100%",
                          minWidth: 0,
                          height: { xs: 38, sm: 34 },
                          px: { xs: 0.72, sm: 0.9 },
                          borderRadius: "13px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 0.4,
                          cursor: "pointer",
                          appearance: "none",
                          textAlign: "left",
                          border: "1px solid",
                          borderColor: active
                            ? tone.categoryChipActiveBorder
                            : tone.categoryChipBorder,
                          bgcolor: active
                            ? tone.categoryChipActiveBg
                            : tone.categoryChipBg,
                          color: active
                            ? tone.categoryChipActiveColor
                            : tone.categoryChipColor,
                          boxShadow: active
                            ? mono
                              ? "0 10px 22px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08)"
                              : "0 10px 20px rgba(115,88,53,0.08)"
                            : "none",
                          "&:hover": {
                            bgcolor: active
                              ? tone.categoryChipActiveBg
                              : tone.categoryChipHoverBg,
                          },
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: { xs: "0.78rem", sm: "0.82rem" },
                            fontWeight: active ? 700 : 600,
                            letterSpacing: "0.01em",
                          }}
                        >
                          {type}
                        </Box>
                        <Box
                          component="span"
                          sx={{
                            flexShrink: 0,
                            minWidth: 18,
                            px: 0.36,
                            py: 0.04,
                            borderRadius: "999px",
                            bgcolor: active
                              ? mono
                                ? "rgba(17,19,25,0.12)"
                                : "rgba(255,255,255,0.32)"
                              : mono
                                ? "rgba(255,255,255,0.06)"
                                : "rgba(60,70,86,0.08)",
                            fontSize: "0.62rem",
                            lineHeight: 1.32,
                            textAlign: "center",
                            color: "inherit",
                          }}
                        >
                          {finderTypeCounts[type] ?? 0}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>

              {showQuickFilters ? (
                <Box
                  sx={{
                    mb: 1.05,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 0.58,
                  }}
                >
                  {finderQuickFilterOptions.map((filter) => {
                    const active = filter === finderQuickFilter;
                    const count = finderQuickFilterCounts[filter] ?? 0;
                    const disabled = filter !== "全部" && count === 0;
                    return (
                      <Chip
                        key={filter}
                        size="small"
                        label={`${filter} ${count}`}
                        onClick={
                          disabled
                            ? undefined
                            : () => onFinderQuickFilterChange(filter)
                        }
                        sx={{
                          height: 24,
                          opacity: disabled ? 0.48 : 1,
                          cursor: disabled ? "default" : "pointer",
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
                            bgcolor: disabled
                              ? active
                                ? tone.categoryChipActiveBg
                                : tone.categoryChipBg
                              : active
                                ? tone.categoryChipActiveBg
                                : tone.categoryChipHoverBg,
                          },
                          "& .MuiChip-label": {
                            px: 0.95,
                            fontSize: "0.68rem",
                            fontWeight: active ? 700 : 600,
                            letterSpacing: "0.02em",
                          },
                        }}
                      />
                    );
                  })}
                </Box>
              ) : null}

              {showFinderCategories ? (
                <Box
                  sx={{
                    mb: 1.15,
                    p: 0.78,
                    borderRadius: "15px",
                    border: `1px solid ${tone.searchWrapBorder}`,
                    backgroundColor: tone.searchWrapBg,
                    boxShadow: tone.searchWrapShadow,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <Stack spacing={0.72}>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        color: tone.rowHint,
                      }}
                    >
                      分类
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 0.6,
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
                              height: 24,
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
                                px: 0.95,
                                fontSize: "0.68rem",
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
                <Box
                  sx={{
                    px: 1.2,
                    py: 1.1,
                    borderRadius: "16px",
                    border: `1px solid ${tone.emptyBorder}`,
                    backgroundColor: tone.emptyBg,
                    boxShadow: tone.emptyShadow,
                  }}
                >
                  <Typography variant="body2" sx={{ color: tone.emptyText }}>
                    还没有加载到项目配置，请检查 `projects.toml` 是否可读。
                  </Typography>
                </Box>
              ) : null}

              {finderIsProjects &&
              runtimeEntries.length > 0 &&
              filteredRuntimeEntries.length === 0 ? (
                <Box
                  sx={{
                    px: 1.2,
                    py: 1.1,
                    borderRadius: "16px",
                    border: `1px solid ${tone.emptyBorder}`,
                    backgroundColor: tone.emptyBg,
                    boxShadow: tone.emptyShadow,
                  }}
                >
                  <Typography variant="body2" sx={{ color: tone.emptyText }}>
                    当前没有匹配项目，试试调整搜索词。
                  </Typography>
                </Box>
              ) : null}

              {finderIsProjects &&
              runtimeEntries.length > 0 &&
              filteredRuntimeEntries.length > 0 ? (
                <Box
                  sx={{
                    display: "grid",
                    gap: 0.78,
                  }}
                >
                  {filteredRuntimeEntries.map((item, index) => {
                    const metaSegments = buildMetaSegments(item);
                    const runtimeHint = formatRuntimeHint(item);
                    const buildHint = formatBuildHint(item);
                    const runtimeRunning = item.canStop;
                    const runtimeAvailable = item.canStart || item.canStop;
                    const runtimeTooltip = runtimeRunning
                      ? "停止项目"
                      : "启动项目";
                    const runtimeAriaLabel = runtimeRunning
                      ? `停止 ${item.name}`
                      : `启动 ${item.name}`;
                    const canFocusRuntime =
                      runtimeRunning && item.canFocusRuntime;
                    const statusPalette = buildStatusPalette(
                      item.statusKey,
                      mono,
                    );
                    const buildPalette = buildStatusPalette(
                      item.buildStatusKey,
                      mono,
                    );
                    const buildRunning = item.canStopBuild;
                    const showBuildStatus =
                      Boolean(item.buildCommand) ||
                      item.buildStatusKey !== "notConfigured";
                    const buildTooltip = buildRunning
                      ? "中止打包"
                      : item.buildCommand
                        ? item.buildStatusKey === "succeeded"
                          ? "重新打包"
                          : "执行打包"
                        : "未配置打包命令";
                    const buildStatusTooltip = item.canOpenBuildOutput
                      ? item.buildOutputDir
                        ? `打开产物目录\n${item.buildOutputDir}`
                        : "打开产物目录"
                      : item.buildDetail;
                    const projectFavorite = favoriteProjectKeySet.has(item.key);
                    const projectRecent = recentProjectKeySet.has(item.key);
                    const projectCanOpenBranch = branchProjectKeySet.has(item.key);
                    const projectCanOpenDeploy = deployProjectKeySet.has(item.key);
                    const projectPath = item.cwd || item.repoPath || "";
                    const workflowSignalIds = workflowSignalIdsForProject(item);
                    return (
                      <Box
                        key={item.key}
                        sx={{
                          position: "relative",
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "minmax(0,1fr)",
                            md: "minmax(180px, 224px) minmax(220px, 1fr) minmax(176px, 208px) max-content",
                          },
                          columnGap: { xs: 1, md: 1.1 },
                          rowGap: 0.75,
                          alignItems: "center",
                          px: 1.25,
                          py: { xs: 1.1, md: 0.96 },
                          pr: { xs: 19.2, md: 1.25 },
                          borderRadius: "18px",
                          border: "1px solid",
                          borderColor:
                            projectFavorite
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
                        }}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.8}
                          minWidth={0}
                          sx={{ pr: { xs: 0.5, md: 0 } }}
                        >
                          {projectFavorite ? (
                            <StarIcon
                              sx={{
                                width: 14,
                                height: 14,
                                flexShrink: 0,
                                color: tone.categoryChipActiveColor,
                              }}
                            />
                          ) : null}
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              flexShrink: 0,
                              bgcolor: statusPalette.dot,
                              boxShadow:
                                item.statusKey === "running"
                                  ? tone.runningDotHalo
                                  : "none",
                            }}
                          />
                          <Box minWidth={0}>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 700,
                                lineHeight: 1.15,
                                color: tone.rowTitle,
                              }}
                            >
                              {item.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                display: "block",
                                letterSpacing: "0.05em",
                                color: tone.rowKey,
                              }}
                            >
                              {projectRecent ? `${item.key} · 最近` : item.key}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          minWidth={0}
                          sx={{
                            display: { xs: "none", md: "flex" },
                            color: tone.rowMeta,
                          }}
                        >
                          <Tooltip
                            title={item.cwd || item.repoPath || "未配置路径"}
                          >
                            <Stack
                              direction="row"
                              spacing={0.55}
                              alignItems="center"
                              minWidth={0}
                            >
                              <FolderIcon
                                sx={{
                                  fontSize: 15,
                                  flexShrink: 0,
                                  opacity: 0.72,
                                }}
                              />
                              <Typography
                                variant="caption"
                                sx={{
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontFamily:
                                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                  color: "inherit",
                                }}
                              >
                                {item.cwd || item.repoPath || "未配置目录"}
                              </Typography>
                            </Stack>
                          </Tooltip>

                          <Tooltip title={item.command || "未配置命令"}>
                            <Stack
                              direction="row"
                              spacing={0.55}
                              alignItems="center"
                              minWidth={0}
                            >
                              <TerminalIcon
                                sx={{
                                  fontSize: 15,
                                  flexShrink: 0,
                                  opacity: 0.72,
                                }}
                              />
                              <Typography
                                variant="caption"
                                sx={{
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontFamily:
                                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                  color: "inherit",
                                }}
                              >
                                {item.command || "未配置命令"}
                              </Typography>
                            </Stack>
                          </Tooltip>
                        </Stack>

                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: {
                              xs: showBuildStatus
                                ? "repeat(2, minmax(64px, max-content))"
                                : "minmax(64px, max-content)",
                              md: showBuildStatus
                                ? "repeat(2, minmax(82px, 96px))"
                                : "minmax(82px, 96px)",
                            },
                            gap: 0.55,
                            alignItems: "center",
                            justifyContent: { xs: "flex-start", md: "flex-end" },
                            minWidth: { md: showBuildStatus ? 176 : 92 },
                            width: { md: "100%" },
                            "& .MuiChip-root": {
                              width: { xs: "auto", md: "100%" },
                              minWidth: 0,
                              height: 24,
                            },
                            "& .MuiChip-label": {
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              px: 0.85,
                            },
                          }}
                        >
                          <Stack spacing={0.22} minWidth={0}>
                            <Tooltip
                              title={
                                canFocusRuntime
                                  ? "唤起运行中的项目"
                                  : item.statusLabel
                              }
                            >
                              <Chip
                                size="small"
                                label={item.statusLabel}
                                onClick={
                                  canFocusRuntime
                                    ? () => onFocusRuntime(item.key)
                                    : undefined
                                }
                                clickable={canFocusRuntime}
                                sx={{
                                  bgcolor: statusPalette.pillBg,
                                  color: statusPalette.pillColor,
                                  border: `1px solid ${statusPalette.pillBorder}`,
                                  backdropFilter: "blur(10px)",
                                  cursor: canFocusRuntime ? "pointer" : "default",
                                }}
                              />
                            </Tooltip>
                            {runtimeHint ? (
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  minWidth: 0,
                                  textAlign: { md: "center" },
                                  fontSize: "0.66rem",
                                  fontWeight: 500,
                                  letterSpacing: "0.02em",
                                  color: tone.rowHint,
                                }}
                              >
                                {runtimeHint}
                              </Typography>
                            ) : null}
                          </Stack>
                          {showBuildStatus ? (
                            <Stack spacing={0.22} minWidth={0}>
                              <Tooltip title={buildStatusTooltip}>
                                <Chip
                                  size="small"
                                  icon={
                                    item.canOpenBuildOutput ? (
                                      <FolderIcon
                                        sx={{
                                          fontSize: "0.8rem !important",
                                        }}
                                      />
                                    ) : undefined
                                  }
                                  label={item.buildStatusLabel}
                                  onClick={
                                    item.canOpenBuildOutput
                                      ? () => onOpenBuildOutput(item.key)
                                      : undefined
                                  }
                                  clickable={item.canOpenBuildOutput}
                                  sx={{
                                    bgcolor: buildPalette.pillBg,
                                    color: buildPalette.pillColor,
                                    border: `1px solid ${buildPalette.pillBorder}`,
                                    backdropFilter: "blur(10px)",
                                    "& .MuiChip-icon": {
                                      color: "inherit",
                                    },
                                  }}
                                />
                              </Tooltip>
                              {buildHint ? (
                                <Typography
                                  variant="caption"
                                  noWrap
                                  sx={{
                                    minWidth: 0,
                                    textAlign: { md: "center" },
                                    fontSize: "0.66rem",
                                    fontWeight: 500,
                                    letterSpacing: "0.02em",
                                    color: tone.rowHint,
                                  }}
                                >
                                  {buildHint}
                                </Typography>
                              ) : null}
                            </Stack>
                          ) : null}
                        </Box>

                        <Stack
                          direction="row"
                          spacing={0.45}
                          justifyContent={{ xs: "flex-start", md: "flex-end" }}
                          sx={{
                            width: "fit-content",
                            justifySelf: { md: "end" },
                            alignSelf: "center",
                            px: 0.45,
                            py: 0.35,
                            borderRadius: "999px",
                            border: `1px solid ${tone.actionGroupBorder}`,
                            backgroundColor: tone.actionGroupBg,
                            boxShadow: tone.actionGroupShadow,
                            position: { xs: "absolute", md: "static" },
                            top: { xs: 12, md: "auto" },
                            right: { xs: 12, md: "auto" },
                            zIndex: 1,
                          }}
                        >
                          <Tooltip title={projectFavorite ? "取消收藏" : "收藏项目"}>
                            <span>
                              <IconButton
                                aria-label={
                                  projectFavorite
                                    ? `取消收藏 ${item.name}`
                                    : `收藏 ${item.name}`
                                }
                                onClick={() => onToggleProjectFavorite(item.key)}
                                sx={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "999px",
                                  bgcolor: projectFavorite
                                    ? tone.categoryChipActiveBg
                                    : tone.stopButtonBg,
                                  color: projectFavorite
                                    ? tone.categoryChipActiveColor
                                    : tone.stopButtonColor,
                                  border: `1px solid ${
                                    projectFavorite
                                      ? tone.categoryChipActiveBorder
                                      : tone.stopButtonBorder
                                  }`,
                                  "&:hover": {
                                    bgcolor: projectFavorite
                                      ? tone.categoryChipActiveBg
                                      : tone.stopButtonHoverBg,
                                  },
                                }}
                              >
                                <StarIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="配置联动">
                            <span>
                              <WorkflowLinkButton
                                active={workflowSignalIds.length > 0}
                                onClick={() => openProjectWorkflowDialog(item)}
                                title="配置联动"
                              />
                            </span>
                          </Tooltip>
                          <Tooltip title={runtimeTooltip}>
                            <span>
                              <IconButton
                                aria-label={runtimeAriaLabel}
                                disabled={!runtimeAvailable}
                                onClick={() =>
                                  runtimeRunning
                                    ? onStopRuntime(item.key)
                                    : onStartRuntime(item.key)
                                }
                                sx={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "999px",
                                  bgcolor: runtimeRunning
                                    ? tone.stopButtonBg
                                    : item.canStart
                                      ? tone.startButtonBg
                                      : "transparent",
                                  color: runtimeRunning
                                    ? tone.stopButtonColor
                                    : item.canStart
                                      ? tone.startButtonColor
                                      : tone.startButtonDisabledColor,
                                  border: runtimeAvailable
                                    ? `1px solid ${
                                        runtimeRunning
                                          ? tone.stopButtonBorder
                                          : tone.startButtonBorder
                                      }`
                                    : "1px solid transparent",
                                  "&:hover": {
                                    bgcolor: runtimeRunning
                                      ? tone.stopButtonHoverBg
                                      : item.canStart
                                        ? tone.startButtonHoverBg
                                        : "transparent",
                                  },
                                }}
                              >
                                {runtimeRunning ? (
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
                                aria-label={`打开 ${item.name} 的项目目录`}
                                disabled={!item.cwd && !item.repoPath}
                                onClick={() => onOpenProjectDirectory(item.key)}
                                sx={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "999px",
                                  bgcolor: tone.stopButtonBg,
                                  color: item.cwd || item.repoPath
                                    ? tone.stopButtonColor
                                    : tone.stopButtonDisabledColor,
                                  border: `1px solid ${tone.stopButtonBorder}`,
                                  "&:hover": {
                                    bgcolor: tone.stopButtonHoverBg,
                                  },
                                }}
                              >
                                <FolderIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={buildTooltip}>
                            <span>
                              <IconButton
                                aria-label={
                                  buildRunning
                                    ? `中止 ${item.name} 的打包`
                                    : `打包 ${item.name}`
                                }
                                disabled={!buildRunning && !item.canBuild}
                                onClick={() =>
                                  buildRunning
                                    ? onStopBuild(item.key)
                                    : onRunBuild(item.key)
                                }
                                sx={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "999px",
                                  bgcolor: buildRunning
                                    ? tone.buildButtonBusyBg
                                    : item.canBuild
                                      ? tone.buildButtonBg
                                      : "transparent",
                                  color: buildRunning
                                    ? tone.buildButtonBusyColor
                                    : item.canBuild
                                      ? tone.buildButtonColor
                                      : tone.buildButtonDisabledColor,
                                  border:
                                    buildRunning || item.canBuild
                                      ? `1px solid ${tone.buildButtonBorder}`
                                      : "1px solid transparent",
                                  "&:hover": {
                                    bgcolor: buildRunning
                                      ? tone.buildButtonBusyBg
                                      : item.canBuild
                                        ? tone.buildButtonHoverBg
                                        : "transparent",
                                  },
                                }}
                              >
                                {buildRunning ? (
                                  <StopIcon fontSize="small" />
                                ) : (
                                  <PackageIcon fontSize="small" />
                                )}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="更多操作">
                            <span>
                              <IconButton
                                aria-label={`${item.name} 更多操作`}
                                onClick={(event) => {
                                  setProjectMenuAnchor(event.currentTarget);
                                  setProjectMenuKey(item.key);
                                }}
                                sx={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "999px",
                                  bgcolor:
                                    projectCanOpenBranch || projectCanOpenDeploy || projectPath
                                      ? tone.stopButtonBg
                                      : "transparent",
                                  color:
                                    projectCanOpenBranch || projectCanOpenDeploy || projectPath
                                      ? tone.stopButtonColor
                                      : tone.stopButtonDisabledColor,
                                  border: `1px solid ${tone.stopButtonBorder}`,
                                  "&:hover": {
                                    bgcolor: tone.stopButtonHoverBg,
                                  },
                                }}
                              >
                                <MoreIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>

                        {metaSegments.length > 0 ? (
                          <Stack
                            direction="row"
                            spacing={0.8}
                            flexWrap="wrap"
                            useFlexGap
                            sx={{
                              display: { xs: "flex", md: "none" },
                              gridColumn: "1 / -1",
                              color: tone.mobileMeta,
                            }}
                          >
                            {metaSegments.map((segment) => (
                              <Typography
                                key={`${item.key}-${segment}`}
                                variant="caption"
                                sx={{
                                  maxWidth: "100%",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontFamily:
                                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                  color: "inherit",
                                }}
                              >
                                {segment}
                              </Typography>
                            ))}
                          </Stack>
                        ) : null}
                      </Box>
                    );
                  })}
                </Box>
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
                      border: `1px solid ${tone.actionGroupBorder}`,
                      bgcolor: tone.outerBg,
                      color: tone.outerColor,
                      boxShadow: tone.outerShadow,
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
                    setDetailsProjectKey(projectMenuEntry.key);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <AppWindowIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="查看运行详情"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={
                    !projectMenuEntry ||
                    !branchProjectKeySet.has(projectMenuEntry.key)
                  }
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    onOpenProjectBranch(projectMenuEntry.key);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <WorkflowIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="打开分支页"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={
                    !projectMenuEntry ||
                    !deployProjectKeySet.has(projectMenuEntry.key)
                  }
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    onOpenProjectDeploy(projectMenuEntry.key);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <OpenExternalIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="打开部署页"
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={!projectMenuPath}
                  onClick={() =>
                    void handleCopyProjectValue(projectMenuPath, "path")
                  }
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    {copiedProjectAction === "path" ? (
                      <CheckIcon fontSize="small" />
                    ) : (
                      <CopyIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      copiedProjectAction === "path" ? "已复制路径" : "复制路径"
                    }
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
                <MenuItem
                  disabled={!projectMenuEntry?.command}
                  onClick={() =>
                    void handleCopyProjectValue(
                      projectMenuEntry?.command ?? "",
                      "command",
                    )
                  }
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    {copiedProjectAction === "command" ? (
                      <CheckIcon fontSize="small" />
                    ) : (
                      <TerminalIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      copiedProjectAction === "command"
                        ? "已复制命令"
                        : "复制启动命令"
                    }
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
              </Menu>

              <Drawer
                anchor="right"
                open={Boolean(detailsProjectEntry)}
                onClose={() => setDetailsProjectKey("")}
                ModalProps={{ keepMounted: true }}
                slotProps={{
                  paper: {
                    sx: {
                      width: { xs: "100%", sm: 430 },
                      maxWidth: "100%",
                      bgcolor: tone.outerBg,
                      color: tone.outerColor,
                      borderLeft: `1px solid ${tone.outerBorder}`,
                      boxShadow: tone.outerShadow,
                    },
                  },
                }}
              >
                {detailsProjectEntry ? (
                  <Box
                    sx={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      p: 1.5,
                      gap: 1.2,
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="flex-start"
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Stack spacing={0.7} minWidth={0}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.8}
                          minWidth={0}
                        >
                          <Box
                            sx={{
                              width: 9,
                              height: 9,
                              borderRadius: "50%",
                              flexShrink: 0,
                              bgcolor: buildStatusPalette(
                                detailsProjectEntry.statusKey,
                                mono,
                              ).dot,
                              boxShadow:
                                detailsProjectEntry.statusKey === "running"
                                  ? tone.runningDotHalo
                                  : "none",
                            }}
                          />
                          <Typography
                            variant="h6"
                            sx={{
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: "1rem",
                              fontWeight: 750,
                              color: tone.rowTitle,
                            }}
                          >
                            {detailsProjectEntry.name}
                          </Typography>
                        </Stack>
                        <Typography
                          variant="caption"
                          sx={{
                            color: tone.rowKey,
                            fontFamily:
                              '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                          }}
                        >
                          {detailsProjectEntry.key}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.45}>
                        <Tooltip
                          title={
                            detailsProjectPath
                              ? "打开项目目录"
                              : "未配置项目目录"
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
                        <Tooltip title="关闭">
                          <IconButton
                            aria-label="关闭运行详情"
                            onClick={() => setDetailsProjectKey("")}
                            sx={{
                              width: 30,
                              height: 30,
                              borderRadius: "999px",
                              bgcolor: tone.stopButtonBg,
                              color: tone.stopButtonColor,
                              border: `1px solid ${tone.stopButtonBorder}`,
                            }}
                          >
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>

                    <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
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
                    </Stack>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 0.85,
                        overflow: "auto",
                        pr: 0.2,
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
                            {section.title}
                          </Typography>
                          <Box sx={{ display: "grid", gap: 0.55 }}>
                            {section.rows.map(([label, value]) => (
                              <Box
                                key={`${section.title}-${label}`}
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
                                  sx={{
                                    color: tone.rowKey,
                                    fontWeight: 700,
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
                        </Box>
                      ))}

                      <Box
                        sx={{
                          border: `1px solid ${tone.searchWrapBorder}`,
                          borderRadius: "16px",
                          bgcolor: tone.searchWrapBg,
                          boxShadow: tone.searchWrapShadow,
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
                                  disabled={runtimeLog.loading}
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
                            <Tooltip title={runtimeLog.path ? "复制日志路径" : "日志尚未生成"}>
                              <span>
                                <IconButton
                                  aria-label="复制日志路径"
                                  disabled={!runtimeLog.path}
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

                        <Box
                          sx={{
                            minHeight: 144,
                            maxHeight: 260,
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
                          {runtimeLog.loading ? (
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
                    </Box>
                  </Box>
                ) : null}
              </Drawer>

              {!finderIsProjects && totalShortcutCount === 0 ? (
                <Box
                  sx={{
                    px: 1.2,
                    py: 1.1,
                    borderRadius: "16px",
                    border: `1px solid ${tone.emptyBorder}`,
                    backgroundColor: tone.emptyBg,
                    boxShadow: tone.emptyShadow,
                  }}
                >
                  <Typography variant="body2" sx={{ color: tone.emptyText }}>
                    还没有配置这类入口，检查 `navigation.toml` 或继续补充快捷入口。
                  </Typography>
                </Box>
              ) : null}

              {!finderIsProjects &&
              totalShortcutCount > 0 &&
              filteredShortcutEntries.length === 0 ? (
                <Box
                  sx={{
                    px: 1.2,
                    py: 1.1,
                    borderRadius: "16px",
                    border: `1px solid ${tone.emptyBorder}`,
                    backgroundColor: tone.emptyBg,
                    boxShadow: tone.emptyShadow,
                  }}
                >
                  <Typography variant="body2" sx={{ color: tone.emptyText }}>
                    当前没有匹配入口，试试切换分类或调整搜索词。
                  </Typography>
                </Box>
              ) : null}

              {!finderIsProjects && filteredShortcutEntries.length > 0 ? (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "repeat(2, minmax(0, 1fr))",
                      sm: "repeat(3, minmax(0, 1fr))",
                    },
                    gap: 0.72,
                    "@media (max-width: 390px)": {
                      gridTemplateColumns: "minmax(0, 1fr)",
                    },
                  }}
                >
                  {filteredShortcutEntries.map((item, index) => {
                    const detailLines = buildFinderEntryDetails(item);
                    const shortcutKey = buildFinderShortcutKey(item);
                    const shortcutConfirmed =
                      confirmedShortcutKey === shortcutKey;
                    const shortcutFavorite =
                      favoriteShortcutKeySet.has(shortcutKey);
                    const shortcutRecent = recentShortcutKeySet.has(shortcutKey);
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
                          aria-label={`打开 ${item.entry.name}`}
                          onClick={() =>
                            void handleOpenShortcut(item, shortcutKey)
                          }
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }
                            event.preventDefault();
                            void handleOpenShortcut(item, shortcutKey);
                          }}
                          sx={{
                            position: "relative",
                            display: "grid",
                            gridTemplateColumns: "auto minmax(0,1fr)",
                            gap: 0.72,
                            alignItems: "center",
                            width: "100%",
                            minWidth: 0,
                            minHeight: 56,
                            px: 0.82,
                            py: 0.66,
                            borderRadius: "16px",
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
                          }}
                        >
                          <Tooltip
                            title={shortcutFavorite ? "取消收藏" : "收藏入口"}
                          >
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              aria-label={
                                shortcutFavorite
                                  ? `取消收藏 ${item.entry.name}`
                                  : `收藏 ${item.entry.name}`
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleShortcutFavorite(item);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") {
                                  return;
                                }
                                event.preventDefault();
                                event.stopPropagation();
                                onToggleShortcutFavorite(item);
                              }}
                              sx={{
                                position: "absolute",
                                top: 7,
                                right: 7,
                                width: 24,
                                height: 24,
                                borderRadius: "999px",
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                bgcolor: shortcutFavorite
                                  ? tone.categoryChipActiveBg
                                  : tone.actionGroupBg,
                                color: shortcutFavorite
                                  ? tone.categoryChipActiveColor
                                  : tone.rowHint,
                                border: `1px solid ${
                                  shortcutFavorite
                                    ? tone.categoryChipActiveBorder
                                    : tone.actionGroupBorder
                                }`,
                                "&:hover": {
                                  bgcolor: shortcutFavorite
                                    ? tone.categoryChipActiveBg
                                    : tone.categoryChipHoverBg,
                                },
                              }}
                            >
                              <StarIcon sx={{ fontSize: 14 }} />
                            </Box>
                          </Tooltip>

                          <Box
                            sx={{
                              width: 32,
                              height: 32,
                              borderRadius: "12px",
                              display: "grid",
                              placeItems: "center",
                              border: `1px solid ${tone.actionGroupBorder}`,
                              backgroundColor: shortcutConfirmed
                                ? mono
                                  ? "rgba(150, 215, 170, 0.14)"
                                  : "rgba(76, 122, 85, 0.12)"
                                : tone.actionGroupBg,
                              color: shortcutConfirmed
                                ? mono
                                  ? "#bfe9cb"
                                  : "#416a4a"
                                : tone.rowMeta,
                              boxShadow: tone.actionGroupShadow,
                              fontSize: 15,
                              flexShrink: 0,
                              transition:
                                "background-color 160ms ease, color 160ms ease, border-color 160ms ease",
                            }}
                          >
                            {shortcutConfirmed ? (
                              <CheckIcon fontSize="inherit" />
                            ) : (
                              <FinderEntryIcon kind={item.entry.kind} />
                            )}
                          </Box>

                          <Typography
                            variant="body2"
                            sx={{
                              minWidth: 0,
                              pr: 2.8,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontWeight: 700,
                              lineHeight: 1.2,
                              color: tone.rowTitle,
                              fontSize: { xs: "0.84rem", sm: "0.88rem" },
                            }}
                          >
                            {shortcutRecent ? `${item.entry.name} · 最近` : item.entry.name}
                          </Typography>
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              ) : null}
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
                defaultBroadcastSignalId={
                  workflowReplay ? defaultSignalIdForReplay(workflowReplay) : undefined
                }
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
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
