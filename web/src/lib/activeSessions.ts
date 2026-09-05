import type { ProjectRuntimeEntry, ProxyDashboard } from "../app-types";

export type ActiveSessionKind = "runtime" | "build" | "action" | "proxy" | "browser";
export type ActiveSessionScope = "current" | "other" | "shared";

export type RunningResourceActionSnapshot = {
  operationId: string;
  phase: "plan" | "apply" | "run" | string;
  actionKey: string;
  actionName: string;
  workspaceKey: string;
  startedAtMs: number;
  cancellationRequested: boolean;
  logTail: string;
  outputSuppressed: boolean;
};

export type ControlledBrowserProjectReference = {
  key: string;
  name: string;
};

export type ControlledBrowserPage = {
  id: string;
  title: string;
  url: string;
};

export type ControlledBrowserSessionSnapshot = {
  id: string;
  port: number;
  endpoint: string;
  browserName: string;
  browserVersion?: string | null;
  protocolVersion?: string | null;
  pageCount: number;
  pages: ControlledBrowserPage[];
  runtimeProfileKeys: string[];
  activeProjects: ControlledBrowserProjectReference[];
  configuredProjects: ControlledBrowserProjectReference[];
};

export type ActiveSessionProxyActivity = {
  requestCount: number;
  errorCount: number;
  lastRequestAtMs?: number | null;
  lastRequestMethod?: string | null;
  lastRequestPath?: string | null;
  lastRequestStatus?: number | null;
};

export type ActiveSession = {
  id: string;
  kind: ActiveSessionKind;
  scope: ActiveSessionScope;
  name: string;
  statusKey: string;
  statusLabel: string;
  detail: string;
  projectKey?: string | null;
  proxyProfileId?: string | null;
  proxySourceId?: string | null;
  endpoint?: string | null;
  port?: number | null;
  pid?: number | null;
  startedAtMs?: number | null;
  observedAtMs?: number | null;
  logPath?: string | null;
  directoryPath?: string | null;
  outputPath?: string | null;
  operationId?: string | null;
  actionPhase?: string | null;
  managed: boolean;
  external: boolean;
  canAdopt: boolean;
  canFocus: boolean;
  canStop: boolean;
  canOpenLog: boolean;
  canOpenDirectory: boolean;
  canOpenOutput: boolean;
  proxyActivity?: ActiveSessionProxyActivity | null;
  browserInfo?: ControlledBrowserSessionSnapshot | null;
};

export type ActiveSessionAction =
  | "adopt"
  | "details"
  | "focus"
  | "inspect"
  | "openLog"
  | "openDirectory"
  | "openOutput"
  | "stop";

export type ActiveSessionActionResult = {
  ok: boolean;
  message?: string | null;
  inspection?: ActiveSessionPortInspection | null;
};

export type ActiveSessionPortProcess = {
  pid: number;
  ppid: number;
  pgid: number;
  name: string;
  command: string;
  cwd: string;
  startedAt: string;
  matchesExpectedPid: boolean;
  matchesExpectedDirectory: boolean;
};

export type ActiveSessionPortInspection = {
  port: number;
  inspectedAtMs: number;
  platformSupported: boolean;
  listening: boolean;
  ownershipKey:
    | "expectedPid"
    | "expectedDirectory"
    | "mismatch"
    | "notListening"
    | "unverified"
    | "unsupported"
    | string;
  ownershipVerified: boolean;
  expectedPid?: number | null;
  expectedDirectoryPath?: string | null;
  listeners: ActiveSessionPortProcess[];
};

export type ActiveSessionsContext = {
  activeProjectKeys?: Iterable<string>;
  actionSessions?: RunningResourceActionSnapshot[];
  browserSessions?: ControlledBrowserSessionSnapshot[];
  includeAllProjects?: boolean;
  observedAtMs?: number | null;
  workspaceKey?: string;
};

function endpointPort(value?: string | null): number | null {
  const endpoint = value?.trim();
  if (!endpoint) {
    return null;
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.port) {
      return Number(parsed.port) || null;
    }
    if (parsed.protocol === "http:") {
      return 80;
    }
    if (parsed.protocol === "https:") {
      return 443;
    }
  } catch {
    const match = endpoint.match(/:(\d{2,5})(?:\b|\/)/);
    return match ? Number(match[1]) || null : null;
  }
  return null;
}

