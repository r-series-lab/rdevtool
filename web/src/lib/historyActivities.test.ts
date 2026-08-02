import { describe, expect, it } from "vitest";
import type {
  BranchTaskHistoryEntry,
  BuildHistoryEntry,
  MergeHistoryEntry,
  OperationEventEntry,
} from "../app-types";
import { createActivityEntry } from "./activityCenter";
import {
  activityFromBranchTaskHistory,
  activityFromBuildHistory,
  activityFromMergeHistory,
  buildActivityParameters,
  reconcileHistoryActivities,
} from "./historyActivities";

function buildHistory(
  overrides: Partial<BuildHistoryEntry> = {},
): BuildHistoryEntry {
  return {
    historyKey: "http://jenkins/queue/item/42/",
    workspaceKey: "workspace",
    projectKey: "cooperation-admin",
    projectName: "新合作渠道",
    mode: "vke",
    env: "dc2",
    branch: "env-dc2-vke",
    stateKey: "success",
    stateLabel: "构建成功",
    detail: "构建 #825 当前结果：SUCCESS",
    queueUrl: "http://jenkins/queue/item/42/",
    buildUrl: "http://jenkins/job/cooperation-admin/825/",
    params: { env: "dc2" },
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T08:05:00.000Z",
    ...overrides,
  };
}

function mergeHistory(
  overrides: Partial<MergeHistoryEntry> = {},
): MergeHistoryEntry {
  return {
    historyKey: "cli-merge-1",
    workspaceKey: "workspace",
    projectKey: "cooperation-admin",
    projectName: "新合作渠道",
    sourceBranch: "feature",
    targetBranch: "env-dc2-vke",
    success: true,
    remote: false,
    summary: "合并并推送成功",
    detail: "feature -> env-dc2-vke",
    createdAt: "2026-07-20T07:55:00.000Z",
    ...overrides,
  };
}

function branchHistory(
  overrides: Partial<BranchTaskHistoryEntry> = {},
): BranchTaskHistoryEntry {
  return {
    id: "branch-push-cli-1",
    workspaceKey: "workspace",
    taskKind: "push",
    success: false,
    summary: "成功 0 / 失败 1",
    detail: "批量任务包含失败项",
    items: [
      {
        projectKey: "cooperation-admin",
        projectName: "新合作渠道",
        sourceBranch: "feature",
        targetBranch: null,
        success: false,
        statusKey: "push_failed",
        statusLabel: "失败",
        summary: "推送失败",
        detail: "remote rejected",
        remote: false,
        commit: null,
      },
    ],
    createdAt: "2026-07-20T08:00:00.000Z",
    replay: null,
    ...overrides,
  };
}

function operationEvent(
  overrides: Partial<OperationEventEntry> = {},
): OperationEventEntry {
  const response = branchHistory();
  return {
    version: 1,
    id: "operation-cli-push-1",
    origin: "cli",
    workspaceKey: "workspace",
    domain: "git",
    action: "push",
    state: "failed",
    title: "提交推送",
    summary: response.summary,
    detail: response.detail,
    projectKey: "cooperation-admin",
    projectName: "新合作渠道",
    relatedHistoryKeys: ["operation-cli-push-1"],
    payload: {
      taskKind: response.taskKind,
      success: response.success,
      summary: response.summary,
      detail: response.detail,
      items: response.items,
    },
    createdAt: response.createdAt,
    updatedAt: response.createdAt,
    ...overrides,
  };
}

