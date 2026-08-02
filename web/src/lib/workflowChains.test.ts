import { describe, expect, it } from "vitest";
import type { TrayPinnedAction } from "./trayPins";
import type { ActivityEntry } from "./activityCenter";
import {
  compileWorkspaceWorkflowChain,
  normalizeWorkspaceWorkflowChains,
  suggestedWorkspaceWorkflowSteps,
  validateWorkspaceWorkflowChain,
  workspaceWorkflowRunStates,
  workflowReplayFromTrayAction,
  type WorkspaceWorkflowChain,
} from "./workflowChains";
import {
  createBranchTaskSignals,
  DEFAULT_WORKFLOW_RULES,
} from "./workflowSignals";

function branchAction(
  command: "execute_branch_push_task" | "execute_branch_sync_task",
): TrayPinnedAction {
  return {
    kind: "branch.replay",
    label: command.includes("push") ? "推送功能分支" : "合并到测试分支",
    workspaceKey: "feature-a",
    projectKey: "admin",
    payload: {
      command,
      request:
        command === "execute_branch_push_task"
          ? { project: "admin", repoPath: "/repo" }
          : {
              project: "admin",
              projects: ["admin"],
              sourceBranch: "feature/a",
              targetBranches: ["uat"],
            },
    },
    dedupeKey: `branch:${command}`,
    updatedAtMs: 1,
  };
}

function buildAction(): TrayPinnedAction {
  return {
    kind: "build.replay",
    label: "构建 UAT",
    workspaceKey: "feature-a",
    projectKey: "admin",
    payload: {
      project: "admin",
      target: "uat",
      params: { BRANCH: "uat" },
    },
    dedupeKey: "build:admin:uat",
    updatedAtMs: 1,
  };
}

function runtimeAction(): TrayPinnedAction {
  return {
    kind: "project.runtime.start",
    label: "启动管理端",
    workspaceKey: "feature-a",
    projectKey: "admin",
    payload: { debugProfile: "dc2" },
    dedupeKey: "project.runtime.start:admin:dc2",
    updatedAtMs: 1,
  };
}

