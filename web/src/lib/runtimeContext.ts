import type {
  ProjectRuntimeContextSnapshot,
  ProjectRuntimeReadyProbeSummary,
  ProjectRuntimeWorkspaceContext,
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

export function runtimeWorkspaceScopeLabel(
  workspace?: Pick<ProjectRuntimeWorkspaceContext, "runtimeProfileScope"> | null,
): string {
  if (!workspace) {
    return "当前工作区";
  }
  if (workspace.runtimeProfileScope === "workspaceOverride") {
    return "工作区运行环境";
  }
  if (workspace.runtimeProfileScope === "inherited") {
    return "继承的共享环境";
  }
  return "全局共享环境";
}

export function runtimeValueSourceLabel(
  source?: string | null,
  workspace?: ProjectRuntimeWorkspaceContext | null,
): string {
  const normalized = source?.trim() ?? "";
  if (normalized.startsWith("debugProfile")) {
    return "项目启动档案";
  }
  if (normalized.startsWith("runtimeProfile")) {
    return runtimeWorkspaceScopeLabel(workspace);
  }
  if (normalized.startsWith("workspaceProjectInstance.debugProfile")) {
    return "工作区实例 + 启动档案";
  }
  if (normalized.startsWith("workspaceProjectInstance")) {
    return "工作区项目实例";
  }
  switch (normalized) {
    case "launchOverride":
    case "launch override":
      return "本次启动覆盖";
    case "project.dev.env":
    case "projectDev":
    case "projectFocus":
    case "projectFocusUrl":
      return "项目基础";
    case "projectRepo":
      return workspace?.projectInstancePath ? "工作区项目实例" : "项目目录";
    case "workspaceContext":
      return "工作区上下文";
    case "networkProxy":
    case "networkProxy.nodeHook":
      return "代理注入";
    case "commandArg":
      return "启动命令参数";
    case "packageScript":
      return "package 脚本";
    case "envPort":
      return "环境变量 PORT";
    case "systemDefault":
      return "系统默认";
    case "direct":
      return "直连";
    default:
      return normalized || "未解析";
  }
}
