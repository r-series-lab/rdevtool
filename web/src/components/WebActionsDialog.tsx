import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type {
  FinderEntry,
  WebActionListResponse,
  WebActionParamSummary,
  WebActionRunResult,
  WebActionSummary,
  WebActionTarget,
} from "../app-types";
import {
  AppWindowIcon,
  ClearIcon,
  CopyIcon,
  OpenExternalIcon,
  PlayIcon,
  RefreshIcon,
  WebsiteIcon,
} from "./AppIcons";

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
  entry?: FinderEntry | null;
  contextParams?: Record<string, string>;
};

type WebActionsPanelProps = {
  context: WebActionsDialogContext | null;
  active?: boolean;
  compact?: boolean;
  onRunningChange?: (running: boolean) => void;
};

type WebActionsDialogProps = {
  open: boolean;
  context: WebActionsDialogContext | null;
  onClose: () => void;
};

export type RuntimePanelTabItem<T extends string = string> = {
  value: T;
  label: string;
  icon?: ReactElement;
  disabled?: boolean;
};

export type RuntimePanelDrawerProps<T extends string = string> = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  icon?: ReactNode;
  statusDotColor?: string;
  statusDotShadow?: string;
  chips?: ReactNode;
  headerActions?: ReactNode;
  tabs?: RuntimePanelTabItem<T>[];
  activeTab?: T;
  onTabChange?: (value: T) => void;
  bodyOverflow?: "auto" | "hidden";
  closeDisabled?: boolean;
  children?: ReactNode;
};

function lookupContextParam(
  contextParams: Record<string, string> | undefined,
  namespaces: string[],
  sourceKey: string,
) {
  const key = sourceKey.trim();
  if (!key) {
    return undefined;
  }
  const candidates = [
    key,
    ...namespaces.map((namespace) => `${namespace}.${key}`),
  ];
  return candidates
    .map((candidate) => contextParams?.[candidate])
    .find((value) => value != null);
}

function webActionParamSourceNamespaces(source: string) {
  switch (source.trim().toLowerCase()) {
    case "project":
      return ["project"];
    case "workspace":
      return ["workspace"];
    case "debug":
    case "debugprofile":
    case "debug_profile":
    case "debug-profile":
      return ["debugProfile", "debug_profile"];
    case "runtime":
    case "runtimeprofile":
    case "runtime_profile":
    case "runtime-profile":
      return ["runtimeProfile", "runtime_profile"];
    case "context":
      return [];
    default:
      return [source.trim()];
  }
}

function resolveParamInitialValue(
  param: WebActionParamSummary,
  contextParams?: Record<string, string>,
) {
  const source = (param.source || "default").trim().toLowerCase();
  if (!source || source === "default" || source === "fixed" || source === "value") {
    return param.defaultValue ?? "";
  }
  const sourceKey = param.sourceKey?.trim() || param.key;
  return (
    lookupContextParam(
      contextParams,
      webActionParamSourceNamespaces(source),
      sourceKey,
    ) ??
    param.defaultValue ??
    ""
  );
}

function webActionParamSourceLabel(
  param: WebActionParamSummary,
  contextParams?: Record<string, string>,
) {
  const source = (param.source || "default").trim().toLowerCase();
  if (!source || source === "default" || source === "fixed" || source === "value") {
    return "";
  }
  const sourceKey = param.sourceKey?.trim() || param.key;
  const resolved = resolveParamInitialValue(param, contextParams);
  const sourceLabel =
    {
      project: "项目",
      workspace: "工作区",
      debug: "调试档案",
      debugprofile: "调试档案",
      debug_profile: "调试档案",
      "debug-profile": "调试档案",
      runtime: "运行配置",
      runtimeprofile: "运行配置",
      runtime_profile: "运行配置",
      "runtime-profile": "运行配置",
      context: "上下文",
    }[source] ?? source;
  return `来源：${sourceLabel} · ${sourceKey}${resolved ? ` · ${resolved}` : ""}`;
}

