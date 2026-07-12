import { useEffect, useMemo, useState, type UIEvent } from "react";
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { BranchTaskHistoryEntry } from "../../app-types";
import type { TrayPinnedAction } from "../../lib/trayPins";
import { AppEmptyState } from "../AppEmptyState";
import { HistoryCard } from "../AppCards";
import {
  WorkflowLinkButton,
  WorkflowLinkSummaryButton,
} from "../WorkflowLinkButton";
import {
  CollapseIcon,
  ExpandIcon,
  OpenExternalIcon,
  RefreshIcon,
  ReplayIcon,
  StarIcon,
  TrashIcon,
} from "../AppIcons";
import { groupConsecutiveBy, stableStringify } from "../../lib/historyGroups";
import { useTrayPinnedActions } from "../../hooks/useTrayPinnedActions";
import { branchWorkflowModeLabel } from "./BranchModeTabs";

const HISTORY_SCROLL_PAGE_SIZE = 8;

function branchHistorySignature(item: BranchTaskHistoryEntry) {
  if (item.replay) {
    return stableStringify({
      taskKind: item.taskKind,
      command: item.replay.command,
      request: item.replay.request,
    });
  }

  return stableStringify({
    taskKind: item.taskKind,
    items: item.items.map((taskItem) => ({
      projectKey: taskItem.projectKey,
      sourceBranch: taskItem.sourceBranch,
      targetBranch: taskItem.targetBranch,
      outputPath: taskItem.outputPath,
      remote: taskItem.remote,
    })),
  });
}

function branchTrayDedupeKeyFromHistory(item: BranchTaskHistoryEntry) {
  if (!item.replay) {
    return null;
  }
  return `branch.replay:${stableStringify({
    historyId: item.id,
    command: item.replay.command,
    request: item.replay.request,
  })}`;
}

function branchLegacyTrayDedupeKeyFromHistory(item: BranchTaskHistoryEntry) {
  if (!item.replay) {
    return null;
  }
  return `branch.replay:${stableStringify({
    command: item.replay.command,
    request: item.replay.request,
  })}`;
}

function branchTrayActionFromHistory(item: BranchTaskHistoryEntry): TrayPinnedAction | null {
  if (!item.replay) {
    return null;
  }
  const firstItem = item.items[0];
  const projectName =
    item.items.length === 1 && firstItem?.projectName ? firstItem.projectName : "多项目";
  return {
    kind: "branch.replay",
    label: `分支：${branchWorkflowModeLabel(item.taskKind)} / ${projectName}`,
    detail: item.summary,
    projectKey: firstItem?.projectKey ?? null,
    entry: null,
    payload: {
      command: item.replay.command,
      request: item.replay.request,
    },
    dedupeKey: branchTrayDedupeKeyFromHistory(item) ?? "",
    updatedAtMs: Date.now(),
  };
}

function branchTaskOutputPath(item: BranchTaskHistoryEntry) {
  return item.items.find((taskItem) => taskItem.success && taskItem.outputPath)
    ?.outputPath ?? "";
}

type BranchHistoryPanelProps = {
  expanded: boolean;
  history: BranchTaskHistoryEntry[];
  currentHistoryId: string;
  currentTaskLabel: string;
  busy: string;
  workflowGroupCount: number;
  workflowSignalIdsForBranchReplay: (entry: BranchTaskHistoryEntry) => string[];
  onToggleExpanded: () => void;
  onOpenWorkflowList: () => void;
  onRefreshHistory: () => void;
  onClearHistory: () => void;
  onReplayHistory: (entry: BranchTaskHistoryEntry) => void;
  onConfigureWorkflow: (entry: BranchTaskHistoryEntry) => void;
  onOpenTaskOutput: (path: string) => void;
  formatRelativeTime: (value?: string) => string;
};

