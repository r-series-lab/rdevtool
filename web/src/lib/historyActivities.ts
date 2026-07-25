import type {
  BranchTaskHistoryEntry,
  BuildHistoryEntry,
  MergeHistoryEntry,
  OperationEventEntry,
} from "../app-types";
import {
  createActivityEntry,
  stableActivityJson,
  type ActivityAction,
  type ActivityBuildReplayRequest,
  type ActivityEntry,
  type ActivityParameter,
  type ActivityStatus,
} from "./activityCenter";
import {
  branchTaskDiagnosticSteps,
  branchTaskDisplayDetail,
  branchTaskFailureReplay,
} from "./branchTaskDetails";
import {
  activityFromLifecycleOperationEvent,
  activityFromOperationEvent as activityFromGitOperationEvent,
  buildHistoryFromOperationEvent,
  buildReplayRequestFromOperationEvent,
  isOperationEventEntry,
} from "./operationEvents";

const BUILD_ACTIVITY_PARAMETER_LIMIT = 8;
const BUILD_ENV_PARAM_KEYS = new Set(["ENV_PROFILE", "projectEnv", "env"]);
const BUILD_BRANCH_PARAM_KEYS = new Set(["BRANCH", "branch", "Branch"]);
const SENSITIVE_BUILD_PARAM_PATTERN = /(token|secret|password|passwd|pwd|credential|auth|private)/i;

type BuildActivityParameterSource = Pick<
  BuildHistoryEntry,
  "mode" | "env" | "branch" | "params"
>;

export type BuildActivityParameterMeta = {
  key: string;
  label: string;
  kind?: string | null;
};

function historyActivityStatus(stateKey: string): ActivityStatus {
  if (stateKey === "accepted" || stateKey === "queued" || stateKey === "running") {
    return "running";
  }
  if (
    stateKey === "failed" ||
    stateKey === "failure" ||
    stateKey === "error" ||
    stateKey === "canceled" ||
    stateKey === "cancelled" ||
    stateKey === "aborted"
  ) {
    return "failed";
  }
  if (stateKey === "success" || stateKey === "succeeded") {
    return "success";
  }
  return "info";
}

function buildHistoryTitle(mode: string) {
  const normalized = mode.trim().toLowerCase();
  if (normalized === "package") {
    return "产物构建";
  }
  if (normalized === "release") {
    return "发布";
  }
  if (
    normalized === "vke" ||
    normalized === "standard" ||
    normalized === "variant" ||
    normalized === "deploy"
  ) {
    return "部署";
  }
  return "构建";
}

export function buildRecoveryActionForRequest(
  request: ActivityBuildReplayRequest,
  projectName: string,
  workspaceKey?: string | null,
): ActivityAction | null {
  const projectKey = request.project.trim();
  const target = request.target?.trim() || null;
  if (!projectKey || !target) {
    return null;
  }
  return {
    kind: "buildRecover",
    label: `重新规划并重试${buildHistoryTitle(target)}`,
    projectKey,
    projectName: projectName.trim() || projectKey,
    workspaceKey: workspaceKey?.trim() || null,
    request: {
      ...request,
      project: projectKey,
      target,
      params: normalizedBuildParams(request.params),
      ...(request.extraParams
        ? { extraParams: normalizedBuildParams(request.extraParams) }
        : {}),
    },
  };
}

export function buildRecoveryAction(
  item: BuildHistoryEntry,
  replayRequest?: ActivityBuildReplayRequest | null,
) {
  if (historyActivityStatus(item.stateKey) !== "failed") {
    return null;
  }
  return buildRecoveryActionForRequest(
    replayRequest ?? {
      project: item.projectKey,
      target: item.mode || null,
      variant: false,
      env: item.env || null,
      branch: item.branch || null,
      params: normalizedBuildParams(item.params),
    },
    item.projectName,
    item.workspaceKey,
  );
}

function normalizedBuildParams(params?: Record<string, string> | null) {
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([key, value]) => [key, String(value ?? "")]),
  );
}

