import { Box, Stack, Typography, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";
import { translateNode, useI18n } from "../i18n";

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
  const { t } = useI18n();

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
        <Typography className="app-empty-title">{translateNode(title, t)}</Typography>
        {description ? (
          <Typography className="app-empty-text">
            {translateNode(description, t)}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
