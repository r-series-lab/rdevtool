import { describe, expect, it } from "vitest";
import {
  createOptimisticBuildHistoryEntry,
  resolveBuildHistoryKey,
  resolveBuildExecutionWorkspaceKey,
} from "./useBuildHistoryState";

describe("resolveBuildExecutionWorkspaceKey", () => {
  it("keeps an explicit recovery workspace ahead of the active workspace", () => {
    expect(resolveBuildExecutionWorkspaceKey("release", " feature ")).toBe("feature");
  });

  it("uses the recorded history workspace before the active workspace", () => {
    expect(resolveBuildExecutionWorkspaceKey("release", null, " feature ")).toBe("feature");
  });

  it("falls back to the active workspace for legacy records", () => {
    expect(resolveBuildExecutionWorkspaceKey(" release ", null, null)).toBe("release");
  });
});

describe("optimistic build history", () => {
  it("creates an immediately visible submitting record with the operation id", () => {
    const entry = createOptimisticBuildHistoryEntry({
      operationId: "build-123",
      workspaceKey: "feature",
      request: {
        project: "demo",
        target: "deploy",
        env: "dc2",
        branch: "feature/demo",
        params: {
          ENV_PROFILE: "dc2",
          BRANCH: "feature/demo",
        },
      },
      plan: null,
      projectName: "Demo",
      fallbackTarget: "",
      fallbackEnv: "",
      fallbackBranch: "",
      detail: "部署请求已接收，正在创建任务",
    });

    expect(entry).toMatchObject({
      historyKey: "build-123",
      workspaceKey: "feature",
      projectKey: "demo",
      projectName: "Demo",
      mode: "deploy",
      env: "dc2",
      branch: "feature/demo",
      stateKey: "submitting",
      stateLabel: "正在提交",
      queueUrl: null,
      buildUrl: null,
    });
  });
});

describe("resolveBuildHistoryKey", () => {
  it("keeps the operation identity while a local build is polled", () => {
    expect(
      resolveBuildHistoryKey({
        currentHistoryKey: "",
        queueUrl: null,
        buildUrl: null,
        activityId: "build-123",
        workspaceKey: "feature",
        projectKey: "demo",
        target: "package",
      }),
    ).toBe("build-123");
  });

  it("uses a stable fallback instead of creating a timestamp key per poll", () => {
    const input = {
      currentHistoryKey: "",
      queueUrl: null,
      buildUrl: null,
      activityId: "",
      workspaceKey: "feature",
      projectKey: "demo",
      target: "package",
    };

    expect(resolveBuildHistoryKey(input)).toBe("runtime-build:feature:demo:package");
    expect(resolveBuildHistoryKey(input)).toBe(resolveBuildHistoryKey(input));
  });
});