function defaultParamValues(
  action: WebActionSummary | null,
  contextParams?: Record<string, string>,
) {
  const values: Record<string, string> = {};
  for (const param of action?.params ?? []) {
    values[param.key] = resolveParamInitialValue(param, contextParams);
  }
  return values;
}

function formatTargetLabel(target: WebActionTarget) {
  return [target.title, target.url].filter(Boolean).join(" · ") || target.id;
}

function webActionTargetListCommand(context: WebActionsDialogContext | null) {
  return context?.entry
    ? {
        command: "list_web_action_navigation_targets",
        args: { entry: context.entry },
      }
    : {
        command: "list_web_action_targets",
        args: {},
      };
}

function normalizedComparableUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/, "");
  }
}

function targetContextMatchRank(targetUrl: string, contextUrl: string) {
  const normalizedTarget = normalizedComparableUrl(targetUrl);
  const normalizedContext = normalizedComparableUrl(contextUrl);
  if (!normalizedTarget || !normalizedContext) {
    return 0;
  }
  if (normalizedTarget === normalizedContext) {
    return 3;
  }
  try {
    const target = new URL(normalizedTarget);
    const context = new URL(normalizedContext);
    if (target.origin !== context.origin) {
      return 0;
    }
    return target.pathname === context.pathname ? 2 : 1;
  } catch {
    return 0;
  }
}

function findMatchingTarget(targets: WebActionTarget[], contextUrl: string) {
  return targets.reduce<WebActionTarget | null>((best, target) => {
    const rank = targetContextMatchRank(target.url, contextUrl);
    if (rank === 0) {
      return best;
    }
    if (!best || rank > targetContextMatchRank(best.url, contextUrl)) {
      return target;
    }
    return best;
  }, null);
}

function formatResult(result: WebActionRunResult | null) {
  if (!result) {
    return "";
  }
  return result.resultText || "执行完成";
}

function formatActionOption(action: WebActionSummary) {
  const name = action.name || action.key;
  if (action.kind === "request") {
    const request = action.request;
    return `${name} · ${request?.method || "GET"} ${request?.url || "-"}`;
  }
  return `${name}${
    action.matchPatterns.length > 0 ? ` · ${action.matchPatterns[0]}` : ""
  }`;
}

function formatRequestPreview(action: WebActionSummary | null) {
  const request = action?.request;
  if (!request) {
    return "";
  }
  const lines = [
    `${request.method || "GET"} ${request.url || "-"}`,
    `timeout: ${request.timeoutMs || 30000} ms`,
  ];
  const headers = Object.entries(request.headers ?? {});
  if (headers.length > 0) {
    lines.push("", "headers:");
    for (const [key, value] of headers) {
      lines.push(`  ${key}: ${value}`);
    }
  }
  if (request.body) {
    lines.push("", "body:", request.body);
  }
  return lines.join("\n");
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appendCliFlag(parts: string[], flag: string, value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }
  parts.push(flag, shellQuote(trimmed));
}

