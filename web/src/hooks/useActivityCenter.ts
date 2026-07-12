import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { deleteStoredJson, getStoredJson, setStoredJson } from "../lib/storage";
import {
  BUILD_STATUS_SYNC_MAX_FAILURES,
  createActivityEntry,
  isBuildActivityKind,
  normalizeActivityEntries,
  type ActivityBulkUpdater,
  type ActivityDraft,
  type ActivityEntry,
  type ActivityMatch,
  type ActivityPatch,
  type ActivityStatus,
} from "../lib/activityCenter";

const ACTIVITY_STORAGE_NAMESPACE = "activity-center";
const ACTIVITY_STORAGE_KEY = "items";
const MAX_ACTIVITY_ITEMS = 60;
const BUILD_STATUS_SYNC_LIMIT = 5;
const URL_LIKE_PATTERN = /^https?:\/\//i;
const JENKINS_QUEUE_PATTERN = /\/queue\/item\//i;

type UseActivityCenterOptions = {
  setError: (value: string) => void;
  projectKeys?: string[];
  includeAllProjects?: boolean;
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
  return Array.from(deduped.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_ACTIVITY_ITEMS);
}

function matchesActivity(item: ActivityEntry, match: ActivityMatch) {
  if (match.kind && item.kind !== match.kind) {
    return false;
  }
  if (match.status && item.status !== match.status) {
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
  if (includeAllProjects) {
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

function shouldApplyActivityPatch(item: ActivityEntry, patch: ActivityPatch) {
  if (patch.kind !== undefined && patch.kind !== item.kind) return true;
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
  return false;
}

function acknowledgedRunningSummary(item: ActivityEntry) {
  const originalSummary = item.summary.trim();
  return originalSummary
    ? `已结束关注 · 原状态：${originalSummary}`
    : "已结束关注";
}

export function useActivityCenter({
  setError,
  projectKeys = [],
  includeAllProjects = true,
}: UseActivityCenterOptions) {
  const [allItems, setAllItems] = useState<ActivityEntry[]>([]);
  const itemsRef = useRef<ActivityEntry[]>([]);
  const projectKeySet = useMemo(() => new Set(projectKeys), [projectKeys]);

  const scopedItems = useMemo(
    () =>
      allItems.filter((item) =>
        activityMatchesScope(item, projectKeySet, includeAllProjects),
      ),
    [allItems, includeAllProjects, projectKeySet],
  );

  const stats = useMemo(
    () => ({
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

  const persist = useCallback((nextItems: ActivityEntry[]) => {
    const normalized = normalizeActivityList(nextItems);
    itemsRef.current = normalized;
    setAllItems(normalized);
    void setStoredJson(
      ACTIVITY_STORAGE_NAMESPACE,
      ACTIVITY_STORAGE_KEY,
      normalized,
    ).catch((reason) => {
      setError(String(reason));
    });
  }, [setError]);

  const patchStoredActivity = useCallback((id: string, patch: ActivityPatch) => {
    if (!id) {
      return;
    }
    const now = new Date().toISOString();
    persist(
      itemsRef.current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: patch.updatedAt || now,
            }
        : item,
      ),
    );
  }, [persist]);

  const syncStoredBuildStatuses = useCallback(async (
    sourceItems: ActivityEntry[],
    options: BuildStatusSyncOptions = {},
  ) => {
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
  }, [patchStoredActivity]);

  const refreshBuildActivities = useCallback(async (options: BuildStatusSyncOptions = {}) => {
    await syncStoredBuildStatuses(scopedItems, options);
  }, [scopedItems, syncStoredBuildStatuses]);

  useEffect(() => {
    let cancelled = false;
    void getStoredJson<unknown>(ACTIVITY_STORAGE_NAMESPACE, ACTIVITY_STORAGE_KEY)
      .then((stored) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeActivityList(stored, { expireStaleRunning: true });
        itemsRef.current = normalized;
        setAllItems(normalized);
        void setStoredJson(
          ACTIVITY_STORAGE_NAMESPACE,
          ACTIVITY_STORAGE_KEY,
          normalized,
        ).catch((reason) => {
          if (!cancelled) {
            setError(String(reason));
          }
        });
        void syncStoredBuildStatuses(normalized);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setError, syncStoredBuildStatuses]);

  const recordActivity = useCallback((draft: ActivityDraft) => {
    const entry = createActivityEntry(draft);
    persist([entry, ...itemsRef.current.filter((item) => item.id !== entry.id)]);
    return entry.id;
  }, [persist]);

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

  const acknowledgeActivities = useCallback((ids: string[]) => {
    const targetIds = new Set(ids.filter(Boolean));
    if (targetIds.size === 0) {
      return;
    }
    const now = new Date().toISOString();
    persist(
      itemsRef.current.map((item) => {
        if (!targetIds.has(item.id)) {
          return item;
        }
        if (item.status === "failed") {
          return {
            ...item,
            acknowledgedAt: item.acknowledgedAt || now,
          };
        }
        if (item.status === "running") {
          return {
            ...item,
            status: "info" as ActivityStatus,
            summary: acknowledgedRunningSummary(item),
            acknowledgedAt: item.acknowledgedAt || now,
            updatedAt: now,
          };
        }
        return item;
      }),
    );
  }, [persist]);

  const acknowledgeActivity = useCallback((id: string) => {
    acknowledgeActivities([id]);
  }, [acknowledgeActivities]);

  const clearActivities = useCallback(async () => {
    if (includeAllProjects) {
      itemsRef.current = [];
      setAllItems([]);
      await deleteStoredJson(ACTIVITY_STORAGE_NAMESPACE, ACTIVITY_STORAGE_KEY);
      return;
    }
    const remaining = itemsRef.current.filter(
      (item) => !activityMatchesScope(item, projectKeySet, includeAllProjects),
    );
    persist(remaining);
  }, [includeAllProjects, persist, projectKeySet]);

  return {
    items: scopedItems,
    stats,
    recordActivity,
    updateActivity,
    syncActivities,
    refreshBuildActivities,
    acknowledgeActivity,
    acknowledgeActivities,
    clearActivities,
  };
}

export type ActivityCenterState = ReturnType<typeof useActivityCenter>;