function chain(actions: TrayPinnedAction[]): WorkspaceWorkflowChain {
  return {
    id: "delivery",
    workspaceKey: "feature-a",
    name: "推送、合并并构建",
    enabled: true,
    steps: actions.map((action, index) => ({
      id: `step-${index}`,
      label: action.label,
      action,
    })),
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function activity(
  id: string,
  runId: string,
  status: ActivityEntry["status"],
  stepLabel: string,
  createdAt: string,
  detail = "",
): ActivityEntry {
  return {
    id,
    kind: stepLabel.includes("构建") ? "build" : "branch",
    origin: "app",
    status,
    title: stepLabel,
    summary: `${stepLabel} ${status}`,
    detail,
    chainId: runId,
    stepLabel,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("workspace workflow chains", () => {
  it("suggests push, merge and build in execution order", () => {
    const push = branchAction("execute_branch_push_task");
    const merge = branchAction("execute_branch_sync_task");
    const build = buildAction();

    expect(
      suggestedWorkspaceWorkflowSteps([build, merge, push]).map(
        (action) => action.dedupeKey,
      ),
    ).toEqual([push.dedupeKey, merge.dedupeKey, build.dedupeKey]);
  });

  it("compiles a three-step chain into existing signal rules", () => {
    const value = chain([
      branchAction("execute_branch_push_task"),
      branchAction("execute_branch_sync_task"),
      buildAction(),
    ]);
    const rules = compileWorkspaceWorkflowChain(
      value,
      DEFAULT_WORKFLOW_RULES,
    );

    expect(rules.broadcasts).toHaveLength(2);
    expect(rules.receivers).toHaveLength(2);
    expect(rules.broadcasts[0]).toMatchObject({
      source: "branch.push.success",
      chainId: "delivery",
      stepIndex: 0,
    });
    expect(rules.receivers[0].signalId).toBe(rules.broadcasts[0].signalId);
    expect(rules.receivers[1]).toMatchObject({
      target: "build.replay",
      chainId: "delivery",
      stepIndex: 2,
    });

    const firstReplay = workflowReplayFromTrayAction(value.steps[0].action);
    expect(firstReplay).not.toBeNull();
    const signals = createBranchTaskSignals({
      broadcasts: rules.broadcasts,
      replay: firstReplay,
      projectKey: "admin",
      projectName: "管理端",
      sourceBranch: "feature/a",
      targetBranches: [],
      result: {
        taskKind: "push",
        success: true,
        summary: "推送完成",
        detail: "",
        items: [],
      },
      chainId: "run-1",
      sourceStepLabel: "推送功能分支",
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: rules.receivers[0].signalId,
      chainId: "run-1",
    });
  });

  it("allows domain actions to run sequentially without broadcast rules", () => {
    const validation = validateWorkspaceWorkflowChain(
      chain([
        buildAction(),
        runtimeAction(),
      ]),
    );

    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it("restores valid persisted chains and drops invalid steps", () => {
    const restored = normalizeWorkspaceWorkflowChains([
      {
        ...chain([branchAction("execute_branch_push_task"), buildAction()]),
        steps: [
          {
            id: "push",
            label: "推送",
            action: branchAction("execute_branch_push_task"),
          },
          { id: "invalid", label: "无效", action: { kind: "unknown" } },
          { id: "build", label: "构建", action: buildAction() },
        ],
      },
    ]);

    expect(restored).toHaveLength(1);
    expect(restored[0].steps.map((step) => step.id)).toEqual(["push", "build"]);
    expect(workflowReplayFromTrayAction(restored[0].steps[0].action)).not.toBeNull();
  });

  it("drops a persisted chain when too few valid steps remain", () => {
    const restored = normalizeWorkspaceWorkflowChains([
      {
        ...chain([branchAction("execute_branch_push_task"), buildAction()]),
        steps: [
          {
            id: "push",
            label: "推送",
            action: branchAction("execute_branch_push_task"),
          },
          { id: "invalid", label: "无效", action: { kind: "unknown" } },
        ],
      },
    ]);

    expect(restored).toEqual([]);
  });

  it("restores non-Git domain actions in a persisted workflow", () => {
    const restored = normalizeWorkspaceWorkflowChains([
      chain([runtimeAction(), buildAction()]),
    ]);

    expect(restored).toHaveLength(1);
    expect(restored[0].steps.map((step) => step.action.kind)).toEqual([
      "project.runtime.start",
      "build.replay",
    ]);
  });

  it("derives progress from activities belonging to the latest chain run", () => {
    const value = chain([
      branchAction("execute_branch_push_task"),
      branchAction("execute_branch_sync_task"),
      buildAction(),
    ]);
    const runId = "workspace-chain:delivery:100";
    const states = workspaceWorkflowRunStates(value ? [value] : [], [
      activity(
        "push",
        runId,
        "success",
        "推送功能分支",
        "2026-07-30T01:00:00.000Z",
      ),
      activity(
        "merge",
        runId,
        "running",
        "合并到测试分支",
        "2026-07-30T01:00:01.000Z",
      ),
    ]);

    expect(states).toEqual([
      expect.objectContaining({
        chainId: "delivery",
        runId,
        status: "running",
        completedStepCount: 1,
        totalStepCount: 3,
        activeStepLabel: "合并到测试分支",
      }),
    ]);
  });

  it("surfaces failure details and cancellation state", () => {
    const value = chain([
      branchAction("execute_branch_push_task"),
      buildAction(),
    ]);
    const failedRunId = "workspace-chain:delivery:200";
    const failed = activity(
      "push-failed",
      failedRunId,
      "failed",
      "推送功能分支",
      "2026-07-30T02:00:00.000Z",
      "远程分支拒绝推送",
    );

    expect(workspaceWorkflowRunStates([value], [failed])[0]).toMatchObject({
      status: "failed",
      detail: "远程分支拒绝推送",
    });
    expect(
      workspaceWorkflowRunStates([value], [failed], [failedRunId])[0],
    ).toMatchObject({
      status: "cancelled",
      detail: "已停止后续步骤，当前已开始的任务不受影响",
    });
  });
});
