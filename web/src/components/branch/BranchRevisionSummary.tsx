import { Stack, Typography } from "@mui/material";
import type { CommitInfo } from "../../app-types";
import { useI18n } from "../../i18n";
import { ClockIcon, WorkflowIcon } from "../AppIcons";

export function BranchRevisionSummary({
  label,
  branch = "",
  commit = null,
  updatedAt = "",
  context = "",
}: {
  label: string;
  branch?: string;
  commit?: CommitInfo | null;
  updatedAt?: string;
  context?: string;
}) {
  const { t } = useI18n();
  const timestamp = commit?.committedAt || updatedAt;
  const revisionDetails = [
    commit?.subject,
    timestamp
      ? commit
        ? t("提交于 {time}", { time: timestamp })
        : t("最近活动于 {time}", { time: timestamp })
      : "",
  ].filter(Boolean);
  const branchDetails = [context, label, branch].filter(Boolean);
  const rowSx = {
    minWidth: 0,
    color: "text.secondary",
    fontSize: "0.72rem",
    fontWeight: 560,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  } as const;
  const iconSx = {
    mt: "1px",
    color: "var(--activity-running)",
    fontSize: 15.5,
    flexShrink: 0,
  } as const;

  return (
    <Stack
      spacing={0.38}
      minWidth={0}
      data-branch-revision-summary="visible"
      sx={{ px: 0.1 }}
    >
      <Stack
        direction="row"
        spacing={0.65}
        alignItems="flex-start"
        minWidth={0}
        data-branch-revision-row="branch"
      >
        <WorkflowIcon sx={iconSx} />
        <Typography variant="caption" sx={rowSx}>
          {branchDetails.join(" · ")}
        </Typography>
      </Stack>
      {revisionDetails.length > 0 ? (
        <Stack
          direction="row"
          spacing={0.65}
          alignItems="flex-start"
          minWidth={0}
          data-branch-revision-row="revision"
        >
          <ClockIcon sx={iconSx} />
          <Typography variant="caption" sx={rowSx}>
            {revisionDetails.join(" · ")}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
