import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  BuildHistoryEntry,
  ConfigSource,
  MergeHistoryEntry,
  OperationEventEntry,
} from "../app-types";
import { deleteStoredJson, getStoredJson, setStoredJson } from "../lib/storage";
import {
  configSourcesChangedActivities,
  workspaceStateChangedActivities,
  type ConfigChangeAppInfo,
} from "../lib/configChangeActivities";
import {
  CONFIG_SOURCES_CHANGED_EVENT,
  type ConfigSourcesChangedPayload,
} from "../lib/configSources";
import {
  WORKSPACE_STATE_CHANGED_EVENT,
  type WorkspaceStateChangedPayload,
} from "../lib/workspaceSync";
import { disposeTauriListener } from "../lib/tauriEvents";
import {
  BUILD_STATUS_SYNC_MAX_FAILURES,
  activityRequiresAttention,
  createActivityEntry,
  enrichBranchActivityFailureDetails,
  isBuildActivityKind,
  normalizeActivityEntries,
  retainActivityEntries,
  stableActivityJson,
  type ActivityBulkUpdater,
  type ActivityDraft,
  type ActivityEntry,
  type ActivityMatch,
  type ActivityPatch,
  type ActivityStatus,
} from "../lib/activityCenter";
import {
  activityVisibleWithPreferences,
  type ConfigActivityVisibility,
} from "../lib/activityPreferences";
import {
  activityCanBeCleared,
  resolveActivityEntries,
} from "../lib/activityResolution";
import { reconcileHistoryActivities } from "../lib/historyActivities";
import { isOperationActiveState } from "../lib/operationLifecycle";

const ACTIVITY_STORAGE_NAMESPACE = "activity-center";
const ACTIVITY_STORAGE_KEY = "items";
const ACTIVITY_HISTORY_CURSOR_KEY = "history-cursor";
const BRANCH_WORKFLOW_STORAGE_NAMESPACE = "branch-workflow";
const BRANCH_WORKFLOW_HISTORY_KEY = "history";
const MAX_ACTIVITY_ITEMS = 60;
const BUILD_STATUS_SYNC_LIMIT = 5;
const HISTORY_ACTIVITY_SYNC_INTERVAL_MS = 5_000;
const URL_LIKE_PATTERN = /^https?:\/\//i;
const JENKINS_QUEUE_PATTERN = /\/queue\/item\//i;

type UseActivityCenterOptions = {
  setError: (value: string) => void;
  projectKeys?: string[];
  includeAllProjects?: boolean;
  configActivityVisibility?: ConfigActivityVisibility;
};

type BuildStatusResponse = {
  queueUrl?: string | null;
  buildUrl?: string | null;
  stateKey: string;
  stateLabel: string;
  detail: string;
};

type BuildStatusSyncOptions = {
  force?: boolean;
};

type ActivityNormalizeOptions = {
  expireStaleRunning?: boolean;
};

function historyActivityTimestamp(value?: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return 0;
  }
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)
      ? `${normalized.replace(" ", "T")}Z`
      : normalized,
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizedHistoryCursor(value: unknown) {
  const cursor = typeof value === "number" ? value : Number(value);
  return Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
}

function latestHistoryTimestamp(
  buildHistory: BuildHistoryEntry[],
  mergeHistory: MergeHistoryEntry[],
) {
  return Math.max(
    0,
    ...buildHistory.map((item) => historyActivityTimestamp(item.updatedAt)),
    ...mergeHistory.map((item) => historyActivityTimestamp(item.createdAt)),
  );
}

function normalizedActivityLink(value?: string | null) {
  return value?.trim() ?? "";
}

function buildActivityResourceValue(item: ActivityEntry) {
  if (!isBuildActivityKind(item.kind)) {
    return "";
  }
  const resourceValue = normalizedActivityLink(item.resource?.value);
  if (resourceValue) {
    return resourceValue;
  }
  const detailValue = normalizedActivityLink(item.detail);
  return URL_LIKE_PATTERN.test(detailValue) ? detailValue : "";
}

function activityDedupeKey(item: ActivityEntry) {
  if (item.chainId || item.parentId) {
    return `id:${item.id}`;
  }
  const buildResource = buildActivityResourceValue(item);
  if (buildResource) {
    return `build:${item.projectKey ?? ""}:${buildResource}`;
  }
  return `id:${item.id}`;
}

