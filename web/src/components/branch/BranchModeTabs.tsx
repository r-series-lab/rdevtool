import { Box, Button } from "@mui/material";
import type { BranchWorkflowMode } from "../../app-types";

export const BRANCH_MODE_OPTIONS: Array<{
  key: BranchWorkflowMode;
  label: string;
  hint: string;
}> = [
  {
    key: "sync",
    label: "合并",
    hint: "单项目，源分支合并到多个目标分支",
  },
  {
    key: "create",
    label: "创建",
    hint: "",
  },
  {
    key: "push",
    label: "推送",
    hint: "检查当前工作区状态，并执行推送或提交后推送",
  },
  {
    key: "switch",
    label: "工作区",
    hint: "切换绑定目录，或克隆分支到目标目录",
  },
];

export function branchWorkflowModeLabel(mode: BranchWorkflowMode) {
  if (mode === "checkout") {
    return "克隆";
  }
  if (mode === "switch") {
    return "工作区";
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
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: { xs: 0.24, sm: 0.35 },
        p: { xs: 0.24, sm: 0.35 },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "14px",
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
            minHeight: { xs: 28, sm: 32 },
            borderRadius: { xs: "9px", sm: "10px" },
            px: { xs: 0.2, sm: 1 },
            py: 0,
            fontSize: { xs: "0.72rem", sm: "0.84rem" },
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
