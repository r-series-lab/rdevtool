import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BuildHistoryEntry } from "../app-types";
import type {
  ActivityBulkUpdater,
  ActivityResource,
  ActivityRecorder,
  ActivityStatus,
  ActivityUpdater,
} from "../lib/activityCenter";
import {
  BUILD_STATUS_SYNC_MAX_FAILURES,
  stableActivityJson,
} from "../lib/activityCenter";
import {
  buildRecoveryAction,
  buildRecoveryActionForRequest,
  buildActivityParameters,
  type BuildActivityParameterMeta,
} from "../lib/historyActivities";
import {
  createClientOperationId,
  isOperationActiveState,
  OPERATION_SUBMITTING_STATE,
} from "../lib/operationLifecycle";
import {
  isConfigReadyBuildHistoryEntry,
  normalizeBuildHistoryRecords,
} from "../lib/buildHistoryRecords";
import type { BuildPlan, BuildRequest } from "./useBuildContext";

const BUILD_STATUS_POLL_DELAY_MS = 3000;
const ACCEPTED_STATUS_POLL_DELAY_MS = 1500;
const BUILD_STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUILD_HISTORY_ITEMS = 20;
const BUILD_HISTORY_STATUS_SYNC_LIMIT = 5;
const BUILD_HISTORY_COMMANDS = {
  list: "list_build_history",
  save: "save_build_history",
  clear: "clear_build_history",
} as const;

export type BuildResult = {
  plan?: BuildPlan;
  status?: number;
  queueUrl?: string | null;
  buildUrl?: string | null;
  stateKey: string;
  stateLabel: string;
  detail: string;
};

type BuildActionCopy = {
  noun: string;
  triggerTitle: string;
  replayTitle: string;
  triggerBusy: string;
  replayBusy: string;
  triggerFailed: string;
  replayFailed: string;
};

function buildActionCopy(actionKind?: string | null): BuildActionCopy {
  const noun =
    actionKind === "deploy"
      ? "部署"
      : actionKind === "package"
        ? "产物构建"
        : actionKind === "release"
          ? "发布"
          : "构建";
  return {
    noun,
    triggerTitle: `触发${noun}`,
    replayTitle: `重播${noun}`,
    triggerBusy: `正在触发${noun}`,
    replayBusy: `正在重播${noun}`,
    triggerFailed: `${noun}触发失败`,
    replayFailed: `${noun}重播失败`,
  };
}

function actionCopyForPlan(plan?: BuildPlan | null) {
  return buildActionCopy(plan?.actionKind);
}

function actionCopyForHistoryItem(plan: BuildPlan | null, item: BuildHistoryEntry) {
  if (plan?.projectKey === item.projectKey && plan.jobKind === item.mode) {
    return buildActionCopy(plan.actionKind);
  }
  const mode = item.mode.trim().toLowerCase();
  if (mode === "package" || mode === "release") {
    return buildActionCopy(mode);
  }
  return buildActionCopy();
}

function isLocalBuildResult(result?: Pick<BuildResult, "plan"> | null) {
  return Boolean(result?.plan && result.plan.adapter !== "jenkins");
}

function canRefreshBuildResult(result?: BuildResult | null) {
  if (!result) {
    return false;
  }
  return Boolean(
    result.queueUrl ||
      result.buildUrl ||
      (isLocalBuildResult(result) && result.plan?.projectKey),
  );
}

