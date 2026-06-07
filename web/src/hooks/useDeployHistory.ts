import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DeployHistoryEntry } from "../app-types";
import type {
  ActivityBulkUpdater,
  ActivityResource,
  ActivityRecorder,
  ActivityStatus,
  ActivityUpdater,
} from "../lib/activityCenter";
import {
  DEPLOY_STATUS_SYNC_MAX_FAILURES,
  stableActivityJson,
} from "../lib/activityCenter";
import type { DeployPlan, DeployRequest } from "./useDeployContext";

const BUILD_STATUS_POLL_DELAY_MS = 3000;
const ACCEPTED_STATUS_POLL_DELAY_MS = 1500;
const BUILD_STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DEPLOY_HISTORY_ITEMS = 20;
const DEPLOY_HISTORY_STATUS_SYNC_LIMIT = 5;

export type BuildResult = {
  plan?: DeployPlan;
  status?: number;
  queueUrl?: string | null;
  buildUrl?: string | null;
  stateKey: string;
  stateLabel: string;
  detail: string;
};

function isActiveBuildState(stateKey?: string | null) {
  return stateKey === "accepted" || stateKey === "queued" || stateKey === "running";
}

function activityStatusFromBuildState(stateKey?: string | null): ActivityStatus {
  if (isActiveBuildState(stateKey)) {
    return "running";
  }
  if (
    stateKey === "failed" ||
    stateKey === "failure" ||
    stateKey === "canceled" ||
    stateKey === "cancelled" ||
    stateKey === "aborted"
  ) {
    return "failed";
  }
  if (stateKey === "success" || stateKey === "succeeded") {
    return "success";
  }
  return "info";
}

function buildResultChanged(current: BuildResult | null, next: BuildResult) {
  if (!current) {
    return true;
  }
  return (
    current.status !== next.status ||
    current.queueUrl !== next.queueUrl ||
    current.buildUrl !== next.buildUrl ||
    current.stateKey !== next.stateKey ||
    current.stateLabel !== next.stateLabel ||
    current.detail !== next.detail
  );
}

function normalizeDeployParams(params?: Record<string, string> | null) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    normalized[key] = value == null ? "" : String(value);
  }
  return normalized;
}

function deployActivityExecutionKey(
  projectKey: string,
  target: string | null | undefined,
  params?: Record<string, string> | null,
) {
  return `deploy:${projectKey}:${target ?? ""}:${stableActivityJson(normalizeDeployParams(params))}`;
}

function buildRecordResource(
  value: Pick<BuildResult, "buildUrl" | "queueUrl">,
): ActivityResource | null {
  const url = value.buildUrl || value.queueUrl;
  return url
    ? {
        kind: "url",
        label: "打开构建记录",
        value: url,
      }
    : null;
}

function buildActivityResourceValues(...values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim() ?? "").filter(Boolean)),
  );
}

