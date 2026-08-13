import { describe, expect, it } from "vitest";
import type {
  ProjectDebugProfileSummary,
  ProjectRuntimeEntry,
} from "../app-types";
import {
  buildProjectRuntimeLaunchPlan,
  compareFinderShortcutPriority,
  projectRuntimePreflightBlocksStart,
  projectRuntimePollingEnabled,
  projectRuntimePreferencesAllowStart,
  resolveProjectRuntimeDebugProfile,
  resolveWorkspaceDebugProfileKeys,
  resolveWorkspaceRuntimeStartPromptMode,
  sameRuntimeEntries,
  updateWorkspaceDebugProfileKey,
  updateWorkspaceRuntimeStartPromptMode,
} from "./useProjectsModule";

describe("resource shortcut priority", () => {
  const favorites = new Set(["favorite"]);
  const recentRanks = new Map([
    ["recent-first", 0],
    ["recent-second", 1],
  ]);

  it("orders favorites before recent entries and keeps recency order", () => {
    const keys = ["configured", "recent-second", "favorite", "recent-first"];

    expect(
      keys.sort((left, right) =>
        compareFinderShortcutPriority(left, right, favorites, recentRanks),
      ),
    ).toEqual(["favorite", "recent-first", "recent-second", "configured"]);
  });

  it("preserves configured order when neither entry has a preference", () => {
    expect(
      compareFinderShortcutPriority(
        "configured-a",
        "configured-b",
        favorites,
        recentRanks,
      ),
    ).toBe(0);
  });
});

function debugProfile(
  key: string,
  label: string,
): ProjectDebugProfileSummary {
  return {
    key,
    label,
    command: null,
    expectedPort: 5173,
    runtimeProfile: "browser-proxy",
    env: {},
    envCount: 0,
    localFileCount: 0,
    browser: null,
    browserProfile: null,
    browserUserDataDir: null,
    browserArgs: [],
    networkProxy: {
      enabled: true,
      proxyUrl: "http://127.0.0.1:7890",
      injectEnv: true,
      nodeHook: false,
      noProxy: "localhost",
    },
    localProxy: {
      enabled: false,
      listen: "127.0.0.1:4173",
      frontendUrl: "http://127.0.0.1:5173",
      upstreamProxy: "",
      routes: [],
      authHelper: {
        enabled: false,
        path: "",
        redirectPath: "",
        items: [],
      },
    },
  };
}

describe("project runtime debug profile inheritance", () => {
  const proxyProfile = debugProfile("proxy", "代理调试");
  const runtimeEntry = { debugProfiles: [proxyProfile] };

  it("uses a persisted key only while the runtime entry still contains it", () => {
    expect(resolveProjectRuntimeDebugProfile(runtimeEntry, " proxy ")).toEqual({
      key: "proxy",
      profile: proxyProfile,
    });
  });

  it("falls back to the default profile when the persisted key is stale", () => {
    expect(resolveProjectRuntimeDebugProfile(runtimeEntry, "removed-profile")).toEqual({
      key: "",
      profile: null,
    });
  });

  it("builds preflight and start requests with the same validated profile", () => {
    const plan = buildProjectRuntimeLaunchPlan({
      projectKey: "demo",
      runtimeEntry,
      requestedDebugProfileKey: "proxy",
      envOverrides: {
        " API_URL ": "http://localhost:3000",
        " ": "ignored",
      },
    });

    expect(plan.preflightArgs).toEqual({
      project: "demo",
      debugProfile: "proxy",
      runtimeProfile: null,
      command: null,
      expectedPort: null,
      envOverrides: {
        API_URL: "http://localhost:3000",
      },
    });
    expect(plan.startArgs.debugProfile).toBe(plan.preflightArgs.debugProfile);
    expect(plan.startArgs.envOverrides).toEqual(plan.preflightArgs.envOverrides);
  });

  it("uses null for both requests after a stale key falls back to default", () => {
    const plan = buildProjectRuntimeLaunchPlan({
      projectKey: "demo",
      runtimeEntry,
      requestedDebugProfileKey: "removed-profile",
    });

    expect(plan.preflightArgs.debugProfile).toBeNull();
    expect(plan.startArgs.debugProfile).toBe(plan.preflightArgs.debugProfile);
    expect(plan.preflightArgs.envOverrides).toBeNull();
    expect(plan.startArgs.envOverrides).toBe(plan.preflightArgs.envOverrides);
  });

  it("keeps a one-off port override identical across preflight and start", () => {
    const plan = buildProjectRuntimeLaunchPlan({
      projectKey: "demo",
      runtimeEntry,
      requestedDebugProfileKey: "proxy",
      expectedPort: 5174,
    });

    expect(plan.preflightArgs.expectedPort).toBe(5174);
    expect(plan.startArgs.expectedPort).toBe(5174);
  });
});

