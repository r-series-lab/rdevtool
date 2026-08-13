import { describe, expect, it, vi } from "vitest";
import type { BranchTaskHistoryEntry, MergeHistoryEntry } from "../app-types";
import {
  branchCacheMatchesRepoPath,
  branchContextStorageKey,
  BranchSyncRequestTracker,
  clearLegacyBranchContextStorage,
  normalizeBranchCacheMap,
  normalizeBranchCatalogResponse,
  scopeLegacyBranchContextMap,
} from "./useBranchContext";
import {
  branchTaskHistoryFromCliMergeHistory,
  branchHistoryMatchesWorkspace,
  branchWorkflowProjectReset,
  branchWorkflowReferenceProject,
  mergeBranchTaskHistory,
} from "./useBranchWorkflowModule";
import {
  branchSyncPlanCounts,
  hasExplicitBranchValues,
} from "../pages/MergePage";

function branchHistory(workspaceKey?: string): BranchTaskHistoryEntry {
  return {
    id: `history-${workspaceKey ?? "legacy"}`,
    workspaceKey,
    createdAt: "2026-07-16T00:00:00.000Z",
    taskKind: "switch",
    success: true,
    summary: "切换成功",
    detail: "ok",
    items: [
      {
        projectKey: "demo",
        projectName: "Demo",
        sourceBranch: "main",
        targetBranch: "feature/demo",
        success: true,
        statusKey: "success",
        statusLabel: "成功",
        summary: "切换成功",
        detail: "ok",
        remote: false,
      },
    ],
  };
}

function cliMergeHistory(
  historyKey: string,
  overrides: Partial<MergeHistoryEntry> = {},
): MergeHistoryEntry {
  return {
    historyKey,
    workspaceKey: "feature",
    projectInstancePath: "/worktrees/demo",
    projectKey: "demo",
    projectName: "Demo",
    sourceBranch: "feature/demo",
    targetBranch: "main",
    success: true,
    remote: true,
    summary: "合并成功",
    detail: "merged",
    mergedCommit: null,
    sourceCommit: null,
    targetCommit: {
      shortHash: "abc1234",
      subject: "Merge feature/demo",
      committedAt: "2026-07-20 08:00:00",
    },
    createdAt: "2026-07-20 08:00:00",
    ...overrides,
  };
}

describe("Git branch workflow defaults", () => {
  it("clears every branch field when the project changes", () => {
    expect(branchWorkflowProjectReset("demo")).toEqual({
      syncProjects: ["demo"],
      syncSource: "",
      syncTargets: [],
      createProjects: ["demo"],
      createSource: "",
      createTarget: "",
      checkoutSource: "",
      checkoutDestinationDir: "",
      switchTarget: "",
    });
  });

  it("keeps source and target selections blank when the project is cleared", () => {
    expect(branchWorkflowProjectReset("")).toEqual({
      syncProjects: [],
      syncSource: "",
      syncTargets: [],
      createProjects: [],
      createSource: "",
      createTarget: "",
      checkoutSource: "",
      checkoutDestinationDir: "",
      switchTarget: "",
    });
  });

  it("requires explicit source and target selections", () => {
    expect(
      hasExplicitBranchValues({ requireSource: true, requireTargets: true }),
    ).toBe(false);
    expect(
      hasExplicitBranchValues({
        sourceBranch: "release-1",
        targetBranches: ["pre"],
        requireSource: true,
        requireTargets: true,
      }),
    ).toBe(true);
    expect(
      hasExplicitBranchValues({ targetBranch: " ", requireTarget: true }),
    ).toBe(false);
  });

  it("uses the only selected merge project as the branch reference", () => {
    expect(
      branchWorkflowReferenceProject("sync", "alpha", ["beta"], ["gamma"]),
    ).toBe("beta");
  });

  it("uses the first selected project for batch merge and branch creation", () => {
    expect(
      branchWorkflowReferenceProject(
        "sync",
        "alpha",
        ["beta", "gamma"],
        ["delta", "epsilon"],
      ),
    ).toBe("beta");
    expect(
      branchWorkflowReferenceProject(
        "create",
        "alpha",
        ["beta", "gamma"],
        ["delta", "epsilon"],
      ),
    ).toBe("delta");
  });

  it("falls back to the current project outside batch project selection", () => {
    expect(branchWorkflowReferenceProject("sync", "alpha", [], [])).toBe(
      "alpha",
    );
    expect(
      branchWorkflowReferenceProject("switch", "alpha", ["beta"], ["gamma"]),
    ).toBe("alpha");
  });
});