function runtimeIsActive(entry: ProjectRuntimeEntry) {
  return (
    entry.canStop ||
    entry.statusKey === "running" ||
    entry.statusKey === "external" ||
    entry.statusKey === "starting" ||
    entry.statusKey === "stopping"
  );
}

function runtimeSessions(
  entries: ProjectRuntimeEntry[],
  context: ActiveSessionsContext,
): ActiveSession[] {
  const activeProjectKeys = new Set(context.activeProjectKeys ?? []);
  const projectScope = (projectKey: string): ActiveSessionScope =>
    context.includeAllProjects || activeProjectKeys.has(projectKey)
      ? "current"
      : "other";
  return entries.flatMap((entry) => {
    const sessions: ActiveSession[] = [];
    if (runtimeIsActive(entry)) {
      const endpoint = entry.readyUrl || entry.focusUrl || null;
      sessions.push({
        id: `runtime:${entry.key}`,
        kind: "runtime",
        scope: projectScope(entry.key),
        name: entry.name,
        statusKey: entry.statusKey,
        statusLabel: entry.statusLabel,
        detail: entry.detail,
        projectKey: entry.key,
        endpoint,
        port: endpointPort(endpoint),
        pid: entry.pid ?? null,
        startedAtMs: entry.startedAtMs ?? null,
        observedAtMs: context.observedAtMs ?? null,
        logPath: entry.logPath ?? null,
        directoryPath: entry.cwd || entry.repoPath || null,
        managed: entry.canStop,
        external: entry.statusKey === "external",
        canAdopt: entry.canAdopt,
        canFocus: entry.canFocusRuntime,
        canStop: entry.canStop,
        canOpenLog: Boolean(entry.logPath),
        canOpenDirectory: Boolean(entry.cwd || entry.repoPath),
        canOpenOutput: false,
      });
    }

    if (entry.buildStatusKey === "running" || entry.canStopBuild) {
      sessions.push({
        id: `build:${entry.key}`,
        kind: "build",
        scope: projectScope(entry.key),
        name: entry.name,
        statusKey: entry.buildStatusKey,
        statusLabel: entry.buildStatusLabel,
        detail: entry.buildDetail,
        projectKey: entry.key,
        pid: entry.buildPid ?? null,
        startedAtMs: entry.buildStartedAtMs ?? null,
        observedAtMs: context.observedAtMs ?? null,
        logPath: entry.buildLogPath ?? null,
        directoryPath: entry.buildCwd || entry.repoPath || null,
        outputPath: entry.buildOutputDir ?? null,
        managed: entry.canStopBuild,
        external: false,
        canAdopt: false,
        canFocus: false,
        canStop: entry.canStopBuild,
        canOpenLog: Boolean(entry.buildLogPath),
        canOpenDirectory: Boolean(entry.buildCwd || entry.repoPath),
        canOpenOutput: entry.canOpenBuildOutput,
      });
    }
    return sessions;
  });
}

function proxySessions(
  dashboard: ProxyDashboard | null,
  sourceId: string,
  observedAtMs?: number | null,
): ActiveSession[] {
  if (!dashboard) {
    return [];
  }
  const profileById = new Map(
    dashboard.config.profiles.map((profile) => [profile.id, profile] as const),
  );
  return dashboard.statuses.flatMap((status) => {
    if (!status.running) {
      return [];
    }
    const profile = profileById.get(status.profileId);
    const startedAtMs = status.startedAt
      ? Date.parse(status.startedAt) || null
      : null;
    const events = (status.managed ? dashboard.events : [])
      .filter((event) => {
        if (event.profileId !== status.profileId) {
          return false;
        }
        const eventAtMs = Date.parse(event.startedAt);
        return !startedAtMs || !eventAtMs || eventAtMs >= startedAtMs;
      })
      .sort(
        (left, right) =>
          Date.parse(right.startedAt) - Date.parse(left.startedAt),
      );
    const lastEvent = events[0];
    const external = !status.managed;
    const versionDrift = status.managed && !status.versionCompatible;
    return [{
      id: `proxy:${sourceId}:${status.profileId}`,
      kind: "proxy" as const,
      scope: "shared" as const,
      name: profile?.name || status.profileId,
      statusKey: external
        ? "external"
        : versionDrift
          ? "upgradeRequired"
          : "running",
      statusLabel: external
        ? "外部占用"
        : versionDrift
          ? "需要重启升级"
          : "运行中",
      detail: external
        ? status.owner || "代理端口由外部进程占用"
        : versionDrift
          ? "代理服务版本与当前应用不一致"
          : status.detail,
      proxyProfileId: status.profileId,
      proxySourceId: sourceId,
      endpoint: status.listenUrl,
      port: endpointPort(status.listenUrl),
      pid: status.pid ?? null,
      startedAtMs,
      observedAtMs: observedAtMs ?? null,
      managed: status.managed,
      external,
      canAdopt: false,
      canFocus: false,
      canStop: status.managed,
      canOpenLog: false,
      canOpenDirectory: false,
      canOpenOutput: false,
      proxyActivity: {
        requestCount: events.length,
        errorCount: events.filter(
          (event) => Boolean(event.error) || (event.status ?? 0) >= 400,
        ).length,
        lastRequestAtMs: lastEvent
          ? Date.parse(lastEvent.startedAt) || null
          : null,
        lastRequestMethod: lastEvent?.method ?? null,
        lastRequestPath: lastEvent?.path ?? null,
        lastRequestStatus: lastEvent?.status ?? null,
      },
    }];
  });
}

