export const OPERATION_SUBMITTING_STATE = "submitting";

const ACTIVE_OPERATION_STATES = new Set([
  OPERATION_SUBMITTING_STATE,
  "accepted",
  "queued",
  "running",
]);

export function isOperationActiveState(stateKey?: string | null) {
  return ACTIVE_OPERATION_STATES.has(stateKey?.trim().toLowerCase() ?? "");
}

export function createClientOperationId(prefix: string) {
  const normalizedPrefix = prefix.trim().toLowerCase() || "operation";
  return `${normalizedPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
