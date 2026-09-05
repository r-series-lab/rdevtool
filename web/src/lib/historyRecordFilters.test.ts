import { describe, expect, it } from "vitest";
import type { BranchTaskHistoryEntry, BuildHistoryEntry } from "../app-types";
import { groupConsecutiveBy } from "./historyGroups";
import {
  buildHistoryStatus,
  filterHistoryGroups,
  matchesBranchHistoryEntry,
  matchesBuildHistoryEntry,
} from "./historyRecordFilters";

function buildEntry(overrides: Partial<BuildHistoryEntry> = {}): BuildHistoryEntry {
  return {
    historyKey: "build-1",
    projectKey: "portal",
    projectName: "Portal",
    mode: "release",
    env: "production",
    branch: "main",
    stateKey: "success",
    stateLabel: "构建成功",
    detail: "release completed",
    params: { VERSION: "1.2.3" },
    createdAt: "2026-07-31T10:00:00Z",
    updatedAt: "2026-07-31T10:01:00Z",
    ...overrides,
  };
}

function branchEntry(
  overrides: Partial<BranchTaskHistoryEntry> = {},
): BranchTaskHistoryEntry {
  return {
    id: "git-1",
    taskKind: "push",
    success: true,
    summary: "推送完成",
    detail: "origin/main",
    createdAt: "2026-07-31T10:00:00Z",
    items: [
      {
        projectKey: "portal",
        projectName: "Portal",
        sourceBranch: "feature/history-filter",
        targetBranch: "main",
        success: true,
        statusKey: "success",
        statusLabel: "推送成功",
        summary: "push completed",
        detail: "origin/main",
        remote: true,
        commit: {
          shortHash: "abc1234",
          subject: "feat: filter history",
          committedAt: "2026-07-31T09:59:00Z",
        },
      },
    ],
    ...overrides,
  };
}

describe("history record filters", () => {
  it("classifies active, successful, and stopped build records", () => {
    expect(buildHistoryStatus(buildEntry({ stateKey: "queued" }))).toBe("active");
    expect(buildHistoryStatus(buildEntry({ stateKey: "completed" }))).toBe("success");
    expect(buildHistoryStatus(buildEntry({ stateKey: "stopped" }))).toBe("failed");
  });

  it("searches build metadata and parameters", () => {
    const item = buildEntry();
    expect(
      matchesBuildHistoryEntry(
        item,
        { query: "1.2.3", status: "success", mode: "release", markedOnly: false },
        () => false,
      ),
    ).toBe(true);
    expect(
      matchesBuildHistoryEntry(
        item,
        { query: "missing", status: "all", mode: "all", markedOnly: false },
        () => false,
      ),
    ).toBe(false);
  });

  it("searches Git branches and commits and applies marked filtering", () => {
    const item = branchEntry();
    expect(
      matchesBranchHistoryEntry(
        item,
        { query: "abc1234", result: "success", kind: "push", markedOnly: true },
        () => true,
      ),
    ).toBe(true);
    expect(
      matchesBranchHistoryEntry(
        item,
        { query: "main", result: "all", kind: "all", markedOnly: true },
        () => false,
      ),
    ).toBe(false);
  });

  it("keeps original groups while exposing only matching records", () => {
    const latest = buildEntry({ historyKey: "latest", stateKey: "success" });
    const failed = buildEntry({ historyKey: "failed", stateKey: "failed" });
    const groups = groupConsecutiveBy(
      [latest, failed],
      (item) => `${item.projectKey}:${item.mode}`,
      (item) => item.historyKey,
    );
    const filtered = filterHistoryGroups(
      groups,
      (item) => buildHistoryStatus(item) === "failed",
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("latest");
    expect(filtered[0].latest.historyKey).toBe("failed");
    expect(filtered[0].items.map((item) => item.historyKey)).toEqual(["failed"]);
  });

  it("does not change chronological order when records are marked", () => {
    const entries = [
      buildEntry({ historyKey: "latest", mode: "build" }),
      buildEntry({ historyKey: "marked", mode: "release" }),
      buildEntry({ historyKey: "oldest", mode: "deploy" }),
    ];
    const groups = groupConsecutiveBy(
      entries,
      (item) => item.mode,
      (item) => item.historyKey,
    );

    const unfiltered = filterHistoryGroups(groups, () => true);
    const markedOnly = filterHistoryGroups(
      groups,
      (item) => item.historyKey === "marked",
    );

    expect(unfiltered.map((group) => group.latest.historyKey)).toEqual([
      "latest",
      "marked",
      "oldest",
    ]);
    expect(markedOnly.map((group) => group.latest.historyKey)).toEqual(["marked"]);
  });
});
