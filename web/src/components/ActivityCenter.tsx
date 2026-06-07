import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DEPLOY_STATUS_SYNC_MAX_FAILURES,
  activityExecutionKey,
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

type ActivityFilter =
  | "attention"
  | "all"
  | "running"
  | "success"
  | "failed"
  | "handled"
  | "info";

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
const ACTIVITY_LIST_PAGE_SIZE = 6;

const KIND_LABELS: Record<ActivityKind, string> = {
  runtime: "运行",
  build: "构建",
  branch: "分支",
  deploy: "部署",
  shortcut: "访达",
};

const STATUS_LABELS: Record<ActivityStatus, string> = {
  running: "进行中",
  success: "完成",
  failed: "失败",
  info: "记录",
};

const activityActionIconSx = {
  width: 28,
  height: 28,
  borderRadius: "999px",
  border: "1px solid var(--line-soft)",
  bgcolor: "transparent",
  color: "var(--accent)",
  flexShrink: 0,
  "&:hover": {
    bgcolor: "var(--accent-soft)",
    borderColor: "var(--accent-border)",
  },
};

const activityHeaderIconSx = {
  width: 32,
  height: 32,
  color: "var(--muted)",
  "&:hover": {
    color: "var(--accent)",
    bgcolor: "var(--accent-soft)",
  },
};

const activityChipSx = {
  height: 20,
  borderRadius: "999px",
  borderColor: "var(--line-soft)",
  "& .MuiChip-label": {
    px: 0.65,
    fontSize: "0.66rem",
    fontWeight: 780,
  },
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
    return "var(--danger)";
  }
  if (status === "running") {
    return "var(--accent)";
  }
  if (status === "success") {
    return "var(--success)";
  }
  return "var(--muted)";
}

function statusTint(status: ActivityStatus) {
  if (status === "failed") {
    return "rgba(194,65,65,0.055)";
  }
  if (status === "running") {
    return "var(--accent-soft)";
  }
  if (status === "success") {
    return "rgba(19,138,86,0.055)";
  }
  return "rgba(63,72,87,0.025)";
}

function activityStatusLabel(item: ActivityEntry) {
  if (item.status === "failed" && item.summary.startsWith("状态同步失败")) {
    if ((item.syncFailureCount ?? 0) >= DEPLOY_STATUS_SYNC_MAX_FAILURES) {
      return "停止重试";
    }
    return "同步失败";
  }
  return STATUS_LABELS[item.status];
}

