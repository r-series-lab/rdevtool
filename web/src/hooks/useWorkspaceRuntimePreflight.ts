import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppMessage,
  ProjectRuntimePreflightCheck,
  ProjectRuntimePreflightResponse,
} from "../app-types";
import { buildProjectRuntimeResolutionArgs } from "../lib/projectRuntimeLaunch";

export type RuntimePreflightPreview = {
  loading: boolean;
  statusKey: string;
  statusLabel: string;
  statusMessage?: AppMessage;
  summary: string;
  summaryMessage?: AppMessage;
  checks: ProjectRuntimePreflightCheck[];
  updatedAtMs: number | null;
};

export function runtimePreflightPreviewLabel(statusKey: string) {
  switch (statusKey.trim().toLowerCase()) {
    case "ok":
      return "可启动";
    case "warning":
      return "需留意";
    case "error":
      return "不可启动";
    case "running":
      return "运行中";
    default:
      return "已检查";
  }
}

export function useWorkspaceRuntimePreflight({
  projectKey,
  debugProfileKey,
  enabled,
  running,
}: {
  projectKey: string;
  debugProfileKey: string;
  enabled: boolean;
  running: boolean;
}) {
  const [preflight, setPreflight] = useState<RuntimePreflightPreview>({
    loading: false,
    statusKey: "",
    statusLabel: "",
    statusMessage: undefined,
    summary: "",
    summaryMessage: undefined,
    checks: [],
    updatedAtMs: null,
  });
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    if (!enabled || running || !projectKey) {
      setPreflight({
        loading: false,
        statusKey: running ? "running" : "",
        statusLabel: running ? "运行中" : "",
        statusMessage: undefined,
        summary: "",
        summaryMessage: undefined,
        checks: [],
        updatedAtMs: null,
      });
      return;
    }

    let cancelled = false;
    setPreflight({
      loading: true,
      statusKey: "",
      statusLabel: "检查中",
      statusMessage: undefined,
      summary: "",
      summaryMessage: undefined,
      checks: [],
      updatedAtMs: null,
    });
    const timer = window.setTimeout(() => {
      void invoke<ProjectRuntimePreflightResponse>(
        "preflight_project_runtime",
        buildProjectRuntimeResolutionArgs({
          project: projectKey,
          debugProfile: debugProfileKey || null,
        }),
      )
        .then((response) => {
          if (cancelled) {
            return;
          }
          setPreflight({
            loading: false,
            statusKey: response.statusKey,
            statusLabel:
              response.statusLabel ||
              runtimePreflightPreviewLabel(response.statusKey),
            statusMessage: response.statusMessage,
            summary: response.summary,
            summaryMessage: response.summaryMessage,
            checks: response.checks,
            updatedAtMs: Date.now(),
          });
        })
        .catch((reason) => {
          if (cancelled) {
            return;
          }
          setPreflight({
            loading: false,
            statusKey: "error",
            statusLabel: "检查失败",
            statusMessage: undefined,
            summary: String(reason),
            summaryMessage: undefined,
            checks: [],
            updatedAtMs: Date.now(),
          });
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [debugProfileKey, enabled, projectKey, refreshRevision, running]);

  const refresh = useCallback(() => {
    if (enabled && !running && projectKey) {
      setPreflight((current) => ({
        ...current,
        loading: true,
        statusLabel: "检查中",
      }));
      setRefreshRevision((current) => current + 1);
    }
  }, [enabled, projectKey, running]);

  return { preflight, refresh };
}
