import { Stack, Typography } from "@mui/material";
import { useI18n, type AppLanguage, type Translate } from "../i18n";
import type { ActiveSession } from "../lib/activeSessions";
import type { ActiveSessionDiagnostic } from "../lib/activeSessionDiagnostics";
import { InfoIcon, WarningIcon } from "./AppIcons";

type ActiveSessionDiagnosticLineProps = {
  diagnostic: ActiveSessionDiagnostic;
  session: ActiveSession;
};

function diagnosticCopy(
  diagnostic: ActiveSessionDiagnostic,
  session: ActiveSession,
  language: AppLanguage,
  t: Translate,
) {
  if (diagnostic.kind === "portConflict") {
    return {
      title: t("端口 {port} 冲突", { port: diagnostic.port ?? "-" }),
      detail: t("与 {names} 同时标记为活跃", {
        names: diagnostic.relatedSessionNames.join(
          language === "en-US" ? ", " : "、",
        ),
      }),
    };
  }
  if (diagnostic.kind === "externalListener") {
    return {
      title: diagnostic.port
        ? t("外部进程占用端口 {port}", { port: diagnostic.port })
        : t("检测到未纳管的外部进程"),
      detail: session.pid
        ? session.canAdopt
          ? t("PID {pid} · 可认领后纳入管理", { pid: session.pid })
          : t("PID {pid} · 未由 rDevTool 管理", { pid: session.pid })
        : session.canAdopt
          ? t("可认领后纳入管理")
          : t("未由 rDevTool 管理"),
    };
  }
  return {
    title: t("监听端口未识别"),
    detail: t("打开详情检查 URL 或启动配置"),
  };
}

export function ActiveSessionDiagnosticLine({
  diagnostic,
  session,
}: ActiveSessionDiagnosticLineProps) {
  const { language, t } = useI18n();
  const copy = diagnosticCopy(diagnostic, session, language, t);

  return (
    <Stack
      className={`active-session-diagnostic is-${diagnostic.severity}`}
      direction="row"
      spacing={0.55}
      alignItems="center"
    >
      {diagnostic.severity === "warning" ? (
        <WarningIcon fontSize="small" aria-hidden="true" />
      ) : (
        <InfoIcon fontSize="small" aria-hidden="true" />
      )}
      <Typography variant="caption" title={`${copy.title} · ${copy.detail}`}>
        <strong>{copy.title}</strong>
        <span> · {copy.detail}</span>
      </Typography>
    </Stack>
  );
}
