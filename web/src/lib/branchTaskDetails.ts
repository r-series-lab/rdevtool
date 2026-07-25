import type {
  BranchTaskItemResult,
  BranchTaskReplayRequest,
  BranchTaskResponse,
} from "../app-types";

type BranchTaskDetailSource = Pick<BranchTaskResponse, "detail" | "items">;

function branchTaskTarget(item: BranchTaskItemResult) {
  return item.targetBranch?.trim() || item.outputPath?.trim() || "-";
}

export function humanizeBranchTaskFailure(detail: string) {
  const normalized = detail.trim();
  if (!normalized) {
    return "";
  }
  if (/\b401\b|unauthorized/i.test(normalized)) {
    return "GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。";
  }
  if (/\b403\b|forbidden/i.test(normalized)) {
    return "GitLab 拒绝了本次操作（HTTP 403），请检查访问令牌权限和项目成员权限。";
  }
  if (/\b409\b|merge conflict|conflict/i.test(normalized)) {
    return "分支存在合并冲突（HTTP 409），请先处理冲突后重试。";
  }
  return normalized;
}

function branchTaskFailureDetail(item: BranchTaskItemResult) {
  const projectName = item.projectName.trim() || item.projectKey.trim() || "项目";
  const sourceBranch = item.sourceBranch.trim() || "-";
  const heading = `${projectName}: ${sourceBranch} -> ${branchTaskTarget(item)} [${
    item.summary.trim() || item.statusLabel.trim() || "失败"
  }]`;
  const reason = humanizeBranchTaskFailure(item.detail);
  return reason ? `${heading}\n原因：${reason}` : heading;
}

export function branchTaskDisplayDetail(result: BranchTaskDetailSource) {
  const failures = result.items.filter((item) => !item.success);
  if (failures.length === 0) {
    return result.detail.trim();
  }
  return failures.map(branchTaskFailureDetail).join("\n\n");
}

export function branchTaskDiagnosticSteps(
  result: Pick<BranchTaskResponse, "taskKind" | "items">,
) {
  return result.items.map((item, index) => {
    const reason = item.success ? "" : humanizeBranchTaskFailure(item.detail);
    return {
      id: `${result.taskKind}:${item.projectKey}:${index}`,
      type: `git.${result.taskKind}`,
      label: item.projectName.trim() || item.projectKey,
      status: item.success ? "success" : "failed",
      summary: item.summary.trim() || item.statusLabel.trim() || item.detail.trim(),
      risks: reason ? [reason] : [],
    };
  });
}

export function branchTaskFailureReplay(
  result: Pick<BranchTaskResponse, "success" | "items">,
  replay: BranchTaskReplayRequest,
): BranchTaskReplayRequest | null {
  if (result.success) {
    return null;
  }
  const projectStates = new Map<string, { succeeded: boolean; failed: boolean }>();
  for (const item of result.items) {
    const projectKey = item.projectKey.trim();
    if (!projectKey) {
      continue;
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
    [...projectStates.values()].some(
      (state) => state.succeeded && state.failed,
    )
  ) {
    return null;
  }

  const failedProjects = new Set(
    [...projectStates.entries()]
      .filter(([, state]) => state.failed)
      .map(([projectKey]) => projectKey),
  );
  if (failedProjects.size === 0) {
    return null;
  }

  const request = { ...replay.request };
  if (Array.isArray(request.projects)) {
    const projects = request.projects.filter(
      (project): project is string =>
        typeof project === "string" && failedProjects.has(project.trim()),
    );
    if (projects.length === 0) {
      return null;
    }
    request.projects = projects;
  } else {
    const project = typeof request.project === "string"
      ? request.project.trim()
      : "";
    if (!project || !failedProjects.has(project)) {
      return null;
    }
  }

  return {
    ...replay,
    request,
  };
}
