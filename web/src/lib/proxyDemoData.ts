import type { ProxyDashboard, ProxyEvent, ProxyProfile, ProxyRule } from "../app-types";

export const PROXY_DEMO_CONFIG_PATH = "dev://proxy-demo";

const demoProfiles: ProxyProfile[] = [
  {
    id: "demo-default",
    name: "默认代理",
    listenHost: "127.0.0.1",
    listenPort: 8787,
    upstreamBaseUrl: "",
    upstreamProxy: "socks5://127.0.0.1:7890",
    captureBody: true,
    maxBodyBytes: 4096,
  },
  {
    id: "demo-staging",
    name: "预发接口",
    listenHost: "127.0.0.1",
    listenPort: 8788,
    upstreamBaseUrl: "https://staging.example.internal",
    upstreamProxy: "",
    captureBody: true,
    maxBodyBytes: 8192,
  },
];

const demoRules: ProxyRule[] = [
  {
    id: "demo-rule-session",
    profileId: "demo-default",
    enabled: true,
    name: "Mock 登录态",
    priority: 10,
    method: "GET",
    urlContains: "",
    pathPrefix: "/api/session",
    headerName: "",
    headerContains: "",
    action: {
      kind: "mock",
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: '{\n  "user": "ikiru",\n  "role": "admin"\n}',
      headers: {
        "x-rdevtool-rule": "session",
      },
      delayMs: 80,
    },
  },
  {
    id: "demo-rule-rewrite",
    profileId: "demo-default",
    enabled: true,
    name: "重写 GraphQL",
    priority: 20,
    method: "POST",
    urlContains: "graphql",
    pathPrefix: "/api/graphql",
    headerName: "",
    headerContains: "",
    action: {
      kind: "forward",
      targetBaseUrl: "https://api.example.internal",
      rewritePrefix: "/v2/graphql",
      requestHeaders: {
        "x-debug-proxy": "rdevtool",
      },
      responseHeaders: {
        "cache-control": "no-store",
      },
      delayMs: 0,
    },
  },
  {
    id: "demo-rule-block",
    profileId: "demo-default",
    enabled: true,
    name: "阻断埋点",
    priority: 30,
    method: "POST",
    urlContains: "analytics",
    pathPrefix: "/collect",
    headerName: "",
    headerContains: "",
    action: {
      kind: "block",
      status: 204,
      body: "",
      delayMs: 0,
    },
  },
  {
    id: "demo-rule-profile",
    profileId: "demo-staging",
    enabled: true,
    name: "预发用户资料",
    priority: 10,
    method: "GET",
    urlContains: "",
    pathPrefix: "/api/profile",
    headerName: "x-env",
    headerContains: "staging",
    action: {
      kind: "forward",
      targetBaseUrl: "https://staging.example.internal",
      rewritePrefix: "/internal/profile",
      requestHeaders: {},
      responseHeaders: {
        "x-proxy-env": "staging",
      },
      delayMs: 120,
    },
  },
  {
    id: "demo-rule-flaky",
    profileId: "demo-staging",
    enabled: false,
    name: "模拟慢响应",
    priority: 40,
    method: "GET",
    urlContains: "",
    pathPrefix: "/api/slow",
    headerName: "",
    headerContains: "",
    action: {
      kind: "mock",
      status: 503,
      contentType: "application/json; charset=utf-8",
      body: '{\n  "message": "temporary unavailable"\n}',
      headers: {},
      delayMs: 1200,
    },
  },
];

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function demoEvent(
  index: number,
  patch: Partial<ProxyEvent>,
): ProxyEvent {
  const profileId = patch.profileId ?? "demo-default";
  const profileName = demoProfiles.find((item) => item.id === profileId)?.name ?? "默认代理";
  return {
    id: `demo-event-${index}`,
    profileId,
    profileName,
    startedAt: minutesAgo(index * 4 + 2),
    durationMs: 42 + index * 9,
    method: "GET",
    url: `https://example.internal/api/items/${index}`,
    path: `/api/items/${index}`,
    status: 200,
    action: "forward",
    matchedRuleId: null,
    matchedRuleName: null,
    requestBytes: 320 + index * 17,
    responseBytes: 980 + index * 53,
    requestHeaders: {
      accept: "application/json",
      "user-agent": "rDevTool Demo",
    },
    responseHeaders: {
      "content-type": "application/json; charset=utf-8",
    },
    requestBodyPreview: "",
    responseBodyPreview: `{\n  "ok": true,\n  "index": ${index}\n}`,
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    error: null,
    ...patch,
  };
}

