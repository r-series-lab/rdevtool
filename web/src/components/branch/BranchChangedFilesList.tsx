import {
  Box,
  Chip,
  Collapse,
  Stack,
  Typography,
} from "@mui/material";
import type { BranchPushFileStatus } from "../../app-types";

const BRANCH_CHANGED_FILE_VISIBLE_ROWS = 10;
const BRANCH_CHANGED_FILE_LIST_MAX_HEIGHT = 320;

function branchChangedFileStatusLabel(item: BranchPushFileStatus) {
  if (item.conflicted) {
    return "冲突";
  }
  if (item.untracked) {
    return "新文件";
  }
  if (item.staged && item.unstaged) {
    return "已暂存 + 未暂存";
  }
  if (item.staged) {
    return "已暂存";
  }
  if (item.unstaged) {
    return "未暂存";
  }
  return item.code || "变更";
}

type BranchChangedFilesListProps = {
  files: BranchPushFileStatus[];
  expanded: boolean;
  dense?: boolean;
};

export function BranchChangedFilesList({
  files,
  expanded,
  dense = false,
}: BranchChangedFilesListProps) {
  if (files.length === 0) {
    return null;
  }

  const overflow = files.length > BRANCH_CHANGED_FILE_VISIBLE_ROWS;

  return (
    <Collapse in={expanded}>
      <Stack spacing={0.6}>
        {overflow ? (
          <Typography variant="caption" color="text.secondary">
            默认显示前 {BRANCH_CHANGED_FILE_VISIBLE_ROWS} 条高度，可下拉查看更多。
          </Typography>
        ) : null}
        <Box
          sx={{
            maxHeight: overflow ? `${BRANCH_CHANGED_FILE_LIST_MAX_HEIGHT}px` : "none",
            overflowY: overflow ? "auto" : "visible",
            pr: overflow ? 0.5 : 0,
          }}
        >
          <Stack spacing={0.55}>
            {files.map((item) => (
              <Box
                key={`${item.code}-${item.path}`}
                sx={{
                  px: dense ? 0.8 : 0.9,
                  py: dense ? 0.65 : 0.75,
                  borderRadius: dense ? "12px" : "14px",
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: dense ? "rgba(255,255,255,0.012)" : "rgba(255,255,255,0.01)",
                  minWidth: 0,
                  maxWidth: "100%",
                  overflow: "hidden",
                }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  spacing={dense ? 0.8 : 1}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      minWidth: 0,
                      whiteSpace: "normal",
                      wordBreak: "break-all",
                      overflowWrap: "anywhere",
                      lineHeight: 1.45,
                      fontFamily:
                        '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                      fontSize: "0.71rem",
                    }}
                  >
                    {item.path}
                  </Typography>
                  <Chip
                    size="small"
                    label={branchChangedFileStatusLabel(item)}
                    variant="outlined"
                    sx={{
                      flexShrink: 0,
                      alignSelf: { xs: "flex-start", sm: "center" },
                    }}
                  />
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Collapse>
  );
}