export function BranchHistoryPanel({
  expanded,
  history,
  currentHistoryId,
  currentTaskLabel,
  busy,
  workflowGroupCount,
  workflowSignalIdsForBranchReplay,
  onToggleExpanded,
  onOpenWorkflowList,
  onRefreshHistory,
  onClearHistory,
  onReplayHistory,
  onConfigureWorkflow,
  onOpenTaskOutput,
  formatRelativeTime,
}: BranchHistoryPanelProps) {
  const [historyVisibleCount, setHistoryVisibleCount] = useState(
    HISTORY_SCROLL_PAGE_SIZE,
  );
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const {
    scopedActions: pinnedBranchActions,
    togglePinned,
    removePinned,
    replacePinnedActions,
  } = useTrayPinnedActions("branch.replay");
  const branchHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, BranchTaskHistoryEntry>();
    for (const item of history) {
      const key = branchTrayDedupeKeyFromHistory(item);
      if (key && !next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [history]);
  const branchLegacyHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, BranchTaskHistoryEntry>();
    for (const item of history) {
      const key = branchLegacyTrayDedupeKeyFromHistory(item);
      if (key && !next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [history]);
  const branchSpecificLegacyPinnedKeys = useMemo(() => {
    const next = new Set<string>();
    for (const action of pinnedBranchActions) {
      const item = branchHistoryByPinnedKey.get(action.dedupeKey);
      const legacyKey = item ? branchLegacyTrayDedupeKeyFromHistory(item) : null;
      if (legacyKey) {
        next.add(legacyKey);
      }
    }
    return next;
  }, [branchHistoryByPinnedKey, pinnedBranchActions]);
  const duplicateLegacyPinnedKeys = useMemo(
    () =>
      pinnedBranchActions
        .filter(
          (action) =>
            branchLegacyHistoryByPinnedKey.has(action.dedupeKey) &&
            branchSpecificLegacyPinnedKeys.has(action.dedupeKey),
        )
        .map((action) => action.dedupeKey)
        .sort(),
    [branchLegacyHistoryByPinnedKey, branchSpecificLegacyPinnedKeys, pinnedBranchActions],
  );
  const duplicateLegacyPinnedKeySignature = duplicateLegacyPinnedKeys.join("\n");
  useEffect(() => {
    if (!duplicateLegacyPinnedKeySignature) {
      return;
    }
    const duplicateKeys = new Set(duplicateLegacyPinnedKeySignature.split("\n"));
    replacePinnedActions((actions) =>
      actions.filter((action) => !duplicateKeys.has(action.dedupeKey)),
    ).catch((error) => {
      console.error("failed to prune legacy tray pinned actions", error);
    });
  }, [duplicateLegacyPinnedKeySignature, replacePinnedActions]);
  const displayPinnedBranchActions = useMemo(
    () =>
      pinnedBranchActions.filter((action) => {
        if (branchHistoryByPinnedKey.has(action.dedupeKey)) {
          return true;
        }
        return (
          branchLegacyHistoryByPinnedKey.has(action.dedupeKey) &&
          !branchSpecificLegacyPinnedKeys.has(action.dedupeKey)
        );
      }),
    [
      branchHistoryByPinnedKey,
      branchLegacyHistoryByPinnedKey,
      branchSpecificLegacyPinnedKeys,
      pinnedBranchActions,
    ],
  );
  const pinnedActionOrder = useMemo(
    () =>
      new Map(
        displayPinnedBranchActions.map((action, index) => [action.dedupeKey, index]),
      ),
    [displayPinnedBranchActions],
  );
  const pinnedActionByKey = useMemo(
    () =>
      new Map(
        displayPinnedBranchActions.map((action) => [action.dedupeKey, action]),
      ),
    [displayPinnedBranchActions],
  );
  const groupedHistory = useMemo(
    () =>
      groupConsecutiveBy(
        history,
        branchHistorySignature,
        (item) => item.id,
      ),
    [history],
  );
  function pinnedOrderForBranchGroup(group: (typeof groupedHistory)[number]) {
    let order: number | undefined;
    for (const item of group.items) {
      const key = branchTrayDedupeKeyFromHistory(item);
      const itemOrder = key ? pinnedActionOrder.get(key) : undefined;
      if (itemOrder !== undefined) {
        order = order === undefined ? itemOrder : Math.min(order, itemOrder);
      }
    }
    if (order !== undefined) {
      return order;
    }
    const legacyKey = branchLegacyTrayDedupeKeyFromHistory(group.latest);
    return legacyKey ? pinnedActionOrder.get(legacyKey) : undefined;
  }
  const sortedHistoryGroups = useMemo(() => {
    const originalOrder = new Map(
      groupedHistory.map((group, index) => [group.id, index]),
    );
    return [...groupedHistory].sort((left, right) => {
      const leftPinnedOrder = pinnedOrderForBranchGroup(left);
      const rightPinnedOrder = pinnedOrderForBranchGroup(right);
      const leftPinned = leftPinnedOrder !== undefined;
      const rightPinned = rightPinnedOrder !== undefined;

      if (leftPinned && rightPinned) {
        return (
          (leftPinnedOrder ?? 0) - (rightPinnedOrder ?? 0) ||
          (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
        );
      }
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }
      return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
    });
  }, [groupedHistory, pinnedActionOrder]);
  const pinnedHistoryGroups = useMemo(
    () =>
      sortedHistoryGroups.filter(
        (group) => pinnedOrderForBranchGroup(group) !== undefined,
      ),
    [pinnedActionOrder, sortedHistoryGroups],
  );
  const unpinnedHistoryGroups = useMemo(
    () =>
      sortedHistoryGroups.filter(
        (group) => pinnedOrderForBranchGroup(group) === undefined,
      ),
    [pinnedActionOrder, sortedHistoryGroups],
  );
  function pinnedActionForBranchGroup(group: (typeof groupedHistory)[number]) {
    let pinnedAction: TrayPinnedAction | null = null;
    let pinnedOrder = Number.POSITIVE_INFINITY;
    for (const item of group.items) {
      const key = branchTrayDedupeKeyFromHistory(item);
      const order = key ? pinnedActionOrder.get(key) : undefined;
      const action = key ? pinnedActionByKey.get(key) : undefined;
      if (action && order !== undefined && order < pinnedOrder) {
        pinnedAction = action;
        pinnedOrder = order;
      }
    }
    if (pinnedAction) {
      return pinnedAction;
    }
    const legacyKey = branchLegacyTrayDedupeKeyFromHistory(group.latest);
    return legacyKey ? pinnedActionByKey.get(legacyKey) ?? null : null;
  }
  const visibleUnpinnedHistoryGroups = useMemo(
    () =>
      unpinnedHistoryGroups.slice(
        0,
        historyVisibleCount,
      ),
    [historyVisibleCount, unpinnedHistoryGroups],
  );
  const visibleHistoryGroups = useMemo(
    () => [...pinnedHistoryGroups, ...visibleUnpinnedHistoryGroups],
    [pinnedHistoryGroups, visibleUnpinnedHistoryGroups],
  );
  const hasMoreHistoryGroups = historyVisibleCount < unpinnedHistoryGroups.length;
  const hasDisplayHistory = history.length > 0 || Boolean(currentTaskLabel);
  const latestTaskEntry = useMemo(() => {
    if (currentHistoryId) {
      const matched = history.find((item) => item.id === currentHistoryId);
      if (matched) {
        return matched;
      }
    }
    return history[0] ?? null;
  }, [currentHistoryId, history]);
  const currentHistoryGroupId = useMemo(() => {
    if (!latestTaskEntry) {
      return "";
    }
    return (
      sortedHistoryGroups.find((group) =>
        group.items.some((item) => item.id === latestTaskEntry.id),
      )?.id ?? ""
    );
  }, [latestTaskEntry, sortedHistoryGroups]);

  useEffect(() => {
    setHistoryVisibleCount((current) => {
      if (current <= HISTORY_SCROLL_PAGE_SIZE) {
        return HISTORY_SCROLL_PAGE_SIZE;
      }
      return Math.min(
        current,
        Math.max(HISTORY_SCROLL_PAGE_SIZE, unpinnedHistoryGroups.length),
      );
    });
  }, [unpinnedHistoryGroups.length]);

  useEffect(() => {
    setExpandedHistoryGroups((current) => {
      const visibleIds = new Set(sortedHistoryGroups.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [sortedHistoryGroups]);

  useEffect(() => {
    if (!currentHistoryGroupId) {
      return;
    }
    setExpandedHistoryGroups((current) => {
      if (current.has(currentHistoryGroupId)) {
        return current;
      }
      const next = new Set(current);
      next.add(currentHistoryGroupId);
      return next;
    });
  }, [currentHistoryGroupId]);

  function toggleHistoryGroup(groupId: string) {
    setExpandedHistoryGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function handleTogglePinned(action: TrayPinnedAction | null) {
    if (!action) {
      return;
    }
    togglePinned(action)
      .then(() => setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE))
      .catch((error) => {
        console.error("failed to update tray pinned action", error);
      });
  }

  function handleRemovePinned(dedupeKey: string) {
    removePinned(dedupeKey)
      .then(() => setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE))
      .catch((error) => {
        console.error("failed to remove tray pinned action", error);
      });
  }

  function loadMoreHistoryGroups() {
    setHistoryVisibleCount((current) =>
      Math.min(current + HISTORY_SCROLL_PAGE_SIZE, unpinnedHistoryGroups.length),
    );
  }

  function handleHistoryScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreHistoryGroups) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 84) {
      loadMoreHistoryGroups();
    }
  }

  return (
    <Box className="workflow-panel workflow-history-panel">
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={0.8}
          flexWrap="wrap"
          rowGap={0.45}
          minWidth={0}
          mb={expanded ? 0.8 : 0}
        >
          <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 800 }}>
            记录
          </Typography>
          <Stack
            direction="row"
            spacing={0.55}
            alignItems="center"
            flexWrap="wrap"
            rowGap={0.4}
            justifyContent="flex-end"
          >
            <WorkflowLinkSummaryButton
              count={workflowGroupCount}
              onClick={onOpenWorkflowList}
            />
            <IconButton
              size="small"
              onClick={onRefreshHistory}
              aria-label="刷新分支任务记录"
              title="刷新分支任务记录"
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onClearHistory}
              disabled={history.length === 0 || Boolean(busy)}
              aria-label="清空分支任务记录"
              title="清空分支任务记录"
            >
              <TrashIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onToggleExpanded}
              aria-label={expanded ? "收起最近任务" : "展开最近任务"}
              title={expanded ? "收起最近任务" : "展开最近任务"}
            >
              {expanded ? (
                <CollapseIcon fontSize="small" />
              ) : (
                <ExpandIcon fontSize="small" />
              )}
            </IconButton>
          </Stack>
        </Stack>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {hasDisplayHistory ? (
            <Stack className="workflow-history-content" spacing={0.65} minWidth={0}>
              <Box className="module-list-scroll" onScroll={handleHistoryScroll}>
                <Stack spacing={0.65} minWidth={0}>
                  {currentTaskLabel ? (
                    <HistoryCard
                      title={currentTaskLabel}
                      subtitle="执行中"
                      detail="等待任务完成"
                      meta={[]}
                      badge={
                        <Chip
                          size="small"
                          label="正在执行"
                          color="warning"
                          variant="filled"
                        />
                      }
                    />
                  ) : null}
                  {visibleHistoryGroups.map((group) => {
                    const item = group.latest;
                    const isGrouped = group.items.length > 1;
                    const groupExpanded = expandedHistoryGroups.has(group.id);
                    const isTaskAnchorGroup =
                      latestTaskEntry !== null &&
                      group.items.some((historyItem) => historyItem.id === latestTaskEntry.id);
                    const workflowSignalIds = workflowSignalIdsForBranchReplay(item);
                    const trayAction = branchTrayActionFromHistory(item);
                    const groupPinnedAction = pinnedActionForBranchGroup(group);
                    const pinned = Boolean(groupPinnedAction);
                    const outputPath = branchTaskOutputPath(item);
                    return (
                      <HistoryCard
                        key={group.id}
                        title={`${branchWorkflowModeLabel(item.taskKind)} · ${item.summary}`}
                        subtitle={formatRelativeTime(item.createdAt)}
                        pinned={pinned}
                        badge={
                          <Stack
                            direction="row"
                            spacing={0.4}
                            alignItems="center"
                            flexWrap="wrap"
                            rowGap={0.4}
                            justifyContent="flex-end"
                          >
                            {isTaskAnchorGroup ? (
                              <Chip
                                size="small"
                                label="最新任务"
                                color="primary"
                                variant="filled"
                              />
                            ) : null}
                            {outputPath ? (
                              <IconButton
                                size="small"
                                onClick={() => onOpenTaskOutput(outputPath)}
                                disabled={Boolean(busy)}
                                aria-label="打开目录"
                                title="打开目录"
                              >
                                <OpenExternalIcon fontSize="small" />
                              </IconButton>
                            ) : null}
                            <IconButton
                              size="small"
                              onClick={() => onReplayHistory(item)}
                              disabled={Boolean(busy) || !item.replay}
                              aria-label="重播分支任务"
                              title={
                                item.replay ? "使用相同参数重播" : "旧记录缺少回放参数"
                              }
                            >
                              <ReplayIcon fontSize="small" />
                            </IconButton>
                            <WorkflowLinkButton
                              active={workflowSignalIds.length > 0}
                              onClick={() => onConfigureWorkflow(item)}
                              disabled={!item.replay}
                              title={item.replay ? "配置联动" : "旧记录缺少回放参数"}
                            />
                            <IconButton
                              size="small"
                              onClick={() =>
                                groupPinnedAction
                                  ? handleRemovePinned(groupPinnedAction.dedupeKey)
                                  : handleTogglePinned(trayAction)
                              }
                              disabled={!trayAction}
                              color={pinned ? "primary" : "default"}
                              aria-label={pinned ? "取消标记" : "标记记录"}
                              title={
                                trayAction
                                  ? pinned
                                    ? "取消标记"
                                    : "标记记录"
                                  : "旧记录缺少回放参数"
                              }
                              sx={
                                pinned
                                  ? {
                                      bgcolor: "primary.main",
                                      color: "primary.contrastText",
                                      borderColor: "primary.main",
                                      "&:hover": {
                                        bgcolor: "primary.dark",
                                      },
                                    }
                                  : undefined
                              }
                            >
                              <StarIcon fontSize="small" />
                            </IconButton>
                            {isGrouped ? (
                              <IconButton
                                size="small"
                                onClick={() => toggleHistoryGroup(group.id)}
                                aria-label={
                                  groupExpanded ? "收起同参数记录" : "展开同参数记录"
                                }
                                title={groupExpanded ? "收起同参数记录" : "展开同参数记录"}
                              >
                                {groupExpanded ? (
                                  <CollapseIcon fontSize="small" />
                                ) : (
                                  <ExpandIcon fontSize="small" />
                                )}
                              </IconButton>
                            ) : null}
                          </Stack>
                        }
                        detail={item.detail}
                        meta={[
                          isGrouped ? `连续 ${group.items.length} 次` : "",
                          `${item.items.length} 项`,
                          `${item.items.filter((taskItem) => taskItem.success).length} 成功`,
                          item.items.some((taskItem) => !taskItem.success) ? "含失败" : "",
                        ]}
                      >
                        {isGrouped ? (
                          <Collapse in={groupExpanded} timeout="auto" unmountOnExit>
                            <Stack
                              spacing={0.6}
                              sx={(theme) => ({
                                mt: 0.2,
                                pt: 0.8,
                                borderTop: "1px solid",
                                borderColor: "divider",
                                color: "text.secondary",
                                "& .history-row": {
                                  borderRadius: "12px",
                                  px: 0.9,
                                  py: 0.65,
                                  bgcolor:
                                    theme.palette.mode === "dark"
                                      ? "rgba(255,255,255,0.012)"
                                      : "rgba(31,37,48,0.025)",
                                },
                              })}
                            >
                              {group.items.map((historyItem, index) => (
                                <Box className="history-row" key={historyItem.id}>
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    alignItems="center"
                                    minWidth={0}
                                    maxWidth="100%"
                                  >
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{ flexShrink: 0, fontWeight: 800 }}
                                    >
                                      {index === 0 ? "最新" : `第 ${index + 1} 次`}
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      noWrap
                                      sx={{ flex: 1, minWidth: 0 }}
                                    >
                                      {historyItem.summary}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      noWrap
                                      sx={{ flexShrink: 0 }}
                                    >
                                      {formatRelativeTime(historyItem.createdAt)}
                                    </Typography>
                                  </Stack>
                                </Box>
                              ))}
                            </Stack>
                          </Collapse>
                        ) : null}
                      </HistoryCard>
                    );
                  })}
                  {history.length > 0 ? (
                    <Box
                      className={
                        hasMoreHistoryGroups
                          ? "workflow-history-footer"
                          : "workflow-history-footer workflow-history-footer--done"
                      }
                    >
                      {hasMoreHistoryGroups ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={loadMoreHistoryGroups}
                          className="workflow-history-footer-action"
                        >
                          下滑加载更多
                        </Button>
                      ) : (
                        <Typography variant="caption" className="workflow-history-footer-text">
                          没有更多了
                        </Typography>
                      )}
                    </Box>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          ) : (
            <AppEmptyState compact title="暂无分支任务" description="合并、创建或推送后会保留记录。" />
          )}
        </Collapse>
    </Box>
  );
}
