import { describe, expect, it } from "vitest";
import type { BranchTaskItemResult } from "../app-types";
import {
  branchTaskDisplayDetail,
  branchTaskFailureExplanation,
  branchTaskFailureReplay,
  humanizeBranchTaskFailure,
  middleTruncateBranch,
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
  it("keeps both ends of an overlong branch name", () => {
    expect(
      middleTruncateBranch("feature_demo_mobile-release-candidate", 30),
    ).toBe("feature_demo_mob...e-candidate");
    expect(middleTruncateBranch("master", 30)).toBe("master");
  });

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
        "原因：GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。\n" +
        "建议：更新或重新配置有效的 GitLab 访问令牌后重试。",
    );
  });

  it("exposes failure guidance without repeating the project heading", () => {
    const explanation = branchTaskFailureExplanation(branchItem());
    expect(explanation).toContain("原因：GitLab 身份验证失败");
    expect(explanation).toContain("建议：更新或重新配置有效的 GitLab 访问令牌后重试。");
    expect(explanation).not.toContain("消息中心:");
  });

  it("does not mistake merge request !403 for HTTP 403", () => {
    const detail =
      "合并 MR 失败: cannot_be_merged（存在合并冲突）（MR !403: " +
      "http://gitlab.example.test/group/project/-/merge_requests/403）";

    expect(humanizeBranchTaskFailure(detail)).toBe(
      "分支存在合并冲突，请先处理冲突后重试。",
    );
    expect(
      branchTaskDisplayDetail({
        detail,
        items: [
          branchItem({
            projectKey: "demo-service",
            projectName: "示例渠道",
            sourceBranch: "feature_demo_mobile",
            targetBranch: "env_demo_uat",
            statusKey: "merge_conflict",
            summary: "存在合并冲突",
            detail,
          }),
        ],
      }),
    ).toBe(
      "示例渠道: feature_demo_mobile -> env_demo_uat [存在合并冲突]\n" +
        "原因：分支存在合并冲突，请先处理冲突后重试。\n" +
        "GitLab 状态：cannot_be_merged\n" +
        "MR：!403\n" +
        "链接：http://gitlab.example.test/group/project/-/merge_requests/403\n" +
        "建议：先解决 feature_demo_mobile -> env_demo_uat 的合并冲突后重试。",
    );
  });

  it("still recognizes a real HTTP 403 permission failure", () => {
    expect(
      humanizeBranchTaskFailure(
        '合并 MR 失败: HTTP 403 Forbidden {"message":"403 Forbidden"}（MR !12）',
      ),
    ).toBe(
      "GitLab 拒绝了本次操作（HTTP 403），请检查访问令牌权限和项目成员权限。",
    );
  });

  it("uses the structured status key for pipeline blocks", () => {
    expect(
      humanizeBranchTaskFailure("合并 MR 失败", "merge_pipeline_blocked"),
    ).toBe("GitLab 流水线尚未通过，当前不能合并。");
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
