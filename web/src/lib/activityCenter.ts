import type { PageKey } from "../app-shell";
import type { BranchWorkflowMode } from "../app-types";

export type ActivityKind =
  | "runtime"
  | "build"
  | "branch"
  | "deploy"
  | "shortcut";

export type ActivityStatus = "running" | "success" | "failed" | "info";

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
  projectKey?: string | null;
  projectName?: string | null;
  target?: ActivityTarget | null;
  resource?: ActivityResource | null;
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
    | "projectKey"
    | "projectName"
    | "target"
    | "resource"
    | "acknowledgedAt"
  >
> & {
  updatedAt?: string;
};

export type ActivityMatch = {
  kind?: ActivityKind;
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
  return {
    id: candidate.id,
    kind: candidate.kind as ActivityKind,
    status: candidate.status as ActivityStatus,
    title: candidate.title,
    summary: candidate.summary,
    detail: normalizeNullableString(candidate.detail),
    projectKey: normalizeNullableString(candidate.projectKey),
    projectName: normalizeNullableString(candidate.projectName),
    target: normalizeActivityTarget(candidate.target),
    resource: normalizeActivityResource(candidate.resource),
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
    projectKey: draft.projectKey ?? null,
    projectName: draft.projectName ?? null,
    target: draft.target ?? null,
    resource: draft.resource ?? null,
    acknowledgedAt: draft.acknowledgedAt ?? null,
    createdAt: draft.createdAt || now,
    updatedAt: draft.updatedAt || now,
  })!;
}
