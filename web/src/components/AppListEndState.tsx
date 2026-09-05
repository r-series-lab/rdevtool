import { Box, Typography } from "@mui/material";
import { useI18n } from "../i18n";

export type AppListEndStateProps = {
  label?: string;
  className?: string;
};

export function AppListEndState({
  label,
  className = "",
}: AppListEndStateProps) {
  const { t } = useI18n();
  const resolvedLabel = t(label ?? "没有更多了");

  return (
    <Box
      className={`app-list-end-state${className ? ` ${className}` : ""}`}
      role="status"
      aria-label={resolvedLabel}
    >
      <span className="app-list-end-visual" aria-hidden="true">
        <span className="app-list-end-spark is-left" />
        <span className="app-list-end-box" />
        <span className="app-list-end-spark is-right" />
      </span>
      <Typography variant="caption" className="app-list-end-text">
        <span>{resolvedLabel}</span>
      </Typography>
    </Box>
  );
}