function browserSessions(
  snapshots: ControlledBrowserSessionSnapshot[],
  observedAtMs?: number | null,
): ActiveSession[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    kind: "browser" as const,
    scope: "shared" as const,
    name: snapshot.browserName || "Chrome",
    statusKey: "connected",
    statusLabel: "CDP 已连接",
    detail: "",
    endpoint: snapshot.endpoint,
    port: snapshot.port,
    observedAtMs: observedAtMs ?? null,
    managed: false,
    external: false,
    canAdopt: false,
    canFocus: false,
    canStop: false,
    canOpenLog: false,
    canOpenDirectory: false,
    canOpenOutput: false,
    browserInfo: snapshot,
  }));
}

function actionSessions(
  snapshots: RunningResourceActionSnapshot[],
  context: ActiveSessionsContext,
): ActiveSession[] {
  const currentWorkspaceKey = context.workspaceKey || "system";
  return snapshots.map((snapshot) => {
    const logLines = snapshot.logTail
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const lastLogLine = logLines[logLines.length - 1];
    return {
      id: `action:${snapshot.operationId}`,
      kind: "action" as const,
      scope: snapshot.workspaceKey === currentWorkspaceKey ? "current" as const : "other" as const,
      name: snapshot.actionName || snapshot.actionKey,
      statusKey: snapshot.cancellationRequested ? "stopping" : "running",
      statusLabel: snapshot.cancellationRequested ? "正在停止" : "运行中",
      detail: snapshot.outputSuppressed
        ? "Action 实时输出已隐藏"
        : lastLogLine || "等待 Action 输出",
      operationId: snapshot.operationId,
      actionPhase: snapshot.phase,
      startedAtMs: snapshot.startedAtMs,
      observedAtMs: context.observedAtMs ?? null,
      managed: true,
      external: false,
      canAdopt: false,
      canFocus: false,
      canStop: !snapshot.cancellationRequested,
      canOpenLog: false,
      canOpenDirectory: false,
      canOpenOutput: false,
    };
  });
}

const SESSION_SCOPE_ORDER: Record<ActiveSessionScope, number> = {
  current: 0,
  other: 1,
  shared: 2,
};

const SESSION_KIND_ORDER: Record<ActiveSessionKind, number> = {
  runtime: 0,
  build: 1,
  action: 2,
  proxy: 3,
  browser: 4,
};

export function activeSessionsFrom(
  runtimeEntries: ProjectRuntimeEntry[],
  proxyDashboard: ProxyDashboard | null,
  proxySourceId: string,
  context: ActiveSessionsContext = {},
): ActiveSession[] {
  return [
    ...runtimeSessions(runtimeEntries, context),
    ...actionSessions(context.actionSessions ?? [], context),
    ...proxySessions(proxyDashboard, proxySourceId, context.observedAtMs),
    ...browserSessions(context.browserSessions ?? [], context.observedAtMs),
  ].sort((left, right) => {
    const scopeOrder =
      SESSION_SCOPE_ORDER[left.scope] - SESSION_SCOPE_ORDER[right.scope];
    if (scopeOrder !== 0) {
      return scopeOrder;
    }
    const kindOrder = SESSION_KIND_ORDER[left.kind] - SESSION_KIND_ORDER[right.kind];
    if (kindOrder !== 0) {
      return kindOrder;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });
}
