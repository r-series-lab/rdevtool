import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Collapse,
  IconButton,
  Pagination,
  Stack,
  Typography,
} from "@mui/material";
import type { BranchTaskHistoryEntry } from "../../app-types";
import { HistoryCard } from "../AppCards";
import {
  WorkflowLinkButton,
  WorkflowLinkSummaryButton,
} from "../WorkflowLinkButton";
import {
  CollapseIcon,
  ExpandIcon,
  RefreshIcon,
  ReplayIcon,
  TrashIcon,
} from "../AppIcons";
import { groupConsecutiveBy, stableStringify } from "../../lib/historyGroups";
import { branchWorkflowModeLabel } from "./BranchModeTabs";

const HISTORY_PAGE_SIZE = 5;

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

type BranchHistoryPanelProps = {
  expanded: boolean;
  history: BranchTaskHistoryEntry[];
  busy: string;
  workflowGroupCount: number;
  workflowSignalIdsForBranchReplay: (entry: BranchTaskHistoryEntry) => string[];
  onToggleExpanded: () => void;
  onOpenWorkflowList: () => void;
  onRefreshHistory: () => void;
  onClearHistory: () => void;
  onReplayHistory: (entry: BranchTaskHistoryEntry) => void;
  onConfigureWorkflow: (entry: BranchTaskHistoryEntry) => void;
  formatRelativeTime: (value?: string) => string;
};

export function BranchHistoryPanel({
  expanded,
  history,
  busy,
  workflowGroupCount,
  workflowSignalIdsForBranchReplay,
  onToggleExpanded,
  onOpenWorkflowList,
  onRefreshHistory,
  onClearHistory,
  onReplayHistory,
  onConfigureWorkflow,
  formatRelativeTime,
}: BranchHistoryPanelProps) {
  const [historyPage, setHistoryPage] = useState(1);
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState<Set<string>>(
    () => new Set(),
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
  const historyPageCount = Math.max(
    1,
    Math.ceil(groupedHistory.length / HISTORY_PAGE_SIZE),
  );
  const pagedHistoryGroups = useMemo(
    () =>
      groupedHistory.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [groupedHistory, historyPage],
  );

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

  useEffect(() => {
    setExpandedHistoryGroups((current) => {
      const visibleIds = new Set(groupedHistory.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [groupedHistory]);

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

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: "20px",
        overflow: "hidden",
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1}
          flexWrap="wrap"
          rowGap={0.6}
          minWidth={0}
          mb={expanded ? 1.2 : 0}
        >
          <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 800 }}>
            记录
          </Typography>
          <Stack
            direction="row"
            spacing={0.7}
            alignItems="center"
            flexWrap="wrap"
            rowGap={0.6}
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
          {history.length > 0 ? (
            <Stack spacing={0.8} minWidth={0}>
              {pagedHistoryGroups.map((group) => {
                const item = group.latest;
                const isGrouped = group.items.length > 1;
                const groupExpanded = expandedHistoryGroups.has(group.id);
                const workflowSignalIds = workflowSignalIdsForBranchReplay(item);
                return (
                  <HistoryCard
                    key={group.id}
                    title={`${branchWorkflowModeLabel(item.taskKind)} · ${item.summary}`}
                    subtitle={formatRelativeTime(item.createdAt)}
                    badge={
                      <Stack
                        direction="row"
                        spacing={0.4}
                        alignItems="center"
                        flexWrap="wrap"
                        rowGap={0.4}
                        justifyContent="flex-end"
                      >
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
              {historyPageCount > 1 ? (
                <Stack direction="row" justifyContent="flex-end" sx={{ pt: 0.4 }}>
                  <Pagination
                    size="small"
                    page={historyPage}
                    count={historyPageCount}
                    siblingCount={0}
                    boundaryCount={1}
                    onChange={(_, nextPage) => setHistoryPage(nextPage)}
                    sx={{
                      "& .MuiPaginationItem-root": {
                        minWidth: 28,
                        height: 28,
                        borderRadius: "10px",
                        fontWeight: 800,
                      },
                    }}
                  />
                </Stack>
              ) : null}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              暂无分支任务记录。
            </Typography>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
}
