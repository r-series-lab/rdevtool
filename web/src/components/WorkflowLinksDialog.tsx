import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { TrashIcon } from "./AppIcons";

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
};

export function WorkflowLinksDialog({
  open,
  title,
  items,
  onClose,
  onEnabledChange,
  onDelete,
}: WorkflowLinksDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          {items.length > 0 ? (
            items.map((item) => (
              <Box
                key={item.key}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "14px",
                  px: 1,
                  py: 0.9,
                  bgcolor: "rgba(255,255,255,0.012)",
                  minWidth: 0,
                }}
              >
                <Stack spacing={0.8} minWidth={0}>
                  <Stack
                    direction="row"
                    alignItems="flex-start"
                    justifyContent="space-between"
                    spacing={1}
                    minWidth={0}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={0.6} alignItems="center" mb={0.4}>
                        <Chip size="small" label={item.kind} />
                        <Typography variant="caption" color="text.secondary">
                          {item.ruleIds.length} 条
                        </Typography>
                      </Stack>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }} noWrap>
                        {item.title}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.4} alignItems="center" sx={{ flexShrink: 0 }}>
                      <Switch
                        size="small"
                        checked={item.enabled}
                        onChange={(event) => onEnabledChange(item, event.target.checked)}
                      />
                      <IconButton
                        size="small"
                        onClick={() => onDelete(item)}
                        aria-label="删除联动"
                        title="删除联动"
                      >
                        <TrashIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                  <Stack direction="row" flexWrap="wrap" gap={0.55}>
                    {item.signalIds.map((signalId) => (
                      <Chip
                        key={`${item.key}-${signalId}`}
                        size="small"
                        label={signalId}
                        variant="outlined"
                        sx={{ maxWidth: "100%" }}
                      />
                    ))}
                  </Stack>
                </Stack>
              </Box>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              暂无联动。
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
