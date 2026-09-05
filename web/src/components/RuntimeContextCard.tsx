import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ProjectRuntimeContextSnapshot } from "../app-types";
import {
  runtimeContextSelectionLabel,
  runtimeReadyProbeLabel,
  runtimeValueSourceLabel,
} from "../lib/runtimeContext";
import { useI18n, type AppLanguage } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

type RuntimeContextCardProps = {
  context?: ProjectRuntimeContextSnapshot | null;
  title?: string;
  loading?: boolean;
  error?: string;
  compact?: boolean;
  summary?: boolean;
};

function statusColor(
  context: ProjectRuntimeContextSnapshot,
): "default" | "error" | "info" | "success" | "warning" {
  if (!context.status.success) {
    return "error";
  }
  if (context.status.key === "running") {
    return "success";
  }
  if (context.risks.length > 0) {
    return "warning";
  }
  return "info";
}

function formatStartedAt(value: number | null | undefined, language: AppLanguage): string {
  if (!value) {
    return language === "en-US" ? "Unknown time" : "未知时间";
  }
  return new Intl.DateTimeFormat(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function RuntimeValueRow({
  label,
  value,
  source,
  context,
  monospace = false,
}: {
  label: string;
  value: string;
  source?: string | null;
  context?: ProjectRuntimeContextSnapshot;
  monospace?: boolean;
}) {
  const { t } = useI18n();
  const translatedLabel = t(label);
  return (
    <Box
      className="runtime-context-value"
      sx={{
        display: "grid",
        gridTemplateColumns: "74px minmax(0, 1fr)",
        gap: 0.7,
        alignItems: "start",
      }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={720}>
        {translatedLabel}
      </Typography>
      <Stack spacing={0.25} minWidth={0} alignItems="flex-start">
        <Typography
          variant="caption"
          sx={{
            minWidth: 0,
            overflowWrap: "anywhere",
            fontFamily:
              monospace
                ? '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace'
                : undefined,
          }}
        >
          {value}
        </Typography>
        {source ? (
          <Chip
            size="small"
            variant="outlined"
            label={t(runtimeValueSourceLabel(source, context?.workspace))}
            sx={{ height: 18, "& .MuiChip-label": { px: 0.65, fontSize: "0.62rem" } }}
          />
        ) : null}
      </Stack>
    </Box>
  );
}

export function RuntimeContextCard({
  context,
  title = "Runtime Context",
  loading = false,
  error = "",
  compact = false,
  summary = false,
}: RuntimeContextCardProps) {
  const { language, t } = useI18n();
  if (!context) {
    if (!loading && !error) {
      return null;
    }
    return (
      <Box
        data-runtime-context-card="empty"
        sx={{
          p: compact ? 0.75 : 1,
          borderRadius: "12px",
          border: "1px solid",
          borderColor: error ? "error.light" : "divider",
          bgcolor: "action.hover",
        }}
      >
        <Typography variant="caption" color={error ? "error.main" : "text.secondary"}>
          {error || t("{title} 加载中", { title })}
        </Typography>
      </Box>
    );
  }

  const target = context.effective.target;
  const sessions = context.observed.sessions;
  const overrideLabels = [
    context.requested.command ? t("命令覆盖") : "",
    context.requested.expectedPort
      ? t("端口 {port}", { port: context.requested.expectedPort })
      : "",
    context.requested.envKeys.length
      ? t("{count} 个环境变量", { count: context.requested.envKeys.length })
      : "",
  ].filter(Boolean);

  return (
    <Box
      className={`runtime-context-card${
        summary ? " runtime-context-card--summary" : ""
      }`}
      data-runtime-context-card={context.status.key}
      sx={{
        p: compact ? 0.8 : 1,
        borderRadius: compact ? "12px" : "14px",
        border: "1px solid",
        borderColor: context.status.success ? "divider" : "error.light",
        bgcolor: "background.paper",
        boxShadow: compact ? "none" : "0 8px 22px rgba(30, 48, 72, 0.06)",
      }}
    >
      <Stack spacing={compact ? 0.65 : 0.85}>
        <Stack
          className="runtime-context-card-header"
          direction="row"
          spacing={0.6}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="caption" fontWeight={820} sx={{ mr: "auto" }}>
            {title}
          </Typography>
          <Chip size="small" color={statusColor(context)} label={context.status.label} />
          {!summary && context.workspace ? (
            <Chip
              size="small"
              variant="outlined"
              label={t("工作区 · {name}", { name: context.workspace.name })}
            />
          ) : null}
          {summary ? (
            <Chip
              size="small"
              variant="outlined"
              label={
                context.observed.available
                  ? t("{count} 会话", { count: sessions.length })
                  : t("观测不可用")
              }
            />
          ) : null}
          <Chip
            size="small"
            variant="outlined"
            label={t(runtimeContextSelectionLabel(context))}
          />
          {overrideLabels.map((label) => (
            <Chip key={label} size="small" variant="outlined" label={label} />
          ))}
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns:
              compact || summary
                ? "minmax(0, 1fr)"
                : { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
            gap: 0.75,
          }}
        >
          {!summary ? (
            <Stack spacing={0.42} minWidth={0}>
              <Typography variant="overline" color="text.secondary" lineHeight={1.3}>
                {t("请求")}
              </Typography>
              <RuntimeValueRow label={t("项目")} value={context.requested.projectKey} />
              <RuntimeValueRow
                label={t("启动档案")}
                value={context.requested.debugProfileKey || t("自动选择")}
              />
              <RuntimeValueRow
                label={t("运行档案")}
                value={context.requested.runtimeProfileKey || t("继承配置")}
              />
              <RuntimeValueRow
                label={t("命令覆盖")}
                value={context.requested.command || t("无")}
              />
              <RuntimeValueRow
                label={t("端口覆盖")}
                value={context.requested.expectedPort?.toString() || t("无")}
              />
              <RuntimeValueRow
                label={t("环境覆盖")}
                value={context.requested.envKeys.join(", ") || t("无")}
              />
            </Stack>
          ) : null}

          <Stack
            className="runtime-context-effective-values"
            spacing={0.42}
            minWidth={0}
            sx={
              summary
                ? {
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "minmax(0, 1fr)",
                      md: "repeat(2, minmax(0, 1fr))",
                    },
                    gap: 0.65,
                  }
                : undefined
            }
          >
            {!summary ? (
              <Typography
                variant="overline"
                color="text.secondary"
                lineHeight={1.3}
              >
                {t("最终生效")}
              </Typography>
            ) : null}
            <RuntimeValueRow
              label={t("工作目录")}
              value={target?.cwd || t("未解析")}
              source={target?.cwdSource}
              context={context}
              monospace
            />
            {!summary || target?.focusUrl ? (
              <RuntimeValueRow
                label={t("打开地址")}
                value={target?.focusUrl || t("未配置")}
                source={target?.focusUrlSource}
                context={context}
                monospace
              />
            ) : null}
            {!summary || target?.expectedPort ? (
              <RuntimeValueRow
                label={t("预期端口")}
                value={target?.expectedPort?.toString() || t("未配置")}
                source={target?.expectedPortSource}
                context={context}
              />
            ) : null}
            {!summary || target?.readyProbe ? (
              <RuntimeValueRow
                label={t("Ready 探测")}
                value={t(runtimeReadyProbeLabel(target?.readyProbe))}
              />
            ) : null}
            {!compact ? (
              <RuntimeValueRow
                label={t("启动命令")}
                value={target?.command || t("未解析")}
                source={target?.commandSource}
                context={context}
                monospace
              />
            ) : null}
          </Stack>

          {!summary || sessions.length > 0 ? (
            <Stack
              spacing={0.42}
              minWidth={0}
              sx={summary ? { gridColumn: "1 / -1" } : undefined}
            >
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="overline" color="text.secondary" lineHeight={1.3}>
                  {t("运行观测")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {context.observed.available
                    ? t("{count} 个会话", { count: sessions.length })
                    : t("观测不可用")}
                </Typography>
              </Stack>
              {sessions.length === 0 ? (
                !summary ? (
                  <Typography variant="caption" color="text.secondary">
                    {t("当前候选目录未观测到 daemon 会话。")}
                  </Typography>
                ) : null
              ) : (
                sessions.map((session, index) => (
                  <Box
                    key={session.runId || `${session.cwd}-${index}`}
                    sx={{
                      px: 0.7,
                      py: 0.55,
                      borderRadius: "9px",
                      border: "1px solid",
                      borderColor: session.managed
                        ? "success.light"
                        : "warning.light",
                      bgcolor: "action.hover",
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      flexWrap="wrap"
                    >
                      <Chip
                        size="small"
                        color={session.running ? "success" : "default"}
                        label={translateInternalMessage(session.phase, t)}
                      />
                      <Typography variant="caption" fontWeight={760}>
                        {session.runId || t("无 runId")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(session.managed ? "rDevTool 管理" : "未验证归属")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatStartedAt(session.startedAtMs, language)}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.28, overflowWrap: "anywhere" }}
                    >
                      {session.cwd}
                      {session.expectedPort ? ` · :${session.expectedPort}` : ""}
                      {session.workerPid ? ` · PID ${session.workerPid}` : ""}
                    </Typography>
                  </Box>
                ))
              )}
            </Stack>
          ) : null}
        </Box>

        {!summary ? (
          <Typography variant="caption" color="text.secondary">
            {translateInternalMessage(context.status.detail, t)}
          </Typography>
        ) : null}

        {context.risks.length > 0 ? (
          <Stack spacing={0.2}>
            {context.risks.map((risk) => (
              <Typography
                key={`${risk.code}-${risk.detail}`}
                variant="caption"
                color={risk.severity === "error" ? "error.main" : "warning.main"}
              >
                {risk.code} · {translateInternalMessage(risk.detail, t)}
              </Typography>
            ))}
          </Stack>
        ) : null}

        {!compact &&
        !summary &&
        (context.evidence.length > 0 || context.recommendedActions.length > 0) ? (
          <Box
            component="details"
            sx={{
              "& summary": {
                cursor: "pointer",
                color: "text.secondary",
                fontSize: "0.72rem",
                fontWeight: 740,
              },
            }}
          >
            <Box component="summary">{t("证据与建议动作")}</Box>
            <Stack spacing={0.32} sx={{ mt: 0.55 }}>
              {context.evidence.map((evidence, index) => (
                <Typography key={`${evidence.kind}-${index}`} variant="caption">
                  {evidence.kind} / {evidence.source} ·{" "}
                  {translateInternalMessage(evidence.detail, t)}
                </Typography>
              ))}
              {context.recommendedActions.map((action) => (
                <Typography
                  key={action.command}
                  variant="caption"
                  sx={{ overflowWrap: "anywhere", fontFamily: "monospace" }}
                >
                  {action.command} · {translateInternalMessage(action.reason, t)}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