describe("Git merge preflight", () => {
  it("counts ready, skipped, and failed items independently", () => {
    expect(
      branchSyncPlanCounts({
        taskKind: "sync",
        success: false,
        summary: "成功 2 / 失败 1",
        detail: "",
        items: [
          {
            projectKey: "alpha",
            projectName: "Alpha",
            sourceBranch: "feature/a",
            targetBranch: "main",
            success: true,
            statusKey: "ready",
            statusLabel: "可合并",
            summary: "检查通过",
            detail: "",
            remote: false,
          },
          {
            projectKey: "beta",
            projectName: "Beta",
            sourceBranch: "main",
            targetBranch: "main",
            success: true,
            statusKey: "same_branch",
            statusLabel: "跳过",
            summary: "同名分支",
            detail: "",
            remote: false,
          },
          {
            projectKey: "gamma",
            projectName: "Gamma",
            sourceBranch: "feature/a",
            targetBranch: "main",
            success: false,
            statusKey: "source_missing",
            statusLabel: "失败",
            summary: "源分支不存在",
            detail: "",
            remote: false,
          },
        ],
      }),
    ).toEqual({ ready: 1, skipped: 1, failed: 1 });
  });
});

describe("Git branch workspace history", () => {
  const projects = new Set(["demo"]);

  it("shows only records owned by the active non-system workspace", () => {
    expect(
      branchHistoryMatchesWorkspace(
        branchHistory("feature"),
        "feature",
        projects,
      ),
    ).toBe(true);
    expect(
      branchHistoryMatchesWorkspace(
        branchHistory("release"),
        "feature",
        projects,
      ),
    ).toBe(false);
    expect(
      branchHistoryMatchesWorkspace(branchHistory(), "feature", projects),
    ).toBe(false);
  });

  it("keeps all scoped and legacy records visible in the system workspace", () => {
    expect(
      branchHistoryMatchesWorkspace(
        branchHistory("feature"),
        "system",
        projects,
      ),
    ).toBe(true);
    expect(
      branchHistoryMatchesWorkspace(branchHistory(), "system", projects),
    ).toBe(true);
  });
});