describe("history activities", () => {
  it("converts persisted CLI push history and keeps the failure reason", () => {
    const activity = activityFromBranchTaskHistory(branchHistory());

    expect(activity).toMatchObject({
      kind: "branch",
      status: "failed",
      title: "推送分支",
      summary: "成功 0 / 失败 1",
      detail: expect.stringContaining("remote rejected"),
      target: {
        page: "merge",
        projectKey: "cooperation-admin",
        branchMode: "push",
      },
    });
  });

  it("enriches a failed Git operation with its durable replay request", () => {
    const replay = {
      command: "execute_branch_push_task" as const,
      busyText: "正在重新推送分支",
      request: { project: "cooperation-admin", branch: "feature" },
      refreshPushStatusProject: "cooperation-admin",
    };
    const history = branchHistory({
      id: "operation-cli-push-1",
      replay,
    });

    const reconciled = reconcileHistoryActivities(
      [],
      [],
      [],
      [history],
      [operationEvent()],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: "operation-cli-push-1",
      diagnostics: [expect.objectContaining({ status: "failed" })],
      action: {
        kind: "branchReplay",
        replay,
      },
    });
  });

  it("shows structured merge parameters instead of a generic backend result", () => {
    const activity = activityFromMergeHistory(mergeHistory({
      summary: "已通过 GitLab API 合并并推送",
      detail: "Merge Request !42 已合并",
    }));

    expect(activity).toMatchObject({
      status: "success",
      summary: "新合作渠道: feature -> env-dc2-vke [已合并]",
      detail: "Merge Request !42 已合并",
    });
  });

  it("keeps project and branch parameters visible for failed merge history", () => {
    const activity = activityFromMergeHistory(mergeHistory({
      success: false,
      summary: "合并失败",
      detail: "HTTP 401 Unauthorized",
    }));

    expect(activity).toMatchObject({
      status: "failed",
      summary: "新合作渠道: feature -> env-dc2-vke [合并失败]",
      detail: "HTTP 401 Unauthorized",
    });
  });

  it("converts a persisted VKE build into a deploy activity", () => {
    const activity = activityFromBuildHistory(buildHistory({
      params: {
        env: "dc2",
        BRANCH: "env-dc2-vke",
        IS_GRAY: "true",
        API_TOKEN: "secret-value",
      },
    }));

    expect(activity).toMatchObject({
      kind: "build",
      status: "success",
      title: "部署",
      projectKey: "cooperation-admin",
      resource: {
        value: "http://jenkins/job/cooperation-admin/825/",
      },
    });
    expect(activity.parameters).toEqual([
      { key: "target", label: "目标", value: "vke", masked: false },
      { key: "environment", label: "环境", value: "dc2", masked: false },
      { key: "branch", label: "分支", value: "env-dc2-vke", masked: false },
      { key: "IS_GRAY", label: "IS_GRAY", value: "true", masked: false },
      { key: "API_TOKEN", label: "API_TOKEN", value: "已配置", masked: true },
    ]);
  });

  it("offers plan-first recovery only for failed builds with a stable target", () => {
    const failed = activityFromBuildHistory(buildHistory({
      stateKey: "failed",
      stateLabel: "构建失败",
      detail: "目标分支不存在",
      params: { ENV_PROFILE: "dc2", BRANCH: "feature/a" },
    }));
    const incomplete = activityFromBuildHistory(buildHistory({
      mode: "",
      stateKey: "failed",
      stateLabel: "构建失败",
    }));

    expect(failed.action).toEqual({
      kind: "buildRecover",
      label: "重新规划并重试部署",
      projectKey: "cooperation-admin",
      projectName: "新合作渠道",
      workspaceKey: "workspace",
      request: {
        project: "cooperation-admin",
        target: "vke",
        variant: false,
        env: "dc2",
        branch: "env-dc2-vke",
        params: { ENV_PROFILE: "dc2", BRANCH: "feature/a" },
      },
    });
    expect(incomplete.action).toBeNull();
    expect(incomplete.warnings).toContainEqual(expect.stringContaining("无法安全重放"));
  });

  it("keeps an exact CLI build request when operation history is reconciled", () => {
    const failedEvent = operationEvent({
      id: "operation-cli-build-failed-1",
      domain: "build",
      action: "deploy",
      state: "failed",
      title: "触发部署",
      summary: "触发部署失败",
      detail: "构建计划已阻断：目标分支不存在",
      relatedHistoryKeys: [],
      payload: {
        projectKey: "cooperation-admin",
        projectName: "新合作渠道",
        mode: "vke",
        stateKey: "failed",
        stateLabel: "失败",
        detail: "构建计划已阻断：目标分支不存在",
        params: { ENV_PROFILE: "dc2" },
        replayRequest: {
          project: "cooperation-admin",
          target: "vke",
          env: "dc2",
          branch: "feature/a",
          extraParams: { IS_GRAY: "false" },
          params: { ENV_PROFILE: "dc2" },
        },
      },
    });

    expect(reconcileHistoryActivities([], [], [], [], [failedEvent])[0]).toMatchObject({
      id: "operation-cli-build-failed-1",
      action: {
        kind: "buildRecover",
        request: {
          project: "cooperation-admin",
          target: "vke",
          env: "dc2",
          branch: "feature/a",
          extraParams: { IS_GRAY: "false" },
        },
      },
    });
  });

  it("uses configured labels and masks hidden build parameters", () => {
    const parameters = buildActivityParameters(
      buildHistory({ params: { platform: "macos", internalMode: "release" } }),
      [
        { key: "platform", label: "系统", kind: "select" },
        { key: "internalMode", label: "内部模式", kind: "hidden" },
      ],
    );

    expect(parameters).toContainEqual({
      key: "platform",
      label: "系统",
      value: "macos",
      masked: false,
    });
    expect(parameters).toContainEqual({
      key: "internalMode",
      label: "内部模式",
      value: "已配置",
      masked: true,
    });
  });

  it("updates an existing App activity by queue URL instead of duplicating it", () => {
    const current = createActivityEntry({
      id: "live-build",
      kind: "build",
      status: "running",
      title: "触发部署",
      summary: "排队中",
      detail: "http://jenkins/queue/item/42/",
      projectKey: "cooperation-admin",
      resource: {
        kind: "url",
        label: "打开构建记录",
        value: "http://jenkins/queue/item/42/",
      },
      createdAt: "2026-07-20T08:00:00.000Z",
      updatedAt: "2026-07-20T08:00:00.000Z",
    });

    const reconciled = reconcileHistoryActivities(
      [current],
      [buildHistory()],
      [mergeHistory()],
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toMatchObject({
      id: "live-build",
      status: "success",
      title: "触发部署",
    });
    expect(reconciled[1]).toMatchObject({
      id: "history-merge:cli-merge-1",
      kind: "branch",
      status: "success",
    });
  });

  it("does not restore a failed build action after the activity was ignored", () => {
    const history = buildHistory({
      stateKey: "failed",
      stateLabel: "构建失败",
      detail: "目标分支不存在",
    });
    const current = createActivityEntry({
      ...activityFromBuildHistory(history),
      id: "live-build-ignored",
      action: null,
      acknowledgedAt: "2026-07-20T08:10:00.000Z",
      updatedAt: "2026-07-20T08:10:00.000Z",
    });

    const reconciled = reconcileHistoryActivities([current], [history], []);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: current.id,
      status: "failed",
      acknowledgedAt: "2026-07-20T08:10:00.000Z",
      action: null,
      updatedAt: "2026-07-20T08:10:00.000Z",
    });
  });

  it("merges persisted create history into the App activity instead of duplicating it", () => {
    const current = createActivityEntry({
      id: "live-create",
      kind: "branch",
      status: "success",
      title: "创建分支",
      summary: "成功 1 / 失败 0",
      projectKey: "cooperation-admin",
      target: {
        page: "merge",
        projectKey: "cooperation-admin",
        branchMode: "create",
      },
      createdAt: "2026-07-20T08:00:05.000Z",
      updatedAt: "2026-07-20T08:00:05.000Z",
    });
    const persisted = branchHistory({
      id: "branch-create-cli-1",
      taskKind: "create",
      success: true,
      summary: "成功 1 / 失败 0",
      detail: "新合作渠道: feature -> release [已创建]",
      items: [
        {
          ...branchHistory().items[0],
          success: true,
          statusKey: "created",
          statusLabel: "已创建",
          summary: "创建成功",
          detail: "feature -> release",
          targetBranch: "release",
        },
      ],
    });

    const reconciled = reconcileHistoryActivities([current], [], [], [persisted]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: "live-create",
      title: "创建分支",
      status: "success",
      detail: expect.stringContaining("feature -> release"),
    });
  });

  it("does not restore a failed Git action after the activity was ignored", () => {
    const replay = {
      command: "execute_branch_push_task" as const,
      busyText: "正在重新推送分支",
      request: { project: "cooperation-admin", branch: "feature" },
      refreshPushStatusProject: "cooperation-admin",
    };
    const history = branchHistory({ replay });
    const current = createActivityEntry({
      ...activityFromBranchTaskHistory(history),
      action: null,
      acknowledgedAt: "2026-07-20T08:10:00.000Z",
      updatedAt: "2026-07-20T08:10:00.000Z",
    });

    const reconciled = reconcileHistoryActivities(
      [current],
      [],
      [],
      [history],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: current.id,
      status: "failed",
      acknowledgedAt: "2026-07-20T08:10:00.000Z",
      action: null,
      updatedAt: "2026-07-20T08:10:00.000Z",
    });
  });

  it("leaves sync history to the dedicated merge history importer", () => {
    const reconciled = reconcileHistoryActivities(
      [],
      [],
      [mergeHistory()],
      [branchHistory({ taskKind: "sync" })],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("history-merge:cli-merge-1");
  });

  it("does not import the App merge mirror as a second activity", () => {
    const appHistory = mergeHistory({
      historyKey: "branch-sync-app-batch-0",
    });
    const cliHistory = mergeHistory({
      historyKey: "branch-sync-cli-batch-0",
    });

    expect(reconcileHistoryActivities([], [], [appHistory])).toEqual([]);
    expect(reconcileHistoryActivities([], [], [cliHistory])).toHaveLength(1);
  });

  it("uses a shared CLI event instead of its compatibility history copy", () => {
    const event = operationEvent();
    const compatibilityHistory = branchHistory({ id: event.id });

    const reconciled = reconcileHistoryActivities(
      [],
      [],
      [],
      [compatibilityHistory],
      [event],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: event.id,
      title: "提交推送",
      status: "failed",
      detail: expect.stringContaining("remote rejected"),
    });
  });

  it("updates the live App activity and suppresses its per-project merge mirror", () => {
    const current = createActivityEntry({
      id: "activity-app-sync-1",
      kind: "branch",
      status: "running",
      title: "合并分支",
      summary: "正在合并分支",
      projectKey: "cooperation-admin",
      target: {
        page: "merge",
        projectKey: "cooperation-admin",
        branchMode: "sync",
      },
      createdAt: "2026-07-20T08:00:00.000Z",
      updatedAt: "2026-07-20T08:00:00.000Z",
    });
    const merge = mergeHistory({
      historyKey: "branch-sync-app-activity-app-sync-1-0",
    });
    const event = operationEvent({
      id: current.id,
      origin: "app",
      action: "sync",
      state: "success",
      title: "合并分支",
      summary: "成功 1 / 失败 0",
      relatedHistoryKeys: [merge.historyKey],
      payload: {
        taskKind: "sync",
        success: true,
        summary: "成功 1 / 失败 0",
        detail: "批量合并完成",
        items: [
          {
            ...branchHistory().items[0],
            success: true,
            statusKey: "merged",
            statusLabel: "已合并",
            summary: "合并成功",
            targetBranch: "env-dc2-vke",
          },
        ],
      },
    });

    const reconciled = reconcileHistoryActivities(
      [current],
      [],
      [merge],
      [],
      [event],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: current.id,
      status: "success",
      summary: "成功 1 / 失败 0",
    });
  });

  it("uses one shared build event instead of its compatibility history row", () => {
    const history = buildHistory();
    const event = operationEvent({
      id: "operation-cli-build-1",
      domain: "build",
      action: "deploy",
      state: "success",
      title: "触发部署",
      summary: `${history.stateLabel} · ${history.detail}`,
      detail: history.detail,
      relatedHistoryKeys: [history.historyKey],
      chainId: "workspace-chain:delivery:cli-1",
      stepLabel: "构建 UAT",
      chainLabel: "发布流程",
      payload: {
        historyKey: history.historyKey,
        workspaceKey: history.workspaceKey,
        projectKey: history.projectKey,
        projectName: history.projectName,
        mode: history.mode,
        env: history.env,
        branch: history.branch,
        stateKey: history.stateKey,
        stateLabel: history.stateLabel,
        detail: history.detail,
        queueUrl: history.queueUrl,
        buildUrl: history.buildUrl,
        params: history.params,
      },
    });

    const reconciled = reconcileHistoryActivities(
      [],
      [history],
      [],
      [],
      [event],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: event.id,
      kind: "build",
      status: "success",
      title: "触发部署",
      chainId: "workspace-chain:delivery:cli-1",
      stepLabel: "构建 UAT",
      chainLabel: "发布流程",
      resource: { value: history.buildUrl },
    });
  });

  it("updates the live build activity by stable id and keeps its chain context", () => {
    const history = buildHistory();
    const current = createActivityEntry({
      id: "activity-app-build-1",
      kind: "build",
      status: "running",
      title: "重播部署",
      summary: "正在触发部署",
      chainId: "chain-1",
      parentId: "parent-1",
      projectKey: history.projectKey,
      createdAt: history.createdAt,
      updatedAt: history.createdAt,
    });
    const event = operationEvent({
      id: current.id,
      origin: "app",
      domain: "build",
      action: "deploy",
      state: "success",
      title: "重播部署",
      summary: `${history.stateLabel} · ${history.detail}`,
      detail: history.detail,
      relatedHistoryKeys: [history.historyKey],
      payload: {
        ...history,
      },
    });

    const reconciled = reconcileHistoryActivities(
      [current],
      [history],
      [],
      [],
      [event],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: current.id,
      status: "success",
      chainId: "chain-1",
      parentId: "parent-1",
      resource: { value: history.buildUrl },
    });
  });

  it("keeps a failed build event visible even when no history row was created", () => {
    const event = operationEvent({
      id: "activity-app-build-failed",
      origin: "app",
      domain: "build",
      action: "build",
      state: "failed",
      title: "触发构建",
      summary: "触发构建失败",
      detail: "构建目标不存在: missing",
      relatedHistoryKeys: [],
      payload: null,
    });

    const reconciled = reconcileHistoryActivities([], [], [], [], [event]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: event.id,
      kind: "build",
      status: "failed",
      detail: "构建目标不存在: missing",
    });
  });

  it("updates a live Runtime activity and imports CLI proxy lifecycle events", () => {
    const runtimeActivity = createActivityEntry({
      id: "activity-app-runtime-1",
      kind: "runtime",
      status: "running",
      title: "启动 dev 服务",
      summary: "管理端",
      chainId: "chain-runtime-1",
      projectKey: "cooperation-admin",
      projectName: "合作渠道管理端",
      target: {
        page: "projectManagement",
        projectKey: "cooperation-admin",
      },
      createdAt: "2026-07-20T08:00:00.000Z",
      updatedAt: "2026-07-20T08:00:00.000Z",
    });
    const runtimeEvent = operationEvent({
      id: runtimeActivity.id,
      domain: "runtime",
      action: "start",
      state: "success",
      title: "dev 服务已启动",
      summary: "已启动 · dev 服务启动成功",
      detail: "Runtime Daemon 正在运行",
      relatedHistoryKeys: [],
      payload: {
        projectKey: "cooperation-admin",
        name: "合作渠道管理端",
        logPath: "/tmp/cooperation-admin.log",
      },
    });
    const proxyEvent = operationEvent({
      id: "operation-cli-proxy-start-1",
      domain: "proxy",
      action: "start",
      state: "success",
      title: "代理服务已启动",
      summary: "合作渠道本地代理 · 已启动",
      detail: "监听地址：http://127.0.0.1:8791",
      projectKey: null,
      projectName: null,
      relatedHistoryKeys: [],
      payload: {
        profileId: "cooperation-local",
        listenUrl: "http://127.0.0.1:8791",
      },
    });

    const reconciled = reconcileHistoryActivities(
      [runtimeActivity],
      [],
      [],
      [],
      [runtimeEvent, proxyEvent],
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled.find((item) => item.id === runtimeActivity.id)).toMatchObject({
      status: "success",
      chainId: "chain-runtime-1",
      resource: { value: "/tmp/cooperation-admin.log" },
    });
    expect(reconciled.find((item) => item.id === proxyEvent.id)).toMatchObject({
      kind: "proxy",
      status: "success",
      target: { page: "proxy" },
    });
  });

  it("updates one live Link activity from the shared App event", () => {
    const current = createActivityEntry({
      id: "activity-app-link-1",
      kind: "link",
      origin: "app",
      status: "running",
      title: "启动联调链路",
      summary: "合作渠道联调 · 正在启动",
      executionKey: "link:run:cooperation-debug",
      target: { page: "overview" },
      createdAt: "2026-07-20T08:00:00.000Z",
      updatedAt: "2026-07-20T08:00:00.000Z",
    });
    const linkEvent = operationEvent({
      id: current.id,
      origin: "app",
      domain: "link",
      action: "run",
      state: "success",
      title: "启动联调链路",
      summary: "合作渠道联调 · 完成 3 / 失败 0 / 跳过 0",
      detail: "联调链路已启动",
      projectKey: "cooperation-admin",
      relatedHistoryKeys: [],
      payload: {
        linkKey: "cooperation-debug",
        linkName: "合作渠道联调",
        mode: "run",
        stepCount: 3,
        completedCount: 3,
        failedCount: 0,
        skippedCount: 0,
      },
      updatedAt: "2026-07-20T08:00:03.000Z",
    });

    const reconciled = reconcileHistoryActivities(
      [current],
      [],
      [],
      [],
      [linkEvent],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: current.id,
      kind: "link",
      origin: "app",
      status: "success",
      summary: "合作渠道联调 · 完成 3 / 失败 0 / 跳过 0",
      target: { page: "overview", projectKey: "cooperation-admin" },
    });
  });

  it("does not restore a Link recovery action after the failure was acknowledged", () => {
    const current = createActivityEntry({
      id: "operation-tray-link-failed-1",
      kind: "link",
      origin: "tray",
      status: "failed",
      title: "启动联调链路",
      summary: "合作渠道联调 · 启动失败",
      detail: "端口已被占用",
      action: null,
      acknowledgedAt: "2026-07-20T08:10:00.000Z",
      createdAt: "2026-07-20T08:00:00.000Z",
      updatedAt: "2026-07-20T08:10:00.000Z",
    });
    const persisted = operationEvent({
      id: current.id,
      origin: "tray",
      domain: "link",
      action: "run",
      state: "failed",
      title: "启动联调链路",
      summary: "合作渠道联调 · 启动失败",
      detail: "端口已被占用",
      relatedHistoryKeys: [],
      payload: {
        linkKey: "cooperation-debug",
        linkName: "合作渠道联调",
        sourceId: "workspace-links",
        failedSteps: [
          {
            id: "proxy",
            type: "proxy.start",
            label: "启动代理",
            status: "failed",
            summary: "端口已被占用",
            risks: [],
          },
        ],
      },
    });

    const reconciled = reconcileHistoryActivities(
      [current],
      [],
      [],
      [],
      [persisted],
    );

    expect(reconciled[0]).toMatchObject({
      id: current.id,
      acknowledgedAt: "2026-07-20T08:10:00.000Z",
      action: null,
    });
  });
});
