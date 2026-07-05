import { useMemo, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BranchOption } from "../app-types";

export type ProjectSummary = {
  key: string;
  name: string;
  category: string;
  hasVariant: boolean;
  deployTargets: Array<{
    key: string;
    label: string;
    adapter: string;
    actionKind: string;
    jobName: string;
  }>;
  supportsDeploy: boolean;
  supportsBranch: boolean;
  repoPath?: string | null;
  sourceBranchKeywords: string[];
  targetBranchKeywords: string[];
};

export type BranchCacheEntry = {
  branches: BranchOption[];
  syncedAt: number;
};

export type BranchCacheMap = Record<string, BranchCacheEntry>;

export type ProjectScopedSelection = {
  env?: string;
  branch?: string;
};

export type ProjectSelectionEntry = {
  mode?: "standard" | "variant";
  standard?: ProjectScopedSelection;
  variant?: ProjectScopedSelection;
  mergeSource?: string;
  mergeTarget?: string;
};

export type ProjectSelectionMap = Record<string, ProjectSelectionEntry>;

const LEGACY_BRANCH_CACHE_STORAGE_KEY = "ruritool.branch-cache.v1";
const LEGACY_PROJECT_SELECTION_STORAGE_KEY = "ruritool.project-selection.v1";
export const DEFAULT_SOURCE_BRANCH_KEYWORDS = ["release", "feature"];
export const DEFAULT_TARGET_BRANCH_KEYWORDS = ["variant", "pre", "master", "release"];
const BRANCH_SYNC_TIMEOUT_MS = 12000;

function normalizeBranchOption(value: unknown): BranchOption | null {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name, updatedAt: "", updatedTs: 0 } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    name?: unknown;
    updatedAt?: unknown;
    updatedTs?: unknown;
  };
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt.trim() : "",
    updatedTs:
      typeof candidate.updatedTs === "number" && Number.isFinite(candidate.updatedTs)
        ? candidate.updatedTs
        : 0,
  };
}

export function normalizeBranchOptions(branches: unknown[]): BranchOption[] {
  const seen = new Map<string, BranchOption>();
  for (const raw of branches) {
    const branch = normalizeBranchOption(raw);
    if (!branch) {
      continue;
    }

    const current = seen.get(branch.name);
    if (!current || branch.updatedTs > current.updatedTs) {
      seen.set(branch.name, branch);
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => b.updatedTs - a.updatedTs || a.name.localeCompare(b.name),
  );
}

export function branchOptionNames(branches: BranchOption[]): string[] {
  return branches.map((item) => item.name);
}

export function loadLegacyBranchCache(): BranchCacheMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_BRANCH_CACHE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, { branches?: unknown; syncedAt?: unknown }>;
    const next: BranchCacheMap = {};
    for (const [project, value] of Object.entries(parsed)) {
      if (!value || !Array.isArray(value.branches)) {
        continue;
      }
      const branches = normalizeBranchOptions(value.branches);
      if (branches.length === 0) {
        continue;
      }
      const syncedAt =
        typeof value.syncedAt === "number" && Number.isFinite(value.syncedAt)
          ? value.syncedAt
          : 0;
      next[project] = { branches, syncedAt };
    }
    return next;
  } catch {
    return {};
  }
}

function normalizeScopedSelection(value: unknown): ProjectScopedSelection | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const scoped = value as { env?: unknown; branch?: unknown };
  const env = typeof scoped.env === "string" ? scoped.env.trim() : "";
  const branch = typeof scoped.branch === "string" ? scoped.branch.trim() : "";

  if (!env && !branch) {
    return undefined;
  }

  return {
    env: env || undefined,
    branch: branch || undefined,
  };
}

export function normalizeProjectSelectionEntry(value: unknown): ProjectSelectionEntry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entry = value as {
    mode?: unknown;
    standard?: unknown;
    variant?: unknown;
    mergeSource?: unknown;
    mergeTarget?: unknown;
  };

  const mode =
    entry.mode === "standard" || entry.mode === "variant" ? entry.mode : undefined;
  const standard = normalizeScopedSelection(entry.standard);
  const variant = normalizeScopedSelection(entry.variant);
  const mergeSource = typeof entry.mergeSource === "string" ? entry.mergeSource.trim() : "";
  const mergeTarget = typeof entry.mergeTarget === "string" ? entry.mergeTarget.trim() : "";

  if (!mode && !standard && !variant && !mergeSource && !mergeTarget) {
    return undefined;
  }

  return {
    mode,
    standard,
    variant,
    mergeSource: mergeSource || undefined,
    mergeTarget: mergeTarget || undefined,
  };
}

