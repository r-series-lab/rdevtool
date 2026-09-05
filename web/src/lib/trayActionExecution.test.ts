import { describe, expect, it, vi } from "vitest";
import type { TrayPinnedAction } from "./trayPins";
import { executeTrayPinnedActionWorkflow } from "./trayActionExecution";

function action(
  kind: string,
  payload: Record<string, unknown>,
): TrayPinnedAction {
  return {
    kind,
    label: "快捷动作",
    workspaceKey: "workspace-a",
    projectKey: "project-a",
    payload,
    dedupeKey: `${kind}:test`,
    updatedAtMs: 1,
  };
}

function handlers() {
  return {
    activateWorkspace: vi.fn(async () => undefined),
    replayBuild: vi.fn(async () => true),
    replayBranch: vi.fn(async () => true),
    executeFallback: vi.fn(async () => undefined),
    recordDomainExecution: vi.fn(async () => undefined),
  };
}

describe("executeTrayPinnedActionWorkflow", () => {
  it("routes build replay through the domain workflow", async () => {
    const nextAction = action("build.replay", {
      project: "project-a",
      target: "dc2",
      params: { BRANCH: "feature/test", RETRIES: 3 },
    });
    const nextHandlers = handlers();

    await expect(
      executeTrayPinnedActionWorkflow(nextAction, nextHandlers),
    ).resolves.toBe("build");

    expect(nextHandlers.activateWorkspace).toHaveBeenCalledWith("workspace-a");
    expect(nextHandlers.replayBuild).toHaveBeenCalledWith(
      {
        project: "project-a",
        target: "dc2",
        params: { BRANCH: "feature/test" },
      },
      { force: true, origin: "tray", workspaceKey: "workspace-a" },
    );
    expect(nextHandlers.recordDomainExecution).toHaveBeenCalledWith(nextAction);
    expect(nextHandlers.executeFallback).not.toHaveBeenCalled();
  });

  it("restores branch replay metadata for the Git workflow", async () => {
    const nextAction = action("branch.replay", {
      command: "execute_branch_push_task",
      request: {
        project: "project-a",
        repoPath: "/tmp/project-a",
        commitBeforePush: true,
      },
    });
    const nextHandlers = handlers();

    await expect(
      executeTrayPinnedActionWorkflow(nextAction, nextHandlers),
    ).resolves.toBe("branch");

    expect(nextHandlers.replayBranch).toHaveBeenCalledWith(
      {
        command: "execute_branch_push_task",
        busyText: "正在重播提交推送",
        request: {
          project: "project-a",
          repoPath: "/tmp/project-a",
          commitBeforePush: true,
        },
        refreshPushStatusProject: "project-a",
        clearPushCommitMessageOnSuccess: true,
      },
      { force: true, origin: "tray", workspaceKey: "workspace-a" },
    );
    expect(nextHandlers.recordDomainExecution).toHaveBeenCalledWith(nextAction);
  });

  it("keeps non-domain actions on the existing backend path", async () => {
    const nextAction = action("project.runtime.start", {
      debugProfile: "dc2",
    });
    const nextHandlers = handlers();

    await expect(
      executeTrayPinnedActionWorkflow(nextAction, nextHandlers),
    ).resolves.toBe("fallback");

    expect(nextHandlers.executeFallback).toHaveBeenCalledWith(nextAction);
    expect(nextHandlers.activateWorkspace).not.toHaveBeenCalled();
    expect(nextHandlers.recordDomainExecution).not.toHaveBeenCalled();
  });

  it("passes transient workflow context to a backend domain action", async () => {
    const nextAction = action("proxy.start", {
      profileId: "local-debug",
    });
    const nextHandlers = handlers();

    await executeTrayPinnedActionWorkflow(nextAction, nextHandlers, {
      origin: "app",
      chainId: "workspace-chain:local-debug:1",
      stepLabel: "启动代理",
      chainLabel: "本地联调",
    });

    expect(nextHandlers.executeFallback).toHaveBeenCalledWith({
      ...nextAction,
      executionContext: {
        chainId: "workspace-chain:local-debug:1",
        parentId: null,
        stepLabel: "启动代理",
        chainLabel: "本地联调",
      },
    });
  });
});