function activityTerminalRank(item: ActivityEntry) {
  if (item.status === "failed" || item.status === "success") {
    return 3;
  }
  if (item.status === "info") {
    return 2;
  }
  return 1;
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

function buildSyncFailureCount(item: ActivityEntry) {
  return item.syncFailureCount ?? 0;
}

function isBuildStatusSyncNotice(item: ActivityEntry) {
  return (
    isBuildActivityKind(item.kind) &&
    (item.summary.startsWith("状态同步失败") ||
      item.summary === "同步 Jenkins 状态中…")
  );
}

function buildRecordResource(
  value: Pick<BuildStatusResponse, "buildUrl" | "queueUrl">,
): ActivityEntry["resource"] {
  const url = value.buildUrl || value.queueUrl;
  return url
    ? {
        kind: "url",
        label: "打开构建记录",
        value: url,
      }
    : null;
}

function buildActivityStatusRequest(
  item: ActivityEntry,
  options: BuildStatusSyncOptions = {},
) {
  const shouldRetrySyncFailure =
    item.status === "failed" &&
    item.summary.startsWith("状态同步失败") &&
    options.force;
  if (!isBuildActivityKind(item.kind) || (item.status !== "running" && !shouldRetrySyncFailure)) {
    return null;
  }
  const values = [
    normalizedActivityLink(item.resource?.value),
    normalizedActivityLink(item.detail),
  ].filter((value) => URL_LIKE_PATTERN.test(value));
  if (values.length === 0) {
    return null;
  }
  const queueUrl = values.find((value) => JENKINS_QUEUE_PATTERN.test(value)) ?? null;
  const buildUrl = values.find((value) => !JENKINS_QUEUE_PATTERN.test(value)) ?? null;
  if (!queueUrl && !buildUrl) {
    return null;
  }
  return {
    queueUrl,
    buildUrl,
  };
}

function compactSyncError(reason: unknown) {
  const message = String(reason).trim();
  if (!message) {
    return "无法读取 Jenkins 当前状态";
  }
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

function syncFailureSummary(failureCount: number) {
  const countText = `${failureCount}/${BUILD_STATUS_SYNC_MAX_FAILURES}`;
  if (failureCount >= BUILD_STATUS_SYNC_MAX_FAILURES) {
    return `状态同步失败 · 已停止自动重试（${countText}）`;
  }
  return `状态同步失败 · 请手动刷新（${countText}）`;
}

function chooseActivityDuplicate(left: ActivityEntry, right: ActivityEntry) {
  const leftRank = activityTerminalRank(left);
  const rightRank = activityTerminalRank(right);
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? left : right;
  }
  return right.updatedAt.localeCompare(left.updatedAt) > 0 ? right : left;
}

function buildExecutionActivityKey(item: ActivityEntry) {
  const projectKey = item.projectKey?.trim();
  const executionKey = item.executionKey?.trim();
  if (!isBuildActivityKind(item.kind) || !projectKey || !executionKey) {
    return "";
  }
  return `${projectKey}:${executionKey}`;
}

function removeSupersededBuildRunningActivities(items: ActivityEntry[]) {
  const terminalByExecution = new Map<string, ActivityEntry>();
  for (const item of items) {
    if (item.status !== "success" && item.status !== "failed") {
      continue;
    }
    const key = buildExecutionActivityKey(item);
    if (!key) {
      continue;
    }
    const current = terminalByExecution.get(key);
    if (!current || item.updatedAt.localeCompare(current.updatedAt) > 0) {
      terminalByExecution.set(key, item);
    }
  }

  if (terminalByExecution.size === 0) {
    return items;
  }

  return items.filter((item) => {
    if (item.status !== "running") {
      return true;
    }
    const key = buildExecutionActivityKey(item);
    if (!key) {
      return true;
    }
    const terminal = terminalByExecution.get(key);
    return !terminal || terminal.updatedAt.localeCompare(item.updatedAt) < 0;
  });
}

function activityDateKey(value?: string | null) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toDateString();
}

function staleRunningSummary(item: ActivityEntry) {
  const originalSummary = item.summary.trim();
  const prefix = isBuildActivityKind(item.kind)
    ? "上次本地构建未确认完成"
    : "上次会话未确认完成";
  return originalSummary ? `${prefix} · 原状态：${originalSummary}` : prefix;
}

