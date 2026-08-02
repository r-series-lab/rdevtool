import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";
import { useI18n } from "../i18n";
import { ClearIcon, PanelSideIcon, TrashIcon } from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";

type WorkflowRulesConfigDialogProps = {
  open: boolean;
  title?: string;
  context?: ReactNode;
  receiveSignalIds: string[];
  broadcastSignalIds: string[];
  signalOptions: string[];
  defaultBroadcastSignalId?: string;
  signalSummaries?: WorkflowSignalSummary[];
  showReceive?: boolean;
  showBroadcast?: boolean;
  receiveHelperText?: string;
  broadcastHelperText?: string;
  onDeleteSignal?: (signalId: string) => Promise<void> | void;
  onClearSignals?: () => Promise<void> | void;
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
  inputValue,
  options,
  helperText,
  placeholder,
  onChange,
  onInputValueChange,
}: {
  label: string;
  value: string[];
  inputValue: string;
  options: string[];
  helperText?: string;
  placeholder?: string;
  onChange: (nextValue: string[]) => void;
  onInputValueChange: (nextValue: string) => void;
}) {
  function commitInputValue() {
    const nextInputValue = inputValue.trim();
    if (!nextInputValue) {
      return;
    }
    onChange(normalizeSignals([...value, nextInputValue]));
    onInputValueChange("");
  }

  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      inputValue={inputValue}
      onInputChange={(_, nextValue, reason) => {
        if (reason === "reset") {
          return;
        }
        onInputValueChange(nextValue);
      }}
      onChange={(_, nextValue) => {
        onChange(normalizeSignals(nextValue));
        onInputValueChange("");
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") {
          return;
        }
        if ((event.nativeEvent as KeyboardEvent).isComposing) {
          return;
        }
        if (!inputValue.trim()) {
          return;
        }
        event.preventDefault();
        commitInputValue();
      }}
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

function SignalSectionHeader({
  title,
  canClear,
  onClear,
  children,
}: {
  title: string;
  canClear: boolean;
  onClear: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
        {title}
      </Typography>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        {canClear ? (
          <Button size="small" color="inherit" onClick={onClear}>
            {t("清空")}
          </Button>
        ) : null}
        {children}
      </Stack>
    </Stack>
  );
}

function SignalManagerPanel({
  summaries,
  onClose,
  onDeleteSignal,
  onClearSignals,
}: {
  summaries: WorkflowSignalSummary[];
  onClose: () => void;
  onDeleteSignal: (signalId: string) => void;
  onClearSignals: () => void;
}) {
  const { t } = useI18n();
  const hasSignals = summaries.length > 0;

  return (
    <Box
      sx={{
        width: { xs: "100%", sm: 340 },
        flex: "0 0 auto",
        bgcolor: "var(--panel-strong)",
        borderLeft: { xs: 0, sm: "1px solid var(--line)" },
        borderTop: { xs: "1px solid var(--line)", sm: 0 },
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        maxHeight: "inherit",
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "100%",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{ px: 2, py: 1.5, borderBottom: "1px solid var(--line)" }}
        >
          <Box minWidth={0}>
            <Typography variant="subtitle1" sx={{ fontWeight: 850, lineHeight: 1.25 }}>
              {t("Signal 管理")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {hasSignals ? t("{count} 个 Signal", { count: summaries.length }) : t("暂无 Signal")}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.6} alignItems="center">
            <Tooltip title={hasSignals ? t("清空全部 Signal 配置") : t("暂无可清空配置")}>
              <span>
                <IconButton
                  size="small"
                  disabled={!hasSignals}
                  onClick={onClearSignals}
                  aria-label={t("清空全部 Signal 配置")}
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: "12px",
                    border: "1px solid var(--line)",
                    color: "var(--muted)",
                    "&:hover": {
                      color: "var(--danger)",
                      borderColor: "var(--danger)",
                      bgcolor: "rgba(194,65,65,0.08)",
                    },
                  }}
                >
                  <TrashIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t("关闭")}>
              <IconButton
                size="small"
                onClick={onClose}
                aria-label={t("关闭 Signal 管理")}
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                  color: "var(--muted)",
                }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack
          spacing={0.85}
          sx={{ p: 1.25, overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}
        >
          {hasSignals ? (
            summaries.map((summary) => (
              <Box
                key={summary.id}
                sx={{
                  border: "1px solid var(--line-soft)",
                  borderRadius: "14px",
                  px: 1.05,
                  py: 0.9,
                  bgcolor: "var(--panel)",
                  minWidth: 0,
                }}
              >
                <Stack direction="row" alignItems="flex-start" spacing={0.8}>
                  <Box minWidth={0} flex={1}>
                    <Typography
                      variant="body2"
                      title={summary.id}
                      sx={{
                        fontWeight: 850,
                        overflowWrap: "anywhere",
                        lineHeight: 1.35,
                      }}
                    >
                      {summary.id}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.75 }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Receive ${summary.receiveCount}`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Broadcast ${summary.broadcastCount}`}
                      />
                      {summary.pendingCount > 0 ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t("待处理 {count}", { count: summary.pendingCount })}
                        />
                      ) : null}
                    </Stack>
                  </Box>
                  <Tooltip title={t("删除该 Signal 及关联 Receive / Broadcast")}>
                    <IconButton
                      size="small"
                      onClick={() => onDeleteSignal(summary.id)}
                      aria-label={t("删除 Signal {id}", { id: summary.id })}
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: "12px",
                        border: "1px solid var(--line)",
                        color: "var(--muted)",
                        "&:hover": {
                          color: "var(--danger)",
                          borderColor: "var(--danger)",
                          bgcolor: "rgba(194,65,65,0.08)",
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
              title={t("暂无 Signal")}
              description={t("配置联动后会显示可管理项。")}
            />
          )}
        </Stack>
      </Box>
    </Box>
  );
}

