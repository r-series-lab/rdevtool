import type {
  ProjectRuntimeContextSnapshot,
  ProjectRuntimeReadyProbeSummary,
} from "../app-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRuntimeSession(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.phase === "string" &&
    typeof value.running === "boolean" &&
    typeof value.managed === "boolean" &&
    typeof value.adopted === "boolean" &&
    typeof value.cwd === "string"
  );
}

function isOperationItems(
  value: unknown,
  requiredFields: string[],
): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        requiredFields.every((field) => typeof item[field] === "string"),
    )
  );
}

export function isProjectRuntimeContextSnapshot(
  value: unknown,
): value is ProjectRuntimeContextSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.schemaVersion === "number" &&
    isRecord(value.requested) &&
    typeof value.requested.projectKey === "string" &&
    isStringArray(value.requested.envKeys) &&
    isRecord(value.effective) &&
    isRecord(value.observed) &&
    typeof value.observed.available === "boolean" &&
    Array.isArray(value.observed.sessions) &&
    value.observed.sessions.every(isRuntimeSession) &&
    isRecord(value.status) &&
    typeof value.status.key === "string" &&
    typeof value.status.label === "string" &&
    typeof value.status.success === "boolean" &&
    typeof value.status.terminal === "boolean" &&
    typeof value.status.detail === "string" &&
    isOperationItems(value.evidence, ["kind", "source", "detail"]) &&
    isOperationItems(value.risks, ["code", "severity", "detail"]) &&
    isOperationItems(value.managedArtifacts, [
      "kind",
      "path",
      "ownership",
      "lifecycle",
    ]) &&
    isOperationItems(value.recommendedActions, ["command", "reason", "risk"])
  );
}

export function runtimeContextFromExecutionDetail(
  detail: unknown,
): ProjectRuntimeContextSnapshot | null {
  if (isProjectRuntimeContextSnapshot(detail)) {
    return detail;
  }
  if (!isRecord(detail)) {
    return null;
  }
  return isProjectRuntimeContextSnapshot(detail.runtime) ? detail.runtime : null;
}

export function runtimeReadyProbeLabel(
  probe: ProjectRuntimeReadyProbeSummary | null | undefined,
): string {
  if (!probe) {
    return "未配置";
  }
  const endpoint = probe.url?.trim() || probe.path?.trim() || "默认地址";
  const statuses = probe.expectedStatuses.length
    ? probe.expectedStatuses.join(",")
    : "200-399";
  const timeout = probe.timeoutMs ? ` · ${probe.timeoutMs}ms` : "";
  return `${endpoint} · ${statuses}${timeout}`;
}

export function runtimeContextSelectionLabel(
  context: ProjectRuntimeContextSnapshot,
): string {
  const debugProfile =
    context.effective.debugProfileLabel?.trim() ||
    context.effective.debugProfileKey?.trim() ||
    "默认启动";
  const runtimeProfile =
    context.effective.runtimeProfileLabel?.trim() ||
    context.effective.runtimeProfileKey?.trim();
  return runtimeProfile ? `${debugProfile} · ${runtimeProfile}` : debugProfile;
}
