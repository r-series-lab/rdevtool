import type {
  BranchTaskHistoryEntry,
  BranchTaskItemResult,
  BranchTaskReplayCommand,
  BranchWorkflowMode,
  BuildHistoryEntry,
} from "../app-types";
import type { ActivityEntry } from "./activityCenter";
import type { TrayPinnedAction } from "./trayPins";
import {
  workflowReplayKey,
  workflowReplayLabel,
  workflowSourceForReplay,
  type WorkflowBroadcastRule,
  type WorkflowReceiveRule,
  type WorkflowReplay,
  type WorkflowRules,
} from "./workflowSignals";

export type WorkspaceWorkflowStep = {
  id: string;
  label: string;
  action: TrayPinnedAction;
};

export type WorkspaceWorkflowChain = {
  id: string;
  workspaceKey: string;
  name: string;
  enabled: boolean;
  steps: WorkspaceWorkflowStep[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceWorkflowValidation = {
  valid: boolean;
  errors: string[];
};

export type WorkspaceWorkflowRunStatus =
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type WorkspaceWorkflowRunState = {
  chainId: string;
  runId: string;
  status: WorkspaceWorkflowRunStatus;
  completedStepCount: number;
  totalStepCount: number;
  activeStepLabel: string;
  detail: string;
  updatedAt: string;
};

const BRANCH_COMMAND_MODES: Record<
  BranchTaskReplayCommand,
  BranchWorkflowMode
> = {
  execute_branch_sync_task: "sync",
  execute_branch_create_task: "create",
  checkout_branch_to_directory_task: "checkout",
  execute_branch_switch_task: "switch",
  execute_branch_push_task: "push",
};

const BRANCH_BUSY_TEXT: Record<BranchTaskReplayCommand, string> = {
  execute_branch_sync_task: "正在合并分支",
  execute_branch_create_task: "正在创建分支",
  checkout_branch_to_directory_task: "正在克隆分支",
  execute_branch_switch_task: "正在切换分支",
  execute_branch_push_task: "正在推送当前分支",
};

const WORKSPACE_WORKFLOW_ACTION_KINDS = new Set([
  "branch.replay",
  "build.replay",
  "deploy.replay",
  "project.runtime.start",
  "project.runtime.stop",
  "proxy.start",
  "proxy.stop",
  "link.run",
  "link.stop",
]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function branchProjects(request: Record<string, unknown>, action: TrayPinnedAction) {
  return Array.from(
    new Set(
      [
        ...stringArray(request.projects),
        stringValue(request.project),
        action.projectKey?.trim() ?? "",
      ].filter(Boolean),
    ),
  );
}

function branchTarget(request: Record<string, unknown>) {
  return (
    stringValue(request.targetBranch) ||
    stringArray(request.targetBranches)[0] ||
    ""
  );
}

function branchItem(
  projectKey: string,
  action: TrayPinnedAction,
  request: Record<string, unknown>,
  mode: BranchWorkflowMode,
): BranchTaskItemResult {
  const sourceBranch =
    stringValue(request.sourceBranch) ||
    (mode === "push" || mode === "switch"
      ? stringValue(request.targetBranch)
      : "");
  return {
    projectKey,
    projectName: projectKey || action.label,
    sourceBranch,
    targetBranch: branchTarget(request) || null,
    outputPath: null,
    checkoutMode: null,
    fallbackReason: null,
    success: true,
    statusKey: "workflow",
    statusLabel: "联动步骤",
    summary: action.label,
    detail: action.detail ?? "",
    remote: mode === "push" || mode === "sync",
    commit: null,
  };
}

function branchReplayFromAction(
  action: TrayPinnedAction,
): WorkflowReplay | null {
  const payload = objectValue(action.payload);
  const command = stringValue(payload?.command) as BranchTaskReplayCommand;
  const request = objectValue(payload?.request);
  const mode = BRANCH_COMMAND_MODES[command];
  if (!request || !mode) {
    return null;
  }
  const projects = branchProjects(request, action);
  const createdAt = new Date(action.updatedAtMs || Date.now()).toISOString();
  const entry: BranchTaskHistoryEntry = {
    id: `workflow:${action.dedupeKey}`,
    taskKind: mode,
    success: true,
    summary: action.label,
    detail: action.detail ?? "",
    items: (projects.length > 0 ? projects : [""]).map((projectKey) =>
      branchItem(projectKey, action, request, mode),
    ),
    createdAt,
    workspaceKey: action.workspaceKey ?? null,
    replay: {
      command,
      busyText: BRANCH_BUSY_TEXT[command],
      request,
      refreshPushStatusProject:
        mode === "push" || mode === "switch"
          ? projects[0] || null
          : null,
      clearPushCommitMessageOnSuccess:
        mode === "push" && request.commitBeforePush === true,
    },
  };
  return { target: "branch.replay", entry };
}

function buildReplayFromAction(
  action: TrayPinnedAction,
): WorkflowReplay | null {
  const payload = objectValue(action.payload);
  const projectKey =
    stringValue(payload?.project) || action.projectKey?.trim() || "";
  if (!projectKey) {
    return null;
  }
  const params = objectValue(payload?.params);
  const normalizedParams = Object.fromEntries(
    Object.entries(params ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const target = stringValue(payload?.target);
  const createdAt = new Date(action.updatedAtMs || Date.now()).toISOString();
  const entry: BuildHistoryEntry = {
    historyKey: `workflow:${action.dedupeKey}`,
    workspaceKey: action.workspaceKey ?? null,
    projectInstancePath: null,
    projectKey,
    projectName: projectKey,
    mode: target,
    env: "",
    branch: "",
    stateKey: "workflow",
    stateLabel: "联动步骤",
    detail: action.detail ?? "",
    queueUrl: null,
    buildUrl: null,
    params: normalizedParams,
    createdAt,
    updatedAt: createdAt,
  };
  return { target: "build.replay", entry };
}

export function workflowReplayFromTrayAction(
  action: TrayPinnedAction,
): WorkflowReplay | null {
  if (action.kind === "branch.replay") {
    return branchReplayFromAction(action);
  }
  if (action.kind === "build.replay" || action.kind === "deploy.replay") {
    return buildReplayFromAction(action);
  }
  return null;
}

export function isWorkspaceWorkflowActionSupported(
  action: TrayPinnedAction,
) {
  return WORKSPACE_WORKFLOW_ACTION_KINDS.has(action.kind.trim());
}

export function normalizeWorkspaceWorkflowChains(
  value: unknown,
): WorkspaceWorkflowChain[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<WorkspaceWorkflowChain>;
    const id = stringValue(candidate.id);
    const workspaceKey = stringValue(candidate.workspaceKey);
    const name = stringValue(candidate.name);
    if (!id || !workspaceKey || !name || !Array.isArray(candidate.steps)) {
      return [];
    }
    const steps = candidate.steps.flatMap((step, index) => {
      if (!step || typeof step !== "object") {
        return [];
      }
      const next = step as Partial<WorkspaceWorkflowStep>;
      const action = next.action;
      if (!action || !isWorkspaceWorkflowActionSupported(action)) {
        return [];
      }
      return [
        {
          id: stringValue(next.id) || `${id}:step:${index}`,
          label: stringValue(next.label) || action.label,
          action,
        },
      ];
    });
    const now = new Date().toISOString();
    const chain: WorkspaceWorkflowChain = {
      id,
      workspaceKey,
      name,
      enabled: candidate.enabled !== false,
      steps,
      createdAt: stringValue(candidate.createdAt) || now,
      updatedAt: stringValue(candidate.updatedAt) || now,
    };
    return validateWorkspaceWorkflowChain(chain).valid ? [chain] : [];
  });
}

export function validateWorkspaceWorkflowChain(
  chain: WorkspaceWorkflowChain,
): WorkspaceWorkflowValidation {
  const errors: string[] = [];
  if (!chain.workspaceKey.trim()) {
    errors.push("缺少所属工作区");
  }
  if (!chain.name.trim()) {
    errors.push("请输入流程名称");
  }
  if (chain.steps.length < 2) {
    errors.push("联动流程至少需要两个步骤");
  }
  const actionKeys = chain.steps.map((step) => step.action.dedupeKey);
  if (new Set(actionKeys).size !== actionKeys.length) {
    errors.push("同一个动作不能在联动流程中重复");
  }
  chain.steps.forEach((step, index) => {
    const actionWorkspaceKey = step.action.workspaceKey?.trim();
    if (
      actionWorkspaceKey &&
      actionWorkspaceKey !== chain.workspaceKey.trim()
    ) {
      errors.push(`第 ${index + 1} 步不属于当前工作区`);
    }
    if (!isWorkspaceWorkflowActionSupported(step.action)) {
      errors.push(`第 ${index + 1} 步不是可联动动作`);
    }
  });
  return { valid: errors.length === 0, errors };
}

function chainSignalId(chainId: string, stepIndex: number) {
  return `workspace-chain:${chainId}:step:${stepIndex + 1}`;
}

export function compileWorkspaceWorkflowChain(
  chain: WorkspaceWorkflowChain,
  rules: WorkflowRules,
): WorkflowRules {
  const validation = validateWorkspaceWorkflowChain(chain);
  if (!validation.valid) {
    throw new Error(validation.errors.join("；"));
  }
  const broadcasts = rules.broadcasts.filter(
    (rule) => rule.chainId !== chain.id,
  );
  const receivers = rules.receivers.filter((rule) => rule.chainId !== chain.id);

  chain.steps.forEach((step, index) => {
    const replay = workflowReplayFromTrayAction(step.action)!;
    const replayKey = workflowReplayKey(replay);
    const label = step.label || workflowReplayLabel(replay);
    if (index > 0) {
      const receiver: WorkflowReceiveRule = {
        id: `chain-receive:${chain.id}:${index}`,
        enabled: chain.enabled,
        signalId: chainSignalId(chain.id, index - 1),
        target: replay.target,
        replayKey,
        label,
        replay,
        chainId: chain.id,
        stepIndex: index,
      };
      receivers.push(receiver);
    }
    if (index < chain.steps.length - 1) {
      const source = workflowSourceForReplay(replay)!;
      const broadcast: WorkflowBroadcastRule = {
        id: `chain-broadcast:${chain.id}:${index}`,
        enabled: chain.enabled,
        source,
        signalId: chainSignalId(chain.id, index),
        replayKey,
        label,
        replay,
        chainId: chain.id,
        stepIndex: index,
      };
      broadcasts.push(broadcast);
    }
  });

  return { broadcasts, receivers };
}

export function removeWorkspaceWorkflowChainRules(
  chainId: string,
  rules: WorkflowRules,
): WorkflowRules {
  return {
    broadcasts: rules.broadcasts.filter((rule) => rule.chainId !== chainId),
    receivers: rules.receivers.filter((rule) => rule.chainId !== chainId),
  };
}

export function suggestedWorkspaceWorkflowSteps(
  actions: TrayPinnedAction[],
): TrayPinnedAction[] {
  const branchCommand = (action: TrayPinnedAction) =>
    stringValue(objectValue(action.payload)?.command);
  const push = actions.find(
    (action) =>
      action.kind === "branch.replay" &&
      branchCommand(action) === "execute_branch_push_task",
  );
  const merge = actions.find(
    (action) =>
      action.kind === "branch.replay" &&
      branchCommand(action) === "execute_branch_sync_task",
  );
  const build = actions.find(
    (action) =>
      action.kind === "build.replay" || action.kind === "deploy.replay",
  );
  return [push, merge, build].filter(
    (action): action is TrayPinnedAction => Boolean(action),
  );
}

function activityTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function workflowRunIdForChain(
  chain: WorkspaceWorkflowChain,
  activity: ActivityEntry,
) {
  const runId = activity.chainId?.trim() ?? "";
  return runId.startsWith(`workspace-chain:${chain.id}:`) ? runId : "";
}

export function workspaceWorkflowRunStates(
  chains: WorkspaceWorkflowChain[],
  activities: ActivityEntry[],
  cancelledRunIds: string[] = [],
): WorkspaceWorkflowRunState[] {
  const cancelled = new Set(cancelledRunIds);
  return chains.flatMap((chain) => {
    const byRunId = new Map<string, ActivityEntry[]>();
    activities.forEach((activity) => {
      const runId = workflowRunIdForChain(chain, activity);
      if (runId) {
        byRunId.set(runId, [...(byRunId.get(runId) ?? []), activity]);
      }
    });
    const latest = Array.from(byRunId.entries())
      .map(([runId, entries]) => ({
        runId,
        entries,
        updatedAt: Math.max(
          ...entries.map((entry) => activityTime(entry.updatedAt)),
        ),
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (!latest) {
      return [];
    }

    const ordered = [...latest.entries].sort(
      (left, right) =>
        activityTime(left.createdAt) - activityTime(right.createdAt),
    );
    const failed = [...ordered]
      .reverse()
      .find((activity) => activity.status === "failed");
    const running = [...ordered]
      .reverse()
      .find((activity) => activity.status === "running");
    const completedStepCount = Math.min(
      chain.steps.length,
      ordered.filter((activity) => activity.status === "success").length,
    );
    const status: WorkspaceWorkflowRunStatus = cancelled.has(latest.runId)
      ? "cancelled"
      : failed
        ? "failed"
        : running || completedStepCount < chain.steps.length
          ? "running"
          : "success";
    const activeActivity = failed ?? running;
    const activeStepLabel =
      activeActivity?.stepLabel?.trim() ||
      chain.steps[
        Math.min(completedStepCount, Math.max(chain.steps.length - 1, 0))
      ]?.label ||
      "";
    const detail =
      status === "cancelled"
        ? "已停止后续步骤，当前已开始的任务不受影响"
        : failed?.detail?.trim() ||
          failed?.summary?.trim() ||
          running?.summary?.trim() ||
          "";

    return [
      {
        chainId: chain.id,
        runId: latest.runId,
        status,
        completedStepCount,
        totalStepCount: chain.steps.length,
        activeStepLabel,
        detail,
        updatedAt:
          ordered
            .map((entry) => entry.updatedAt)
            .sort(
              (left, right) => activityTime(right) - activityTime(left),
            )[0] ?? "",
      },
    ];
  });
}
