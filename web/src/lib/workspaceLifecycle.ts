import type {
  ProjectWorkspaceSummary,
  WorkspaceArchiveBlocker,
  WorkspaceArchivePlan,
} from "../app-types";

export function workspaceArchiveDescription(plan: WorkspaceArchivePlan) {
  const parts = [
    `归档“${plan.workspaceName}”后，它将从侧栏、托盘和日常工作区列表隐藏，配置、目录、历史和标记都会保留。`,
  ];
  if (plan.blockers.length > 0) {
    parts.push(
      `将先停止 ${plan.blockers.length} 个受管运行项：${plan.blockers
        .map((blocker) => blocker.label)
        .join("、")}。`,
    );
  }
  if (plan.active) {
    parts.push("当前工作区会切换到全局。");
  }
  if (plan.warnings.length > 0) {
    parts.push(`状态检查提示：${plan.warnings.join("；")}。`);
  }
  return parts.join("\n");
}

export function unmanagedWorkspaceArchiveBlocker(
  plan: WorkspaceArchivePlan,
): WorkspaceArchiveBlocker | null {
  return plan.blockers.find((blocker) => !blocker.managed) ?? null;
}

export function workspaceArchiveMeta(workspace: ProjectWorkspaceSummary) {
  let date = "已归档";
  if (workspace.archivedAt) {
    const parsed = new Date(workspace.archivedAt);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed.toLocaleDateString();
    }
  }
  return workspace.archiveReason ? `${date} · ${workspace.archiveReason}` : date;
}

export function normalizeWorkspaceArchiveReason(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}
