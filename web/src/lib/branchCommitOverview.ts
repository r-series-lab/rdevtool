import { invoke } from "@tauri-apps/api/core";
import type { BranchCommitOverview, CommitInfo } from "../app-types";

export type BranchCommitRole = "source" | "target";

const selectedBranchCommitRequests = new Map<string, Promise<CommitInfo | null>>();

export function loadSelectedBranchCommit({
  project,
  branch,
  role,
  revisionHint = "",
}: {
  project: string;
  branch: string;
  role: BranchCommitRole;
  revisionHint?: string;
}): Promise<CommitInfo | null> {
  const normalizedProject = project.trim();
  const normalizedBranch = branch.trim();
  if (!normalizedProject || !normalizedBranch) {
    return Promise.resolve(null);
  }

  const cacheKey = JSON.stringify([
    normalizedProject,
    role,
    normalizedBranch,
    revisionHint,
  ]);
  const cached = selectedBranchCommitRequests.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = invoke<BranchCommitOverview>("get_branch_commit_overview", {
    project: normalizedProject,
    sourceBranch: role === "source" ? normalizedBranch : "",
    targetBranch: role === "target" ? normalizedBranch : "",
  })
    .then((overview) => overview[role] ?? null)
    .catch((error) => {
      selectedBranchCommitRequests.delete(cacheKey);
      throw error;
    });

  selectedBranchCommitRequests.set(cacheKey, request);
  return request;
}
