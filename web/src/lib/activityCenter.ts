import type { PageKey } from "../app-shell";
import type { BranchWorkflowMode } from "../app-types";

export type ActivityKind =
  | "runtime"
  | "build"
  | "branch"
  | "deploy"
  | "shortcut";

export type ActivityStatus = "running" | "success" | "failed" | "info";

export const DEPLOY_STATUS_SYNC_MAX_FAILURES = 3;

export type ActivityTarget = {
  page: PageKey;
  projectKey?: string | null;
  branchMode?: BranchWorkflowMode | null;
};

export type ActivityResource = {
  kind: "localPath" | "url";
  label: string;
  value: string;
};

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  title: string;
  summary: string;
  detail?: string | null;
  executionKey?: string | null;
  chainId?: string | null;
  parentId?: string | null;
  stepLabel?: string | null;
  chainLabel?: string | null;
  projectKey?: string | null;
  projectName?: string | null;
  target?: ActivityTarget | null;
  resource?: ActivityResource | null;
  syncFailureCount?: number;
  acknowledgedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityDraft = Omit<ActivityEntry, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ActivityPatch = Partial<
  Pick<
    ActivityEntry,
    | "kind"
    | "status"
    | "title"
    | "summary"
    | "detail"
    | "executionKey"
    | "chainId"
    | "parentId"
    | "stepLabel"
    | "chainLabel"
    | "projectKey"
    | "projectName"
    | "target"
    | "resource"
    | "syncFailureCount"
    | "acknowledgedAt"
  >
> & {
  updatedAt?: string;
};

export type ActivityMatch = {
  kind?: ActivityKind;
  status?: ActivityStatus;
  projectKey?: string | null;
  resourceValues?: string[];
};

export type ActivityRecorder = (draft: ActivityDraft) => string;
export type ActivityUpdater = (id: string, patch: ActivityPatch) => void;
export type ActivityBulkUpdater = (match: ActivityMatch, patch: ActivityPatch) => void;

const ACTIVITY_KINDS = new Set<ActivityKind>([
  "runtime",
  "build",
  "branch",
  "deploy",
  "shortcut",
]);

const ACTIVITY_STATUSES = new Set<ActivityStatus>([
  "running",
  "success",
  "failed",
  "info",
]);

function makeActivityId(prefix = "activity") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeNullableString(value: unknown) {
  const next = normalizeString(value).trim();
  return next ? next : null;
}

function normalizeNonNegativeInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.floor(number));
}

function normalizeDeploySyncFailureCount(summary: string, value: unknown) {
  const explicitCount = normalizeNonNegativeInteger(value);
  if (!summary.startsWith("状态同步失败")) {
    return explicitCount;
  }

  const summaryCountMatch = summary.match(/[（(]\s*(\d+)\s*\/\s*\d+\s*[)）]/);
  const summaryCount = summaryCountMatch
    ? normalizeNonNegativeInteger(summaryCountMatch[1])
    : 0;
  const stoppedCount = summary.includes("已停止自动重试")
    ? DEPLOY_STATUS_SYNC_MAX_FAILURES
    : 0;
  return Math.min(
    DEPLOY_STATUS_SYNC_MAX_FAILURES,
    Math.max(explicitCount, summaryCount, stoppedCount),
  );
}

function normalizeActivityTarget(value: unknown): ActivityTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ActivityTarget>;
  if (
    candidate.page !== "projects" &&
    candidate.page !== "merge" &&
    candidate.page !== "deploy"
  ) {
    return null;
  }

  return {
    page: candidate.page,
    projectKey: normalizeNullableString(candidate.projectKey),
    branchMode:
      candidate.branchMode === "sync" ||
      candidate.branchMode === "create" ||
      candidate.branchMode === "checkout" ||
      candidate.branchMode === "switch" ||
      candidate.branchMode === "push"
        ? candidate.branchMode
        : null,
  };
}

