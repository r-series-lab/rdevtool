import type { ReactElement } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { LinkExecutionReport, LinkPlan, LinkRuntimeSummary } from "../app-types";
import { useI18n, type Translate } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";
import { runtimeContextFromExecutionDetail } from "../lib/runtimeContext";
import {
  ClearIcon,
  FolderIcon,
  SettingsIcon,
  TerminalIcon,
  WorkflowIcon,
} from "./AppIcons";
import { RuntimeContextCard } from "./RuntimeContextCard";

export type LinkPlanDialogAction = "check" | "run" | "stop";

export type LinkPlanDialogState = {
  entryName: string;
  key: string;
  sourceId?: string | null;
  proxySourceId?: string | null;
  runtimeSourceId?: string | null;
  workspaceKey?: string | null;
  plan: LinkPlan | null;
  report: LinkExecutionReport | null;
  runtime?: LinkRuntimeSummary | null;
  loading: boolean;
  action: LinkPlanDialogAction | null;
  error: string;
};

export function linkExecutionModeSucceeded(
  report: LinkExecutionReport,
  mode: "run" | "stop",
) {
  return (
    report.mode === mode &&
    report.steps.length > 0 &&
    report.steps.every(
      (step) =>
        step.status !== "failed" &&
        step.status !== "blocked" &&
        !(step.status === "skipped" && step.risks.length > 0),
    )
  );
}

type LinkPlanStepView = LinkPlan["steps"][number];
type LinkExecutionStepView = LinkExecutionReport["steps"][number];

type LinkPlanDialogProps = {
  state: LinkPlanDialogState | null;
  onClose: () => void;
  onAction: (action: LinkPlanDialogAction) => void | Promise<void>;
};

function linkExecutionStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case "ready":
      return t("可启动");
    case "blocked":
      return t("被阻塞");
    case "checked":
      return t("已检查");
    case "started":
      return t("已启动");
    case "stopped":
      return t("已停止");
    case "skipped":
      return t("已跳过");
    case "failed":
      return t("失败");
    default:
      return status || t("结果");
  }
}

function linkExecutionStatusColor(
  status: string,
): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" {
  switch (status) {
    case "ready":
      return "info";
    case "blocked":
      return "warning";
    case "checked":
    case "started":
    case "stopped":
      return "success";
    case "failed":
      return "error";
    case "skipped":
      return "warning";
    default:
      return "default";
  }
}

function linkPlanStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case "planned":
      return t("计划");
    case "invalid":
      return t("需检查");
    default:
      return status || t("计划");
  }
}

function linkStepShortValue(step: LinkPlanStepView | LinkExecutionStepView): string {
  const summary = step.summary.trim();
  const urlMatch = summary.match(/https?:\/\/[^\s，,。]+/);
  if (urlMatch) {
    return urlMatch[0];
  }
  const localFileMatch = summary.match(/(?:^|[\s使用])([._/\\a-zA-Z0-9-]*\.env[._a-zA-Z0-9-]*)/);
  if (localFileMatch?.[1]) {
    return localFileMatch[1];
  }
  const runtimeMatch = summary.match(
    /(?:运行配置|运行环境)\s+([^\s，,。]+)|用(?:运行配置|运行环境)\s+([^\s，,。]+)/,
  );
  if (runtimeMatch?.[1] || runtimeMatch?.[2]) {
    return runtimeMatch[1] || runtimeMatch[2];
  }
  return summary;
}

function linkStepIcon(type: string): ReactElement {
  if (type.includes("localFile")) {
    return <FolderIcon fontSize="inherit" />;
  }
  if (type.includes("proxy")) {
    return <TerminalIcon fontSize="inherit" />;
  }
  if (type.includes("runtime")) {
    return <SettingsIcon fontSize="inherit" />;
  }
  return <WorkflowIcon fontSize="inherit" />;
}

