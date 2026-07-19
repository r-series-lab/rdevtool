import { invoke } from "@tauri-apps/api/core";

export const TRAY_PINNED_STORAGE_LIMIT = 60;
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
  dedupeKey: string;
  updatedAtMs: number;
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

export async function setTrayPinnedActions(actions: TrayPinnedAction[]) {
  const normalized = normalizeTrayPinnedActions(actions);
  await invoke("set_tray_pinned_actions", { actions: normalized });
  return normalized;
}