export function WorkflowRulesConfigDialog({
  open,
  title,
  context,
  receiveSignalIds,
  broadcastSignalIds,
  signalOptions,
  defaultBroadcastSignalId,
  signalSummaries = [],
  showReceive = true,
  showBroadcast = true,
  receiveHelperText,
  broadcastHelperText,
  onDeleteSignal,
  onClearSignals,
  onClose,
  onSave,
}: WorkflowRulesConfigDialogProps) {
  const { t } = useI18n();
  const [receiveDraft, setReceiveDraft] = useState<string[]>([]);
  const [broadcastDraft, setBroadcastDraft] = useState<string[]>([]);
  const [receiveInputDraft, setReceiveInputDraft] = useState("");
  const [broadcastInputDraft, setBroadcastInputDraft] = useState("");
  const [signalManagerOpen, setSignalManagerOpen] = useState(false);
  const savePointerHandledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSignalManagerOpen(false);
      return;
    }
    setReceiveDraft(normalizeSignals(receiveSignalIds));
    setBroadcastDraft(normalizeSignals(broadcastSignalIds));
    setReceiveInputDraft("");
    setBroadcastInputDraft("");
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
    const nextReceiveSignalIds = normalizeSignals([...receiveDraft, receiveInputDraft]);
    const nextBroadcastSignalIds = normalizeSignals([...broadcastDraft, broadcastInputDraft]);
    setReceiveDraft(nextReceiveSignalIds);
    setBroadcastDraft(nextBroadcastSignalIds);
    setReceiveInputDraft("");
    setBroadcastInputDraft("");
    onSave({
      receiveSignalIds: nextReceiveSignalIds,
      broadcastSignalIds: nextBroadcastSignalIds,
    });
  }

  function handleSavePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    savePointerHandledRef.current = true;
    save();
    window.setTimeout(() => {
      savePointerHandledRef.current = false;
    }, 0);
  }

  function handleSaveClick() {
    if (savePointerHandledRef.current) {
      return;
    }
    save();
  }

  function removeSignalFromDrafts(signalId: string) {
    setReceiveDraft((current) => current.filter((item) => item !== signalId));
    setBroadcastDraft((current) => current.filter((item) => item !== signalId));
  }

  function handleDeleteSignal(signalId: string) {
    removeSignalFromDrafts(signalId);
    void onDeleteSignal?.(signalId);
  }

  function handleClearSignals() {
    setReceiveDraft([]);
    setBroadcastDraft([]);
    setReceiveInputDraft("");
    setBroadcastInputDraft("");
    void onClearSignals?.();
  }

  const canManageSignals = Boolean(onDeleteSignal || onClearSignals);
  const displayTitle = title ?? t("联动配置");
  const displayReceiveHelperText =
    receiveHelperText ?? t("收到这些 Signal 后重放当前动作。");
  const displayBroadcastHelperText =
    broadcastHelperText ?? t("当前动作成功后发送这些 Signal。");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={signalManagerOpen ? "md" : "sm"}
      className="workflow-rules-config-dialog"
      PaperProps={{
        sx: {
          overflow: "hidden",
          transition: "max-width 180ms ease, width 180ms ease",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          minHeight: 0,
          maxHeight: "calc(100vh - 64px)",
        }}
      >
        <Box
          sx={{
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <DialogTitle>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1.05rem", fontWeight: 850 }}>
                {displayTitle}
              </Typography>
              {canManageSignals ? (
                <Tooltip
                  title={signalManagerOpen ? t("收起 Signal 管理") : t("管理 Signal")}
                >
                  <IconButton
                    size="small"
                    color={signalManagerOpen ? "primary" : "default"}
                    onClick={() => setSignalManagerOpen((current) => !current)}
                    aria-label={
                      signalManagerOpen ? t("收起 Signal 管理") : t("管理 Signal")
                    }
                    sx={{
                      borderRadius: "12px",
                      bgcolor: signalManagerOpen ? "rgba(37,99,235,0.08)" : undefined,
                    }}
                  >
                    <PanelSideIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
          </DialogTitle>
          <DialogContent sx={{ minHeight: 0, overflowY: "auto" }}>
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
                    <SignalSectionHeader
                      title="Receive"
                      canClear={receiveDraft.length > 0 || Boolean(receiveInputDraft.trim())}
                      onClear={() => {
                        setReceiveDraft([]);
                        setReceiveInputDraft("");
                      }}
                    />
                    <SignalSelector
                      label={t("接收 Signal")}
                      value={receiveDraft}
                      inputValue={receiveInputDraft}
                      options={options}
                      placeholder={t("选择或输入 Signal")}
                      helperText={displayReceiveHelperText}
                      onChange={setReceiveDraft}
                      onInputValueChange={setReceiveInputDraft}
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
                    <SignalSectionHeader
                      title="Broadcast"
                      canClear={broadcastDraft.length > 0 || Boolean(broadcastInputDraft.trim())}
                      onClear={() => {
                        setBroadcastDraft([]);
                        setBroadcastInputDraft("");
                      }}
                    >
                      {canUseDefault ? (
                        <Button
                          size="small"
                          onClick={() =>
                            setBroadcastDraft((current) =>
                              normalizeSignals([...current, defaultBroadcastSignalId!]),
                            )
                          }
                        >
                          {t("使用默认")}
                        </Button>
                      ) : null}
                    </SignalSectionHeader>
                    <SignalSelector
                      label={t("发送 Signal")}
                      value={broadcastDraft}
                      inputValue={broadcastInputDraft}
                      options={options}
                      placeholder={defaultBroadcastSignalId || t("输入 Signal")}
                      helperText={
                        defaultBroadcastSignalId
                          ? t("{helperText} 默认：{signalId}", {
                              helperText: displayBroadcastHelperText,
                              signalId: defaultBroadcastSignalId,
                            })
                          : displayBroadcastHelperText
                      }
                      onChange={setBroadcastDraft}
                      onInputValueChange={setBroadcastInputDraft}
                    />
                  </Stack>
                </Box>
              ) : null}
              {loopSignals.length > 0 ? (
                <Alert severity="warning" variant="outlined">
                  {t("Receive 和 Broadcast 包含同名 Signal，可能形成循环。")}
                </Alert>
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions className="workflow-rules-config-dialog-actions">
            <Button onClick={onClose}>{t("取消")}</Button>
            <Button
              variant="contained"
              onPointerDown={handleSavePointerDown}
              onClick={handleSaveClick}
            >
              {t("保存")}
            </Button>
          </DialogActions>
        </Box>
        {canManageSignals && signalManagerOpen ? (
          <SignalManagerPanel
            summaries={signalSummaries}
            onClose={() => setSignalManagerOpen(false)}
            onDeleteSignal={handleDeleteSignal}
            onClearSignals={handleClearSignals}
          />
        ) : null}
      </Box>
    </Dialog>
  );
}