function activityStatusFromBuildState(stateKey?: string | null): ActivityStatus {
  if (isOperationActiveState(stateKey)) {
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

function activityStatusFromBuildResult(
  stateKey?: string | null,
  links?: Pick<BuildResult, "buildUrl" | "queueUrl">,
): ActivityStatus {
  if (
    (stateKey === "canceled" || stateKey === "cancelled") &&
    !links?.queueUrl &&
    !links?.buildUrl
  ) {
    return "info";
  }
  return activityStatusFromBuildState(stateKey);
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

function normalizeBuildParams(params?: Record<string, string> | null) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    normalized[key] = value == null ? "" : String(value);
  }
  return normalized;
}

function buildActivityExecutionKey(
  projectKey: string,
  target: string | null | undefined,
  params?: Record<string, string> | null,
) {
  return `build:${projectKey}:${target ?? ""}:${stableActivityJson(normalizeBuildParams(params))}`;
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
  plan: BuildPlan | null,
  request: BuildRequest,
  fallbackProjectKey: string,
) {
  return plan?.projectKey === request.project
    ? plan.projectName
    : request.project || fallbackProjectKey;
}

type OptimisticBuildHistoryInput = {
  operationId: string;
  workspaceKey: string;
  request: BuildRequest;
  plan: BuildPlan | null;
  projectName: string;
  fallbackTarget: string;
  fallbackEnv: string;
  fallbackBranch: string;
  detail: string;
};

export function createOptimisticBuildHistoryEntry({
  operationId,
  workspaceKey,
  request,
  plan,
  projectName,
  fallbackTarget,
  fallbackEnv,
  fallbackBranch,
  detail,
}: OptimisticBuildHistoryInput): BuildHistoryEntry {
  const matchingPlan = plan?.projectKey === request.project ? plan : null;
  const params = normalizeBuildParams(request.params);
  const createdAt = new Date().toISOString();
  return {
    historyKey: operationId,
    workspaceKey,
    projectInstancePath: null,
    projectKey: request.project,
    projectName,
    mode: request.target || matchingPlan?.jobKind || fallbackTarget,
    env:
      params.ENV_PROFILE ??
      params.projectEnv ??
      params.env ??
      request.env ??
      fallbackEnv,
    branch:
      params.BRANCH ??
      params.branch ??
      params.Branch ??
      request.branch ??
      fallbackBranch,
    stateKey: OPERATION_SUBMITTING_STATE,
    stateLabel: "正在提交",
    detail,
    queueUrl: null,
    buildUrl: null,
    params,
    createdAt,
    updatedAt: createdAt,
  };
}

type UseBuildHistoryOptions = {
  enabled: boolean;
  activeProjectWorkspaceKey: string;
  selectedProject: string;
  target: string;
  env: string;
  branch: string;
  buildParamMeta?: BuildActivityParameterMeta[];
  currentPlan: BuildPlan | null;
  currentBuildRequest: () => BuildRequest;
  setPlan: (value: BuildPlan | null) => void;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
  syncActivities?: ActivityBulkUpdater;
};

export type BuildReplayOptions = {
  force?: boolean;
  origin?: "app" | "tray";
  workspaceKey?: string | null;
  chainId?: string | null;
  parentId?: string | null;
  stepLabel?: string | null;
};

export function resolveBuildExecutionWorkspaceKey(
  activeWorkspaceKey: string,
  requestedWorkspaceKey?: string | null,
  recordedWorkspaceKey?: string | null,
) {
  return (
    requestedWorkspaceKey?.trim() ||
    recordedWorkspaceKey?.trim() ||
    activeWorkspaceKey.trim()
  );
}

export function resolveBuildHistoryKey({
  currentHistoryKey,
  queueUrl,
  buildUrl,
  activityId,
  workspaceKey,
  projectKey,
  target,
}: {
  currentHistoryKey?: string | null;
  queueUrl?: string | null;
  buildUrl?: string | null;
  activityId?: string | null;
  workspaceKey: string;
  projectKey: string;
  target?: string | null;
}) {
  const existingKey = [
    currentHistoryKey,
    queueUrl,
    buildUrl,
    activityId,
  ].find((value) => value?.trim());
  if (existingKey) {
    return existingKey.trim();
  }
  return [
    "runtime-build",
    workspaceKey.trim() || "workspace",
    projectKey.trim() || "project",
    target?.trim() || "default",
  ].join(":");
}

export function useBuildHistoryState({
  enabled,
  activeProjectWorkspaceKey,
  selectedProject,
  target,
  env,
  branch,
  buildParamMeta = [],
  currentPlan,
  currentBuildRequest,
  setPlan,
  setBusy,
  setError,
  recordActivity,
  updateActivity,
  syncActivities,
}: UseBuildHistoryOptions) {
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [buildResultUpdatedAtMs, setBuildResultUpdatedAtMs] = useState(0);
  const [buildHistory, setBuildHistory] = useState<BuildHistoryEntry[]>([]);
  const [currentBuildHistoryKey, setCurrentBuildHistoryKey] = useState("");
  const [buildAutoRefreshStartedAtMs, setBuildAutoRefreshStartedAtMs] = useState<number | null>(
    null,
  );
  const [buildAutoRefreshTimedOut, setBuildAutoRefreshTimedOut] = useState(false);
  const currentBuildActivityIdRef = useRef("");
  const buildRefreshInFlightRef = useRef(false);
  const buildRefreshRequestIdRef = useRef(0);
  const buildRefreshScopeRef = useRef("");

  const buildViewScopeKey = useMemo(
    () =>
      selectedProject
        ? `${activeProjectWorkspaceKey}:${selectedProject}:${target}`
        : activeProjectWorkspaceKey,
    [activeProjectWorkspaceKey, selectedProject, target],
  );

  const visibleBuildHistory = useMemo(
    () => buildHistory.slice(0, MAX_BUILD_HISTORY_ITEMS),
    [buildHistory],
  );

  useEffect(() => {
    buildRefreshScopeRef.current = `${enabled}:${buildViewScopeKey}`;
    buildRefreshRequestIdRef.current += 1;
    buildRefreshInFlightRef.current = false;
  }, [buildViewScopeKey, enabled]);

  function upsertBuildHistoryEntry(entry: BuildHistoryEntry) {
    setBuildHistory((current) => {
      const next = [entry, ...current.filter((item) => item.historyKey !== entry.historyKey)];
      next.sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.createdAt.localeCompare(a.createdAt),
      );
      return next.slice(0, MAX_BUILD_HISTORY_ITEMS);
    });
  }

  function activityParametersForBuild(
    projectKey: string,
    mode: string | null | undefined,
    params?: Record<string, string> | null,
  ) {
    const normalizedParams = normalizeBuildParams(params);
    const parameterMeta =
      projectKey === selectedProject && (mode ?? "") === target
        ? buildParamMeta
        : [];
    return buildActivityParameters({
      mode: mode ?? "",
      env:
        normalizedParams.ENV_PROFILE ??
        normalizedParams.projectEnv ??
        normalizedParams.env ??
        "",
      branch:
        normalizedParams.BRANCH ??
        normalizedParams.branch ??
        normalizedParams.Branch ??
        "",
      params: normalizedParams,
    }, parameterMeta);
  }

  function syncBuildActivityFromEntry(item: BuildHistoryEntry, result: BuildResult) {
    if (!syncActivities) {
      return;
    }
    const queueUrl = result.queueUrl ?? item.queueUrl ?? null;
    const buildUrl = result.buildUrl ?? item.buildUrl ?? null;
    const resourceValues = buildActivityResourceValues(queueUrl, buildUrl);
    const executionKey = buildActivityExecutionKey(item.projectKey, item.mode, item.params);
    syncActivities(
      {
        kind: "build",
        projectKey: item.projectKey,
        ...(resourceValues.length > 0 ? { resourceValues } : { executionKey }),
      },
      {
        status: activityStatusFromBuildResult(result.stateKey, { queueUrl, buildUrl }),
        summary: `${result.stateLabel} · ${result.detail}`,
        detail: buildUrl || queueUrl || null,
        executionKey,
        projectKey: item.projectKey,
        projectName: result.plan?.projectName || item.projectName,
        parameters: activityParametersForBuild(item.projectKey, item.mode, item.params),
        resource: buildRecordResource({ queueUrl, buildUrl }),
        action: buildRecoveryAction({
          ...item,
          stateKey: result.stateKey,
          stateLabel: result.stateLabel,
          detail: result.detail,
          queueUrl,
          buildUrl,
        }),
      },
    );
  }

  function syncBuildActivityFromHistory(item: BuildHistoryEntry) {
    if (isOperationActiveState(item.stateKey)) {
      return;
    }
    syncBuildActivityFromEntry(item, {
      stateKey: item.stateKey,
      stateLabel: item.stateLabel,
      detail: item.detail,
      queueUrl: item.queueUrl ?? null,
      buildUrl: item.buildUrl ?? null,
    });
  }

  function syncBuildActivityStatusFailure(item: BuildHistoryEntry, reason: unknown) {
    if (!syncActivities) {
      return;
    }
    const resourceValues = buildActivityResourceValues(item.queueUrl, item.buildUrl);
    const executionKey = buildActivityExecutionKey(item.projectKey, item.mode, item.params);
    syncActivities(
      {
        kind: "build",
        projectKey: item.projectKey,
        ...(resourceValues.length > 0 ? { resourceValues } : { executionKey }),
      },
      {
        status: "failed",
        summary: `状态同步失败 · 请手动刷新（1/${BUILD_STATUS_SYNC_MAX_FAILURES}）`,
        detail: compactSyncError(reason),
        executionKey,
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
      setBuildHistory([]);
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
  }, [buildViewScopeKey, enabled, selectedProject]);

  useEffect(() => {
    if (
      !enabled ||
      buildAutoRefreshTimedOut ||
      !buildAutoRefreshStartedAtMs ||
      !buildResult ||
      !isOperationActiveState(buildResult.stateKey) ||
      !canRefreshBuildResult(buildResult)
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
    buildResult?.plan?.adapter,
    buildResult?.plan?.projectKey,
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
      summary: `${actionCopyForPlan(buildResult?.plan ?? currentPlan).noun}状态刷新已暂停`,
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
      !isOperationActiveState(buildResult.stateKey) ||
      !canRefreshBuildResult(buildResult) ||
      buildAutoRefreshTimedOut
    ) {
      return;
    }

    const delay =
      buildResult.stateKey === "accepted"
        ? ACCEPTED_STATUS_POLL_DELAY_MS
        : BUILD_STATUS_POLL_DELAY_MS;
    const timer = window.setTimeout(() => {
      void refreshCurrentBuildStatus({ silent: true });
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    buildAutoRefreshTimedOut,
    buildResult?.buildUrl,
    buildResult?.detail,
    buildResult?.plan?.adapter,
    buildResult?.plan?.projectKey,
    buildResult?.queueUrl,
    buildResult?.stateKey,
    buildResultUpdatedAtMs,
    currentBuildHistoryKey,
    enabled,
  ]);

  async function loadBuildHistory() {
    if (!enabled) {
      setBuildHistory([]);
      return;
    }
    try {
      const items = normalizeBuildHistoryRecords(
        await invoke<BuildHistoryEntry[]>(BUILD_HISTORY_COMMANDS.list),
      );
      setBuildHistory(items);
      for (const item of items.slice(0, MAX_BUILD_HISTORY_ITEMS)) {
        syncBuildActivityFromHistory(item);
      }
      void refreshBuildHistoryStatusItems(items, { reportItemFailure: false });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function persistBuildHistory(
    historyKey: string,
    result: BuildResult,
    workspaceKey = activeProjectWorkspaceKey,
  ) {
    const plan = result.plan ?? buildResult?.plan ?? currentPlan;
    if (!plan || isConfigReadyBuildHistoryEntry(result)) {
      return;
    }
    const previousEntry = buildHistory.find((item) => item.historyKey === historyKey);
    const entry: BuildHistoryEntry = {
      historyKey,
      workspaceKey,
      projectInstancePath: previousEntry?.projectInstancePath ?? null,
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
    await invoke(BUILD_HISTORY_COMMANDS.save, { request: entry });
    upsertBuildHistoryEntry(entry);
    syncBuildActivityFromEntry(entry, result);
  }

  async function persistBuildHistoryFromEntry(item: BuildHistoryEntry, result: BuildResult) {
    if (isConfigReadyBuildHistoryEntry(result)) {
      return;
    }
    const resultPlan = result.plan ?? null;
    const params = normalizeBuildParams(resultPlan?.params ?? item.params);
    const entry: BuildHistoryEntry = {
      historyKey: item.historyKey,
      workspaceKey: item.workspaceKey ?? activeProjectWorkspaceKey,
      projectInstancePath: item.projectInstancePath ?? null,
      projectKey: resultPlan?.projectKey || item.projectKey,
      projectName: resultPlan?.projectName || item.projectName,
      mode: resultPlan?.jobKind || item.mode,
      env:
        params.ENV_PROFILE ??
        params.projectEnv ??
        params.env ??
        item.env,
      branch:
        params.BRANCH ??
        params.branch ??
        params.Branch ??
        item.branch,
      stateKey: result.stateKey,
      stateLabel: result.stateLabel,
      detail: result.detail,
      queueUrl: result.queueUrl ?? item.queueUrl ?? null,
      buildUrl: result.buildUrl ?? item.buildUrl ?? null,
      params,
      createdAt: item.createdAt,
      updatedAt: new Date().toISOString(),
    };
    upsertBuildHistoryEntry(entry);
    syncBuildActivityFromEntry(entry, result);
    await invoke(BUILD_HISTORY_COMMANDS.save, { request: entry });
  }

  async function triggerBuildRequest(
    request: BuildRequest,
    busyText: string,
    options: BuildReplayOptions = {},
  ) {
    if ((!enabled && !options.force) || !request.project) {
      return false;
    }
    const actionCopy = actionCopyForPlan(currentPlan);
    const executionWorkspaceKey = resolveBuildExecutionWorkspaceKey(
      activeProjectWorkspaceKey,
      options.workspaceKey,
    );
    setBusy(busyText);
    setError("");
    const activityProjectName =
      activityProjectNameForRequest(currentPlan, request, selectedProject);
    const activityId = createClientOperationId("build");
    const optimisticPlan =
      currentPlan?.projectKey === request.project ? currentPlan : null;
    const optimisticDetail = `${actionCopy.noun}请求已接收，正在创建任务`;
    const optimisticResult: BuildResult = {
      plan: optimisticPlan ?? undefined,
      stateKey: OPERATION_SUBMITTING_STATE,
      stateLabel: "正在提交",
      detail: optimisticDetail,
      queueUrl: null,
      buildUrl: null,
    };
    const optimisticEntry = createOptimisticBuildHistoryEntry({
      operationId: activityId,
      workspaceKey: executionWorkspaceKey,
      request,
      plan: optimisticPlan,
      projectName: activityProjectName,
      fallbackTarget: target,
      fallbackEnv: env,
      fallbackBranch: branch,
      detail: optimisticDetail,
    });
    recordActivity?.({
      id: activityId,
      kind: "build",
      status: "running",
      title: actionCopy.triggerTitle,
      summary: `${activityProjectName} · ${request.target || target || "默认目标"}`,
      executionKey: buildActivityExecutionKey(request.project, request.target, request.params),
      projectKey: request.project,
      projectName: activityProjectName,
      parameters: activityParametersForBuild(
        request.project,
        request.target,
        request.params,
      ),
      target: {
        page: "build",
        projectKey: request.project,
      },
    });
    currentBuildActivityIdRef.current = activityId;
    setBuildResult(optimisticResult);
    setBuildResultUpdatedAtMs(Date.now());
    setCurrentBuildHistoryKey(activityId);
    setBuildAutoRefreshStartedAtMs(null);
    setBuildAutoRefreshTimedOut(false);
    upsertBuildHistoryEntry(optimisticEntry);
    try {
      const result = await invoke<BuildResult>("trigger_build", {
        request,
        activityId: activityId || null,
        operationOrigin: options.origin ?? "app",
        activityTitle: actionCopy.triggerTitle,
        expectedWorkspaceKey: executionWorkspaceKey || null,
      });
      setPlan(result.plan ?? null);
      setBuildResult(result);
      setBuildResultUpdatedAtMs(Date.now());
      setBuildAutoRefreshStartedAtMs(
        isOperationActiveState(result.stateKey) && canRefreshBuildResult(result)
          ? Date.now()
          : null,
      );
      setBuildAutoRefreshTimedOut(false);
      const historyPromise = persistBuildHistoryFromEntry(optimisticEntry, result);
      const status = activityStatusFromBuildResult(result.stateKey, result);
      updateActivity?.(activityId, {
        status,
        summary: `${result.stateLabel} · ${result.detail}`,
        detail: result.buildUrl || result.queueUrl || null,
        projectName: result.plan?.projectName || activityProjectName,
        resource: buildRecordResource(result),
        action: status === "failed"
          ? buildRecoveryActionForRequest(
              request,
              result.plan?.projectName || activityProjectName,
              executionWorkspaceKey,
            )
          : null,
      });
      try {
        await historyPromise;
      } catch (historyReason) {
        setError(`${actionCopy.noun}已触发，但保存本地记录失败：${String(historyReason)}`);
      }
      return activityStatusFromBuildResult(result.stateKey, result) !== "failed";
    } catch (reason) {
      const failureDetail = String(reason);
      const failureResult: BuildResult = {
        plan: optimisticPlan ?? undefined,
        stateKey: "failed",
        stateLabel: "提交失败",
        detail: failureDetail,
        queueUrl: null,
        buildUrl: null,
      };
      setBuildResult(failureResult);
      setBuildResultUpdatedAtMs(Date.now());
      setBuildAutoRefreshStartedAtMs(null);
      upsertBuildHistoryEntry({
        ...optimisticEntry,
        stateKey: failureResult.stateKey,
        stateLabel: failureResult.stateLabel,
        detail: failureDetail,
        updatedAt: new Date().toISOString(),
      });
      updateActivity?.(activityId, {
        status: "failed",
        summary: actionCopy.triggerFailed,
        detail: failureDetail,
        action: buildRecoveryActionForRequest(
          request,
          activityProjectName,
          executionWorkspaceKey,
        ),
      });
      setError(failureDetail);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function handleTriggerBuild() {
    await triggerBuildRequest(
      currentBuildRequest(),
      actionCopyForPlan(currentPlan).triggerBusy,
    );
  }

  async function handleReplayBuildHistory(
    item: BuildHistoryEntry,
    options: BuildReplayOptions = {},
  ) {
    if (!enabled && !options.force) {
      return;
    }
    const actionCopy = actionCopyForHistoryItem(currentPlan, item);
    setBusy(actionCopy.replayBusy);
    setError("");
    const replayTarget = item.mode || null;
    const replayParams = normalizeBuildParams(item.params);
    const replayRequest: BuildRequest = {
      project: item.projectKey,
      target: replayTarget,
      variant: false,
      env: item.env || null,
      branch: item.branch || null,
      params: replayParams,
    };
    const executionWorkspaceKey = resolveBuildExecutionWorkspaceKey(
      activeProjectWorkspaceKey,
      options.workspaceKey,
      item.workspaceKey,
    );
    const activityId = createClientOperationId("build");
    const optimisticPlan =
      currentPlan?.projectKey === item.projectKey &&
      currentPlan.jobKind === item.mode
        ? currentPlan
        : null;
    const optimisticDetail = `${actionCopy.noun}重播请求已接收，正在创建任务`;
    const optimisticResult: BuildResult = {
      plan: optimisticPlan ?? undefined,
      stateKey: OPERATION_SUBMITTING_STATE,
      stateLabel: "正在提交",
      detail: optimisticDetail,
      queueUrl: null,
      buildUrl: null,
    };
    const optimisticEntry: BuildHistoryEntry = {
      ...createOptimisticBuildHistoryEntry({
        operationId: activityId,
        workspaceKey: executionWorkspaceKey,
        request: replayRequest,
        plan: optimisticPlan,
        projectName: item.projectName,
        fallbackTarget: item.mode,
        fallbackEnv: item.env,
        fallbackBranch: item.branch,
        detail: optimisticDetail,
      }),
      projectInstancePath: item.projectInstancePath ?? null,
    };
    recordActivity?.({
      id: activityId,
      kind: "build",
      status: "running",
      title: actionCopy.replayTitle,
      summary: `${item.projectName} · ${replayTarget || "默认目标"}`,
      executionKey: buildActivityExecutionKey(item.projectKey, replayTarget, replayParams),
      chainId: options.chainId ?? null,
      parentId: options.parentId ?? null,
      stepLabel: options.stepLabel ?? actionCopy.triggerTitle,
      chainLabel: options.chainId ? "联动链路" : null,
      projectKey: item.projectKey,
      projectName: item.projectName,
      parameters: activityParametersForBuild(
        item.projectKey,
        replayTarget,
        replayParams,
      ),
      target: {
        page: "build",
        projectKey: item.projectKey,
      },
    });
    currentBuildActivityIdRef.current = activityId;
    setBuildResult(optimisticResult);
    setBuildResultUpdatedAtMs(Date.now());
    setCurrentBuildHistoryKey(activityId);
    setBuildAutoRefreshStartedAtMs(null);
    setBuildAutoRefreshTimedOut(false);
    upsertBuildHistoryEntry(optimisticEntry);
    try {
      const result = await invoke<BuildResult>("trigger_build", {
        request: replayRequest,
        activityId: activityId || null,
        operationOrigin: options.origin ?? "app",
        activityTitle: actionCopy.replayTitle,
        expectedWorkspaceKey: executionWorkspaceKey || null,
      });
      setPlan(result.plan ?? null);
      setBuildResult(result);
      setBuildResultUpdatedAtMs(Date.now());
      setBuildAutoRefreshStartedAtMs(
        isOperationActiveState(result.stateKey) && canRefreshBuildResult(result)
          ? Date.now()
          : null,
      );
      setBuildAutoRefreshTimedOut(false);
      const historyPromise = persistBuildHistoryFromEntry(optimisticEntry, result);
      const status = activityStatusFromBuildResult(result.stateKey, result);
      updateActivity?.(activityId, {
        status,
        summary: `${result.stateLabel} · ${result.detail}`,
        detail: result.buildUrl || result.queueUrl || null,
        chainId: options.chainId ?? undefined,
        parentId: options.parentId ?? undefined,
        stepLabel: options.stepLabel ?? buildActionCopy(result.plan?.actionKind).triggerTitle,
        chainLabel: options.chainId ? "联动链路" : undefined,
        projectName: result.plan?.projectName || item.projectName,
        resource: buildRecordResource(result),
        action: status === "failed"
          ? buildRecoveryActionForRequest(
              replayRequest,
              result.plan?.projectName || item.projectName,
              executionWorkspaceKey,
            )
          : null,
      });
      try {
        await historyPromise;
      } catch (historyReason) {
        setError(`${actionCopy.noun}已重播，但保存本地记录失败：${String(historyReason)}`);
      }
    } catch (reason) {
      const failureDetail = String(reason);
      const failureResult: BuildResult = {
        plan: optimisticPlan ?? undefined,
        stateKey: "failed",
        stateLabel: "提交失败",
        detail: failureDetail,
        queueUrl: null,
        buildUrl: null,
      };
      setBuildResult(failureResult);
      setBuildResultUpdatedAtMs(Date.now());
      setBuildAutoRefreshStartedAtMs(null);
      upsertBuildHistoryEntry({
        ...optimisticEntry,
        stateKey: failureResult.stateKey,
        stateLabel: failureResult.stateLabel,
        detail: failureDetail,
        updatedAt: new Date().toISOString(),
      });
      updateActivity?.(activityId, {
        status: "failed",
        summary: actionCopy.replayFailed,
        detail: failureDetail,
        action: buildRecoveryActionForRequest(
          replayRequest,
          item.projectName,
          executionWorkspaceKey,
        ),
      });
      setError(failureDetail);
    } finally {
      setBusy("");
    }
  }

  async function refreshCurrentBuildStatus({ silent = false }: { silent?: boolean } = {}) {
    if (!enabled) {
      return;
    }
    const currentResult = buildResult;
    if (!currentResult || !canRefreshBuildResult(currentResult)) {
      return;
    }
    if (buildRefreshInFlightRef.current) {
      return;
    }
    const requestId = buildRefreshRequestIdRef.current + 1;
    const requestScope = `${enabled}:${buildViewScopeKey}`;
    buildRefreshRequestIdRef.current = requestId;
    buildRefreshInFlightRef.current = true;
    if (!silent) {
      setBusy("正在刷新构建状态");
      setError("");
    }
    try {
      const result = await invoke<BuildResult>("refresh_build_status", {
        request: {
          queueUrl: currentResult.queueUrl,
          buildUrl: currentResult.buildUrl,
          project: isLocalBuildResult(currentResult) ? currentResult.plan?.projectKey : null,
        },
      });
      const nextResult = {
        ...result,
        plan: result.plan ?? currentResult.plan ?? currentPlan ?? undefined,
      };
      if (
        requestId !== buildRefreshRequestIdRef.current ||
        requestScope !== buildRefreshScopeRef.current
      ) {
        return;
      }
      const changed = buildResultChanged(currentResult, nextResult);
      setBuildResult(nextResult);
      setBuildResultUpdatedAtMs(Date.now());
      const historyKey = resolveBuildHistoryKey({
        currentHistoryKey: currentBuildHistoryKey,
        queueUrl: currentResult.queueUrl,
        buildUrl: currentResult.buildUrl,
        activityId: currentBuildActivityIdRef.current,
        workspaceKey: activeProjectWorkspaceKey,
        projectKey: currentResult.plan?.projectKey || selectedProject,
        target,
      });
      setCurrentBuildHistoryKey(historyKey);
      if (changed) {
        await persistBuildHistory(historyKey, nextResult);
      }
      if (changed && currentBuildActivityIdRef.current) {
        updateActivity?.(currentBuildActivityIdRef.current, {
          status: activityStatusFromBuildResult(nextResult.stateKey, nextResult),
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
      if (requestId === buildRefreshRequestIdRef.current) {
        buildRefreshInFlightRef.current = false;
      }
      if (!silent) {
        setBusy("");
      }
    }
  }

  async function refreshBuildHistoryStatusItems(
    items: BuildHistoryEntry[],
    { reportItemFailure }: { reportItemFailure: boolean },
  ) {
    const activeItems = items
      .filter((item) => isOperationActiveState(item.stateKey))
      .filter((item) => item.queueUrl || item.buildUrl || item.projectKey)
      .slice(0, BUILD_HISTORY_STATUS_SYNC_LIMIT);

    for (const item of activeItems) {
      try {
        const result = await invoke<BuildResult>("refresh_build_status", {
          request: {
            queueUrl: item.queueUrl,
            buildUrl: item.buildUrl,
            project: item.queueUrl || item.buildUrl ? null : item.projectKey,
          },
        });
        await persistBuildHistoryFromEntry(item, result);
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
          syncBuildActivityStatusFailure(item, reason);
        }
      }
    }
  }

  async function refreshBuildHistoryStatuses() {
    if (!enabled) {
      setBuildHistory([]);
      return;
    }
    setBusy("正在刷新构建记录");
    setError("");
    try {
      const items = normalizeBuildHistoryRecords(
        await invoke<BuildHistoryEntry[]>(BUILD_HISTORY_COMMANDS.list),
      );
      setBuildHistory(items);
      await refreshBuildHistoryStatusItems(items, { reportItemFailure: true });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleClearBuildHistory() {
    if (!enabled) {
      setBuildHistory([]);
      return;
    }
    setBusy("正在清空构建记录");
    setError("");
    try {
      await invoke(BUILD_HISTORY_COMMANDS.clear);
      setBuildHistory([]);
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

  function syncBuildActivitiesFromHistory() {
    for (const item of buildHistory.slice(0, MAX_BUILD_HISTORY_ITEMS)) {
      syncBuildActivityFromHistory(item);
    }
  }

  return {
    buildResult,
    buildResultUpdatedAtMs,
    currentBuildHistoryKey,
    buildAutoRefreshTimedOut,
    visibleBuildHistory,
    handleTriggerBuild,
    handleTriggerBuildRequest: (
      request: BuildRequest,
      busyText = "正在重播构建",
      options: BuildReplayOptions = {},
    ) => triggerBuildRequest(request, busyText, options),
    handleRefreshBuild: () => refreshCurrentBuildStatus(),
    handleReplayBuildHistory,
    handleOpenBuildRecord: async () => {
      const url = buildResult?.buildUrl ?? buildResult?.queueUrl;
      if (!url) {
        return;
      }
      await openBuildUrl(url, "正在打开构建记录页");
    },
    handleOpenBuildUrl: (url: string) => openBuildUrl(url, "正在打开构建链接"),
    loadBuildHistory,
    refreshBuildHistoryStatuses,
    syncBuildActivitiesFromHistory,
    handleClearBuildHistory,
  };
}