function normalizeStaleRunningActivity(item: ActivityEntry, todayKey: string) {
  if (item.status !== "running" || !todayKey) {
    return item;
  }
  if (isBuildActivityKind(item.kind) && buildActivityStatusRequest(item)) {
    return item;
  }
  const itemDateKey = activityDateKey(item.updatedAt || item.createdAt);
  if (!itemDateKey || itemDateKey === todayKey) {
    return item;
  }
  return {
    ...item,
    status: "info" as ActivityStatus,
    summary: staleRunningSummary(item),
    acknowledgedAt: null,
  };
}

function normalizeActivityList(value: unknown, options: ActivityNormalizeOptions = {}) {
  const todayKey = options.expireStaleRunning ? new Date().toDateString() : "";
  const deduped = new Map<string, ActivityEntry>();
  for (const item of removeSupersededBuildRunningActivities(normalizeActivityEntries(value))) {
    const normalizedItem = normalizeStaleRunningActivity(item, todayKey);
    const key = activityDedupeKey(normalizedItem);
    const current = deduped.get(key);
    deduped.set(
      key,
      current ? chooseActivityDuplicate(current, normalizedItem) : normalizedItem,
    );
  }
  return retainActivityEntries(
    Array.from(deduped.values()),
    MAX_ACTIVITY_ITEMS,
  );
}

function matchesActivity(item: ActivityEntry, match: ActivityMatch) {
  if (match.kind && item.kind !== match.kind) {
    return false;
  }
  if (match.status && item.status !== match.status) {
    return false;
  }
  if (match.actionKind && item.action?.kind !== match.actionKind) {
    return false;
  }
  if (match.executionKey && item.executionKey !== match.executionKey) {
    return false;
  }
  if (match.projectKey && item.projectKey !== match.projectKey) {
    return false;
  }
  const resourceValues = new Set(
    (match.resourceValues ?? []).map((value) => value.trim()).filter(Boolean),
  );
  if (resourceValues.size === 0) {
    return true;
  }
  return [
    item.resource?.value,
    item.detail,
  ].some((value) => resourceValues.has(normalizedActivityLink(value)));
}

function activityProjectKey(item: ActivityEntry) {
  return item.projectKey || item.target?.projectKey || "";
}

function activityMatchesScope(
  item: ActivityEntry,
  projectKeys: Set<string>,
  includeAllProjects: boolean,
) {
  if (includeAllProjects || item.kind === "config" || item.kind === "link") {
    return true;
  }
  const projectKey = activityProjectKey(item);
  return Boolean(projectKey && projectKeys.has(projectKey));
}

function sameActivityResource(left: ActivityEntry["resource"], right: ActivityEntry["resource"]) {
  return (
    (left?.kind ?? null) === (right?.kind ?? null) &&
    (left?.label ?? null) === (right?.label ?? null) &&
    (left?.value ?? null) === (right?.value ?? null)
  );
}

function sameActivityAction(left: ActivityEntry["action"], right: ActivityEntry["action"]) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameActivityValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function shouldApplyActivityPatch(item: ActivityEntry, patch: ActivityPatch) {
  if (patch.kind !== undefined && patch.kind !== item.kind) return true;
  if (patch.origin !== undefined && patch.origin !== item.origin) return true;
  if (patch.status !== undefined && patch.status !== item.status) return true;
  if (patch.title !== undefined && patch.title !== item.title) return true;
  if (patch.summary !== undefined && patch.summary !== item.summary) return true;
  if (patch.detail !== undefined && patch.detail !== item.detail) return true;
  if (patch.executionKey !== undefined && patch.executionKey !== item.executionKey) return true;
  if (patch.chainId !== undefined && patch.chainId !== item.chainId) return true;
  if (patch.parentId !== undefined && patch.parentId !== item.parentId) return true;
  if (patch.stepLabel !== undefined && patch.stepLabel !== item.stepLabel) return true;
  if (patch.chainLabel !== undefined && patch.chainLabel !== item.chainLabel) return true;
  if (patch.projectKey !== undefined && patch.projectKey !== item.projectKey) return true;
  if (patch.projectName !== undefined && patch.projectName !== item.projectName) return true;
  if (patch.parameters !== undefined && !sameActivityValue(patch.parameters, item.parameters)) {
    return true;
  }
  if (patch.diagnostics !== undefined && !sameActivityValue(patch.diagnostics, item.diagnostics)) {
    return true;
  }
  if (patch.warnings !== undefined && !sameActivityValue(patch.warnings, item.warnings)) {
    return true;
  }
  if (patch.target !== undefined && !sameActivityValue(patch.target, item.target)) {
    return true;
  }
  if (
    patch.syncFailureCount !== undefined &&
    patch.syncFailureCount !== item.syncFailureCount
  ) {
    return true;
  }
  if (patch.acknowledgedAt !== undefined && patch.acknowledgedAt !== item.acknowledgedAt) {
    return true;
  }
  if (patch.resource !== undefined && !sameActivityResource(patch.resource, item.resource)) {
    return true;
  }
  if (patch.action !== undefined && !sameActivityAction(patch.action, item.action)) {
    return true;
  }
  return false;
}