export function buildActivityParameters(
  item: BuildActivityParameterSource,
  paramMeta: BuildActivityParameterMeta[] = [],
): ActivityParameter[] {
  const metaByKey = new Map(paramMeta.map((param) => [param.key, param]));
  const parameters: ActivityParameter[] = [];
  const seenKeys = new Set<string>();
  const push = (key: string, label: string, value: string, masked = false) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    parameters.push({ key, label, value: normalizedValue, masked });
  };

  push("target", "目标", item.mode);
  push("environment", "环境", item.env);
  push("branch", "分支", item.branch);

  for (const [key, rawValue] of Object.entries(normalizedBuildParams(item.params))) {
    if (BUILD_ENV_PARAM_KEYS.has(key) || BUILD_BRANCH_PARAM_KEYS.has(key)) {
      continue;
    }
    const meta = metaByKey.get(key);
    const masked = meta?.kind === "hidden" || SENSITIVE_BUILD_PARAM_PATTERN.test(key);
    const value = rawValue.trim();
    push(
      key,
      meta?.label.trim() || key,
      masked ? (value ? "已配置" : "未配置") : value || "-",
      masked,
    );
  }

  if (parameters.length <= BUILD_ACTIVITY_PARAMETER_LIMIT) {
    return parameters;
  }
  const hiddenCount = parameters.length - (BUILD_ACTIVITY_PARAMETER_LIMIT - 1);
  return [
    ...parameters.slice(0, BUILD_ACTIVITY_PARAMETER_LIMIT - 1),
    {
      key: "more",
      label: "其他",
      value: `另有 ${hiddenCount} 项`,
    },
  ];
}

function buildHistoryExecutionKey(item: BuildHistoryEntry) {
  return `build:${item.projectKey}:${item.mode}:${stableActivityJson(
    normalizedBuildParams(item.params),
  )}`;
}

function buildHistoryUrls(item: BuildHistoryEntry) {
  return [item.queueUrl, item.buildUrl]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
}

