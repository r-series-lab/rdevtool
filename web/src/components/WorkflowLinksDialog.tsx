import {
  Box,
  Chip,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { TrashIcon, WorkflowIcon } from "./AppIcons";
import { AppActionDialog } from "./AppActionDialog";
import { AppEmptyState } from "./AppEmptyState";
import { useI18n } from "../i18n";

export type WorkflowLinkListItem = {
  key: string;
  title: string;
  kind: string;
  ruleKind: "receive" | "broadcast";
  signalIds: string[];
  enabled: boolean;
  ruleIds: string[];
};

type WorkflowLinksDialogProps = {
  open: boolean;
  title: string;
  items: WorkflowLinkListItem[];
  onClose: () => void;
  onEnabledChange: (item: WorkflowLinkListItem, enabled: boolean) => void;
  onDelete: (item: WorkflowLinkListItem) => void;
  onClearAll?: (items: WorkflowLinkListItem[]) => void;
};

export function WorkflowLinksDialog({
  open,
  title,
  items,
  onClose,
  onEnabledChange,
  onDelete,
  onClearAll,
}: WorkflowLinksDialogProps) {
  const { t } = useI18n();
  const hasItems = items.length > 0;

  return (
    <AppActionDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={
        hasItems
          ? t("{count} 个联动", { count: items.length })
          : t("暂无联动")
      }
      icon={<WorkflowIcon />}
      contentIcon={false}
      tone="neutral"
      className="workflow-links-dialog"
      headerActions={
        <Tooltip title={t(hasItems ? "清空全部联动" : "暂无可清空联动")}>
          <span>
            <IconButton
              size="small"
              disabled={!hasItems || !onClearAll}
              onClick={() => onClearAll?.(items)}
              aria-label={t("清空全部联动")}
              sx={{
                width: 34,
                height: 34,
                borderRadius: "9px",
                border: "1px solid",
                borderColor: "divider",
                color: "text.secondary",
                "&:hover": {
                  color: "error.main",
                  borderColor: "error.main",
                  bgcolor: "rgba(239,68,68,0.08)",
                },
              }}
            >
              <TrashIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      <Stack spacing={0.85}>
          {hasItems ? (
            items.map((item) => (
              <Box
                key={item.key}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "14px",
                  px: 1.05,
                  py: 0.75,
                  minHeight: 50,
                  minWidth: 0,
                  bgcolor: (theme) =>
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.012)"
                      : "rgba(255,255,255,0.64)",
                  boxShadow: (theme) =>
                    theme.palette.mode === "dark"
                      ? "inset 3px 0 0 rgba(37,99,235,0.72)"
                      : "inset 3px 0 0 rgba(37,99,235,0.62)",
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.85} minWidth={0}>
                  <Chip
                    size="small"
                    label={t(item.ruleKind === "receive" ? "接收" : "广播")}
                    sx={{
                      height: 26,
                      flexShrink: 0,
                      borderRadius: "999px",
                      fontWeight: 850,
                      bgcolor: (theme) =>
                        theme.palette.mode === "dark"
                          ? "rgba(255,255,255,0.035)"
                          : "rgba(15,23,42,0.05)",
                      "& .MuiChip-label": {
                        px: 0.9,
                      },
                    }}
                  />
                  <Typography
                    variant="body2"
                    noWrap
                    title={item.title}
                    sx={{
                      minWidth: 0,
                      flex: "1 1 auto",
                      fontWeight: 850,
                      lineHeight: 1.35,
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ flexShrink: 0, fontWeight: 750 }}
                  >
                    {t("{count} 条", { count: item.ruleIds.length })}
                  </Typography>
                  {item.signalIds[0] ? (
                    <Chip
                      size="small"
                      label={
                        item.signalIds.length > 1
                          ? `${item.signalIds[0]} +${item.signalIds.length - 1}`
                          : item.signalIds[0]
                      }
                      variant="outlined"
                      title={item.signalIds.join("、")}
                      sx={{
                        height: 26,
                        minWidth: 0,
                        maxWidth: { xs: 104, sm: 150 },
                        flexShrink: 0,
                        borderRadius: "999px",
                        color: "text.secondary",
                        fontWeight: 760,
                        "& .MuiChip-label": {
                          px: 0.9,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        },
                      }}
                    />
                  ) : null}
                </Stack>
                <Stack direction="row" spacing={0.45} alignItems="center" sx={{ flexShrink: 0 }}>
                  <Switch
                    size="small"
                    checked={item.enabled}
                    onChange={(event) => onEnabledChange(item, event.target.checked)}
                    inputProps={{
                      "aria-label": t("{name} 启用状态", { name: item.title }),
                    }}
                    sx={{
                      mr: -0.35,
                      "& .MuiSwitch-switchBase": {
                        p: 0.55,
                      },
                    }}
                  />
                  <Tooltip title={t("删除联动")}>
                    <IconButton
                      size="small"
                      onClick={() => onDelete(item)}
                      aria-label={t("删除联动")}
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: "12px",
                        color: "text.secondary",
                        border: "1px solid",
                        borderColor: "divider",
                        "&:hover": {
                          color: "error.main",
                          borderColor: "error.main",
                          bgcolor: "rgba(239,68,68,0.08)",
                        },
                      }}
                    >
                      <TrashIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            ))
          ) : (
            <AppEmptyState
              compact
              title={t("暂无联动")}
              description={t("关联动作后会显示在这里。")}
            />
          )}
      </Stack>
    </AppActionDialog>
  );
}