function webActionCliCommand(options: {
  context: WebActionsDialogContext | null;
  selectedAction: WebActionSummary | null;
  selectedActionKey: string;
  selectedTargetId: string;
  selectedActionNeedsTarget: boolean;
  paramValues: Record<string, string>;
  temporaryScript: string;
}) {
  const {
    context,
    selectedAction,
    selectedActionKey,
    selectedTargetId,
    selectedActionNeedsTarget,
    paramValues,
    temporaryScript,
  } = options;
  if (!context?.url) {
    return "";
  }
  if (selectedActionNeedsTarget && !selectedTargetId) {
    return `rdevtool --json web-actions open --url ${shellQuote(context.url)}`;
  }

  if (selectedActionKey === TEMPORARY_ACTION_KEY) {
    const parts = ["rdevtool", "--json", "web-actions", "script"];
    appendCliFlag(parts, "--target", selectedTargetId);
    appendCliFlag(parts, "--script", temporaryScript);
    return parts.join(" ");
  }

  if (!selectedAction) {
    return `rdevtool --json web-actions list --url ${shellQuote(context.url)}`;
  }

  const parts = ["rdevtool", "--json", "web-actions", "run"];
  appendCliFlag(parts, "--action", selectedAction.key);
  appendCliFlag(parts, "--target", selectedTargetId);
  appendCliFlag(parts, "--scope", context.scope);
  appendCliFlag(parts, "--url", context.url);
  for (const [key, value] of Object.entries(paramValues)) {
    appendCliFlag(parts, "--param", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(context.contextParams ?? {})) {
    appendCliFlag(parts, "--context", `${key}=${value}`);
  }
  return parts.join(" ");
}

export function RuntimePanelDrawer<T extends string = string>({
  open,
  onClose,
  title,
  subtitle,
  icon,
  statusDotColor,
  statusDotShadow,
  chips,
  headerActions,
  tabs = [],
  activeTab,
  onTabChange,
  bodyOverflow = "auto",
  closeDisabled = false,
  children,
}: RuntimePanelDrawerProps<T>) {
  return (
    <Dialog
      className="runtime-panel-dialog"
      open={open}
      onClose={closeDisabled ? undefined : onClose}
      keepMounted
      maxWidth={false}
      PaperProps={{
        className: "runtime-panel-paper",
      }}
    >
      <Box
        className="runtime-panel-shell"
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          p: 1.5,
          gap: 1.2,
        }}
      >
        <Stack
          className="runtime-panel-header"
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          spacing={1}
        >
          <Stack spacing={0.5} minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={0.8} minWidth={0}>
              {statusDotColor ? (
                <Box
                  sx={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    flexShrink: 0,
                    bgcolor: statusDotColor,
                    boxShadow: statusDotShadow || "none",
                  }}
                />
              ) : icon ? (
                <Box
                  className="runtime-panel-title-icon"
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: "10px",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    bgcolor: "rgba(255,255,255,0.028)",
                    color: "var(--muted)",
                    border: "1px solid var(--line-soft)",
                  }}
                >
                  {icon}
                </Box>
              ) : null}
              <Typography
                className="runtime-panel-title"
                variant="h6"
                sx={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "1rem",
                  fontWeight: 750,
                  color: "var(--text)",
                }}
              >
                {title}
              </Typography>
            </Stack>
            {subtitle ? (
              <Typography
                className="runtime-panel-subtitle"
                variant="caption"
                noWrap
                sx={{
                  color: "var(--muted)",
                  fontFamily:
                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                }}
              >
                {subtitle}
              </Typography>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={0.45}>
            {headerActions}
            <Tooltip title="关闭">
              <span>
                <IconButton
                  aria-label="关闭运行面板"
                  disabled={closeDisabled}
                  onClick={onClose}
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: "999px",
                    bgcolor: "rgba(255,255,255,0.028)",
                    color: "var(--muted)",
                    border: "1px solid var(--line-soft)",
                    "&:hover": {
                      bgcolor: "rgba(255,255,255,0.052)",
                      color: "var(--text)",
                    },
                  }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {chips ? (
          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            {chips}
          </Stack>
        ) : null}

        {tabs.length > 0 && activeTab ? (
          <Tabs
            className="runtime-panel-tabs"
            value={activeTab}
            onChange={(_, value) => onTabChange?.(value as T)}
            variant="fullWidth"
            sx={{
              minHeight: 34,
              borderRadius: "12px",
              border: "1px solid var(--line-soft)",
              bgcolor: "rgba(255,255,255,0.018)",
              "& .MuiTabs-indicator": {
                height: 2,
                borderRadius: "999px",
                bgcolor: "var(--accent)",
              },
              "& .MuiTab-root": {
                minHeight: 34,
                minWidth: 0,
                px: 0.65,
                py: 0.35,
                gap: 0.35,
                color: "var(--muted)",
                fontSize: "0.72rem",
                fontWeight: 750,
                textTransform: "none",
              },
              "& .MuiTab-root.Mui-selected": {
                color: "var(--text)",
              },
            }}
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.value}
                value={tab.value}
                icon={tab.icon}
                iconPosition="start"
                label={tab.label}
                disabled={tab.disabled}
              />
            ))}
          </Tabs>
        ) : null}

        <Box
          className="runtime-panel-body"
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 0.85,
            overflow: bodyOverflow,
            flex: 1,
            minHeight: 0,
            pr: 0.2,
          }}
        >
          {children}
        </Box>
      </Box>
    </Dialog>
  );
}

