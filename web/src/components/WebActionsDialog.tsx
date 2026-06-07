import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type {
  WebActionListResponse,
  WebActionRunResult,
  WebActionSummary,
  WebActionTarget,
} from "../app-types";
import { OpenExternalIcon, PlayIcon, RefreshIcon, WebsiteIcon } from "./AppIcons";

const TEMPORARY_ACTION_KEY = "__temporary__";
const DEFAULT_TEMPORARY_SCRIPT = `return {
  title: document.title,
  url: location.href,
  selectedText: window.getSelection()?.toString() || ""
};`;

export type WebActionsDialogContext = {
  title: string;
  scope: string;
  url: string;
};

type WebActionsDialogProps = {
  open: boolean;
  context: WebActionsDialogContext | null;
  onClose: () => void;
};

function defaultParamValues(action: WebActionSummary | null) {
  const values: Record<string, string> = {};
  for (const param of action?.params ?? []) {
    values[param.key] = param.defaultValue ?? "";
  }
  return values;
}

function formatTargetLabel(target: WebActionTarget) {
  return [target.title, target.url].filter(Boolean).join(" · ") || target.id;
}

function formatResult(result: WebActionRunResult | null) {
  if (!result) {
    return "";
  }
  if (result.error) {
    return result.error;
  }
  return result.resultText || "执行完成";
}

