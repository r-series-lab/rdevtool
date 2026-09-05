import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const TRAY_PINNED_STORAGE_LIMIT = 60;
export const TRAY_PINNED_ACTIONS_CHANGED_EVENT =
  "rdevtool://tray-pinned-actions-changed";
const BUILD_REPLAY_KIND = "build.replay";
const LEGACY_DEPLOY_REPLAY_KIND = "deploy.replay";

export type TrayPinnedAction = {
  kind: string;
  label: string;
  detail?: string | null;
  workspaceKey?: string | null;
  projectKey?: string | null;
  entry?: unknown | null;
  payload?: unknown | null;
  executionContext?: {
    chainId?: string | null;
    parentId?: string | null;
    stepLabel?: string | null;
    chainLabel?: string | null;
  } | null;
  dedupeKey: string;
  updatedAtMs: number;
};

export type TrayPinnedActionsSnapshot = {
  revision: number;
  actions: TrayPinnedAction[];
};

export type WorkspacePinnedActionsPatch<TAction = unknown> = {
  key: string;
  actionCount: number;
  actions: TAction[];
};

export type TrayPinnedActionsChangedPayload = TrayPinnedActionsSnapshot & {
  mutation: string;
  dedupeKeys: string[];
  workspacePatches: WorkspacePinnedActionsPatch[];
  requiresOverviewRefresh: boolean;
};

function isTrayPinnedAction(value: unknown): value is TrayPinnedAction {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<TrayPinnedAction>;
  return Boolean(
    candidate.kind &&
      candidate.label &&
      candidate.dedupeKey &&
      typeof candidate.kind === "string" &&
      typeof candidate.label === "string" &&
      typeof candidate.dedupeKey === "string",
  );
}

function normalizeTrayPinnedKind(kind: string) {
  const normalized = kind.trim();
  return normalized === LEGACY_DEPLOY_REPLAY_KIND ? BUILD_REPLAY_KIND : normalized;
}

function normalizeTrayPinnedDedupeKey(dedupeKey: string) {
  const normalized = dedupeKey.trim();
  return normalized.startsWith(`${LEGACY_DEPLOY_REPLAY_KIND}:`)
    ? `${BUILD_REPLAY_KIND}:${normalized.slice(LEGACY_DEPLOY_REPLAY_KIND.length + 1)}`
    : normalized;
}

export function normalizeTrayPinnedActions(actions: unknown[]): TrayPinnedAction[] {
  const normalized: TrayPinnedAction[] = [];
  for (const action of actions) {
    if (!isTrayPinnedAction(action)) {
      continue;
    }
    const kind = normalizeTrayPinnedKind(action.kind);
    const dedupeKey = normalizeTrayPinnedDedupeKey(action.dedupeKey);
    if (normalized.some((item) => item.dedupeKey === dedupeKey)) {
      continue;
    }
    normalized.push({
      kind,
      label: action.label.trim(),
      detail: action.detail ?? null,
      workspaceKey: action.workspaceKey?.trim() || null,
      projectKey: action.projectKey ?? null,
      entry: action.entry ?? null,
      payload: action.payload ?? null,
      dedupeKey,
      updatedAtMs: Number(action.updatedAtMs) || Date.now(),
    });
    if (normalized.length >= TRAY_PINNED_STORAGE_LIMIT) {
      break;
    }
  }
  return normalized;
}

export async function getTrayPinnedActions() {
  const actions = await invoke<unknown[]>("get_tray_pinned_actions");
  return normalizeTrayPinnedActions(actions);
}

function normalizeSnapshot(value: unknown): TrayPinnedActionsSnapshot {
  const snapshot =
    value && typeof value === "object"
      ? (value as Partial<TrayPinnedActionsSnapshot>)
      : {};
  return {
    revision: Math.max(0, Number(snapshot.revision) || 0),
    actions: normalizeTrayPinnedActions(
      Array.isArray(snapshot.actions) ? snapshot.actions : [],
    ),
  };
}

function normalizeWorkspacePatches(
  value: unknown,
): WorkspacePinnedActionsPatch[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const patch = item as Partial<WorkspacePinnedActionsPatch>;
    const key = typeof patch.key === "string" ? patch.key.trim() : "";
    if (!key || !Array.isArray(patch.actions)) {
      return [];
    }
    return [
      {
        key,
        actionCount: Math.max(
          0,
          Number.isFinite(Number(patch.actionCount))
            ? Number(patch.actionCount)
            : patch.actions.length,
        ),
        actions: patch.actions,
      },
    ];
  });
}

export async function getTrayPinnedActionsSnapshot() {
  return normalizeSnapshot(
    await invoke<unknown>("get_tray_pinned_actions_snapshot"),
  );
}

export async function setTrayPinnedActions(actions: TrayPinnedAction[]) {
  const normalized = normalizeTrayPinnedActions(actions);
  await invoke("set_tray_pinned_actions", { actions: normalized });
  return normalized;
}

export async function upsertTrayPinnedAction(action: TrayPinnedAction) {
  return normalizeSnapshot(
    await invoke<unknown>("upsert_tray_pinned_action", {
      action: normalizeTrayPinnedActions([action])[0],
    }),
  );
}

export async function removeTrayPinnedActions(dedupeKeys: string[]) {
  return normalizeSnapshot(
    await invoke<unknown>("remove_tray_pinned_actions", { dedupeKeys }),
  );
}

export async function listenTrayPinnedActionsChanged(
  listener: (payload: TrayPinnedActionsChangedPayload) => void,
) {
  return listen<unknown>(TRAY_PINNED_ACTIONS_CHANGED_EVENT, (event) => {
    const raw =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Partial<TrayPinnedActionsChangedPayload>)
        : {};
    const snapshot = normalizeSnapshot(raw);
    listener({
      ...snapshot,
      mutation: typeof raw.mutation === "string" ? raw.mutation : "replace",
      dedupeKeys: Array.isArray(raw.dedupeKeys)
        ? raw.dedupeKeys.filter(
            (key): key is string => typeof key === "string" && Boolean(key.trim()),
          )
        : [],
      workspacePatches: normalizeWorkspacePatches(raw.workspacePatches),
      requiresOverviewRefresh: raw.requiresOverviewRefresh === true,
    });
  });
}
