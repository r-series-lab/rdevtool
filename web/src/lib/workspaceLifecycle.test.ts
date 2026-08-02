import { describe, expect, it } from "vitest";
import type {
  ProjectWorkspaceSummary,
  WorkspaceArchivePlan,
} from "../app-types";
import {
  normalizeWorkspaceArchiveReason,
  unmanagedWorkspaceArchiveBlocker,
  workspaceArchiveDescription,
  workspaceArchiveMeta,
} from "./workspaceLifecycle";

function plan(overrides: Partial<WorkspaceArchivePlan> = {}): WorkspaceArchivePlan {
  return {
    workspaceKey: "feature-a",
    workspaceName: "Feature A",
    alreadyArchived: false,
    active: false,
    canArchive: true,
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

function workspace(
  overrides: Partial<ProjectWorkspaceSummary> = {},
): ProjectWorkspaceSummary {
  return {
    key: "feature-a",
    name: "Feature A",
    description: null,
    active: false,
    system: false,
    archived: true,
    archivedAt: "2026-07-28T08:00:00Z",
    archiveReason: null,
    workspaceType: "business",
    workspaceTypeLabel: "业务",
    projectCount: 1,
    resourceCount: 0,
    includeAllProjects: false,
    includeAllNavigation: false,
    rootDir: null,
    resourceDir: null,
    worklogPath: null,
    worklogExists: false,
    worklogAutoRecord: true,
    workspaceKind: "scope",
    projectScopeLabel: "1 个项目",
    navigationScopeLabel: "未配置入口",
    ...overrides,
  };
}

describe("workspace lifecycle presentation", () => {
  it("describes running items and active workspace fallback", () => {
    const description = workspaceArchiveDescription(
      plan({
        active: true,
        blockers: [
          {
            kind: "runtime",
            id: "demo",
            label: "项目运行：demo",
            managed: true,
            detail: "running",
          },
        ],
      }),
    );

    expect(description).toContain("停止 1 个受管运行项");
    expect(description).toContain("切换到全局");
  });

  it("finds an unmanaged blocker", () => {
    const blocker = unmanagedWorkspaceArchiveBlocker(
      plan({
        blockers: [
          {
            kind: "runtime",
            id: "external",
            label: "外部运行进程",
            managed: false,
            detail: "external",
          },
        ],
      }),
    );

    expect(blocker?.id).toBe("external");
  });

  it("keeps preflight warnings visible in the confirmation", () => {
    expect(
      workspaceArchiveDescription(
        plan({ warnings: ["无法确认代理状态"] }),
      ),
    ).toContain("无法确认代理状态");
  });

  it("keeps archive reason visible when the timestamp is invalid", () => {
    expect(
      workspaceArchiveMeta(
        workspace({ archivedAt: "invalid", archiveReason: "需求已上线" }),
      ),
    ).toBe("已归档 · 需求已上线");
  });

  it("normalizes optional archive reasons", () => {
    expect(normalizeWorkspaceArchiveReason(" 需求已上线 ")).toBe("需求已上线");
    expect(normalizeWorkspaceArchiveReason("   ")).toBeNull();
  });
});