function activityUrls(item: ActivityEntry) {
  return [item.resource?.value, item.detail]
    .map((value) => value?.trim() ?? "")
    .filter((value) => /^https?:\/\//i.test(value));
}

function mergeHistoryParameterSummary(item: MergeHistoryEntry) {
  const projectName = item.projectName.trim() || item.projectKey.trim() || "项目";
  const sourceBranch = item.sourceBranch.trim() || "-";
  const targetBranch = item.targetBranch.trim() || "-";
  const statusLabel = item.success ? "已合并" : "合并失败";
  return `${projectName}: ${sourceBranch} -> ${targetBranch} [${statusLabel}]`;
}

export function activityFromBuildHistory(
  item: BuildHistoryEntry,
  replayRequest?: ActivityBuildReplayRequest | null,
) {
  const url = item.buildUrl || item.queueUrl || null;
  const action = buildRecoveryAction(item, replayRequest);
  const failed = historyActivityStatus(item.stateKey) === "failed";
  return createActivityEntry({
    id: `history-build:${item.historyKey}`,
    kind: "build",
    status: historyActivityStatus(item.stateKey),
    title: buildHistoryTitle(item.mode),
    summary: item.detail
      ? `${item.stateLabel} · ${item.detail}`
      : item.stateLabel,
    detail: url,
    executionKey: buildHistoryExecutionKey(item),
    projectKey: item.projectKey,
    projectName: item.projectName,
    parameters: buildActivityParameters(item),
    target: {
      page: "build",
      projectKey: item.projectKey,
    },
    resource: url
      ? {
          kind: "url",
          label: "打开构建记录",
          value: url,
        }
      : null,
    action,
    warnings: failed && !action
      ? ["该记录缺少明确的构建目标，无法安全重放；请打开构建页重新选择目标。"]
      : [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

function activityFromPersistedOperationEvent(event: OperationEventEntry) {
  if (event.domain === "git") {
    return activityFromGitOperationEvent(event);
  }
  if (event.domain === "runtime" || event.domain === "proxy" || event.domain === "link") {
    return activityFromLifecycleOperationEvent(event);
  }
  if (event.domain !== "build") {
    return null;
  }
  const history = buildHistoryFromOperationEvent(event);
  if (!history) {
    return createActivityEntry({
      id: event.id,
      kind: "build",
      origin: event.origin,
      status: event.state,
      title: event.title,
      summary: event.summary,
      detail: event.detail || null,
      executionKey: `operation:${event.id}`,
      projectKey: event.projectKey ?? null,
      projectName: event.projectName ?? null,
      target: {
        page: "build",
        projectKey: event.projectKey ?? null,
      },
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    });
  }
  const activity = activityFromBuildHistory(
    history,
    buildReplayRequestFromOperationEvent(event),
  );
  return {
    ...activity,
    id: event.id,
    origin: event.origin,
    status: event.state,
    title: event.title.trim() || activity.title,
    summary: event.summary.trim() || activity.summary,
    executionKey: `operation:${event.id}`,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function activityFromMergeHistory(item: MergeHistoryEntry) {
  return createActivityEntry({
    id: `history-merge:${item.historyKey}`,
    kind: "branch",
    status: item.success ? "success" : "failed",
    title: "合并分支",
    // Durable CLI history and in-App workflow history must expose the same
    // structured merge parameters. The backend summary is a result message
    // (for example "已通过 GitLab API 合并并推送") and cannot identify the
    // project or branch pair on a collapsed activity card.
    summary: mergeHistoryParameterSummary(item),
    detail: item.detail,
    executionKey: `merge:${item.projectKey}:${item.sourceBranch}:${item.targetBranch}`,
    projectKey: item.projectKey,
    projectName: item.projectName,
    target: {
      page: "merge",
      projectKey: item.projectKey,
      branchMode: "sync",
    },
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
  });
}

function isBranchTaskHistoryEntry(value: unknown): value is BranchTaskHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<BranchTaskHistoryEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.taskKind === "string" &&
    typeof candidate.success === "boolean" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.items) &&
    candidate.items.every(
      (item) =>
        Boolean(item) &&
        typeof item.projectKey === "string" &&
        typeof item.projectName === "string" &&
        typeof item.sourceBranch === "string" &&
        typeof item.success === "boolean" &&
        typeof item.statusLabel === "string" &&
        typeof item.summary === "string" &&
        typeof item.detail === "string",
    )
  );
}

function branchTaskHistoryTitle(item: BranchTaskHistoryEntry) {
  if (item.taskKind === "create") return "创建分支";
  if (item.taskKind === "checkout") return "克隆分支";
  if (item.taskKind === "switch") return "切换分支";
  if (item.taskKind === "push") {
    return item.items.some((entry) => entry.statusKey === "committed_and_pushed")
      ? "提交并推送"
      : "推送分支";
  }
  return "合并分支";
}

export function activityFromBranchTaskHistory(item: BranchTaskHistoryEntry) {
  const project = item.items[0];
  const recoveryReplay = item.replay
    ? branchTaskFailureReplay(item, item.replay)
    : null;
  return createActivityEntry({
    id: `history-branch:${item.id}`,
    kind: "branch",
    status: item.success ? "success" : "failed",
    title: branchTaskHistoryTitle(item),
    summary: item.summary,
    detail: branchTaskDisplayDetail(item),
    executionKey: `branch-history:${item.taskKind}:${item.id}`,
    projectKey: project?.projectKey ?? null,
    projectName: project?.projectName ?? null,
    diagnostics: branchTaskDiagnosticSteps(item),
    warnings: !item.success && item.replay && !recoveryReplay
      ? ["当前批次包含同一项目的部分成功结果，请打开 Git 页面核对后按剩余目标执行。"]
      : [],
    target: {
      page: "merge",
      projectKey: project?.projectKey ?? null,
      branchMode: item.taskKind,
    },
    action: recoveryReplay
      ? {
          kind: "branchReplay",
          label: "检查并重试 Git 操作",
          replay: recoveryReplay,
        }
      : null,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
  });
}

function mergeExistingBuildActivity(
  historyActivity: ActivityEntry,
  item: BuildHistoryEntry,
  existing: ActivityEntry[],
) {
  const historyUrls = new Set(buildHistoryUrls(item));
  const matchIndex = existing.findIndex((activity) => {
    if (activity.kind !== "build" || activity.projectKey !== item.projectKey) {
      return false;
    }
    if (historyUrls.size > 0) {
      return activityUrls(activity).some((url) => historyUrls.has(url));
    }
    const closeInTime = Math.abs(
      Date.parse(activity.createdAt) - Date.parse(item.createdAt),
    ) <= 15_000;
    return closeInTime && activity.executionKey === historyActivity.executionKey;
  });
  if (matchIndex < 0) {
    return historyActivity;
  }

  const [matched] = existing.splice(matchIndex, 1);
  return {
    ...matched,
    ...historyActivity,
    id: matched.id,
    title: matched.title || historyActivity.title,
    chainId: matched.chainId,
    parentId: matched.parentId,
    stepLabel: matched.stepLabel,
    chainLabel: matched.chainLabel,
    parameters: matched.parameters?.length
      ? matched.parameters
      : historyActivity.parameters,
    createdAt:
      matched.createdAt.localeCompare(historyActivity.createdAt) <= 0
        ? matched.createdAt
        : historyActivity.createdAt,
  };
}

function mergeExistingBranchActivity(
  historyActivity: ActivityEntry,
  item: BranchTaskHistoryEntry,
  existing: ActivityEntry[],
) {
  const projectKeys = new Set(item.items.map((entry) => entry.projectKey));
  const historyTimestamp = Date.parse(item.createdAt);
  const matchIndex = existing.findIndex((activity) => {
    if (activity.id === historyActivity.id) {
      return true;
    }
    if (
      activity.kind !== "branch" ||
      activity.target?.branchMode !== item.taskKind ||
      activity.summary.trim() !== item.summary.trim()
    ) {
      return false;
    }
    const activityTimestamp = Date.parse(activity.createdAt);
    const closeInTime =
      Number.isFinite(historyTimestamp) &&
      Number.isFinite(activityTimestamp) &&
      Math.abs(activityTimestamp - historyTimestamp) <= 15_000;
    const projectMatches =
      !activity.projectKey || projectKeys.has(activity.projectKey);
    return closeInTime && projectMatches;
  });
  if (matchIndex < 0) {
    return historyActivity;
  }

  const [matched] = existing.splice(matchIndex, 1);
  return {
    ...matched,
    ...historyActivity,
    id: matched.id,
    title: matched.title || historyActivity.title,
    executionKey: matched.executionKey || historyActivity.executionKey,
    chainId: matched.chainId,
    parentId: matched.parentId,
    stepLabel: matched.stepLabel,
    chainLabel: matched.chainLabel,
    resource: matched.resource || historyActivity.resource,
    createdAt:
      matched.createdAt.localeCompare(historyActivity.createdAt) <= 0
        ? matched.createdAt
        : historyActivity.createdAt,
  };
}

function mergeExistingOperationActivity(
  historyActivity: ActivityEntry,
  existing: ActivityEntry[],
) {
  const matchIndex = existing.findIndex(
    (activity) => activity.id === historyActivity.id,
  );
  if (matchIndex < 0) {
    return historyActivity;
  }

  const [matched] = existing.splice(matchIndex, 1);
  return {
    ...matched,
    ...historyActivity,
    id: matched.id,
    executionKey: matched.executionKey || historyActivity.executionKey,
    chainId: matched.chainId,
    parentId: matched.parentId,
    stepLabel: matched.stepLabel,
    chainLabel: matched.chainLabel,
    parameters: matched.parameters?.length
      ? matched.parameters
      : historyActivity.parameters,
    resource: matched.resource || historyActivity.resource,
    acknowledgedAt: matched.acknowledgedAt || historyActivity.acknowledgedAt,
    action: matched.acknowledgedAt
      ? null
      : matched.action || historyActivity.action,
    createdAt:
      matched.createdAt.localeCompare(historyActivity.createdAt) <= 0
        ? matched.createdAt
        : historyActivity.createdAt,
  };
}

export function reconcileHistoryActivities(
  current: ActivityEntry[],
  buildHistory: BuildHistoryEntry[],
  mergeHistory: MergeHistoryEntry[],
  branchHistory: unknown = [],
  operationHistory: unknown = [],
) {
  const remaining = [...current];
  const operationEvents = Array.isArray(operationHistory)
    ? operationHistory.filter(isOperationEventEntry)
    : [];
  const branchEntries = Array.isArray(branchHistory)
    ? branchHistory.filter(isBranchTaskHistoryEntry)
    : [];
  const relatedHistoryKeys = new Set(
    operationEvents.flatMap((event) => event.relatedHistoryKeys),
  );
  const importedOperations = operationEvents
    .filter((event) =>
      ["git", "build", "runtime", "proxy", "link"].includes(event.domain),
    )
    .flatMap((event) => {
      let activity = activityFromPersistedOperationEvent(event);
      if (activity && event.domain === "git" && event.state === "failed") {
        const replayEntry = branchEntries.find(
          (item) =>
            item.id === event.id || event.relatedHistoryKeys.includes(item.id),
        );
        const recoveryReplay = replayEntry?.replay
          ? branchTaskFailureReplay(replayEntry, replayEntry.replay)
          : null;
        if (recoveryReplay) {
          activity = createActivityEntry({
            ...activity,
            action: {
              kind: "branchReplay",
              label: "检查并重试 Git 操作",
              replay: recoveryReplay,
            },
          });
        } else if (replayEntry?.replay) {
          activity = createActivityEntry({
            ...activity,
            warnings: [
              ...(activity.warnings ?? []),
              "当前批次包含同一项目的部分成功结果，请打开 Git 页面核对后按剩余目标执行。",
            ],
          });
        }
      }
      return activity
        ? [mergeExistingOperationActivity(activity, remaining)]
        : [];
    });
  const importedBuilds = buildHistory
    .filter((item) => !relatedHistoryKeys.has(item.historyKey))
    .map((item) =>
      mergeExistingBuildActivity(activityFromBuildHistory(item), item, remaining),
    );
  // App sync tasks already persist their live Activity card. Their merge rows
  // are a durable Git-history mirror; importing both creates one card per item
  // in addition to the original batch card. CLI and legacy rows still import.
  const importedMerges = mergeHistory
    .filter((item) => !relatedHistoryKeys.has(item.historyKey))
    .filter((item) => !item.historyKey.startsWith("branch-sync-app-"))
    .map(activityFromMergeHistory);
  const importedBranches = Array.isArray(branchHistory)
    ? branchEntries
        .filter((item) => item.taskKind !== "sync")
        .filter((item) => !relatedHistoryKeys.has(item.id))
        .map((item) =>
          mergeExistingBranchActivity(
            activityFromBranchTaskHistory(item),
            item,
            remaining,
          ),
        )
    : [];
  return [
    ...importedOperations,
    ...importedBuilds,
    ...importedMerges,
    ...importedBranches,
    ...remaining,
  ];
}
