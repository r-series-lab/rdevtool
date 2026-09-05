import type { PageKey } from "../app-shell";
import type {
  BranchTaskHistoryEntry,
  BranchTaskReplayCommand,
  BranchTaskReplayRequest,
  BranchWorkflowMode,
} from "../app-types";
import { branchTaskDisplayDetail } from "./branchTaskDetails";
import { createClientOperationId } from "./operationLifecycle";

export type ActivityKind =
  | "runtime"
  | "proxy"
  | "link"
  | "build"
  | "branch"
  | "deploy"
  | "shortcut"
  | "config";

export type ActivityStatus = "running" | "success" | "failed" | "info";
export type ActivityOrigin = "app" | "cli" | "tray";

export const BUILD_STATUS_SYNC_MAX_FAILURES = 3;

export type ActivityTarget = {
  page: PageKey;
  projectKey?: string | null;
  branchMode?: BranchWorkflowMode | null;
  workspaceKey?: string | null;
  workspaceView?: "open" | "archived" | null;
};

export type ActivityResource = {
  kind: "localPath" | "url";
  label: string;
  value: string;
};

export type ActivityParameter = {
  key: string;
  label: string;
  labelKey?: string | null;
  value: string;
  masked?: boolean;
};

export type ActivityDiagnosticStep = {
  id: string;
  type: string;
  label: string;
  status: string;
  summary: string;
  risks: string[];
};

export type ActivityBuildReplayRequest = {
  project: string;
  target: string | null;
  variant?: boolean;
  env?: string | null;
  branch?: string | null;
  extraParams?: Record<string, string>;
  params: Record<string, string>;
};

export type ActivityAction =
  | {
      kind: "reloadConfig";
      label: string;
      scope: "workspace" | "projects" | "projectWorkspaces";
    }
  | {
      kind: "compareConfigSource";
      label: string;
      sourceId: string;
    }
  | {
      kind: "linkRecover";
      label: string;
      linkKey: string;
      linkName: string;
      sourceId?: string | null;
      proxySourceId?: string | null;
      runtimeSourceId?: string | null;
      workspaceKey?: string | null;
      replayAction: "run" | "stop";
    }
  | {
      kind: "branchReplay";
      label: string;
      replay: BranchTaskReplayRequest;
    }
  | {
      kind: "buildRecover";
      label: string;
      projectKey: string;
      projectName: string;
      workspaceKey?: string | null;
      request: ActivityBuildReplayRequest;
    }
  | {
      kind: "runtimeRecover";
      label: string;
      projectKey: string;
      projectName: string;
      debugProfileKey?: string | null;
      envOverrides?: Record<string, string> | null;
      expectedPort?: number | null;
      replayAction: "start" | "stop";
    }
  | {
      kind: "proxyRecover";
      label: string;
      profileId: string;
      profileName: string;
      sourceId?: string | null;
      replayAction: "start" | "stop";
    };

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  origin?: ActivityOrigin | null;
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
  parameters?: ActivityParameter[];
  diagnostics?: ActivityDiagnosticStep[];
  warnings?: string[];
  target?: ActivityTarget | null;
  resource?: ActivityResource | null;
  action?: ActivityAction | null;
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
    | "origin"
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
    | "parameters"
    | "diagnostics"
    | "warnings"
    | "target"
    | "resource"
    | "action"
    | "syncFailureCount"
    | "acknowledgedAt"
  >
> & {
  updatedAt?: string;
};

export type ActivityMatch = {
  kind?: ActivityKind;
  status?: ActivityStatus;
  actionKind?: ActivityAction["kind"];
  executionKey?: string | null;
  projectKey?: string | null;
  resourceValues?: string[];
};

export type ActivityRecorder = (draft: ActivityDraft) => string;
export type ActivityUpdater = (id: string, patch: ActivityPatch) => void;
export type ActivityBulkUpdater = (match: ActivityMatch, patch: ActivityPatch) => boolean;

const BRANCH_ACTIVITY_HISTORY_MATCH_WINDOW_MS = 15_000;

const ACTIVITY_KINDS = new Set<ActivityKind>([
  "runtime",
  "proxy",
  "link",
  "build",
  "branch",
  "deploy",
  "shortcut",
  "config",
]);

