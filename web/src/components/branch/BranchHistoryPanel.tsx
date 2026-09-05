import { useEffect, useMemo, useState, type UIEvent } from "react";
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  BranchTaskHistoryEntry,
  BranchTaskItemResult,
  BranchTaskPendingEntry,
} from "../../app-types";
import {
  branchTaskDisplayDetail,
  branchTaskFailureExplanation,
  middleTruncateBranch,
} from "../../lib/branchTaskDetails";
import type { TrayPinnedAction } from "../../lib/trayPins";
import { AppEmptyState } from "../AppEmptyState";
import { AppListEndState } from "../AppListEndState";
import { HistoryCard, type HistoryAccent } from "../AppCards";
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
  SearchIcon,
  StarIcon,
  TrashIcon,
} from "../AppIcons";
import { groupConsecutiveBy, stableStringify } from "../../lib/historyGroups";
import {
  filterHistoryGroups,
  matchesBranchHistoryEntry,
  type BranchHistoryKindFilter,
  type BranchHistoryResultFilter,
} from "../../lib/historyRecordFilters";
import { useTrayPinnedActions } from "../../hooks/useTrayPinnedActions";
import { useI18n } from "../../i18n";
import { translateInternalMessage } from "../../i18n/internalMessages";
import { branchWorkflowModeLabel } from "./BranchModeTabs";

const HISTORY_SCROLL_PAGE_SIZE = 8;
const COLLAPSED_PROJECT_ROW_COUNT = 3;
const COLLAPSED_BRANCH_MAX_LENGTH = 30;

function branchTaskItemTarget(item: BranchTaskItemResult) {
  return item.targetBranch?.trim() || item.outputPath?.trim() || "-";
}

function branchTaskItemStatus(item: BranchTaskItemResult) {
  return item.statusLabel.trim() || item.summary.trim() || (item.success ? "成功" : "失败");
}

