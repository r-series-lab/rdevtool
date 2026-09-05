import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { BranchPushStatus } from "../../app-types";
import { useI18n } from "../../i18n";
import { BranchChangesDialog } from "./BranchChangedFilesList";
import { BranchRevisionSummary } from "./BranchRevisionSummary";

type BranchPushStatusCardProps = {
  status: BranchPushStatus;
  filesExpanded: boolean;
  onToggleFilesExpanded: () => void;
  selectionEnabled?: boolean;
  selectedPaths?: string[];
  onSelectedPathsChange?: (value: string[]) => void;
};

export function BranchPushStatusCard({
  status,
  filesExpanded,
  onToggleFilesExpanded,
  selectionEnabled = false,
  selectedPaths = [],
  onSelectedPathsChange,
}: BranchPushStatusCardProps) {
  const { t } = useI18n();
  const selectedPathSet = new Set(selectedPaths);
  const hasUnselectedStagedFile =
    selectionEnabled &&
    selectedPaths.length > 0 &&
    status.files.some((item) => item.staged && !selectedPathSet.has(item.path));
  const dirty = !status.clean;
  const upstreamComparable =
    status.upstreamComparable ?? Boolean(status.upstreamBranch);
  const statusMetrics = [
    { key: "ahead", label: "领先", value: status.ahead, tone: "primary", available: upstreamComparable },
    { key: "behind", label: "落后", value: status.behind, tone: "warning", available: upstreamComparable },
    { key: "staged", label: "暂存", value: status.stagedCount, tone: "success", available: true },
    { key: "unstaged", label: "未暂存", value: status.unstagedCount, tone: "primary", available: true },
    { key: "untracked", label: "未跟踪", value: status.untrackedCount, tone: "default", available: true },
    { key: "conflict", label: "冲突", value: status.conflictedCount, tone: "error", available: true },
  ] as const;

  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        px: { xs: 1, sm: 1.15 },
        py: { xs: 0.9, sm: 0.95 },
        borderRadius: "10px",
        border: "1px solid",
        borderColor: !dirty
          ? theme.palette.divider
          : alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.28 : 0.2),
        bgcolor: theme.palette.mode === "dark"
          ? alpha(theme.palette.background.paper, 0.72)
          : "rgba(255,255,255,0.58)",
        boxShadow:
          theme.palette.mode === "dark"
            ? "inset 0 1px 0 rgba(255,255,255,0.035)"
            : "0 8px 18px rgba(38,61,92,0.045), inset 0 1px 0 rgba(255,255,255,0.58)",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: "10px auto 10px 0",
          width: 3,
          borderRadius: "0 999px 999px 0",
          bgcolor: dirty
            ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.72 : 0.54)
            : alpha(theme.palette.text.secondary, theme.palette.mode === "dark" ? 0.18 : 0.14),
        },
      })}
    >
      <Stack spacing={0.75}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(116px, auto)" },
            alignItems: "center",
            gap: { xs: 0.7, md: 0.95 },
            minWidth: 0,
          }}
        >
          <Stack spacing={0.55} minWidth={0}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.65}
              minWidth={0}
              sx={{ maxWidth: "100%", flexWrap: "wrap" }}
            >
              <Box
                sx={(theme) => ({
                  minWidth: 0,
                  maxWidth: "100%",
                  display: "inline-grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  alignItems: "center",
                  gap: 0.45,
                  px: 0.65,
                  py: 0.28,
                  borderRadius: "8px",
                  bgcolor: dirty
                    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.08)
                    : alpha(theme.palette.text.secondary, theme.palette.mode === "dark" ? 0.09 : 0.045),
                  border: "1px solid",
                  borderColor: dirty
                    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.24 : 0.16)
                    : alpha(theme.palette.text.secondary, 0.12),
                })}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: dirty ? "primary.main" : "text.secondary",
                    fontSize: "0.62rem",
                    fontWeight: 860,
                    lineHeight: 1,
                  }}
                >
                  {t("分支")}
                </Typography>
                <Typography
                  variant="caption"
                  title={status.currentBranch || "-"}
                  sx={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "text.primary",
                    fontSize: "0.76rem",
                    fontWeight: 880,
                    lineHeight: 1.15,
                    fontFamily:
                      '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                  }}
                >
                  {status.currentBranch || "-"}
                </Typography>
              </Box>

              {selectedPaths.length > 0 ? (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={t("已选 {count}", { count: selectedPaths.length })}
                  sx={{ height: 23, borderRadius: "999px", fontWeight: 820 }}
                />
              ) : null}
            </Stack>

            <Stack direction="row" columnGap={0.45} rowGap={0.42} flexWrap="wrap">
              {statusMetrics.map((metric) => {
                const active = metric.available && metric.value > 0;
                const color =
                  metric.tone === "error"
                    ? "error.main"
                    : metric.tone === "warning"
                      ? "warning.main"
                      : metric.tone === "success"
                        ? "success.main"
                        : metric.tone === "primary"
                          ? "primary.main"
                          : "text.secondary";
                return (
                  <Box
                    key={metric.key}
                    sx={(theme) => ({
                      display: "inline-grid",
                      gridTemplateColumns: "auto auto",
                      alignItems: "center",
                      columnGap: 0.45,
                      minHeight: 24,
                      maxWidth: "100%",
                      px: 0.72,
                      borderRadius: "999px",
                      border: "1px solid",
                      borderColor: active
                        ? alpha(
                            metric.tone === "default"
                              ? theme.palette.text.secondary
                              : theme.palette[metric.tone].main,
                            theme.palette.mode === "dark" ? 0.24 : 0.18,
                          )
                        : alpha(theme.palette.text.secondary, theme.palette.mode === "dark" ? 0.14 : 0.12),
                      bgcolor: active
                        ? alpha(
                            metric.tone === "default"
                              ? theme.palette.text.secondary
                              : theme.palette[metric.tone].main,
                            theme.palette.mode === "dark" ? 0.09 : 0.045,
                          )
                        : alpha(theme.palette.text.secondary, theme.palette.mode === "dark" ? 0.025 : 0.018),
                    })}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        fontSize: "0.64rem",
                        fontWeight: 760,
                        lineHeight: 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t(metric.label)}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: active ? color : "text.secondary",
                        fontSize: "0.76rem",
                        fontWeight: 900,
                        lineHeight: 1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {metric.available ? metric.value : "—"}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>

            {status.latestCommit ? (
              <BranchRevisionSummary
                label={t("最近提交")}
                commit={status.latestCommit}
              />
            ) : null}
          </Stack>

          {status.files.length > 0 ? (
            <Box
              sx={(theme) => ({
                minWidth: { xs: 0, md: 128 },
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: { xs: "flex-start", md: "flex-end" },
                gap: 0.48,
                pt: { xs: 0.55, md: 0 },
                pl: { xs: 0, md: 0.9 },
                borderTop: {
                  xs: `1px solid ${alpha(
                    theme.palette.text.secondary,
                    theme.palette.mode === "dark" ? 0.08 : 0.065,
                  )}`,
                  md: 0,
                },
              })}
            >
              <Box
                sx={(theme) => ({
                  display: "inline-grid",
                  gridTemplateColumns: "auto auto",
                  gap: 0.45,
                  alignItems: "center",
                  minHeight: 24,
                  px: 0.72,
                  borderRadius: "999px",
                  border: "1px solid",
                  borderColor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.24 : 0.18),
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.09 : 0.045),
                })}
              >
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontSize: "0.64rem", fontWeight: 760, lineHeight: 1 }}
                >
                  {t("变更文件")}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: "primary.main",
                    fontSize: "0.76rem",
                    fontWeight: 920,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {status.files.length}
                </Typography>
              </Box>
              <Button
                size="small"
                variant={filesExpanded ? "contained" : "outlined"}
                onClick={onToggleFilesExpanded}
                sx={{
                  minHeight: 24,
                  minWidth: 78,
                  px: 0.9,
                  borderRadius: "999px",
                  fontSize: "0.72rem",
                  fontWeight: 840,
                  boxShadow: "none",
                }}
              >
                {t("查看变更")}
              </Button>
            </Box>
          ) : null}
        </Box>

        {hasUnselectedStagedFile ? (
          <Typography
            variant="caption"
            color="warning.main"
            sx={{ display: "block", lineHeight: 1.4 }}
          >
            {t("存在未选择但已暂存的文件，提交已选会被阻止。请一并选择或先处理暂存区。")}
          </Typography>
        ) : null}

        {status.files.length > 0 ? (
          <BranchChangesDialog
            open={filesExpanded}
            onClose={onToggleFilesExpanded}
            status={status}
            selectable={selectionEnabled}
            selectedPaths={selectedPaths}
            onSelectedPathsChange={onSelectedPathsChange}
          />
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", fontSize: "0.72rem", lineHeight: 1.35 }}
          >
            {t("当前工作副本没有未提交文件。")}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