const ACTIVITY_ORIGINS = new Set<ActivityOrigin>(["app", "cli", "tray"]);

const ACTIVITY_STATUSES = new Set<ActivityStatus>([
  "running",
  "success",
  "failed",
  "info",
]);

const BRANCH_REPLAY_COMMANDS = new Set<BranchTaskReplayCommand>([
  "execute_branch_sync_task",
  "execute_branch_create_task",
  "checkout_branch_to_directory_task",
  "execute_branch_switch_task",
  "execute_branch_push_task",
]);

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeActivityTimestamp(value: unknown, fallback = "") {
  const raw = normalizeString(value).trim();
  if (!raw) {
    return fallback;
  }
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw,
  );
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
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

function normalizeActivityParameters(value: unknown): ActivityParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const candidate = item as Partial<ActivityParameter>;
      const key = normalizeString(candidate.key).trim();
      const label = normalizeString(candidate.label).trim();
      const parameterValue = normalizeString(candidate.value).trim();
      if (!key || !label || !parameterValue) {
        return [];
      }
      return [{
        key,
        label,
        ...(normalizeString(candidate.labelKey).trim()
          ? { labelKey: normalizeString(candidate.labelKey).trim() }
          : {}),
        value: parameterValue,
        masked: candidate.masked === true,
      }];
    })
    .slice(0, 8);
}

function normalizeStringList(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      const normalized = normalizeString(item).trim();
      return normalized ? [normalized] : [];
    })
    .slice(0, limit);
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => {
        const normalizedKey = key.trim();
        return normalizedKey && typeof item === "string"
          ? [[normalizedKey, item] as const]
          : [];
      })
      .slice(0, 64),
  );
}

function normalizeActivityDiagnostics(value: unknown): ActivityDiagnosticStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const candidate = item as Partial<ActivityDiagnosticStep>;
      const id = normalizeString(candidate.id).trim();
      const type = normalizeString(candidate.type).trim();
      const label = normalizeString(candidate.label).trim();
      const status = normalizeString(candidate.status).trim();
      const summary = normalizeString(candidate.summary).trim();
      if (!id || !type || !label || !status || !summary) {
        return [];
      }
      return [{
        id,
        type,
        label,
        status,
        summary,
        risks: normalizeStringList(candidate.risks),
      }];
    })
    .slice(0, 50);
}

export function isBuildActivityKind(kind?: ActivityKind | string | null) {
  return kind === "build" || kind === "deploy";
}

export function activityRequiresAttention(
  item: Pick<
    ActivityEntry,
    "kind" | "status" | "summary" | "action" | "acknowledgedAt"
  >,
) {
  if (item.action && !item.acknowledgedAt) {
    return true;
  }
  const buildSyncNotice =
    isBuildActivityKind(item.kind) &&
    (item.summary.startsWith("状态同步失败") ||
      item.summary === "同步 Jenkins 状态中…");
  return item.status === "failed" && !item.acknowledgedAt && !buildSyncNotice;
}

