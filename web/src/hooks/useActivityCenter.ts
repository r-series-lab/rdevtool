import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { deleteStoredJson, getStoredJson, setStoredJson } from "../lib/storage";
import {
  createActivityEntry,
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
const DEPLOY_STATUS_SYNC_LIMIT = 5;
const URL_LIKE_PATTERN = /^https?:\/\//i;
const JENKINS_QUEUE_PATTERN = /\/queue\/item\//i;

type UseActivityCenterOptions = {
  setError: (value: string) => void;
};

type BuildStatusResponse = {
  queueUrl?: string | null;
  buildUrl?: string | null;
  stateKey: string;
  stateLabel: string;
  detail: string;
};

function normalizedActivityLink(value?: string | null) {
  return value?.trim() ?? "";
}

function deployActivityResourceValue(item: ActivityEntry) {
  if (item.kind !== "deploy") {
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
  const deployResource = deployActivityResourceValue(item);
  if (deployResource) {
    return `deploy:${item.projectKey ?? ""}:${deployResource}`;
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

function deployActivityStatusRequest(item: ActivityEntry) {
  const shouldRetrySyncFailure =
    item.status === "failed" && item.summary.startsWith("状态同步失败");
  if (item.kind !== "deploy" || (item.status !== "running" && !shouldRetrySyncFailure)) {
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
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function chooseActivityDuplicate(left: ActivityEntry, right: ActivityEntry) {
  const leftRank = activityTerminalRank(left);
  const rightRank = activityTerminalRank(right);
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? left : right;
  }
  return right.updatedAt.localeCompare(left.updatedAt) > 0 ? right : left;
}

function normalizeActivityList(value: unknown) {
  const deduped = new Map<string, ActivityEntry>();
  for (const item of normalizeActivityEntries(value)) {
    const key = activityDedupeKey(item);
    const current = deduped.get(key);
    deduped.set(key, current ? chooseActivityDuplicate(current, item) : item);
  }
  return Array.from(deduped.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_ACTIVITY_ITEMS);
}

function matchesActivity(item: ActivityEntry, match: ActivityMatch) {
  if (match.kind && item.kind !== match.kind) {
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
  if (patch.projectKey !== undefined && patch.projectKey !== item.projectKey) return true;
  if (patch.projectName !== undefined && patch.projectName !== item.projectName) return true;
  if (patch.acknowledgedAt !== undefined && patch.acknowledgedAt !== item.acknowledgedAt) {
    return true;
  }
  if (patch.resource !== undefined && !sameActivityResource(patch.resource, item.resource)) {
    return true;
  }
  return false;
}

export function useActivityCenter({ setError }: UseActivityCenterOptions) {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const itemsRef = useRef<ActivityEntry[]>([]);

  const stats = useMemo(
    () => ({
      running: items.filter((item) => item.status === "running").length,
      failed: items.filter((item) => item.status === "failed" && !item.acknowledgedAt)
        .length,
      handled: items.filter((item) => item.status === "failed" && item.acknowledgedAt)
        .length,
      success: items.filter((item) => item.status === "success").length,
      total: items.length,
    }),
    [items],
  );

  const persist = useCallback((nextItems: ActivityEntry[]) => {
    const normalized = normalizeActivityList(nextItems);
    itemsRef.current = normalized;
    setItems(normalized);
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

  const syncStoredDeployStatuses = useCallback(async (sourceItems: ActivityEntry[]) => {
    const targets = sourceItems
      .map((item) => ({
        item,
        request: deployActivityStatusRequest(item),
      }))
      .filter(
        (target): target is { item: ActivityEntry; request: { queueUrl: string | null; buildUrl: string | null } } =>
          Boolean(target.request),
      )
      .slice(0, DEPLOY_STATUS_SYNC_LIMIT);

    if (targets.length === 0) {
      return;
    }

    for (const { item, request } of targets) {
      patchStoredActivity(item.id, {
        status: "running",
        summary: "正在同步 Jenkins 状态",
        detail: item.detail ?? null,
        resource: item.resource ?? null,
      });

      try {
        const result = await invoke<BuildStatusResponse>("refresh_build_status", {
          request,
        });
        patchStoredActivity(item.id, {
          status: activityStatusFromBuildState(result.stateKey),
          summary: `${result.stateLabel} · ${result.detail}`,
          detail: result.buildUrl || result.queueUrl || item.detail || null,
          resource: buildRecordResource(result) || item.resource || null,
          acknowledgedAt: null,
        });
      } catch (reason) {
        patchStoredActivity(item.id, {
          status: "failed",
          summary: "状态同步失败 · 保留上次状态",
          detail: compactSyncError(reason),
          resource: item.resource ?? null,
          acknowledgedAt: null,
        });
      }
    }
  }, [patchStoredActivity]);

  const refreshDeployActivities = useCallback(async () => {
    await syncStoredDeployStatuses(itemsRef.current);
  }, [syncStoredDeployStatuses]);

  useEffect(() => {
    let cancelled = false;
    void getStoredJson<unknown>(ACTIVITY_STORAGE_NAMESPACE, ACTIVITY_STORAGE_KEY)
      .then((stored) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeActivityList(stored);
        itemsRef.current = normalized;
        setItems(normalized);
        void syncStoredDeployStatuses(normalized);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setError, syncStoredDeployStatuses]);

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
  }, [persist]);

  const acknowledgeActivities = useCallback((ids: string[]) => {
    const targetIds = new Set(ids.filter(Boolean));
    if (targetIds.size === 0) {
      return;
    }
    const now = new Date().toISOString();
    persist(
      itemsRef.current.map((item) =>
        targetIds.has(item.id) && item.status === "failed"
          ? {
              ...item,
              acknowledgedAt: item.acknowledgedAt || now,
            }
          : item,
      ),
    );
  }, [persist]);

  const acknowledgeActivity = useCallback((id: string) => {
    acknowledgeActivities([id]);
  }, [acknowledgeActivities]);

  const clearActivities = useCallback(async () => {
    itemsRef.current = [];
    setItems([]);
    await deleteStoredJson(ACTIVITY_STORAGE_NAMESPACE, ACTIVITY_STORAGE_KEY);
  }, []);

  return {
    items,
    stats,
    recordActivity,
    updateActivity,
    syncActivities,
    refreshDeployActivities,
    acknowledgeActivity,
    acknowledgeActivities,
    clearActivities,
  };
}

export type ActivityCenterState = ReturnType<typeof useActivityCenter>;
