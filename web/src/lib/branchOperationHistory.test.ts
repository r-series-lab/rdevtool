import { describe, expect, it } from "vitest";
import {
  createFailedBranchTaskEntry,
  createPendingBranchTaskEntry,
  inferBranchSyncReplay,
} from "./branchOperationHistory";

describe("branch operation history", () => {
  it("keeps the same operation id when an optimistic card fails", () => {
    const projects = [{ key: "demo", name: "Demo" }];
    const pending = createPendingBranchTaskEntry({
      id: "branch-123",
      taskKind: "push",
      summary: "正在推送当前分支",
      projects,
    });
    const failed = createFailedBranchTaskEntry({
      pending,
      title: "推送分支",
      detail: "network unavailable",
      workspaceKey: "feature",
      projects,
      sourceBranch: "",
      targetBranch: null,
      remote: true,
      replay: {
        command: "execute_branch_push_task",
        busyText: "正在推送当前分支",
        request: { project: "demo" },
      },
    });

    expect(pending.detail).toContain("请求已接收");
    expect(failed).toMatchObject({
      id: pending.id,
      taskKind: "push",
      success: false,
      summary: "推送分支失败",
      detail: "network unavailable",
      workspaceKey: "feature",
    });
    expect(failed.items[0]).toMatchObject({
      projectKey: "demo",
      statusKey: "invoke_failed",
      success: false,
    });
  });

  it("recovers an exact replay for a successful merge history", () => {
    expect(
      inferBranchSyncReplay({
        taskKind: "sync",
        success: true,
        items: [
          {
            projectKey: "demo",
            projectName: "Demo",
            sourceBranch: "feature/demo",
            targetBranch: "main",
            success: true,
            statusKey: "merged",
            statusLabel: "已合并",
            summary: "合并成功",
            detail: "",
            remote: true,
          },
        ],
      }),
    ).toEqual({
      command: "execute_branch_sync_task",
      busyText: "正在重播合并分支",
      request: {
        project: "demo",
        projects: ["demo"],
        sourceBranch: "feature/demo",
        targetBranches: ["main"],
      },
    });
  });

  it("does not infer an unsafe replay for mixed results in one project", () => {
    expect(
      inferBranchSyncReplay({
        taskKind: "sync",
        success: false,
        items: [
          {
            projectKey: "demo",
            projectName: "Demo",
            sourceBranch: "feature/demo",
            targetBranch: "main",
            success: true,
            statusKey: "merged",
            statusLabel: "已合并",
            summary: "合并成功",
            detail: "",
            remote: true,
          },
          {
            projectKey: "demo",
            projectName: "Demo",
            sourceBranch: "feature/demo",
            targetBranch: "release",
            success: false,
            statusKey: "merge_failed",
            statusLabel: "失败",
            summary: "合并失败",
            detail: "conflict",
            remote: true,
          },
        ],
      }),
    ).toBeNull();
  });
});
