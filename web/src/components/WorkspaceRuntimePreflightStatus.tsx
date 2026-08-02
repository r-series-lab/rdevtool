import { useMemo, useState, type MouseEvent } from "react";
import {
  CircularProgress,
  IconButton,
  Popover,
  Tooltip,
} from "@mui/material";
import type { ProjectRuntimePreflightCheck } from "../app-types";
import {
  runtimePreflightPreviewLabel,
  type RuntimePreflightPreview,
} from "../hooks/useWorkspaceRuntimePreflight";
import {
  workspaceRuntimePreflightAction,
  type WorkspaceRuntimePreflightAction,
} from "../lib/workspaceRuntimePreflightActions";
import { OpenExternalIcon, PlayIcon, RefreshIcon } from "./AppIcons";
import { useI18n } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

export type WorkspaceRuntimePreflightStatusProps = {
  projectName: string;
  preflight: RuntimePreflightPreview;
  onRefresh: () => void;
  onAction: (
    action: WorkspaceRuntimePreflightAction,
  ) => Promise<void> | void;
};

function preflightCheckPriority(check: ProjectRuntimePreflightCheck) {
  switch (check.statusKey) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "ok":
      return 2;
    default:
      return 3;
  }
}

export function WorkspaceRuntimePreflightStatus({
  projectName,
  preflight,
  onRefresh,
  onAction,
}: WorkspaceRuntimePreflightStatusProps) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const checks = useMemo(
    () =>
      [...preflight.checks].sort(
        (left, right) =>
          preflightCheckPriority(left) - preflightCheckPriority(right),
      ),
    [preflight.checks],
  );
  const label = preflight.loading
    ? t("检查中")
    : translateInternalMessage(runtimePreflightPreviewLabel(preflight.statusKey), t);
  const tone = preflight.loading
    ? "loading"
    : preflight.statusKey.trim().toLowerCase() || "info";

  function openDetails(event: MouseEvent<HTMLElement>) {
    setAnchor(event.currentTarget);
  }

  return (
    <>
      <Tooltip
        title={translateInternalMessage(
          preflight.summary || preflight.statusLabel,
          t,
        )}
      >
        <button
          type="button"
          className={`overview-runtime-preflight-tag is-${tone}`}
          onClick={openDetails}
          aria-label={t("{name} 启动预检：{label}", {
            name: projectName,
            label,
          })}
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchor)}
        >
          {preflight.loading ? (
            <CircularProgress size={8} thickness={6} />
          ) : null}
          {label}
        </button>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            className: "overview-runtime-preflight-paper",
          },
        }}
      >
        <div
          className="overview-runtime-preflight-popover"
          role="dialog"
          aria-label={t("{name} 启动预检详情", { name: projectName })}
        >
          <header className="overview-runtime-preflight-heading">
            <span>
              <strong>{t("启动预检")}</strong>
              <small>{projectName}</small>
            </span>
            <Tooltip title={t("重新检查")}>
              <IconButton
                size="small"
                onClick={onRefresh}
                disabled={preflight.loading}
                aria-label={t("刷新 {name} 启动预检", {
                  name: projectName,
                })}
              >
                {preflight.loading ? (
                  <CircularProgress size={13} thickness={5} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </header>
          <div className="overview-runtime-preflight-summary">
            <span className={`is-${tone}`}>{label}</span>
            <p>
              {translateInternalMessage(
                preflight.summary || preflight.statusLabel,
                t,
              )}
            </p>
          </div>
          <div className="overview-runtime-preflight-checks">
            {checks.map((check) => {
              const action = workspaceRuntimePreflightAction(check);
              return (
                <div
                  key={check.key}
                  className={`overview-runtime-preflight-check is-${check.statusKey}`}
                >
                  <i aria-hidden="true" />
                  <span>
                    <strong>{translateInternalMessage(check.title, t)}</strong>
                    <small>
                      {translateInternalMessage(
                        check.detail || check.statusLabel,
                        t,
                      )}
                    </small>
                    {check.action ? (
                      <em>{translateInternalMessage(check.action, t)}</em>
                    ) : null}
                    {action ? (
                      <button
                        type="button"
                        className={`overview-runtime-preflight-check-action${
                          action.target === "quickFix"
                            ? " is-quick-fix"
                            : ""
                        }`}
                        onClick={() => {
                          setAnchor(null);
                          void onAction(action);
                        }}
                      >
                        {action.target === "quickFix" ? (
                          <PlayIcon fontSize="inherit" />
                        ) : (
                          <OpenExternalIcon fontSize="inherit" />
                        )}
                        {translateInternalMessage(action.label, t)}
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Popover>
    </>
  );
}
