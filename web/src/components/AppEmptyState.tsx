import { Box, Stack, Typography, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

export type AppEmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  compact?: boolean;
  className?: string;
  sx?: SxProps<Theme>;
};

export function AppEmptyState({
  title,
  description,
  compact = false,
  className = "",
  sx,
}: AppEmptyStateProps) {
  return (
    <Box
      className={`app-empty-state${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      role="status"
      sx={sx}
    >
      <span className="app-empty-visual" aria-hidden="true">
        <span className="app-empty-line" />
        <span className="app-empty-node is-primary" />
        <span className="app-empty-node is-middle" />
        <span className="app-empty-node is-muted" />
      </span>
      <Stack className="app-empty-copy" spacing={0.35}>
        <Typography className="app-empty-title">{title}</Typography>
        {description ? <Typography className="app-empty-text">{description}</Typography> : null}
      </Stack>
    </Box>
  );
}