describe("Git CLI merge history", () => {
  it("groups CLI merge rows into a branch task batch and ignores other history", () => {
    const history = branchTaskHistoryFromCliMergeHistory([
      cliMergeHistory("branch-sync-cli-batch-a-1", {
        projectKey: "beta",
        projectName: "Beta",
        success: false,
        summary: "合并失败",
        detail: "HTTP 401 Unauthorized",
        targetCommit: null,
      }),
      cliMergeHistory("branch-sync-app-batch-a-0"),
      cliMergeHistory("branch-sync-cli-batch-a-0", {
        projectKey: "alpha",
        projectName: "Alpha",
      }),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: "branch-sync-cli-batch-a",
      taskKind: "sync",
      success: false,
      summary: "成功 1 / 失败 1",
      workspaceKey: "feature",
      replay: {
        command: "execute_branch_sync_task",
        busyText: "正在重播合并分支",
        request: {
          project: "beta",
          projects: ["beta"],
          sourceBranch: "feature/demo",
          targetBranches: ["main"],
        },
      },
      createdAt: "2026-07-20T08:00:00.000Z",
    });
    expect(history[0].items.map((item) => item.projectKey)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(history[0].items[0].commit?.shortHash).toBe("abc1234");
    expect(history[0].items[1]).toMatchObject({
      statusKey: "merge_failed",
      statusLabel: "失败",
      commit: null,
    });
    expect(history[0].detail).toContain("Beta: feature/demo -> main [失败]");
    expect(history[0].detail).toContain("HTTP 401 Unauthorized");
  });

  it("keeps local App batches while deduplicating loaded CLI batches", () => {
    const local = branchHistory("feature");
    const cli = branchTaskHistoryFromCliMergeHistory([
      cliMergeHistory("branch-sync-cli-batch-a-0"),
    ])[0];

    expect(mergeBranchTaskHistory([local], [cli], [cli])).toEqual([cli, local]);
  });
});

describe("Git branch automatic refresh", () => {
  it("scopes cached branches and selections by workspace and project", () => {
    expect(branchContextStorageKey("feature-a", "demo")).toBe(
      "workspace:feature-a:project:demo",
    );
    expect(branchContextStorageKey("feature-b", "demo")).not.toBe(
      branchContextStorageKey("feature-a", "demo"),
    );
  });

  it("migrates legacy project keys without replacing existing scoped values", () => {
    const activeKey = branchContextStorageKey("feature-a", "demo");
    const otherKey = branchContextStorageKey("feature-b", "demo");

    expect(
      scopeLegacyBranchContextMap(
        {
          demo: "legacy",
          [activeKey]: "active",
          [otherKey]: "other",
        },
        "feature-a",
      ),
    ).toEqual({
      [activeKey]: "active",
      [otherKey]: "other",
    });
  });

  it("moves a legacy project key into the active workspace scope", () => {
    expect(
      scopeLegacyBranchContextMap({ demo: "legacy" }, "feature-a"),
    ).toEqual({
      [branchContextStorageKey("feature-a", "demo")]: "legacy",
    });
  });

  it("preserves branch observation metadata when hydrating the SQLite cache", () => {
    expect(
      normalizeBranchCacheMap({
        demo: {
          branches: [
            {
              name: " main ",
              updatedAt: "now",
              updatedTs: 12,
              commit: {
                shortHash: " abc1234 ",
                subject: " fix: visible revision ",
                committedAt: " 2026-08-10 11:42:06 +0800 ",
              },
            },
          ],
          syncedAt: 42,
          source: " localRepository ",
          freshness: " cached ",
          elapsedMs: 125,
          repoPath: " /tmp/demo ",
        },
      }),
    ).toEqual({
      demo: {
        branches: [
          {
            name: "main",
            updatedAt: "now",
            updatedTs: 12,
            commit: {
              shortHash: "abc1234",
              subject: "fix: visible revision",
              committedAt: "2026-08-10 11:42:06 +0800",
            },
          },
        ],
        syncedAt: 42,
        source: "localRepository",
        freshness: "cached",
        elapsedMs: 125,
        repoPath: "/tmp/demo",
      },
    });
  });

  it("does not reuse a branch cache after the workspace project path changes", () => {
    const cached = normalizeBranchCacheMap({
      demo: {
        branches: ["main"],
        syncedAt: 42,
        repoPath: "/worktrees/feature-a/demo",
      },
    }).demo;

    expect(branchCacheMatchesRepoPath(cached, "/worktrees/feature-a/demo")).toBe(true);
    expect(branchCacheMatchesRepoPath(cached, "/worktrees/feature-b/demo")).toBe(false);
  });

  it("does not show a legacy cache with unknown path for a bound repository", () => {
    const cached = normalizeBranchCacheMap({
      demo: {
        branches: ["main"],
        syncedAt: 42,
      },
    }).demo;

    expect(branchCacheMatchesRepoPath(cached, "/worktrees/feature-a/demo")).toBe(false);
    expect(branchCacheMatchesRepoPath(cached, null)).toBe(true);
  });

  it("clears obsolete browser cache keys after SQLite migration", () => {
    const removeItem = vi.fn();

    clearLegacyBranchContextStorage({ removeItem });

    expect(removeItem).toHaveBeenCalledWith("ruritool.branch-cache.v1");
    expect(removeItem).toHaveBeenCalledWith("ruritool.project-selection.v1");
  });

  it("keeps compatibility with the legacy branch-array response", () => {
    const response = normalizeBranchCatalogResponse(
      [{ name: "main", updatedAt: "", updatedTs: 0 }],
      "demo",
    );

    expect(response.status.success).toBe(true);
    expect(response.observed).toMatchObject({
      source: "legacy",
      freshness: "unknown",
      branchCount: 1,
    });
    expect(response.branches.map((branch) => branch.name)).toEqual(["main"]);
  });

  it("normalizes branches while preserving sync evidence", () => {
    const response = normalizeBranchCatalogResponse(
      {
        requested: { project: "demo" },
        effective: {
          repoPath: "/tmp/demo",
          strategy: ["localRepository", "gitlabApi", "gitRemote"],
          localFetchTimeoutMs: 8000,
          gitlabTimeoutMs: 12000,
          remoteTimeoutMs: 8000,
        },
        observed: {
          source: "localRepository",
          freshness: "cached",
          branchCount: 2,
          elapsedMs: 100,
          attempts: [],
        },
        status: {
          key: "degraded",
          label: "可用（已降级）",
          success: true,
          terminal: true,
          detail: "using cache",
        },
        evidence: [],
        risks: [],
        recommendedActions: [],
        branches: [
          { name: "main", updatedAt: "", updatedTs: 1 },
          { name: "main", updatedAt: "", updatedTs: 2 },
        ],
      },
      "demo",
    );

    expect(response.observed.freshness).toBe("cached");
    expect(response.branches).toEqual([
      { name: "main", updatedAt: "", updatedTs: 2 },
    ]);
  });

  it("prefers commit metadata when duplicate branch observations are equally fresh", () => {
    expect(
      normalizeBranchCatalogResponse(
        [
          { name: "main", updatedAt: "now", updatedTs: 2 },
          {
            name: "main",
            updatedAt: "now",
            updatedTs: 2,
            commit: {
              shortHash: "abc1234",
              subject: "latest subject",
              committedAt: "2026-08-10 11:42:06 +0800",
            },
          },
        ],
        "demo",
      ).branches,
    ).toEqual([
      {
        name: "main",
        updatedAt: "now",
        updatedTs: 2,
        commit: {
          shortHash: "abc1234",
          subject: "latest subject",
          committedAt: "2026-08-10 11:42:06 +0800",
        },
      },
    ]);
  });

  it("deduplicates concurrent refreshes for the same project", async () => {
    const tracker = new BranchSyncRequestTracker();
    let resolveRequest: (() => void) | undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const first = tracker.run("demo", task);
    const second = tracker.run("demo", task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    resolveRequest?.();
    await Promise.all([first, second]);

    const nextTask = vi.fn(async () => undefined);
    await tracker.run("demo", nextTask);
    expect(nextTask).toHaveBeenCalledTimes(1);
  });

  it("refreshes different projects concurrently", async () => {
    const tracker = new BranchSyncRequestTracker();
    let resolveAlpha: (() => void) | undefined;
    let resolveBeta: (() => void) | undefined;
    const alphaTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAlpha = resolve;
        }),
    );
    const betaTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveBeta = resolve;
        }),
    );

    const alphaRefresh = tracker.run("alpha", alphaTask);
    const betaRefresh = tracker.run("beta", betaTask);

    expect(alphaTask).toHaveBeenCalledTimes(1);
    expect(betaTask).toHaveBeenCalledTimes(1);
    resolveAlpha?.();
    resolveBeta?.();
    await Promise.all([alphaRefresh, betaRefresh]);
  });

  it("allows a retry after a refresh is rejected", async () => {
    const tracker = new BranchSyncRequestTracker();
    const task = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce(undefined);

    await expect(tracker.run("demo", task)).rejects.toThrow("refresh failed");
    await expect(tracker.run("demo", task)).resolves.toBeUndefined();

    expect(task).toHaveBeenCalledTimes(2);
  });
});
