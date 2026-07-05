import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Tooltip,
  Typography,
} from "@mui/material";
import {
  BUILD_STATUS_SYNC_MAX_FAILURES,
  activityExecutionKey,
  isBuildActivityKind,
  type ActivityEntry,
  type ActivityKind,
  type ActivityStatus,
} from "../lib/activityCenter";
import {
  CheckIcon,
  ClearIcon,
  LocateIcon,
  OpenExternalIcon,
  RefreshIcon,
  TrashIcon,
} from "./AppIcons";
import type { Theme } from "@mui/material/styles";

type ActivityFilter =
  | "attention"
  | "all"
  | "success"
  | "failed";

type ActivityQueueGroup = {
  id: string;
  label: string;
  latest: ActivityEntry;
  failedItems: ActivityEntry[];
  resourceItem: ActivityEntry | null;
  targetItem: ActivityEntry | null;
  failedCount: number;
  runningCount: number;
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
};

type ActivityExecutionGroup = {
  id: string;
  items: ActivityEntry[];
  latest: ActivityEntry;
  status: ActivityStatus;
  failedItems: ActivityEntry[];
  resourceItem: ActivityEntry | null;
  targetItem: ActivityEntry | null;
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
  onRefresh: (options?: { force?: boolean }) => Promise<void> | void;
  onAcknowledgeEntry: (entry: ActivityEntry) => void;
  onAcknowledgeEntries: (entries: ActivityEntry[]) => void;
};

const ACTIVITY_REFRESH_INTERVAL_MS = 10000;
const ACTIVITY_LIST_PAGE_SIZE = 5;
const ACTIVITY_EXECUTION_PREVIEW_LIMIT = 3;

const KIND_LABELS: Record<ActivityKind, string> = {
  runtime: "运行",
  build: "构建",
  branch: "分支",
  deploy: "构建",
  shortcut: "访达",
};

const STATUS_LABELS: Record<ActivityStatus, string> = {
  running: "进行中",
  success: "完成",
  failed: "失败",
  info: "记录",
};

const activityActionIconSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    width: 28,
    height: 28,
    borderRadius: "8px",
    border: dark ? "1px solid rgba(143,184,234,0.12)" : "1px solid rgba(52,76,96,0.09)",
    bgcolor: dark ? "rgba(13,18,25,0.48)" : "rgba(255,255,255,0.34)",
    color: "var(--accent)",
    flexShrink: 0,
    boxShadow: dark
      ? "inset 0 1px 0 rgba(255,255,255,0.025)"
      : "inset 0 1px 0 rgba(255,255,255,0.38)",
    "&:hover": {
      bgcolor: dark ? "rgba(20,29,40,0.62)" : "rgba(255,255,255,0.48)",
      borderColor: "var(--accent-border)",
      color: "var(--accent-hover)",
    },
  };
};

const activityHeaderIconSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    width: 28,
    height: 28,
    borderRadius: "8px",
    border: dark ? "1px solid rgba(226,232,240,0.065)" : "1px solid rgba(52,76,96,0.08)",
    bgcolor: dark ? "rgba(255,255,255,0.018)" : "rgba(255,255,255,0.28)",
    color: "var(--muted)",
    boxShadow: dark
      ? "inset 0 1px 0 rgba(255,255,255,0.018)"
      : "inset 0 1px 0 rgba(255,255,255,0.3)",
    "&:hover": {
      color: "var(--accent)",
      bgcolor: dark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.42)",
      borderColor: "var(--accent-border)",
    },
  };
};

const activityChipSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    height: 20,
    borderRadius: "7px",
    borderColor: dark ? "rgba(143,184,234,0.09)" : "rgba(52,76,96,0.09)",
    bgcolor: dark ? "rgba(13,18,25,0.38)" : "rgba(255,255,255,0.38)",
    "& .MuiChip-label": {
      px: 0.62,
      fontSize: "0.63rem",
      fontWeight: 780,
    },
  };
};

const activityRecordCardSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    border: "1px solid",
    borderRadius: "12px",
    px: 1.12,
    py: 1.16,
    bgcolor: dark ? "rgba(11,16,22,0.52)" : "rgba(255,255,255,0.52)",
    background: dark
      ? "linear-gradient(180deg, rgba(255,255,255,0.032), rgba(255,255,255,0.006) 68%), rgba(11,16,22,0.5)"
      : "linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.1) 74%), rgba(255,255,255,0.5)",
    borderColor: dark ? "rgba(143,184,234,0.1)" : "rgba(52,76,96,0.13)",
    boxShadow: dark
      ? "inset 0 1px 0 rgba(255,255,255,0.038), 0 4px 14px rgba(0,0,0,0.12)"
      : "inset 0 1px 0 rgba(255,255,255,0.56), 0 4px 14px rgba(24,48,62,0.03)",
    backdropFilter: "blur(22px) saturate(1.18)",
    WebkitBackdropFilter: "blur(22px) saturate(1.18)",
    transition: "border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease",
    "&:hover": {
      borderColor: dark ? "rgba(143,184,234,0.13)" : "rgba(92,112,133,0.18)",
      bgcolor: dark ? "rgba(14,20,28,0.62)" : "rgba(255,255,255,0.64)",
      background: dark
        ? "linear-gradient(180deg, rgba(255,255,255,0.044), rgba(255,255,255,0.008) 68%), rgba(14,20,28,0.58)"
        : "linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0.12) 74%), rgba(255,255,255,0.6)",
      boxShadow: dark
        ? "inset 0 1px 0 rgba(255,255,255,0.042), 0 6px 18px rgba(0,0,0,0.15)"
        : "inset 0 1px 0 rgba(255,255,255,0.6), 0 6px 18px rgba(24,48,62,0.04)",
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
          height: 21,
          px: 0.68,
          border: "1px solid var(--line-soft)",
          borderRadius: "7px",
          bgcolor: "var(--glass)",
          color: "var(--muted)",
          fontSize: "0.62rem",
          fontWeight: 760,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {KIND_LABELS[item.kind]}
      </Box>
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          height: 21,
          px: 0.7,
          border: "1px solid var(--line-soft)",
          borderRadius: "7px",
          color: statusTextColor,
          bgcolor: statusBg,
          fontSize: "0.62rem",
          fontWeight: 820,
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
      spacing={0.72}
      alignItems="stretch"
      minWidth={0}
      flex={1}
    >
      <Stack className="activity-title-line" direction="row" spacing={0.58} alignItems="center" minWidth={0}>
        <Box
          aria-hidden
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: item.acknowledgedAt ? "var(--muted)" : statusColor(item.status),
            boxShadow: item.status === "running" ? "0 0 0 3px var(--accent-soft)" : "none",
            flex: "0 0 auto",
          }}
        />
        <Typography
          variant="body2"
          fontWeight={790}
          noWrap
          title={item.title}
          sx={{
            minWidth: 0,
            flex: "1 1 auto",
            color: "var(--text)",
            fontSize: "0.83rem",
            lineHeight: 1.3,
            letterSpacing: 0,
          }}
        >
          {item.title}
        </Typography>
      </Stack>
      <Stack
        className="activity-title-details"
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={0.7}
        minWidth={0}
      >
        <Stack
          className="activity-title-tags"
          direction="row"
          spacing={0.4}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <ActivityStatusPill item={item} />
          {extraTags}
        </Stack>
        {meta ? (
          <Typography
            className="activity-card-meta"
            variant="caption"
            color="text.secondary"
            noWrap
            title={meta}
          >
            {meta}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
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
  return right.updatedAt.localeCompare(left.updatedAt);
}

function activityStepLabel(item: ActivityEntry) {
  return item.stepLabel || item.title;
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
  const prioritized = [...groupItems].sort(compareActivityPriority);
  const failedItems = groupItems.filter(isFailureActivity);
  const latest = items[0];
  return {
    id,
    items,
    latest,
    status: aggregateChainStatus(groupItems),
    failedItems,
    resourceItem:
      prioritized.find((item) => isUnhandledFailure(item) && item.resource) ??
      prioritized.find((item) => item.resource) ??
      null,
    targetItem:
      failedItems.find((item) => item.target) ??
      prioritized.find((item) => item.target) ??
      null,
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
              color: item.status === "failed" ? "var(--activity-danger)" : "var(--text)",
              fontSize: "0.66rem",
              fontWeight: item.status === "running" ? 820 : 740,
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
  onRefresh,
  onAcknowledgeEntry,
  onAcknowledgeEntries,
}: ActivityCenterProps) {
  const [filter, setFilter] = useState<ActivityFilter>("attention");
  const [listPage, setListPage] = useState(1);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
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

  const attentionItems = useMemo(
    () => items.filter(isVisibleRunningActivity),
    [items],
  );
  const failedItems = useMemo(
    () => items.filter(isFailureActivity),
    [items],
  );
  const unhandledFailedItems = useMemo(
    () => failedItems.filter(isUnhandledFailure),
    [failedItems],
  );
  const successItems = useMemo(
    () => items.filter((item) => item.status === "success"),
    [items],
  );
  const counts = useMemo(
    () => ({
      attention: attentionItems.length,
      all: items.length,
      running: items.filter(isVisibleRunningActivity).length,
      success: successItems.length,
      failed: failedItems.length,
    }),
    [
      attentionItems.length,
      failedItems.length,
      items,
      successItems.length,
    ],
  );
  const filterOptions = useMemo<Array<{ key: ActivityFilter; label: string; count: number }>>(
    () => [
      { key: "all", label: "全部", count: counts.all },
      { key: "attention", label: "待处理", count: counts.attention },
      { key: "success", label: "成功", count: counts.success },
      { key: "failed", label: "失败", count: counts.failed },
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
          failedCount: groupFailedItems.length,
          runningCount: groupItems.filter(isVisibleRunningActivity).length,
          total: groupItems.length,
        };
      })
      .sort((left, right) => {
        if (left.failedCount !== right.failedCount) {
          return right.failedCount - left.failedCount;
        }
        if (left.runningCount !== right.runningCount) {
          return right.runningCount - left.runningCount;
        }
        return right.latest.updatedAt.localeCompare(left.latest.updatedAt);
      });
  }, [attentionItems]);
  const attentionSummary = useMemo(
    () =>
      [
        counts.running ? `${counts.running} 个进行中` : "",
        counts.failed ? `${counts.failed} 个失败` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "没有待处理活动",
    [counts.failed, counts.running],
  );
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
    return items;
  }, [attentionItems, failedItems, filter, items, successItems]);
  const visibleUnits = useMemo(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const visibleChainIds = new Set(
      visibleItems.map((item) => item.chainId).filter((value): value is string => Boolean(value)),
    );
    const chainAwareItems =
      filter === "attention"
        ? visibleItems
        : items.filter(
            (item) => visibleIds.has(item.id) || (item.chainId && visibleChainIds.has(item.chainId)),
          );
    return buildActivityDisplayUnits(chainAwareItems);
  }, [filter, items, visibleItems]);
  const listPageCount = Math.max(
    1,
    Math.ceil(visibleUnits.length / ACTIVITY_LIST_PAGE_SIZE),
  );
  useEffect(() => {
    setListPage(1);
  }, [filter, open]);
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

  const content = (
    <>
      <Box
        className="activity-center-surface"
        sx={{
          py: { xs: 1.15, sm: 1.3 },
          pl: { xs: 1.05, sm: 1.15 },
          pr: { xs: 0.62, sm: 0.72 },
          pt: variant === "panel" ? "calc(var(--window-drag-height) + 18px)" : undefined,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Stack
          className="activity-center-header"
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1.15}
        >
          <Box className="activity-header-copy" minWidth={0}>
            <Typography
              variant="subtitle1"
              sx={{
                fontSize: "0.98rem",
                fontWeight: 820,
                lineHeight: 1.12,
                textWrap: "balance",
              }}
            >
              活动
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.16, fontSize: "0.68rem", lineHeight: 1.25 }}
            >
              {attentionSummary}
            </Typography>
          </Box>
          <Stack
            className="activity-header-actions"
            direction="row"
            spacing={0.3}
            sx={{ pt: variant === "panel" ? 0.1 : 0 }}
          >
            <Tooltip title="处理全部失败">
              <span>
                <IconButton
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
            <Tooltip title="关闭">
              <IconButton
                size="small"
                onClick={onClose}
                aria-label="关闭活动中心"
                sx={activityHeaderIconSx}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {queueGroups.length > 0 ? (
          <Box
            className="activity-queue-section"
            sx={{
              mt: 1.05,
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
                              color: "var(--text)",
                              fontSize: "0.83rem",
                              fontWeight: 790,
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
                            {group.runningCount > 0 ? (
                              <Chip
                                size="small"
                                label={`进行中 ${group.runningCount}`}
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
                        {group.resourceItem || group.targetItem || group.failedItems.length > 0 ? (
                          <Stack className="activity-card-actions" direction="row" spacing={0.42} flexShrink={0}>
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
                                  <LocateIcon fontSize="small" />
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
                        color="text.secondary"
                        sx={{
                          display: "-webkit-box",
                          mt: 0.42,
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

        <Box
          className="activity-filter-strip"
          sx={{
            mt: queueGroups.length > 0 ? 0.88 : 1.05,
            mb: 0.82,
            p: 0.38,
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 0.4,
          }}
        >
          {filterOptions.map((item) => (
            <Chip
              key={item.key}
              size="small"
              label={(
                <Box component="span" className="activity-filter-label">
                  <Box component="span">{item.label}</Box>
                  <Box component="span" className="activity-filter-count">
                    {item.count}
                  </Box>
                </Box>
              )}
              variant={filter === item.key ? "filled" : "outlined"}
              color={filter === item.key ? "primary" : "default"}
              onClick={() => setFilter(item.key as ActivityFilter)}
              sx={(theme) => {
                const dark = theme.palette.mode === "dark";
                const active = filter === item.key;
                return {
                  height: 25,
                  borderRadius: "7px",
                  borderColor: active
                    ? "var(--accent-border)"
                    : "transparent",
                  bgcolor: active
                    ? dark
                      ? "rgba(143,184,234,0.18)"
                      : "rgba(92,112,133,0.72)"
                    : "transparent",
                  color: active
                    ? dark
                      ? "var(--accent-hover)"
                      : "#ffffff"
                    : undefined,
                  backdropFilter: "blur(18px) saturate(1.16)",
                  WebkitBackdropFilter: "blur(18px) saturate(1.16)",
                  "& .MuiChip-label": {
                    px: 0.72,
                    fontSize: "0.64rem",
                    fontWeight: 760,
                  },
                };
              }}
            />
          ))}
        </Box>

        <Divider className="activity-list-divider" sx={{ borderColor: "var(--line-soft)", opacity: 0.78 }} />

        <Stack
          className="activity-list-scroll"
          spacing={0.9}
          sx={{
            mt: 0.72,
            mb: 0.52,
            p: 0.15,
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
              "color-mix(in srgb, var(--muted) 34%, transparent) color-mix(in srgb, var(--muted) 8%, transparent)",
            transition: "scrollbar-color 140ms ease",
            "&:hover": {
              scrollbarColor:
                "color-mix(in srgb, var(--muted) 48%, transparent) color-mix(in srgb, var(--muted) 8%, transparent)",
            },
            "&::-webkit-scrollbar": {
              width: 6,
              height: 6,
            },
            "&::-webkit-scrollbar-track": {
              background: "color-mix(in srgb, var(--muted) 8%, transparent)",
              borderRadius: "999px",
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "color-mix(in srgb, var(--muted) 34%, transparent)",
              borderRadius: "999px",
              border: "2px solid transparent",
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
            <Box
              sx={{
                border: "1px dashed var(--line)",
                borderRadius: 2,
                p: 2,
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              {filter === "attention" ? "当前没有待处理活动。" : "暂无匹配的活动记录。"}
            </Box>
          ) : (
            paginatedUnits.map((unit) => {
              if (unit.type === "chain") {
                const { group } = unit;
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
                    className="activity-record-card"
                    key={group.id}
                    sx={activityRecordCardSx}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={0.78}>
                      <Box
                        sx={{
                          width: 2,
                          alignSelf: "stretch",
                          minHeight: 58,
                          borderRadius: 999,
                          bgcolor: statusColor(group.status),
                          opacity: 0.7,
                          flexShrink: 0,
                        }}
                      />
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
                            meta={[
                              group.primary.projectName || group.primary.projectKey,
                              formatActivityTime(group.latest.updatedAt),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          />
                          {group.targetItem || group.resourceItem || unhandledGroupFailures.length > 0 ? (
                            <Stack className="activity-card-actions" direction="row" spacing={0.4} flexShrink={0}>
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
                                    <LocateIcon fontSize="small" />
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
                            </Stack>
                          ) : null}
                        </Stack>
                        <ActivityChainTrail items={group.items} />
                        <Stack
                          className="activity-detail-stack"
                          spacing={0.52}
                          sx={{
                            mt: 0.86,
                            pl: 0.9,
                          }}
                        >
                          {group.items.map((item) => (
                            <Box
                              key={item.id}
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "62px minmax(0, 1fr)",
                                gap: 0.65,
                                alignItems: "baseline",
                              }}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  color: statusColor(item.status),
                                  fontSize: "0.63rem",
                                  fontWeight: 800,
                                }}
                              >
                                {activityStepLabel(item)}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "var(--muted)",
                                  overflowWrap: "anywhere",
                                  fontSize: "0.65rem",
                                  lineHeight: 1.52,
                                }}
                              >
                                {displayActivitySummary(item) || item.detail || STATUS_LABELS[item.status]}
                              </Typography>
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                    </Stack>
                  </Box>
                );
              }
              if (unit.type === "execution") {
                const { group } = unit;
                const unhandledGroupFailures = group.failedItems.filter(isUnhandledFailure);
                const groupAcknowledgedAt =
                  group.status === "failed" &&
                  group.failedItems.length > 0 &&
                  unhandledGroupFailures.length === 0
                    ? group.failedItems[0].acknowledgedAt ?? null
                    : null;
                const headlineItem: ActivityEntry = {
                  ...group.latest,
                  status: group.status,
                  acknowledgedAt: groupAcknowledgedAt,
                };
                return (
                  <Box
                    className="activity-record-card"
                    key={group.id}
                    sx={activityRecordCardSx}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={0.78}>
                      <Box
                        sx={{
                          width: 2,
                          alignSelf: "stretch",
                          minHeight: 58,
                          borderRadius: 999,
                          bgcolor: statusColor(group.status),
                          opacity: 0.7,
                          flexShrink: 0,
                        }}
                      />
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
                            meta={[
                              group.latest.projectName || group.latest.projectKey,
                              formatActivityTime(group.latest.updatedAt),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            extraTags={(
                              <Chip
                                size="small"
                                label={`执行 ${group.executionCount} 次`}
                                variant="outlined"
                                sx={activityChipSx}
                              />
                            )}
                          />
                          {group.resourceItem || group.targetItem || unhandledGroupFailures.length > 0 ? (
                            <Stack className="activity-card-actions" direction="row" spacing={0.4} flexShrink={0}>
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
                                    <LocateIcon fontSize="small" />
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
                            </Stack>
                          ) : null}
                        </Stack>
                        <Stack
                          className="activity-detail-stack"
                          spacing={0.52}
                          sx={{
                            mt: 0.86,
                            pl: 0.9,
                          }}
                        >
                          {group.items
                            .slice(0, ACTIVITY_EXECUTION_PREVIEW_LIMIT)
                            .map((item, index) => (
                            <Box
                              key={item.id}
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "58px minmax(0, 1fr)",
                                gap: 0.65,
                                alignItems: "baseline",
                              }}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  color: statusColor(item.status),
                                  fontSize: "0.63rem",
                                  fontWeight: 800,
                                }}
                              >
                                第{group.executionCount - index}次
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "var(--muted)",
                                  overflowWrap: "anywhere",
                                  fontSize: "0.65rem",
                                  lineHeight: 1.52,
                                }}
                              >
                                {[
                                  activityStatusLabel(item),
                                  formatActivityTime(item.updatedAt),
                                  displayActivitySummary(item) ||
                                    item.detail ||
                                    STATUS_LABELS[item.status],
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </Typography>
                            </Box>
                          ))}
                          {group.items.length > ACTIVITY_EXECUTION_PREVIEW_LIMIT ? (
                            <Typography
                              variant="caption"
                              sx={{
                                color: "var(--muted)",
                                fontSize: "0.65rem",
                                fontWeight: 760,
                                pl: "58px",
                              }}
                            >
                              还有 {group.items.length - ACTIVITY_EXECUTION_PREVIEW_LIMIT} 次记录
                            </Typography>
                          ) : null}
                        </Stack>
                      </Box>
                    </Stack>
                  </Box>
                );
              }
              const item = unit.item;
              return (
                <Box
                  className="activity-record-card"
                  key={item.id}
                  sx={activityRecordCardSx}
                >
                <Stack direction="row" alignItems="flex-start" spacing={0.72}>
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
                        meta={[
                          item.projectName || item.projectKey,
                          formatActivityTime(item.updatedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                      {item.target || item.resource || isUnhandledFailure(item) ? (
                        <Stack className="activity-card-actions" direction="row" spacing={0.4} flexShrink={0}>
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
                                <LocateIcon fontSize="small" />
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
                        sx={{
                          display: "-webkit-box",
                          mt: 0.7,
                          color: "var(--text)",
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          fontSize: "0.74rem",
                          fontWeight: 720,
                          lineHeight: 1.5,
                        }}
                      >
                        {displayActivitySummary(item)}
                      </Typography>
                    ) : null}
                    {item.detail ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: "-webkit-box",
                          mt: 0.58,
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          fontSize: "0.66rem",
                          lineHeight: 1.46,
                        }}
                        title={item.detail ?? undefined}
                      >
                        {item.detail}
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
              sx={{ fontSize: "0.66rem", fontWeight: 720, whiteSpace: "nowrap" }}
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
                    minWidth: 26,
                    height: 26,
                    borderRadius: "9px",
                    fontSize: "0.7rem",
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
                sx={{ fontSize: "0.66rem", fontWeight: 720, whiteSpace: "nowrap" }}
              >
                本页已全部显示
              </Typography>
            )}
          </Stack>
        ) : null}
      </Box>
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
          height: "100%",
          maxHeight: "100%",
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
          width: { xs: "min(334px, 100vw)", sm: "clamp(306px, 33vw, 334px)" },
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