describe("project runtime polling equality", () => {
  it("ignores observation timestamps when runtime state is unchanged", () => {
    const current = [
      {
        key: "demo",
        statusKey: "running",
        updatedAtMs: 100,
      },
    ] as ProjectRuntimeEntry[];
    const refreshed = [
      {
        key: "demo",
        statusKey: "running",
        updatedAtMs: 2200,
      },
    ] as ProjectRuntimeEntry[];

    expect(sameRuntimeEntries(current, refreshed)).toBe(true);
  });

  it("detects a real runtime status transition", () => {
    const current = [
      {
        key: "demo",
        statusKey: "starting",
        updatedAtMs: 100,
      },
    ] as ProjectRuntimeEntry[];
    const refreshed = [
      {
        key: "demo",
        statusKey: "running",
        updatedAtMs: 2200,
      },
    ] as ProjectRuntimeEntry[];

    expect(sameRuntimeEntries(current, refreshed)).toBe(false);
  });
});

describe("project runtime preflight gate", () => {
  it.each([
    ["ok", false],
    ["warning", false],
    ["info", false],
    ["error", true],
    [" ERROR ", true],
  ])("maps %s to blocked=%s", (statusKey, blocked) => {
    expect(projectRuntimePreflightBlocksStart(statusKey)).toBe(blocked);
  });
});

describe("workspace launch profile preferences", () => {
  it("keeps the selected launch profile isolated per workspace", () => {
    const first = updateWorkspaceDebugProfileKey(
      "workspace-a",
      "demo",
      "uat",
      {},
      { demo: "legacy" },
    );
    const second = updateWorkspaceDebugProfileKey(
      "workspace-b",
      "demo",
      "dc2",
      first,
      { demo: "legacy" },
    );

    expect(
      resolveWorkspaceDebugProfileKeys("workspace-a", second, {}),
    ).toEqual({ demo: "uat" });
    expect(
      resolveWorkspaceDebugProfileKeys("workspace-b", second, {}),
    ).toEqual({ demo: "dc2" });
  });

  it("uses the old project preference until a workspace stores its own value", () => {
    expect(
      resolveWorkspaceDebugProfileKeys("workspace-a", {}, { demo: "legacy" }),
    ).toEqual({ demo: "legacy" });
  });

  it("persists an explicit project base selection", () => {
    const next = updateWorkspaceDebugProfileKey(
      "workspace-a",
      "demo",
      "",
      {},
      { demo: "legacy" },
    );

    expect(
      Object.prototype.hasOwnProperty.call(next["workspace-a"], "demo"),
    ).toBe(true);
    expect(next["workspace-a"].demo).toBe("");
  });
});

describe("workspace runtime start prompt preferences", () => {
  it("defaults to auto and keeps workspace choices isolated", () => {
    const first = updateWorkspaceRuntimeStartPromptMode(
      "workspace-a",
      "always",
      {},
    );
    const second = updateWorkspaceRuntimeStartPromptMode(
      "workspace-b",
      "never",
      first,
    );

    expect(resolveWorkspaceRuntimeStartPromptMode("missing", second)).toBe(
      "auto",
    );
    expect(resolveWorkspaceRuntimeStartPromptMode("workspace-a", second)).toBe(
      "always",
    );
    expect(resolveWorkspaceRuntimeStartPromptMode("workspace-b", second)).toBe(
      "never",
    );
  });
});

describe("project runtime preference hydration gate", () => {
  it("allows start only after enabled preferences have hydrated", () => {
    expect(projectRuntimePreferencesAllowStart(true, false)).toBe(false);
    expect(projectRuntimePreferencesAllowStart(false, true)).toBe(false);
    expect(projectRuntimePreferencesAllowStart(true, true)).toBe(true);
  });
});

describe("project runtime polling scope", () => {
  it("polls only while projects or resources are visible", () => {
    expect(projectRuntimePollingEnabled(true, true, "demo")).toBe(true);
    expect(projectRuntimePollingEnabled(true, false, "demo")).toBe(false);
    expect(projectRuntimePollingEnabled(true, true, "")).toBe(false);
    expect(projectRuntimePollingEnabled(false, true, "demo")).toBe(false);
  });
});
