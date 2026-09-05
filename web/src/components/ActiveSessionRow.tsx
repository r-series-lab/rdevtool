import { memo, type ReactNode } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useI18n, type AppLanguage } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";
import { translateBuildDetail } from "../lib/buildPresentation";
import type {
  ActiveSession,
  ActiveSessionAction,
  ActiveSessionKind,
} from "../lib/activeSessions";
import type { ActiveSessionDiagnostic } from "../lib/activeSessionDiagnostics";
import {
  ActionIcon,
  AppWindowIcon,
  CheckIcon,
  FolderIcon,
  LocateIcon,
  OpenExternalIcon,
  PackageIcon,
  SettingsIcon,
  StopIcon,
  TerminalIcon,
  WebsiteIcon,
} from "./AppIcons";
import { ActiveSessionDiagnosticLine } from "./ActiveSessionDiagnosticLine";

type ActiveSessionRowProps = {
  session: ActiveSession;
  diagnostic: ActiveSessionDiagnostic | null;
  busy: boolean;
  onRunAction: (session: ActiveSession, action: ActiveSessionAction) => void;
  onRequestStop: (session: ActiveSession) => void;
};

const SESSION_KIND_LABELS: Record<ActiveSessionKind, string> = {
  runtime: "项目服务",
  build: "本地构建",
  action: "参数化 Action",
  proxy: "本地代理",
  browser: "受控浏览器",
};

function sessionIcon(kind: ActiveSessionKind) {
  switch (kind) {
    case "action":
      return <ActionIcon fontSize="small" />;
    case "build":
      return <PackageIcon fontSize="small" />;
    case "proxy":
      return <TerminalIcon fontSize="small" />;
    case "browser":
      return <WebsiteIcon fontSize="small" />;
    default:
      return <AppWindowIcon fontSize="small" />;
  }
}

function formatSessionAge(value: number | null | undefined, language: AppLanguage) {
  if (!value || value > Date.now()) {
    return "";
  }
  const minutes = Math.max(1, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 60) {
    return language === "en-US" ? `${minutes}m` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return language === "en-US"
      ? `${hours}h ${remainingMinutes}m`
      : `${hours} 小时 ${remainingMinutes} 分钟`;
  }
  const days = Math.floor(hours / 24);
  return language === "en-US"
    ? `${days}d ${hours % 24}h`
    : `${days} 天 ${hours % 24} 小时`;
}

function sessionPrimaryMeta(session: ActiveSession) {
  if (session.operationId) {
    return session.operationId;
  }
  if (session.endpoint) {
    return session.endpoint;
  }
  if (session.port) {
    return `:${session.port}`;
  }
  if (session.pid) {
    return `PID ${session.pid}`;
  }
  return "";
}