export function retainActivityEntries(items: ActivityEntry[], limit: number) {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) {
    return [];
  }
  const sorted = [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  if (sorted.length <= normalizedLimit) {
    return sorted;
  }
  const attentionItems = sorted.filter(activityRequiresAttention);
  const retainedAttentionItems = attentionItems.slice(0, normalizedLimit);
  if (retainedAttentionItems.length === normalizedLimit) {
    return retainedAttentionItems;
  }
  const attentionIds = new Set(retainedAttentionItems.map((item) => item.id));
  return [
    ...retainedAttentionItems,
    ...sorted
      .filter(
        (item) =>
          !attentionIds.has(item.id) && !activityRequiresAttention(item),
      )
      .slice(0, normalizedLimit - retainedAttentionItems.length),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isStoredBranchTaskHistoryEntry(value: unknown): value is BranchTaskHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<BranchTaskHistoryEntry>;
  return (
    typeof candidate.createdAt === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.success === "boolean" &&
    Array.isArray(candidate.items) &&
    candidate.items.every(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.success === "boolean" &&
        typeof item.projectKey === "string" &&
        typeof item.projectName === "string" &&
        typeof item.sourceBranch === "string" &&
        typeof item.summary === "string" &&
        typeof item.statusLabel === "string" &&
        typeof item.detail === "string",
    )
  );
}

function branchHistoryMatchesActivity(
  activity: ActivityEntry,
  history: BranchTaskHistoryEntry,
) {
  const activityTime = Date.parse(activity.createdAt);
  const historyTime = Date.parse(history.createdAt);
  if (
    !Number.isFinite(activityTime) ||
    !Number.isFinite(historyTime) ||
    Math.abs(activityTime - historyTime) > BRANCH_ACTIVITY_HISTORY_MATCH_WINDOW_MS
  ) {
    return false;
  }
  if (activity.summary.trim() && activity.summary.trim() !== history.summary.trim()) {
    return false;
  }
  const projectKey = activity.projectKey?.trim();
  return !projectKey || history.items.some((item) => item.projectKey.trim() === projectKey);
}

export function enrichBranchActivityFailureDetails(
  activities: ActivityEntry[],
  storedHistory: unknown,
) {
  if (!Array.isArray(storedHistory)) {
    return activities;
  }
  const failedHistory = storedHistory
    .filter(isStoredBranchTaskHistoryEntry)
    .filter((entry) => !entry.success);
  if (failedHistory.length === 0) {
    return activities;
  }

  return activities.map((activity) => {
    if (activity.kind !== "branch" || activity.status !== "failed") {
      return activity;
    }
    const history = failedHistory.find((entry) =>
      branchHistoryMatchesActivity(activity, entry),
    );
    if (!history) {
      return activity;
    }
    const detail = branchTaskDisplayDetail(history).trim();
    if (!detail || detail.length <= (activity.detail?.trim().length ?? 0)) {
      return activity;
    }
    return { ...activity, detail };
  });
}

function normalizeActivityKind(value: unknown): ActivityKind | null {
  if (!ACTIVITY_KINDS.has(value as ActivityKind)) {
    return null;
  }
  return value === "deploy" ? "build" : (value as ActivityKind);
}

function normalizeActivityOrigin(value: unknown): ActivityOrigin | null {
  return ACTIVITY_ORIGINS.has(value as ActivityOrigin)
    ? (value as ActivityOrigin)
    : null;
}

function normalizeBuildSyncFailureCount(summary: string, value: unknown) {
  const explicitCount = normalizeNonNegativeInteger(value);
  if (!summary.startsWith("状态同步失败")) {
    return explicitCount;
  }

  const summaryCountMatch = summary.match(/[（(]\s*(\d+)\s*\/\s*\d+\s*[)）]/);
  const summaryCount = summaryCountMatch
    ? normalizeNonNegativeInteger(summaryCountMatch[1])
    : 0;
  const stoppedCount = summary.includes("已停止自动重试")
    ? BUILD_STATUS_SYNC_MAX_FAILURES
    : 0;
  return Math.min(
    BUILD_STATUS_SYNC_MAX_FAILURES,
    Math.max(explicitCount, summaryCount, stoppedCount),
  );
}

function normalizeActivityTarget(value: unknown): ActivityTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ActivityTarget>;
  const rawPageValue = (value as Record<string, unknown>).page;
  const rawPage = typeof rawPageValue === "string" ? rawPageValue : "";
  const projectKey = normalizeNullableString(candidate.projectKey);
  const workspaceKey = normalizeNullableString(candidate.workspaceKey);
  const page =
    rawPage === "deploy"
      ? "build"
      : rawPage === "projects"
        ? projectKey
          ? "projectManagement"
          : "resources"
      : rawPage === "navigation"
        ? "resources"
        : rawPage;
  if (
    page !== "overview" &&
    page !== "projectManagement" &&
    page !== "resources" &&
    page !== "proxy" &&
    page !== "merge" &&
    page !== "build"
  ) {
    return null;
  }

  const target: ActivityTarget = {
    page,
    projectKey,
    branchMode:
      candidate.branchMode === "sync" ||
      candidate.branchMode === "create" ||
      candidate.branchMode === "checkout" ||
      candidate.branchMode === "switch" ||
      candidate.branchMode === "push"
        ? candidate.branchMode
        : null,
  };
  if (
    workspaceKey &&
    (candidate.workspaceView === "open" ||
      candidate.workspaceView === "archived")
  ) {
    target.workspaceKey = workspaceKey;
    target.workspaceView = candidate.workspaceView;
  }
  return target;
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

function normalizeActivityAction(value: unknown): ActivityAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ActivityAction>;
  const label = normalizeString(candidate.label).trim();
  if (!label) {
    return null;
  }
  if (candidate.kind === "reloadConfig") {
    const scope = (value as { scope?: unknown }).scope;
    if (
      scope !== "workspace" &&
      scope !== "projects" &&
      scope !== "projectWorkspaces"
    ) {
      return null;
    }
    return { kind: candidate.kind, label, scope };
  }
  if (candidate.kind === "compareConfigSource") {
    const sourceId = normalizeString(
      (value as { sourceId?: unknown }).sourceId,
    ).trim();
    return sourceId ? { kind: candidate.kind, label, sourceId } : null;
  }
  if (candidate.kind === "linkRecover") {
    const raw = value as {
      linkKey?: unknown;
      linkName?: unknown;
      sourceId?: unknown;
      proxySourceId?: unknown;
      runtimeSourceId?: unknown;
      workspaceKey?: unknown;
      replayAction?: unknown;
    };
    const linkKey = normalizeString(raw.linkKey).trim();
    const linkName = normalizeString(raw.linkName).trim() || linkKey;
    const sourceId = normalizeNullableString(raw.sourceId);
    const proxySourceId = normalizeNullableString(raw.proxySourceId);
    const runtimeSourceId = normalizeNullableString(raw.runtimeSourceId);
    const workspaceKey = normalizeNullableString(raw.workspaceKey);
    if (
      !linkKey ||
      !linkName ||
      (raw.replayAction !== "run" && raw.replayAction !== "stop")
    ) {
      return null;
    }
    return {
      kind: candidate.kind,
      label,
      linkKey,
      linkName,
      sourceId,
      proxySourceId,
      runtimeSourceId,
      workspaceKey,
      replayAction: raw.replayAction,
    };
  }
  if (candidate.kind === "branchReplay") {
    const rawReplay = (value as { replay?: unknown }).replay;
    if (!rawReplay || typeof rawReplay !== "object" || Array.isArray(rawReplay)) {
      return null;
    }
    const replay = rawReplay as Partial<BranchTaskReplayRequest>;
    const command = replay.command as BranchTaskReplayCommand;
    const busyText = normalizeString(replay.busyText).trim();
    if (
      !BRANCH_REPLAY_COMMANDS.has(command) ||
      !busyText ||
      !replay.request ||
      typeof replay.request !== "object" ||
      Array.isArray(replay.request)
    ) {
      return null;
    }
    return {
      kind: candidate.kind,
      label,
      replay: {
        command,
        busyText,
        request: { ...(replay.request as Record<string, unknown>) },
        refreshPushStatusProject: normalizeNullableString(
          replay.refreshPushStatusProject,
        ),
        clearPushCommitMessageOnSuccess:
          replay.clearPushCommitMessageOnSuccess === true,
      },
    };
  }
  if (candidate.kind === "buildRecover") {
    const raw = value as {
      projectKey?: unknown;
      projectName?: unknown;
      workspaceKey?: unknown;
      request?: unknown;
    };
    const requestValue = raw.request;
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      return null;
    }
    const request = requestValue as Record<string, unknown>;
    const projectKey = normalizeString(raw.projectKey).trim();
    const requestProject = normalizeString(request.project).trim();
    if (!projectKey || requestProject !== projectKey) {
      return null;
    }
    const target = normalizeNullableString(request.target);
    const params = normalizeStringRecord(request.params) ?? {};
    const extraParams = normalizeStringRecord(request.extraParams);
    return {
      kind: candidate.kind,
      label,
      projectKey,
      projectName: normalizeString(raw.projectName).trim() || projectKey,
      workspaceKey: normalizeNullableString(raw.workspaceKey),
      request: {
        project: requestProject,
        target,
        ...(typeof request.variant === "boolean" ? { variant: request.variant } : {}),
        ...(typeof request.env === "string" ? { env: request.env } : {}),
        ...(typeof request.branch === "string" ? { branch: request.branch } : {}),
        ...(extraParams ? { extraParams } : {}),
        params,
      },
    };
  }
  if (candidate.kind === "runtimeRecover") {
    const raw = value as {
      projectKey?: unknown;
      projectName?: unknown;
      debugProfileKey?: unknown;
      envOverrides?: unknown;
      expectedPort?: unknown;
      replayAction?: unknown;
    };
    const projectKey = normalizeString(raw.projectKey).trim();
    const projectName = normalizeString(raw.projectName).trim() || projectKey;
    if (
      !projectKey ||
      (raw.replayAction !== "start" && raw.replayAction !== "stop")
    ) {
      return null;
    }
    const expectedPort =
      typeof raw.expectedPort === "number" &&
      Number.isInteger(raw.expectedPort) &&
      raw.expectedPort > 0 &&
      raw.expectedPort <= 65_535
        ? raw.expectedPort
        : null;
    return {
      kind: candidate.kind,
      label,
      projectKey,
      projectName,
      debugProfileKey: normalizeNullableString(raw.debugProfileKey),
      envOverrides: normalizeStringRecord(raw.envOverrides),
      expectedPort,
      replayAction: raw.replayAction,
    };
  }
  if (candidate.kind === "proxyRecover") {
    const raw = value as {
      profileId?: unknown;
      profileName?: unknown;
      sourceId?: unknown;
      replayAction?: unknown;
    };
    const profileId = normalizeString(raw.profileId).trim();
    const profileName = normalizeString(raw.profileName).trim() || profileId;
    if (
      !profileId ||
      (raw.replayAction !== "start" && raw.replayAction !== "stop")
    ) {
      return null;
    }
    return {
      kind: candidate.kind,
      label,
      profileId,
      profileName,
      sourceId: normalizeNullableString(raw.sourceId),
      replayAction: raw.replayAction,
    };
  }
  return null;
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

