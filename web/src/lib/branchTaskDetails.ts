import type {
  BranchTaskItemResult,
  BranchTaskReplayRequest,
  BranchTaskResponse,
} from "../app-types";

type BranchTaskDetailSource = Pick<BranchTaskResponse, "detail" | "items">;

type BranchFailureKind =
  | "auth"
  | "forbidden"
  | "conflict"
  | "pipeline"
  | "discussion"
  | "approval"
  | "blocked"
  | "unknown";

const MERGE_STATUS_PATTERN =
  /\b(cannot_be_merged|conflict|has_conflicts|ci_must_pass|ci_still_running|pipeline_blocked|discussions_not_resolved|not_approved|approval_required|unchecked)\b/i;

function branchTaskTarget(item: BranchTaskItemResult) {
  return item.targetBranch?.trim() || item.outputPath?.trim() || "-";
}

function branchFailureKind(detail: string, statusKey = ""): BranchFailureKind {
  const normalized = detail.trim();
  const normalizedStatus = statusKey.trim().toLowerCase();
  if (
    normalizedStatus === "merge_conflict" ||
    /cannot_be_merged|has_conflicts|\bHTTP\s*409\b|merge conflict|存在(?:合并)?冲突|不可合并/i.test(normalized)
  ) {
    return "conflict";
  }
  if (
    normalizedStatus === "merge_pipeline_blocked" ||
    /ci_must_pass|ci_still_running|pipeline_blocked|pipeline[^\n]*(?:failed|running|blocked)|流水线[^\n]*(?:失败|运行中|阻止)/i.test(normalized)
  ) {
    return "pipeline";
  }
  if (
    normalizedStatus === "merge_discussion_blocked" ||
    /discussions_not_resolved|unresolved discussion|未解决[^\n]*讨论/i.test(normalized)
  ) {
    return "discussion";
  }
  if (
    normalizedStatus === "merge_approval_blocked" ||
    /not_approved|approval_required|approval[^\n]*(?:required|missing)|审批[^\n]*(?:未满足|缺失)/i.test(normalized)
  ) {
    return "approval";
  }
  if (
    normalizedStatus === "gitlab_auth_failed" ||
    /\bHTTP\s*401\b|\b401\s+Unauthorized\b|\bunauthorized\b/i.test(normalized)
  ) {
    return "auth";
  }
  if (
    normalizedStatus === "gitlab_forbidden" ||
    /\bHTTP\s*403\b|\b403\s+Forbidden\b|\bforbidden\b/i.test(normalized)
  ) {
    return "forbidden";
  }
  if (normalizedStatus === "merge_blocked" || /\bunchecked\b|暂不可合并|阻止合并/i.test(normalized)) {
    return "blocked";
  }
  return "unknown";
}

export function humanizeBranchTaskFailure(detail: string, statusKey = "") {
  const normalized = detail.trim();
  if (!normalized) {
    return "";
  }
  switch (branchFailureKind(normalized, statusKey)) {
    case "auth":
      return "GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。";
    case "forbidden":
      return "GitLab 拒绝了本次操作（HTTP 403），请检查访问令牌权限和项目成员权限。";
    case "conflict":
      return "分支存在合并冲突，请先处理冲突后重试。";
    case "pipeline":
      return "GitLab 流水线尚未通过，当前不能合并。";
    case "discussion":
      return "GitLab 合并请求仍有未解决的讨论，当前不能合并。";
    case "approval":
      return "GitLab 合并请求尚未满足审批条件，当前不能合并。";
    case "blocked":
      return "GitLab 当前暂不可合并，请检查合并请求状态。";
    default:
      return normalized;
  }
}

function branchTaskFailureSuggestion(item: BranchTaskItemResult, kind: BranchFailureKind) {
  const sourceBranch = item.sourceBranch.trim() || "源分支";
  const targetBranch = branchTaskTarget(item);
  switch (kind) {
    case "conflict":
      return `先解决 ${sourceBranch} -> ${targetBranch} 的合并冲突后重试。`;
    case "auth":
      return "更新或重新配置有效的 GitLab 访问令牌后重试。";
    case "forbidden":
      return "检查访问令牌 API 权限、项目成员角色和目标分支保护规则后重试。";
    case "pipeline":
      return "等待流水线通过或修复失败任务后重试。";
    case "discussion":
      return "解决合并请求中的未解决讨论后重试。";
    case "approval":
      return "完成合并请求要求的审批后重试。";
    case "blocked":
      return "打开合并请求检查详细合并状态后重试。";
    default:
      return "";
  }
}

function mergeRequestMetadata(detail: string) {
  const iid = detail.match(/\bMR\s*!([0-9]+)\b/i)?.[1] ?? "";
  const status = detail.match(MERGE_STATUS_PATTERN)?.[1] ?? "";
  const url = detail.match(/https?:\/\/[^\s）)]+\/merge_requests\/[0-9]+/i)?.[0] ?? "";
  return { iid, status, url };
}

export function branchTaskFailureDetail(item: BranchTaskItemResult) {
  const projectName = item.projectName.trim() || item.projectKey.trim() || "项目";
  const sourceBranch = item.sourceBranch.trim() || "-";
  const heading = `${projectName}: ${sourceBranch} -> ${branchTaskTarget(item)} [${
    item.summary.trim() || item.statusLabel.trim() || "失败"
  }]`;
  const explanation = branchTaskFailureExplanation(item);
  return [heading, explanation].filter(Boolean).join("\n");
}

export function branchTaskFailureExplanation(item: BranchTaskItemResult) {
  const kind = branchFailureKind(item.detail, item.statusKey);
  const reason = humanizeBranchTaskFailure(item.detail, item.statusKey);
  const metadata = mergeRequestMetadata(item.detail);
  const suggestion = branchTaskFailureSuggestion(item, kind);
  return [
    reason ? `原因：${reason}` : "",
    metadata.status ? `GitLab 状态：${metadata.status}` : "",
    metadata.iid ? `MR：!${metadata.iid}` : "",
    metadata.url ? `链接：${metadata.url}` : "",
    suggestion ? `建议：${suggestion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function middleTruncateBranch(value: string, maxLength = 36) {
  const characters = Array.from(value.trim());
  if (characters.length <= maxLength || maxLength < 8) {
    return characters.join("");
  }
  const visibleLength = maxLength - 3;
  const prefixLength = Math.ceil(visibleLength * 0.58);
  const suffixLength = visibleLength - prefixLength;
  return `${characters.slice(0, prefixLength).join("")}...${characters
    .slice(characters.length - suffixLength)
    .join("")}`;
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
    const reason = item.success
      ? ""
      : humanizeBranchTaskFailure(item.detail, item.statusKey);
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
