import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import type {
  ActiveSession,
  ActiveSessionAction,
  ActiveSessionActionResult,
  ActiveSessionPortInspection,
} from "../lib/activeSessions";
import { diagnoseActiveSessions } from "../lib/activeSessionDiagnostics";
import { translateInternalMessage } from "../i18n/internalMessages";
import { useI18n } from "../i18n";
import { InfoIcon, StopIcon, WarningIcon } from "./AppIcons";
import { AppActionDialog } from "./AppActionDialog";
import { AppEmptyState } from "./AppEmptyState";
import { ActiveSessionRow } from "./ActiveSessionRow";
import { ActiveSessionInspectionDialog } from "./ActiveSessionInspectionDialog";

const ActiveBrowserSessionDialog = lazy(async () => {
  const module = await import("./ActiveBrowserSessionDialog");
  return { default: module.ActiveBrowserSessionDialog };
});

type ActiveSessionsPanelProps = {
  sessions: ActiveSession[];
  loading: boolean;
  error: string;
  onAction: (
    session: ActiveSession,
    action: ActiveSessionAction,
  ) => Promise<ActiveSessionActionResult> | ActiveSessionActionResult;
};

const ACTIVE_SESSION_STALE_AFTER_MS = 45_000;

export function ActiveSessionsPanel({
  sessions,
  loading,
  error,
  onAction,
}: ActiveSessionsPanelProps) {
  const { t } = useI18n();
  const [stopTarget, setStopTarget] = useState<ActiveSession | null>(null);
  const [stopError, setStopError] = useState("");
  const [inspectionTarget, setInspectionTarget] = useState<{
    session: ActiveSession;
    inspection: ActiveSessionPortInspection;
  } | null>(null);
  const [browserTarget, setBrowserTarget] = useState<ActiveSession | null>(null);
  const [actionRunningId, setActionRunningId] = useState("");
  const actionRunningIdRef = useRef("");
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const [actionNotice, setActionNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const groupedSessions = useMemo(() => {
    return [
      {
        key: "current",
        label: "当前工作区",
        sessions: sessions.filter((session) => session.scope === "current"),
      },
      {
        key: "other",
        label: "其他工作区",
        sessions: sessions.filter((session) => session.scope === "other"),
      },
      {
        key: "shared",
        label: "共享服务",
        sessions: sessions.filter((session) => session.scope === "shared"),
      },
    ].filter((group) => group.sessions.length > 0);
  }, [sessions]);
  const diagnosis = useMemo(() => diagnoseActiveSessions(sessions), [sessions]);
  const portCount = new Set(
    sessions.flatMap((session) => (session.port ? [session.port] : [])),
  ).size;
  const lastObservedAtMs = Math.max(
    0,
    ...sessions.map((session) => session.observedAtMs ?? 0),
  );
  const statusStale =
    lastObservedAtMs > 0 && now - lastObservedAtMs > ACTIVE_SESSION_STALE_AFTER_MS;
  const refreshAgeSeconds = lastObservedAtMs
    ? Math.max(0, Math.floor((now - lastObservedAtMs) / 1_000))
    : 0;
  const refreshLabel = loading
    ? t("正在刷新")
    : statusStale
      ? t("状态可能已过期")
      : refreshAgeSeconds < 10
        ? t("刚刚更新")
        : refreshAgeSeconds < 60
          ? t("{count} 秒前更新", { count: refreshAgeSeconds })
          : t("{count} 分钟前更新", {
              count: Math.floor(refreshAgeSeconds / 60),
            });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!actionNotice) {
      return;
    }
    const timer = window.setTimeout(() => setActionNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  const runAction = useCallback(
    async (
      session: ActiveSession,
      action: ActiveSessionAction,
    ): Promise<ActiveSessionActionResult | null> => {
      if (actionRunningIdRef.current) {
        return null;
      }
      actionRunningIdRef.current = session.id;
      setActionRunningId(session.id);
      setActionNotice(null);
      try {
        const result = await onActionRef.current(session, action);
        if (result.inspection) {
          setInspectionTarget({ session, inspection: result.inspection });
        }
        if (result.message) {
          setActionNotice({
            tone: result.ok ? "success" : "error",
            message: `${session.name} · ${translateInternalMessage(result.message, t)}`,
          });
        }
        return result;
      } catch (reason) {
        const result = { ok: false, message: String(reason) };
        setActionNotice({
          tone: "error",
          message: `${session.name} · ${translateInternalMessage(result.message, t)}`,
        });
        return result;
      } finally {
        actionRunningIdRef.current = "";
        setActionRunningId("");
      }
    },
    [t],
  );

  const requestStop = useCallback((session: ActiveSession) => {
    setStopError("");
    setStopTarget(session);
  }, []);

  const requestAction = useCallback(
    (session: ActiveSession, action: ActiveSessionAction) => {
      if (action === "details" && session.browserInfo) {
        setBrowserTarget(session);
        return;
      }
      void runAction(session, action);
    },
    [runAction],
  );

  const confirmStop = async () => {
    if (!stopTarget) {
      return;
    }
    setStopError("");
    const result = await runAction(stopTarget, "stop");
    if (result?.ok) {
      setStopTarget(null);
    } else if (result?.message) {
      setStopError(result.message);
    }
  };

  if (loading && sessions.length === 0) {
    return (
      <Box className="active-sessions-loading" role="status">
        <CircularProgress size={18} thickness={5} />
        <Typography variant="caption">{t("正在读取运行状态")}</Typography>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Stack className="active-sessions-empty" spacing={0.8}>
        <AppEmptyState
          title={t("当前没有运行中的资源")}
          description={t("项目服务、本地构建、Action 和代理启动后会出现在这里。")}
        />
        {error ? (
          <Typography className="active-sessions-error" variant="caption">
            {t("部分运行状态暂不可用")}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  return (
    <>
      <Stack className="active-sessions-panel" spacing={0}>
        <Stack
          className="active-sessions-summary"
          direction="row"
          spacing={0.6}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Chip
            size="small"
            label={t("{count} 个运行资源", { count: sessions.length })}
          />
          <Chip
            size="small"
            variant="outlined"
            label={t("{count} 个活跃端口", { count: portCount })}
          />
          {diagnosis.conflictCount > 0 ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<WarningIcon />}
              className="active-sessions-attention-chip is-conflict"
              label={t("{count} 个端口冲突", {
                count: diagnosis.conflictCount,
              })}
            />
          ) : null}
          {diagnosis.externalCount > 0 ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<InfoIcon />}
              className="active-sessions-attention-chip is-external"
              label={t("{count} 个外部进程", {
                count: diagnosis.externalCount,
              })}
            />
          ) : null}
          {lastObservedAtMs ? (
            <Chip
              size="small"
              variant="outlined"
              className={`active-sessions-freshness${statusStale ? " is-stale" : ""}`}
              label={refreshLabel}
            />
          ) : null}
          {error ? (
            <Typography className="active-sessions-error" variant="caption">
              {t("部分运行状态暂不可用")}
            </Typography>
          ) : null}
          {actionNotice ? (
            <Typography
              className={`active-sessions-action-notice is-${actionNotice.tone}`}
              variant="caption"
              role="status"
            >
              {translateInternalMessage(actionNotice.message, t)}
            </Typography>
          ) : null}
        </Stack>

        <Box className="active-sessions-scroll">
          {groupedSessions.map((group) => (
            <Box className="active-session-group" key={group.key}>
              <Typography className="active-session-group-title" variant="overline">
                {t(group.label)}
              </Typography>
              {group.sessions.map((session) => (
                <ActiveSessionRow
                  key={session.id}
                  session={session}
                  diagnostic={diagnosis.bySessionId.get(session.id) ?? null}
                  busy={actionRunningId === session.id}
                  onRunAction={requestAction}
                  onRequestStop={requestStop}
                />
              ))}
            </Box>
          ))}
        </Box>
      </Stack>

      <AppActionDialog
        open={Boolean(stopTarget)}
        title={t("停止运行资源？")}
        subtitle={stopTarget?.name}
        description={t("停止后，对应的本地服务或任务将立即中断。")}
        icon={<StopIcon />}
        tone="warning"
        busy={Boolean(actionRunningId)}
        onClose={() => {
          setStopError("");
          setStopTarget(null);
        }}
        children={
          stopError ? (
            <Typography className="active-sessions-stop-error" variant="caption">
              {translateInternalMessage(stopError, t)}
            </Typography>
          ) : null
        }
        actions={(
          <>
            <Button
              color="inherit"
              disabled={Boolean(actionRunningId)}
              onClick={() => setStopTarget(null)}
            >
              {t("取消")}
            </Button>
            <Button
              color="warning"
              variant="contained"
              startIcon={<StopIcon />}
              disabled={Boolean(actionRunningId)}
              onClick={() => void confirmStop()}
            >
              {t("停止")}
            </Button>
          </>
        )}
      />

      <ActiveSessionInspectionDialog
        session={inspectionTarget?.session ?? null}
        inspection={inspectionTarget?.inspection ?? null}
        onClose={() => setInspectionTarget(null)}
        onOpenDetails={(session) => {
          setInspectionTarget(null);
          requestAction(session, "details");
        }}
      />
      {browserTarget ? (
        <Suspense fallback={null}>
          <ActiveBrowserSessionDialog
            session={browserTarget}
            onClose={() => setBrowserTarget(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
