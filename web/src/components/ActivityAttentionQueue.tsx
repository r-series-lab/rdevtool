import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ActivityEntry } from "../lib/activityCenter";
import {
  CheckIcon,
  ClearIcon,
  ClockIcon,
  OpenExternalIcon,
  RefreshIcon,
  ReplayIcon,
  SearchIcon,
  SettingsIcon,
  WorkflowIcon,
} from "./AppIcons";
import {
  activityQueueResolveLabel,
  activityQueueStateLabel,
  reloadConfigAttentionItems,
  type ActivityQueueGroup,
} from "./activityCenterQueue";
import { useI18n, type Translate } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

type ActivityAttentionQueueProps = {
  groups: ActivityQueueGroup[];
  attentionCount: number;
  expanded: boolean;
  actionRunningId: string;
  onShowAll: () => void;
  onRunAction: (entry: ActivityEntry) => void;
  onOpenDetail: (entry: ActivityEntry) => void;
  onOpenResource: (entry: ActivityEntry) => void;
  onOpenEntry: (entry: ActivityEntry) => void;
  onResolveEntries: (entries: ActivityEntry[]) => void;
  onRequestResolveAll: () => void;
};

const queueIconButtonSx = {
  width: 32,
  height: 32,
  borderRadius: "8px",
  border: "1px solid var(--line)",
  color: "color-mix(in srgb, var(--text) 78%, var(--accent))",
  bgcolor: "color-mix(in srgb, var(--panel-strong) 82%, transparent)",
  "& .MuiSvgIcon-root": { fontSize: "0.92rem" },
  "&:hover": {
    borderColor: "var(--accent-border)",
    bgcolor: "var(--accent-soft)",
    color: "var(--accent-hover)",
  },
};

function relativeActivityTime(value: string, t: Translate) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (elapsedSeconds < 60) {
    return t("刚刚");
  }
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return t("{count} 分钟前", { count: elapsedMinutes });
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return t("{count} 小时前", { count: elapsedHours });
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  return elapsedDays < 30
    ? t("{count} 天前", { count: elapsedDays })
    : value.slice(5, 10);
}

function QueueActionIcon({ item }: { item: ActivityEntry }) {
  const actionKind = item.action?.kind;
  if (
    actionKind === "linkRecover" ||
    actionKind === "branchReplay" ||
    actionKind === "buildRecover" ||
    actionKind === "runtimeRecover" ||
    actionKind === "proxyRecover"
  ) {
    return <ReplayIcon fontSize="small" />;
  }
  if (actionKind === "compareConfigSource") {
    return <WorkflowIcon fontSize="small" />;
  }
  return <RefreshIcon fontSize="small" />;
}

