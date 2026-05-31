import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { BranchPushStatus } from "../../app-types";
import { BranchChangedFilesList } from "./BranchChangedFilesList";

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
            label={status.clean ? "工作区干净" : "存在本地改动"}
            color={status.clean ? "success" : "primary"}
            variant={status.clean ? "outlined" : "filled"}
          />
          <Chip size="small" label={`已暂存 ${status.stagedCount}`} variant="outlined" />
          <Chip size="small" label={`未暂存 ${status.unstagedCount}`} variant="outlined" />
          <Chip size="small" label={`未跟踪 ${status.untrackedCount}`} variant="outlined" />
          <Chip
            size="small"
            label={`冲突 ${status.conflictedCount}`}
            color={status.conflictedCount > 0 ? "error" : "default"}
            variant={status.conflictedCount > 0 ? "filled" : "outlined"}
          />
        </Stack>

        {status.latestCommit ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr)",
              alignItems: "baseline",
              columnGap: 0.5,
              minWidth: 0,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flexShrink: 0, fontSize: "0.7rem", fontWeight: 680, lineHeight: 1.35 }}
            >
              最近提交
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              title={`${status.latestCommit.shortHash} · ${status.latestCommit.subject}`}
              sx={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.72rem",
                lineHeight: 1.35,
              }}
            >
              <Box
                component="span"
                sx={{
                  fontFamily:
                    '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                  fontWeight: 720,
                }}
              >
                {status.latestCommit.shortHash}
              </Box>
              {" · "}
              {status.latestCommit.subject}
            </Typography>
          </Box>
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
                切换已暂停
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.12, overflowWrap: "anywhere", lineHeight: 1.45 }}
              >
                先处理本地变更，再切换到目标分支。
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.55} flexWrap="wrap" rowGap={0.55}>
              <Button
                size="small"
                variant="contained"
                onClick={onOpenPushMode}
                sx={{ minHeight: 28, px: 1, whiteSpace: "nowrap" }}
              >
                去推送/提交
              </Button>
              {status.files.length > 0 ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onToggleFilesExpanded}
                  sx={{ minHeight: 28, px: 1, whiteSpace: "nowrap" }}
                >
                  {filesExpanded ? "收起明细" : "查看变更"}
                </Button>
              ) : null}
            </Stack>

            <Box sx={{ gridColumn: "1 / -1", minWidth: 0 }}>
              <BranchChangedFilesList
                files={status.files}
                expanded={filesExpanded}
                dense
              />
            </Box>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
