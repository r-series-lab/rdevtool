import { Box, Button } from "@mui/material";
import type { BranchWorkflowMode } from "../../app-types";

export const BRANCH_MODE_OPTIONS: Array<{
  key: BranchWorkflowMode;
  label: string;
  hint: string;
}> = [
  {
    key: "sync",
    label: "合并分支",
    hint: "源分支合并到多个目标分支",
  },
  {
    key: "create",
    label: "创建分支",
    hint: "批量创建目标分支",
  },
  {
    key: "push",
    label: "提交推送",
    hint: "检查工作副本状态，并执行提交推送或仅推送",
  },
  {
    key: "switch",
    label: "副本管理",
    hint: "选择本地工作副本，切换分支或克隆新目录",
  },
];

export function branchWorkflowModeLabel(mode: BranchWorkflowMode) {
  if (mode === "checkout") {
    return "克隆";
  }
  if (mode === "switch") {
    return "副本管理";
  }
  return BRANCH_MODE_OPTIONS.find((item) => item.key === mode)?.label ?? mode;
}

type BranchModeTabsProps = {
  mode: BranchWorkflowMode;
  onModeChange: (mode: BranchWorkflowMode) => void;
};

export function BranchModeTabs({
  mode,
  onModeChange,
}: BranchModeTabsProps) {
  return (
    <Box
      className="branch-mode-tabs"
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: { xs: 0.2, sm: 0.28 },
        p: { xs: 0.2, sm: 0.28 },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "11px",
        bgcolor: "rgba(255,255,255,0.01)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.014)",
      }}
    >
      {BRANCH_MODE_OPTIONS.map((item) => (
        <Button
          key={item.key}
          variant={mode === item.key ? "contained" : "text"}
          color={mode === item.key ? "primary" : "inherit"}
          onClick={() => onModeChange(item.key)}
          sx={{
            minWidth: 0,
            minHeight: { xs: 26, sm: 29 },
            borderRadius: { xs: "8px", sm: "8px" },
            px: { xs: 0.2, sm: 1 },
            py: 0,
            fontSize: { xs: "0.72rem", sm: "0.8rem" },
            lineHeight: 1,
            whiteSpace: "nowrap",
            letterSpacing: "0.01em",
            color: mode === item.key ? undefined : "text.secondary",
          }}
        >
          {item.label}
        </Button>
      ))}
    </Box>
  );
}