export function ActivityAttentionQueue({
  groups,
  attentionCount,
  expanded,
  actionRunningId,
  onShowAll,
  onRunAction,
  onOpenDetail,
  onOpenResource,
  onOpenEntry,
  onResolveEntries,
  onRequestResolveAll,
}: ActivityAttentionQueueProps) {
  const { t } = useI18n();
  const visibleGroups = expanded ? groups : groups.slice(0, 4);
  const hiddenGroupCount = Math.max(0, groups.length - visibleGroups.length);
  const reloadItems = reloadConfigAttentionItems(
    groups.flatMap((group) => group.items),
  );

  return (
    <Box
      className={`activity-queue-section${expanded ? " is-expanded" : ""}`}
      aria-label={t("待处理队列")}
    >
      <Stack
        className="activity-queue-toolbar"
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={0.8}
      >
        <Stack
          className="activity-queue-heading"
          direction="row"
          alignItems="center"
          spacing={0.55}
          minWidth={0}
        >
          <Typography
            variant="caption"
            noWrap
            className="activity-queue-heading-title"
          >
            {t("待处理队列")}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            className="activity-queue-heading-summary"
          >
            {t("{count} 个分组", { count: groups.length })}
          </Typography>
          <Chip
            size="small"
            label={t("{count} 项", { count: attentionCount })}
            className="activity-queue-count"
          />
        </Stack>

        <Stack
          className="activity-queue-bulk-actions"
          direction="row"
          spacing={0.6}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          {reloadItems.length > 0 ? (
            <Button
              size="small"
              variant="contained"
              startIcon={<RefreshIcon fontSize="small" />}
              disabled={Boolean(actionRunningId)}
              onClick={() => onRunAction(reloadItems[0])}
            >
              {t("全部重新加载 {count}", { count: reloadItems.length })}
            </Button>
          ) : null}
          <Button
            className="activity-queue-ignore-all"
            size="small"
            variant="text"
            startIcon={<ClearIcon fontSize="small" />}
            onClick={onRequestResolveAll}
            disabled={Boolean(actionRunningId)}
          >
            {t("忽略全部")}
          </Button>
        </Stack>
      </Stack>

      <Stack className="activity-queue-list" spacing={0.65}>
        {visibleGroups.map((group) => {
          const actionItem = group.actionItem;
          const relativeTime = relativeActivityTime(group.latest.updatedAt, t);
          const summary = [
            group.latest.title !== group.label ? group.latest.title : "",
            group.latest.summary,
            group.latest.detail,
          ]
            .filter((value): value is string => Boolean(value))
            .map((value) => translateInternalMessage(value, t))
            .join(" · ");
          const groupLabel = translateInternalMessage(group.label, t);
          const actionLabel = actionItem?.action
            ? translateInternalMessage(actionItem.action.label, t)
            : "";
          const resourceLabel = group.resourceItem
            ? translateInternalMessage(
                group.resourceItem.resource?.label ?? t("打开关联资源"),
                t,
              )
            : "";
          const resolveLabel = translateInternalMessage(
            activityQueueResolveLabel(group),
            t,
          );
          return (
            <Box
              className="activity-record-card activity-queue-card"
              key={group.id}
            >
              <Box
                className={`activity-queue-status-bar${
                  group.failedCount > 0 ? " is-failed" : ""
                }`}
              />
              <Box minWidth={0} flex={1}>
                <Stack
                  className="activity-queue-card-heading"
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={0.7}
                >
                  <Stack
                    className="activity-queue-title-cluster"
                    direction="row"
                    spacing={0.6}
                    alignItems="center"
                    minWidth={0}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        color: "var(--text)",
                        fontSize: "0.82rem",
                        fontWeight: 820,
                        lineHeight: 1.35,
                      }}
                    >
                      {groupLabel}
                    </Typography>
                    <Chip
                      size="small"
                      label={translateInternalMessage(activityQueueStateLabel(group), t)}
                      className={`activity-queue-state-chip${
                        group.failedCount > 0 ? " is-failed" : ""
                      }`}
                      sx={{
                        color:
                          group.failedCount > 0
                            ? "var(--activity-danger)"
                            : "var(--activity-running)",
                      }}
                    />
                  </Stack>
                  <Stack
                    className="activity-queue-card-meta"
                    direction="row"
                    spacing={0.35}
                    alignItems="center"
                  >
                    {relativeTime ? <ClockIcon fontSize="small" /> : null}
                    {relativeTime ? (
                      <Typography variant="caption">{relativeTime}</Typography>
                    ) : null}
                    {group.total > 1 ? (
                      <Typography
                        variant="caption"
                        className="activity-queue-group-total"
                      >
                        {t("· {count} 条", { count: group.total })}
                      </Typography>
                    ) : null}
                  </Stack>
                </Stack>

                <Typography
                  className="activity-queue-card-summary"
                  variant="caption"
                >
                  {summary}
                </Typography>

                <Stack
                  className="activity-queue-card-actions"
                  direction="row"
                  alignItems="center"
                  spacing={0.6}
                >
                  {actionItem?.action ? (
                    <Button
                      className="activity-queue-primary-action"
                      size="small"
                      variant="contained"
                      startIcon={<QueueActionIcon item={actionItem} />}
                      onClick={() => onRunAction(actionItem)}
                      disabled={Boolean(actionRunningId)}
                      aria-label={actionLabel}
                    >
                      {actionLabel}
                    </Button>
                  ) : null}
                  <Stack
                    className="activity-queue-utility-actions"
                    direction="row"
                    spacing={0.35}
                    alignItems="center"
                  >
                    {group.detailItem ? (
                      <Tooltip title={t("查看诊断详情")}>
                        <IconButton
                          size="small"
                          onClick={() => onOpenDetail(group.detailItem!)}
                          aria-label={t("查看诊断详情")}
                          sx={queueIconButtonSx}
                        >
                          <SearchIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    {group.resourceItem ? (
                      <Tooltip title={resourceLabel}>
                        <IconButton
                          size="small"
                          onClick={() => onOpenResource(group.resourceItem!)}
                          aria-label={resourceLabel}
                          sx={queueIconButtonSx}
                        >
                          <OpenExternalIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    {group.targetItem ? (
                      <Tooltip title={t("定位")}>
                        <IconButton
                          size="small"
                          onClick={() => onOpenEntry(group.targetItem!)}
                          aria-label={t("定位活动")}
                          sx={queueIconButtonSx}
                        >
                          <SettingsIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Tooltip title={resolveLabel}>
                      <span>
                        <IconButton
                          className="activity-queue-resolve-action"
                          size="small"
                          onClick={() => onResolveEntries(group.items)}
                          disabled={Boolean(actionRunningId)}
                          aria-label={resolveLabel}
                          sx={queueIconButtonSx}
                        >
                          {group.actionCount > 0 ? (
                            <ClearIcon fontSize="small" />
                          ) : (
                            <CheckIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Box>
            </Box>
          );
        })}
        {hiddenGroupCount > 0 ? (
          <Button
            size="small"
            variant="text"
            onClick={onShowAll}
            sx={{ alignSelf: "flex-start" }}
          >
            {t("查看其余 {count} 个分组", { count: hiddenGroupCount })}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
