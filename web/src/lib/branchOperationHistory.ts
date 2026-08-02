import type {
  BranchTaskHistoryEntry,
  BranchTaskPendingEntry,
  BranchTaskReplayRequest,
  BranchWorkflowMode,
} from "../app-types";

export type BranchOperationProject = {
  key: string;
  name: string;
};

type PendingBranchTaskInput = {
  id: string;
  taskKind: BranchWorkflowMode;
  summary: string;
  projects: BranchOperationProject[];
};

export function createPendingBranchTaskEntry({
  id,
  taskKind,
  summary,
  projects,
}: PendingBranchTaskInput): BranchTaskPendingEntry {
  return {
    id,
    taskKind,
    summary,
    detail: "请求已接收，正在执行 Git 操作",
    projectNames: projects.map((project) => project.name),
    createdAt: new Date().toISOString(),
  };
}

type FailedBranchTaskInput = {
  pending: BranchTaskPendingEntry;
  title: string;
  detail: string;
  workspaceKey: string;
  projects: BranchOperationProject[];
  sourceBranch: string;
  targetBranch: string | null;
  remote: boolean;
  replay: BranchTaskReplayRequest;
};

export function createFailedBranchTaskEntry({
  pending,
  title,
  detail,
  workspaceKey,
  projects,
  sourceBranch,
  targetBranch,
  remote,
  replay,
}: FailedBranchTaskInput): BranchTaskHistoryEntry {
  const summary = `${title}失败`;
  return {
    id: pending.id,
    taskKind: pending.taskKind,
    success: false,
    summary,
    detail,
    items: projects.map((project) => ({
      projectKey: project.key,
      projectName: project.name,
      sourceBranch,
      targetBranch,
      success: false,
      statusKey: "invoke_failed",
      statusLabel: "执行失败",
      summary,
      detail,
      remote,
    })),
    createdAt: pending.createdAt,
    workspaceKey,
    replay,
  };
}

export function inferBranchSyncReplay(
  entry: Pick<BranchTaskHistoryEntry, "taskKind" | "success" | "items">,
): BranchTaskReplayRequest | null {
  if (entry.taskKind !== "sync" || entry.items.length === 0) {
    return null;
  }

  const projectStates = new Map<
    string,
    { succeeded: boolean; failed: boolean }
  >();
  for (const item of entry.items) {
    const projectKey = item.projectKey.trim();
    if (!projectKey) {
      return null;
    }
    const state = projectStates.get(projectKey) ?? {
      succeeded: false,
      failed: false,
    };
    state.succeeded ||= item.success;
    state.failed ||= !item.success;
    projectStates.set(projectKey, state);
  }
  if (
    [...projectStates.values()].some((state) => state.succeeded && state.failed)
  ) {
    return null;
  }

  const replayItems = entry.success
    ? entry.items
    : entry.items.filter((item) => !item.success);
  const projects = Array.from(
    new Set(replayItems.map((item) => item.projectKey.trim())),
  );
  const sourceBranches = Array.from(
    new Set(replayItems.map((item) => item.sourceBranch.trim())),
  ).filter(Boolean);
  const targetBranches = Array.from(
    new Set(replayItems.map((item) => item.targetBranch?.trim() ?? "")),
  ).filter(Boolean);
  if (
    projects.length === 0 ||
    sourceBranches.length !== 1 ||
    targetBranches.length === 0
  ) {
    return null;
  }

  return {
    command: "execute_branch_sync_task",
    busyText: "正在重播合并分支",
    request: {
      project: projects[0],
      projects,
      sourceBranch: sourceBranches[0],
      targetBranches,
    },
  };
}
