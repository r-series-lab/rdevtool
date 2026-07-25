import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Pagination,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  BUILD_STATUS_SYNC_MAX_FAILURES,
  activityRequiresAttention,
  activityExecutionKey,
  isBuildActivityKind,
  latestActivityExecutionStatus,
  type ActivityEntry,
  type ActivityKind,
  type ActivityOrigin,
  type ActivityStatus,
} from "../lib/activityCenter";
import {
  ActivityIcon,
  AppWindowIcon,
  CheckIcon,
  ClockIcon,
  CollapseIcon,
  ClearIcon,
  ExpandIcon,
  OpenExternalIcon,
  PackageIcon,
  PanelSideIcon,
  PlayIcon,
  RefreshIcon,
  ReplayIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon,
  TrashIcon,
  WorkflowIcon,
} from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";
import type { Theme } from "@mui/material/styles";

type ActivityFilter =
  | "attention"
  | "all"
  | "success"
  | "failed";
type ActivityOriginFilter = "all" | ActivityOrigin;

type ActivityQueueGroup = {
  id: string;
  label: string;
  latest: ActivityEntry;
  failedItems: ActivityEntry[];
  resourceItem: ActivityEntry | null;
  targetItem: ActivityEntry | null;
  actionItem: ActivityEntry | null;
  detailItem: ActivityEntry | null;
  failedCount: number;
  actionCount: number;
  total: number;
};

type ActivityChainGroup = {
  id: string;
  items: ActivityEntry[];
  primary: ActivityEntry;
  latest: ActivityEntry;
  status: ActivityStatus;
  failedItems: ActivityEntry[];
  resourceItem: ActivityEntry | null;
  targetItem: ActivityEntry | null;
  actionItem: ActivityEntry | null;
  detailItem: ActivityEntry | null;
};

type ActivityExecutionGroup = {
  id: string;
  items: ActivityEntry[];
  title: string;
  latest: ActivityEntry;
  status: ActivityStatus;
  failedItems: ActivityEntry[];
  resourceItem: ActivityEntry | null;
  targetItem: ActivityEntry | null;
  actionItem: ActivityEntry | null;
  detailItem: ActivityEntry | null;
  executionCount: number;
};

type ActivityDisplayUnit =
  | { type: "item"; item: ActivityEntry }
  | { type: "chain"; group: ActivityChainGroup }
  | { type: "execution"; group: ActivityExecutionGroup };

type ActivityCenterProps = {
  open: boolean;
  variant?: "drawer" | "panel";
  items: ActivityEntry[];
  onClose: () => void;
  onClear: () => void;
  onOpenEntry: (entry: ActivityEntry) => void;
  onOpenResource: (entry: ActivityEntry) => void;
  onRunAction: (entry: ActivityEntry) => Promise<void> | void;
  onRefresh: (options?: { force?: boolean }) => Promise<void> | void;
  onAcknowledgeEntry: (entry: ActivityEntry) => void;
  onAcknowledgeEntries: (entries: ActivityEntry[]) => void;
};

const ACTIVITY_REFRESH_INTERVAL_MS = 10000;
const ACTIVITY_LIST_PAGE_SIZE = 5;
const ACTIVITY_EXECUTION_PREVIEW_LIMIT = 3;

const KIND_LABELS: Record<ActivityKind, string> = {
  runtime: "运行",
  proxy: "本地代理",
  link: "联调链路",
  build: "构建任务",
  branch: "Git工作流",
  deploy: "构建任务",
  shortcut: "资源入口",
  config: "配置变更",
};

const ORIGIN_LABELS: Record<ActivityOrigin, string> = {
  app: "App",
  cli: "CLI",
  tray: "托盘",
};

const STATUS_LABELS: Record<ActivityStatus, string> = {
  running: "进行中",
  success: "完成",
  failed: "失败",
  info: "记录",
};

const DIAGNOSTIC_STATUS_LABELS: Record<string, string> = {
  success: "成功",
  ready: "可执行",
  blocked: "已阻止",
  checked: "已检查",
  started: "已启动",
  stopped: "已停止",
  skipped: "已跳过",
  failed: "失败",
};

const activityActionIconSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    width: 24,
    height: 24,
    borderRadius: "6px",
    border: dark ? "1px solid rgba(143,184,234,0.14)" : "1px solid rgba(71,96,123,0.14)",
    bgcolor: dark ? "rgba(13,18,25,0.56)" : "rgba(255,255,255,0.82)",
    color: "color-mix(in srgb, var(--text) 82%, var(--accent))",
    flexShrink: 0,
    boxShadow: dark
      ? "inset 0 1px 0 rgba(255,255,255,0.035), 0 4px 12px rgba(0,0,0,0.1)"
      : "inset 0 1px 0 rgba(255,255,255,0.8), 0 4px 12px rgba(38,61,85,0.07)",
    "& .MuiSvgIcon-root": {
      fontSize: "0.9rem",
    },
    "&:hover": {
      bgcolor: dark ? "rgba(20,29,40,0.72)" : "#ffffff",
      borderColor: "var(--accent-border)",
      color: "var(--accent-hover)",
    },
  };
};

const activityHeaderIconSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    width: 32,
    height: 32,
    borderRadius: "9px",
    border: dark ? "1px solid rgba(143,184,234,0.14)" : "1px solid rgba(71,96,123,0.14)",
    bgcolor: dark ? "rgba(13,18,25,0.5)" : "rgba(255,255,255,0.76)",
    color: "color-mix(in srgb, var(--text) 82%, var(--muted))",
    flexShrink: 0,
    boxShadow: dark
      ? "inset 0 1px 0 rgba(255,255,255,0.03)"
      : "inset 0 1px 0 rgba(255,255,255,0.82), 0 4px 12px rgba(38,61,85,0.05)",
    "& .MuiSvgIcon-root": {
      fontSize: "1rem",
    },
    "&:hover": {
      color: "var(--text)",
      bgcolor: dark ? "rgba(255,255,255,0.07)" : "#ffffff",
      borderColor: dark ? "rgba(143,184,234,0.2)" : "rgba(84,111,140,0.22)",
    },
    "&.Mui-disabled": {
      opacity: 0.34,
    },
  };
};

const activityChipSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    height: 20,
    borderRadius: "6px",
    borderColor: dark ? "rgba(143,184,234,0.12)" : "rgba(52,76,96,0.12)",
    bgcolor: dark ? "rgba(13,18,25,0.42)" : "rgba(255,255,255,0.72)",
    "& .MuiChip-label": {
      px: 0.58,
      fontSize: "0.61rem",
      fontWeight: 760,
    },
  };
};

const activityRecordCardSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    border: "1px solid",
    borderRadius: "8px",
    px: 1.05,
    py: 1,
    bgcolor: dark ? "rgba(11,16,22,0.66)" : "rgba(255,255,255,0.86)",
    background: dark
      ? "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.008) 68%), rgba(11,16,22,0.64)"
      : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,252,254,0.88))",
    borderColor: dark ? "rgba(143,184,234,0.13)" : "rgba(71,96,123,0.14)",
    boxShadow: dark
      ? "inset 0 1px 0 rgba(255,255,255,0.045), 0 8px 22px rgba(0,0,0,0.14)"
      : "inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 24px rgba(34,62,88,0.07)",
    transition: "transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
    "&:hover": {
      transform: "translateY(-1px)",
      borderColor: dark ? "rgba(143,184,234,0.2)" : "rgba(76,111,145,0.24)",
      boxShadow: dark
        ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 28px rgba(0,0,0,0.18)"
        : "inset 0 1px 0 rgba(255,255,255,0.95), 0 12px 30px rgba(34,62,88,0.1)",
    },
  };
};

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ").slice(0, 16);
  }
  const pad = (next: number) => String(next).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusColor(status: ActivityStatus) {
  if (status === "failed") {
    return "var(--activity-danger)";
  }
  if (status === "running") {
    return "var(--activity-running)";
  }
  if (status === "success") {
    return "var(--activity-success)";
  }
  return "var(--muted)";
}

function statusTint(status: ActivityStatus) {
  if (status === "failed") {
    return "var(--activity-danger-soft)";
  }
  if (status === "running") {
    return "var(--activity-running-soft)";
  }
  if (status === "success") {
    return "var(--activity-success-soft)";
  }
  return "var(--glass)";
}

function activityStatusLabel(item: ActivityEntry) {
  if (item.status === "running" && item.action) {
    return "待处理";
  }
  if (item.status === "failed" && item.summary.startsWith("状态同步失败")) {
    if ((item.syncFailureCount ?? 0) >= BUILD_STATUS_SYNC_MAX_FAILURES) {
      return "停止重试";
    }
    return "同步失败";
  }
  return STATUS_LABELS[item.status];
}

