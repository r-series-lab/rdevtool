import { describe, expect, it, vi } from "vitest";
import type {
  ProjectConfigEditorState,
  RuntimeProfileDraft,
} from "../app-types";
import { loadLinkWizardRuntimeProfiles } from "./LinkToolWizardDialog";

function runtimeProfile(key: string): RuntimeProfileDraft {
  return {
    key,
    label: key,
    webActionsEnabled: false,
    webActionsPort: 0,
    browserArgsText: "",
    proxyUrl: "",
    proxyBypass: "",
    hostResolverRulesText: "",
    networkProxy: {
      enabled: false,
      proxyUrl: "",
      injectEnv: false,
      nodeHook: false,
      noProxy: "",
    },
  };
}

function editorState(
  runtimeProfiles: RuntimeProfileDraft[],
): ProjectConfigEditorState {
  return {
    configPath: "/tmp/projects.toml",
    runtimeConfigPath: "/tmp/runtime-overrides.toml",
    runtimeProfileScope: "override",
    jenkinsProfiles: [],
    defaultBranchRules: {
      sourceKeywords: [],
      targetKeywords: [],
    },
    runtimeProfiles,
    projects: [],
  };
}

describe("LinkToolWizardDialog runtime source loading", () => {
  it("loads profiles from the resolved workspace runtime source", async () => {
    const runtimeProfiles = [runtimeProfile("workspace-runtime")];
    const loadEditor = vi.fn(async (sourceId: string) => {
      expect(sourceId).toBe("workspace-feature");
      return editorState(runtimeProfiles);
    });

    await expect(
      loadLinkWizardRuntimeProfiles(" workspace-feature ", loadEditor),
    ).resolves.toEqual(runtimeProfiles);
    expect(loadEditor).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the runtime source is invalid", async () => {
    const loadEditor = vi.fn(async () =>
      editorState([runtimeProfile("resource-runtime")]),
    );

    await expect(
      loadLinkWizardRuntimeProfiles(" ", loadEditor),
    ).rejects.toThrow("运行配置源不能为空");
    expect(loadEditor).not.toHaveBeenCalled();
  });
});