function ActivityStatusPill({ item }: { item: ActivityEntry }) {
  const statusLabel = item.acknowledgedAt ? "已确认" : activityStatusLabel(item);
  const statusTextColor = item.acknowledgedAt ? "var(--muted)" : statusColor(item.status);
  const statusBg = item.acknowledgedAt ? "rgba(63,72,87,0.035)" : statusTint(item.status);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.35,
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
          px: 0.62,
          border: "1px solid var(--line-soft)",
          borderRadius: "999px",
          bgcolor: "rgba(63,72,87,0.025)",
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
          height: 20,
          px: 0.66,
          border: "1px solid var(--line-soft)",
          borderRadius: "999px",
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

function ActivityTitleCluster({ item }: { item: ActivityEntry }) {
  return (
    <Stack
      direction="row"
      spacing={0.65}
      alignItems="center"
      minWidth={0}
      flex={1}
    >
      <Box
        aria-hidden
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: item.acknowledgedAt ? "var(--muted)" : statusColor(item.status),
          boxShadow: item.status === "running" ? "0 0 0 3px var(--accent-soft)" : "none",
          flex: "0 0 auto",
        }}
      />
      <Typography
        variant="body2"
        fontWeight={820}
        noWrap
        title={item.title}
        sx={{
          minWidth: 0,
          flex: "1 1 auto",
          color: "var(--text)",
          fontSize: "0.82rem",
          lineHeight: 1.22,
          letterSpacing: 0,
        }}
      >
        {item.title}
      </Typography>
      <ActivityStatusPill item={item} />
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

function isDeploySyncFailure(item: ActivityEntry) {
  return item.status === "failed" && item.summary.startsWith("状态同步失败");
}

function isDeploySyncNotice(item: ActivityEntry) {
  return (
    item.kind === "deploy" &&
    (item.summary.startsWith("状态同步失败") ||
      item.summary === "同步 Jenkins 状态中…")
  );
}

function isVisibleRunningActivity(item: ActivityEntry) {
  return item.status === "running" && !isDeploySyncNotice(item);
}

function isUnhandledFailure(item: ActivityEntry) {
  return item.status === "failed" && !item.acknowledgedAt && !isDeploySyncNotice(item);
}

function isAutoRefreshableDeployActivity(item: ActivityEntry) {
  return item.kind === "deploy" && isVisibleRunningActivity(item);
}

function isManualRefreshableDeployActivity(item: ActivityEntry) {
  return item.kind === "deploy" && (item.status === "running" || isDeploySyncFailure(item));
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
  if (items.some((item) => isUnhandledFailure(item))) {
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
  const failedItems = groupItems.filter(isUnhandledFailure);
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
    const failedItems = chainItems.filter(isUnhandledFailure);
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
      direction="row"
      alignItems="center"
      flexWrap="wrap"
      rowGap={0.35}
      columnGap={0.45}
      sx={{ mt: 0.6, color: "var(--muted)" }}
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
              color: item.status === "failed" ? "var(--danger)" : "var(--text)",
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
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const hasAutoRefreshableDeployActivity = useMemo(
    () => items.some(isAutoRefreshableDeployActivity),
    [items],
  );
  const hasManualRefreshableDeployActivity = useMemo(
    () => items.some(isManualRefreshableDeployActivity),
    [items],
  );
  const runRefresh = useCallback(async (options: { force?: boolean } = {}) => {
    const canRefresh = options.force
      ? hasManualRefreshableDeployActivity
      : hasAutoRefreshableDeployActivity;
    if (!canRefresh || refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await onRefresh(options);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [hasAutoRefreshableDeployActivity, hasManualRefreshableDeployActivity, onRefresh]);

  useEffect(() => {
    if (!open || !hasAutoRefreshableDeployActivity) {
      return;
    }
    void runRefresh();
    const timer = window.setInterval(() => {
      void runRefresh();
    }, ACTIVITY_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasAutoRefreshableDeployActivity, open, runRefresh]);

  const attentionItems = useMemo(
    () => items.filter((item) => isUnhandledFailure(item) || isVisibleRunningActivity(item)),
    [items],
  );
  const failedItems = useMemo(
    () => items.filter(isUnhandledFailure),
    [items],
  );
  const successItems = useMemo(
    () => items.filter((item) => item.status === "success"),
    [items],
  );
  const infoItems = useMemo(
    () => items.filter((item) => item.status === "info"),
    [items],
  );
  const handledItems = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.status === "failed" &&
            item.acknowledgedAt &&
            !isDeploySyncFailure(item),
        )
        .sort((left, right) =>
          (right.acknowledgedAt ?? "").localeCompare(left.acknowledgedAt ?? ""),
        ),
    [items],
  );
  const counts = useMemo(
    () => ({
      attention: attentionItems.length,
      all: items.length,
      running: items.filter(isVisibleRunningActivity).length,
      success: successItems.length,
      failed: failedItems.length,
      handled: handledItems.length,
      info: infoItems.length,
    }),
    [
      attentionItems.length,
      failedItems.length,
      handledItems.length,
      infoItems.length,
      items,
      successItems.length,
    ],
  );
  const filterOptions = useMemo(() => {
    const options: Array<{ key: ActivityFilter; label: string; count: number }> = [];
    if (counts.attention > 0) {
      options.push({ key: "attention", label: "待处理", count: counts.attention });
    }
    options.push({ key: "all", label: "全部", count: counts.all });
    if (counts.running > 0) {
      options.push({ key: "running", label: "进行中", count: counts.running });
    }
    if (counts.failed > 0) {
      options.push({ key: "failed", label: "失败", count: counts.failed });
    }
    if (counts.success > 0) {
      options.push({ key: "success", label: "完成", count: counts.success });
    }
    if (counts.info > 0) {
      options.push({ key: "info", label: "记录", count: counts.info });
    }
    if (counts.handled > 0) {
      options.push({ key: "handled", label: "已确认", count: counts.handled });
    }
    return options;
  }, [counts]);
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
        counts.failed ? `${counts.failed} 个失败` : "",
        counts.running ? `${counts.running} 个进行中` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "没有待处理活动",
    [counts.failed, counts.running],
  );
  const visibleItems = useMemo(() => {
    if (filter === "attention") {
      return attentionItems;
    }
    if (filter === "running") {
      return items.filter(isVisibleRunningActivity);
    }
    if (filter === "success") {
      return successItems;
    }
    if (filter === "failed") {
      return failedItems;
    }
    if (filter === "handled") {
      return handledItems;
    }
    if (filter === "info") {
      return infoItems;
    }
    return items;
  }, [attentionItems, failedItems, filter, handledItems, infoItems, items, successItems]);
  const visibleUnits = useMemo(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const visibleChainIds = new Set(
      visibleItems.map((item) => item.chainId).filter((value): value is string => Boolean(value)),
    );
    const chainAwareItems = items.filter(
      (item) => visibleIds.has(item.id) || (item.chainId && visibleChainIds.has(item.chainId)),
    );
    return buildActivityDisplayUnits(chainAwareItems);
  }, [items, visibleItems]);
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
  const handleClearConfirmed = () => {
    onClear();
    setClearConfirmOpen(false);
  };

  const content = (
    <>
      <Box
        className="activity-center-surface"
        sx={{
          p: { xs: 1.6, sm: 1.85 },
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box minWidth={0}>
            <Typography
              variant="subtitle1"
              sx={{
                fontSize: "1.02rem",
                fontWeight: 860,
                lineHeight: 1.12,
                textWrap: "balance",
              }}
            >
              活动
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.25, fontSize: "0.72rem", lineHeight: 1.3 }}
            >
              {attentionSummary}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="刷新活动状态">
              <span>
                <IconButton
                  size="small"
                  onClick={() => void runRefresh({ force: true })}
                  disabled={!hasManualRefreshableDeployActivity || refreshing}
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
            sx={{
              mt: 1.2,
              pb: 0.85,
              borderBottom: "1px solid var(--line)",
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
              <Stack direction="row" spacing={0.55} alignItems="baseline" minWidth={0}>
                <Typography
                  variant="caption"
                  sx={{ flexShrink: 0, color: "var(--muted)", fontWeight: 760 }}
                >
                  待处理队列
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ minWidth: 0, fontSize: "0.68rem" }}
                >
                  {queueGroups.length} 个分组需要关注
                </Typography>
              </Stack>
              <Chip
                size="small"
                label={`${counts.attention}`}
                color={counts.failed > 0 ? "error" : "primary"}
                variant="filled"
                sx={{ height: 18, borderRadius: 1.2, "& .MuiChip-label": { px: 0.6, fontSize: "0.62rem" } }}
              />
            </Stack>

            <Stack spacing={0.65} sx={{ mt: 0.8 }}>
              {visibleQueueGroups.map((group) => (
                <Box
                  key={group.id}
                  sx={{
                    px: 1,
                    py: 0.85,
                    borderRadius: 1.5,
                    border: "1px solid var(--line-soft)",
                    bgcolor: "var(--panel)",
                    boxShadow: "0 1px 0 rgba(20,31,50,0.025)",
                  }}
                >
                  <Stack direction="row" spacing={0.8} alignItems="flex-start">
                    <Box
                      sx={{
                        width: 3,
                        alignSelf: "stretch",
                        minHeight: 38,
                        borderRadius: 999,
                        bgcolor: group.failedCount > 0 ? "var(--danger)" : "var(--accent)",
                      }}
                    />
                    <Box minWidth={0} flex={1}>
                      <Stack
                        direction="row"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        spacing={0.8}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.6}
                          flexWrap="wrap"
                          rowGap={0.5}
                          minWidth={0}
                          flex={1}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              color: "var(--text)",
                              fontSize: "0.84rem",
                              fontWeight: 830,
                              lineHeight: 1.22,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {group.label}
                          </Typography>
                          {group.failedCount > 0 ? (
                            <Chip
                              size="small"
                              label={`失败 ${group.failedCount}`}
                              variant="outlined"
                              sx={{ ...activityChipSx, color: "var(--danger)" }}
                            />
                          ) : null}
                          {group.runningCount > 0 ? (
                            <Chip
                              size="small"
                              label={`进行中 ${group.runningCount}`}
                              variant="outlined"
                              sx={{ ...activityChipSx, color: "var(--accent)" }}
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
                        {group.resourceItem || group.targetItem || group.failedItems.length > 0 ? (
                          <Stack direction="row" spacing={0.35} flexShrink={0}>
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
                          mt: 0.25,
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          fontSize: "0.66rem",
                          lineHeight: 1.35,
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

        <Stack
          direction="row"
          spacing={0.55}
          useFlexGap
          sx={{
            mt: queueGroups.length > 0 ? 1.05 : 1.15,
            mb: 1.05,
            flexWrap: "wrap",
            rowGap: 0.55,
          }}
        >
          {filterOptions.map((item) => (
            <Chip
              key={item.key}
              size="small"
              label={`${item.label} ${item.count}`}
              variant={filter === item.key ? "filled" : "outlined"}
              color={filter === item.key ? "primary" : "default"}
              onClick={() => setFilter(item.key as ActivityFilter)}
              sx={{
                height: 23,
                borderRadius: "999px",
                borderColor: "var(--line)",
                bgcolor: filter === item.key ? undefined : "var(--panel)",
                "& .MuiChip-label": {
                  px: 0.75,
                  fontSize: "0.66rem",
                  fontWeight: 760,
                },
              }}
            />
          ))}
        </Stack>

        <Divider sx={{ borderColor: "var(--line)" }} />

        <Stack
          spacing={0.9}
          sx={{
            mt: 0.85,
            mb: 0.7,
            p: 0.65,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            border: "1px solid var(--line-soft)",
            borderRadius: 1.6,
            bgcolor: "rgba(42,82,132,0.025)",
            scrollbarWidth: "thin",
            scrollbarColor: "transparent transparent",
            transition: "scrollbar-color 140ms ease",
            "&:hover": {
              scrollbarColor: "color-mix(in srgb, var(--muted) 28%, transparent) transparent",
            },
            "&::-webkit-scrollbar": {
              width: 7,
              height: 7,
            },
            "&::-webkit-scrollbar-track": {
              background: "transparent",
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "transparent",
              borderRadius: "999px",
              border: "2px solid transparent",
              backgroundClip: "padding-box",
            },
            "&:hover::-webkit-scrollbar-thumb": {
              backgroundColor: "color-mix(in srgb, var(--muted) 28%, transparent)",
            },
            "&:hover::-webkit-scrollbar-thumb:hover": {
              backgroundColor: "color-mix(in srgb, var(--muted) 42%, transparent)",
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
                const headlineItem: ActivityEntry = {
                  ...group.latest,
                  kind: group.primary.kind,
                  title: group.primary.title,
                  status: group.status,
                  acknowledgedAt:
                    group.status === "failed" ? group.latest.acknowledgedAt : null,
                };
                return (
                  <Box
                    key={group.id}
                    sx={{
                      border: "1px solid var(--line-soft)",
                      borderRadius: 1.5,
                      px: 1.05,
                      py: 0.95,
                      bgcolor: "var(--panel)",
                      boxShadow: "0 1px 0 rgba(20,31,50,0.03)",
                      transition: "border-color 120ms ease, background-color 120ms ease",
                      "&:hover": {
                        borderColor: "var(--accent-border)",
                        bgcolor: "var(--panel-strong)",
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={0.75}>
                      <Box
                        sx={{
                          width: 3,
                          alignSelf: "stretch",
                          minHeight: 68,
                          borderRadius: 999,
                          bgcolor: statusColor(group.status),
                          flexShrink: 0,
                        }}
                      />
                      <Box minWidth={0} flex={1}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={0.8}
                        >
                          <ActivityTitleCluster item={headlineItem} />
                          {group.targetItem || group.resourceItem || group.failedItems.length > 0 ? (
                            <Stack direction="row" spacing={0.35} flexShrink={0}>
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
                            display: "block",
                            mt: 0.35,
                            overflowWrap: "anywhere",
                            fontSize: "0.68rem",
                            lineHeight: 1.35,
                          }}
                        >
                          {[group.primary.projectName || group.primary.projectKey, formatActivityTime(group.latest.updatedAt)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                        <ActivityChainTrail items={group.items} />
                        <Stack
                          spacing={0.35}
                          sx={{
                            mt: 0.65,
                            pl: 0.2,
                          }}
                        >
                          {group.items.map((item) => (
                            <Box
                              key={item.id}
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "74px minmax(0, 1fr)",
                                gap: 0.7,
                                alignItems: "baseline",
                              }}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  color: statusColor(item.status),
                                  fontSize: "0.62rem",
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
                                  fontSize: "0.64rem",
                                  lineHeight: 1.35,
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
                const headlineItem: ActivityEntry = {
                  ...group.latest,
                  status: group.status,
                  acknowledgedAt:
                    group.status === "failed" ? group.latest.acknowledgedAt : null,
                };
                return (
                  <Box
                    key={group.id}
                    sx={{
                      border: "1px solid var(--line-soft)",
                      borderRadius: 1.5,
                      px: 1.05,
                      py: 0.95,
                      bgcolor: "var(--panel)",
                      boxShadow: "0 1px 0 rgba(20,31,50,0.03)",
                      transition: "border-color 120ms ease, background-color 120ms ease",
                      "&:hover": {
                        borderColor: "var(--accent-border)",
                        bgcolor: "var(--panel-strong)",
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={0.75}>
                      <Box
                        sx={{
                          width: 3,
                          alignSelf: "stretch",
                          minHeight: 68,
                          borderRadius: 999,
                          bgcolor: statusColor(group.status),
                          flexShrink: 0,
                        }}
                      />
                      <Box minWidth={0} flex={1}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={0.8}
                        >
                          <ActivityTitleCluster item={headlineItem} />
                          <Stack direction="row" spacing={0.35} flexShrink={0}>
                            <Chip
                              size="small"
                              label={`执行 ${group.executionCount} 次`}
                              variant="outlined"
                              sx={activityChipSx}
                            />
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
                        </Stack>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: "block",
                            mt: 0.35,
                            overflowWrap: "anywhere",
                            fontSize: "0.68rem",
                            lineHeight: 1.35,
                          }}
                        >
                          {[group.latest.projectName || group.latest.projectKey, formatActivityTime(group.latest.updatedAt)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                        {displayActivitySummary(group.latest) ? (
                          <Typography
                            variant="caption"
                            sx={{
                              display: "-webkit-box",
                              mt: 0.35,
                              color: "var(--text)",
                              overflow: "hidden",
                              overflowWrap: "anywhere",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: 2,
                              fontSize: "0.74rem",
                              fontWeight: 720,
                              lineHeight: 1.42,
                            }}
                          >
                            {displayActivitySummary(group.latest)}
                          </Typography>
                        ) : null}
                        <Stack
                          spacing={0.35}
                          sx={{
                            mt: 0.65,
                            pl: 0.2,
                          }}
                        >
                          {group.items.map((item, index) => (
                            <Box
                              key={item.id}
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "54px minmax(0, 1fr)",
                                gap: 0.7,
                                alignItems: "baseline",
                              }}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  color: statusColor(item.status),
                                  fontSize: "0.62rem",
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
                                  fontSize: "0.64rem",
                                  lineHeight: 1.35,
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
                        </Stack>
                      </Box>
                    </Stack>
                  </Box>
                );
              }
              const item = unit.item;
              return (
              <Box
                key={item.id}
                    sx={{
                      border: "1px solid var(--line-soft)",
                      borderRadius: 1.5,
                      px: 1.05,
                      py: 0.95,
                      bgcolor: "var(--panel)",
                      boxShadow: "0 1px 0 rgba(20,31,50,0.03)",
                  transition: "border-color 120ms ease, background-color 120ms ease",
                  "&:hover": {
                    borderColor: "var(--accent-border)",
                    bgcolor: "var(--panel-strong)",
                  },
                }}
              >
                <Stack direction="row" alignItems="flex-start" spacing={0.75}>
                  <Box minWidth={0} flex={1}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={0.8}
                    >
                      <ActivityTitleCluster item={item} />
                      {item.target || item.resource || isUnhandledFailure(item) ? (
                        <Stack direction="row" spacing={0.35} flexShrink={0}>
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
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: "block",
                        mt: 0.35,
                        overflowWrap: "anywhere",
                        fontSize: "0.65rem",
                        lineHeight: 1.35,
                      }}
                    >
                      {[item.projectName || item.projectKey, formatActivityTime(item.updatedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                    {displayActivitySummary(item) ? (
                      <Typography
                        variant="caption"
                        sx={{
                          display: "-webkit-box",
                          mt: 0.35,
                          color: "var(--text)",
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          fontSize: "0.74rem",
                          fontWeight: 720,
                          lineHeight: 1.42,
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
                          mt: 0.35,
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          fontSize: "0.65rem",
                          lineHeight: 1.4,
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
              py: 0.72,
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
                    minWidth: 28,
                    height: 28,
                    borderRadius: "10px",
                    fontSize: "0.72rem",
                    fontWeight: 820,
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
          这会移除当前活动中心里的运行、构建、分支和部署记录。
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
          bgcolor: "var(--panel-strong)",
          color: "var(--text)",
          borderLeft: "1px solid var(--line)",
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
          width: { xs: "min(420px, 100vw)", sm: 420 },
          maxWidth: "100vw",
          top: drawerTopOffset,
          right: 0,
          bottom: 0,
          height: `calc(100dvh - ${drawerTopOffset})`,
          overflow: "hidden",
          bgcolor: "var(--panel-strong)",
          color: "var(--text)",
          borderLeft: "1px solid var(--line)",
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
