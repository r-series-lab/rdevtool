import type {
  BranchTaskReplayCommand,
  BranchTaskReplayRequest,
} from "../app-types";
import type { BuildRequest } from "../hooks/useBuildContext";
import type { TrayPinnedAction } from "./trayPins";

const BUILD_REPLAY_KINDS = new Set(["build.replay", "deploy.replay"]);
const BRANCH_REPLAY_COMMANDS = new Set<BranchTaskReplayCommand>([
  "execute_branch_sync_task",
  "execute_branch_create_task",
  "checkout_branch_to_directory_task",
  "execute_branch_switch_task",
  "execute_branch_push_task",
]);

const BRANCH_REPLAY_BUSY_TEXT: Record<BranchTaskReplayCommand, string> = {
  execute_branch_sync_task: "正在合并分支",
  execute_branch_create_task: "正在创建分支",
  checkout_branch_to_directory_task: "正在克隆分支",
  execute_branch_switch_task: "正在切换分支",
  execute_branch_push_task: "正在重播提交推送",
};

export const TRAY_DOMAIN_ACTION_REQUESTED_EVENT =
  "rdevtool://tray-domain-action-requested";

type DomainRunOptions = {
  force: true;
  workspaceKey?: string | null;
};

export type TrayActionExecutionHandlers = {
  activateWorkspace: (workspaceKey: string) => Promise<void>;
  replayBuild: (
    request: BuildRequest,
    options: DomainRunOptions,
  ) => Promise<boolean>;
  replayBranch: (
    replay: BranchTaskReplayRequest,
    options: DomainRunOptions,
  ) => Promise<boolean>;
  executeFallback: (action: TrayPinnedAction) => Promise<void>;
  recordDomainExecution: (action: TrayPinnedAction) => Promise<void>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecord(value: unknown): Record<string, string> {
  const object = objectValue(value);
  if (!object) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(object)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function buildRequestFromAction(action: TrayPinnedAction): BuildRequest {
  const payload = objectValue(action.payload);
  const project = typeof payload?.project === "string" ? payload.project.trim() : "";
  if (!project) {
    throw new Error("构建回放缺少项目");
  }
  return {
    project,
    target: typeof payload?.target === "string" ? payload.target : null,
    params: stringRecord(payload?.params),
  };
}

function branchReplayFromAction(action: TrayPinnedAction): BranchTaskReplayRequest {
  const payload = objectValue(action.payload);
  const command =
    typeof payload?.command === "string"
      ? (payload.command as BranchTaskReplayCommand)
      : null;
  const request = objectValue(payload?.request);
  if (!command || !BRANCH_REPLAY_COMMANDS.has(command) || !request) {
    throw new Error("Git 回放参数无效");
  }

  const project = typeof request.project === "string" ? request.project : null;
  const refreshPushStatus =
    command === "execute_branch_switch_task" ||
    command === "execute_branch_push_task";
  return {
    command,
    busyText: BRANCH_REPLAY_BUSY_TEXT[command],
    request,
    refreshPushStatusProject: refreshPushStatus ? project : null,
    clearPushCommitMessageOnSuccess:
      command === "execute_branch_push_task" &&
      request.commitBeforePush === true,
  };
}

export async function executeTrayPinnedActionWorkflow(
  action: TrayPinnedAction,
  handlers: TrayActionExecutionHandlers,
) {
  const workspaceKey = action.workspaceKey?.trim() || null;
  const domainAction =
    BUILD_REPLAY_KINDS.has(action.kind) || action.kind === "branch.replay";

  if (!domainAction) {
    await handlers.executeFallback(action);
    return "fallback" as const;
  }

  if (workspaceKey) {
    await handlers.activateWorkspace(workspaceKey);
  }

  const options = { force: true, workspaceKey } as const;
  if (BUILD_REPLAY_KINDS.has(action.kind)) {
    const completed = await handlers.replayBuild(
      buildRequestFromAction(action),
      options,
    );
    if (!completed) {
      throw new Error("构建回放执行失败");
    }
    await handlers.recordDomainExecution(action);
    return "build" as const;
  }

  const completed = await handlers.replayBranch(
    branchReplayFromAction(action),
    options,
  );
  if (!completed) {
    throw new Error("Git 回放执行失败");
  }
  await handlers.recordDomainExecution(action);
  return "branch" as const;
}
