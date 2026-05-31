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
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  ActivityEntry,
  ActivityKind,
  ActivityStatus,
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

type ActivityCenterProps = {
  open: boolean;
  items: ActivityEntry[];
  onClose: () => void;
  onClear: () => void;
  onOpenEntry: (entry: ActivityEntry) => void;
  onOpenResource: (entry: ActivityEntry) => void;
  onRefresh: () => Promise<void> | void;
  onAcknowledgeEntry: (entry: ActivityEntry) => void;
  onAcknowledgeEntries: (entries: ActivityEntry[]) => void;
};

const ACTIVITY_REFRESH_INTERVAL_MS = 10000;

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
  width: 26,
  height: 26,
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
  width: 30,
  height: 30,
  color: "var(--muted)",
  "&:hover": {
    color: "var(--accent)",
    bgcolor: "var(--accent-soft)",
  },
};

const activityChipSx = {
  height: 18,
  borderRadius: "999px",
  borderColor: "var(--line-soft)",
  "& .MuiChip-label": {
    px: 0.6,
    fontSize: "0.62rem",
    fontWeight: 760,
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
        fontWeight={780}
        noWrap
        title={item.title}
        sx={{
          minWidth: 0,
          flex: "1 1 auto",
          color: "var(--text)",
          lineHeight: 1.25,
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

function isUnhandledFailure(item: ActivityEntry) {
  return item.status === "failed" && !item.acknowledgedAt;
}

function isDeploySyncFailure(item: ActivityEntry) {
  return item.status === "failed" && item.summary.startsWith("状态同步失败");
}

function isRefreshableDeployActivity(item: ActivityEntry) {
  return item.kind === "deploy" && (item.status === "running" || isDeploySyncFailure(item));
}

function queueGroupKey(item: ActivityEntry) {
  return item.projectKey || item.projectName || item.kind;
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

export function ActivityCenter({
  open,
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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const hasRefreshableDeployActivity = useMemo(
    () => items.some(isRefreshableDeployActivity),
    [items],
  );
  const runRefresh = useCallback(async () => {
    if (!hasRefreshableDeployActivity || refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [hasRefreshableDeployActivity, onRefresh]);

  useEffect(() => {
    if (!open || !hasRefreshableDeployActivity) {
      return;
    }
    void runRefresh();
    const timer = window.setInterval(() => {
      void runRefresh();
    }, ACTIVITY_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasRefreshableDeployActivity, open, runRefresh]);

  const attentionItems = useMemo(
    () => items.filter((item) => isUnhandledFailure(item) || item.status === "running"),
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
        .filter((item) => item.status === "failed" && item.acknowledgedAt)
        .sort((left, right) =>
          (right.acknowledgedAt ?? "").localeCompare(left.acknowledgedAt ?? ""),
        ),
    [items],
  );
  const counts = useMemo(
    () => ({
      attention: attentionItems.length,
      all: items.length,
      running: items.filter((item) => item.status === "running").length,
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
          runningCount: groupItems.filter((item) => item.status === "running").length,
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
      return items.filter((item) => item.status === "running");
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
  const visibleQueueGroups = queueGroups.slice(0, 4);
  const hiddenQueueCount = Math.max(0, queueGroups.length - visibleQueueGroups.length);
  const handleClearConfirmed = () => {
    onClear();
    setClearConfirmOpen(false);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: 392 },
          maxWidth: "100vw",
          height: "100dvh",
          overflow: "hidden",
          bgcolor: "var(--panel-strong)",
          color: "var(--text)",
          borderLeft: "1px solid var(--line)",
        },
      }}
    >
      <Box
        sx={{
          p: { xs: 1.5, sm: 1.6 },
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box minWidth={0}>
            <Typography variant="subtitle1" fontWeight={820} lineHeight={1.15}>
              活动
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.2, fontSize: "0.68rem" }}
            >
              {attentionSummary}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="刷新部署状态">
              <span>
                <IconButton
                  size="small"
                  onClick={() => void runRefresh()}
                  disabled={!hasRefreshableDeployActivity || refreshing}
                  aria-label="刷新部署状态"
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
                  {queueGroups.length} 个项目需要关注
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
                    px: 0.9,
                    py: 0.75,
                    borderRadius: 1.3,
                    border: "1px solid var(--line-soft)",
                    bgcolor: "var(--panel)",
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
                          <Typography variant="body2" fontWeight={780} sx={{ overflowWrap: "anywhere" }}>
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
                          display: "block",
                          mt: 0.25,
                          overflowWrap: "anywhere",
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
                    还有 {hiddenQueueCount} 个待处理项目在下方列表中
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
            py: 0.9,
            pr: 0.8,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            scrollbarGutter: "stable",
          }}
        >
          {visibleItems.length === 0 ? (
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
            visibleItems.map((item) => (
              <Box
                key={item.id}
                sx={{
                  border: "1px solid var(--line-soft)",
                  borderRadius: 1.4,
                  px: 1,
                  py: 0.85,
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
                          display: "block",
                          mt: 0.35,
                          color: "var(--text)",
                          overflowWrap: "anywhere",
                          fontSize: "0.7rem",
                          fontWeight: 640,
                          lineHeight: 1.38,
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
            ))
          )}
        </Stack>
      </Box>
      <Dialog
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: "var(--panel-strong)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: 2,
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
    </Drawer>
  );
}