function normalizeActivityResource(value: unknown): ActivityResource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ActivityResource>;
  const label = normalizeString(candidate.label).trim();
  const resourceValue = normalizeString(candidate.value).trim();
  if (
    (candidate.kind !== "localPath" && candidate.kind !== "url") ||
    !label ||
    !resourceValue
  ) {
    return null;
  }

  return {
    kind: candidate.kind,
    label,
    value: resourceValue,
  };
}

export function stableActivityJson(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return "null";
    }
    if (typeof value === "bigint") {
      return JSON.stringify(String(value));
    }
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableActivityJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableActivityJson(item)}`)
    .join(",")}}`;
}

export function activityExecutionKey(
  item: Pick<
    ActivityEntry,
    | "kind"
    | "title"
    | "summary"
    | "executionKey"
    | "projectKey"
    | "projectName"
    | "target"
  >,
) {
  const explicitKey = normalizeNullableString(item.executionKey);
  if (explicitKey) {
    return explicitKey;
  }

  return [
    "fallback",
    item.kind,
    item.projectKey || item.projectName || "",
    item.title,
    item.summary,
    item.target ? stableActivityJson(item.target) : "",
  ].join(":");
}

export function normalizeActivityEntry(value: unknown): ActivityEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ActivityEntry>;
  if (
    typeof candidate.id !== "string" ||
    !ACTIVITY_KINDS.has(candidate.kind as ActivityKind) ||
    !ACTIVITY_STATUSES.has(candidate.status as ActivityStatus) ||
    typeof candidate.title !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return null;
  }

  const createdAt = normalizeString(candidate.createdAt) || new Date().toISOString();
  const updatedAt = normalizeString(candidate.updatedAt) || createdAt;
  const summary = candidate.summary;
  return {
    id: candidate.id,
    kind: candidate.kind as ActivityKind,
    status: candidate.status as ActivityStatus,
    title: candidate.title,
    summary,
    detail: normalizeNullableString(candidate.detail),
    executionKey: normalizeNullableString(candidate.executionKey),
    chainId: normalizeNullableString(candidate.chainId),
    parentId: normalizeNullableString(candidate.parentId),
    stepLabel: normalizeNullableString(candidate.stepLabel),
    chainLabel: normalizeNullableString(candidate.chainLabel),
    projectKey: normalizeNullableString(candidate.projectKey),
    projectName: normalizeNullableString(candidate.projectName),
    target: normalizeActivityTarget(candidate.target),
    resource: normalizeActivityResource(candidate.resource),
    syncFailureCount: normalizeDeploySyncFailureCount(summary, candidate.syncFailureCount),
    acknowledgedAt: normalizeNullableString(candidate.acknowledgedAt),
    createdAt,
    updatedAt,
  };
}

export function normalizeActivityEntries(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeActivityEntry)
    .filter((item): item is ActivityEntry => Boolean(item));
}

export function createActivityEntry(draft: ActivityDraft): ActivityEntry {
  const now = new Date().toISOString();
  return normalizeActivityEntry({
    id: draft.id || makeActivityId(draft.kind),
    kind: draft.kind,
    status: draft.status,
    title: draft.title,
    summary: draft.summary,
    detail: draft.detail ?? null,
    executionKey: draft.executionKey ?? null,
    chainId: draft.chainId ?? null,
    parentId: draft.parentId ?? null,
    stepLabel: draft.stepLabel ?? null,
    chainLabel: draft.chainLabel ?? null,
    projectKey: draft.projectKey ?? null,
    projectName: draft.projectName ?? null,
    target: draft.target ?? null,
    resource: draft.resource ?? null,
    syncFailureCount: draft.syncFailureCount ?? 0,
    acknowledgedAt: draft.acknowledgedAt ?? null,
    createdAt: draft.createdAt || now,
    updatedAt: draft.updatedAt || now,
  })!;
}