export function LinkPlanDialog({ state, onClose, onAction }: LinkPlanDialogProps) {
  const { t } = useI18n();
  const busy = Boolean(state?.loading) || Boolean(state?.action);
  const disabled = !state?.key || busy;
  const runSucceeded = state?.report
    ? linkExecutionModeSucceeded(state.report, "run")
    : false;
  const stopSucceeded = state?.report
    ? linkExecutionModeSucceeded(state.report, "stop")
    : false;
  const runtimeRunning = runSucceeded || (!stopSucceeded && Boolean(state?.runtime?.canStop));
  const runtimeAllowsRun = state?.runtime ? state.runtime.canRun : true;
  const runtimeAllowsStop = state?.runtime ? state.runtime.canStop : true;
  const runDisabled = disabled || runtimeRunning || (!stopSucceeded && !runtimeAllowsRun);
  const stopDisabled = disabled || (!runtimeRunning && !runtimeAllowsStop);

  return (
    <Dialog
      open={Boolean(state)}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      className="link-plan-tray-dialog"
    >
      <DialogContent className="link-plan-tray-content">
        {!state ? null : state.loading ? (
          <Box className="link-plan-tray-state">
            <Typography className="link-plan-tray-title">
              {state.entryName || t("Link 计划")}
            </Typography>
            <Typography className="link-plan-tray-subtitle">{t("正在生成计划")}</Typography>
          </Box>
        ) : state.error ? (
          <Box className="link-plan-tray-state">
            <Typography className="link-plan-tray-title">
              {state.entryName || t("Link 计划")}
            </Typography>
            <Typography className="link-plan-tray-error">{state.error}</Typography>
          </Box>
        ) : state.plan ? (
          <Box className="link-plan-tray-shell">
            <Box className="link-plan-tray-head">
              <Box minWidth={0}>
                <Typography className="link-plan-tray-title" noWrap>
                  {state.entryName || state.plan.name}
                </Typography>
                <Typography className="link-plan-tray-subtitle" noWrap>
                  {state.plan.name}
                </Typography>
              </Box>
              <IconButton
                aria-label={t("关闭 Link 计划")}
                className="link-plan-tray-close"
                onClick={onClose}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Box>
            <Stack className="link-plan-tray-meta" direction="row" spacing={0.7} flexWrap="wrap">
              <Chip size="small" label={state.plan.key} />
              {state.plan.workspaceKey ? (
                <Chip size="small" label={state.plan.workspaceKey} />
              ) : null}
              {state.plan.project ? <Chip size="small" label={state.plan.project} /> : null}
              {state.plan.sourceContext?.aligned ? (
                <Chip
                  size="small"
                  color="info"
                  variant="outlined"
                  label={t("配置源 {name}", {
                    name: state.plan.sourceContext.linkSourceName,
                  })}
                />
              ) : state.plan.sourceContext ? (
                <>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Link ${state.plan.sourceContext.linkSourceName}`}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("代理 {name}", {
                      name: state.plan.sourceContext.proxySourceName,
                    })}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("运行配置 {name}", {
                      name: state.plan.sourceContext.runtimeSourceName,
                    })}
                  />
                </>
              ) : null}
            </Stack>
            {state.plan.warnings.length > 0 ? (
              <Stack className="link-plan-warning-list" spacing={0.4}>
                {state.plan.warnings.map((warning) => (
                  <Typography key={warning} variant="caption" color="warning.main">
                    {translateInternalMessage(warning, t)}
                  </Typography>
                ))}
              </Stack>
            ) : null}
            <Box className="link-plan-path" role="list">
              {state.plan.steps.map((step, index) => (
                <Box
                  key={step.id}
                  className={`link-plan-path-step is-${step.status}`}
                  role="listitem"
                >
                  <span className="link-plan-path-index">{index + 1}</span>
                  <span className="link-plan-path-label">
                    {translateInternalMessage(step.label, t)}
                  </span>
                  <span className="link-plan-path-status">
                    {linkPlanStatusLabel(step.status, t)}
                  </span>
                </Box>
              ))}
            </Box>
            <Box className="link-plan-summary-list">
              {state.plan.steps.map((step) => (
                <Box key={step.id} className={`link-plan-summary-row is-${step.status}`}>
                  <span className="link-plan-summary-icon">{linkStepIcon(step.type)}</span>
                  <Box minWidth={0}>
                    <Typography className="link-plan-summary-label">
                      {translateInternalMessage(step.label, t)}
                    </Typography>
                    <Typography className="link-plan-summary-text">
                      {translateInternalMessage(step.summary, t)}
                    </Typography>
                  </Box>
                  <Typography className="link-plan-summary-value" noWrap>
                    {translateInternalMessage(linkStepShortValue(step), t)}
                  </Typography>
                  {step.risks.length > 0 ? (
                    <Box className="link-plan-risk-list">
                      {step.risks.map((risk) => (
                        <Typography key={risk} variant="caption">
                          {translateInternalMessage(risk, t)}
                        </Typography>
                      ))}
                    </Box>
                  ) : null}
                  {step.runtime ? (
                    <Box sx={{ gridColumn: "1 / -1", minWidth: 0, mt: 0.35 }}>
                      <RuntimeContextCard
                        compact
                        title={t("计划运行目标")}
                        context={step.runtime}
                      />
                    </Box>
                  ) : null}
                </Box>
              ))}
            </Box>
            {state.report ? (
              <Stack className="link-plan-report" spacing={0.75}>
                <Typography className="link-plan-report-title">{t("执行结果")}</Typography>
                {state.report.warnings.length > 0 ? (
                  <Stack spacing={0.25}>
                    {state.report.warnings.map((warning) => (
                      <Typography key={warning} variant="caption" color="warning.main">
                        {translateInternalMessage(warning, t)}
                      </Typography>
                    ))}
                  </Stack>
                ) : null}
                {state.report.steps.map((step) => {
                  const runtimeContext = runtimeContextFromExecutionDetail(step.detail);
                  return (
                    <Box
                      key={`${state.report?.mode}-${step.id}`}
                      className={`link-plan-report-row is-${step.status}`}
                    >
                      <Stack direction="row" spacing={0.8} alignItems="center" minWidth={0}>
                        <Chip
                          size="small"
                          color={linkExecutionStatusColor(step.status)}
                          label={linkExecutionStatusLabel(step.status, t)}
                        />
                        <Typography variant="body2" fontWeight={700} noWrap>
                          {translateInternalMessage(step.label, t)}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {translateInternalMessage(step.summary, t)}
                      </Typography>
                      {step.risks.length > 0 ? (
                        <Stack spacing={0.25} sx={{ mt: 0.7 }}>
                          {step.risks.map((risk) => (
                            <Typography key={risk} variant="caption" color="warning.main">
                              {translateInternalMessage(risk, t)}
                            </Typography>
                          ))}
                        </Stack>
                      ) : null}
                      {runtimeContext ? (
                        <Box sx={{ mt: 0.75 }}>
                          <RuntimeContextCard
                            compact
                            title={t("检查运行目标")}
                            context={runtimeContext}
                          />
                        </Box>
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            ) : null}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions className="link-plan-tray-actions">
        <Button
          variant="outlined"
          color="inherit"
          disabled={disabled}
          onClick={() => void onAction("check")}
        >
          {state?.action === "check" ? t("检查中") : t("检查")}
        </Button>
        <Button
          variant="contained"
          disabled={runDisabled}
          onClick={() => void onAction("run")}
        >
          {state?.action === "run" ? t("启动中") : runtimeRunning ? t("已启动") : t("启动")}
        </Button>
        <Button
          color="error"
          variant="outlined"
          disabled={stopDisabled}
          onClick={() => void onAction("stop")}
        >
          {state?.action === "stop" ? t("停止中") : t("停止")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
