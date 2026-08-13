import { invoke } from "@tauri-apps/api/core";
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
  ResourceActionResultItem,
  ResourceActionResultStatus,
  ResourceActionRetry,
  ResourceActionRunResult,
} from "../app-types";
import { useI18n } from "../i18n";
import { OpenExternalIcon, RefreshIcon } from "./AppIcons";

type ResourceActionResultPanelProps = {
  result: ResourceActionRunResult;
  onRetry?: (retry: ResourceActionRetry) => void;
  retryDisabled?: boolean;
};

const STATUS_COPY: Record<
  ResourceActionResultStatus,
  { label: string; color: "success" | "warning" | "error" | "default" }
> = {
  success: { label: "成功", color: "success" },
  warning: { label: "有警告", color: "warning" },
  failed: { label: "失败", color: "error" },
  skipped: { label: "已跳过", color: "default" },
};

export function ResourceActionResultPanel({
  result,
  onRetry,
  retryDisabled = false,
}: ResourceActionResultPanelProps) {
  const { t } = useI18n();
  const structured = result.structuredResult;
  const rawOutput = structured
    ? result.stderr.trim()
    : [result.stdout, result.stderr].filter((value) => value.trim()).join("\n");

  return (
    <Stack spacing={1.4}>
      <Alert severity={result.success ? "success" : result.cancelled ? "warning" : "error"}>
        {result.success
          ? structured?.summary || t("执行完成，用时 {duration} ms。", { duration: result.durationMs })
          : result.cancelled
            ? t("执行已取消，进程已停止。")
            : result.timedOut
            ? t("执行超时，进程已停止。")
            : structured?.summary || t("执行失败，退出码：{code}", { code: result.exitCode ?? "-" })}
      </Alert>

      {structured?.items.length ? (
        <Stack divider={<Divider flexItem />}>
          {structured.items.map((item) => (
            <StructuredResultItem key={item.key} item={item} />
          ))}
        </Stack>
      ) : null}

      {structured?.retry && structured.retry.values.length > 0 && onRetry ? (
        <Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon fontSize="small" />}
            disabled={retryDisabled}
            onClick={() => onRetry(structured.retry!)}
          >
            {t("重试失败项（{count}）", { count: structured.retry.values.length })}
          </Button>
        </Box>
      ) : null}

      {rawOutput ? (
        <Box
          component="details"
          sx={{
            borderTop: structured ? 1 : 0,
            borderColor: "divider",
            pt: structured ? 1 : 0,
            "& > summary": { cursor: "pointer", color: "text.secondary" },
          }}
        >
          <Typography component="summary" variant="caption">
            {structured ? t("运行日志") : t("原始输出")}
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              mt: 1,
              p: 1.25,
              maxHeight: 240,
              overflow: "auto",
              bgcolor: "action.hover",
              borderRadius: 1,
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {rawOutput}
            {result.stdoutTruncated || result.stderrTruncated ? `\n${t("输出已截断。")}` : ""}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}

function StructuredResultItem({ item }: { item: ResourceActionResultItem }) {
  const { t } = useI18n();
  const status = STATUS_COPY[item.status];
  return (
    <Stack spacing={0.7} sx={{ py: 1.2 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2">{item.label}</Typography>
          {item.summary ? (
            <Typography variant="body2" color="text.secondary">
              {item.summary}
            </Typography>
          ) : null}
        </Box>
        <Chip size="small" color={status.color} variant="outlined" label={t(status.label)} />
      </Stack>
      {item.detail ? (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
          {item.detail}
        </Typography>
      ) : null}
      {item.parameters.length ? (
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
          {item.parameters.map((parameter) => (
            <Chip
              key={parameter.key}
              size="small"
              variant="outlined"
              label={`${parameter.label} · ${parameter.value}`}
            />
          ))}
        </Stack>
      ) : null}
      {item.url ? (
        <Box>
          <Button
            size="small"
            color="inherit"
            startIcon={<OpenExternalIcon fontSize="small" />}
            onClick={() =>
              void invoke("open_external_resource", { kind: "url", value: item.url })
            }
          >
            {t("打开结果")}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}
