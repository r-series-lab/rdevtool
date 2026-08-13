import { describe, expect, it } from "vitest";
import type { ActiveSession } from "./activeSessions";
import { diagnoseActiveSessions } from "./activeSessionDiagnostics";

function session(
  id: string,
  patch: Partial<ActiveSession> = {},
): ActiveSession {
  return {
    id,
    kind: "runtime",
    scope: "current",
    name: id,
    statusKey: "running",
    statusLabel: "运行中",
    detail: "",
    endpoint: "http://127.0.0.1:5173",
    port: 5173,
    pid: Number(id.replace(/\D/g, "")) || null,
    managed: true,
    external: false,
    canAdopt: false,
    canFocus: true,
    canStop: true,
    canOpenLog: false,
    canOpenDirectory: false,
    canOpenOutput: false,
    ...patch,
  };
}

describe("active session diagnostics", () => {
  it("flags distinct local listeners that claim the same port", () => {
    const diagnosis = diagnoseActiveSessions([
      session("runtime-1", { name: "Portal" }),
      session("runtime-2", {
        name: "Legacy Portal",
        endpoint: "http://localhost:5173",
      }),
    ]);

    expect(diagnosis.conflictCount).toBe(1);
    expect(diagnosis.bySessionId.get("runtime-1")).toMatchObject({
      kind: "portConflict",
      port: 5173,
      relatedSessionNames: ["Legacy Portal"],
    });
    expect(diagnosis.bySessionId.get("runtime-2")?.relatedSessionNames).toEqual([
      "Portal",
    ]);
  });

  it("treats wildcard listeners as conflicting with the same address family", () => {
    const diagnosis = diagnoseActiveSessions([
      session("runtime-1", { endpoint: "http://0.0.0.0:5173" }),
      session("runtime-2", { endpoint: "http://192.168.1.8:5173" }),
    ]);

    expect(diagnosis.conflictCount).toBe(1);
  });

  it("does not flag remote domains, different ports, or the same PID", () => {
    const diagnosis = diagnoseActiveSessions([
      session("runtime-1", {
        endpoint: "https://example.test",
        port: 443,
        pid: 100,
      }),
      session("runtime-2", {
        endpoint: "https://example.test",
        port: 443,
        pid: 200,
      }),
      session("runtime-3", { port: 5174, pid: 300 }),
      session("runtime-4", { pid: 400 }),
      session("runtime-5", { pid: 400 }),
    ]);

    expect(diagnosis.conflictCount).toBe(0);
  });

  it("surfaces unmanaged and unresolved runtimes without overriding conflicts", () => {
    const diagnosis = diagnoseActiveSessions([
      session("runtime-1", { name: "Managed" }),
      session("runtime-2", {
        name: "External",
        external: true,
        managed: false,
        canAdopt: true,
      }),
      session("runtime-3", { endpoint: null, port: null }),
    ]);

    expect(diagnosis.externalCount).toBe(1);
    expect(diagnosis.unresolvedCount).toBe(1);
    expect(diagnosis.bySessionId.get("runtime-2")?.kind).toBe("portConflict");
    expect(diagnosis.bySessionId.get("runtime-3")?.kind).toBe("portUnavailable");
  });
});
