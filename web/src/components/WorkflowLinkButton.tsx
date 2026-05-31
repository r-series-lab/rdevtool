import { Badge, IconButton } from "@mui/material";
import { WorkflowIcon } from "./AppIcons";

type WorkflowLinkButtonProps = {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
};

export function WorkflowLinkButton({
  active,
  onClick,
  disabled = false,
  title = "配置联动",
}: WorkflowLinkButtonProps) {
  return (
    <IconButton
      size="small"
      color={active ? "primary" : "inherit"}
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      title={title}
    >
      <WorkflowIcon fontSize="small" />
    </IconButton>
  );
}

export function WorkflowLinkSummaryButton({
  count,
  onClick,
  title = "联动清单",
}: {
  count: number;
  onClick: () => void;
  title?: string;
}) {
  if (count <= 0) {
    return null;
  }

  return (
    <IconButton
      size="small"
      color="primary"
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <Badge badgeContent={count} color="primary" max={99}>
        <WorkflowIcon fontSize="small" />
      </Badge>
    </IconButton>
  );
}
