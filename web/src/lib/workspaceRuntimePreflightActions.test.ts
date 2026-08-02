import { describe, expect, it } from "vitest";
import type { ProjectRuntimePreflightCheck } from "../app-types";
import { workspaceRuntimePreflightAction } from "./workspaceRuntimePreflightActions";

function check(
  key: string,
  category: string,
  action: string | null = "处理该问题",
): ProjectRuntimePreflightCheck {
  return {
    key,
    title: key,
    category,
    statusKey: "warning",
    statusLabel: "需留意",
    detail: "测试详情",
    action,
  };
}

describe("workspaceRuntimePreflightAction", () => {
  it("maps project command checks to local command settings", () => {
    expect(workspaceRuntimePreflightAction(check("devCommand", "runtime"))).toEqual({
      key: "openProjectSettings",
      label: "编辑本地命令",
      target: "projectSettings",
      section: "projectLocal",
    });
  });

  it("maps launch profile and local file checks to runtime settings", () => {
    expect(workspaceRuntimePreflightAction(check("devPort", "runtime"))).toMatchObject({
      target: "projectSettings",
      section: "projectRuntime",
    });
    expect(
      workspaceRuntimePreflightAction(
        check("localFile..env.local", "runtime"),
      ),
    ).toMatchObject({
      target: "projectSettings",
      section: "projectRuntime",
    });
  });

  it("maps shared runtime and proxy checks to their owning surfaces", () => {
    expect(
      workspaceRuntimePreflightAction(check("networkProxy", "network")),
    ).toMatchObject({
      target: "runtimePanel",
    });
    expect(
      workspaceRuntimePreflightAction(check("rdevProxyProfile", "proxy")),
    ).toMatchObject({
      target: "proxy",
    });
  });

  it("prefers a structured quick fix over navigation", () => {
    const proxyCheck = check("runtimeProxy", "network");
    proxyCheck.fix = {
      kind: "startProxy",
      label: "启动代理",
      description: "启动后重新检查。",
      confirmationRequired: true,
      sourceId: "workspace-proxy",
      sourceName: "工作区代理",
      profileId: "local-debug",
      profileName: "本地联调代理",
      listenUrl: "http://127.0.0.1:8791",
    };
    expect(workspaceRuntimePreflightAction(proxyCheck)).toMatchObject({
      key: "runQuickFix",
      label: "启动代理",
      target: "quickFix",
      fix: {
        sourceId: "workspace-proxy",
        profileId: "local-debug",
      },
    });
  });

  it("opens the project directory for node version guidance", () => {
    expect(
      workspaceRuntimePreflightAction(check("nodeVersion", "runtime")),
    ).toMatchObject({
      target: "projectDirectory",
    });
  });

  it("does not invent an action when the backend has no recommendation", () => {
    expect(workspaceRuntimePreflightAction(check("devCommand", "runtime", null))).toBeNull();
  });

  it("uses stable categories as a fallback without reading localized text", () => {
    expect(
      workspaceRuntimePreflightAction(
        check("futureRuntimeCheck", "runtime", "任意文案"),
      ),
    ).toMatchObject({
      target: "runtimePanel",
    });
    expect(
      workspaceRuntimePreflightAction(
        check("futureRuntimeCheck", "other", "完全不同的文案"),
      ),
    ).toBeNull();
  });
});
