import type { ManagedArtifactCleanupPlanResponse } from "../app-types";
import type { Translate } from "../i18n";

export const MANAGED_ARTIFACT_KIND_KEYS = [
  "workspaceConfig",
  "workspaceProjectInstance",
  "runtimeState",
  "runtimeDaemonLog",
  "runtimeLog",
  "proxyState",
  "proxyDaemonLog",
  "proxyStopRequest",
  "proxyLock",
  "proxyEventLog",
] as const;

const ARTIFACT_KIND_MESSAGES: Record<string, string> = {
  workspaceConfig: "工作区配置",
  workspaceProjectInstance: "工作区副本",
  runtimeState: "Runtime 状态",
  runtimeDaemonLog: "Runtime daemon 日志",
  runtimeLog: "Runtime 历史日志",
  proxyState: "Proxy 状态",
  proxyDaemonLog: "Proxy daemon 日志",
  proxyStopRequest: "Proxy 停止请求",
  proxyLock: "Proxy 锁文件",
  proxyEventLog: "Proxy 事件历史",
};

const OBJECT_TYPE_MESSAGES: Record<string, string> = {
  directory: "目录",
  file: "文件",
  symlink: "符号链接",
  other: "其他",
  missing: "路径缺失",
  unknown: "未知",
};

export function managedArtifactKindLabel(kind: string, t: Translate) {
  return t(ARTIFACT_KIND_MESSAGES[kind] ?? kind);
}

export function managedArtifactObjectTypeLabel(
  objectType: string,
  t: Translate,
) {
  return t(OBJECT_TYPE_MESSAGES[objectType] ?? objectType);
}

export function managedArtifactDetailLabel(detail: string, t: Translate) {
  return t(detail);
}

function shellQuote(value: string) {
  return /^[A-Za-z0-9._:/-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export function managedArtifactCleanupPlanCommand(
  plan: ManagedArtifactCleanupPlanResponse,
) {
  const parts = ["rdevtool", "--json", "artifacts", "cleanup-plan"];
  if (plan.requested.allWorkspaces) {
    parts.push("--all-workspaces");
  } else if (plan.requested.workspace) {
    parts.push("--workspace", shellQuote(plan.requested.workspace));
  }
  if (plan.requested.project) {
    parts.push("--project", shellQuote(plan.requested.project));
  }
  for (const kind of plan.requested.kinds) {
    parts.push("--kind", shellQuote(kind));
  }
  for (const artifactId of plan.requested.artifactIds) {
    parts.push("--artifact-id", shellQuote(artifactId));
  }
  return parts.join(" ");
}