export function useActivityCenter({
  setError,
  projectKeys = [],
  includeAllProjects = true,
  configActivityVisibility = "actionable",
}: UseActivityCenterOptions) {
  const [allItems, setAllItems] = useState<ActivityEntry[]>([]);
  const [activityStorageHydrated, setActivityStorageHydrated] = useState(false);
  const itemsRef = useRef<ActivityEntry[]>([]);
  const historyCursorRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const buildStatusSyncInFlightRef = useRef(false);
  const projectKeySet = useMemo(() => new Set(projectKeys), [projectKeys]);

  const scopedItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          activityMatchesScope(item, projectKeySet, includeAllProjects) &&
          activityVisibleWithPreferences(item, {
            version: 1,
            configActivityVisibility,
          }),
      ),
    [allItems, configActivityVisibility, includeAllProjects, projectKeySet],
  );

  const stats = useMemo(
    () => ({
      attention: scopedItems.filter(activityRequiresAttention).length,
      running: scopedItems.filter(
        (item) => item.status === "running" && !isBuildStatusSyncNotice(item),
      ).length,
      failed: scopedItems.filter(
        (item) =>
          item.status === "failed" &&
          !item.acknowledgedAt &&
          !isBuildStatusSyncNotice(item),
      ).length,
      handled: scopedItems.filter(
        (item) =>
          item.status === "failed" &&
          item.acknowledgedAt &&
          !isBuildStatusSyncNotice(item),
      ).length,
      success: scopedItems.filter((item) => item.status === "success").length,
      total: scopedItems.length,
    }),
    [scopedItems],
  );

  const enqueueStorageOperation = useCallback((operation: () => Promise<void>) => {
    const next = persistenceQueueRef.current
      .catch(() => undefined)
      .then(operation);
    persistenceQueueRef.current = next.catch((reason) => {
      setError(String(reason));
    });
    return next;
  }, [setError]);

  const persist = useCallback((nextItems: ActivityEntry[]) => {
    const normalized = normalizeActivityList(nextItems);
    itemsRef.current = normalized;
    setAllItems(normalized);
    void enqueueStorageOperation(() =>
      setStoredJson(
        ACTIVITY_STORAGE_NAMESPACE,
        ACTIVITY_STORAGE_KEY,
        normalized,
      ),
    );
  }, [enqueueStorageOperation]);

  const patchStoredActivity = useCallback((id: string, patch: ActivityPatch) => {
    if (!id) {
      return;
    }
    let changed = false;
    const now = new Date().toISOString();
    const nextItems = itemsRef.current.map((item) => {
      if (item.id !== id || !shouldApplyActivityPatch(item, patch)) {
        return item;
      }
      changed = true;
      return {
        ...item,
        ...patch,
        updatedAt: patch.updatedAt || now,
      };
    });
    if (changed) {
      persist(nextItems);
    }
  }, [persist]);

  const syncStoredBuildStatuses = useCallback(async (
    sourceItems: ActivityEntry[],
    options: BuildStatusSyncOptions = {},
  ) => {
    if (buildStatusSyncInFlightRef.current) {
      return;
    }
    const targets = sourceItems
      .map((item) => ({
        item,
        request: buildActivityStatusRequest(item, options),
      }))
      .filter(
        (target): target is { item: ActivityEntry; request: { queueUrl: string | null; buildUrl: string | null } } =>
          Boolean(target.request),
      )
      .slice(0, BUILD_STATUS_SYNC_LIMIT);

    if (targets.length === 0) {
      return;
    }

    buildStatusSyncInFlightRef.current = true;
    try {
      for (const { item, request } of targets) {
        try {
          const result = await invoke<BuildStatusResponse>("refresh_build_status", {
            request,
          });
          patchStoredActivity(item.id, {
            status: activityStatusFromBuildState(result.stateKey),
            summary: `${result.stateLabel} · ${result.detail}`,
            detail: result.buildUrl || result.queueUrl || item.detail || null,
            resource: buildRecordResource(result) || item.resource || null,
            syncFailureCount: 0,
            acknowledgedAt: null,
          });
        } catch (reason) {
          const failureCount = Math.min(
            buildSyncFailureCount(item) + 1,
            BUILD_STATUS_SYNC_MAX_FAILURES,
          );
          patchStoredActivity(item.id, {
            status: "failed",
            summary: syncFailureSummary(failureCount),
            detail: compactSyncError(reason),
            resource: item.resource ?? null,
            syncFailureCount: failureCount,
            acknowledgedAt: item.acknowledgedAt || new Date().toISOString(),
          });
        }
      }
    } finally {
      buildStatusSyncInFlightRef.current = false;
    }
  }, [patchStoredActivity]);

  const refreshBuildActivities = useCallback(async (options: BuildStatusSyncOptions = {}) => {
    await syncStoredBuildStatuses(scopedItems, options);
  }, [scopedItems, syncStoredBuildStatuses]);

  const syncPersistedHistoryActivities = useCallback(async () => {
    const [buildHistory, mergeHistory, branchHistory, operationHistory] =
      await Promise.all([
        invoke<BuildHistoryEntry[]>("list_build_history").catch(() => []),
        invoke<MergeHistoryEntry[]>("list_merge_history").catch(() => []),
        getStoredJson<unknown>(
          BRANCH_WORKFLOW_STORAGE_NAMESPACE,
          BRANCH_WORKFLOW_HISTORY_KEY,
        ).catch(() => []),
        invoke<OperationEventEntry[]>("list_operation_event_history").catch(
          () => [],
        ),
      ]);
    const cursor = historyCursorRef.current;
    const nextBuildHistory = buildHistory.filter(
      (item) => historyActivityTimestamp(item.updatedAt) > cursor,
    );
    const nextMergeHistory = mergeHistory.filter(
      (item) => historyActivityTimestamp(item.createdAt) > cursor,
    );
    const next = normalizeActivityList(
      reconcileHistoryActivities(
        itemsRef.current,
        nextBuildHistory,
        nextMergeHistory,
        branchHistory,
        operationHistory,
      ),
    );
    if (stableActivityJson(next) !== stableActivityJson(itemsRef.current)) {
      persist(next);
    }
    const latestTimestamp = latestHistoryTimestamp(buildHistory, mergeHistory);
    if (latestTimestamp > cursor) {
      historyCursorRef.current = latestTimestamp;
      await enqueueStorageOperation(() =>
        setStoredJson(
          ACTIVITY_STORAGE_NAMESPACE,
          ACTIVITY_HISTORY_CURSOR_KEY,
          latestTimestamp,
        ),
      );
    }
    await syncStoredBuildStatuses(next);
    return next;
  }, [enqueueStorageOperation, persist, syncStoredBuildStatuses]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getStoredJson<unknown>(ACTIVITY_STORAGE_NAMESPACE, ACTIVITY_STORAGE_KEY),
      getStoredJson<unknown>(
        ACTIVITY_STORAGE_NAMESPACE,
        ACTIVITY_HISTORY_CURSOR_KEY,
      ).catch(() => 0),
      getStoredJson<unknown>(
        BRANCH_WORKFLOW_STORAGE_NAMESPACE,
        BRANCH_WORKFLOW_HISTORY_KEY,
      ).catch(() => null),
      invoke<BuildHistoryEntry[]>("list_build_history").catch(() => []),
      invoke<MergeHistoryEntry[]>("list_merge_history").catch(() => []),
      invoke<OperationEventEntry[]>("list_operation_event_history").catch(
        () => [],
      ),
    ])
      .then(
        ([
          stored,
          storedCursor,
          branchHistory,
          buildHistory,
          mergeHistory,
          operationHistory,
        ]) => {
          if (cancelled) {
            return;
          }
          const cursor = normalizedHistoryCursor(storedCursor);
          const nextBuildHistory = cursor
            ? buildHistory.filter(
                (item) => historyActivityTimestamp(item.updatedAt) > cursor,
              )
            : buildHistory;
          const nextMergeHistory = cursor
            ? mergeHistory.filter(
                (item) => historyActivityTimestamp(item.createdAt) > cursor,
              )
            : mergeHistory;
          const hydrated = enrichBranchActivityFailureDetails(
            normalizeActivityList(
              reconcileHistoryActivities(
                normalizeActivityList(stored, { expireStaleRunning: true }),
                nextBuildHistory,
                nextMergeHistory,
                branchHistory,
                operationHistory,
              ),
              { expireStaleRunning: true },
            ),
            branchHistory,
          );
          const normalized = normalizeActivityList(
            [...itemsRef.current, ...hydrated],
            { expireStaleRunning: true },
          );
          itemsRef.current = normalized;
          historyCursorRef.current = Math.max(
            cursor,
            latestHistoryTimestamp(buildHistory, mergeHistory),
          );
          setAllItems(normalized);
          void enqueueStorageOperation(() =>
            Promise.all([
              setStoredJson(
                ACTIVITY_STORAGE_NAMESPACE,
                ACTIVITY_STORAGE_KEY,
                normalized,
              ),
              setStoredJson(
                ACTIVITY_STORAGE_NAMESPACE,
                ACTIVITY_HISTORY_CURSOR_KEY,
                historyCursorRef.current,
              ),
            ]).then(() => undefined),
          );
          void syncStoredBuildStatuses(normalized);
          setActivityStorageHydrated(true);
        },
      )
      .catch((reason) => {
        if (!cancelled) {
          setError(String(reason));
          setActivityStorageHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enqueueStorageOperation, setError, syncStoredBuildStatuses]);

  useEffect(() => {
    if (!activityStorageHydrated) {
      return;
    }
    let disposed = false;
    let syncInFlight = false;

    const sync = () => {
      if (disposed || syncInFlight || document.visibilityState === "hidden") {
        return;
      }
      syncInFlight = true;
      void syncPersistedHistoryActivities()
        .catch((reason) => {
          if (!disposed) {
            setError(`同步操作历史失败：${String(reason)}`);
          }
        })
        .finally(() => {
          syncInFlight = false;
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sync();
      }
    };

    sync();
    const timer = window.setInterval(sync, HISTORY_ACTIVITY_SYNC_INTERVAL_MS);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activityStorageHydrated, setError, syncPersistedHistoryActivities]);

  const recordActivity = useCallback((draft: ActivityDraft) => {
    const entry = createActivityEntry({
      ...draft,
      origin: draft.origin ?? "app",
    });
    persist([entry, ...itemsRef.current.filter((item) => item.id !== entry.id)]);
    return entry.id;
  }, [persist]);

  useEffect(() => {
    if (!activityStorageHydrated) {
      return;
    }
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const seenEvents = new Set<string>();
    const projectWorkspaceRevisions = new Set<number>();

    function rememberEvent(key: string) {
      if (seenEvents.has(key)) {
        return false;
      }
      seenEvents.add(key);
      if (seenEvents.size > 120) {
        const oldest = seenEvents.values().next().value;
        if (oldest) seenEvents.delete(oldest);
      }
      return true;
    }

    function recordDrafts(drafts: ActivityDraft[]) {
      for (const draft of drafts) {
        recordActivity(draft);
      }
    }

    void listen<WorkspaceStateChangedPayload>(WORKSPACE_STATE_CHANGED_EVENT, (event) => {
      const payload = event.payload;
      if (
        disposed ||
        payload.origin === "internal" ||
        !rememberEvent(`workspace:${payload.revision}`)
      ) {
        return;
      }
      if (payload.scopes.includes("projectWorkspaces")) {
        projectWorkspaceRevisions.add(payload.revision);
      }
      void invoke<ConfigChangeAppInfo>("app_info")
        .then((appInfo) => {
          if (!disposed) {
            recordDrafts(workspaceStateChangedActivities(payload, appInfo));
          }
        })
        .catch((reason) => {
          if (!disposed) {
            setError(`记录工作区配置变化失败：${String(reason)}`);
          }
        });
    })
      .then((unlisten) => {
        if (disposed) disposeTauriListener(unlisten);
        else unlisteners.push(unlisten);
      })
      .catch((reason) => {
        if (!disposed) setError(`监听工作区配置活动失败：${String(reason)}`);
      });

    void listen<ConfigSourcesChangedPayload>(CONFIG_SOURCES_CHANGED_EVENT, (event) => {
      const payload = event.payload;
      if (
        disposed ||
        payload.origin === "internal" ||
        !rememberEvent(`config-source:${payload.revision}`)
      ) {
        return;
      }
      window.setTimeout(() => {
        if (disposed) {
          return;
        }
        const workspaceCatalogChange = projectWorkspaceRevisions.delete(payload.revision);
        const activityPayload = workspaceCatalogChange
          ? { ...payload, catalogChanged: false }
          : payload;
        void Promise.all([
          invoke<ConfigSource[]>("list_config_sources"),
          invoke<ConfigChangeAppInfo>("app_info"),
        ])
          .then(([sources, appInfo]) => {
            if (!disposed) {
              recordDrafts(
                configSourcesChangedActivities(activityPayload, sources, appInfo),
              );
            }
          })
          .catch((reason) => {
            if (!disposed) {
              setError(`记录配置源变化失败：${String(reason)}`);
            }
          });
      }, 80);
    })
      .then((unlisten) => {
        if (disposed) disposeTauriListener(unlisten);
        else unlisteners.push(unlisten);
      })
      .catch((reason) => {
        if (!disposed) setError(`监听配置源活动失败：${String(reason)}`);
      });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        disposeTauriListener(unlisten);
      }
    };
  }, [activityStorageHydrated, recordActivity, setError]);

  const updateActivity = useCallback((id: string, patch: ActivityPatch) => {
    if (!id) {
      return;
    }
    const nextItems = itemsRef.current.map((item) =>
      item.id === id
        ? {
            ...item,
            ...patch,
            updatedAt: patch.updatedAt || new Date().toISOString(),
          }
        : item,
    );
    persist(nextItems);
  }, [persist]);

  const syncActivities = useCallback<ActivityBulkUpdater>((match, patch) => {
    let changed = false;
    const nextItems = itemsRef.current.map((item) => {
      if (!matchesActivity(item, match)) {
        return item;
      }
      if (!shouldApplyActivityPatch(item, patch)) {
        return item;
      }
      changed = true;
      return {
        ...item,
        ...patch,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
    });
    if (changed) {
      persist(nextItems);
    }
    return changed;
  }, [persist]);

  const resolveActivities = useCallback((ids: string[]) => {
    const targetIds = new Set(ids.filter(Boolean));
    if (targetIds.size === 0) {
      return;
    }
    const now = new Date().toISOString();
    persist(resolveActivityEntries(itemsRef.current, [...targetIds], now));
  }, [persist]);

  const resolveActivity = useCallback((id: string) => {
    resolveActivities([id]);
  }, [resolveActivities]);

  const clearHandledActivities = useCallback(async () => {
    const clearedAt = Date.now();
    historyCursorRef.current = Math.max(historyCursorRef.current, clearedAt);
    await enqueueStorageOperation(() =>
      setStoredJson(
        ACTIVITY_STORAGE_NAMESPACE,
        ACTIVITY_HISTORY_CURSOR_KEY,
        historyCursorRef.current,
      ),
    );
    const remaining = itemsRef.current.filter(
      (item) =>
        !activityMatchesScope(item, projectKeySet, includeAllProjects) ||
        !activityCanBeCleared(item),
    );
    if (includeAllProjects && remaining.length === 0) {
      itemsRef.current = remaining;
      setAllItems(remaining);
      await enqueueStorageOperation(() =>
        deleteStoredJson(ACTIVITY_STORAGE_NAMESPACE, ACTIVITY_STORAGE_KEY),
      );
      return;
    }
    persist(remaining);
  }, [enqueueStorageOperation, includeAllProjects, persist, projectKeySet]);

  return {
    items: scopedItems,
    allItems,
    stats,
    recordActivity,
    updateActivity,
    syncActivities,
    refreshBuildActivities,
    resolveActivity,
    resolveActivities,
    clearHandledActivities,
  };
}

export type ActivityCenterState = ReturnType<typeof useActivityCenter>;