function SessionAction({
  label,
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`active-session-action${danger ? " is-danger" : ""}`}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

export const ActiveSessionRow = memo(function ActiveSessionRow({
  session,
  diagnostic,
  busy,
  onRunAction,
  onRequestStop,
}: ActiveSessionRowProps) {
  const { language, t } = useI18n();
  const age = formatSessionAge(session.startedAtMs, language);
  const primaryMeta = sessionPrimaryMeta(session);
  const canInspectPort = Boolean(
    session.kind !== "browser" && diagnostic && session.port,
  );

  return (
    <Box
      className={`active-session-row active-session-row--${session.kind}${busy ? " is-busy" : ""}`}
    >
      <Stack direction="row" spacing={0.8} alignItems="flex-start">
        <Box className="active-session-kind-icon" aria-hidden="true">
          {sessionIcon(session.kind)}
        </Box>
        <Box minWidth={0} flex={1}>
          <Stack
            direction="row"
            spacing={0.55}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography className="active-session-name" variant="body2">
              {session.name}
            </Typography>
            {busy ? <CircularProgress size={12} thickness={5} /> : null}
            <Chip
              size="small"
              className="active-session-kind-chip"
              label={t(SESSION_KIND_LABELS[session.kind])}
            />
            <Chip
              size="small"
              className={`active-session-status-chip${session.external ? " is-external" : ""}`}
              label={
                session.external
                  ? t(session.kind === "proxy" ? "外部占用" : "外部进程")
                  : translateInternalMessage(session.statusLabel, t)
              }
            />
          </Stack>

          <Stack
            className="active-session-meta"
            direction="row"
            spacing={0.7}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            {primaryMeta ? (
              <Typography component="code" variant="caption" title={primaryMeta}>
                {primaryMeta}
              </Typography>
            ) : null}
            {session.pid ? (
              <Typography variant="caption">PID {session.pid}</Typography>
            ) : null}
            {age ? (
              <Typography variant="caption">
                {t("已运行 {duration}", { duration: age })}
              </Typography>
            ) : null}
          </Stack>

          {session.detail && session.detail !== session.endpoint ? (
            <Typography className="active-session-detail" variant="caption">
              {session.kind === "build"
                ? translateBuildDetail(session.detail, t)
                : translateInternalMessage(session.detail, t)}
            </Typography>
          ) : null}
          {session.directoryPath ? (
            <Typography
              className="active-session-path"
              variant="caption"
              title={session.directoryPath}
            >
              {session.directoryPath}
            </Typography>
          ) : null}

          {diagnostic ? (
            <ActiveSessionDiagnosticLine
              diagnostic={diagnostic}
              session={session}
            />
          ) : null}

          {session.proxyActivity ? (
            <Stack
              className="active-session-proxy-activity"
              direction="row"
              spacing={0.65}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Typography variant="caption">
                {t("本次 {count} 个请求", {
                  count: session.proxyActivity.requestCount,
                })}
              </Typography>
              {session.proxyActivity.errorCount > 0 ? (
                <Typography className="has-errors" variant="caption">
                  {t("{count} 个异常", {
                    count: session.proxyActivity.errorCount,
                  })}
                </Typography>
              ) : null}
              {session.proxyActivity.lastRequestMethod &&
              session.proxyActivity.lastRequestPath ? (
                <Typography
                  component="code"
                  variant="caption"
                  title={`${session.proxyActivity.lastRequestMethod} ${session.proxyActivity.lastRequestPath}`}
                >
                  {session.proxyActivity.lastRequestMethod}{" "}
                  {session.proxyActivity.lastRequestPath}
                  {session.proxyActivity.lastRequestStatus
                    ? ` · ${session.proxyActivity.lastRequestStatus}`
                    : ""}
                </Typography>
              ) : null}
            </Stack>
          ) : null}

          {session.browserInfo ? (
            <Stack
              className="active-session-browser-activity"
              direction="row"
              spacing={0.65}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Typography variant="caption">
                {t("{count} 个受控页面", {
                  count: session.browserInfo.pageCount,
                })}
              </Typography>
              <Typography variant="caption">
                {t("{count} 个活跃项目", {
                  count: session.browserInfo.activeProjects.length,
                })}
              </Typography>
            </Stack>
          ) : null}

          <Stack
            className="active-session-actions"
            direction="row"
            spacing={0.35}
            alignItems="center"
          >
            {session.canAdopt ? (
              <SessionAction
                label={t("认领并纳入管理")}
                disabled={busy}
                onClick={() => onRunAction(session, "adopt")}
              >
                <CheckIcon fontSize="small" />
              </SessionAction>
            ) : null}
            {session.canFocus ? (
              <SessionAction
                label={t("聚焦")}
                disabled={busy}
                onClick={() => onRunAction(session, "focus")}
              >
                <OpenExternalIcon fontSize="small" />
              </SessionAction>
            ) : null}
            {session.canOpenLog ? (
              <SessionAction
                label={t("打开日志")}
                disabled={busy}
                onClick={() => onRunAction(session, "openLog")}
              >
                <TerminalIcon fontSize="small" />
              </SessionAction>
            ) : null}
            {session.canOpenOutput ? (
              <SessionAction
                label={t("打开产物目录")}
                disabled={busy}
                onClick={() => onRunAction(session, "openOutput")}
              >
                <FolderIcon fontSize="small" />
              </SessionAction>
            ) : null}
            {session.canOpenDirectory ? (
              <SessionAction
                label={t("打开项目目录")}
                disabled={busy}
                onClick={() => onRunAction(session, "openDirectory")}
              >
                <FolderIcon fontSize="small" />
              </SessionAction>
            ) : null}
            <SessionAction
              label={
                canInspectPort
                  ? t("深度诊断")
                  : diagnostic
                    ? t("定位异常")
                    : t("查看详情")
              }
              disabled={busy}
              onClick={() =>
                onRunAction(session, canInspectPort ? "inspect" : "details")
              }
            >
              {diagnostic ? (
                <LocateIcon fontSize="small" />
              ) : (
                <SettingsIcon fontSize="small" />
              )}
            </SessionAction>
            {session.canStop ? (
              <SessionAction
                danger
                label={t("停止")}
                disabled={busy}
                onClick={() => onRequestStop(session)}
              >
                <StopIcon fontSize="small" />
              </SessionAction>
            ) : null}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
});
