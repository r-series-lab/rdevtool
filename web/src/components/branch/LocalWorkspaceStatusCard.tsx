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
import { BranchChangedFilesList } from "./BranchChangedFilesList";
import { BranchRevisionSummary } from "./BranchRevisionSummary";

type LocalWorkspaceStatusCardProps = {
  status: BranchPushStatus;
  blocked: boolean;
  filesExpanded: boolean;
  onToggleFilesExpanded: () => void;
  onOpenPushMode: () => void;
};

export function LocalWorkspaceStatusCard({
  status,
  blocked,
  filesExpanded,
  onToggleFilesExpanded,
  onOpenPushMode,
}: LocalWorkspaceStatusCardProps) {
  const { t } = useI18n();

  return (
    <Box
      sx={(theme) => ({
        px: { xs: 0.9, sm: 1 },
        py: 0.95,
        borderRadius: "14px",
        border: "1px solid",
        borderColor: status.clean
          ? theme.palette.divider
          : alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.28 : 0.2),
        bgcolor:
          theme.palette.mode === "dark"
            ? alpha(theme.palette.primary.main, status.clean ? 0.025 : 0.055)
            : alpha(theme.palette.primary.main, status.clean ? 0.018 : 0.04),
        boxShadow:
          theme.palette.mode === "dark"
            ? "inset 0 1px 0 rgba(255,255,255,0.03)"
            : "0 10px 24px rgba(38,61,92,0.055)",
        minWidth: 0,
        overflow: "hidden",
      })}
    >
      <Stack spacing={0.65}>
        <Stack direction="row" columnGap={0.5} rowGap={0.45} flexWrap="wrap">
          <Chip
            size="small"
            label={t(status.clean ? "工作副本干净" : "存在本地改动")}
            color={status.clean ? "success" : "primary"}
            variant={status.clean ? "outlined" : "filled"}
          />
          <Chip size="small" label={t("已暂存 {count}", { count: status.stagedCount })} variant="outlined" />
          <Chip size="small" label={t("未暂存 {count}", { count: status.unstagedCount })} variant="outlined" />
          <Chip size="small" label={t("未跟踪 {count}", { count: status.untrackedCount })} variant="outlined" />
          <Chip
            size="small"
            label={t("冲突 {count}", { count: status.conflictedCount })}
            color={status.conflictedCount > 0 ? "error" : "default"}
            variant={status.conflictedCount > 0 ? "filled" : "outlined"}
          />
        </Stack>

        {status.latestCommit ? (
          <BranchRevisionSummary
            label={t("最近提交")}
            commit={status.latestCommit}
          />
        ) : null}

        {blocked ? (
          <Box
            sx={(theme) => ({
              position: "relative",
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto" },
              gap: { xs: 0.8, sm: 1 },
              alignItems: "center",
              px: 1,
              py: 0.9,
              pl: 1.25,
              borderRadius: "12px",
              border: "1px solid",
              borderColor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.24 : 0.18),
              bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.06 : 0.04),
              minWidth: 0,
              overflow: "hidden",
              "&::before": {
                content: '""',
                position: "absolute",
                left: 0,
                top: 10,
                bottom: 10,
                width: 3,
                borderRadius: "0 999px 999px 0",
                bgcolor: "primary.main",
              },
            })}
          >
            <Box minWidth={0}>
              <Typography variant="body2" fontWeight={820} sx={{ lineHeight: 1.35 }}>
                {t("切换已暂停")}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.12, overflowWrap: "anywhere", lineHeight: 1.45 }}
              >
                {t("先处理本地变更，再切换到目标分支。")}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.55} flexWrap="wrap" rowGap={0.55}>
              <Button
                size="small"
                variant="contained"
                onClick={onOpenPushMode}
                sx={{ minHeight: 28, px: 1, whiteSpace: "nowrap" }}
              >
                {t("去推送/提交")}
              </Button>
              {status.files.length > 0 ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onToggleFilesExpanded}
                  sx={{ minHeight: 28, px: 1, whiteSpace: "nowrap" }}
                >
                  {t(filesExpanded ? "收起明细" : "查看变更")}
                </Button>
              ) : null}
            </Stack>

            <Box sx={{ gridColumn: "1 / -1", minWidth: 0 }}>
              <BranchChangedFilesList
                files={status.files}
                expanded={filesExpanded}
                dense
                projectKey={status.projectKey}
                repoPath={status.repoPath}
              />
            </Box>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