export function createProxyDemoDashboard(): ProxyDashboard {
  return {
    configPath: PROXY_DEMO_CONFIG_PATH,
    config: {
      profiles: demoProfiles,
      rules: demoRules,
    },
    statuses: [
      {
        profileId: "demo-default",
        running: true,
        listenUrl: "http://127.0.0.1:8787",
        startedAt: minutesAgo(32),
      },
      {
        profileId: "demo-staging",
        running: false,
        listenUrl: "http://127.0.0.1:8788",
        startedAt: null,
      },
    ],
    events: [
      demoEvent(1, {
        method: "GET",
        path: "/api/session",
        url: "https://ioc.example.internal/api/session",
        action: "mock",
        matchedRuleId: "demo-rule-session",
        matchedRuleName: "Mock 登录态",
        responseBytes: 186,
      }),
      demoEvent(2, {
        method: "POST",
        path: "/api/graphql",
        url: "https://ioc.example.internal/api/graphql?operation=ProjectList",
        action: "forward",
        matchedRuleId: "demo-rule-rewrite",
        matchedRuleName: "重写 GraphQL",
        durationMs: 168,
        requestBodyPreview: '{\n  "operationName": "ProjectList"\n}',
        responseBodyPreview: '{\n  "data": {\n    "projects": 24\n  }\n}',
      }),
      demoEvent(3, {
        method: "POST",
        path: "/collect/event",
        url: "https://analytics.example.internal/collect/event",
        status: 204,
        action: "block",
        matchedRuleId: "demo-rule-block",
        matchedRuleName: "阻断埋点",
        responseBytes: 0,
      }),
      demoEvent(4, {
        profileId: "demo-staging",
        method: "GET",
        path: "/api/profile/current",
        url: "https://staging.example.internal/api/profile/current",
        matchedRuleId: "demo-rule-profile",
        matchedRuleName: "预发用户资料",
        durationMs: 241,
      }),
      demoEvent(5, {
        method: "PUT",
        path: "/api/settings/theme",
        url: "https://ioc.example.internal/api/settings/theme",
        durationMs: 88,
        requestBodyPreview: '{\n  "style": "mono"\n}',
      }),
      demoEvent(6, {
        method: "GET",
        path: "/api/report/very-long-path-that-should-truncate-cleanly-in-the-list",
        url: "https://ioc.example.internal/api/report/very-long-path-that-should-truncate-cleanly-in-the-list?source=debug&keyword=proxy-layout",
        durationMs: 312,
        responseBodyTruncated: true,
      }),
      demoEvent(7, {
        method: "DELETE",
        path: "/api/cache/session",
        url: "https://ioc.example.internal/api/cache/session",
        status: 500,
        action: "error",
        error: "upstream connection reset",
        responseBodyPreview: "",
      }),
      demoEvent(8, {
        profileId: "demo-staging",
        method: "GET",
        path: "/api/slow",
        url: "https://staging.example.internal/api/slow",
        status: 503,
        action: "mock",
        matchedRuleId: "demo-rule-flaky",
        matchedRuleName: "模拟慢响应",
        durationMs: 1220,
      }),
      demoEvent(9, { method: "PATCH", path: "/api/projects/rdevtool", url: "https://ioc.example.internal/api/projects/rdevtool" }),
      demoEvent(10, { method: "GET", path: "/api/branches/recent", url: "https://ioc.example.internal/api/branches/recent" }),
      demoEvent(11, { method: "POST", path: "/api/deploy/replay", url: "https://ioc.example.internal/api/deploy/replay" }),
      demoEvent(12, { method: "GET", path: "/healthz", url: "https://ioc.example.internal/healthz", action: "tunnel" }),
    ],
  };
}
