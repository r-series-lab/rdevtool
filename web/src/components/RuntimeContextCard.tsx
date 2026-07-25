import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ProjectRuntimeContextSnapshot } from "../app-types";
import {
  runtimeContextSelectionLabel,
  runtimeReadyProbeLabel,
} from "../lib/runtimeContext";

type RuntimeContextCardProps = {
  context?: ProjectRuntimeContextSnapshot | null;
  title?: string;
  loading?: boolean;
  error?: string;
  compact?: boolean;
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

function formatStartedAt(value?: number | null): string {
  if (!value) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function RuntimeValueRow({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "74px minmax(0, 1fr)",
        gap: 0.7,
        alignItems: "start",
      }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={720}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          minWidth: 0,
          overflowWrap: "anywhere",
          fontFamily:
            label === "工作目录" || label === "启动命令" || label === "打开地址"
              ? '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace'
              : undefined,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function RuntimeContextCard({
  context,
  title = "Runtime Context",
  loading = false,
  error = "",
  compact = false,
}: RuntimeContextCardProps) {
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
          {error || `${title} 加载中`}
        </Typography>
      </Box>
    );
  }

  const target = context.effective.target;
  const sessions = context.observed.sessions;
  const overrideLabels = [
    context.requested.command ? "命令覆盖" : "",
    context.requested.expectedPort ? `端口 ${context.requested.expectedPort}` : "",
    context.requested.envKeys.length ? `${context.requested.envKeys.length} env` : "",
  ].filter(Boolean);

  return (
    <Box
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
        <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" fontWeight={820} sx={{ mr: "auto" }}>
            {title}
          </Typography>
          <Chip size="small" color={statusColor(context)} label={context.status.label} />
          <Chip
            size="small"
            variant="outlined"
            label={runtimeContextSelectionLabel(context)}
          />
          {overrideLabels.map((label) => (
            <Chip key={label} size="small" variant="outlined" label={label} />
          ))}
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: compact
              ? "minmax(0, 1fr)"
              : { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
            gap: 0.75,
          }}
        >
          <Stack spacing={0.42} minWidth={0}>
            <Typography variant="overline" color="text.secondary" lineHeight={1.3}>
              REQUESTED
            </Typography>
            <RuntimeValueRow label="项目" value={context.requested.projectKey} />
            <RuntimeValueRow
              label="调试档案"
              value={context.requested.debugProfileKey || "自动选择"}
            />
            <RuntimeValueRow
              label="运行档案"
              value={context.requested.runtimeProfileKey || "继承配置"}
            />
            <RuntimeValueRow
              label="命令覆盖"
              value={context.requested.command || "无"}
            />
            <RuntimeValueRow
              label="端口覆盖"
              value={context.requested.expectedPort?.toString() || "无"}
            />
            <RuntimeValueRow
              label="环境覆盖"
              value={context.requested.envKeys.join(", ") || "无"}
            />
          </Stack>

          <Stack spacing={0.42} minWidth={0}>
            <Typography variant="overline" color="text.secondary" lineHeight={1.3}>
              EFFECTIVE
            </Typography>
            <RuntimeValueRow label="工作目录" value={target?.cwd || "未解析"} />
            <RuntimeValueRow label="打开地址" value={target?.focusUrl || "未配置"} />
            <RuntimeValueRow
              label="预期端口"
              value={target?.expectedPort?.toString() || "未配置"}
            />
            <RuntimeValueRow
              label="Ready 探测"
              value={runtimeReadyProbeLabel(target?.readyProbe)}
            />
            {!compact ? (
              <RuntimeValueRow label="启动命令" value={target?.command || "未解析"} />
            ) : null}
          </Stack>

          <Stack spacing={0.42} minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="overline" color="text.secondary" lineHeight={1.3}>
                OBSERVED
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {context.observed.available ? `${sessions.length} 个会话` : "观测不可用"}
              </Typography>
            </Stack>
            {sessions.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                当前候选目录未观测到 daemon 会话。
              </Typography>
            ) : (
              sessions.map((session, index) => (
                <Box
                  key={session.runId || `${session.cwd}-${index}`}
                  sx={{
                    px: 0.7,
                    py: 0.55,
                    borderRadius: "9px",
                    border: "1px solid",
                    borderColor: session.managed ? "success.light" : "warning.light",
                    bgcolor: "action.hover",
                  }}
                >
                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                    <Chip
                      size="small"
                      color={session.running ? "success" : "default"}
                      label={session.phase}
                    />
                    <Typography variant="caption" fontWeight={760}>
                      {session.runId || "无 runId"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {session.managed ? "rDevTool 管理" : "未验证归属"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatStartedAt(session.startedAtMs)}
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
        </Box>

        <Typography variant="caption" color="text.secondary">
          {context.status.detail}
        </Typography>

        {context.risks.length > 0 ? (
          <Stack spacing={0.2}>
            {context.risks.map((risk) => (
              <Typography
                key={`${risk.code}-${risk.detail}`}
                variant="caption"
                color={risk.severity === "error" ? "error.main" : "warning.main"}
              >
                {risk.code} · {risk.detail}
              </Typography>
            ))}
          </Stack>
        ) : null}

        {!compact &&
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
            <Box component="summary">证据与建议动作</Box>
            <Stack spacing={0.32} sx={{ mt: 0.55 }}>
              {context.evidence.map((evidence, index) => (
                <Typography key={`${evidence.kind}-${index}`} variant="caption">
                  {evidence.kind} / {evidence.source} · {evidence.detail}
                </Typography>
              ))}
              {context.recommendedActions.map((action) => (
                <Typography
                  key={action.command}
                  variant="caption"
                  sx={{ overflowWrap: "anywhere", fontFamily: "monospace" }}
                >
                  {action.command} · {action.reason}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
