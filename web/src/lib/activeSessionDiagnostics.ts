import type { ActiveSession } from "./activeSessions";

export type ActiveSessionDiagnosticKind =
  | "portConflict"
  | "externalListener"
  | "portUnavailable";

export type ActiveSessionDiagnosticSeverity = "warning" | "attention" | "info";

export type ActiveSessionDiagnostic = {
  kind: ActiveSessionDiagnosticKind;
  severity: ActiveSessionDiagnosticSeverity;
  sessionId: string;
  port?: number | null;
  relatedSessionIds: string[];
  relatedSessionNames: string[];
};

export type ActiveSessionDiagnosis = {
  bySessionId: ReadonlyMap<string, ActiveSessionDiagnostic>;
  conflictCount: number;
  externalCount: number;
  unresolvedCount: number;
};

type LocalHostIdentity = {
  family: "ipv4" | "ipv6";
  value: string;
  wildcard: boolean;
};

function endpointHostname(endpoint?: string | null) {
  const value = endpoint?.trim();
  if (!value) {
    return "";
  }
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    const match = value.match(/^(?:[a-z][a-z\d+.-]*:\/\/)?(\[[^\]]+\]|[^:/\s]+):\d+/i);
    return match?.[1]?.replace(/^\[|\]$/g, "").toLowerCase() ?? "";
  }
}

function localHostIdentity(endpoint?: string | null): LocalHostIdentity | null {
  const host = endpointHostname(endpoint);
  if (!host) {
    return null;
  }
  if (host === "localhost" || /^127(?:\.\d{1,3}){3}$/.test(host)) {
    return { family: "ipv4", value: "loopback", wildcard: false };
  }
  if (host === "0.0.0.0") {
    return { family: "ipv4", value: "wildcard", wildcard: true };
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return { family: "ipv4", value: host, wildcard: false };
  }
  if (host === "::1") {
    return { family: "ipv6", value: "loopback", wildcard: false };
  }
  if (host === "::") {
    return { family: "ipv6", value: "wildcard", wildcard: true };
  }
  if (host.includes(":")) {
    return { family: "ipv6", value: host, wildcard: false };
  }
  return null;
}

function listenersMayConflict(left: ActiveSession, right: ActiveSession) {
  if (!left.port || left.port !== right.port) {
    return false;
  }
  if (left.pid && right.pid && left.pid === right.pid) {
    return false;
  }
  const leftHost = localHostIdentity(left.endpoint);
  const rightHost = localHostIdentity(right.endpoint);
  if (!leftHost || !rightHost || leftHost.family !== rightHost.family) {
    return false;
  }
  return (
    leftHost.wildcard ||
    rightHost.wildcard ||
    leftHost.value === rightHost.value
  );
}

function conflictDiagnostics(sessions: ActiveSession[]) {
  const peersBySessionId = new Map<string, Set<string>>();
  const conflictPorts = new Set<number>();
  const listenersByPort = new Map<number, ActiveSession[]>();
  for (const session of sessions) {
    if (session.kind === "build" || !session.port) {
      continue;
    }
    const listeners = listenersByPort.get(session.port) ?? [];
    listeners.push(session);
    listenersByPort.set(session.port, listeners);
  }

  for (const [port, listeners] of listenersByPort) {
    for (let leftIndex = 0; leftIndex < listeners.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < listeners.length;
        rightIndex += 1
      ) {
        const left = listeners[leftIndex];
        const right = listeners[rightIndex];
        if (!listenersMayConflict(left, right)) {
          continue;
        }
        conflictPorts.add(port);
        const leftPeers = peersBySessionId.get(left.id) ?? new Set<string>();
        leftPeers.add(right.id);
        peersBySessionId.set(left.id, leftPeers);
        const rightPeers = peersBySessionId.get(right.id) ?? new Set<string>();
        rightPeers.add(left.id);
        peersBySessionId.set(right.id, rightPeers);
      }
    }
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const diagnostics = new Map<string, ActiveSessionDiagnostic>();
  for (const [sessionId, peerIds] of peersBySessionId) {
    const session = sessionById.get(sessionId);
    if (!session) {
      continue;
    }
    const relatedSessions = [...peerIds]
      .map((peerId) => sessionById.get(peerId))
      .filter((peer): peer is ActiveSession => Boolean(peer));
    diagnostics.set(sessionId, {
      kind: "portConflict",
      severity: "warning",
      sessionId,
      port: session.port,
      relatedSessionIds: relatedSessions.map((peer) => peer.id),
      relatedSessionNames: relatedSessions.map((peer) => peer.name),
    });
  }
  return { diagnostics, conflictCount: conflictPorts.size };
}

export function diagnoseActiveSessions(
  sessions: ActiveSession[],
): ActiveSessionDiagnosis {
  const { diagnostics, conflictCount } = conflictDiagnostics(sessions);
  let externalCount = 0;
  let unresolvedCount = 0;

  for (const session of sessions) {
    if (session.external) {
      externalCount += 1;
      if (!diagnostics.has(session.id)) {
        diagnostics.set(session.id, {
          kind: "externalListener",
          severity: "attention",
          sessionId: session.id,
          port: session.port,
          relatedSessionIds: [],
          relatedSessionNames: [],
        });
      }
      continue;
    }
    if (
      session.kind === "runtime" &&
      session.statusKey === "running" &&
      !session.port
    ) {
      unresolvedCount += 1;
      diagnostics.set(session.id, {
        kind: "portUnavailable",
        severity: "info",
        sessionId: session.id,
        port: null,
        relatedSessionIds: [],
        relatedSessionNames: [],
      });
    }
  }

  return {
    bySessionId: diagnostics,
    conflictCount,
    externalCount,
    unresolvedCount,
  };
}