export function loadLegacyProjectSelections(): ProjectSelectionMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_PROJECT_SELECTION_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: ProjectSelectionMap = {};
    for (const [project, value] of Object.entries(parsed)) {
      const normalized = normalizeProjectSelectionEntry(value);
      if (normalized) {
        next[project] = normalized;
      }
    }
    return next;
  } catch {
    return {};
  }
}

export function formatBranchSyncTime(ts?: number): string {
  if (!ts || ts <= 0) {
    return "未同步";
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "未同步";
  }
}

export function prioritizeBranches(options: string[], keywords: string[]): string[] {
  return options
    .map((name, index) => {
      const normalized = name.trim().toLowerCase();
      const keywordRank = keywords.findIndex((keyword) => normalized.includes(keyword));
      return {
        name,
        index,
        keywordRank: keywordRank === -1 ? keywords.length : keywordRank,
      };
    })
    .sort((a, b) => a.keywordRank - b.keywordRank || a.index - b.index)
    .map((item) => item.name);
}

export function prioritizeBranchOptions(options: BranchOption[], keywords: string[]): BranchOption[] {
  return options
    .map((item, index) => {
      const normalized = item.name.trim().toLowerCase();
      const keywordRank = keywords.findIndex((keyword) => normalized.includes(keyword));
      return {
        item,
        index,
        keywordRank: keywordRank === -1 ? keywords.length : keywordRank,
      };
    })
    .sort(
      (a, b) =>
        a.keywordRank - b.keywordRank ||
        b.item.updatedTs - a.item.updatedTs ||
        a.index - b.index ||
        a.item.name.localeCompare(b.item.name),
    )
    .map((entry) => entry.item);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
}

type UseBranchContextOptions = {
  enabled: boolean;
  selectedProject: string;
  branchCache: BranchCacheMap;
  setBranchCache: Dispatch<SetStateAction<BranchCacheMap>>;
  projectSelections: ProjectSelectionMap;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
};

export function useBranchContext({
  enabled,
  selectedProject,
  branchCache,
  setBranchCache,
  projectSelections,
  setBusy,
  setError,
}: UseBranchContextOptions) {
  const selectedBranchCache = useMemo(
    () => (selectedProject ? branchCache[selectedProject] ?? null : null),
    [branchCache, selectedProject],
  );
  const selectedProjectSelection = useMemo(
    () => (selectedProject ? projectSelections[selectedProject] ?? null : null),
    [projectSelections, selectedProject],
  );
  const branchEntries = useMemo(() => {
    if (!enabled || !selectedProject) {
      return [];
    }
    return normalizeBranchOptions(branchCache[selectedProject]?.branches ?? []);
  }, [branchCache, enabled, selectedProject]);
  const branchOptions = useMemo(() => branchOptionNames(branchEntries), [branchEntries]);

  async function handleSyncBranches(projectKey: string) {
    if (!projectKey || !enabled) {
      return;
    }
    setBusy("正在同步分支");
    setError("");
    try {
      const branches = normalizeBranchOptions(
        await withTimeout(
          invoke<BranchOption[]>("get_project_branches", { project: projectKey }),
          BRANCH_SYNC_TIMEOUT_MS,
          "同步分支超时，请检查 Git 网络后重试",
        ),
      );
      const syncedAt = Date.now();
      setBranchCache((current) => ({
        ...current,
        [projectKey]: {
          branches,
          syncedAt,
        },
      }));

      if (projectKey === selectedProject) {
        // 当前项目的分支选项直接由缓存派生，这里只需要更新缓存即可。
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  return {
    branchEntries,
    branchOptions,
    selectedBranchCache,
    selectedProjectSelection,
    handleSyncBranches,
    branchSyncText: selectedBranchCache
      ? `默认使用上次同步分支（${formatBranchSyncTime(selectedBranchCache.syncedAt)}）`
      : "默认使用本地/默认分支，可点右侧刷新图标拉取远端最新列表",
  };
}
