import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { BuildResult } from "../../hooks/useBuildHistory";
import { useI18n } from "../../i18n";
import { translateInternalMessage } from "../../i18n/internalMessages";
import { isOperationActiveState } from "../../lib/operationLifecycle";
import {
  CheckIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  OpenExternalIcon,
  RefreshIcon,
} from "../AppIcons";

const BUILD_STATUS_STALE_MS = 45_000;
const BUILD_STATUS_CLOCK_INTERVAL_MS = 15_000;

type BuildStatusFreshnessProps = {
  updatedAtMs: number;
  nowMs: number;
  active: boolean;
  timedOut: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
};

function BuildStatusFreshness({
  updatedAtMs,
  nowMs,
  active,
  timedOut,
  canRefresh,
  onRefresh,
}: BuildStatusFreshnessProps) {
  const { t } = useI18n();
  const stale = Boolean(
    timedOut || (active && updatedAtMs && nowMs - updatedAtMs > BUILD_STATUS_STALE_MS),
  );
  if (!stale) {
    return null;
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="baseline" flexWrap="wrap" rowGap={0.2}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontSize: "0.7rem", lineHeight: 1.4 }}
      >
        {timedOut ? t("自动刷新已暂停") : t("状态可能已过期")}
      </Typography>
      <Button
        size="small"
        variant="text"
        disabled={!canRefresh}
        onClick={onRefresh}
        sx={{
          minWidth: 0,
          minHeight: 20,
          px: 0.25,
          py: 0,
          fontSize: "0.7rem",
          fontWeight: 760,
          lineHeight: 1.2,
        }}
      >
        {t("刷新")}
      </Button>
    </Stack>
  );
}

type BuildResultRowProps = {
  label: string;
  value?: string | number | null;
  displayValue?: string | number | null;
  copyKey?: string;
  copied?: boolean;
  emphasized?: boolean;
  onCopy?: (field: string, value?: string | number | null) => void;
};

function BuildResultRow({
  label,
  value,
  displayValue,
  copyKey,
  copied = false,
  emphasized = false,
  onCopy,
}: BuildResultRowProps) {
  const { t } = useI18n();
  const rawTextValue = value === null || value === undefined || value === "" ? "-" : String(value);
  const textValue =
    displayValue === null || displayValue === undefined || displayValue === ""
      ? rawTextValue
      : String(displayValue);
  const canCopy = Boolean(copyKey && rawTextValue !== "-" && onCopy);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "76px minmax(0,1fr)", sm: "92px minmax(0,1fr)" },
        alignItems: "start",
        gap: 1,
        minWidth: 0,
        py: 0.65,
        borderTop: "1px solid",
        borderColor: "divider",
        "&:first-of-type": { borderTop: "none" },
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap sx={{ fontWeight: 800 }}>
        {label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" spacing={0.55} minWidth={0}>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            minWidth: 0,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            fontWeight: emphasized ? 700 : 500,
          }}
        >
          {textValue}
        </Typography>
        {canCopy && copyKey ? (
          <IconButton
            size="small"
            onClick={() => onCopy?.(copyKey, rawTextValue)}
            title={copied ? t("已复制") : t("复制")}
            aria-label={
              copied
                ? t("已复制{label}", { label })
                : t("复制{label}", { label })
            }
            sx={{ mt: -0.45, flexShrink: 0 }}
          >
            {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
          </IconButton>
        ) : null}
      </Stack>
    </Box>
  );
}

type BuildResultPanelProps = {
  buildResult: BuildResult | null;
  buildResultUpdatedAtMs: number;
  buildAutoRefreshTimedOut: boolean;
  copiedField: string;
  onCopy: (field: string, value?: string | number | null) => void;
  onRefreshBuild: () => void;
  onOpenBuildRecord: () => void;
};

export function BuildResultPanel({
  buildResult,
  buildResultUpdatedAtMs,
  buildAutoRefreshTimedOut,
  copiedField,
  onCopy,
  onRefreshBuild,
  onOpenBuildRecord,
}: BuildResultPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const canRefreshBuild = Boolean(buildResult?.queueUrl || buildResult?.buildUrl);
  const buildResultActive =
    canRefreshBuild && isOperationActiveState(buildResult?.stateKey);

  useEffect(() => {
    if (!buildResultUpdatedAtMs) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, BUILD_STATUS_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [buildResultUpdatedAtMs]);

  return (
    <Card variant="outlined" sx={{ borderRadius: "20px", overflow: "hidden", minWidth: 0, maxWidth: "100%" }}>
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1}
          flexWrap="wrap"
          rowGap={0.6}
          minWidth={0}
          mb={expanded ? 1.2 : 0}
        >
          <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 700 }}>
            {t("结果")}
          </Typography>
          <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" rowGap={0.5} justifyContent="flex-end">
            <IconButton onClick={onRefreshBuild} disabled={!canRefreshBuild} size="small" title={t("刷新构建状态")}>
              <RefreshIcon fontSize="small" />
            </IconButton>
            <IconButton onClick={onOpenBuildRecord} disabled={!canRefreshBuild} size="small" title={t("打开构建记录页")}>
              <OpenExternalIcon fontSize="small" />
            </IconButton>
            {buildResult ? (
              <BuildStatusFreshness
                updatedAtMs={buildResultUpdatedAtMs}
                nowMs={nowMs}
                active={buildResultActive}
                timedOut={buildAutoRefreshTimedOut}
                canRefresh={canRefreshBuild}
                onRefresh={onRefreshBuild}
              />
            ) : null}
            <IconButton
              size="small"
              onClick={() => setExpanded((current) => !current)}
              title={expanded ? t("收起构建结果") : t("展开构建结果")}
            >
              {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
            </IconButton>
          </Stack>
        </Stack>
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {buildResult ? (
            <Stack spacing={0.1} minWidth={0}>
              <BuildResultRow
                label={t("状态")}
                value={buildResult.stateLabel}
                displayValue={translateInternalMessage(buildResult.stateLabel, t)}
                emphasized
              />
              <BuildResultRow label="HTTP" value={buildResult.status} />
              <BuildResultRow
                label={t("队列")}
                value={buildResult.queueUrl}
                copyKey="queueUrl"
                copied={copiedField === "queueUrl"}
                onCopy={onCopy}
              />
              <BuildResultRow
                label={t("构建")}
                value={buildResult.buildUrl}
                copyKey="buildUrl"
                copied={copiedField === "buildUrl"}
                onCopy={onCopy}
              />
              <BuildResultRow
                label={t("说明")}
                value={buildResult.detail}
                displayValue={translateInternalMessage(buildResult.detail ?? "", t)}
                copyKey="detail"
                copied={copiedField === "detail"}
                onCopy={onCopy}
              />
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("构建完成后，这里展示状态和记录地址。")}
            </Typography>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
}
