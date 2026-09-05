import { useEffect, useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useI18n, type Translate } from "../i18n";
import type {
  ActiveSession,
  ActiveSessionPortInspection,
} from "../lib/activeSessions";
import { AppActionDialog, type AppActionDialogTone } from "./AppActionDialog";
import {
  CheckIcon,
  CopyIcon,
  LocateIcon,
  SearchIcon,
  WarningIcon,
} from "./AppIcons";

type ActiveSessionInspectionDialogProps = {
  session: ActiveSession | null;
  inspection: ActiveSessionPortInspection | null;
  onClose: () => void;
  onOpenDetails: (session: ActiveSession) => void;
};

type OwnershipPresentation = {
  label: string;
  description: string;
  tone: AppActionDialogTone;
  className: string;
};

function ownershipPresentation(
  inspection: ActiveSessionPortInspection,
  t: Translate,
): OwnershipPresentation {
  switch (inspection.ownershipKey) {
    case "expectedPid":
      return {
        label: t("PID 归属已验证"),
        description: t("实际监听 PID 与当前资源快照一致，可以确认进程归属。"),
        tone: "primary",
        className: "is-verified",
      };
    case "expectedDirectory":
      return {
        label: t("工作目录相关"),
        description: t("监听进程位于项目目录内，但 PID 与当前快照不一致，处置前仍需复核。"),
        tone: "warning",
        className: "is-related",
      };
    case "mismatch":
      return {
        label: t("归属不匹配"),
        description: t("监听进程与当前资源的 PID 和工作目录均不匹配，不应直接结束。"),
        tone: "warning",
        className: "is-mismatch",
      };
    case "notListening":
      return {
        label: t("端口未监听"),
        description: t("检查时没有发现监听进程，活动栏状态可能已经变化。"),
        tone: "neutral",
        className: "is-neutral",
      };
    case "unsupported":
      return {
        label: t("当前平台暂不支持"),
        description: t("当前平台无法读取结构化监听进程证据。"),
        tone: "neutral",
        className: "is-neutral",
      };
    default:
      return {
        label: t("归属待确认"),
        description: t("已读取实际监听者，但当前资源没有可用于核对的 PID 或项目目录。"),
        tone: "neutral",
        className: "is-neutral",
      };
  }
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <Box className="active-session-inspection-evidence-row">
      <Typography component="dt" variant="caption">
        {label}
      </Typography>
      <Typography component="dd" variant="caption" title={value}>
        {value}
      </Typography>
    </Box>
  );
}

export function ActiveSessionInspectionDialog({
  session,
  inspection,
  onClose,
  onOpenDetails,
}: ActiveSessionInspectionDialogProps) {
  const { language, t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [inspection]);

  if (!session || !inspection) {
    return null;
  }

  const ownership = ownershipPresentation(inspection, t);
  const inspectedAt = new Date(inspection.inspectedAtMs).toLocaleString(language);

  const copyEvidence = async () => {
    if (!navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          resource: {
            id: session.id,
            kind: session.kind,
            name: session.name,
            projectKey: session.projectKey ?? null,
            port: session.port ?? null,
          },
          inspection,
        },
        null,
        2,
      ),
    );
    setCopied(true);
  };

  return (
    <AppActionDialog
      open
      maxWidth="sm"
      tone={ownership.tone}
      title={t("端口 {port} 深度诊断", { port: inspection.port })}
      subtitle={session.name}
      description={ownership.description}
      icon={<SearchIcon />}
      contentIcon={false}
      className="active-session-inspection-dialog"
      onClose={onClose}
      actions={(
        <>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={copied ? <CheckIcon /> : <CopyIcon />}
            onClick={() => void copyEvidence()}
          >
            {copied ? t("已复制证据") : t("复制证据")}
          </Button>
          <Button color="inherit" onClick={onClose}>
            {t("关闭")}
          </Button>
          <Button
            variant="contained"
            startIcon={<LocateIcon />}
            onClick={() => onOpenDetails(session)}
          >
            {t("打开资源详情")}
          </Button>
        </>
      )}
    >
      <Stack className="active-session-inspection" spacing={1.4}>
        <Stack
          className="active-session-inspection-summary"
          direction="row"
          alignItems="center"
          spacing={0.8}
          flexWrap="wrap"
          useFlexGap
        >
          <Chip
            size="small"
            className={ownership.className}
            icon={inspection.ownershipVerified ? <CheckIcon /> : <WarningIcon />}
            label={ownership.label}
          />
          <Typography variant="caption">
            {t("检查于 {time}", { time: inspectedAt })}
          </Typography>
        </Stack>

        <Box component="dl" className="active-session-inspection-evidence">
          <EvidenceRow label={t("诊断端口")} value={String(inspection.port)} />
          <EvidenceRow
            label={t("期望 PID")}
            value={inspection.expectedPid ? String(inspection.expectedPid) : t("未提供")}
          />
          <EvidenceRow
            label={t("期望目录")}
            value={inspection.expectedDirectoryPath || t("未提供")}
          />
        </Box>

        <Box>
          <Typography className="active-session-inspection-section-title" variant="overline">
            {t("实际监听者 {count}", { count: inspection.listeners.length })}
          </Typography>
          {inspection.listeners.length === 0 ? (
            <Typography className="active-session-inspection-empty" variant="body2">
              {t("没有发现监听该端口的进程。")}
            </Typography>
          ) : (
            <Stack className="active-session-inspection-listeners" spacing={0}>
              {inspection.listeners.map((listener) => (
                <Box className="active-session-inspection-listener" key={listener.pid}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.7}
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography variant="subtitle2">{listener.name}</Typography>
                    <Chip size="small" label={`PID ${listener.pid}`} />
                    {listener.matchesExpectedPid ? (
                      <Chip size="small" className="is-verified" label={t("PID 匹配")} />
                    ) : listener.matchesExpectedDirectory ? (
                      <Chip size="small" className="is-related" label={t("目录匹配")} />
                    ) : (
                      <Chip size="small" className="is-mismatch" label={t("未匹配")} />
                    )}
                  </Stack>
                  <Typography component="code" variant="caption" title={listener.command}>
                    {listener.command}
                  </Typography>
                  <Typography component="code" variant="caption" title={listener.cwd}>
                    {listener.cwd}
                  </Typography>
                  <Typography variant="caption">
                    {t("PPID {ppid} · PGID {pgid} · 启动于 {time}", {
                      ppid: listener.ppid,
                      pgid: listener.pgid,
                      time: listener.startedAt,
                    })}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Typography className="active-session-inspection-safety" variant="caption">
          {t("此处仅展示只读证据。只有 PID 归属已验证时，才应从对应资源入口执行停止操作。")}
        </Typography>
      </Stack>
    </AppActionDialog>
  );
}