function ActivityStatusPill({ item }: { item: ActivityEntry }) {
  const statusLabel = item.acknowledgedAt ? "已确认" : activityStatusLabel(item);
  const statusTextColor = item.acknowledgedAt ? "var(--muted)" : statusColor(item.status);
  const statusBg = item.acknowledgedAt ? "var(--glass)" : statusTint(item.status);

  return (
    <Box
      className="activity-status-pills"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.28,
        flex: "0 0 auto",
        whiteSpace: "nowrap",
      }}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          height: 20,
          px: 0.58,
          border: "1px solid var(--line-soft)",
          borderRadius: "8px",
          bgcolor: "color-mix(in srgb, var(--glass) 82%, transparent)",
          color: "var(--muted)",
          fontSize: "0.61rem",
          fontWeight: 720,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {KIND_LABELS[item.kind]}
      </Box>
      {item.origin ? (
        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            height: 20,
            px: 0.54,
            border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--line-soft))",
            borderRadius: "8px",
            bgcolor: "color-mix(in srgb, var(--accent) 7%, var(--glass))",
            color: "color-mix(in srgb, var(--text) 74%, var(--accent))",
            fontSize: "0.59rem",
            fontWeight: 760,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {ORIGIN_LABELS[item.origin]}
        </Box>
      ) : null}
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          height: 20,
          px: 0.62,
          border: "1px solid var(--line-soft)",
          borderRadius: "8px",
          color: statusTextColor,
          bgcolor: statusBg,
          fontSize: "0.61rem",
          fontWeight: 780,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {statusLabel}
      </Box>
    </Box>
  );
}

function ActivityTitleCluster({
  item,
  extraTags,
  meta,
}: {
  item: ActivityEntry;
  extraTags?: ReactNode;
  meta?: string;
}) {
  return (
    <Stack
      className="activity-title-cluster"
      spacing={0.42}
      alignItems="stretch"
      minWidth={0}
      flex={1}
    >
      <Stack
        className="activity-title-line"
        direction="row"
        spacing={0.7}
        alignItems="center"
        justifyContent="space-between"
        minWidth={0}
      >
        <Typography
          variant="body2"
          noWrap
          title={item.title}
          sx={{
            minWidth: 0,
            flex: "1 1 auto",
            color: "var(--text)",
            fontSize: "0.84rem",
            lineHeight: 1.35,
            letterSpacing: 0,
            fontWeight: 800,
          }}
        >
          {item.title}
        </Typography>
        {meta ? (
          <Typography
            className="activity-card-meta"
            variant="caption"
            noWrap
            title={meta}
            sx={{ color: "color-mix(in srgb, var(--muted) 88%, var(--text))" }}
          >
            {meta}
          </Typography>
        ) : null}
      </Stack>
      <Stack
        className="activity-title-details"
        direction="row"
        alignItems="center"
        spacing={0.45}
        minWidth={0}
      >
        <Stack
          className="activity-title-tags"
          direction="row"
          spacing={0.24}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <ActivityStatusPill item={item} />
          {extraTags}
        </Stack>
      </Stack>
    </Stack>
  );
}

function ActivityKindGlyph({ item }: { item: ActivityEntry }) {
  const icon = item.kind === "branch" || item.kind === "link"
    ? <WorkflowIcon fontSize="small" />
    : isBuildActivityKind(item.kind)
      ? <PackageIcon fontSize="small" />
      : item.kind === "runtime"
        ? <PlayIcon fontSize="small" />
        : item.kind === "proxy"
          ? <TerminalIcon fontSize="small" />
        : item.kind === "config"
          ? <SettingsIcon fontSize="small" />
        : <AppWindowIcon fontSize="small" />;
  const color = item.acknowledgedAt ? "var(--muted)" : statusColor(item.status);
  const tint = item.acknowledgedAt ? "var(--glass)" : statusTint(item.status);

  return (
    <Box className="activity-kind-glyph" aria-hidden>
      <Box
        className="activity-kind-dot"
        sx={{
          bgcolor: color,
          boxShadow: item.status === "running" ? `0 0 0 4px ${tint}` : "none",
        }}
      />
      <Box
        className="activity-kind-avatar"
        sx={{
          color,
          bgcolor: tint,
          borderColor: `color-mix(in srgb, ${color} 18%, transparent)`,
        }}
      >
        {icon}
      </Box>
    </Box>
  );
}

function displayActivitySummary(item: ActivityEntry) {
  if (
    item.kind === "runtime" &&
    item.status === "success" &&
    item.title === "启动 dev 服务" &&
    item.summary.startsWith("运行中")
  ) {
    return "已启动 · dev 服务启动成功";
  }
  if (
    item.kind === "branch" &&
    item.status === "success" &&
    /^成功\s+\d+(?:\s*\/\s*跳过\s+\d+)?$/.test(item.summary.trim()) &&
    item.detail
  ) {
    return "";
  }
  return item.summary;
}

function ActivityParameterSummary({ item }: { item: ActivityEntry }) {
  const parameters = item.parameters ?? [];
  if (parameters.length === 0) {
    return null;
  }
  return (
    <Box className="activity-parameter-summary" aria-label="构建参数">
      <Typography component="span" className="activity-parameter-heading">
        参数
      </Typography>
      {parameters.map((parameter) => (
        <Typography
          component="span"
          className="activity-parameter-item"
          key={parameter.key}
          title={`${parameter.label}: ${parameter.value}`}
        >
          <Box component="span" className="activity-parameter-label">
            {parameter.label}
          </Box>
          <Box
            component="span"
            className={`activity-parameter-value${parameter.masked ? " is-masked" : ""}`}
          >
            {parameter.value}
          </Box>
        </Typography>
      ))}
    </Box>
  );
}

function activityFailureReason(item: ActivityEntry) {
  if (item.status !== "failed") {
    return "";
  }
  const detail = item.detail?.trim() ?? "";
  return detail && detail !== item.summary.trim() ? detail : "";
}

function ActivityTimelineDetail({ item }: { item: ActivityEntry }) {
  if (!item.detail) {
    return null;
  }
  return (
    <Box className={`activity-timeline-detail${item.status === "failed" ? " is-failure" : ""}`}>
      {item.status === "failed" ? (
        <Box component="span" className="activity-failure-reason-label">
          失败原因
        </Box>
      ) : null}
      {item.detail}
    </Box>
  );
}

function isBuildSyncFailure(item: ActivityEntry) {
  return (
    isBuildActivityKind(item.kind) &&
    item.status === "failed" &&
    item.summary.startsWith("状态同步失败")
  );
}

function isBuildSyncNotice(item: ActivityEntry) {
  return (
    isBuildActivityKind(item.kind) &&
    (item.summary.startsWith("状态同步失败") ||
      item.summary === "同步 Jenkins 状态中…")
  );
}

function isVisibleRunningActivity(item: ActivityEntry) {
  return item.status === "running" && !isBuildSyncNotice(item);
}

function isFailureActivity(item: ActivityEntry) {
  return item.status === "failed" && !isBuildSyncNotice(item);
}

function isUnhandledFailure(item: ActivityEntry) {
  return isFailureActivity(item) && !item.acknowledgedAt;
}

function hasActivityDiagnostics(item: ActivityEntry) {
  return Boolean(
    item.detail?.trim() || item.diagnostics?.length || item.warnings?.length,
  );
}

function recoveryConfirmation(entry: ActivityEntry | null) {
  const action = entry?.action;
  if (action?.kind === "branchReplay") {
    return {
      title: "确认重试 Git 操作？",
      content: "将按失败项目的原参数重新执行 Git 操作，并重新进行项目、工作区和分支校验；校验未通过时不会继续。",
    };
  }
  if (action?.kind === "buildRecover") {
    return {
      title: "确认重新规划并重试构建？",
      content: `将按失败时的目标和参数重新生成 ${action.projectName} 的构建计划。如当前不在记录所属工作区，将先切换到原工作区；只有工作区、项目、分支、环境和参数检查通过后才会触发新的构建。`,
    };
  }
  if (action?.kind === "runtimeRecover") {
    if (action.replayAction === "stop") {
      return {
        title: "确认检查并重新停止？",
        content: `将重新读取 ${action.projectName} 的运行状态，并校验项目与受管进程后重新停止；归属校验未通过时不会终止进程。`,
      };
    }
    return {
      title: "确认检查并重新启动？",
      content: `将使用失败时的项目、调试档案和临时参数，对 ${action.projectName} 重新执行启动前检查；只有检查通过后才会启动。`,
    };
  }
  if (action?.kind === "proxyRecover") {
    return {
      title: action.replayAction === "stop"
        ? "确认检查并重新停止？"
        : "确认检查并重新启动？",
      content: `将重新读取 ${action.profileName} 的代理配置，并由守护进程校验配置、端口和监听归属后重新${action.replayAction === "stop" ? "停止" : "启动"}。`,
    };
  }
  if (action?.kind === "linkRecover") {
    return {
      title: "确认检查并重试？",
      content: `将先对 ${action.linkName} 执行只读检查。只有检查通过后，才会重新${action.replayAction === "stop" ? "停止" : "启动"}。`,
    };
  }
  return {
    title: "确认重试？",
    content: "将重新检查当前状态，并在检查通过后重试。",
  };
}

