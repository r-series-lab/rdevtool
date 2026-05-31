import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

type WorkflowRulesConfigDialogProps = {
  open: boolean;
  title?: string;
  context?: ReactNode;
  receiveSignalIds: string[];
  broadcastSignalIds: string[];
  signalOptions: string[];
  defaultBroadcastSignalId?: string;
  showReceive?: boolean;
  showBroadcast?: boolean;
  receiveHelperText?: string;
  broadcastHelperText?: string;
  onClose: () => void;
  onSave: (value: {
    receiveSignalIds: string[];
    broadcastSignalIds: string[];
  }) => void;
};

function normalizeSignals(values: readonly string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function SignalSelector({
  label,
  value,
  options,
  helperText,
  placeholder,
  onChange,
}: {
  label: string;
  value: string[];
  options: string[];
  helperText?: string;
  placeholder?: string;
  onChange: (nextValue: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      onChange={(_, nextValue) => onChange(normalizeSignals(nextValue))}
      filterSelectedOptions
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              size="small"
              label={option}
              {...tagProps}
              sx={{ maxWidth: "100%" }}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? placeholder : undefined}
          helperText={helperText}
        />
      )}
    />
  );
}

export function WorkflowRulesConfigDialog({
  open,
  title = "联动配置",
  context,
  receiveSignalIds,
  broadcastSignalIds,
  signalOptions,
  defaultBroadcastSignalId,
  showReceive = true,
  showBroadcast = true,
  receiveHelperText = "收到这些 Signal 后重放当前动作。",
  broadcastHelperText = "当前动作成功后发送这些 Signal。",
  onClose,
  onSave,
}: WorkflowRulesConfigDialogProps) {
  const [receiveDraft, setReceiveDraft] = useState<string[]>([]);
  const [broadcastDraft, setBroadcastDraft] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setReceiveDraft(normalizeSignals(receiveSignalIds));
    setBroadcastDraft(normalizeSignals(broadcastSignalIds));
  }, [broadcastSignalIds, open, receiveSignalIds]);

  const options = useMemo(
    () =>
      normalizeSignals([
        ...signalOptions,
        ...(defaultBroadcastSignalId ? [defaultBroadcastSignalId] : []),
      ]),
    [defaultBroadcastSignalId, signalOptions],
  );
  const loopSignals = useMemo(() => {
    const broadcasts = new Set(broadcastDraft);
    return receiveDraft.filter((item) => broadcasts.has(item));
  }, [broadcastDraft, receiveDraft]);
  const canUseDefault =
    Boolean(defaultBroadcastSignalId) && !broadcastDraft.includes(defaultBroadcastSignalId!);

  function save() {
    onSave({
      receiveSignalIds: normalizeSignals(receiveDraft),
      broadcastSignalIds: normalizeSignals(broadcastDraft),
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
          {context}
          {showReceive ? (
            <Box
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "14px",
                p: 1,
                bgcolor: "rgba(255,255,255,0.014)",
              }}
            >
              <Stack spacing={0.8}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                  Receive
                </Typography>
                <SignalSelector
                  label="接收 Signal"
                  value={receiveDraft}
                  options={options}
                  placeholder="选择或输入 Signal"
                  helperText={receiveHelperText}
                  onChange={setReceiveDraft}
                />
              </Stack>
            </Box>
          ) : null}
          {showBroadcast ? (
            <Box
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "14px",
                p: 1,
                bgcolor: "rgba(255,255,255,0.014)",
              }}
            >
              <Stack spacing={0.8}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                    Broadcast
                  </Typography>
                  {canUseDefault ? (
                    <Button
                      size="small"
                      onClick={() =>
                        setBroadcastDraft((current) =>
                          normalizeSignals([...current, defaultBroadcastSignalId!]),
                        )
                      }
                    >
                      使用默认
                    </Button>
                  ) : null}
                </Stack>
                <SignalSelector
                  label="发送 Signal"
                  value={broadcastDraft}
                  options={options}
                  placeholder={defaultBroadcastSignalId || "输入 Signal"}
                  helperText={
                    defaultBroadcastSignalId
                      ? `${broadcastHelperText} 默认：${defaultBroadcastSignalId}`
                      : broadcastHelperText
                  }
                  onChange={setBroadcastDraft}
                />
              </Stack>
            </Box>
          ) : null}
          {loopSignals.length > 0 ? (
            <Alert severity="warning" variant="outlined">
              Receive 和 Broadcast 包含同名 Signal，可能形成循环。
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={save}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
