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

type BranchPushStatusCardProps = {
  status: BranchPushStatus;
  filesExpanded: boolean;
  onToggleFilesExpanded: () => void;
};

export function BranchPushStatusCard({
  status,
  filesExpanded,
  onToggleFilesExpanded,
}: BranchPushStatusCardProps) {
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
        maxWidth: "100%",
        overflow: "hidden",
      })}
    >
      <Stack spacing={0.65}>
        <Stack direction="row" columnGap={0.5} rowGap={0.45} flexWrap="wrap">
          <Chip
            size="small"
            label={`分支 ${status.currentBranch || "-"}`}
            color="primary"
            variant={status.clean ? "outlined" : "filled"}
            sx={{ maxWidth: "100%" }}
          />
          <Chip size="small" label={`领先 ${status.ahead}`} variant="outlined" />
          <Chip size="small" label={`落后 ${status.behind}`} variant="outlined" />
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

        {status.files.length > 0 ? (
          <Stack spacing={0.55}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={1}
              flexWrap="wrap"
            >
              <Chip
            size="small"
            label={`变更文件 ${status.files.length}`}
            color="primary"
            variant="outlined"
          />
              <Button
                size="small"
                variant="outlined"
                onClick={onToggleFilesExpanded}
                sx={{ minHeight: 26, minWidth: 0, px: 0.8, fontSize: "0.76rem" }}
              >
                {filesExpanded ? "收起明细" : "展开明细"}
              </Button>
            </Stack>
            <BranchChangedFilesList
              files={status.files}
              expanded={filesExpanded}
              dense
            />
          </Stack>
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", fontSize: "0.72rem", lineHeight: 1.35 }}
          >
            当前工作副本没有未提交文件。
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