function isAutoRefreshableBuildActivity(item: ActivityEntry) {
  return isBuildActivityKind(item.kind) && isVisibleRunningActivity(item);
}

function isManualRefreshableBuildActivity(item: ActivityEntry) {
  return (
    isBuildActivityKind(item.kind) &&
    (item.status === "running" || isBuildSyncFailure(item))
  );
}

function queueGroupKey(item: ActivityEntry) {
  return item.chainId ? `chain:${item.chainId}` : activityExecutionKey(item);
}

function queueGroupLabel(item: ActivityEntry) {
  return item.projectName || item.projectKey || KIND_LABELS[item.kind];
}

function compareActivityPriority(left: ActivityEntry, right: ActivityEntry) {
  const leftFailed = isUnhandledFailure(left) ? 1 : 0;
  const rightFailed = isUnhandledFailure(right) ? 1 : 0;
  if (leftFailed !== rightFailed) {
    return rightFailed - leftFailed;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareActivityCreated(left: ActivityEntry, right: ActivityEntry) {
  return left.createdAt.localeCompare(right.createdAt);
}

function compareActivityUpdatedDesc(left: ActivityEntry, right: ActivityEntry) {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

function activityStepLabel(item: ActivityEntry) {
  return item.stepLabel || item.title;
}

function buildExecutionTargetFromGroupId(id: string) {
  if (!id.startsWith("build:")) {
    return "";
  }
  return id.split(":")[2]?.trim().toLowerCase() ?? "";
}

function buildExecutionTitleFromItems(id: string, items: ActivityEntry[]) {
  if (!items.every((item) => isBuildActivityKind(item.kind))) {
    return "";
  }

  const text = items
    .flatMap((item) => [item.title, item.stepLabel ?? ""])
    .join(" ");
  if (text.includes("产物构建") || text.includes("打包")) {
    return "产物构建";
  }
  if (text.includes("发布")) {
    return "发布";
  }
  if (text.includes("部署")) {
    return "部署";
  }

  const target = buildExecutionTargetFromGroupId(id);
  if (target === "package") {
    return "产物构建";
  }
  if (target === "release") {
    return "发布";
  }
  return "构建";
}

function executionGroupTitle(id: string, items: ActivityEntry[]) {
  return (
    buildExecutionTitleFromItems(id, items) ||
    [...items].sort(compareActivityCreated)[0]?.title ||
    items[0]?.title ||
    "活动记录"
  );
}

function executionItemTitle(item: ActivityEntry, groupTitle: string) {
  if (!isBuildActivityKind(item.kind) || !groupTitle || groupTitle === "构建") {
    return item.title;
  }
  if (item.title.startsWith("重播")) {
    return `重播${groupTitle}`;
  }
  if (item.title.startsWith("触发")) {
    return `触发${groupTitle}`;
  }
  return item.title;
}

function aggregateChainStatus(items: ActivityEntry[]): ActivityStatus {
  if (items.some(isFailureActivity)) {
    return "failed";
  }
  if (items.some(isVisibleRunningActivity)) {
    return "running";
  }
  if (items.every((item) => item.status === "success")) {
    return "success";
  }
  return items[0]?.status ?? "info";
}

function buildActivityExecutionGroup(
  id: string,
  groupItems: ActivityEntry[],
): ActivityExecutionGroup {
  const items = [...groupItems].sort(compareActivityUpdatedDesc);
  const failedItems = groupItems.filter(isFailureActivity);
  const latest = items[0];
  return {
    id,
    items,
    title: executionGroupTitle(id, groupItems),
    latest,
    status: latestActivityExecutionStatus(groupItems),
    failedItems,
    resourceItem: items.find((item) => item.resource) ?? null,
    targetItem: items.find((item) => item.target) ?? null,
    actionItem: items.find((item) => item.action) ?? null,
    detailItem: items.find(hasActivityDiagnostics) ?? null,
    executionCount: groupItems.length,
  };
}

function buildActivityDisplayUnits(items: ActivityEntry[]): ActivityDisplayUnit[] {
  const chained = new Map<string, ActivityEntry[]>();
  const loose: ActivityEntry[] = [];

  for (const item of items) {
    if (item.chainId) {
      chained.set(item.chainId, [...(chained.get(item.chainId) ?? []), item]);
    } else {
      loose.push(item);
    }
  }

  const executionGroups = new Map<string, ActivityEntry[]>();
  for (const item of loose) {
    const key = activityExecutionKey(item);
    executionGroups.set(key, [...(executionGroups.get(key) ?? []), item]);
  }

  const units: ActivityDisplayUnit[] = [];
  for (const [id, groupItems] of executionGroups.entries()) {
    if (groupItems.length < 2) {
      units.push({ type: "item", item: groupItems[0] });
    } else {
      units.push({
        type: "execution",
        group: buildActivityExecutionGroup(id, groupItems),
      });
    }
  }
  for (const [id, chainItems] of chained.entries()) {
    if (chainItems.length < 2) {
      units.push({ type: "item", item: chainItems[0] });
      continue;
    }
    const ordered = [...chainItems].sort(compareActivityCreated);
    const latest = [...chainItems].sort(compareActivityUpdatedDesc)[0];
    const prioritized = [...chainItems].sort(compareActivityPriority);
    const primary =
      ordered.find((item) => !item.parentId) ??
      ordered.find((item) => item.id === latest.parentId) ??
      ordered[0];
    const failedItems = chainItems.filter(isFailureActivity);
    units.push({
      type: "chain",
      group: {
        id,
        items: ordered,
        primary,
        latest,
        status: aggregateChainStatus(chainItems),
        failedItems,
        resourceItem: prioritized.find((item) => item.resource) ?? null,
        actionItem: prioritized.find((item) => item.action) ?? null,
        detailItem: prioritized.find(hasActivityDiagnostics) ?? null,
        targetItem:
          failedItems.find((item) => item.target) ??
          prioritized.find((item) => item.target) ??
          null,
      },
    });
  }

  return units.sort((left, right) => {
    const leftUpdated =
      left.type === "item" ? left.item.updatedAt : left.group.latest.updatedAt;
    const rightUpdated =
      right.type === "item" ? right.item.updatedAt : right.group.latest.updatedAt;
    return rightUpdated.localeCompare(leftUpdated);
  });
}

function ActivityChainTrail({ items }: { items: ActivityEntry[] }) {
  return (
    <Stack
      className="activity-chain-trail"
      direction="row"
      alignItems="center"
      flexWrap="wrap"
      rowGap={0.35}
      columnGap={0.45}
      sx={{ mt: 0.72, color: "var(--muted)" }}
    >
      {items.map((item, index) => (
        <Stack
          key={item.id}
          direction="row"
          alignItems="center"
          spacing={0.45}
          sx={{ minWidth: 0 }}
        >
          {index > 0 ? (
            <Typography
              component="span"
              variant="caption"
              sx={{ color: "var(--muted)", fontSize: "0.66rem", fontWeight: 760 }}
            >
              →
            </Typography>
          ) : null}
          <Box
            component="span"
            sx={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              bgcolor: item.acknowledgedAt ? "var(--muted)" : statusColor(item.status),
              flexShrink: 0,
            }}
          />
          <Typography
            component="span"
            variant="caption"
            title={activityStepLabel(item)}
            sx={{
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color:
                item.status === "failed"
                  ? "var(--activity-danger)"
                  : "color-mix(in srgb, var(--text) 82%, var(--muted))",
              fontSize: "0.66rem",
              fontWeight: item.status === "running" ? 760 : 720,
              lineHeight: 1.2,
            }}
          >
            {activityStepLabel(item)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function ActivityCenter({
  open,
  variant = "drawer",
  items,
  onClose,
  onClear,
  onOpenEntry,
  onOpenResource,
  onRunAction,
  onRefresh,
  onAcknowledgeEntry,
  onAcknowledgeEntries,
}: ActivityCenterProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [originFilter, setOriginFilter] = useState<ActivityOriginFilter>("all");
  const [listPage, setListPage] = useState(1);
  const [toggledGroupIds, setToggledGroupIds] = useState<Set<string>>(() => new Set());
  const [fullExecutionGroupIds, setFullExecutionGroupIds] = useState<Set<string>>(() => new Set());
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<ActivityEntry | null>(null);
  const [recoverConfirmEntry, setRecoverConfirmEntry] = useState<ActivityEntry | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [actionRunningId, setActionRunningId] = useState("");
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const autoRefreshableRef = useRef(false);
  const manualRefreshableRef = useRef(false);
  const hasAutoRefreshableBuildActivity = useMemo(
    () => items.some(isAutoRefreshableBuildActivity),
    [items],
  );
  const hasManualRefreshableBuildActivity = useMemo(
    () => items.some(isManualRefreshableBuildActivity),
    [items],
  );

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    autoRefreshableRef.current = hasAutoRefreshableBuildActivity;
    manualRefreshableRef.current = hasManualRefreshableBuildActivity;
  }, [hasAutoRefreshableBuildActivity, hasManualRefreshableBuildActivity]);

  const runRefresh = useCallback(async (options: { force?: boolean } = {}) => {
    const force = Boolean(options.force);
    const canRefresh = options.force
      ? manualRefreshableRef.current
      : autoRefreshableRef.current;
    if (!canRefresh || refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    if (force) {
      setManualRefreshing(true);
    }
    try {
      await onRefreshRef.current(options);
    } finally {
      refreshingRef.current = false;
      if (force) {
        setManualRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open || !hasAutoRefreshableBuildActivity) {
      return;
    }
    void runRefresh();
    const timer = window.setInterval(() => {
      void runRefresh();
    }, ACTIVITY_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasAutoRefreshableBuildActivity, open, runRefresh]);

  const originItems = useMemo(
    () =>
      originFilter === "all"
        ? items
        : items.filter((item) => item.origin === originFilter),
    [items, originFilter],
  );
  const originCounts = useMemo(
    () => ({
      all: items.length,
      app: items.filter((item) => item.origin === "app").length,
      cli: items.filter((item) => item.origin === "cli").length,
      tray: items.filter((item) => item.origin === "tray").length,
    }),
    [items],
  );
  const originOptions = useMemo<Array<{ key: ActivityOriginFilter; label: string; count: number }>>(
    () => [
      { key: "all", label: "全部来源", count: originCounts.all },
      { key: "app", label: "App", count: originCounts.app },
      { key: "cli", label: "CLI", count: originCounts.cli },
      { key: "tray", label: "托盘", count: originCounts.tray },
    ],
    [originCounts.all, originCounts.app, originCounts.cli, originCounts.tray],
  );
  const attentionItems = useMemo(
    () => originItems.filter(activityRequiresAttention),
    [originItems],
  );
  const failedItems = useMemo(
    () => originItems.filter(isFailureActivity),
    [originItems],
  );
  const unhandledFailedItems = useMemo(
    () => failedItems.filter(isUnhandledFailure),
    [failedItems],
  );
  const successItems = useMemo(
    () => originItems.filter((item) => item.status === "success"),
    [originItems],
  );
  const counts = useMemo(
    () => ({
      attention: attentionItems.length,
      all: originItems.length,
      success: successItems.length,
      failed: failedItems.length,
    }),
    [
      attentionItems.length,
      failedItems.length,
      originItems.length,
      successItems.length,
    ],
  );
  const filterOptions = useMemo<Array<{ key: ActivityFilter; label: string; count: number; icon: ReactElement }>>(
    () => [
      { key: "all", label: "全部", count: counts.all, icon: <AppWindowIcon fontSize="small" /> },
      { key: "attention", label: "待办", count: counts.attention, icon: <ClockIcon fontSize="small" /> },
      { key: "success", label: "成功", count: counts.success, icon: <CheckIcon fontSize="small" /> },
      { key: "failed", label: "失败", count: counts.failed, icon: <ClearIcon fontSize="small" /> },
    ],
    [counts.all, counts.attention, counts.failed, counts.success],
  );
  useEffect(() => {
    if (filterOptions.some((item) => item.key === filter)) {
      return;
    }
    setFilter(filterOptions[0]?.key ?? "all");
  }, [filter, filterOptions]);
  const queueGroups = useMemo(() => {
    const grouped = new Map<string, ActivityEntry[]>();
    for (const item of attentionItems) {
      const key = queueGroupKey(item);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }

    return Array.from(grouped.entries())
      .map(([id, groupItems]): ActivityQueueGroup => {
        const sorted = [...groupItems].sort(compareActivityPriority);
        const groupFailedItems = groupItems.filter(isUnhandledFailure);
        const actionCount = groupItems.filter((item) => Boolean(item.action)).length;
        const latest = sorted[0];
        return {
          id,
          label: queueGroupLabel(latest),
          latest,
          failedItems: groupFailedItems,
          resourceItem:
            sorted.find((item) => isUnhandledFailure(item) && item.resource) ??
            sorted.find((item) => item.resource) ??
            null,
          targetItem:
            sorted.find((item) => isUnhandledFailure(item) && item.target) ??
            sorted.find((item) => item.target) ??
            null,
          actionItem:
            sorted.find((item) => isUnhandledFailure(item) && item.action) ??
            sorted.find((item) => item.action) ??
            null,
          detailItem: sorted.find(hasActivityDiagnostics) ?? null,
          failedCount: groupFailedItems.length,
          actionCount,
          total: groupItems.length,
        };
      })
      .sort((left, right) => right.latest.updatedAt.localeCompare(left.latest.updatedAt));
  }, [attentionItems]);
  const visibleItems = useMemo(() => {
    if (filter === "attention") {
      return attentionItems;
    }
    if (filter === "success") {
      return successItems;
    }
    if (filter === "failed") {
      return failedItems;
    }
    return originItems;
  }, [attentionItems, failedItems, filter, originItems, successItems]);
  const visibleUnits = useMemo(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const visibleChainIds = new Set(
      visibleItems.map((item) => item.chainId).filter((value): value is string => Boolean(value)),
    );
    const chainAwareItems =
      filter === "attention"
        ? visibleItems
        : originItems.filter(
            (item) => visibleIds.has(item.id) || (item.chainId && visibleChainIds.has(item.chainId)),
          );
    return buildActivityDisplayUnits(chainAwareItems);
  }, [filter, originItems, visibleItems]);
  const listPageCount = Math.max(
    1,
    Math.ceil(visibleUnits.length / ACTIVITY_LIST_PAGE_SIZE),
  );
  useEffect(() => {
    setListPage(1);
  }, [filter, open, originFilter]);
  useEffect(() => {
    if (listPage > listPageCount) {
      setListPage(listPageCount);
    }
  }, [listPage, listPageCount]);
  const paginatedUnits = useMemo(() => {
    const start = (listPage - 1) * ACTIVITY_LIST_PAGE_SIZE;
    return visibleUnits.slice(start, start + ACTIVITY_LIST_PAGE_SIZE);
  }, [listPage, visibleUnits]);
  const listStartIndex =
    visibleUnits.length === 0 ? 0 : (listPage - 1) * ACTIVITY_LIST_PAGE_SIZE + 1;
  const listEndIndex = Math.min(
    visibleUnits.length,
    listPage * ACTIVITY_LIST_PAGE_SIZE,
  );
  const visibleQueueGroups = queueGroups.slice(0, 4);
  const hiddenQueueCount = Math.max(0, queueGroups.length - visibleQueueGroups.length);
  const toggleGroup = useCallback((groupId: string) => {
    setToggledGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);
  const toggleFullExecutionGroup = useCallback((groupId: string) => {
    setFullExecutionGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);
  const handleAcknowledgeAllFailed = () => {
    if (unhandledFailedItems.length === 0) {
      return;
    }
    onAcknowledgeEntries(unhandledFailedItems);
  };
  const handleClearConfirmed = () => {
    onClear();
    setClearConfirmOpen(false);
  };
  const runActivityAction = useCallback(async (item: ActivityEntry) => {
    if (!item.action || actionRunningId) {
      return;
    }
    setActionRunningId(item.id);
    try {
      await onRunAction(item);
    } finally {
      setActionRunningId("");
    }
  }, [actionRunningId, onRunAction]);

  const renderActivityAction = (item: ActivityEntry) => {
    if (!item.action) {
      return null;
    }
    const comparing = item.action.kind === "compareConfigSource";
    const recovering =
      item.action.kind === "linkRecover" ||
      item.action.kind === "branchReplay" ||
      item.action.kind === "buildRecover" ||
      item.action.kind === "runtimeRecover" ||
      item.action.kind === "proxyRecover";
    return (
      <Tooltip title={item.action.label}>
        <span>
          <IconButton
            size="small"
            onClick={() => {
              if (recovering) {
                setRecoverConfirmEntry(item);
                return;
              }
              void runActivityAction(item);
            }}
            disabled={Boolean(actionRunningId)}
            aria-label={item.action.label}
            sx={activityActionIconSx}
          >
            {recovering ? (
              <ReplayIcon fontSize="small" />
            ) : comparing ? (
              <WorkflowIcon fontSize="small" />
            ) : (
              <RefreshIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
    );
  };

  const renderActivityDetailAction = (item: ActivityEntry) => {
    if (!hasActivityDiagnostics(item)) {
      return null;
    }
    return (
      <Tooltip title="查看诊断详情">
        <IconButton
          size="small"
          onClick={() => setDetailEntry(item)}
          aria-label="查看诊断详情"
          sx={activityActionIconSx}
        >
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  };

  const content = (
    <>
      <Box
        className="activity-center-surface"
        sx={{
          pb: { xs: 1, sm: 1.35 },
          pl: { xs: 1, sm: 1.6 },
          pr: { xs: 0.55, sm: 1.05 },
          pt: variant === "panel" ? 0 : undefined,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Box className="activity-control-panel">
          <Stack
            className="activity-center-header"
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={0}
          >
            <Stack
              className="activity-header-copy"
              direction="row"
              alignItems="center"
              spacing={0}
              minWidth={0}
            >
              <Box className="activity-header-mark" aria-hidden="true">
                <ActivityIcon fontSize="small" />
              </Box>
              <Box className="activity-header-text" minWidth={0}>
                <Typography className="activity-header-title" variant="subtitle1">
                  活动
                </Typography>
                <Typography
                  className="activity-header-subtitle"
                  variant="caption"
                  color="text.secondary"
                  noWrap
                >
                  管理和跟踪所有活动
                </Typography>
              </Box>
            </Stack>
            <Stack
              className="activity-header-actions"
              direction="row"
              spacing={0}
              sx={{ pt: variant === "panel" ? 0.1 : 0 }}
            >
              <Tooltip title="处理全部失败">
                <span>
                  <IconButton
                    className="activity-header-action activity-header-action--primary"
                    size="small"
                    onClick={handleAcknowledgeAllFailed}
                    disabled={unhandledFailedItems.length === 0}
                    aria-label="处理全部失败"
                    sx={activityHeaderIconSx}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="刷新活动状态">
                <span>
                  <IconButton
                    className="activity-header-action"
                    size="small"
                    onClick={() => void runRefresh({ force: true })}
                    disabled={!hasManualRefreshableBuildActivity || manualRefreshing}
                    aria-label="刷新活动状态"
                    sx={activityHeaderIconSx}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="清空活动">
                <span>
                  <IconButton
                    className="activity-header-action"
                    size="small"
                    onClick={() => setClearConfirmOpen(true)}
                    disabled={items.length === 0}
                    aria-label="清空活动"
                    sx={activityHeaderIconSx}
                  >
                    <TrashIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="收起活动中心">
                <IconButton
                  className="activity-header-action"
                  size="small"
                  onClick={onClose}
                  aria-label="收起活动中心"
                  sx={activityHeaderIconSx}
                >
                  <PanelSideIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <Tabs
            className="runtime-panel-tabs activity-filter-strip"
            value={filter}
            onChange={(_, value) => setFilter(value as ActivityFilter)}
            variant="fullWidth"
            aria-label="活动筛选"
          >
            {filterOptions.map((item) => (
              <Tab
                key={item.key}
                value={item.key}
                icon={item.icon}
                iconPosition="start"
                label={(
                  <Box component="span" className="activity-filter-label">
                    <Box component="span">{item.label}</Box>
                    <Box component="span" className="activity-filter-count">
                      {item.count}
                    </Box>
                  </Box>
                )}
                aria-label={`${item.label} ${item.count}`}
              />
            ))}
          </Tabs>
          <Tabs
            value={originFilter}
            onChange={(_, value) => setOriginFilter(value as ActivityOriginFilter)}
            variant="scrollable"
            scrollButtons={false}
            aria-label="活动来源筛选"
            sx={{
              mt: 0.58,
              minHeight: 28,
              "& .MuiTabs-indicator": {
                height: 2,
                borderRadius: "2px",
              },
              "& .MuiTab-root": {
                minHeight: 28,
                minWidth: 0,
                px: 0.9,
                py: 0.25,
                mr: 0.25,
                borderRadius: "6px",
                color: "var(--muted)",
                fontSize: "0.62rem",
                fontWeight: 720,
                textTransform: "none",
                letterSpacing: 0,
              },
              "& .Mui-selected": {
                color: "var(--text)",
                bgcolor: "color-mix(in srgb, var(--accent) 8%, var(--glass))",
              },
            }}
          >
            {originOptions.map((item) => (
              <Tab
                key={item.key}
                value={item.key}
                label={`${item.label} ${item.count}`}
                aria-label={`${item.label} ${item.count}`}
              />
            ))}
          </Tabs>
        </Box>

        {queueGroups.length > 0 ? (
          <Box
            className="activity-queue-section"
            sx={{
              mt: 0.75,
              p: 0.9,
            }}
          >
            <Stack
              className="activity-section-heading"
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={1}
            >
              <Stack direction="row" spacing={0.55} alignItems="baseline" minWidth={0}>
                <Typography
                  variant="caption"
                  sx={{ flexShrink: 0, color: "var(--text)", fontWeight: 790, fontSize: "0.7rem" }}
                >
                  待处理队列
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ minWidth: 0, fontSize: "0.67rem", lineHeight: 1.4 }}
                >
                  {queueGroups.length} 个分组需要关注
                </Typography>
              </Stack>
              <Chip
                size="small"
                label={`${counts.attention}`}
                variant="filled"
                sx={(theme) => {
                  const dark = theme.palette.mode === "dark";
                  return {
                    height: 21,
                    borderRadius: "7px",
                    bgcolor: "var(--activity-running-soft)",
                    color: "var(--activity-running)",
                    border: dark ? "1px solid rgba(143,184,234,0.09)" : "1px solid rgba(52,76,96,0.09)",
                    backdropFilter: "blur(18px) saturate(1.16)",
                    WebkitBackdropFilter: "blur(18px) saturate(1.16)",
                    "& .MuiChip-label": { px: 0.7, fontSize: "0.64rem", fontWeight: 820 },
                  };
                }}
              />
            </Stack>

            <Stack spacing={0.65} sx={{ mt: 0.72 }}>
              {visibleQueueGroups.map((group) => (
                <Box
                  className="activity-record-card activity-queue-card"
                  key={group.id}
                  sx={(theme) => ({
                    ...activityRecordCardSx(theme),
                    px: 0.9,
                    py: 0.8,
                  })}
                >
                  <Stack direction="row" spacing={0.78} alignItems="flex-start">
                    <Box
                      sx={{
                        width: 2,
                        alignSelf: "stretch",
                        minHeight: 42,
                        borderRadius: 999,
                        bgcolor: group.failedCount > 0 ? "var(--activity-danger)" : "var(--activity-running)",
                        opacity: 0.7,
                      }}
                    />
                    <Box minWidth={0} flex={1}>
                      <Stack
                        className="activity-record-heading"
                        direction="row"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        spacing={0.8}
                      >
                        <Stack
                          className="activity-queue-title-cluster"
                          alignItems="stretch"
                          spacing={0.48}
                          minWidth={0}
                          flex={1}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              color: "color-mix(in srgb, var(--text) 88%, var(--muted))",
                              fontSize: "0.83rem",
                              fontWeight: 760,
                              lineHeight: 1.32,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {group.label}
                          </Typography>
                          <Stack direction="row" spacing={0.4} alignItems="center" flexWrap="wrap" useFlexGap>
                            {group.failedCount > 0 ? (
                              <Chip
                                size="small"
                                label={`失败 ${group.failedCount}`}
                                variant="outlined"
                                sx={(theme) => ({
                                  ...activityChipSx(theme),
                                  color: "var(--activity-danger)",
                                })}
                              />
                            ) : null}
                            {group.actionCount > 0 && group.failedCount === 0 ? (
                              <Chip
                                size="small"
                                label={`待操作 ${group.actionCount}`}
                                variant="outlined"
                                sx={(theme) => ({
                                  ...activityChipSx(theme),
                                  color: "var(--activity-running)",
                                })}
                              />
                            ) : null}
                            {group.total > 1 ? (
                              <Chip
                                size="small"
                                label={`执行 ${group.total} 次`}
                                variant="outlined"
                                sx={activityChipSx}
                              />
                            ) : null}
                          </Stack>
                        </Stack>
                        {group.actionItem || group.detailItem || group.resourceItem || group.targetItem || group.failedItems.length > 0 ? (
                          <Stack className="activity-card-actions" direction="row" spacing={0.25} flexShrink={0}>
                            {group.actionItem ? renderActivityAction(group.actionItem) : null}
                            {group.detailItem ? renderActivityDetailAction(group.detailItem) : null}
                            {group.resourceItem ? (
                              <Tooltip title={group.resourceItem.resource?.label ?? "打开关联资源"}>
                                <IconButton
                                  size="small"
                                  onClick={() => onOpenResource(group.resourceItem!)}
                                  aria-label={group.resourceItem.resource?.label ?? "打开关联资源"}
                                  sx={activityActionIconSx}
                                >
                                  <OpenExternalIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                            {group.targetItem ? (
                              <Tooltip title="定位">
                                <IconButton
                                  size="small"
                                  onClick={() => onOpenEntry(group.targetItem!)}
                                  aria-label="定位活动"
                                  sx={activityActionIconSx}
                                >
                                  <SettingsIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                            {group.failedItems.length > 0 ? (
                              <Tooltip title="标记已处理">
                                <IconButton
                                  size="small"
                                  onClick={() => onAcknowledgeEntries(group.failedItems)}
                                  aria-label="标记已处理"
                                  sx={activityActionIconSx}
                                >
                                  <CheckIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                          </Stack>
                        ) : null}
                      </Stack>
                      <Typography
                        variant="caption"
                        sx={{
                          display: "-webkit-box",
                          mt: 0.42,
                          color: "color-mix(in srgb, var(--muted) 88%, var(--text))",
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          fontSize: "0.67rem",
                          lineHeight: 1.46,
                        }}
                      >
                        {group.latest.title} · {displayActivitySummary(group.latest)}
                      </Typography>
                      <ActivityParameterSummary item={group.latest} />
                    </Box>
                  </Stack>
                </Box>
              ))}
              {hiddenQueueCount > 0 ? (
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={1}
                  sx={{
                    px: 0.2,
                    pt: 0.2,
                    color: "var(--muted)",
                  }}
                >
                  <Typography variant="caption">
                    还有 {hiddenQueueCount} 个待处理分组在下方列表中
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setFilter("attention")}
                    sx={{ minHeight: 24, px: 0.8 }}
                  >
                    查看
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </Box>
        ) : null}

        <Divider className="activity-list-divider" sx={{ borderColor: "var(--line-soft)", opacity: 0.78 }} />

        <Stack
          className="activity-list-scroll"
          spacing={1}
          sx={{
            mt: 0.9,
            mb: 0.7,
            p: 0.2,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            scrollbarGutter: "auto",
            border: 0,
            borderRadius: 0,
            bgcolor: "transparent",
            scrollbarWidth: "thin",
            scrollbarColor:
              "color-mix(in srgb, var(--muted) 34%, transparent) transparent",
            transition: "scrollbar-color 140ms ease",
            "&:hover": {
              scrollbarColor:
                "color-mix(in srgb, var(--muted) 48%, transparent) transparent",
            },
            "&::-webkit-scrollbar": {
              width: "var(--scrollbar-gutter-size)",
              height: "var(--scrollbar-gutter-size)",
            },
            "&::-webkit-scrollbar-track": {
              background: "transparent",
              borderRadius: "999px",
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "color-mix(in srgb, var(--muted) 34%, transparent)",
              borderRadius: "999px",
              borderColor: "transparent",
              borderStyle: "solid",
              borderWidth:
                "var(--scrollbar-thumb-inset-block) var(--scrollbar-thumb-inset-right) var(--scrollbar-thumb-inset-block) var(--scrollbar-thumb-inset-left)",
              backgroundClip: "padding-box",
            },
            "&:hover::-webkit-scrollbar-thumb": {
              backgroundColor: "color-mix(in srgb, var(--muted) 48%, transparent)",
            },
            "&:hover::-webkit-scrollbar-thumb:hover": {
              backgroundColor: "color-mix(in srgb, var(--muted) 56%, transparent)",
            },
          }}
        >
          {visibleUnits.length === 0 ? (
            <AppEmptyState
              title={filter === "attention" ? "暂无待处理" : "没有匹配记录"}
              description={
                filter === "attention"
                  ? "未处理失败和需要人工操作的活动会出现在这里。"
                  : "换个筛选条件看看其他活动。"
              }
            />
          ) : (
            paginatedUnits.map((unit) => {
              if (unit.type === "chain") {
                const { group } = unit;
                const groupExpanded = toggledGroupIds.has(group.id);
                const unhandledGroupFailures = group.failedItems.filter(isUnhandledFailure);
                const groupAcknowledgedAt =
                  group.status === "failed" &&
                  group.failedItems.length > 0 &&
                  unhandledGroupFailures.length === 0
                    ? group.failedItems[0].acknowledgedAt ?? null
                    : null;
                const headlineItem: ActivityEntry = {
                  ...group.latest,
                  kind: group.primary.kind,
                  title: group.primary.title,
                  status: group.status,
                  acknowledgedAt: groupAcknowledgedAt,
                };
                return (
                  <Box
                    className={`activity-record-card activity-record-card--${group.status}${groupExpanded ? " is-expanded" : ""}`}
                    key={group.id}
                    sx={activityRecordCardSx}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={0.65}>
                      <ActivityKindGlyph item={headlineItem} />
                      <Box minWidth={0} flex={1}>
                        <Stack
                          className="activity-record-heading"
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={0.62}
                        >
                          <ActivityTitleCluster
                            item={headlineItem}
                            meta={formatActivityTime(group.latest.updatedAt)}
                          />
                          {group.actionItem || group.detailItem || group.targetItem || group.resourceItem || unhandledGroupFailures.length > 0 || group.items.length > 1 ? (
                            <Stack className="activity-card-actions" direction="row" spacing={0.25} flexShrink={0}>
                              {group.actionItem ? renderActivityAction(group.actionItem) : null}
                              {group.detailItem ? renderActivityDetailAction(group.detailItem) : null}
                              {group.resourceItem ? (
                                <Tooltip title={group.resourceItem.resource?.label ?? "打开关联资源"}>
                                  <IconButton
                                    size="small"
                                    onClick={() => onOpenResource(group.resourceItem!)}
                                    aria-label={group.resourceItem.resource?.label ?? "打开关联资源"}
                                    sx={activityActionIconSx}
                                  >
                                    <OpenExternalIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                              {group.targetItem ? (
                                <Tooltip title="定位">
                                  <IconButton
                                    size="small"
                                    onClick={() => onOpenEntry(group.targetItem!)}
                                    aria-label="定位活动"
                                    sx={activityActionIconSx}
                                  >
                                    <SettingsIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                              {unhandledGroupFailures.length > 0 ? (
                                <Tooltip title="标记已处理">
                                  <IconButton
                                    size="small"
                                    onClick={() => onAcknowledgeEntries(unhandledGroupFailures)}
                                    aria-label="标记已处理"
                                    sx={activityActionIconSx}
                                  >
                                    <CheckIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                              <Tooltip title={groupExpanded ? "收起执行详情" : "展开执行详情"}>
                                <IconButton
                                  size="small"
                                  onClick={() => toggleGroup(group.id)}
                                  aria-label={groupExpanded ? "收起执行详情" : "展开执行详情"}
                                  aria-expanded={groupExpanded}
                                  sx={activityActionIconSx}
                                >
                                  {groupExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          ) : null}
                        </Stack>
                        <ActivityParameterSummary
                          item={
                            group.latest.parameters?.length
                              ? group.latest
                              : group.items.find((item) => item.parameters?.length) ?? group.latest
                          }
                        />
                        {groupExpanded ? (
                          <>
                            <ActivityChainTrail items={group.items} />
                            <Stack
                              className="activity-detail-stack"
                              spacing={0}
                              sx={{ mt: 1.05 }}
                            >
                              {group.items.map((item) => (
                            <Box
                              key={item.id}
                              className="activity-timeline-row activity-timeline-row--chain"
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "68px 18px minmax(0, 1fr)",
                                gap: 0.72,
                                alignItems: "start",
                              }}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  color: statusColor(item.status),
                                  pt: 0,
                                  fontSize: "0.62rem",
                                  fontWeight: 800,
                                  lineHeight: 1.55,
                                }}
                              >
                                {activityStepLabel(item)}
                              </Typography>
                              <Box className="activity-timeline-marker" sx={{ color: statusColor(item.status) }}>
                                <CheckIcon fontSize="small" />
                              </Box>
                              <Box minWidth={0}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "block",
                                    color: "color-mix(in srgb, var(--text) 68%, var(--muted))",
                                    overflowWrap: "anywhere",
                                    fontSize: "0.63rem",
                                    lineHeight: 1.55,
                                  }}
                                >
                                  {[
                                    displayActivitySummary(item) || STATUS_LABELS[item.status],
                                    formatActivityTime(item.updatedAt),
                                  ].filter(Boolean).join(" · ")}
                                </Typography>
                                <ActivityTimelineDetail item={item} />
                              </Box>
                            </Box>
                              ))}
                            </Stack>
                          </>
                        ) : null}
                      </Box>
                    </Stack>
                  </Box>
                );
              }
              if (unit.type === "execution") {
                const { group } = unit;
                const defaultExpanded = group.items.every((item) => isBuildActivityKind(item.kind));
                const groupExpanded = toggledGroupIds.has(group.id) ? !defaultExpanded : defaultExpanded;
                const fullExecutionGroup = fullExecutionGroupIds.has(group.id);
                const visibleExecutionItems = fullExecutionGroup
                  ? group.items
                  : group.items.slice(0, ACTIVITY_EXECUTION_PREVIEW_LIMIT);
                const groupSuccessCount = group.items.filter((item) => item.status === "success").length;
                const unhandledGroupFailures = group.failedItems.filter(isUnhandledFailure);
                const groupAcknowledgedAt =
                  group.status === "failed" &&
                  group.failedItems.length > 0 &&
                  unhandledGroupFailures.length === 0
                    ? group.failedItems[0].acknowledgedAt ?? null
                    : null;
                const collapsedFailureReason = activityFailureReason(group.latest);
                const headlineItem: ActivityEntry = {
                  ...group.latest,
                  title: group.title,
                  status: group.status,
                  acknowledgedAt: groupAcknowledgedAt,
                };
                return (
                  <Box
                    className={`activity-record-card activity-record-card--${group.status}${groupExpanded ? " is-expanded" : ""}`}
                    key={group.id}
                    sx={activityRecordCardSx}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={0.65}>
                      <ActivityKindGlyph item={headlineItem} />
                      <Box minWidth={0} flex={1}>
                        <Stack
                          className="activity-record-heading"
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={0.62}
                        >
                          <ActivityTitleCluster
                            item={headlineItem}
                            meta={formatActivityTime(group.latest.updatedAt)}
                            extraTags={(
                              <>
                                <Chip
                                  size="small"
                                  label={`执行 ${group.executionCount} 次`}
                                  variant="outlined"
                                  sx={activityChipSx}
                                />
                                {group.failedItems.length > 0 && group.status !== "failed" ? (
                                  <Chip
                                    size="small"
                                    label={`历史失败 ${group.failedItems.length}`}
                                    variant="outlined"
                                    sx={activityChipSx}
                                  />
                                ) : null}
                              </>
                            )}
                          />
                          {group.actionItem || group.detailItem || group.resourceItem || group.targetItem || unhandledGroupFailures.length > 0 || group.items.length > 1 ? (
                            <Stack className="activity-card-actions" direction="row" spacing={0.25} flexShrink={0}>
                              {group.actionItem ? renderActivityAction(group.actionItem) : null}
                              {group.detailItem ? renderActivityDetailAction(group.detailItem) : null}
                              {group.resourceItem ? (
                                <Tooltip title={group.resourceItem.resource?.label ?? "打开关联资源"}>
                                  <IconButton
                                    size="small"
                                    onClick={() => onOpenResource(group.resourceItem!)}
                                    aria-label={group.resourceItem.resource?.label ?? "打开关联资源"}
                                    sx={activityActionIconSx}
                                  >
                                    <OpenExternalIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                              {group.targetItem ? (
                                <Tooltip title="定位">
                                  <IconButton
                                    size="small"
                                    onClick={() => onOpenEntry(group.targetItem!)}
                                    aria-label="定位活动"
                                    sx={activityActionIconSx}
                                  >
                                    <SettingsIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                              {unhandledGroupFailures.length > 0 ? (
                                <Tooltip title="标记已处理">
                                  <IconButton
                                    size="small"
                                    onClick={() => onAcknowledgeEntries(unhandledGroupFailures)}
                                    aria-label="标记已处理"
                                    sx={activityActionIconSx}
                                  >
                                    <CheckIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                              <Tooltip title={groupExpanded ? "收起执行详情" : "展开执行详情"}>
                                <IconButton
                                  size="small"
                                  onClick={() => toggleGroup(group.id)}
                                  aria-label={groupExpanded ? "收起执行详情" : "展开执行详情"}
                                  aria-expanded={groupExpanded}
                                  sx={activityActionIconSx}
                                >
                                  {groupExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          ) : null}
                        </Stack>
                        <ActivityParameterSummary item={group.latest} />
                        {!groupExpanded ? (
                          <Box className="activity-collapsed-summary">
                            <Typography variant="caption" className="activity-collapsed-counts">
                              成功 {groupSuccessCount} / 失败 {group.failedItems.length}
                            </Typography>
                            <Typography variant="caption" className="activity-collapsed-copy">
                              {displayActivitySummary(group.latest) || group.latest.detail || "执行详情已收起"}
                            </Typography>
                            {collapsedFailureReason ? (
                              <Typography
                                variant="caption"
                                className="activity-collapsed-reason"
                                title={collapsedFailureReason}
                              >
                                失败原因：{collapsedFailureReason}
                              </Typography>
                            ) : null}
                          </Box>
                        ) : null}
                        {groupExpanded ? (
                          <Stack
                            className="activity-detail-stack"
                            spacing={0}
                            sx={{ mt: 1.05 }}
                          >
                          {visibleExecutionItems.map((item, index) => (
                            <Box
                              key={item.id}
                              className="activity-timeline-row activity-timeline-row--execution"
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "58px 18px minmax(0, 1fr)",
                                gap: 0.72,
                                alignItems: "start",
                              }}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  color: statusColor(item.status),
                                  pt: 0,
                                  fontSize: "0.62rem",
                                  fontWeight: 800,
                                  lineHeight: 1.55,
                                }}
                              >
                                第{group.executionCount - index}次
                              </Typography>
                              <Box className="activity-timeline-marker" sx={{ color: statusColor(item.status) }}>
                                <CheckIcon fontSize="small" />
                              </Box>
                              <Box minWidth={0}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "block",
                                    color: "color-mix(in srgb, var(--text) 68%, var(--muted))",
                                    overflowWrap: "anywhere",
                                    fontSize: "0.63rem",
                                    lineHeight: 1.55,
                                  }}
                                >
                                  {[
                                    executionItemTitle(item, group.title),
                                    activityStatusLabel(item),
                                    formatActivityTime(item.updatedAt),
                                    displayActivitySummary(item) || STATUS_LABELS[item.status],
                                  ].filter(Boolean).join(" · ")}
                                </Typography>
                                <ActivityTimelineDetail item={item} />
                              </Box>
                            </Box>
                          ))}
                          {group.items.length > ACTIVITY_EXECUTION_PREVIEW_LIMIT ? (
                            <Button
                              type="button"
                              size="small"
                              variant="text"
                              className="activity-timeline-more"
                              onClick={() => toggleFullExecutionGroup(group.id)}
                              aria-expanded={fullExecutionGroup}
                            >
                              {fullExecutionGroup
                                ? `仅显示最近 ${ACTIVITY_EXECUTION_PREVIEW_LIMIT} 次`
                                : `查看其余 ${group.items.length - ACTIVITY_EXECUTION_PREVIEW_LIMIT} 次记录`}
                            </Button>
                          ) : null}
                          </Stack>
                        ) : null}
                      </Box>
                    </Stack>
                  </Box>
                );
              }
              const item = unit.item;
              return (
                <Box
                  className={`activity-record-card activity-record-card--${item.status}`}
                  key={item.id}
                  sx={activityRecordCardSx}
                >
                <Stack direction="row" alignItems="flex-start" spacing={0.65}>
                  <ActivityKindGlyph item={item} />
                  <Box minWidth={0} flex={1}>
                    <Stack
                      className="activity-record-heading"
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={0.62}
                    >
                      <ActivityTitleCluster
                        item={item}
                        meta={formatActivityTime(item.updatedAt)}
                      />
                      {item.action || hasActivityDiagnostics(item) || item.target || item.resource || isUnhandledFailure(item) ? (
                        <Stack className="activity-card-actions" direction="row" spacing={0.25} flexShrink={0}>
                          {renderActivityAction(item)}
                          {renderActivityDetailAction(item)}
                          {item.resource ? (
                            <Tooltip title={item.resource.label}>
                              <IconButton
                                size="small"
                                onClick={() => onOpenResource(item)}
                                aria-label={item.resource.label}
                                sx={activityActionIconSx}
                              >
                                <OpenExternalIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                          {item.target ? (
                            <Tooltip title="定位">
                              <IconButton
                                size="small"
                                onClick={() => onOpenEntry(item)}
                                aria-label="定位活动"
                                sx={activityActionIconSx}
                              >
                                <SettingsIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                          {isUnhandledFailure(item) ? (
                            <Tooltip title="标记已处理">
                              <IconButton
                                size="small"
                                onClick={() => onAcknowledgeEntry(item)}
                                aria-label="标记已处理"
                                sx={activityActionIconSx}
                              >
                                <CheckIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                        </Stack>
                      ) : null}
                    </Stack>
                    {displayActivitySummary(item) ? (
                      <Typography
                        variant="caption"
                        className="activity-item-summary"
                        sx={{
                          display: "block",
                          mt: 0.7,
                          color: "color-mix(in srgb, var(--text) 76%, var(--muted))",
                          overflowWrap: "anywhere",
                          fontSize: "0.72rem",
                          fontWeight: 650,
                          lineHeight: 1.5,
                        }}
                      >
                        {[
                          item.projectName || item.projectKey,
                          displayActivitySummary(item),
                        ].filter(Boolean).join("：")}
                      </Typography>
                    ) : null}
                    <ActivityParameterSummary item={item} />
                    {item.detail ? (
                      <Typography
                        variant="caption"
                        className="activity-item-detail"
                        sx={{
                          display: "block",
                          mt: 0.58,
                          color: "color-mix(in srgb, var(--muted) 92%, var(--text))",
                          overflowWrap: "anywhere",
                          fontSize: "0.62rem",
                          lineHeight: 1.46,
                          whiteSpace: "pre-wrap",
                        }}
                        title={item.detail ?? undefined}
                      >
                        {item.status === "failed" ? `失败原因：${item.detail}` : item.detail}
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
              </Box>
              );
            })
          )}
        </Stack>
        {visibleUnits.length > 0 ? (
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{
              px: 0.2,
              py: 0.55,
              borderTop: "1px solid var(--line)",
              flexShrink: 0,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: "0.61rem", fontWeight: 720, whiteSpace: "nowrap" }}
            >
              {listStartIndex}-{listEndIndex} / {visibleUnits.length}
            </Typography>
            {listPageCount > 1 ? (
              <Pagination
                size="small"
                page={listPage}
                count={listPageCount}
                siblingCount={0}
                boundaryCount={1}
                onChange={(_, nextPage) => setListPage(nextPage)}
                sx={{
                  "& .MuiPaginationItem-root": {
                    minWidth: 22,
                    height: 22,
                    borderRadius: "7px",
                    fontSize: "0.64rem",
                    fontWeight: 820,
                    backgroundColor: "var(--side-pane-control)",
                    border: "1px solid var(--side-pane-line)",
                    backdropFilter: "blur(18px) saturate(1.16)",
                    WebkitBackdropFilter: "blur(18px) saturate(1.16)",
                  },
                  "& .MuiPaginationItem-root.Mui-selected": {
                    backgroundColor: "color-mix(in srgb, var(--accent) 72%, transparent)",
                    color: "#ffffff",
                  },
                }}
              />
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: "0.61rem", fontWeight: 720, whiteSpace: "nowrap" }}
              >
                本页已全部显示
              </Typography>
            )}
          </Stack>
        ) : null}
      </Box>
      <Dialog
        open={Boolean(detailEntry)}
        onClose={() => setDetailEntry(null)}
        PaperProps={{
          sx: {
            bgcolor: (theme: Theme) =>
              theme.palette.mode === "dark"
                ? "rgba(15, 19, 25, 0.98)"
                : "rgba(248, 251, 254, 0.98)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            width: "min(480px, calc(100vw - 32px))",
            maxHeight: "min(680px, calc(100dvh - 32px))",
            backdropFilter: "blur(22px) saturate(1.08)",
            WebkitBackdropFilter: "blur(22px) saturate(1.08)",
          },
        }}
      >
        {detailEntry ? (
          <>
            <DialogTitle sx={{ pb: 0.8 }}>
              <Stack spacing={0.7}>
                <Typography component="span" sx={{ fontSize: 16, fontWeight: 820 }}>
                  {detailEntry.title}
                </Typography>
                <ActivityStatusPill item={detailEntry} />
              </Stack>
            </DialogTitle>
            <DialogContent sx={{ pt: 0.5 }}>
              <Stack spacing={1.35}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 760, overflowWrap: "anywhere" }}>
                    {detailEntry.summary}
                  </Typography>
                  {detailEntry.detail ? (
                    <Typography
                      component="div"
                      sx={{
                        mt: 0.55,
                        color: "var(--muted)",
                        fontSize: 12,
                        lineHeight: 1.55,
                        overflowWrap: "anywhere",
                        whiteSpace: "pre-line",
                      }}
                    >
                      {detailEntry.detail}
                    </Typography>
                  ) : null}
                </Box>
                {detailEntry.diagnostics?.length ? (
                  <Stack spacing={0} divider={<Divider flexItem sx={{ borderColor: "var(--line-soft)" }} />}>
                    {detailEntry.diagnostics.map((step) => (
                      <Box key={`${step.id}:${step.type}`} sx={{ py: 1 }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                          <Typography sx={{ minWidth: 0, fontSize: 12.5, fontWeight: 780 }}>
                            {step.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={DIAGNOSTIC_STATUS_LABELS[step.status] || step.status}
                            variant="outlined"
                            sx={activityChipSx}
                          />
                        </Stack>
                        <Typography
                          sx={{ mt: 0.45, color: "var(--muted)", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}
                        >
                          {step.summary}
                        </Typography>
                        {step.risks.map((risk) => (
                          <Typography
                            key={risk}
                            sx={{ mt: 0.35, color: "var(--activity-danger)", fontSize: 11.5, lineHeight: 1.45, overflowWrap: "anywhere" }}
                          >
                            风险：{risk}
                          </Typography>
                        ))}
                      </Box>
                    ))}
                  </Stack>
                ) : null}
                {detailEntry.warnings?.length ? (
                  <Box>
                    <Typography sx={{ mb: 0.45, fontSize: 12, fontWeight: 780 }}>警告</Typography>
                    {detailEntry.warnings.map((warning) => (
                      <Typography
                        key={warning}
                        sx={{ color: "var(--muted)", fontSize: 11.5, lineHeight: 1.5, overflowWrap: "anywhere" }}
                      >
                        {warning}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 2.5, pb: 2 }}>
              {detailEntry.target ? (
                <Button
                  startIcon={<SettingsIcon fontSize="small" />}
                  onClick={() => {
                    onOpenEntry(detailEntry);
                    setDetailEntry(null);
                  }}
                >
                  打开工作区
                </Button>
              ) : null}
              <Button variant="contained" onClick={() => setDetailEntry(null)}>关闭</Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(recoverConfirmEntry)}
        onClose={() => setRecoverConfirmEntry(null)}
        PaperProps={{
          sx: {
            bgcolor: (theme: Theme) =>
              theme.palette.mode === "dark"
                ? "rgba(15, 19, 25, 0.98)"
                : "rgba(248, 251, 254, 0.98)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            width: "min(380px, calc(100vw - 32px))",
            backdropFilter: "blur(22px) saturate(1.08)",
            WebkitBackdropFilter: "blur(22px) saturate(1.08)",
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>
          {recoveryConfirmation(recoverConfirmEntry).title}
        </DialogTitle>
        <DialogContent sx={{ color: "var(--muted)", fontSize: 13, pt: 0.5, lineHeight: 1.55 }}>
          {recoveryConfirmation(recoverConfirmEntry).content}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button onClick={() => setRecoverConfirmEntry(null)}>取消</Button>
          <Button
            variant="contained"
            startIcon={<ReplayIcon fontSize="small" />}
            onClick={() => {
              const entry = recoverConfirmEntry;
              setRecoverConfirmEntry(null);
              if (entry) {
                void runActivityAction(entry);
              }
            }}
          >
            检查并重试
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        className="activity-confirm-dialog-root"
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        PaperProps={{
          className: "activity-confirm-dialog-paper",
          sx: {
            bgcolor: "var(--panel-strong)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: "18px",
            width: "min(360px, calc(100vw - 32px))",
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>清空活动记录？</DialogTitle>
        <DialogContent sx={{ color: "var(--muted)", fontSize: 13, pt: 0.5 }}>
          这会移除当前活动中心里的运行、构建、分支等记录。
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={handleClearConfirmed}>
            清空
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  if (variant === "panel") {
    if (!open) {
      return null;
    }
    return (
      <Box
        component="aside"
        aria-label="活动中心"
        className="activity-side-panel"
        sx={{
          height: "auto",
          maxHeight:
            "calc(100dvh - var(--activity-panel-top-offset) - var(--activity-panel-bottom-offset))",
          overflow: "hidden",
          bgcolor: "transparent",
          color: "var(--text)",
          borderLeft: 0,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: 0,
        }}
      >
        {content}
      </Box>
    );
  }

  const drawerTopOffset = "var(--window-drag-height)";

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      ModalProps={{
        className: "activity-drawer-root",
      }}
      slotProps={{
        backdrop: {
          className: "activity-drawer-backdrop",
          sx: {
            top: drawerTopOffset,
          },
        },
      }}
      PaperProps={{
        className: "activity-drawer-paper",
        sx: {
          width: { xs: "100vw", sm: "min(360px, calc(100vw - 28px))" },
          maxWidth: "100vw",
          top: drawerTopOffset,
          right: 0,
          bottom: 0,
          height: `calc(100dvh - ${drawerTopOffset})`,
          overflow: "hidden",
          bgcolor: "transparent",
          color: "var(--text)",
          borderLeft: 0,
          borderRadius: 0,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: 0,
        },
      }}
    >
      {content}
    </Drawer>
  );
}
