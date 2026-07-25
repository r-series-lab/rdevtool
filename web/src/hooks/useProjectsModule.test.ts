import { describe, expect, it } from "vitest";
import type { ProjectDebugProfileSummary } from "../app-types";
import {
  buildProjectRuntimeLaunchPlan,
  projectRuntimePreflightBlocksStart,
  projectRuntimePreferencesAllowStart,
  resolveProjectRuntimeDebugProfile,
} from "./useProjectsModule";

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
    });
    expect(plan.startArgs.debugProfile).toBe(plan.preflightArgs.debugProfile);
    expect(plan.startArgs.envOverrides).toEqual({
      API_URL: "http://localhost:3000",
    });
  });

  it("uses null for both requests after a stale key falls back to default", () => {
    const plan = buildProjectRuntimeLaunchPlan({
      projectKey: "demo",
      runtimeEntry,
      requestedDebugProfileKey: "removed-profile",
    });

    expect(plan.preflightArgs.debugProfile).toBeNull();
    expect(plan.startArgs.debugProfile).toBe(plan.preflightArgs.debugProfile);
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

describe("project runtime preference hydration gate", () => {
  it("allows start only after enabled preferences have hydrated", () => {
    expect(projectRuntimePreferencesAllowStart(true, false)).toBe(false);
    expect(projectRuntimePreferencesAllowStart(false, true)).toBe(false);
    expect(projectRuntimePreferencesAllowStart(true, true)).toBe(true);
  });
});
