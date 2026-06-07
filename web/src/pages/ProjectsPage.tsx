import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  ProjectDebugProfileSummary,
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
import { WorkflowLinkSummaryButton } from "../components/WorkflowLinkButton";
import {
  WorkflowLinksDialog,
  type WorkflowLinkListItem,
} from "../components/WorkflowLinksDialog";
import { WorkflowRulesConfigDialog } from "../components/WorkflowRulesConfigDialog";
import {
  WebActionsDialog,
  type WebActionsDialogContext,
} from "../components/WebActionsDialog";
import {
  defaultSignalIdForReplay,
  workflowProjectActionLabel,
  workflowReplayFromProjectRuntime,
  type WorkflowBroadcastRule,
  type WorkflowReceiveRule,
} from "../lib/workflowSignals";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";

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
  selectedDebugProfileKeys: Record<string, string>;
  branchProjectKeys: string[];
  deployProjectKeys: string[];
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
  onOpenProjectBranch: (projectKey: string) => void;
  onOpenProjectDeploy: (projectKey: string) => void;
  onRefresh: () => void;
  onOpenFinderEntry: (entry: FinderEntry) => Promise<boolean> | boolean;
  onStartRuntime: (
    projectKey: string,
    debugProfileKey?: string,
    envOverrides?: Record<string, string>,
  ) => void;
  onStopRuntime: (projectKey: string) => void;
  onRunBuild: (projectKey: string) => void;
  onStopBuild: (projectKey: string) => void;
  onOpenBuildOutput: (projectKey: string) => void;
  onFocusRuntime: (projectKey: string) => void;
  onOpenProjectDirectory: (projectKey: string) => void;
};