function compactSyncError(reason: unknown) {
  const message = String(reason).trim();
  if (!message) {
    return "无法读取 Jenkins 当前状态";
  }
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

function activityProjectNameForRequest(
  plan: DeployPlan | null,
  request: DeployRequest,
  fallbackProjectKey: string,
) {
  return plan?.projectKey === request.project
    ? plan.projectName
    : request.project || fallbackProjectKey;
}

type UseDeployHistoryOptions = {
  enabled: boolean;
  selectedProject: string;
  target: string;
  env: string;
  branch: string;
  currentPlan: DeployPlan | null;
  currentDeployRequest: () => DeployRequest;
  setPlan: (value: DeployPlan | null) => void;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
  syncActivities?: ActivityBulkUpdater;
};

export type DeployReplayOptions = {
  force?: boolean;
  chainId?: string | null;
  parentId?: string | null;
  stepLabel?: string | null;
};

export function useDeployHistory({
  enabled,
  selectedProject,
  target,
  env,
  branch,
  currentPlan,
  currentDeployRequest,
  setPlan,
  setBusy,
  setError,
  recordActivity,
  updateActivity,
  syncActivities,
}: UseDeployHistoryOptions) {
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [buildResultUpdatedAtMs, setBuildResultUpdatedAtMs] = useState(0);
  const [deployHistory, setDeployHistory] = useState<DeployHistoryEntry[]>([]);
  const [currentBuildHistoryKey, setCurrentBuildHistoryKey] = useState("");
  const [buildAutoRefreshStartedAtMs, setBuildAutoRefreshStartedAtMs] = useState<number | null>(
    null,
  );
  const [buildAutoRefreshTimedOut, setBuildAutoRefreshTimedOut] = useState(false);
  const currentBuildActivityIdRef = useRef("");

  const deployViewScopeKey = useMemo(
    () => (selectedProject ? `${selectedProject}:${target}` : ""),
    [selectedProject, target],
  );

  const visibleDeployHistory = useMemo(
    () => deployHistory.slice(0, MAX_DEPLOY_HISTORY_ITEMS),
    [deployHistory],
  );

  function upsertDeployHistoryEntry(entry: DeployHistoryEntry) {
    setDeployHistory((current) => {
      const next = [entry, ...current.filter((item) => item.historyKey !== entry.historyKey)];
      next.sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.createdAt.localeCompare(a.createdAt),
      );
      return next.slice(0, MAX_DEPLOY_HISTORY_ITEMS);
    });
  }

  function syncDeployActivityFromEntry(item: DeployHistoryEntry, result: BuildResult) {
    if (!syncActivities) {
      return;
    }
    const queueUrl = result.queueUrl ?? item.queueUrl ?? null;
    const buildUrl = result.buildUrl ?? item.buildUrl ?? null;
    const resourceValues = buildActivityResourceValues(queueUrl, buildUrl);
    if (resourceValues.length === 0) {
      return;
    }
    syncActivities(
      {
        kind: "deploy",
        projectKey: item.projectKey,
        resourceValues,
      },
      {
        status: activityStatusFromBuildState(result.stateKey),
        summary: `${result.stateLabel} · ${result.detail}`,
        detail: buildUrl || queueUrl || null,
        executionKey: deployActivityExecutionKey(item.projectKey, item.mode, item.params),
        projectKey: item.projectKey,
        projectName: result.plan?.projectName || item.projectName,
        resource: buildRecordResource({ queueUrl, buildUrl }),
      },
    );
  }

  function syncDeployActivityFromHistory(item: DeployHistoryEntry) {
    if (isActiveBuildState(item.stateKey)) {
      return;
    }
    syncDeployActivityFromEntry(item, {
      stateKey: item.stateKey,
      stateLabel: item.stateLabel,
      detail: item.detail,
      queueUrl: item.queueUrl ?? null,
      buildUrl: item.buildUrl ?? null,
    });
  }

  function syncDeployActivityStatusFailure(item: DeployHistoryEntry, reason: unknown) {
    if (!syncActivities) {
      return;
    }
    const resourceValues = buildActivityResourceValues(item.queueUrl, item.buildUrl);
    if (resourceValues.length === 0) {
      return;
    }
    syncActivities(
      {
        kind: "deploy",
        projectKey: item.projectKey,
        resourceValues,
      },
      {
        status: "failed",
        summary: `状态同步失败 · 请手动刷新（1/${DEPLOY_STATUS_SYNC_MAX_FAILURES}）`,
        detail: compactSyncError(reason),
        executionKey: deployActivityExecutionKey(item.projectKey, item.mode, item.params),
        resource: buildRecordResource(item),
        syncFailureCount: 1,
        acknowledgedAt: new Date().toISOString(),
      },
    );
  }

  useEffect(() => {
    if (!enabled) {
      setBuildResult(null);
      setBuildResultUpdatedAtMs(0);
      setCurrentBuildHistoryKey("");
      currentBuildActivityIdRef.current = "";
      setDeployHistory([]);
      setBuildAutoRefreshStartedAtMs(null);
      setBuildAutoRefreshTimedOut(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !selectedProject) {
      return;
    }

    setBuildResult(null);
    setBuildResultUpdatedAtMs(0);
    setCurrentBuildHistoryKey("");
    currentBuildActivityIdRef.current = "";
    setBuildAutoRefreshStartedAtMs(null);
    setBuildAutoRefreshTimedOut(false);
  }, [deployViewScopeKey, enabled, selectedProject]);

  useEffect(() => {
    if (
      !enabled ||
      buildAutoRefreshTimedOut ||
      !buildAutoRefreshStartedAtMs ||
      !buildResult ||
      !isActiveBuildState(buildResult.stateKey) ||
      (!buildResult.queueUrl && !buildResult.buildUrl)
    ) {
      return;
    }

    const remainingMs =
      buildAutoRefreshStartedAtMs + BUILD_STATUS_POLL_TIMEOUT_MS - Date.now();
    if (remainingMs <= 0) {
      setBuildAutoRefreshTimedOut(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setBuildAutoRefreshTimedOut(true);
    }, remainingMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    buildAutoRefreshStartedAtMs,
    buildAutoRefreshTimedOut,
    buildResult?.buildUrl,
    buildResult?.queueUrl,
    buildResult?.stateKey,
    enabled,
  ]);

  useEffect(() => {
    if (!enabled || !buildAutoRefreshTimedOut || !currentBuildActivityIdRef.current) {
      return;
    }
    updateActivity?.(currentBuildActivityIdRef.current, {
      status: "info",
      summary: "部署状态刷新已暂停",
      detail: buildResult?.buildUrl || buildResult?.queueUrl || null,
      resource: buildResult ? buildRecordResource(buildResult) : null,
    });
  }, [
    buildAutoRefreshTimedOut,
    buildResult?.buildUrl,
    buildResult?.queueUrl,
    enabled,
    updateActivity,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !buildResult ||
      !isActiveBuildState(buildResult.stateKey) ||
      (!buildResult.queueUrl && !buildResult.buildUrl) ||
      buildAutoRefreshTimedOut
    ) {
      return;
    }

    const delay =
      buildResult.stateKey === "accepted"
        ? ACCEPTED_STATUS_POLL_DELAY_MS
        : BUILD_STATUS_POLL_DELAY_MS;
    const timer = window.setInterval(() => {
      void refreshCurrentBuildStatus({ silent: true });
    }, delay);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    buildAutoRefreshTimedOut,
    buildResult?.buildUrl,
    buildResult?.queueUrl,
    buildResult?.stateKey,
    enabled,
  ]);

  async function loadDeployHistory() {
    if (!enabled) {
      setDeployHistory([]);
      return;
    }
    try {
      const items = await invoke<DeployHistoryEntry[]>("list_deploy_history");
      setDeployHistory(items);
      for (const item of items.slice(0, MAX_DEPLOY_HISTORY_ITEMS)) {
        syncDeployActivityFromHistory(item);
      }
      void refreshDeployHistoryStatusItems(items, { reportItemFailure: false });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function persistDeployHistory(historyKey: string, result: BuildResult) {
    const plan = result.plan ?? buildResult?.plan ?? currentPlan;
    if (!plan) {
      return;
    }
    const previousEntry = deployHistory.find((item) => item.historyKey === historyKey);
    const entry: DeployHistoryEntry = {
      historyKey,
      projectKey: plan.projectKey,
      projectName: plan.projectName,
      mode: plan.jobKind,
      env: plan.params.ENV_PROFILE ?? plan.params.projectEnv ?? plan.params.env ?? env,
      branch: plan.params.BRANCH ?? plan.params.branch ?? plan.params.Branch ?? branch,
      stateKey: result.stateKey,
      stateLabel: result.stateLabel,
      detail: result.detail,
      queueUrl: result.queueUrl ?? null,
      buildUrl: result.buildUrl ?? null,
      params: plan.params ?? {},
      createdAt: previousEntry?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await invoke("save_deploy_history", { request: entry });
    upsertDeployHistoryEntry(entry);
    syncDeployActivityFromEntry(entry, result);
  }

  async function persistDeployHistoryFromEntry(item: DeployHistoryEntry, result: BuildResult) {
    const entry: DeployHistoryEntry = {
      historyKey: item.historyKey,
      projectKey: item.projectKey,
      projectName: item.projectName,
      mode: item.mode,
      env: item.env,
      branch: item.branch,
      stateKey: result.stateKey,
      stateLabel: result.stateLabel,
      detail: result.detail,
      queueUrl: result.queueUrl ?? item.queueUrl ?? null,
      buildUrl: result.buildUrl ?? item.buildUrl ?? null,
      params: item.params ?? {},
      createdAt: item.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await invoke("save_deploy_history", { request: entry });
    upsertDeployHistoryEntry(entry);
    syncDeployActivityFromEntry(entry, result);
  }

  async function triggerDeployRequest(request: DeployRequest, busyText: string) {
    if (!enabled || !request.project) {
      return;
    }
    setBusy(busyText);
    setError("");
    const activityProjectName =
      activityProjectNameForRequest(currentPlan, request, selectedProject);
    const activityId =
      recordActivity?.({
        kind: "deploy",
        status: "running",
        title: "触发部署",
        summary: `${activityProjectName} · ${request.target || target || "默认目标"}`,
        executionKey: deployActivityExecutionKey(request.project, request.target, request.params),
        projectKey: request.project,
        projectName: activityProjectName,
        target: {
          page: "deploy",
          projectKey: request.project,
        },
      }) || "";
    currentBuildActivityIdRef.current = activityId;
    try {
      const result = await invoke<BuildResult>("trigger_build", {
        request,
      });
      setPlan(result.plan ?? null);
      setBuildResult(result);
      setBuildResultUpdatedAtMs(Date.now());
      setBuildAutoRefreshStartedAtMs(
        isActiveBuildState(result.stateKey) && (result.queueUrl || result.buildUrl)
          ? Date.now()
          : null,
      );
      setBuildAutoRefreshTimedOut(false);
      const historyKey =
        result.queueUrl ??
        result.buildUrl ??
        `${request.project}:${request.target ?? target}:${Date.now()}`;
      setCurrentBuildHistoryKey(historyKey);
      await persistDeployHistory(historyKey, result);
      if (activityId) {
        updateActivity?.(activityId, {
          status: activityStatusFromBuildState(result.stateKey),
          summary: `${result.stateLabel} · ${result.detail}`,
          detail: result.buildUrl || result.queueUrl || null,
          projectName: result.plan?.projectName || activityProjectName,
          resource: buildRecordResource(result),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "部署触发失败",
          detail: String(reason),
        });
      }
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleTriggerBuild() {
    await triggerDeployRequest(currentDeployRequest(), "正在触发部署");
  }

  async function handleReplayDeployHistory(
    item: DeployHistoryEntry,
    options: DeployReplayOptions = {},
  ) {
    if (!enabled && !options.force) {
      return;
    }
    setBusy("正在重播部署");
    setError("");
    const replayTarget = item.mode || null;
    const replayParams = normalizeDeployParams(item.params);
    const activityId =
      recordActivity?.({
        kind: "deploy",
        status: "running",
        title: "重播部署",
        summary: `${item.projectName} · ${replayTarget || "默认目标"}`,
        executionKey: deployActivityExecutionKey(item.projectKey, replayTarget, replayParams),
        chainId: options.chainId ?? null,
        parentId: options.parentId ?? null,
        stepLabel: options.stepLabel ?? "触发部署",
        chainLabel: options.chainId ? "联动链路" : null,
        projectKey: item.projectKey,
        projectName: item.projectName,
        target: {
          page: "deploy",
          projectKey: item.projectKey,
        },
      }) || "";
    currentBuildActivityIdRef.current = activityId;
    try {
      const result = await invoke<BuildResult>("trigger_build", {
        request: {
          project: item.projectKey,
          target: replayTarget,
          params: replayParams,
        },
      });
      setPlan(result.plan ?? null);
      setBuildResult(result);
      setBuildResultUpdatedAtMs(Date.now());
      setBuildAutoRefreshStartedAtMs(
        isActiveBuildState(result.stateKey) && (result.queueUrl || result.buildUrl)
          ? Date.now()
          : null,
      );
      setBuildAutoRefreshTimedOut(false);
      const historyKey =
        result.queueUrl ??
        result.buildUrl ??
        `${item.projectKey}:${item.mode}:${Date.now()}`;
      setCurrentBuildHistoryKey(historyKey);
      await persistDeployHistory(historyKey, result);
      if (activityId) {
        updateActivity?.(activityId, {
          status: activityStatusFromBuildState(result.stateKey),
          summary: `${result.stateLabel} · ${result.detail}`,
          detail: result.buildUrl || result.queueUrl || null,
          chainId: options.chainId ?? undefined,
          parentId: options.parentId ?? undefined,
          stepLabel: options.stepLabel ?? "触发部署",
          chainLabel: options.chainId ? "联动链路" : undefined,
          projectName: result.plan?.projectName || item.projectName,
          resource: buildRecordResource(result),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "部署重播失败",
          detail: String(reason),
        });
      }
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function refreshCurrentBuildStatus({ silent = false }: { silent?: boolean } = {}) {
    if (!enabled) {
      return;
    }
    if (!buildResult?.queueUrl && !buildResult?.buildUrl) {
      return;
    }
    if (!silent) {
      setBusy("正在刷新构建状态");
      setError("");
    }
    try {
      const result = await invoke<BuildResult>("refresh_build_status", {
        request: {
          queueUrl: buildResult.queueUrl,
          buildUrl: buildResult.buildUrl,
        },
      });
      const nextResult = {
        ...result,
        plan: result.plan ?? buildResult.plan ?? currentPlan ?? undefined,
      };
      const changed = buildResultChanged(buildResult, nextResult);
      setBuildResult(nextResult);
      setBuildResultUpdatedAtMs(Date.now());
      const historyKey =
        currentBuildHistoryKey ||
        buildResult.queueUrl ||
        buildResult.buildUrl ||
        `${selectedProject}:${target}:${Date.now()}`;
      setCurrentBuildHistoryKey(historyKey);
      if (changed) {
        await persistDeployHistory(historyKey, nextResult);
      }
      if (changed && currentBuildActivityIdRef.current) {
        updateActivity?.(currentBuildActivityIdRef.current, {
          status: activityStatusFromBuildState(nextResult.stateKey),
          summary: `${nextResult.stateLabel} · ${nextResult.detail}`,
          detail: nextResult.buildUrl || nextResult.queueUrl || null,
          resource: buildRecordResource(nextResult),
        });
      }
    } catch (reason) {
      if (!silent) {
        setError(String(reason));
      }
    } finally {
      if (!silent) {
        setBusy("");
      }
    }
  }

  async function refreshDeployHistoryStatusItems(
    items: DeployHistoryEntry[],
    { reportItemFailure }: { reportItemFailure: boolean },
  ) {
    const activeItems = items
      .filter((item) => isActiveBuildState(item.stateKey))
      .filter((item) => item.queueUrl || item.buildUrl)
      .slice(0, DEPLOY_HISTORY_STATUS_SYNC_LIMIT);

    for (const item of activeItems) {
      try {
        const result = await invoke<BuildResult>("refresh_build_status", {
          request: {
            queueUrl: item.queueUrl,
            buildUrl: item.buildUrl,
          },
        });
        await persistDeployHistoryFromEntry(item, result);
        if (currentBuildHistoryKey === item.historyKey) {
          setBuildResult((current) =>
            current
              ? {
                  ...result,
                  plan: current.plan ?? undefined,
                }
              : current,
          );
          setBuildResultUpdatedAtMs(Date.now());
        }
      } catch (reason) {
        if (reportItemFailure) {
          syncDeployActivityStatusFailure(item, reason);
        }
      }
    }
  }

  async function refreshDeployHistoryStatuses() {
    if (!enabled) {
      setDeployHistory([]);
      return;
    }
    setBusy("正在刷新部署记录");
    setError("");
    try {
      const items = await invoke<DeployHistoryEntry[]>("list_deploy_history");
      setDeployHistory(items);
      await refreshDeployHistoryStatusItems(items, { reportItemFailure: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleClearDeployHistory() {
    if (!enabled) {
      setDeployHistory([]);
      return;
    }
    setBusy("正在清空部署记录");
    setError("");
    try {
      await invoke("clear_deploy_history");
      setDeployHistory([]);
      setBuildResult(null);
      setBuildResultUpdatedAtMs(0);
      setCurrentBuildHistoryKey("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function openBuildUrl(url: string, busyText: string) {
    if (!enabled || !url) {
      return;
    }
    setBusy(busyText);
    setError("");
    try {
      await invoke("open_external_resource", { kind: "url", value: url });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  function syncDeployActivitiesFromHistory() {
    for (const item of deployHistory.slice(0, MAX_DEPLOY_HISTORY_ITEMS)) {
      syncDeployActivityFromHistory(item);
    }
  }

  return {
    buildResult,
    buildResultUpdatedAtMs,
    buildAutoRefreshTimedOut,
    visibleDeployHistory,
    handleTriggerBuild,
    handleTriggerDeployRequest: (request: DeployRequest, busyText = "正在重播部署") =>
      triggerDeployRequest(request, busyText),
    handleRefreshBuild: () => refreshCurrentBuildStatus(),
    handleReplayDeployHistory,
    handleOpenBuildRecord: async () => {
      const url = buildResult?.buildUrl ?? buildResult?.queueUrl;
      if (!url) {
        return;
      }
      await openBuildUrl(url, "正在打开构建记录页");
    },
    handleOpenBuildUrl: (url: string) => openBuildUrl(url, "正在打开部署链接"),
    loadDeployHistory,
    refreshDeployHistoryStatuses,
    syncDeployActivitiesFromHistory,
    handleClearDeployHistory,
  };
}
