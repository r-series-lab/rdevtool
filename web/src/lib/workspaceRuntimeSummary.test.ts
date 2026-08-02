import { describe, expect, it } from "vitest";
import type { ProjectRuntimeEntry } from "../app-types";
import { workspaceProjectRuntimeProfileInfo } from "./workspaceRuntimeSummary";

const runtimeEntry: ProjectRuntimeEntry = {
  key: "demo",
  name: "Demo",
  category: "work",
  repoPath: "/workspace/demo",
  command: "npm run dev",
  cwd: "/workspace/demo",
  focusUrl: null,
  readyUrl: null,
  statusKey: "stopped",
  statusLabel: "未启动",
  detail: "",
  pid: null,
  startedAtMs: null,
  logPath: null,
  buildCommand: null,
  buildCwd: null,
  buildOutputDir: null,
  buildStatusKey: "idle",
  buildStatusLabel: "待构建",
  buildDetail: "",
  buildPid: null,
  buildStartedAtMs: null,
  buildLogPath: null,
  updatedAtMs: 0,
  canStart: true,
  canStop: false,
  canAdopt: false,
  canBuild: false,
  canStopBuild: false,
  canOpenBuildOutput: false,
  canFocusRuntime: false,
  debugProfiles: [
    {
      key: "uat3",
      label: "UAT3",
      command: "npm run dev -- --mode uat3",
      cwd: null,
      expectedPort: 5173,
      focusUrl: null,
      readyProbe: null,
      runtimeProfile: "shared-browser",
      env: {},
      envCount: 0,
      localFileCount: 0,
      browser: null,
      browserProfile: null,
      browserUserDataDir: null,
      browserArgs: [],
      networkProxy: {
        enabled: false,
        proxyUrl: "",
        injectEnv: true,
        nodeHook: false,
        noProxy: "",
      },
      localProxy: {
        enabled: false,
        listen: "",
        frontendUrl: "",
        upstreamProxy: "",
        routes: [],
        authHelper: {
          enabled: false,
          path: "",
          redirectPath: "",
          items: [],
        },
      },
    },
  ],
};

describe("workspace runtime summary", () => {
  it("labels the active workspace selection and runtime source", () => {
    const result = workspaceProjectRuntimeProfileInfo(
      runtimeEntry,
      "uat3",
      {
        runtimeConfigSourceName: "需求工作区",
        runtimeProfileScope: "workspaceOverride",
      },
      true,
    );

    expect(result.debugProfileKey).toBe("uat3");
    expect(result.summary).toContain("档案 UAT3");
    expect(result.sourceTags.map((tag) => tag.label)).toEqual([
      "档案 · 工作区默认",
      "命令/端口 · 项目启动档案",
      "环境 · 工作区运行环境",
    ]);
    expect(result.sourceTags[result.sourceTags.length - 1]?.title).toContain(
      "配置源：需求工作区",
    );
  });

  it("does not reuse the active workspace selection for inactive workspaces", () => {
    const result = workspaceProjectRuntimeProfileInfo(
      runtimeEntry,
      "uat3",
      {
        runtimeConfigSourceName: "其他工作区",
        runtimeProfileScope: "inherited",
      },
      false,
    );

    expect(result.debugProfileKey).toBe("");
    expect(result.profileMissing).toBe(false);
    expect(result.summary).toBe("切换到该工作区后读取默认启动档案");
    expect(result.sourceTags).toEqual([]);
  });

  it("keeps a stale workspace profile visible until it is repaired", () => {
    const result = workspaceProjectRuntimeProfileInfo(
      runtimeEntry,
      "removed",
      {
        runtimeConfigSourceName: "需求工作区",
        runtimeProfileScope: "workspaceOverride",
      },
      true,
    );

    expect(result.debugProfileKey).toBe("removed");
    expect(result.profileMissing).toBe(true);
    expect(result.summary).toContain("档案 缺失 (removed)");
    expect(result.sourceTags[0]?.label).toBe("档案 · 选择已失效");
  });
});