export function WebActionsPanel({
  context,
  active = true,
  compact = false,
  onRunningChange,
}: WebActionsPanelProps) {
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
  const [copiedCliCommand, setCopiedCliCommand] = useState(false);

  const selectedAction = useMemo(
    () => actions.find((item) => item.key === selectedActionKey) ?? null,
    [actions, selectedActionKey],
  );
  const isTemporaryAction = selectedActionKey === TEMPORARY_ACTION_KEY;
  const selectedActionNeedsTarget =
    isTemporaryAction || selectedAction?.kind !== "request";
  const scriptValue = isTemporaryAction
    ? temporaryScript
    : selectedAction?.kind === "request"
      ? formatRequestPreview(selectedAction)
      : selectedAction?.script ?? "";
  const cliCommand = useMemo(
    () =>
      webActionCliCommand({
        context,
        selectedAction,
        selectedActionKey,
        selectedTargetId,
        selectedActionNeedsTarget,
        paramValues,
        temporaryScript,
      }),
    [
      context,
      selectedAction,
      selectedActionKey,
      selectedTargetId,
      selectedActionNeedsTarget,
      paramValues,
      temporaryScript,
    ],
  );

  async function loadPanelData(nextContext = context) {
    if (!nextContext?.url) {
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const targetList = webActionTargetListCommand(nextContext);
      const [actionList, nextTargets] = await Promise.all([
        invoke<WebActionListResponse>("list_web_actions", {
          scope: nextContext.scope,
          url: nextContext.url,
        }),
        invoke<WebActionTarget[]>(targetList.command, targetList.args),
      ]);
      const nextActions = actionList.actions;
      const matchingTarget = findMatchingTarget(nextTargets, nextContext.url);
      setConfigPath(actionList.configPath);
      setActions(nextActions);
      setTargets(nextTargets);
      setSelectedTargetId(matchingTarget?.id ?? "");
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
    if (!context) {
      setActions([]);
      setTargets([]);
      setSelectedActionKey("");
      setSelectedTargetId("");
      setParamValues({});
      setResult(null);
      setError("");
      return;
    }
    if (!active) {
      return;
    }
    void loadPanelData(context);
  }, [active, context?.scope, context?.url]);

  useEffect(() => {
    setParamValues(defaultParamValues(selectedAction, context?.contextParams));
  }, [context?.contextParams, selectedAction?.key]);

  useEffect(() => {
    onRunningChange?.(running);
  }, [onRunningChange, running]);

  async function refreshTargets() {
    setError("");
    try {
      const targetList = webActionTargetListCommand(context);
      const nextTargets = await invoke<WebActionTarget[]>(
        targetList.command,
        targetList.args,
      );
      setTargets(nextTargets);
      setSelectedTargetId((current) =>
        nextTargets.some((item) => item.id === current)
          ? current
          : findMatchingTarget(nextTargets, context?.url ?? "")?.id ?? "",
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
      const openedTarget = context.entry
        ? await invoke<WebActionTarget>("open_web_action_navigation_target", {
            entry: context.entry,
          })
        : await invoke<WebActionTarget>("open_web_action_target", {
            url: context.url,
          });
      const targetList = webActionTargetListCommand(context);
      const nextTargets = await invoke<WebActionTarget[]>(
        targetList.command,
        targetList.args,
      );
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

  async function copyCliCommand() {
    if (!cliCommand || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(cliCommand);
    setCopiedCliCommand(true);
    window.setTimeout(() => setCopiedCliCommand(false), 1200);
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
    if (!context) {
      return;
    }
    if (selectedActionNeedsTarget && !selectedTargetId) {
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
        ? await invoke<WebActionRunResult>(
            context.entry
              ? "run_web_action_navigation_script"
              : "run_web_action_script",
            {
              ...(context.entry ? { entry: context.entry } : {}),
              request: {
                targetId: selectedTargetId,
                script: temporaryScript,
                params: temporaryParams,
              },
            },
          )
        : await invoke<WebActionRunResult>(
            context.entry ? "run_web_action_navigation" : "run_web_action",
            {
              ...(context.entry ? { entry: context.entry } : {}),
              request: {
                actionKey: selectedAction!.key,
                targetId: selectedTargetId || undefined,
                scope: context.scope,
                url: context.url,
                params: paramValues,
                contextParams: context.contextParams ?? {},
              },
            },
          );
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
      (!selectedActionNeedsTarget || selectedTargetId) &&
      (isTemporaryAction ? temporaryScript.trim() : selectedAction),
  );
  const resultText = formatResult(result);
  const resultFailed = Boolean(error || (result && !result.success));

  return (
    <Stack className="web-actions-panel" spacing={compact ? 1 : 1.15}>
      <Box
        sx={{
          p: compact ? 0.95 : 1.1,
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
              打开页面
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
            {!selectedTargetId ? (
              <MenuItem value="" disabled>
                {targets.length > 0 ? "请选择受控页面" : "暂无受控页面"}
              </MenuItem>
            ) : null}
            {targets.map((target) => (
              <MenuItem key={target.id} value={target.id}>
                {formatTargetLabel(target)}
              </MenuItem>
            ))}
          </TextField>
          {!selectedTargetId ? (
            <Typography
              variant="caption"
              sx={{ color: "var(--muted)", fontWeight: 700 }}
            >
              {selectedAction?.kind === "request"
                ? "请求动作可直接运行；脚本动作需要先打开受控页面。"
                : targets.length > 0
                  ? "未找到与当前入口匹配的页面，可手动选择或打开页面。"
                  : "未发现受控页面，请先打开页面。"}
            </Typography>
          ) : null}
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
          p: compact ? 0.95 : 1.1,
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
            {selectedAction?.kind === "request" ? " / 请求" : ""}
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
                {formatActionOption(action)}
              </MenuItem>
            ))}
            <MenuItem value={TEMPORARY_ACTION_KEY}>临时脚本 · 当前页面</MenuItem>
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
                  helperText={webActionParamSourceLabel(
                    param,
                    context?.contextParams,
                  )}
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
            label={selectedAction?.kind === "request" ? "请求配置" : undefined}
            minRows={selectedAction?.kind === "request" ? 3 : compact ? 4 : 5}
            maxRows={compact ? 7 : 10}
            fullWidth
            onChange={(event) => {
              if (isTemporaryAction) {
                setTemporaryScript(event.target.value);
              }
            }}
            InputProps={{ readOnly: !isTemporaryAction }}
            helperText={
              isTemporaryAction
                ? "临时脚本不会写入配置文件"
                : selectedAction?.kind === "request"
                  ? "请求动作由 Rust HTTP 客户端执行，支持 GET/POST/PUT/PATCH/DELETE、Header、Body 和参数替换。"
                  : ""
            }
            sx={{
              "& .MuiInputBase-root": {
                fontFamily:
                  '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                fontSize: "0.74rem",
                lineHeight: 1.48,
              },
              "& textarea": {
                scrollbarWidth: "thin",
                scrollbarColor: "var(--scrollbar-thumb) transparent",
              },
              "& textarea::-webkit-scrollbar": {
                width: 6,
              },
              "& textarea::-webkit-scrollbar-track": {
                background: "transparent",
              },
              "& textarea::-webkit-scrollbar-thumb": {
                borderRadius: "999px",
                backgroundColor: "var(--scrollbar-thumb)",
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
            bgcolor: resultFailed
              ? "rgba(193,107,118,0.09)"
              : "rgba(95,128,104,0.1)",
            maxHeight: compact ? 160 : 220,
            overflow: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: "var(--scrollbar-thumb) transparent",
            "&::-webkit-scrollbar": {
              width: 6,
            },
            "&::-webkit-scrollbar-track": {
              background: "transparent",
            },
            "&::-webkit-scrollbar-thumb": {
              borderRadius: "999px",
              backgroundColor: "var(--scrollbar-thumb)",
            },
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
        <Typography
          variant="caption"
          sx={{
            color: "var(--muted)",
            overflowWrap: "anywhere",
            fontFamily:
              '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
          }}
        >
          {configPath}
        </Typography>
      ) : null}

      <Stack
        className="web-actions-panel-actions"
        direction="row"
        spacing={0.75}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          pt: 0.15,
          flexWrap: "wrap",
          rowGap: 0.65,
        }}
      >
        <Button
          size="small"
          color="inherit"
          startIcon={<OpenExternalIcon fontSize="small" />}
          disabled={!configPath || running}
          onClick={() => void openConfigFile()}
          sx={{
            minWidth: 0,
            height: 32,
            px: 1.1,
            borderRadius: "10px",
            border: "1px solid var(--line-soft)",
            color: "var(--muted)",
            bgcolor: "rgba(255,255,255,0.018)",
            "&:hover": {
              bgcolor: "rgba(255,255,255,0.04)",
              color: "var(--text)",
            },
          }}
        >
          配置
        </Button>
        <Button
          size="small"
          color="inherit"
          startIcon={<CopyIcon fontSize="small" />}
          disabled={!cliCommand || running}
          onClick={() => void copyCliCommand()}
          sx={{
            minWidth: 0,
            height: 32,
            px: 1.1,
            borderRadius: "10px",
            border: "1px solid var(--line-soft)",
            color: copiedCliCommand ? "var(--success)" : "var(--muted)",
            bgcolor: "rgba(255,255,255,0.018)",
            "&:hover": {
              bgcolor: "rgba(255,255,255,0.04)",
              color: "var(--text)",
            },
          }}
        >
          {copiedCliCommand ? "已复制" : "复制命令"}
        </Button>
        <Button
          variant="contained"
          startIcon={<PlayIcon fontSize="small" />}
          disabled={!canRun || loading || running}
          onClick={() => void runSelectedAction()}
          sx={{
            height: 34,
            minWidth: 116,
            px: 1.45,
            borderRadius: "10px",
            fontWeight: 800,
            boxShadow: "0 10px 22px rgba(37,99,235,0.18)",
            "&.Mui-disabled": {
              boxShadow: "none",
            },
          }}
        >
          {running ? "执行中" : "运行动作"}
        </Button>
      </Stack>
    </Stack>
  );
}

export function WebActionsDialog({
  open,
  context,
  onClose,
}: WebActionsDialogProps) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) {
      setRunning(false);
    }
  }, [open]);

  return (
    <RuntimePanelDrawer
      open={open}
      onClose={onClose}
      closeDisabled={running}
      title="运行面板"
      subtitle={context?.title || "未选择目标"}
      icon={<AppWindowIcon fontSize="small" />}
      chips={context?.scope ? <Chip size="small" label={context.scope} /> : null}
      tabs={[
        {
          value: "webActions",
          label: "网页动作",
          icon: <WebsiteIcon fontSize="small" />,
        },
      ]}
      activeTab="webActions"
      bodyOverflow="auto"
    >
      <WebActionsPanel
        active={open}
        compact
        context={context}
        onRunningChange={setRunning}
      />
    </RuntimePanelDrawer>
  );
}
