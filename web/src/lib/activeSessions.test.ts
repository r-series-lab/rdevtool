import { describe, expect, it } from "vitest";
import type { ProjectRuntimeEntry, ProxyDashboard } from "../app-types";
import { activeSessionsFrom } from "./activeSessions";

function runtimeEntry(
  patch: Partial<ProjectRuntimeEntry> = {},
): ProjectRuntimeEntry {
  return {
    key: "portal",
    name: "Portal",
    category: "Web",
    statusKey: "stopped",
    statusLabel: "已停止",
    detail: "",
    buildStatusKey: "idle",
    buildStatusLabel: "待打包",
    buildDetail: "",
    updatedAtMs: 1,
    canStart: true,
    canStop: false,
    canAdopt: false,
    canBuild: true,
    canStopBuild: false,
    canOpenBuildOutput: false,
    canFocusRuntime: false,
    debugProfiles: [],
    ...patch,
  };
}

describe("active sessions", () => {
  it("keeps only live runtime and local build processes", () => {
    const sessions = activeSessionsFrom(
      [
        runtimeEntry({
          statusKey: "running",
          statusLabel: "运行中",
          canStop: true,
          canFocusRuntime: true,
          readyUrl: "http://127.0.0.1:5173/ready",
          pid: 120,
          buildStatusKey: "running",
          buildStatusLabel: "打包中",
          canStopBuild: true,
          buildPid: 121,
        }),
        runtimeEntry({ key: "idle", name: "Idle" }),
      ],
      null,
      "default",
      {
        activeProjectKeys: ["portal"],
        observedAtMs: 42,
      },
    );

    expect(sessions.map((session) => session.id)).toEqual([
      "runtime:portal",
      "build:portal",
    ]);
    expect(sessions[0]).toMatchObject({
      port: 5173,
      pid: 120,
      managed: true,
      canFocus: true,
      scope: "current",
      observedAtMs: 42,
    });
  });

  it("marks detected external runtimes as read-only", () => {
    const sessions = activeSessionsFrom(
      [
        runtimeEntry({
          statusKey: "external",
          statusLabel: "运行中（外部）",
          focusUrl: "http://localhost:8080",
          pid: 222,
          canAdopt: true,
        }),
      ],
      null,
      "default",
      { activeProjectKeys: [] },
    );

    expect(sessions[0]).toMatchObject({
      external: true,
      managed: false,
      canAdopt: true,
      canStop: false,
      port: 8080,
      scope: "other",
    });
  });

  it("includes running proxy profiles with their source identity", () => {
    const dashboard: ProxyDashboard = {
      configPath: "/tmp/proxy.toml",
      config: {
        profiles: [{
          id: "local",
          workspaceKey: "feature-a",
          name: "Local API",
          listenHost: "127.0.0.1",
          listenPort: 8791,
          upstreamBaseUrl: "",
          upstreamProxy: "",
          captureBody: true,
          maxBodyBytes: 1024,
        }],
        rules: [],
      },
      statuses: [{
        profileId: "local",
        running: true,
        managed: true,
        versionCompatible: true,
        listenUrl: "http://127.0.0.1:8791",
        pid: 700,
        startedAt: "2026-08-03T01:00:00Z",
        owner: "rDevTool proxy daemon (PID 700)",
        detail: "proxy daemon is listening",
      }],
      events: [
        {
          id: "request-1",
          profileId: "local",
          profileName: "Local API",
          startedAt: "2026-08-03T01:01:00Z",
          durationMs: 18,
          method: "GET",
          url: "http://127.0.0.1:8791/api/orders",
          path: "/api/orders",
          status: 502,
          action: "forward",
          requestBytes: 0,
          responseBytes: 0,
          requestHeaders: {},
          responseHeaders: {},
          requestBodyPreview: "",
          responseBodyPreview: "",
          requestBodyTruncated: false,
          responseBodyTruncated: false,
        },
      ],
    };

    const sessions = activeSessionsFrom(
      [],
      dashboard,
      "workspace-feature-a",
      { observedAtMs: 88 },
    );

    expect(sessions[0]).toMatchObject({
      id: "proxy:workspace-feature-a:local",
      name: "Local API",
      proxySourceId: "workspace-feature-a",
      port: 8791,
      canStop: true,
      managed: true,
      external: false,
      pid: 700,
      scope: "shared",
      observedAtMs: 88,
      proxyActivity: {
        requestCount: 1,
        errorCount: 1,
        lastRequestMethod: "GET",
        lastRequestPath: "/api/orders",
        lastRequestStatus: 502,
      },
    });
  });

  it("keeps external proxy listeners visible and read-only", () => {
    const dashboard: ProxyDashboard = {
      configPath: "/tmp/proxy.toml",
      config: {
        profiles: [{
          id: "occupied",
          name: "Occupied API",
          listenHost: "127.0.0.1",
          listenPort: 8792,
          upstreamBaseUrl: "",
          upstreamProxy: "",
          captureBody: true,
          maxBodyBytes: 1024,
        }],
        rules: [],
      },
      statuses: [{
        profileId: "occupied",
        running: true,
        managed: false,
        versionCompatible: false,
        listenUrl: "http://127.0.0.1:8792",
        pid: null,
        startedAt: null,
        owner: "node (PID 812)",
        detail: "port is listening but is not owned by rDevTool daemon",
      }],
      events: [{
        id: "stale-request",
        profileId: "occupied",
        profileName: "Occupied API",
        startedAt: "2026-08-03T01:01:00Z",
        durationMs: 18,
        method: "GET",
        url: "http://127.0.0.1:8792/stale",
        path: "/stale",
        status: 200,
        action: "forward",
        requestBytes: 0,
        responseBytes: 0,
        requestHeaders: {},
        responseHeaders: {},
        requestBodyPreview: "",
        responseBodyPreview: "",
        requestBodyTruncated: false,
        responseBodyTruncated: false,
      }],
    };

    expect(activeSessionsFrom([], dashboard, "default")[0]).toMatchObject({
      statusKey: "external",
      statusLabel: "外部占用",
      detail: "node (PID 812)",
      managed: false,
      external: true,
      canStop: false,
      proxyActivity: { requestCount: 0, errorCount: 0 },
    });
  });

  it("includes controlled browsers as shared read-only resources", () => {
    const sessions = activeSessionsFrom([], null, "default", {
      observedAtMs: 101,
      browserSessions: [{
        id: "browser:9223",
        port: 9223,
        endpoint: "http://127.0.0.1:9223",
        browserName: "Chrome",
        browserVersion: "139.0.7258.67",
        protocolVersion: "1.3",
        pageCount: 2,
        pages: [{
          id: "page-1",
          title: "Portal",
          url: "http://127.0.0.1:5173/portal",
        }],
        runtimeProfileKeys: ["web-cdp"],
        activeProjects: [{ key: "portal", name: "Portal" }],
        configuredProjects: [{ key: "portal", name: "Portal" }],
      }],
    });

    expect(sessions[0]).toMatchObject({
      id: "browser:9223",
      kind: "browser",
      scope: "shared",
      statusKey: "connected",
      statusLabel: "CDP 已连接",
      endpoint: "http://127.0.0.1:9223",
      port: 9223,
      observedAtMs: 101,
      managed: false,
      external: false,
      canStop: false,
      browserInfo: {
        pageCount: 2,
        runtimeProfileKeys: ["web-cdp"],
      },
    });
  });

  it("includes running Actions with workspace scope and cancellation state", () => {
    const sessions = activeSessionsFrom([], null, "default", {
      workspaceKey: "demo-workspace",
      observedAtMs: 202,
      actionSessions: [
        {
          operationId: "action-20260810-1",
          phase: "run",
          actionKey: "batch-deploy-pre",
          actionName: "批量部署 Pre",
          workspaceKey: "demo-workspace",
          startedAtMs: 101,
          cancellationRequested: false,
          logTail: "checking project\ntriggering Jenkins\n",
          outputSuppressed: false,
        },
        {
          operationId: "action-20260810-2",
          phase: "apply",
          actionKey: "secret-action",
          actionName: "敏感 Action",
          workspaceKey: "other-workspace",
          startedAtMs: 102,
          cancellationRequested: true,
          logTail: "",
          outputSuppressed: true,
        },
      ],
    });

    expect(sessions[0]).toMatchObject({
      id: "action:action-20260810-1",
      kind: "action",
      scope: "current",
      name: "批量部署 Pre",
      operationId: "action-20260810-1",
      actionPhase: "run",
      statusKey: "running",
      detail: "triggering Jenkins",
      canStop: true,
      observedAtMs: 202,
    });
    expect(sessions[1]).toMatchObject({
      id: "action:action-20260810-2",
      scope: "other",
      statusKey: "stopping",
      statusLabel: "正在停止",
      detail: "Action 实时输出已隐藏",
      canStop: false,
    });
  });
});
