import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type {
  BranchTaskItemResult,
  BranchTaskResponse,
} from "../../app-types";
import {
  CollapseIcon,
  ExpandIcon,
  OpenExternalIcon,
} from "../AppIcons";

type BranchTaskItemCardProps = {
  item: BranchTaskItemResult;
  onOpenTaskOutput: (path: string) => void;
};

function BranchTaskItemCard({
  item,
  onOpenTaskOutput,
}: BranchTaskItemCardProps) {
  const targetText = item.targetBranch || item.outputPath || "-";
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: item.success ? "divider" : "warning.main",
        borderRadius: "16px",
        p: 1,
        bgcolor: "rgba(255,255,255,0.012)",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      <Stack spacing={0.7} minWidth={0}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={1}
          minWidth={0}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }} noWrap>
              {item.projectName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.sourceBranch} → {targetText}
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={0.6}
            alignItems="center"
            sx={{ flexShrink: 0 }}
          >
            <Chip
              size="small"
              label={item.statusLabel}
              color={item.success ? "primary" : "warning"}
              variant={item.success ? "filled" : "outlined"}
            />
            {item.outputPath && item.success ? (
              <IconButton
                size="small"
                onClick={() => onOpenTaskOutput(item.outputPath ?? "")}
                aria-label="打开目录"
                title="打开目录"
              >
                <OpenExternalIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Stack>
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ overflowWrap: "anywhere" }}
        >
          {item.summary}
        </Typography>
        {item.commit ? (
          <Stack direction="row" spacing={0.7} flexWrap="wrap" minWidth={0}>
            <Chip
              size="small"
              label={item.commit.shortHash}
              variant="outlined"
              sx={{ maxWidth: "100%" }}
            />
            <Chip
              size="small"
              label={item.commit.subject}
              variant="outlined"
              sx={{ maxWidth: "100%" }}
            />
          </Stack>
        ) : null}
        {item.detail ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {item.detail}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

type BranchTaskResultPanelProps = {
  expanded: boolean;
  result: BranchTaskResponse | null;
  onToggleExpanded: () => void;
  onOpenTaskOutput: (path: string) => void;
};

export function BranchTaskResultPanel({
  expanded,
  result,
  onToggleExpanded,
  onOpenTaskOutput,
}: BranchTaskResultPanelProps) {
  if (!result) {
    return null;
  }

  return (
    <Box className="workflow-panel workflow-result-panel">
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
          <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 800 }}>
            结果
          </Typography>
          <Stack
            direction="row"
            spacing={0.7}
            alignItems="center"
            flexWrap="wrap"
            rowGap={0.5}
            justifyContent="flex-end"
          >
            {result ? (
              <Chip
                label={result.summary}
                color={result.success ? "primary" : "warning"}
                sx={{ maxWidth: { xs: 180, sm: 260 } }}
              />
            ) : null}
            <IconButton
              size="small"
              onClick={onToggleExpanded}
              aria-label={expanded ? "收起任务结果" : "展开任务结果"}
              title={expanded ? "收起任务结果" : "展开任务结果"}
            >
              {expanded ? (
                <CollapseIcon fontSize="small" />
              ) : (
                <ExpandIcon fontSize="small" />
              )}
            </IconButton>
          </Stack>
        </Stack>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Stack spacing={0.8} minWidth={0}>
            {result.items.map((item, index) => (
              <BranchTaskItemCard
                key={`${item.projectKey}-${item.targetBranch ?? item.outputPath ?? index}`}
                item={item}
                onOpenTaskOutput={onOpenTaskOutput}
              />
            ))}
          </Stack>
        </Collapse>
    </Box>
  );
}
