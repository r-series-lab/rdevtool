import { describe, expect, it } from "vitest";
import type { BranchTaskItemResult } from "../app-types";
import {
  branchTaskDisplayDetail,
  branchTaskFailureReplay,
  humanizeBranchTaskFailure,
} from "./branchTaskDetails";

function branchItem(
  patch: Partial<BranchTaskItemResult> = {},
): BranchTaskItemResult {
  return {
    projectKey: "notification",
    projectName: "消息中心",
    sourceBranch: "release-20260716",
    targetBranch: "master",
    outputPath: null,
    success: false,
    statusKey: "merge_failed",
    statusLabel: "失败",
    summary: "合并失败",
    detail: "合并 MR 失败: HTTP 401 Unauthorized",
    remote: false,
    commit: null,
    ...patch,
  };
}

describe("branch task details", () => {
  it("turns GitLab authentication failures into an actionable reason", () => {
    expect(
      humanizeBranchTaskFailure(
        '合并 MR 失败: HTTP 401 Unauthorized {"message":"401 Unauthorized"}',
      ),
    ).toBe(
      "GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
    );
  });

  it("recovers a failure reason from item details in older history entries", () => {
    expect(
      branchTaskDisplayDetail({
        detail: "消息中心: release-20260716 -> master [失败]",
        items: [branchItem()],
      }),
    ).toBe(
      "消息中心: release-20260716 -> master [合并失败]\n" +
        "原因：GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
    );
  });

  it("keeps successful aggregate details unchanged", () => {
    const detail = "消息中心: release-20260716 -> master [已合并]";
    expect(
      branchTaskDisplayDetail({
        detail,
        items: [
          branchItem({
            success: true,
            statusKey: "merged",
            statusLabel: "已合并",
            summary: "已通过 GitLab API 合并并推送",
            detail: "已通过 GitLab API 合并到 master",
          }),
        ],
      }),
    ).toBe(detail);
  });

  it("retries only fully failed projects in a batch", () => {
    const replay = branchTaskFailureReplay(
      {
        success: false,
        items: [
          branchItem({ projectKey: "notification", success: true }),
          branchItem({ projectKey: "marketing", projectName: "营销", success: false }),
        ],
      },
      {
        command: "execute_branch_sync_task",
        busyText: "正在重新合并分支",
        request: {
          projects: ["notification", "marketing"],
          sourceBranch: "release",
          targetBranches: ["master"],
        },
      },
    );

    expect(replay?.request.projects).toEqual(["marketing"]);
  });

  it("does not replay a project with mixed target results", () => {
    const replay = branchTaskFailureReplay(
      {
        success: false,
        items: [
          branchItem({ projectKey: "notification", targetBranch: "pre", success: true }),
          branchItem({ projectKey: "notification", targetBranch: "master", success: false }),
        ],
      },
      {
        command: "execute_branch_sync_task",
        busyText: "正在重新合并分支",
        request: {
          projects: ["notification"],
          sourceBranch: "release",
          targetBranches: ["pre", "master"],
        },
      },
    );

    expect(replay).toBeNull();
  });
});
