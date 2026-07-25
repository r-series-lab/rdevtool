import { describe, expect, it } from "vitest";
import {
  activityRequiresAttention,
  createActivityEntry,
  enrichBranchActivityFailureDetails,
  latestActivityExecutionStatus,
  normalizeActivityEntry,
} from "./activityCenter";

describe("config change activities", () => {
  it("keeps running work out of pending attention and reserves checks for failures", () => {
    const runningBuild = createActivityEntry({
      id: "build-running",
      kind: "build",
      status: "running",
      title: "触发部署",
      summary: "构建中",
    });
    const actionableConfig = createActivityEntry({
      id: "config-action",
      kind: "config",
      status: "running",
      title: "配置已变更",
      summary: "需要重新加载",
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: "workspace",
      },
    });
    const failedBuild = createActivityEntry({
      id: "build-failed",
      kind: "build",
      status: "failed",
      title: "触发部署",
      summary: "构建失败",
    });

    expect(activityRequiresAttention(runningBuild)).toBe(false);
    expect(activityRequiresAttention(actionableConfig)).toBe(true);
    expect(activityRequiresAttention(failedBuild)).toBe(true);
    expect(activityRequiresAttention({
      ...failedBuild,
      acknowledgedAt: "2026-07-21T08:00:00.000Z",
    })).toBe(false);
  });

  it("preserves structured build parameters while normalizing stored activities", () => {
    const entry = normalizeActivityEntry({
      id: "build-with-params",
      kind: "build",
      status: "success",
      title: "触发部署",
      summary: "构建成功",
      parameters: [
        { key: "environment", label: "环境", value: "dc2" },
        { key: "token", label: "Token", value: "已配置", masked: true },
        { key: "", label: "无效", value: "ignored" },
      ],
      createdAt: "2026-07-21T08:00:00.000Z",
      updatedAt: "2026-07-21T08:05:00.000Z",
    });

    expect(entry?.parameters).toEqual([
      { key: "environment", label: "环境", value: "dc2", masked: false },
      { key: "token", label: "Token", value: "已配置", masked: true },
    ]);
  });

  it("keeps a reload action when persisting a config activity", () => {
    const entry = createActivityEntry({
      id: "config-change:workspace",
      kind: "config",
      status: "running",
      title: "工作区配置已变更",
      summary: "检测到外部修改",
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: "workspace",
      },
    });

    expect(entry.kind).toBe("config");
    expect(entry.action).toEqual({
      kind: "reloadConfig",
      label: "重新加载",
      scope: "workspace",
    });
  });

  it("rejects incomplete comparison actions without dropping the activity", () => {
    const entry = normalizeActivityEntry({
      id: "config-change:source:team",
      kind: "config",
      status: "running",
      title: "配置源已变更",
      summary: "检测到外部修改",
      action: {
        kind: "compareConfigSource",
        label: "比较配置源",
        sourceId: "",
      },
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(entry).not.toBeNull();
    expect(entry?.action).toBeNull();
  });

  it("preserves a valid Link recovery action and structured diagnostics", () => {
    const entry = normalizeActivityEntry({
      id: "operation-tray-link-1",
      kind: "link",
      origin: "tray",
      status: "failed",
      title: "启动联调链路",
      summary: "启动失败",
      diagnostics: [{
        id: "proxy",
        type: "proxy.start",
        label: "启动代理",
        status: "failed",
        summary: "端口已被占用",
        risks: ["127.0.0.1:8791 已占用", 42],
      }],
      warnings: ["请检查代理", null],
      action: {
        kind: "linkRecover",
        label: "检查并重新启动",
        linkKey: "cooperation-debug",
        linkName: "合作渠道联调",
        sourceId: "workspace-links",
        replayAction: "run",
      },
      createdAt: "2026-07-21T08:00:00.000Z",
      updatedAt: "2026-07-21T08:00:00.000Z",
    });

    expect(entry?.diagnostics).toEqual([{
      id: "proxy",
      type: "proxy.start",
      label: "启动代理",
      status: "failed",
      summary: "端口已被占用",
      risks: ["127.0.0.1:8791 已占用"],
    }]);
    expect(entry?.warnings).toEqual(["请检查代理"]);
    expect(entry?.action).toMatchObject({
      kind: "linkRecover",
      sourceId: "workspace-links",
      replayAction: "run",
    });
  });

  it("preserves Git, Runtime and proxy recovery parameters", () => {
    const base = {
      kind: "runtime",
      status: "failed",
      title: "恢复测试",
      summary: "执行失败",
      createdAt: "2026-07-21T08:00:00.000Z",
      updatedAt: "2026-07-21T08:00:00.000Z",
    } as const;
    const branch = normalizeActivityEntry({
      ...base,
      id: "git-recover",
      kind: "branch",
      action: {
        kind: "branchReplay",
        label: "检查并重试 Git 操作",
        replay: {
          command: "execute_branch_push_task",
          busyText: "正在重新推送",
          request: { project: "admin", branch: "feature/a" },
          refreshPushStatusProject: "admin",
        },
      },
    });
    const runtime = normalizeActivityEntry({
      ...base,
      id: "runtime-recover",
      action: {
        kind: "runtimeRecover",
        label: "检查并重新启动",
        projectKey: "admin",
        projectName: "管理端",
        debugProfileKey: "dc2",
        envOverrides: { APP_ENV: "dc2", PORT: "8080", INVALID: 42 },
        replayAction: "start",
      },
    });
    const proxy = normalizeActivityEntry({
      ...base,
      id: "proxy-recover",
      kind: "proxy",
      action: {
        kind: "proxyRecover",
        label: "检查并重新停止",
        profileId: "local-debug",
        profileName: "本地联调代理",
        sourceId: "workspace-proxy",
        replayAction: "stop",
      },
    });

    expect(branch?.action).toMatchObject({
      kind: "branchReplay",
      replay: { command: "execute_branch_push_task" },
    });
    expect(runtime?.action).toEqual({
      kind: "runtimeRecover",
      label: "检查并重新启动",
      projectKey: "admin",
      projectName: "管理端",
      debugProfileKey: "dc2",
      envOverrides: { APP_ENV: "dc2", PORT: "8080" },
      replayAction: "start",
    });
    expect(proxy?.action).toMatchObject({
      kind: "proxyRecover",
      sourceId: "workspace-proxy",
      replayAction: "stop",
    });
  });

  it("preserves a complete build recovery request and rejects mismatched projects", () => {
    const base = {
      id: "build-recover",
      kind: "build",
      status: "failed",
      title: "部署失败",
      summary: "构建计划已阻断",
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z",
    } as const;
    const action = {
      kind: "buildRecover",
      label: "重新规划并重试部署",
      projectKey: "admin",
      projectName: "管理端",
      workspaceKey: "feature-a",
      request: {
        project: "admin",
        target: "vke",
        variant: false,
        env: "dc2",
        branch: "feature/a",
        extraParams: { IS_GRAY: "false", INVALID: 42 },
        params: { ENV_PROFILE: "dc2", RETRY: "1", INVALID: 42 },
      },
    };

    expect(normalizeActivityEntry({ ...base, action })?.action).toEqual({
      kind: "buildRecover",
      label: "重新规划并重试部署",
      projectKey: "admin",
      projectName: "管理端",
      workspaceKey: "feature-a",
      request: {
        project: "admin",
        target: "vke",
        variant: false,
        env: "dc2",
        branch: "feature/a",
        extraParams: { IS_GRAY: "false" },
        params: { ENV_PROFILE: "dc2", RETRY: "1" },
      },
    });
    expect(normalizeActivityEntry({
      ...base,
      action: {
        ...action,
        request: { ...action.request, project: "another-project" },
      },
    })?.action).toBeNull();
  });

  it("uses the latest execution status instead of preserving an older failure", () => {
    const failed = createActivityEntry({
      id: "build-failed",
      kind: "build",
      status: "failed",
      title: "部署",
      summary: "构建失败",
      executionKey: "build:project:dc2",
      createdAt: "2026-07-16T10:00:00.000Z",
      updatedAt: "2026-07-16T10:05:00.000Z",
    });
    const succeeded = createActivityEntry({
      id: "build-succeeded",
      kind: "build",
      status: "success",
      title: "部署",
      summary: "构建成功",
      executionKey: "build:project:dc2",
      createdAt: "2026-07-16T11:00:00.000Z",
      updatedAt: "2026-07-16T11:05:00.000Z",
    });

    expect(latestActivityExecutionStatus([succeeded, failed])).toBe("success");
    expect(latestActivityExecutionStatus([failed, succeeded])).toBe("success");
  });

  it("normalizes SQLite UTC timestamps before activity sorting", () => {
    const entry = normalizeActivityEntry({
      id: "history-build:queue-42",
      kind: "build",
      status: "success",
      title: "部署",
      summary: "构建成功",
      createdAt: "2026-07-20 10:01:27",
      updatedAt: "2026-07-20 10:02:44",
    });

    expect(entry?.createdAt).toBe("2026-07-20T10:01:27.000Z");
    expect(entry?.updatedAt).toBe("2026-07-20T10:02:44.000Z");
  });

  it("backfills a concrete branch failure reason from stored workflow history", () => {
    const activity = createActivityEntry({
      id: "merge-failed",
      kind: "branch",
      status: "failed",
      title: "合并分支",
      summary: "成功 0 / 失败 1",
      detail: "消息中心: release -> master [失败]",
      projectKey: "message-center",
      createdAt: "2026-07-17T00:39:13.657Z",
      updatedAt: "2026-07-17T00:39:13.657Z",
    });
    const history = [{
      id: "history-1",
      createdAt: "2026-07-17T00:39:13.627Z",
      taskKind: "sync",
      success: false,
      summary: "成功 0 / 失败 1",
      detail: "消息中心: release -> master [失败]",
      items: [{
        projectKey: "message-center",
        projectName: "消息中心",
        sourceBranch: "release",
        targetBranch: "master",
        success: false,
        statusKey: "failed",
        statusLabel: "失败",
        summary: "失败",
        detail: "合并 MR 失败: HTTP 401 Unauthorized",
        remote: true,
      }],
    }];

    const [enriched] = enrichBranchActivityFailureDetails([activity], history);

    expect(enriched.detail).toContain("原因：GitLab 身份验证失败（HTTP 401）");
  });
});