export function WebActionsDialog({
  open,
  context,
  onClose,
}: WebActionsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [actions, setActions] = useState<WebActionSummary[]>([]);
  const [targets, setTargets] = useState<WebActionTarget[]>([]);
  const [selectedActionKey, setSelectedActionKey] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [temporaryScript, setTemporaryScript] = useState(DEFAULT_TEMPORARY_SCRIPT);
  const [temporaryParamsText, setTemporaryParamsText] = useState("{}");
  const [result, setResult] = useState<WebActionRunResult | null>(null);

  const selectedAction = useMemo(
    () => actions.find((item) => item.key === selectedActionKey) ?? null,
    [actions, selectedActionKey],
  );
  const isTemporaryAction = selectedActionKey === TEMPORARY_ACTION_KEY;
  const scriptValue = isTemporaryAction
    ? temporaryScript
    : selectedAction?.script ?? "";

  async function loadDialogData(nextContext = context) {
    if (!nextContext?.url) {
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const actionList = await invoke<WebActionListResponse>("list_web_actions", {
        scope: nextContext.scope,
        url: nextContext.url,
      });
      const openedTarget = await invoke<WebActionTarget>("open_web_action_target", {
        url: nextContext.url,
      });
      const nextTargets = await invoke<WebActionTarget[]>("list_web_action_targets");
      const nextActions = actionList.actions;
      setConfigPath(actionList.configPath);
      setActions(nextActions);
      setTargets(nextTargets.length > 0 ? nextTargets : [openedTarget]);
      setSelectedTargetId(openedTarget.id);
      setSelectedActionKey((current) =>
        current === TEMPORARY_ACTION_KEY ||
        nextActions.some((item) => item.key === current)
          ? current
          : nextActions[0]?.key ?? TEMPORARY_ACTION_KEY,
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !context) {
      setActions([]);
      setTargets([]);
      setSelectedActionKey("");
      setSelectedTargetId("");
      setParamValues({});
      setResult(null);
      setError("");
      return;
    }
    void loadDialogData(context);
  }, [open, context?.scope, context?.url]);

  useEffect(() => {
    setParamValues(defaultParamValues(selectedAction));
  }, [selectedAction?.key]);

  async function refreshTargets() {
    setError("");
    try {
      const nextTargets = await invoke<WebActionTarget[]>("list_web_action_targets");
      setTargets(nextTargets);
      setSelectedTargetId((current) =>
        nextTargets.some((item) => item.id === current)
          ? current
          : nextTargets[0]?.id ?? "",
      );
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function reopenCurrentTarget() {
    if (!context?.url) {
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const openedTarget = await invoke<WebActionTarget>("open_web_action_target", {
        url: context.url,
      });
      const nextTargets = await invoke<WebActionTarget[]>("list_web_action_targets");
      const mergedTargets = [
        openedTarget,
        ...nextTargets.filter((target) => target.id !== openedTarget.id),
      ];
      setTargets(mergedTargets);
      setSelectedTargetId(openedTarget.id);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function openConfigFile() {
    if (!configPath) {
      return;
    }
    try {
      await invoke("open_local_path", { path: configPath });
    } catch (reason) {
      setError(String(reason));
    }
  }

  function parseTemporaryParams() {
    try {
      const parsed = JSON.parse(temporaryParamsText.trim() || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("请输入 JSON 对象");
      }
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          key,
          typeof value === "string" ? value : JSON.stringify(value) ?? "",
        ]),
      );
    } catch (reason) {
      setError(`临时参数 JSON 无效：${String(reason)}`);
      return null;
    }
  }

  async function runSelectedAction() {
    if (!context || !selectedTargetId) {
      return;
    }
    if (!isTemporaryAction && !selectedAction) {
      return;
    }
    const temporaryParams = isTemporaryAction ? parseTemporaryParams() : {};
    if (isTemporaryAction && !temporaryParams) {
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = isTemporaryAction
        ? await invoke<WebActionRunResult>("run_web_action_script", {
            request: {
              targetId: selectedTargetId,
              script: temporaryScript,
              params: temporaryParams,
            },
          })
        : await invoke<WebActionRunResult>("run_web_action", {
            request: {
              actionKey: selectedAction!.key,
              targetId: selectedTargetId,
              scope: context.scope,
              url: context.url,
              params: paramValues,
            },
          });
      setResult(response);
      if (response.error) {
        setError(response.error);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunning(false);
    }
  }

  const canRun = Boolean(
    context?.url &&
      selectedTargetId &&
      (isTemporaryAction ? temporaryScript.trim() : selectedAction),
  );
  const resultText = formatResult(result);

  return (
    <Dialog
      open={open}
      onClose={running ? undefined : onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          bgcolor: "var(--panel-strong)",
          color: "var(--text)",
          borderRadius: "18px",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)",
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle sx={{ px: 2.2, pt: 1.8, pb: 0.8 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: "12px",
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--line-soft)",
              bgcolor: "rgba(255,255,255,0.035)",
              color: "var(--muted)",
              flexShrink: 0,
            }}
          >
            <WebsiteIcon fontSize="small" />
          </Box>
          <Box minWidth={0} flex={1}>
            <Typography variant="h6" sx={{ fontSize: "1.02rem", fontWeight: 850 }}>
              网页动作
            </Typography>
            <Typography
              variant="body2"
              noWrap
              sx={{ color: "var(--muted)", fontWeight: 700, mt: 0.2 }}
            >
              {context?.title || "未选择目标"}
            </Typography>
          </Box>
          {context?.scope ? (
            <Chip size="small" label={context.scope} variant="outlined" />
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ px: 2.2, pt: 0.85, pb: 1.4 }}>
        <Stack spacing={1.15}>
          <Box
            sx={{
              p: 1.1,
              borderRadius: "14px",
              border: "1px solid var(--line-soft)",
              bgcolor: "rgba(255,255,255,0.024)",
            }}
          >
            <Stack spacing={1}>
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                useFlexGap
                sx={{ flexWrap: "wrap", rowGap: 0.45 }}
              >
                <Typography
                  variant="caption"
                  sx={{ color: "var(--muted)", fontWeight: 850 }}
                >
                  受控页面
                </Typography>
                <Box sx={{ flex: 1, minWidth: 24 }} />
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<RefreshIcon fontSize="small" />}
                  sx={{ minWidth: 0, px: 1 }}
                  disabled={loading || running}
                  onClick={() => void refreshTargets()}
                >
                  刷新
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<OpenExternalIcon fontSize="small" />}
                  sx={{ minWidth: 0, px: 1 }}
                  disabled={loading || running || !context?.url}
                  onClick={() => void reopenCurrentTarget()}
                >
                  重新打开
                </Button>
              </Stack>
              <TextField
                select
                size="small"
                value={selectedTargetId}
                onChange={(event) => setSelectedTargetId(event.target.value)}
                disabled={loading || targets.length === 0}
                fullWidth
              >
                {targets.map((target) => (
                  <MenuItem key={target.id} value={target.id}>
                    {formatTargetLabel(target)}
                  </MenuItem>
                ))}
              </TextField>
              <Typography
                variant="caption"
                sx={{
                  color: "var(--muted)",
                  overflowWrap: "anywhere",
                  fontFamily:
                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                }}
              >
                {context?.url || "未配置 URL"}
              </Typography>
            </Stack>
          </Box>

          <Box
            sx={{
              p: 1.1,
              borderRadius: "14px",
              border: "1px solid var(--line-soft)",
              bgcolor: "rgba(255,255,255,0.024)",
            }}
          >
            <Stack spacing={1}>
              <Typography
                variant="caption"
                sx={{ color: "var(--muted)", fontWeight: 850 }}
              >
                动作脚本
              </Typography>
              <TextField
                select
                size="small"
                value={selectedActionKey}
                onChange={(event) => setSelectedActionKey(event.target.value)}
                disabled={loading}
                fullWidth
              >
                {actions.map((action) => (
                  <MenuItem key={action.key} value={action.key}>
                    {action.name || action.key}
                    {action.matchPatterns.length > 0
                      ? ` · ${action.matchPatterns[0]}`
                      : ""}
                  </MenuItem>
                ))}
                <MenuItem value={TEMPORARY_ACTION_KEY}>
                  临时脚本 · 当前页面
                </MenuItem>
              </TextField>
              {selectedAction?.params.length ? (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "minmax(0,1fr)",
                      sm: "repeat(2, minmax(0,1fr))",
                    },
                    gap: 0.8,
                  }}
                >
                  {selectedAction.params.map((param) => (
                    <TextField
                      key={param.key}
                      size="small"
                      label={param.label || param.key}
                      value={paramValues[param.key] ?? ""}
                      onChange={(event) =>
                        setParamValues((current) => ({
                          ...current,
                          [param.key]: event.target.value,
                        }))
                      }
                    />
                  ))}
                </Box>
              ) : null}
              {isTemporaryAction ? (
                <TextField
                  size="small"
                  label="临时参数 JSON"
                  value={temporaryParamsText}
                  onChange={(event) => setTemporaryParamsText(event.target.value)}
                  fullWidth
                  sx={{
                    "& .MuiInputBase-root": {
                      fontFamily:
                        '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                      fontSize: "0.74rem",
                    },
                  }}
                />
              ) : null}
              <TextField
                value={scriptValue}
                multiline
                minRows={5}
                fullWidth
                onChange={(event) => {
                  if (isTemporaryAction) {
                    setTemporaryScript(event.target.value);
                  }
                }}
                InputProps={{ readOnly: !isTemporaryAction }}
                helperText={isTemporaryAction ? "临时脚本不会写入配置文件" : ""}
                sx={{
                  "& .MuiInputBase-root": {
                    fontFamily:
                      '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                    fontSize: "0.74rem",
                    lineHeight: 1.48,
                  },
                }}
              />
            </Stack>
          </Box>

          {error || resultText ? (
            <Box
              sx={{
                p: 1,
                borderRadius: "13px",
                border: "1px solid var(--line-soft)",
                bgcolor: error
                  ? "rgba(193,107,118,0.09)"
                  : "rgba(95,128,104,0.1)",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  color: "var(--text)",
                  fontFamily:
                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                  lineHeight: 1.5,
                }}
              >
                {error || resultText}
              </Typography>
            </Box>
          ) : null}

          {configPath ? (
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              useFlexGap
              sx={{ flexWrap: "wrap", rowGap: 0.45 }}
            >
              <Typography
                variant="caption"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  color: "var(--muted)",
                  overflowWrap: "anywhere",
                  fontFamily:
                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                }}
              >
                {configPath}
              </Typography>
              <Button
                size="small"
                color="inherit"
                startIcon={<OpenExternalIcon fontSize="small" />}
                sx={{ ml: "auto", minWidth: 0, px: 1 }}
                disabled={running}
                onClick={() => void openConfigFile()}
              >
                打开配置
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.2, pb: 1.75, pt: 0.35 }}>
        <Button color="inherit" onClick={onClose} disabled={running}>
          关闭
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<PlayIcon fontSize="small" />}
          disabled={!canRun || loading || running}
          onClick={() => void runSelectedAction()}
        >
          {running ? "执行中" : "执行动作"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
