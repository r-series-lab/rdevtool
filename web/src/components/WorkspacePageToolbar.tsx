import type { ReactNode } from "react";
import {
  Box,
  Button,
  type ButtonProps,
} from "@mui/material";
import { useI18n } from "../i18n";

export type WorkspacePageMetricTone =
  | "blue"
  | "green"
  | "violet"
  | "cyan"
  | "neutral";

export type WorkspacePageMetric = {
  key: string;
  label: string;
  value: number | string;
  title?: string;
  icon?: ReactNode;
  tone?: WorkspacePageMetricTone;
};

type WorkspacePageToolbarProps = {
  metrics: WorkspacePageMetric[];
  actions?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function WorkspacePageToolbar({
  metrics,
  actions,
  className = "",
  ariaLabel = "页面概览与操作",
}: WorkspacePageToolbarProps) {
  const { t } = useI18n();

  return (
    <Box
      className={`workspace-page-toolbar${className ? ` ${className}` : ""}`}
      aria-label={t(ariaLabel)}
    >
      <Box className="workspace-page-toolbar-content">
        <Box className="workspace-page-toolbar-metrics">
          {metrics.map((metric) => (
            <Box
              key={metric.key}
              className={`workspace-page-toolbar-metric workspace-page-toolbar-metric--${metric.tone ?? "neutral"}`}
              title={metric.title ? t(metric.title) : undefined}
            >
              <Box
                component="span"
                className="workspace-page-toolbar-metric-icon"
                aria-hidden="true"
              >
                {metric.icon ?? (
                  <Box
                    component="span"
                    className="workspace-page-toolbar-metric-dot"
                  />
                )}
              </Box>
              <Box component="span" className="workspace-page-toolbar-metric-label">
                {t(metric.label)}
              </Box>
              <Box component="span" className="workspace-page-toolbar-metric-value">
                {metric.value}
              </Box>
            </Box>
          ))}
        </Box>
        {actions ? (
          <Box className="workspace-page-toolbar-actions">{actions}</Box>
        ) : null}
      </Box>
    </Box>
  );
}

export function WorkspacePageToolbarAction({
  className = "",
  ...props
}: ButtonProps) {
  return (
    <Button
      {...props}
      className={`workspace-page-toolbar-action${className ? ` ${className}` : ""}`}
      size="small"
      variant="outlined"
      color="inherit"
    />
  );
}
