import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";

import type {
  ResourceActionParam,
  ResourceActionPlan,
  ResourceActionProgressEvent,
  ResourceActionRunResult,
  ResourceActionView,
} from "../app-types";
import type { ActivityRecorder, ActivityUpdater } from "../lib/activityCenter";
import { createClientOperationId } from "../lib/operationLifecycle";
import {
  appendResourceActionProgressEvent,
  initialResourceActionValues,
  formatResourceActionParamValue,
  resourceActionActivityParameters,
  resourceActionDryRunState,
  resourceActionRequiresPlan,
  resourceActionRetryValues,
  type ResourceActionValues,
  validateResourceActionValues,
} from "../lib/resourceActions";
import { disposeTauriListener } from "../lib/tauriEvents";
import { useI18n, type Translate } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";
import {
  ActionIcon,
  FolderIcon,
  LocateIcon,
  OpenExternalIcon,
  PackageIcon,
  PanelBottomIcon,
  PlayIcon,
  StopIcon,
} from "./AppIcons";
import { AppActionDialog } from "./AppActionDialog";
import { useAppConfirmDialog } from "./AppConfirmDialog";
import { ParameterForm } from "./ParameterForm";
import { ResourceActionResultPanel } from "./ResourceActionResultPanel";

export type ResourceActionDialogTarget = {
  key: string;
  sourceId?: string | null;
  entryName: string;
  mode?: "run" | "inspect";
};

export type ResourceActionDialogProps = {
  open: boolean;
  target: ResourceActionDialogTarget | null;
  onClose: () => void;
  onSucceeded?: (result: ResourceActionRunResult) => void;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
};

const EFFECT_COPY = {
  read: { label: "只读", severity: "info" as const },
  local_write: { label: "本地写入", severity: "warning" as const },
  remote_write: { label: "远程写入", severity: "warning" as const },
  destructive: { label: "高风险操作", severity: "error" as const },
};

const RESOURCE_ACTION_PROGRESS_EVENT = "rdevtool://resource-action-progress";

type CancelResourceActionResponse = {
  operationId: string;
  accepted: boolean;
};

