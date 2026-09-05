import { describe, expect, it } from "vitest";
import type { OperationEventEntry } from "../app-types";
import {
  activityFromLifecycleOperationEvent,
  activityFromOperationEvent,
  activityFromResourceActionOperationEvent,
  buildHistoryFromOperationEvent,
  buildReplayRequestFromOperationEvent,
  isOperationEventEntry,
} from "./operationEvents";

function event(): OperationEventEntry {
  return {
    version: 1,
    id: "operation-cli-switch-1",
    origin: "cli",
    workspaceKey: "feature-a",
    domain: "git",
    action: "switch",
    state: "failed",
    title: "切换分支",
    summary: "切换分支失败",
    detail: "目标分支不存在",
    projectKey: "admin",
    projectName: "管理端",
    relatedHistoryKeys: [],
    payload: null,
    createdAt: "2026-07-22T01:00:00.000Z",
    updatedAt: "2026-07-22T01:00:00.000Z",
  };
}

describe("operation events", () => {
  it("validates and converts a terminal Git event", () => {
    const value: OperationEventEntry = {
      ...event(),
      chainId: "workspace-chain:delivery:cli-1",
      stepLabel: "推送分支",
      chainLabel: "发布流程",
    };

    expect(isOperationEventEntry(value)).toBe(true);
    expect(activityFromOperationEvent(value)).toMatchObject({
      id: value.id,
      kind: "branch",
      origin: "cli",
      status: "failed",
      detail: "目标分支不存在",
      chainId: "workspace-chain:delivery:cli-1",
      stepLabel: "推送分支",
      chainLabel: "发布流程",
      target: { page: "merge", branchMode: "switch" },
    });
  });

  it("restores a CLI Git replay request from the durable operation payload", () => {
    const value: OperationEventEntry = {
      ...event(),
      payload: {
        replay: {
          command: "execute_branch_switch_task",
          busyText: "正在重新切换分支",
          request: {
            project: "admin",
            targetBranch: "feature/a",
            repoPath: null,
          },
        },
      },
    };

    expect(activityFromOperationEvent(value)).toMatchObject({
      action: {
        kind: "branchReplay",
        replay: {
          command: "execute_branch_switch_task",
          request: { project: "admin", targetBranch: "feature/a" },
        },
      },
    });
  });

  it("rejects an event without a stable version", () => {
    expect(isOperationEventEntry({ ...event(), version: 2 })).toBe(false);
  });

  it("restores a durable resource Action activity without secret values", () => {
    const value: OperationEventEntry = {
      ...event(),
      id: "action-123",
      domain: "action",
      action: "run",
      state: "failed",
      title: "执行参数化 Action",
      summary: "部分部署任务未能提交",
      detail: "示例控制台: failed",
      payload: {
        actionKey: "batch-deploy-pre",
        effect: "remote_write",
        configPath: "/tmp/actions.toml",
        params: { projects: ["demo-console"], planOnly: false },
        providedSecretParams: ["token"],
        sideEffectOccurred: null,
        result: {
          structuredResult: {
            items: [
              {
                key: "demo-console",
                label: "示例控制台",
                status: "failed",
                summary: "部署触发失败",
                detail: "HTTP 403",
              },
            ],
          },
        },
      },
    };

    expect(activityFromResourceActionOperationEvent(value)).toMatchObject({
      id: "action-123",
      kind: "shortcut",
      status: "failed",
      executionKey: "action-123",
      parameters: [
        { key: "projects", value: "demo-console", masked: false },
        { key: "planOnly", value: "否", masked: false },
        { key: "token", value: "已提供", masked: true },
      ],
      diagnostics: [
        {
          id: "action:demo-console",
          status: "failed",
          summary: "部署触发失败",
          risks: ["HTTP 403"],
        },
      ],
      warnings: ["远程写入结果不明确，请先检查目标系统和运行日志，不要直接重试。"],
      resource: { value: "/tmp/actions.toml" },
      target: { page: "resources" },
    });
  });

  it("accepts an active build event and restores its compatibility history", () => {
    const value: OperationEventEntry = {
      ...event(),
      id: "activity-build-1",
      domain: "build",
      action: "deploy",
      state: "running",
      title: "触发部署",
      summary: "排队中 · 等待执行",
      detail: "等待执行",
      relatedHistoryKeys: ["http://jenkins/queue/item/42/"],
      payload: {
        historyKey: "http://jenkins/queue/item/42/",
        workspaceKey: "feature-a",
        projectKey: "admin",
        projectName: "管理端",
        mode: "vke",
        env: "dc2",
        branch: "feature/a",
        stateKey: "queued",
        stateLabel: "排队中",
        detail: "等待执行",
        queueUrl: "http://jenkins/queue/item/42/",
        buildUrl: null,
        params: { ENV_PROFILE: "dc2", retry: 2 },
      },
    };

    expect(isOperationEventEntry(value)).toBe(true);
    expect(buildHistoryFromOperationEvent(value)).toMatchObject({
      historyKey: "http://jenkins/queue/item/42/",
      projectKey: "admin",
      stateKey: "queued",
      params: { ENV_PROFILE: "dc2", retry: "2" },
    });
  });

  it("restores the exact failed build request from an operation event", () => {
    const value: OperationEventEntry = {
      ...event(),
      id: "activity-build-failed-1",
      domain: "build",
      action: "deploy",
      state: "failed",
      title: "触发部署",
      summary: "触发部署失败",
      detail: "构建计划已阻断：目标分支不存在",
      payload: {
        projectKey: "admin",
        projectName: "管理端",
        mode: "vke",
        stateKey: "failed",
        stateLabel: "失败",
        detail: "构建计划已阻断：目标分支不存在",
        params: { ENV_PROFILE: "dc2" },
        replayRequest: {
          project: "admin",
          target: "vke",
          variant: false,
          env: "dc2",
          branch: "feature/a",
          extraParams: { IS_GRAY: "false" },
          params: { ENV_PROFILE: "dc2" },
        },
      },
    };

    expect(buildReplayRequestFromOperationEvent(value)).toEqual({
      project: "admin",
      target: "vke",
      variant: false,
      env: "dc2",
      branch: "feature/a",
      extraParams: { IS_GRAY: "false" },
      params: { ENV_PROFILE: "dc2" },
    });
  });

  it("converts Runtime and proxy lifecycle events into their owning pages", () => {
    const runtime = activityFromLifecycleOperationEvent({
      ...event(),
      id: "activity-runtime-1",
      domain: "runtime",
      action: "start",
      state: "success",
      title: "dev 服务已启动",
      summary: "已启动 · dev 服务启动成功",
      payload: {
        projectKey: "admin",
        name: "管理端",
        logPath: "/tmp/admin.log",
      },
    });
    const proxy = activityFromLifecycleOperationEvent({
      ...event(),
      id: "operation-cli-proxy-start-1",
      domain: "proxy",
      action: "start",
      state: "success",
      title: "代理服务已启动",
      summary: "本地联调代理 · 已启动",
      projectKey: null,
      projectName: null,
      chainId: "workspace-chain:local-debug:cli-1",
      stepLabel: "启动代理",
      payload: {
        profileId: "local-debug",
        listenUrl: "http://127.0.0.1:8791",
      },
    });

    expect(runtime).toMatchObject({
      kind: "runtime",
      target: { page: "projectManagement", projectKey: "admin" },
      resource: { value: "/tmp/admin.log" },
    });
    expect(proxy).toMatchObject({
      kind: "proxy",
      origin: "cli",
      chainId: "workspace-chain:local-debug:cli-1",
      stepLabel: "启动代理",
      target: { page: "proxy" },
      executionKey: "proxy:start:local-debug",
    });
  });

  it("restores safe recovery actions for failed Runtime and proxy events", () => {
    const runtime = activityFromLifecycleOperationEvent({
      ...event(),
      id: "activity-runtime-failed",
      domain: "runtime",
      action: "start",
      state: "failed",
      title: "启动 dev 服务",
      summary: "启动前检查未通过",
      detail: "端口 8080 已被占用",
      payload: {
        projectKey: "admin",
        name: "管理端",
        debugProfile: "dc2",
        envOverrides: { APP_ENV: "dc2" },
        expectedPort: 5175,
      },
    });
    const proxy = activityFromLifecycleOperationEvent({
      ...event(),
      id: "operation-tray-proxy-failed",
      origin: "tray",
      domain: "proxy",
      action: "stop",
      state: "failed",
      title: "停止代理服务",
      summary: "代理服务停止失败",
      detail: "refusing to terminate unmanaged PID 22094",
      projectKey: null,
      projectName: null,
      payload: {
        profileId: "local-debug",
        profileName: "本地联调代理",
        sourceId: "workspace-proxy",
      },
    });

    expect(runtime).toMatchObject({
      diagnostics: [expect.objectContaining({ status: "failed" })],
      action: {
        kind: "runtimeRecover",
        projectKey: "admin",
        projectName: "管理端",
        debugProfileKey: "dc2",
        envOverrides: { APP_ENV: "dc2" },
        expectedPort: 5175,
        replayAction: "start",
      },
    });
    expect(proxy).toMatchObject({
      diagnostics: [expect.objectContaining({ status: "failed" })],
      action: {
        kind: "proxyRecover",
        profileId: "local-debug",
        profileName: "本地联调代理",
        sourceId: "workspace-proxy",
        replayAction: "stop",
      },
    });
  });

  it("does not offer an inexact Runtime replay for unsupported CLI overrides", () => {
    const runtime = activityFromLifecycleOperationEvent({
      ...event(),
      id: "operation-cli-runtime-custom-command",
      domain: "runtime",
      action: "start",
      state: "failed",
      title: "启动 dev 服务",
      summary: "dev 服务启动失败",
      detail: "command failed",
      payload: {
        projectKey: "admin",
        requestedCommand: "npm run dev:custom",
        requestedExpectedPort: 8088,
      },
    });

    expect(runtime).toMatchObject({
      action: null,
      warnings: [expect.stringContaining("CLI 启动覆盖")],
    });
  });

  it("converts a tray Link result with its source and failure evidence", () => {
    const activity = activityFromLifecycleOperationEvent({
      ...event(),
      id: "operation-tray-link-run-1",
      origin: "tray",
      domain: "link",
      action: "run",
      state: "failed",
      title: "启动联调链路",
      summary: "示例联调 · 完成 1 / 失败 1 / 跳过 0",
      detail: "启动代理：端口已被占用",
      payload: {
        linkKey: "demo-debug",
        linkName: "示例联调",
        mode: "run",
        sourceId: "workspace-links",
        proxySourceId: "workspace-proxy",
        runtimeSourceId: "workspace-runtime",
        failedCount: 1,
        diagnosticSteps: [
          {
            id: "proxy",
            type: "proxy.start",
            label: "启动代理",
            status: "failed",
            summary: "端口已被占用",
            risks: ["127.0.0.1:8791 已占用"],
          },
        ],
        warnings: ["请检查本地代理"],
      },
    });

    expect(activity).toMatchObject({
      kind: "link",
      origin: "tray",
      status: "failed",
      executionKey: "link:run:demo-debug",
      detail: "启动代理：端口已被占用",
      diagnostics: [
        expect.objectContaining({
          label: "启动代理",
          status: "failed",
          risks: ["127.0.0.1:8791 已占用"],
        }),
      ],
      warnings: ["请检查本地代理"],
      action: {
        kind: "linkRecover",
        label: "检查并重新启动",
        linkKey: "demo-debug",
        linkName: "示例联调",
        sourceId: "workspace-links",
        proxySourceId: "workspace-proxy",
        runtimeSourceId: "workspace-runtime",
        workspaceKey: "feature-a",
        replayAction: "run",
      },
      target: { page: "overview" },
    });
  });

  it("keeps workspace archive and restore operations visible in Activity", () => {
    const activity = activityFromLifecycleOperationEvent({
      ...event(),
      id: "operation-app-workspace-archive",
      origin: "app",
      workspaceKey: "feature-a",
      domain: "workspace",
      action: "archive",
      state: "success",
      title: "归档工作区",
      summary: "已归档工作区：Feature A",
      detail: "",
      projectKey: null,
      projectName: null,
    });

    expect(activity).toMatchObject({
      kind: "config",
      status: "success",
      executionKey: "workspace:archive:feature-a",
      target: {
        page: "overview",
        workspaceKey: "feature-a",
        workspaceView: "archived",
      },
      parameters: [
        { key: "workspace", value: "feature-a" },
        { key: "action", value: "归档" },
      ],
    });
  });
});