export function latestActivityExecutionStatus(
  items: Array<
    Pick<ActivityEntry, "id" | "status" | "createdAt" | "updatedAt">
  >,
): ActivityStatus {
  const latest = items.reduce<(typeof items)[number] | null>((current, item) => {
    if (!current) {
      return item;
    }
    const order =
      item.updatedAt.localeCompare(current.updatedAt) ||
      item.createdAt.localeCompare(current.createdAt) ||
      item.id.localeCompare(current.id);
    return order > 0 ? item : current;
  }, null);
  return latest?.status ?? "info";
}

export function normalizeActivityEntry(value: unknown): ActivityEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ActivityEntry>;
  const kind = normalizeActivityKind(candidate.kind);
  if (
    typeof candidate.id !== "string" ||
    !kind ||
    !ACTIVITY_STATUSES.has(candidate.status as ActivityStatus) ||
    typeof candidate.title !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return null;
  }

  const createdAt =
    normalizeActivityTimestamp(candidate.createdAt) || new Date().toISOString();
  const updatedAt = normalizeActivityTimestamp(candidate.updatedAt, createdAt);
  const summary = candidate.summary;
  return {
    id: candidate.id,
    kind,
    origin: normalizeActivityOrigin(candidate.origin),
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
    parameters: normalizeActivityParameters(candidate.parameters),
    diagnostics: normalizeActivityDiagnostics(candidate.diagnostics),
    warnings: normalizeStringList(candidate.warnings),
    target: normalizeActivityTarget(candidate.target),
    resource: normalizeActivityResource(candidate.resource),
    action: normalizeActivityAction(candidate.action),
    syncFailureCount: normalizeBuildSyncFailureCount(summary, candidate.syncFailureCount),
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
    id: draft.id || createClientOperationId(draft.kind),
    kind: draft.kind,
    origin: draft.origin ?? null,
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
    parameters: draft.parameters ?? [],
    diagnostics: draft.diagnostics ?? [],
    warnings: draft.warnings ?? [],
    target: draft.target ?? null,
    resource: draft.resource ?? null,
    action: draft.action ?? null,
    syncFailureCount: draft.syncFailureCount ?? 0,
    acknowledgedAt: draft.acknowledgedAt ?? null,
    createdAt: draft.createdAt || now,
    updatedAt: draft.updatedAt || now,
  })!;
}