export function ResourceActionDialog({
  open,
  target,
  onClose,
  onSucceeded,
  recordActivity,
  updateActivity,
}: ResourceActionDialogProps) {
  const { t } = useI18n();
  const [action, setAction] = useState<ResourceActionView | null>(null);
  const [values, setValues] = useState<ResourceActionValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const [activeOperationPhase, setActiveOperationPhase] = useState<
    "plan" | "execute" | null
  >(null);
  const activeOperationIdRef = useRef<string | null>(null);
  const detachedOperationIdsRef = useRef(new Set<string>());
  const cancelRequestedOperationIdRef = useRef<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<ResourceActionProgressEvent[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResourceActionRunResult | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const liveLogRef = useRef<HTMLPreElement | null>(null);
  const [confirmAction, confirmDialog] = useAppConfirmDialog();

  useEffect(() => {
    if (!open || !target) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setAction(null);
    setValues({});
    setErrors({});
    setError("");
    setResult(null);
    setCancelling(false);
    setActiveOperationId(null);
    setActiveOperationPhase(null);
    activeOperationIdRef.current = null;
    cancelRequestedOperationIdRef.current = null;
    setProgressEvents([]);
    invoke<ResourceActionView>("get_resource_action", {
      sourceId: target.sourceId ?? null,
      key: target.key,
    })
      .then((nextAction) => {
        if (cancelled) return;
        setAction(nextAction);
        setValues(initialResourceActionValues(nextAction));
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ResourceActionProgressEvent>(RESOURCE_ACTION_PROGRESS_EVENT, (event) => {
      const payload = event.payload;
      if (payload.operationId !== activeOperationIdRef.current) return;
      setProgressEvents((current) => appendResourceActionProgressEvent(current, payload));
    })
      .then((nextUnlisten) => {
        if (disposed) disposeTauriListener(nextUnlisten);
        else unlisten = nextUnlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      disposeTauriListener(unlisten);
    };
  }, [open]);

  useEffect(() => {
    if (!progressEvents.length) return;
    const frame = window.requestAnimationFrame(() => {
      if (liveLogRef.current) {
        liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [progressEvents]);

  useEffect(() => {
    if (!result) return;
    const frame = window.requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [result]);

  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error]);

  const effectCopy = action ? EFFECT_COPY[action.effect] : null;
  const commandLabel = useMemo(() => {
    if (!action) return "";
    const program =
      action.runner.configuredProgram &&
      action.runner.configuredProgram !== action.runner.program
        ? `${action.runner.configuredProgram} => ${action.runner.program}`
        : action.runner.program;
    return [program, ...action.runner.args].join(" ");
  }, [action]);
  const hiddenParamSummaries = useMemo(
    () =>
      action?.params
        .filter((param) => param.kind === "hidden")
        .map((param) => ({
          key: param.key,
          label: param.label,
          value: formatActionParamValue(values[param.key], t),
        }))
        .filter((param) => param.value) ?? [],
    [action, t, values],
  );
  const visibleParamCount = action?.params.filter((param) => param.kind !== "hidden").length ?? 0;
  const dryRunState = action ? resourceActionDryRunState(action, values) : null;
  const submitLabel =
    dryRunState === true
      ? t("检查计划")
      : action?.execution.mode === "plan_apply"
        ? t("生成执行计划")
        : dryRunState === false
          ? t("开始执行")
          : t("执行");

  function updateValue(key: string, value: ResourceActionValues[string]) {
    setValues((current) => ({ ...current, [key]: value }));
    setError("");
    setResult(null);
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function browseParam(param: ResourceActionParam) {
    const selected = await openDialog({
      directory: param.kind === "directory",
      multiple: false,
      title: param.label,
    });
    if (typeof selected === "string") {
      updateValue(param.key, selected);
    }
  }

  async function runAction(runValues: ResourceActionValues = values) {
    if (!action || !target || running) return;
    const nextErrors = validateResourceActionValues(action, runValues, t);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError(t("请先修正参数后再执行。"));
      return;
    }

    const runDryRunState = resourceActionDryRunState(action, runValues);
    let plan: ResourceActionPlan | null = null;
    if (resourceActionRequiresPlan(action, runValues)) {
      const planOperationId = createClientOperationId("action-plan");
      beginOperation(planOperationId, "plan");
      setRunning(true);
      setError("");
      setResult(null);
      try {
        plan = await invoke<ResourceActionPlan>("plan_resource_action", {
          sourceId: target.sourceId ?? null,
          actionName: action.name,
          request: {
            key: action.key,
            params: runValues,
            operationId: planOperationId,
          },
        });
      } catch (reason) {
        setError(
          cancelRequestedOperationIdRef.current === planOperationId
            ? t("执行已取消，进程已停止。")
            : String(reason),
        );
        return;
      } finally {
        setRunning(false);
        finishOperation(planOperationId);
      }

      const confirmed = await confirmAction({
        title: t("确认执行该计划？"),
        description: action.name,
        content: <ActionPlanSummary plan={plan} />,
        confirmLabel: t("按计划执行"),
        confirmIcon: <PlayIcon fontSize="small" />,
        tone: action.effect === "destructive" ? "danger" : "warning",
        maxWidth: "sm",
      });
      if (!confirmed) return;
    } else if (
      runDryRunState !== true &&
      (action.effect === "remote_write" || action.effect === "destructive")
    ) {
      const confirmed = await confirmAction({
        title: t("确认开始执行？"),
        description: action.name,
        content: <ActionExecutionSummary action={action} values={runValues} />,
        confirmLabel: t("开始执行"),
        confirmIcon: <PlayIcon fontSize="small" />,
        tone: action.effect === "destructive" ? "danger" : "warning",
        maxWidth: "sm",
      });
      if (!confirmed) return;
    }

    setRunning(true);
    setError("");
    setResult(null);
    const operationId = createClientOperationId("action");
    beginOperation(operationId, "execute");
    const activityId =
      recordActivity?.({
        id: operationId,
        kind: "shortcut",
        status: "running",
        title: t("执行参数化动作"),
        summary: action.name,
        detail: commandLabel,
        executionKey: operationId,
        parameters: resourceActionActivityParameters(action, runValues),
        target: { page: "resources" },
        resource: {
          kind: "localPath",
          label: t("打开 Action 配置"),
          value: action.configPath,
        },
      }) ?? "";

    try {
      const nextResult = plan
        ? await invoke<ResourceActionRunResult>("apply_resource_action_plan", {
            sourceId: target.sourceId ?? null,
            actionName: action.name,
            request: { planId: plan.planId, params: runValues, operationId },
          })
        : await invoke<ResourceActionRunResult>("run_resource_action", {
            sourceId: target.sourceId ?? null,
            actionName: action.name,
            request: { key: action.key, params: runValues, operationId },
          });
      if (!detachedOperationIdsRef.current.has(operationId)) {
        setResult(nextResult);
      }
      if (activityId) {
        updateActivity?.(activityId, {
          status: nextResult.success ? "success" : "failed",
          summary: nextResult.success
            ? t("{name} 执行完成", { name: action.name })
            : nextResult.cancelled
              ? t("{name} 已取消", { name: action.name })
              : t("{name} 执行失败", { name: action.name }),
          detail: actionResultDetail(nextResult),
          executionKey: nextResult.operationId,
        });
      }
      if (nextResult.success) {
        onSucceeded?.(nextResult);
      }
    } catch (reason) {
      const message = String(reason);
      if (!detachedOperationIdsRef.current.has(operationId)) {
        setError(message);
      }
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: t("{name} 执行失败", { name: action.name }),
          detail: message,
        });
      }
    } finally {
      if (activeOperationIdRef.current === operationId) {
        setRunning(false);
      }
      finishOperation(operationId);
      detachedOperationIdsRef.current.delete(operationId);
    }
  }

  function beginOperation(operationId: string, phase: "plan" | "execute") {
    activeOperationIdRef.current = operationId;
    setActiveOperationId(operationId);
    setActiveOperationPhase(phase);
    setCancelling(false);
    cancelRequestedOperationIdRef.current = null;
    setProgressEvents([]);
  }

  function finishOperation(operationId: string) {
    if (activeOperationIdRef.current === operationId) {
      activeOperationIdRef.current = null;
      setActiveOperationId(null);
      setActiveOperationPhase(null);
      setCancelling(false);
      cancelRequestedOperationIdRef.current = null;
    }
  }

  function moveToBackground() {
    if (!activeOperationId || activeOperationPhase !== "execute") return;
    detachedOperationIdsRef.current.add(activeOperationId);
    finishOperation(activeOperationId);
    setRunning(false);
    setProgressEvents([]);
    onClose();
  }

  async function cancelAction() {
    if (!activeOperationId || cancelling) return;
    cancelRequestedOperationIdRef.current = activeOperationId;
    setCancelling(true);
    setError("");
    try {
      const response = await invoke<CancelResourceActionResponse>("cancel_resource_action", {
        operationId: activeOperationId,
      });
      if (!response.accepted) {
        setCancelling(false);
      }
    } catch (reason) {
      setCancelling(false);
      setError(String(reason));
    }
  }

  function retryFailed(retry: NonNullable<ResourceActionRunResult["structuredResult"]>["retry"]) {
    if (!action || !retry) return;
    const nextValues = resourceActionRetryValues(action, values, retry);
    if (!nextValues) {
      setError(t("重试参数已失效，请重新选择后执行。"));
      return;
    }
    setValues(nextValues);
    setResult(null);
    void runAction(nextValues);
  }

  return (
    <>
      <AppActionDialog
        open={open}
        onClose={onClose}
        title={action?.name || target?.entryName || t("参数化动作")}
        subtitle={action?.description}
        icon={<ActionIcon />}
        tone={
          action?.effect === "destructive"
            ? "danger"
            : action?.effect === "local_write" ||
                action?.effect === "remote_write"
              ? "warning"
              : "neutral"
        }
        busy={running}
        maxWidth="md"
        className="resource-action-dialog"
        paperClassName="resource-action-dialog-paper"
        headerActions={
          <Stack direction="row" spacing={0.6} alignItems="center">
            {effectCopy ? (
              <Chip
                size="small"
                label={t(effectCopy.label)}
                color={effectCopy.severity}
              />
            ) : null}
            {action ? (
              <Chip
                size="small"
                variant="outlined"
                label={t("{seconds} 秒", { seconds: action.runner.timeoutSeconds })}
              />
            ) : null}
          </Stack>
        }
        actions={
          <>
            {action ? (
              <Button
                color="inherit"
                startIcon={<OpenExternalIcon fontSize="small" />}
                onClick={() =>
                  void invoke("open_local_path", { path: action.configPath })
                }
                disabled={running}
              >
                {t("打开配置")}
              </Button>
            ) : null}
            <Box sx={{ flex: 1 }} />
            {running && activeOperationPhase === "execute" ? (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<PanelBottomIcon fontSize="small" />}
                onClick={moveToBackground}
              >
                {t("转到后台")}
              </Button>
            ) : null}
            {running ? (
              <Button
                variant="outlined"
                color="error"
                className="app-action-dialog-cancel"
                startIcon={<StopIcon fontSize="small" />}
                onClick={() => void cancelAction()}
                disabled={!activeOperationId || cancelling}
              >
                {t(cancelling ? "正在停止…" : "停止执行")}
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="inherit"
                className="app-action-dialog-cancel"
                onClick={onClose}
              >
                {t(result ? "关闭" : "取消")}
              </Button>
            )}
            {action && target?.mode !== "inspect" ? (
              <Button
                variant="contained"
                startIcon={<PlayIcon fontSize="small" />}
                onClick={() => void runAction()}
                disabled={running || loading}
              >
                {running ? t("执行中…") : submitLabel}
              </Button>
            ) : null}
          </>
        }
      >
        <Stack className="resource-action-content" spacing={0}>
          {loading ? (
            <Typography className="resource-action-loading" color="text.secondary">
              {t("正在读取 Action 配置…")}
            </Typography>
          ) : null}
          {action ? (
            <>
              {hiddenParamSummaries.length > 0 ? (
                <Box className="resource-action-context-section">
                  <Typography
                    className="resource-action-section-eyebrow"
                    variant="overline"
                    color="text.secondary"
                  >
                    {t("固定上下文")}
                  </Typography>
                  <Stack
                    className="resource-action-context-list"
                    direction="row"
                    spacing={0.6}
                    flexWrap="wrap"
                    useFlexGap
                  >
                    {hiddenParamSummaries.map((param) => (
                      <Chip
                        className="resource-action-context-chip"
                        key={param.key}
                        size="small"
                        variant="outlined"
                        icon={resourceActionContextIcon(param.key)}
                        label={
                          <>
                            <span className="resource-action-context-label">{param.label}</span>
                            <span className="resource-action-context-separator"> · </span>
                            <strong>{param.value}</strong>
                          </>
                        }
                      />
                    ))}
                  </Stack>
                </Box>
              ) : null}
              {visibleParamCount > 0 ? (
                <Box className="resource-action-parameters-section">
                  <Divider className="resource-action-section-divider" />
                  <Box className="resource-action-parameters-body">
                    <Stack
                      className="resource-action-section-heading"
                      direction="row"
                      alignItems="baseline"
                      spacing={1}
                    >
                      <Typography className="resource-action-section-title" variant="subtitle2">
                        {t("执行参数")}
                      </Typography>
                      <Typography
                        className="resource-action-section-count"
                        variant="caption"
                        color="text.secondary"
                      >
                        {t("{count} 项", { count: visibleParamCount })}
                      </Typography>
                    </Stack>
                    <ParameterForm
                      params={action.params}
                      values={values}
                      errors={errors}
                      disabled={running || target?.mode === "inspect"}
                      onChange={updateValue}
                      onBrowse={(param) => void browseParam(param)}
                    />
                  </Box>
                </Box>
              ) : null}
              <Box
                component="details"
                className="resource-action-execution-details"
                open={target?.mode === "inspect"}
              >
                <Typography
                  className="resource-action-execution-summary"
                  component="summary"
                  variant="caption"
                >
                  {t("执行详情")}
                </Typography>
                <Box className="resource-action-execution-body">
                  <Typography variant="caption" color="text.secondary">
                    {t("执行命令")}
                  </Typography>
                  <Typography
                    component="div"
                    variant="body2"
                    sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}
                  >
                    {commandLabel}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {action.runner.cwd}
                  </Typography>
                </Box>
              </Box>
              {(running || progressEvents.length > 0) && !result ? (
                <ResourceActionLiveLog
                  events={progressEvents}
                  running={running}
                  logRef={liveLogRef}
                />
              ) : null}
            </>
          ) : null}
          {error ? (
            <Alert
              className="resource-action-error"
              ref={errorRef}
              severity="error"
              aria-live="assertive"
            >
              {error}
            </Alert>
          ) : null}
          {result ? (
            <Box className="resource-action-result" ref={resultRef}>
              <Typography className="resource-action-result-title" variant="subtitle2">
                {t("执行结果")}
              </Typography>
              <ResourceActionResultPanel
                result={result}
                onRetry={result.structuredResult?.retry ? retryFailed : undefined}
                retryDisabled={running}
              />
            </Box>
          ) : null}
        </Stack>
      </AppActionDialog>
      {confirmDialog}
    </>
  );
}

function resourceActionContextIcon(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes("workspace")) {
    return <FolderIcon fontSize="small" />;
  }
  if (normalized.includes("environment") || normalized.includes("env")) {
    return <PackageIcon fontSize="small" />;
  }
  return <LocateIcon fontSize="small" />;
}

function actionResultDetail(result: ResourceActionRunResult) {
  return [
    `operationId: ${result.operationId}`,
    `exitCode: ${result.exitCode ?? "-"}`,
    result.timedOut ? "timedOut: true" : "",
    result.cancelled ? "cancelled: true" : "",
    result.structuredResult?.summary ?? "",
    ...(result.structuredResult?.items.map(
      (item) => `${item.label}: ${item.status}${item.summary ? ` · ${item.summary}` : ""}`,
    ) ?? []),
    result.stdout,
    result.stderr,
  ]
    .filter(Boolean)
    .join("\n");
}

function ResourceActionLiveLog({
  events,
  running,
  logRef,
}: {
  events: ResourceActionProgressEvent[];
  running: boolean;
  logRef: RefObject<HTMLPreElement | null>;
}) {
  const { t } = useI18n();
  const outputSuppressed = events.some((event) => event.outputSuppressed);
  const output = events
    .filter((event) => !event.outputSuppressed)
    .map((event) => event.chunk)
    .join("");
  return (
    <Box
      component="details"
      className="resource-action-live-log"
      open
    >
      <Typography
        className="resource-action-live-log-summary"
        component="summary"
        variant="caption"
      >
        {t("实时日志")}
      </Typography>
      <Box
        ref={logRef}
        component="pre"
        aria-live="polite"
        sx={{
          m: 0,
          mt: 1,
          p: 1.25,
          height: 168,
          overflow: "auto",
          bgcolor: "action.hover",
          borderRadius: 1,
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {outputSuppressed
          ? t("Action 包含敏感参数，实时输出已隐藏；执行完成后展示脱敏日志。")
          : output || (running ? t("等待输出…") : t("没有运行日志。"))}
      </Box>
    </Box>
  );
}

function ActionExecutionSummary({
  action,
  values,
}: {
  action: ResourceActionView;
  values: ResourceActionValues;
}) {
  const { t } = useI18n();
  const rows = action.params
    .map((param) => ({
      key: param.key,
      label: param.label,
      value:
        param.kind === "secret"
          ? values[param.key]
            ? t("已提供")
            : t("未提供")
          : param.kind === "branch" && !values[param.key]
            ? t("使用项目配置")
          : param.kind === "boolean"
            ? t(formatResourceActionParamValue(values[param.key], param))
            : formatResourceActionParamValue(values[param.key], param),
    }))
    .filter((row) => row.value !== "");
  return (
    <Stack divider={<Divider flexItem />}>
      {rows.map((row) => (
        <Stack key={row.key} direction="row" spacing={2} sx={{ py: 0.8 }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 96, flexShrink: 0 }}>
            {row.label}
          </Typography>
          <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {row.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function ActionPlanSummary({ plan }: { plan: ResourceActionPlan }) {
  const { t } = useI18n();
  return (
    <Stack spacing={1.2}>
      {plan.planResult.summary ? (
        <Alert severity="info">
          {translateInternalMessage(plan.planResult.summary, t)}
        </Alert>
      ) : null}
      <Stack divider={<Divider flexItem />}>
        {plan.planResult.items.map((item) => (
          <Box key={item.key} sx={{ py: 0.9 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                {item.label}
              </Typography>
              <Chip size="small" variant="outlined" label={item.status} />
            </Stack>
            {item.summary ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                {translateInternalMessage(item.summary, t)}
              </Typography>
            ) : null}
            {item.detail ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.35 }}>
                {translateInternalMessage(item.detail, t)}
              </Typography>
            ) : null}
            {item.parameters.length > 0 ? (
              <Stack spacing={0.25} sx={{ mt: 0.65 }}>
                {item.parameters.map((parameter) => (
                  <Typography key={parameter.key} variant="caption" color="text.secondary">
                    {parameter.label}：{parameter.value}
                  </Typography>
                ))}
              </Stack>
            ) : null}
          </Box>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t("计划有效期至 {time}", { time: new Date(plan.expiresAt).toLocaleString() })}
      </Typography>
    </Stack>
  );
}

function formatActionParamValue(
  value: ResourceActionValues[string],
  t: Translate,
) {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return t(value ? "是" : "否");
  return value == null ? "" : String(value);
}
