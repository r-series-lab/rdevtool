import { Box, Typography } from "@mui/material";

export type AppListEndStateProps = {
  label?: string;
  className?: string;
};

export function AppListEndState({
  label = "没有更多了",
  className = "",
}: AppListEndStateProps) {
  return (
    <Box
      className={`app-list-end-state${className ? ` ${className}` : ""}`}
      role="status"
      aria-label={label}
    >
      <span className="app-list-end-visual" aria-hidden="true">
        <span className="app-list-end-spark is-left" />
        <span className="app-list-end-box" />
        <span className="app-list-end-spark is-right" />
      </span>
      <Typography variant="caption" className="app-list-end-text">
        <span>{label}</span>
      </Typography>
    </Box>
  );
}
