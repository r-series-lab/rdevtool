import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { ClearIcon, TrashIcon } from "./AppIcons";

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
  const hasItems = items.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: {
          width: "min(460px, calc(100vw - 28px))",
          borderRadius: "18px",
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle sx={{ px: 2.25, pt: 1.7, pb: 1.25 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.4}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontSize: "1rem", fontWeight: 850 }} noWrap>
              {title}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.25, fontWeight: 700 }}
            >
              {hasItems ? `${items.length} 个联动` : "暂无联动"}
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={0.7}>
            <Tooltip title={hasItems ? "清空全部联动" : "暂无可清空联动"}>
              <span>
                <IconButton
                  size="small"
                  disabled={!hasItems || !onClearAll}
                  onClick={() => onClearAll?.(items)}
                  aria-label="清空全部联动"
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: "12px",
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
            <Tooltip title="关闭">
              <IconButton
                size="small"
                onClick={onClose}
                aria-label="关闭联动清单"
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: "12px",
                  border: "1px solid",
                  borderColor: "divider",
                  color: "text.secondary",
                  "&:hover": {
                    color: "text.primary",
                    bgcolor: "rgba(148,163,184,0.1)",
                  },
                }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ px: 1.55, pt: 0.4, pb: 1.55 }}>
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
                    label={item.ruleKind === "receive" ? "接收" : "广播"}
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
                    {item.ruleIds.length} 条
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
                    inputProps={{ "aria-label": `${item.title} 启用状态` }}
                    sx={{
                      mr: -0.35,
                      "& .MuiSwitch-switchBase": {
                        p: 0.55,
                      },
                    }}
                  />
                  <Tooltip title="删除联动">
                    <IconButton
                      size="small"
                      onClick={() => onDelete(item)}
                      aria-label="删除联动"
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
            <Box
              sx={{
                minHeight: 64,
                display: "grid",
                placeItems: "center",
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: "14px",
                color: "text.secondary",
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 750 }}>
                暂无联动
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