function BranchHistoryProjectDetail({
  item,
}: {
  item: BranchTaskHistoryEntry;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hasLongBranch = item.items.some(
    (taskItem) =>
      Array.from(taskItem.sourceBranch.trim()).length > COLLAPSED_BRANCH_MAX_LENGTH ||
      Array.from(branchTaskItemTarget(taskItem)).length > COLLAPSED_BRANCH_MAX_LENGTH,
  );
  const hasFailureDetail = item.items.some(
    (taskItem) => !taskItem.success && Boolean(taskItem.detail.trim()),
  );
  const canExpand =
    item.items.length > COLLAPSED_PROJECT_ROW_COUNT ||
    hasLongBranch ||
    hasFailureDetail;
  const visibleItems = expanded
    ? item.items
    : item.items.slice(0, COLLAPSED_PROJECT_ROW_COUNT);
  const hiddenProjectCount = Math.max(0, item.items.length - visibleItems.length);

  return (
    <Stack
      className={`branch-history-project-detail${expanded ? " is-expanded" : ""}`}
      spacing={0.4}
      minWidth={0}
    >
      <Stack className="branch-history-project-list" spacing={0.35} minWidth={0}>
        {visibleItems.map((taskItem, index) => {
          const projectName =
            taskItem.projectName.trim() || taskItem.projectKey.trim() || t("项目");
          const sourceBranch = taskItem.sourceBranch.trim() || "-";
          const targetBranch = branchTaskItemTarget(taskItem);
          const failureDetail = taskItem.success
            ? ""
            : translateInternalMessage(branchTaskFailureExplanation(taskItem), t);
          return (
            <Box
              className={`branch-history-project-row${taskItem.success ? " is-success" : " is-failed"}`}
              key={`${taskItem.projectKey}-${taskItem.targetBranch ?? taskItem.outputPath ?? index}-${index}`}
            >
              <Typography
                className="branch-history-project-name"
                variant="caption"
                title={projectName}
                noWrap={!expanded}
              >
                {projectName}
              </Typography>
              <Box
                className="branch-history-branch-route"
                title={`${sourceBranch} -> ${targetBranch}`}
              >
                <Typography component="span" variant="caption">
                  {expanded
                    ? sourceBranch
                    : middleTruncateBranch(
                        sourceBranch,
                        COLLAPSED_BRANCH_MAX_LENGTH,
                      )}
                </Typography>
                <Typography
                  className="branch-history-branch-arrow"
                  component="span"
                  variant="caption"
                  aria-hidden="true"
                >
                  -&gt;
                </Typography>
                <Typography component="span" variant="caption">
                  {expanded
                    ? targetBranch
                    : middleTruncateBranch(
                        targetBranch,
                        COLLAPSED_BRANCH_MAX_LENGTH,
                      )}
                </Typography>
              </Box>
              <Chip
                className="branch-history-project-status"
                size="small"
                color={taskItem.success ? "success" : "error"}
                variant="outlined"
                label={translateInternalMessage(branchTaskItemStatus(taskItem), t)}
              />
              {failureDetail ? (
                <Typography
                  className="branch-history-project-failure"
                  variant="caption"
                  color="error"
                  title={failureDetail}
                >
                  {failureDetail}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Stack>
      {canExpand ? (
        <Stack
          className="branch-history-detail-actions"
          direction="row"
          alignItems="center"
          spacing={0.5}
        >
          <Button
            className="branch-history-detail-toggle"
            size="small"
            variant="text"
            color="inherit"
            startIcon={
              expanded ? (
                <CollapseIcon fontSize="small" />
              ) : (
                <ExpandIcon fontSize="small" />
              )
            }
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {t(expanded ? "收起详情" : "展开详情")}
          </Button>
          {!expanded && hiddenProjectCount > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {t("还有 {count} 个项目", { count: hiddenProjectCount })}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

function branchHistoryAccent(item: BranchTaskHistoryEntry): HistoryAccent {
  if (!item.success || item.items.some((taskItem) => !taskItem.success)) {
    return "danger";
  }
  return "info";
}

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

function workspacePinnedKey(workspaceKey: string | null | undefined, dedupeKey: string) {
  return `${workspaceKey?.trim() ?? ""}\n${dedupeKey}`;
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
    workspaceKey: item.workspaceKey ?? null,
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
  currentTask: BranchTaskPendingEntry | null;
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
  currentTask,
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
  const { t } = useI18n();
  const [historyVisibleCount, setHistoryVisibleCount] = useState(
    HISTORY_SCROLL_PAGE_SIZE,
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyResultFilter, setHistoryResultFilter] =
    useState<BranchHistoryResultFilter>("all");
  const [historyKindFilter, setHistoryKindFilter] =
    useState<BranchHistoryKindFilter>("all");
  const [historyMarkedOnly, setHistoryMarkedOnly] = useState(false);
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
      const legacyKey = branchLegacyTrayDedupeKeyFromHistory(item);
      const key = legacyKey ? workspacePinnedKey(item.workspaceKey, legacyKey) : null;
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
      if (
        item &&
        legacyKey &&
        (action.workspaceKey ?? null) === (item.workspaceKey ?? null)
      ) {
        next.add(workspacePinnedKey(item.workspaceKey, legacyKey));
      }
    }
    return next;
  }, [branchHistoryByPinnedKey, pinnedBranchActions]);
  const duplicateLegacyPinnedKeys = useMemo(
    () =>
      pinnedBranchActions
        .filter(
          (action) => {
            const key = workspacePinnedKey(action.workspaceKey, action.dedupeKey);
            return (
              branchLegacyHistoryByPinnedKey.has(key) &&
              branchSpecificLegacyPinnedKeys.has(key)
            );
          },
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
        const exactItem = branchHistoryByPinnedKey.get(action.dedupeKey);
        if (
          exactItem &&
          (action.workspaceKey ?? null) === (exactItem.workspaceKey ?? null)
        ) {
          return true;
        }
        const legacyKey = workspacePinnedKey(action.workspaceKey, action.dedupeKey);
        return (
          branchLegacyHistoryByPinnedKey.has(legacyKey) &&
          !branchSpecificLegacyPinnedKeys.has(legacyKey)
        );
      }),
    [
      branchHistoryByPinnedKey,
      branchLegacyHistoryByPinnedKey,
      branchSpecificLegacyPinnedKeys,
      pinnedBranchActions,
    ],
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
  function pinnedActionForBranchItem(item: BranchTaskHistoryEntry) {
    const exactKey = branchTrayDedupeKeyFromHistory(item);
    const exactAction = exactKey ? pinnedActionByKey.get(exactKey) : null;
    if (
      exactAction &&
      (exactAction.workspaceKey ?? null) === (item.workspaceKey ?? null)
    ) {
      return exactAction;
    }
    const legacyKey = branchLegacyTrayDedupeKeyFromHistory(item);
    const legacyAction = legacyKey ? pinnedActionByKey.get(legacyKey) : null;
    return legacyAction &&
      (legacyAction.workspaceKey ?? null) === (item.workspaceKey ?? null)
      ? legacyAction
      : null;
  }
  function pinnedActionForBranchGroup(group: (typeof groupedHistory)[number]) {
    return group.items.map(pinnedActionForBranchItem).find(Boolean) ?? null;
  }
  const filteredHistoryGroups = useMemo(
    () =>
      filterHistoryGroups(groupedHistory, (item) =>
        matchesBranchHistoryEntry(
          item,
          {
            query: historyQuery,
            result: historyResultFilter,
            kind: historyKindFilter,
            markedOnly: historyMarkedOnly,
          },
          (entry) => Boolean(pinnedActionForBranchItem(entry)),
        ),
      ),
    [
      groupedHistory,
      historyKindFilter,
      historyMarkedOnly,
      historyQuery,
      historyResultFilter,
      pinnedActionByKey,
    ],
  );
  const visibleHistoryGroups = useMemo(
    () => filteredHistoryGroups.slice(0, historyVisibleCount),
    [filteredHistoryGroups, historyVisibleCount],
  );
  const hasMoreHistoryGroups = historyVisibleCount < filteredHistoryGroups.length;
  const filteredHistoryRecordCount = useMemo(
    () => filteredHistoryGroups.reduce((count, group) => count + group.items.length, 0),
    [filteredHistoryGroups],
  );
  const hasHistoryFilters = Boolean(
    historyQuery.trim() ||
      historyResultFilter !== "all" ||
      historyKindFilter !== "all" ||
      historyMarkedOnly,
  );
  const hasDisplayHistory = history.length > 0 || Boolean(currentTask);
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
      filteredHistoryGroups.find((group) =>
        group.items.some((item) => item.id === latestTaskEntry.id),
      )?.id ?? ""
    );
  }, [filteredHistoryGroups, latestTaskEntry]);

  useEffect(() => {
    if (currentTask) {
      setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE);
    }
  }, [currentTask?.id]);

  useEffect(() => {
    setHistoryVisibleCount((current) => {
      if (current <= HISTORY_SCROLL_PAGE_SIZE) {
        return HISTORY_SCROLL_PAGE_SIZE;
      }
      return Math.min(
        current,
        Math.max(HISTORY_SCROLL_PAGE_SIZE, filteredHistoryGroups.length),
      );
    });
  }, [filteredHistoryGroups.length]);

  useEffect(() => {
    setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE);
  }, [historyKindFilter, historyMarkedOnly, historyQuery, historyResultFilter]);

  useEffect(() => {
    setExpandedHistoryGroups((current) => {
      const visibleIds = new Set(filteredHistoryGroups.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredHistoryGroups]);

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
      Math.min(current + HISTORY_SCROLL_PAGE_SIZE, filteredHistoryGroups.length),
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
            {t("记录")}
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
              aria-label={t("刷新分支任务记录")}
              title={t("刷新分支任务记录")}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onClearHistory}
              disabled={history.length === 0 || Boolean(busy)}
              aria-label={t("清空分支任务记录")}
              title={t("清空分支任务记录")}
            >
              <TrashIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onToggleExpanded}
              aria-label={t(expanded ? "收起最近任务" : "展开最近任务")}
              title={t(expanded ? "收起最近任务" : "展开最近任务")}
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
              {history.length > 0 ? (
                <Stack
                  className="history-filter-toolbar"
                  direction="row"
                  spacing={0.65}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                >
                  <TextField
                    size="small"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder={t("搜索项目、分支、Commit 或摘要")}
                    className="history-filter-search"
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <TextField
                    select
                    size="small"
                    value={historyResultFilter}
                    onChange={(event) =>
                      setHistoryResultFilter(event.target.value as BranchHistoryResultFilter)
                    }
                    className="history-filter-select"
                    slotProps={{ htmlInput: { "aria-label": t("执行结果") } }}
                  >
                    <MenuItem value="all">{t("全部结果")}</MenuItem>
                    <MenuItem value="success">{t("成功")}</MenuItem>
                    <MenuItem value="failed">{t("失败")}</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    value={historyKindFilter}
                    onChange={(event) =>
                      setHistoryKindFilter(event.target.value as BranchHistoryKindFilter)
                    }
                    className="history-filter-select history-filter-select--wide"
                    slotProps={{ htmlInput: { "aria-label": t("操作类型") } }}
                  >
                    <MenuItem value="all">{t("全部操作")}</MenuItem>
                    {(["sync", "create", "checkout", "switch", "push"] as const).map(
                      (kind) => (
                        <MenuItem key={kind} value={kind}>
                          {t(branchWorkflowModeLabel(kind))}
                        </MenuItem>
                      ),
                    )}
                  </TextField>
                  <IconButton
                    size="small"
                    className={historyMarkedOnly ? "is-active" : ""}
                    color={historyMarkedOnly ? "primary" : "default"}
                    onClick={() => setHistoryMarkedOnly((current) => !current)}
                    aria-pressed={historyMarkedOnly}
                    aria-label={t("仅看已标记")}
                    title={t("仅看已标记")}
                  >
                    <StarIcon fontSize="small" />
                  </IconButton>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("{count} 条记录", { count: filteredHistoryRecordCount })}
                  />
                </Stack>
              ) : null}
              <Box className="module-list-scroll" onScroll={handleHistoryScroll}>
                <Stack spacing={0.65} minWidth={0}>
                  {currentTask ? (
                    <HistoryCard
                      key={currentTask.id}
                      title={`${t(branchWorkflowModeLabel(currentTask.taskKind))} · ${translateInternalMessage(currentTask.summary, t)}`}
                      subtitle={formatRelativeTime(currentTask.createdAt)}
                      detail={translateInternalMessage(currentTask.detail, t)}
                      meta={[
                        currentTask.projectNames.length > 1
                          ? t("{count} 个项目", { count: currentTask.projectNames.length })
                          : currentTask.projectNames[0] || "",
                      ].filter(Boolean)}
                      accent="warning"
                      badge={
                        <Chip
                          size="small"
                          label={t("正在执行")}
                          color="warning"
                          variant="filled"
                        />
                      }
                    />
                  ) : null}
                  {history.length > 0 && filteredHistoryGroups.length === 0 ? (
                    <Stack alignItems="center" spacing={0.4}>
                      <AppEmptyState
                        compact
                        title={t("没有符合条件的记录")}
                        description={t("调整搜索或筛选条件。")}
                      />
                      {hasHistoryFilters ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => {
                            setHistoryQuery("");
                            setHistoryResultFilter("all");
                            setHistoryKindFilter("all");
                            setHistoryMarkedOnly(false);
                          }}
                        >
                          {t("清除筛选")}
                        </Button>
                      ) : null}
                    </Stack>
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
                        title={`${t(branchWorkflowModeLabel(item.taskKind))} · ${translateInternalMessage(item.summary, t)}`}
                        subtitle={formatRelativeTime(item.createdAt)}
                        pinned={pinned}
                        accent={branchHistoryAccent(item)}
                        badge={
                          <Stack
                            direction="row"
                            spacing={0.4}
                            alignItems="center"
                            flexWrap="wrap"
                            rowGap={0.4}
                            justifyContent="flex-end"
                          >
                              {!item.workspaceKey ? (
                                <Chip
                                  size="small"
                                  label={t("未归属")}
                                  color="default"
                                  variant="outlined"
                                />
                              ) : null}
                              {isTaskAnchorGroup ? (
                              <Chip
                                size="small"
                                label={t("最新任务")}
                                color="primary"
                                variant="filled"
                              />
                            ) : null}
                            {outputPath ? (
                              <IconButton
                                size="small"
                                onClick={() => onOpenTaskOutput(outputPath)}
                                disabled={Boolean(busy)}
                                aria-label={t("打开目录")}
                                title={t("打开目录")}
                              >
                                <OpenExternalIcon fontSize="small" />
                              </IconButton>
                            ) : null}
                            <IconButton
                              size="small"
                              onClick={() => onReplayHistory(item)}
                              disabled={Boolean(busy) || !item.replay}
                              aria-label={t("重播分支任务")}
                              title={
                                t(item.replay ? "使用相同参数重播" : "旧记录缺少回放参数")
                              }
                            >
                              <ReplayIcon fontSize="small" />
                            </IconButton>
                            <WorkflowLinkButton
                              active={workflowSignalIds.length > 0}
                              onClick={() => onConfigureWorkflow(item)}
                              disabled={!item.replay}
                              title={t(item.replay ? "配置联动" : "旧记录缺少回放参数")}
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
                              aria-label={t(pinned ? "取消标记" : "标记记录")}
                              title={
                                trayAction
                                  ? pinned
                                    ? t("取消标记")
                                    : t("标记记录")
                                  : t("旧记录缺少回放参数")
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
                                  t(groupExpanded ? "收起同参数记录" : "展开同参数记录")
                                }
                                title={t(groupExpanded ? "收起同参数记录" : "展开同参数记录")}
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
                        detail={<BranchHistoryProjectDetail item={item} />}
                        meta={[
                          isGrouped
                            ? t("连续 {count} 次", { count: group.items.length })
                            : "",
                          t("{count} 项", { count: item.items.length }),
                          t("{count} 成功", {
                            count: item.items.filter((taskItem) => taskItem.success).length,
                          }),
                          item.items.some((taskItem) => !taskItem.success)
                            ? t("含失败")
                            : "",
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
                                      {index === 0
                                        ? t("最新")
                                        : t("第 {count} 次", { count: index + 1 })}
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      noWrap
                                      sx={{ flex: 1, minWidth: 0 }}
                                    >
                                      {translateInternalMessage(historyItem.summary, t)}
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
                                  {!historyItem.success ? (
                                    <Typography
                                      variant="caption"
                                      color="error"
                                      sx={{
                                        display: "block",
                                        mt: 0.45,
                                        overflowWrap: "anywhere",
                                        whiteSpace: "pre-line",
                                      }}
                                    >
                                      {translateInternalMessage(branchTaskDisplayDetail(historyItem), t)}
                                    </Typography>
                                  ) : null}
                                </Box>
                              ))}
                            </Stack>
                          </Collapse>
                        ) : null}
                      </HistoryCard>
                    );
                  })}
                  {filteredHistoryGroups.length > 0 ? (
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
                          {t("下滑加载更多")}
                        </Button>
                      ) : (
                        <AppListEndState />
                      )}
                    </Box>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          ) : (
            <AppEmptyState
              compact
              title={t("暂无分支任务")}
              description={t("合并、创建或推送后会保留记录。")}
            />
          )}
        </Collapse>
    </Box>
  );
}
