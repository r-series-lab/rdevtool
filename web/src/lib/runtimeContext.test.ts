import { describe, expect, it } from "vitest";
import {
  runtimeValueSourceLabel,
  runtimeWorkspaceScopeLabel,
} from "./runtimeContext";
import type { ProjectRuntimeWorkspaceContext } from "../app-types";

function workspace(
  runtimeProfileScope: ProjectRuntimeWorkspaceContext["runtimeProfileScope"],
): ProjectRuntimeWorkspaceContext {
  return {
    key: "feature",
    name: "Feature",
    system: false,
    projectInstancePath: "/workspace/demo",
    projectInstanceManaged: true,
    runtimeConfigSourceId: "workspace-feature",
    runtimeConfigSourceName: "Feature",
    runtimeConfigSourceKind: "workspace",
    runtimeConfigPath: "/workspace/runtime_overrides.toml",
    runtimeProfileScope,
  };
}

describe("runtime context source labels", () => {
  it("distinguishes workspace runtime environment scopes", () => {
    expect(runtimeWorkspaceScopeLabel(workspace("workspaceOverride"))).toBe(
      "工作区运行环境",
    );
    expect(runtimeWorkspaceScopeLabel(workspace("inherited"))).toBe(
      "继承的共享环境",
    );
    expect(runtimeWorkspaceScopeLabel(workspace("global"))).toBe(
      "全局共享环境",
    );
  });

  it("keeps proxy environment variables attached to their defining layer", () => {
    expect(
      runtimeValueSourceLabel(
        "runtimeProfile.networkProxy",
        workspace("workspaceOverride"),
      ),
    ).toBe("工作区运行环境");
    expect(
      runtimeValueSourceLabel("debugProfile.networkProxy", workspace("global")),
    ).toBe("项目启动档案");
    expect(runtimeValueSourceLabel("launchOverride", workspace("global"))).toBe(
      "本次启动覆盖",
    );
  });
});
