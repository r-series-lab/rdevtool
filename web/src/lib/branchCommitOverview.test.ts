import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSelectedBranchCommit } from "./branchCommitOverview";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("loadSelectedBranchCommit", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads the selected source branch commit without querying a target", async () => {
    const commit = {
      shortHash: "a98bb99fac",
      subject: "fix: keep branch details visible",
      committedAt: "2026-08-07 15:48:29 +08:00",
    };
    invokeMock.mockResolvedValueOnce({ source: commit, target: null });

    await expect(
      loadSelectedBranchCommit({
        project: "demo-console",
        branch: "feature/demo",
        role: "source",
        revisionHint: "source-1",
      }),
    ).resolves.toEqual(commit);
    expect(invokeMock).toHaveBeenCalledWith("get_branch_commit_overview", {
      project: "demo-console",
      sourceBranch: "feature/demo",
      targetBranch: "",
    });
  });

  it("deduplicates requests for the same selected target revision", async () => {
    const commit = {
      shortHash: "2e76c2f",
      subject: "fix: align revision summaries",
      committedAt: "2026-07-29 17:50:48 +0800",
    };
    invokeMock.mockResolvedValueOnce({ source: null, target: commit });
    const request = {
      project: "demo-console",
      branch: "env-pre",
      role: "target" as const,
      revisionHint: "target-1",
    };

    const [first, second] = await Promise.all([
      loadSelectedBranchCommit(request),
      loadSelectedBranchCommit(request),
    ]);

    expect(first).toEqual(commit);
    expect(second).toEqual(commit);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_branch_commit_overview", {
      project: "demo-console",
      sourceBranch: "",
      targetBranch: "env-pre",
    });
  });
});
