import { invoke } from "@tauri-apps/api/core";

export const TRAY_PINNED_LIMIT = 5;

export type TrayPinnedAction = {
  kind: string;
  label: string;
  detail?: string | null;
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

export function normalizeTrayPinnedActions(actions: unknown[]): TrayPinnedAction[] {
  const normalized: TrayPinnedAction[] = [];
  for (const action of actions) {
    if (!isTrayPinnedAction(action)) {
      continue;
    }
    if (normalized.some((item) => item.dedupeKey === action.dedupeKey)) {
      continue;
    }
    normalized.push({
      kind: action.kind.trim(),
      label: action.label.trim(),
      detail: action.detail ?? null,
      projectKey: action.projectKey ?? null,
      entry: action.entry ?? null,
      payload: action.payload ?? null,
      dedupeKey: action.dedupeKey.trim(),
      updatedAtMs: Number(action.updatedAtMs) || Date.now(),
    });
    if (normalized.length >= TRAY_PINNED_LIMIT) {
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