const SHORTCUT_CONFIRM_MS = 1100;
const RUNTIME_LOG_MAX_LINES = 120;
const DEFAULT_RUNTIME_PROFILE_VALUE = "__default__";
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
      runningDotHalo: "0 0 0 4px rgba(95,128,104,0.16)",
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
    runningDotHalo: "0 0 0 4px rgba(63,107,79,0.14)",
    mobileMeta: "rgba(83,92,106,0.7)",
  };
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
  addDetail("浏览器", entry.browser);
  addDetail("Profile", entry.browserProfile);
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
  selectedDebugProfileKeys,
  branchProjectKeys,
  deployProjectKeys,
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
  const [shortcutMenuAnchor, setShortcutMenuAnchor] =
    useState<HTMLElement | null>(null);
  const [shortcutMenuKey, setShortcutMenuKey] = useState("");
  const [webActionsContext, setWebActionsContext] =
    useState<WebActionsDialogContext | null>(null);
  const [runtimeOptionsProjectKey, setRuntimeOptionsProjectKey] = useState("");
  const [runtimeOptionsProfileKey, setRuntimeOptionsProfileKey] = useState("");
  const [runtimeOptionsEnvText, setRuntimeOptionsEnvText] = useState("");
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
  const shortcutMenuItem =
    shortcutEntries.find((item) => buildFinderShortcutKey(item) === shortcutMenuKey) ??
    null;
  const runtimeOptionsEntry =
    runtimeEntries.find((item) => item.key === runtimeOptionsProjectKey) ?? null;
  const detailsProjectEntry =
    runtimeEntries.find((item) => item.key === detailsProjectKey) ?? null;
  const workflowProjectEntry =
    runtimeEntries.find((item) => item.key === workflowProjectKey) ?? null;
  const workflowReplay = workflowProjectEntry
    ? workflowReplayFromProjectRuntime(workflowProjectEntry, workflowAction)
    : null;
  const projectMenuFavorite = projectMenuEntry
    ? favoriteProjectKeySet.has(projectMenuEntry.key)
    : false;
  const shortcutMenuFavorite = shortcutMenuItem
    ? favoriteShortcutKeySet.has(buildFinderShortcutKey(shortcutMenuItem))
    : false;
  const runtimeOptionsProfiles = runtimeOptionsEntry?.debugProfiles ?? [];
  const runtimeOptionsSelectedProfile =
    findDebugProfile(runtimeOptionsProfiles, runtimeOptionsProfileKey) ?? null;
  const runtimeOptionsParseResult = useMemo(
    () => parseRuntimeEnvText(runtimeOptionsEnvText),
    [runtimeOptionsEnvText],
  );
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

  function closeShortcutMenu() {
    setShortcutMenuAnchor(null);
    setShortcutMenuKey("");
  }

  function openProjectWebActions(item: ProjectRuntimeEntry) {
    const url = item.focusUrl?.trim();
    if (!url) {
      return;
    }
    setWebActionsContext({
      title: item.name,
      scope: `project:${item.key}`,
      url,
    });
  }

  function openShortcutWebActions(item: FinderShortcutItem) {
    const url = item.entry.url?.trim();
    if (!url) {
      return;
    }
    setWebActionsContext({
      title: item.entry.name,
      scope: webActionScopeForShortcut(item),
      url,
    });
  }

  function openRuntimeOptionsDialog(item: ProjectRuntimeEntry) {
    const profileKey = projectSelectedProfileKey(item, selectedDebugProfileKeys);
    const profile = findDebugProfile(item.debugProfiles ?? [], profileKey);
    setRuntimeOptionsProjectKey(item.key);
    setRuntimeOptionsProfileKey(profileKey);
    setRuntimeOptionsEnvText(formatRuntimeEnvText(profile?.env));
  }

  function closeRuntimeOptionsDialog() {
    setRuntimeOptionsProjectKey("");
    setRuntimeOptionsProfileKey("");
    setRuntimeOptionsEnvText("");
  }

  function handleRuntimeOptionsProfileChange(profileKey: string) {
    const nextProfileKey =
      profileKey === DEFAULT_RUNTIME_PROFILE_VALUE ? "" : profileKey;
    const profile = findDebugProfile(runtimeOptionsProfiles, nextProfileKey);
    setRuntimeOptionsProfileKey(nextProfileKey);
    setRuntimeOptionsEnvText(formatRuntimeEnvText(profile?.env));
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
    closeRuntimeOptionsDialog();
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

  function openProjectWorkflowDialog(item: ProjectRuntimeEntry) {
    setWorkflowProjectKey(item.key);
    setWorkflowAction(defaultProjectWorkflowAction(item));
    setWorkflowOpen(true);
  }

  return (
    <Box
      className="workspace"
      sx={{
        minHeight: "calc(100dvh - var(--window-drag-height) - 20px)",
        "@media (max-width: 900px)": {
          minHeight: "calc(100dvh - var(--window-drag-height) - 71px)",
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
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
        <Box
          sx={{
            position: "relative",
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            p: 1.5,
          }}
        >
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
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
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
                flex: "1 1 auto",
                minHeight: 0,
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
                    const runtimeRunning = item.canStop;
                    const runtimeAvailable = item.canStart || item.canStop;
                    const runtimeTooltip = runtimeRunning
                      ? "停止项目"
                      : "启动项目";
                    const runtimeAriaLabel = runtimeRunning
                      ? `停止 ${item.name}`
                      : `启动 ${item.name}`;
                    const statusPalette = buildStatusPalette(
                      item.statusKey,
                      mono,
                    );
                    const debugProfiles = item.debugProfiles ?? [];
                    const projectFavorite = favoriteProjectKeySet.has(item.key);
                    const projectRecent = recentProjectKeySet.has(item.key);
                    const selectedDebugProfileKey = projectSelectedProfileKey(
                      item,
                      selectedDebugProfileKeys,
                    );
                    const selectedDebugProfile =
                      debugProfiles.find((profile) => profile.key === selectedDebugProfileKey) ??
                      null;
                    const runtimeStartTooltip =
                      !runtimeRunning && selectedDebugProfile
                        ? `启动项目 · ${selectedDebugProfile.label}`
                        : runtimeTooltip;
                    const focusableRuntimeRow =
                      runtimeRunning && item.canFocusRuntime;
                    const runtimeFocusGlow = mono
                      ? "rgba(117, 151, 255, 0.2)"
                      : "rgba(77, 123, 214, 0.16)";
                    return (
                      <Box
                        key={item.key}
                        title={focusableRuntimeRow ? "点击唤起项目" : undefined}
                        onClick={(event) => {
                          if (
                            !focusableRuntimeRow ||
                            isInteractiveClickTarget(event.target)
                          ) {
                            return;
                          }
                          onFocusRuntime(item.key);
                        }}
                        sx={{
                          position: "relative",
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "minmax(0,1fr)",
                            md: "minmax(0, 1fr) max-content",
                          },
                          columnGap: { xs: 1, md: 1.1 },
                          rowGap: 0.75,
                          alignItems: "center",
                          px: 1.25,
                          py: { xs: 1.05, md: 0.92 },
                          pr: { xs: 15.4, md: 1.25 },
                          minHeight: { xs: 64, md: 54 },
                          borderRadius: "18px",
                          border: "1px solid",
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
                          backdropFilter: "blur(16px)",
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
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.9}
                          minWidth={0}
                          sx={{
                            pr: { xs: 0.75, md: 0 },
                            maxWidth: "100%",
                          }}
                        >
                          <Box
                            aria-hidden="true"
                            sx={{
                              width: 28,
                              height: 28,
                              display: "grid",
                              placeItems: "center",
                              flexShrink: 0,
                              borderRadius: "10px",
                              border: "1px solid",
                              borderColor:
                                item.statusKey === "running"
                                  ? statusPalette.pillBorder
                                  : tone.actionGroupBorder,
                              bgcolor:
                                item.statusKey === "running"
                                  ? statusPalette.pillBg
                                  : tone.actionGroupBg,
                              boxShadow: tone.actionGroupShadow,
                            }}
                          >
                            <Box
                              sx={{
                                width: 9,
                                height: 9,
                                borderRadius: "50%",
                                bgcolor: statusPalette.dot,
                                boxShadow:
                                  item.statusKey === "running"
                                    ? tone.runningDotHalo
                                    : "none",
                              }}
                            />
                          </Box>
                          <Box minWidth={0}>
                            <Stack
                              direction="row"
                              alignItems="center"
                              spacing={0.55}
                              minWidth={0}
                            >
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{
                                  minWidth: 0,
                                  fontWeight: 760,
                                  lineHeight: 1.18,
                                  color: tone.rowTitle,
                                }}
                              >
                                {item.name}
                              </Typography>
                              {projectFavorite ? (
                                <StarIcon
                                  sx={{
                                    width: 13,
                                    height: 13,
                                    flexShrink: 0,
                                    color: tone.categoryChipActiveColor,
                                    opacity: 0.82,
                                  }}
                                />
                              ) : null}
                              {projectRecent ? (
                                <Chip
                                  size="small"
                                  label="最近"
                                  sx={{
                                    height: 18,
                                    flexShrink: 0,
                                    borderRadius: "6px",
                                    border: `1px solid ${tone.categoryChipBorder}`,
                                    bgcolor: tone.categoryChipBg,
                                    color: tone.categoryChipColor,
                                    fontSize: "0.62rem",
                                    fontWeight: 700,
                                    "& .MuiChip-label": {
                                      px: 0.7,
                                      lineHeight: "18px",
                                    },
                                  }}
                                />
                              ) : null}
                            </Stack>
                            <Typography
                              variant="caption"
                              noWrap
                              sx={{
                                display: "block",
                                mt: 0.28,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                letterSpacing: 0,
                                color: tone.rowKey,
                              }}
                            >
                              {item.key}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack
                          direction="row"
                          spacing={0.45}
                          justifyContent={{ xs: "flex-start", md: "flex-end" }}
                          data-project-row-action="true"
                          sx={{
                            gridColumn: { md: 2 },
                            width: "fit-content",
                            minWidth: "max-content",
                            flexShrink: 0,
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
                          <Tooltip title={runtimeStartTooltip}>
                            <span>
                              <IconButton
                                aria-label={runtimeAriaLabel}
                                disabled={!runtimeAvailable}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (runtimeRunning) {
                                    onStopRuntime(item.key);
                                    return;
                                  }
                                  onStartRuntime(
                                    item.key,
                                    selectedDebugProfileKey || undefined,
                                  );
                                }}
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
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenProjectDirectory(item.key);
                                }}
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
                          <Tooltip title="更多操作">
                            <span>
                              <IconButton
                                aria-label={`${item.name} 更多操作`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setProjectMenuAnchor(event.currentTarget);
                                  setProjectMenuKey(item.key);
                                }}
                                sx={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "999px",
                                  bgcolor: tone.stopButtonBg,
                                  color: tone.stopButtonColor,
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
                  disabled={!projectMenuEntry?.command}
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    openRuntimeOptionsDialog(projectMenuEntry);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <PlayIcon fontSize="small" />
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
                  disabled={!projectMenuEntry?.focusUrl}
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    openProjectWebActions(projectMenuEntry);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <WebsiteIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="网页动作"
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
                    setDetailsProjectKey(projectMenuEntry.key);
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <AppWindowIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="运行日志"
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
                    primary={projectMenuFavorite ? "取消收藏" : "收藏项目"}
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
                <MenuItem
                  disabled={
                    !projectMenuEntry ||
                    (!projectMenuEntry.canStopBuild && !projectMenuEntry.canBuild)
                  }
                  onClick={() => {
                    if (!projectMenuEntry) {
                      return;
                    }
                    if (projectMenuEntry.canStopBuild) {
                      onStopBuild(projectMenuEntry.key);
                    } else {
                      onRunBuild(projectMenuEntry.key);
                    }
                    closeProjectMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    {projectMenuEntry?.canStopBuild ? (
                      <StopIcon fontSize="small" />
                    ) : (
                      <PackageIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={projectMenuEntry?.canStopBuild ? "中止打包" : "执行打包"}
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
              </Menu>

              <Dialog
                open={Boolean(runtimeOptionsEntry)}
                onClose={closeRuntimeOptionsDialog}
                fullWidth
                maxWidth="sm"
                PaperProps={{
                  sx: {
                    bgcolor: "var(--panel-strong)",
                    color: tone.outerColor,
                    borderRadius: "18px",
                    border: `1px solid ${tone.outerBorder}`,
                    boxShadow: tone.outerShadow,
                    overflow: "hidden",
                  },
                }}
                slotProps={{
                  backdrop: {
                    sx: {
                      bgcolor: mono
                        ? "rgba(3, 8, 15, 0.56)"
                        : "rgba(220, 230, 242, 0.42)",
                      backdropFilter: "blur(2px)",
                    },
                  },
                }}
              >
                {runtimeOptionsEntry ? (
                  <>
                    <DialogTitle
                      sx={{
                        px: 2.2,
                        pt: 1.8,
                        pb: 0.8,
                        background: mono
                          ? "linear-gradient(180deg, rgba(255,255,255,0.018), transparent)"
                          : "linear-gradient(180deg, rgba(255,255,255,0.46), transparent)",
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={1}
                        >
                          <Typography
                            variant="h6"
                            sx={{
                              fontSize: "1.02rem",
                              fontWeight: 850,
                              lineHeight: 1.2,
                            }}
                          >
                            项目配置
                          </Typography>
                          <Chip
                            size="small"
                            label={runtimeOptionsEntry.key}
                            variant="outlined"
                            sx={{
                              height: 24,
                              borderColor: tone.actionGroupBorder,
                              color: tone.rowHint,
                              fontWeight: 700,
                            }}
                          />
                        </Stack>
                        <Typography
                          variant="body2"
                          sx={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: tone.rowMeta,
                            fontWeight: 750,
                            lineHeight: 1.2,
                          }}
                        >
                          {runtimeOptionsEntry.name}
                        </Typography>
                      </Stack>
                    </DialogTitle>
                    <DialogContent sx={{ px: 2.2, pt: 0.85, pb: 1.5 }}>
                      <Stack spacing={1.2}>
                        <Box
                          sx={{
                            p: 1.2,
                            borderRadius: "14px",
                            border: `1px solid ${tone.actionGroupBorder}`,
                            bgcolor: mono
                              ? "rgba(255,255,255,0.018)"
                              : "rgba(255,255,255,0.58)",
                            boxShadow: mono
                              ? "inset 0 1px 0 rgba(255,255,255,0.012)"
                              : "inset 0 1px 0 rgba(255,255,255,0.58)",
                          }}
                        >
                          <Stack spacing={0.85}>
                            <Typography
                              variant="caption"
                              sx={{
                                color: tone.rowHint,
                                fontWeight: 850,
                                letterSpacing: "0.04em",
                              }}
                            >
                              运行入口
                            </Typography>
                            {[
                              {
                                icon: <FolderIcon fontSize="small" />,
                                label: "工作目录",
                                value:
                                  runtimeOptionsEntry.cwd ||
                                  runtimeOptionsEntry.repoPath ||
                                  "未配置目录",
                              },
                              {
                                icon: <TerminalIcon fontSize="small" />,
                                label: "启动命令",
                                value: runtimeOptionsEntry.command || "未配置命令",
                              },
                            ].map((row) => (
                              <Stack
                                key={row.label}
                                direction="row"
                                spacing={0.8}
                                alignItems="flex-start"
                                minWidth={0}
                              >
                                <Box
                                  sx={{
                                    display: "grid",
                                    placeItems: "center",
                                    width: 22,
                                    height: 22,
                                    mt: 0.1,
                                    color: tone.rowHint,
                                    flexShrink: 0,
                                  }}
                                >
                                  {row.icon}
                                </Box>
                                <Box minWidth={0}>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      display: "block",
                                      color: tone.rowMeta,
                                      fontWeight: 750,
                                      lineHeight: 1.15,
                                      mb: 0.18,
                                    }}
                                  >
                                    {row.label}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      display: "block",
                                      color: tone.rowHint,
                                      fontFamily:
                                        '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                      lineHeight: 1.45,
                                      overflowWrap: "anywhere",
                                    }}
                                  >
                                    {row.value}
                                  </Typography>
                                </Box>
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                        <Box
                          sx={{
                            p: 1.2,
                            borderRadius: "14px",
                            border: `1px solid ${tone.actionGroupBorder}`,
                            bgcolor: mono
                              ? "rgba(255,255,255,0.018)"
                              : "rgba(255,255,255,0.58)",
                          }}
                        >
                          <Stack spacing={1.05}>
                            <Typography
                              variant="caption"
                              sx={{
                                color: tone.rowHint,
                                fontWeight: 850,
                                letterSpacing: "0.04em",
                              }}
                            >
                              启动选项
                            </Typography>
                            <Stack spacing={0.55}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: tone.rowMeta,
                                  fontWeight: 750,
                                }}
                              >
                                调试档案
                              </Typography>
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
                                inputProps={{ "aria-label": "调试档案" }}
                                sx={{
                                  "& .MuiSelect-select": {
                                    minHeight: "unset",
                                    py: 1.05,
                                    fontSize: "0.92rem",
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
                            </Stack>
                            <Stack spacing={0.55}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: tone.rowMeta,
                                  fontWeight: 750,
                                }}
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
                                minRows={6}
                                placeholder={"app_env=uat3-vke\nIMOP_PROXY_ENV=uat3"}
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
                                    fontSize: "0.8rem",
                                    lineHeight: 1.45,
                                  },
                                }}
                              />
                            </Stack>
                            {runtimeOptionsSelectedProfile?.browser ||
                            runtimeOptionsSelectedProfile?.browserProfile ? (
                              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
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
                              </Stack>
                            ) : null}
                          </Stack>
                        </Box>
                      </Stack>
                    </DialogContent>
                    <DialogActions sx={{ px: 2.2, pb: 1.8, pt: 0.4 }}>
                      <Button
                        color="inherit"
                        onClick={() => setRuntimeOptionsEnvText("")}
                        disabled={!runtimeOptionsEnvText.trim()}
                      >
                        清空变量
                      </Button>
                      <Box sx={{ flex: 1 }} />
                      <Button color="inherit" onClick={closeRuntimeOptionsDialog}>
                        取消
                      </Button>
                      <Button
                        variant="contained"
                        disabled={
                          !runtimeOptionsEntry.canStart ||
                          Boolean(runtimeOptionsParseResult.error)
                        }
                        onClick={handleRuntimeOptionsStart}
                      >
                        使用此配置启动
                      </Button>
                    </DialogActions>
                  </>
                ) : null}
              </Dialog>

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
                          <Tooltip title="更多操作">
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              aria-label={`${item.entry.name} 更多操作`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setShortcutMenuAnchor(event.currentTarget);
                                setShortcutMenuKey(shortcutKey);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") {
                                  return;
                                }
                                event.preventDefault();
                                event.stopPropagation();
                                setShortcutMenuAnchor(event.currentTarget);
                                setShortcutMenuKey(shortcutKey);
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
                                bgcolor: tone.actionGroupBg,
                                color: shortcutFavorite
                                  ? tone.categoryChipActiveColor
                                  : tone.rowHint,
                                border: `1px solid ${tone.actionGroupBorder}`,
                                "&:hover": {
                                  bgcolor: tone.categoryChipHoverBg,
                                },
                              }}
                            >
                              <MoreIcon sx={{ fontSize: 14 }} />
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
                    <OpenExternalIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="打开入口"
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
                    openShortcutWebActions(shortcutMenuItem);
                    closeShortcutMenu();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <WebsiteIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="网页动作"
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
                  <ListItemIcon sx={{ minWidth: 30, color: "inherit" }}>
                    <StarIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={shortcutMenuFavorite ? "取消收藏" : "收藏入口"}
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: 650,
                    }}
                  />
                </MenuItem>
              </Menu>
              <WebActionsDialog
                open={Boolean(webActionsContext)}
                context={webActionsContext}
                onClose={() => setWebActionsContext(null)}
              />
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
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
