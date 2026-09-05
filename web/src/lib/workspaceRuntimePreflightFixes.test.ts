import { describe, expect, it } from "vitest";
import type { ProjectRuntimePreflightFix } from "../app-types";
import { workspaceRuntimePreflightFixPlan } from "./workspaceRuntimePreflightFixes";

function startProxyFix(
  patch: Partial<ProjectRuntimePreflightFix> = {},
): ProjectRuntimePreflightFix {
  return {
    kind: "startProxy",
    label: "启动代理",
    description: "启动代理后重新检查。",
    confirmationRequired: true,
    sourceId: "workspace-proxy",
    sourceName: "工作区代理",
    profileId: "local-debug",
    profileName: "本地联调代理",
    listenUrl: "http://127.0.0.1:8791",
    ...patch,
  };
}

describe("workspaceRuntimePreflightFixPlan", () => {
  it("builds a readable proxy start plan from structured fields", () => {
    expect(workspaceRuntimePreflightFixPlan(startProxyFix())).toMatchObject({
      kind: "startProxy",
      title: "启动 本地联调代理",
      confirmLabel: "启动并重新检查",
      steps: [
        { label: "配置来源", detail: "工作区代理" },
        {
          label: "代理服务",
          detail: "本地联调代理 · http://127.0.0.1:8791",
        },
        { label: "完成后", detail: "刷新当前项目的启动预检" },
      ],
    });
  });

  it("rejects incomplete or unsupported fixes", () => {
    expect(
      workspaceRuntimePreflightFixPlan(startProxyFix({ profileId: null })),
    ).toBeNull();
    expect(
      workspaceRuntimePreflightFixPlan(startProxyFix({ kind: "futureFix" })),
    ).toBeNull();
  });

  it("builds a Vite port override plan", () => {
    expect(
      workspaceRuntimePreflightFixPlan({
        kind: "changePort",
        label: "换用 5174",
        description: "端口 5173 已被占用。",
        confirmationRequired: true,
        currentPort: 5173,
        suggestedPort: 5174,
      }),
    ).toMatchObject({
      kind: "changePort",
      title: "换用空闲端口",
      confirmLabel: "使用 5174 启动",
      currentPort: 5173,
      suggestedPort: 5174,
    });
  });

  it("builds a detected launch profile plan", () => {
    expect(
      workspaceRuntimePreflightFixPlan({
        kind: "createProfile",
        label: "生成启动档案",
        description: "继承项目基础配置。",
        confirmationRequired: true,
        profileKey: "demo-local",
        profileLabel: "Demo 本地启动",
        command: "npm run dev",
        cwd: "/workspace/demo",
        suggestedPort: 5173,
        nodeVersion: "20",
        packageManager: "npm",
      }),
    ).toMatchObject({
      kind: "createProfile",
      profileKey: "demo-local",
      profileLabel: "Demo 本地启动",
      expectedPort: 5173,
      confirmLabel: "创建并使用",
      steps: [
        { label: "项目基础命令", detail: "npm run dev" },
        { label: "工作目录", detail: "/workspace/demo" },
        { label: "检测结果", detail: "npm · Node 20 · 端口 5173" },
      ],
    });
  });

  it("builds a stale profile reset plan", () => {
    expect(
      workspaceRuntimePreflightFixPlan({
        kind: "resetProfile",
        label: "使用基础配置",
        description: "清除失效选择。",
        confirmationRequired: true,
      }),
    ).toMatchObject({
      kind: "resetProfile",
      title: "恢复项目基础配置",
      confirmLabel: "恢复基础配置",
    });
  });
});
