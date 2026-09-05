import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BranchCatalogResponse,
  BranchOption,
  CommitInfo,
} from "../app-types";
import { useI18n, type Translate } from "../i18n";

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
  source?: string;
  freshness?: string;
  elapsedMs?: number;
  repoPath?: string | null;
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
const BRANCH_CONTEXT_STORAGE_KEY_PREFIX = "workspace:";
const BRANCH_CONTEXT_PROJECT_SEPARATOR = ":project:";
export const DEFAULT_SOURCE_BRANCH_KEYWORDS = ["release", "feature"];
export const DEFAULT_TARGET_BRANCH_KEYWORDS = [
  "variant",
  "pre",
  "master",
  "release",
];
const BRANCH_SYNC_TIMEOUT_MS = 30000;

export class BranchSyncRequestTracker {
  private readonly inFlight = new Map<string, Promise<void>>();

  run(requestKey: string, task: () => Promise<void>): Promise<void> {
    const current = this.inFlight.get(requestKey);
    if (current) {
      return current;
    }

    let request: Promise<void>;
    request = task().finally(() => {
      if (this.inFlight.get(requestKey) === request) {
        this.inFlight.delete(requestKey);
      }
    });
    this.inFlight.set(requestKey, request);
    return request;
  }
}

function normalizeCommitInfo(value: unknown): CommitInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as {
    shortHash?: unknown;
    subject?: unknown;
    committedAt?: unknown;
  };
  const shortHash =
    typeof candidate.shortHash === "string" ? candidate.shortHash.trim() : "";
  if (!shortHash) {
    return null;
  }
  return {
    shortHash,
    subject: typeof candidate.subject === "string" ? candidate.subject.trim() : "",
    committedAt:
      typeof candidate.committedAt === "string"
        ? candidate.committedAt.trim()
        : "",
  };
}

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
    commit?: unknown;
  };
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) {
    return null;
  }

  const commit = normalizeCommitInfo(candidate.commit);
  return {
    name,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt.trim() : "",
    updatedTs:
      typeof candidate.updatedTs === "number" &&
      Number.isFinite(candidate.updatedTs)
        ? candidate.updatedTs
        : 0,
    ...(commit ? { commit } : {}),
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
    if (
      !current ||
      branch.updatedTs > current.updatedTs ||
      (branch.updatedTs === current.updatedTs && !current.commit && branch.commit)
    ) {
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

export function branchContextStorageKey(
  workspaceKey?: string | null,
  projectKey?: string | null,
): string {
  const workspace = workspaceKey?.trim() || "system";
  const project = projectKey?.trim() || "unknown";
  return (
    `${BRANCH_CONTEXT_STORAGE_KEY_PREFIX}${encodeURIComponent(workspace)}` +
    `${BRANCH_CONTEXT_PROJECT_SEPARATOR}${encodeURIComponent(project)}`
  );
}

export function isBranchContextStorageKey(key: string): boolean {
  return (
    key.startsWith(BRANCH_CONTEXT_STORAGE_KEY_PREFIX) &&
    key.includes(BRANCH_CONTEXT_PROJECT_SEPARATOR)
  );
}

export function scopeLegacyBranchContextMap<T>(
  entries: Record<string, T>,
  activeWorkspaceKey?: string | null,
): Record<string, T> {
  const scoped: Record<string, T> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (isBranchContextStorageKey(key)) {
      scoped[key] = value;
    }
  }
  for (const [key, value] of Object.entries(entries)) {
    if (isBranchContextStorageKey(key)) {
      continue;
    }
    const scopedKey = branchContextStorageKey(activeWorkspaceKey, key);
    if (!(scopedKey in scoped)) {
      scoped[scopedKey] = value;
    }
  }
  return scoped;
}

export function normalizeBranchCatalogResponse(
  value: BranchCatalogResponse | BranchOption[],
  project: string,
): BranchCatalogResponse {
  if (Array.isArray(value)) {
    const branches = normalizeBranchOptions(value);
    return {
      requested: { project },
      effective: {
        repoPath: null,
        strategy: ["legacy"],
        localFetchTimeoutMs: 0,
        gitlabTimeoutMs: 0,
        remoteTimeoutMs: 0,
      },
      observed: {
        source: "legacy",
        freshness: "unknown",
        branchCount: branches.length,
        elapsedMs: 0,
        attempts: [],
      },
      status: {
        key: "ready",
        label: "同步完成",
        success: true,
        terminal: true,
        detail: `已获取 ${branches.length} 个分支。`,
      },
      evidence: [],
      risks: [],
      recommendedActions: [],
      branches,
    };
  }

  return {
    ...value,
    branches: normalizeBranchOptions(value.branches ?? []),
  };
}

export function normalizeBranchCacheMap(value: unknown): BranchCacheMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: BranchCacheMap = {};
  for (const [project, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const entry = raw as {
      branches?: unknown;
      syncedAt?: unknown;
      source?: unknown;
      freshness?: unknown;
      elapsedMs?: unknown;
      repoPath?: unknown;
    };
    if (!Array.isArray(entry.branches)) {
      continue;
    }
    const branches = normalizeBranchOptions(entry.branches);
    if (branches.length === 0) {
      continue;
    }
    next[project] = {
      branches,
      syncedAt:
        typeof entry.syncedAt === "number" && Number.isFinite(entry.syncedAt)
          ? entry.syncedAt
          : 0,
      source:
        typeof entry.source === "string"
          ? entry.source.trim() || undefined
          : undefined,
      freshness:
        typeof entry.freshness === "string"
          ? entry.freshness.trim() || undefined
          : undefined,
      elapsedMs:
        typeof entry.elapsedMs === "number" && Number.isFinite(entry.elapsedMs)
          ? entry.elapsedMs
          : undefined,
      repoPath:
        entry.repoPath === null
          ? null
          : typeof entry.repoPath === "string"
            ? entry.repoPath.trim() || null
            : undefined,
    };
  }
  return next;
}

export function branchCacheMatchesRepoPath(
  entry: BranchCacheEntry,
  repoPath?: string | null,
): boolean {
  if (entry.repoPath === undefined) {
    return !(repoPath?.trim());
  }
  return (entry.repoPath?.trim() || null) === (repoPath?.trim() || null);
}

function branchSourceLabel(
  source: string | undefined,
  freshness: string | undefined,
  t: Translate,
): string {
  if (source === "localRepository") {
    return freshness === "cached"
      ? t("本地引用（远端刷新失败）")
      : t("本地仓库");
  }
  if (source === "gitlabApi") {
    return "GitLab API";
  }
  if (source === "gitRemote") {
    return "Git remote";
  }
  return t("兼容模式");
}

function formatBranchSyncDuration(elapsedMs?: number): string {
  if (typeof elapsedMs !== "number" || elapsedMs <= 0) {
    return "";
  }
  return ` · ${(elapsedMs / 1000).toFixed(elapsedMs < 1000 ? 2 : 1)}s`;
}

export function formatBranchSyncSummary(
  cache: BranchCacheEntry,
  t: Translate,
) {
  const summary = t("最近同步于 {time} · {source} · {count} 个分支", {
    time: formatBranchSyncTime(cache.syncedAt),
    source: branchSourceLabel(cache.source, cache.freshness, t),
    count: cache.branches.length,
  });
  return `${summary}${formatBranchSyncDuration(cache.elapsedMs)}${t(
    "；进入 Git 或切换项目会自动刷新",
  )}`;
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
    return normalizeBranchCacheMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

type LegacyBranchContextStorage = {
  removeItem: (key: string) => void;
};

export function clearLegacyBranchContextStorage(
  storage?: LegacyBranchContextStorage,
): void {
  if (typeof window === "undefined" && !storage) {
    return;
  }
  try {
    const target = storage ?? window.localStorage;
    target.removeItem(LEGACY_BRANCH_CACHE_STORAGE_KEY);
    target.removeItem(LEGACY_PROJECT_SELECTION_STORAGE_KEY);
  } catch {
    // SQLite remains authoritative when browser storage is unavailable.
  }
}

function normalizeScopedSelection(
  value: unknown,
): ProjectScopedSelection | undefined {
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

export function normalizeProjectSelectionEntry(
  value: unknown,
): ProjectSelectionEntry | undefined {
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
    entry.mode === "standard" || entry.mode === "variant"
      ? entry.mode
      : undefined;
  const standard = normalizeScopedSelection(entry.standard);
  const variant = normalizeScopedSelection(entry.variant);
  const mergeSource =
    typeof entry.mergeSource === "string" ? entry.mergeSource.trim() : "";
  const mergeTarget =
    typeof entry.mergeTarget === "string" ? entry.mergeTarget.trim() : "";

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
    const raw = window.localStorage.getItem(
      LEGACY_PROJECT_SELECTION_STORAGE_KEY,
    );
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

export function prioritizeBranches(
  options: string[],
  keywords: string[],
): string[] {
  return options
    .map((name, index) => {
      const normalized = name.trim().toLowerCase();
      const keywordRank = keywords.findIndex((keyword) =>
        normalized.includes(keyword),
      );
      return {
        name,
        index,
        keywordRank: keywordRank === -1 ? keywords.length : keywordRank,
      };
    })
    .sort((a, b) => a.keywordRank - b.keywordRank || a.index - b.index)
    .map((item) => item.name);
}

export function prioritizeBranchOptions(
  options: BranchOption[],
  keywords: string[],
): BranchOption[] {
  return options
    .map((item, index) => {
      const normalized = item.name.trim().toLowerCase();
      const keywordRank = keywords.findIndex((keyword) =>
        normalized.includes(keyword),
      );
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
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(message)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }
}

type UseBranchContextOptions = {
  enabled: boolean;
  workspaceKey: string;
  selectedProject: string;
  repoPath?: string | null;
  branchCache: BranchCacheMap;
  setBranchCache: Dispatch<SetStateAction<BranchCacheMap>>;
  projectSelections: ProjectSelectionMap;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
};

export function useBranchContext({
  enabled,
  workspaceKey,
  selectedProject,
  repoPath,
  branchCache,
  setBranchCache,
  projectSelections,
  setBusy,
  setError,
}: UseBranchContextOptions) {
  const { t } = useI18n();
  const selectionStorageKey = useMemo(
    () => branchContextStorageKey(workspaceKey, selectedProject),
    [selectedProject, workspaceKey],
  );
  const selectedBranchCache = useMemo(
    () => {
      const cached = selectedProject
        ? branchCache[selectionStorageKey]
        : undefined;
      return cached && branchCacheMatchesRepoPath(cached, repoPath)
        ? cached
        : null;
    },
    [branchCache, repoPath, selectedProject, selectionStorageKey],
  );
  const selectedProjectSelection = useMemo(
    () =>
      selectedProject ? (projectSelections[selectionStorageKey] ?? null) : null,
    [projectSelections, selectedProject, selectionStorageKey],
  );
  const branchEntries = useMemo(() => {
    if (!enabled || !selectedProject) {
      return [];
    }
    return normalizeBranchOptions(selectedBranchCache?.branches ?? []);
  }, [enabled, selectedBranchCache, selectedProject]);
  const branchOptions = useMemo(
    () => branchOptionNames(branchEntries),
    [branchEntries],
  );
  const selectedProjectRef = useRef(selectedProject);
  const workspaceKeyRef = useRef(workspaceKey);
  const repoPathRef = useRef(repoPath?.trim() || null);
  const syncTrackerRef = useRef(new BranchSyncRequestTracker());
  const activeSyncProjectsRef = useRef(new Set<string>());

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    workspaceKeyRef.current = workspaceKey;
    repoPathRef.current = repoPath?.trim() || null;
  }, [repoPath, selectedProject, workspaceKey]);

  const syncBranches = useCallback(
    async (projectKey: string) => {
      if (!projectKey || !enabled) {
        return;
      }

      const requestWorkspaceKey = workspaceKey.trim() || "system";
      const requestStorageKey = branchContextStorageKey(
        requestWorkspaceKey,
        projectKey,
      );
      const requestRepoPath = repoPath?.trim() || null;
      const requestSyncKey = `${requestStorageKey}\u0000${requestRepoPath ?? ""}`;
      await syncTrackerRef.current.run(requestSyncKey, async () => {
        activeSyncProjectsRef.current.add(requestSyncKey);
        setBusy("正在同步分支");
        if (
          projectKey === selectedProjectRef.current &&
          requestWorkspaceKey ===
            (workspaceKeyRef.current.trim() || "system") &&
          requestRepoPath === repoPathRef.current
        ) {
          setError("");
        }
        try {
          const catalog = normalizeBranchCatalogResponse(
            await withTimeout(
              invoke<BranchCatalogResponse | BranchOption[]>(
                "get_project_branches",
                {
                  project: projectKey,
                  workspaceKey: requestWorkspaceKey,
                },
              ),
              BRANCH_SYNC_TIMEOUT_MS,
              "分支同步超过 30 秒，rDevTool 后端未在约定时间内返回；已有缓存不会被覆盖",
            ),
            projectKey,
          );
          if (!catalog.status.success) {
            throw new Error(catalog.status.detail || "分支同步失败");
          }
          const branches = catalog.branches;
          const syncedAt = Date.now();
          setBranchCache((current) => {
            if (
              requestStorageKey ===
                branchContextStorageKey(
                  workspaceKeyRef.current,
                  selectedProjectRef.current,
                ) &&
              requestRepoPath !== repoPathRef.current
            ) {
              return current;
            }
            const next = {
              ...current,
              [requestStorageKey]: {
                branches,
                syncedAt,
                source: catalog.observed.source,
                freshness: catalog.observed.freshness,
                elapsedMs: catalog.observed.elapsedMs,
                repoPath: catalog.effective.repoPath,
              },
            };
            return next;
          });
        } catch (reason) {
          if (
            projectKey === selectedProjectRef.current &&
            requestWorkspaceKey ===
              (workspaceKeyRef.current.trim() || "system") &&
            requestRepoPath === repoPathRef.current
          ) {
            setError(String(reason));
          }
        } finally {
          activeSyncProjectsRef.current.delete(requestSyncKey);
          if (activeSyncProjectsRef.current.size === 0) {
            setBusy("");
          }
        }
      });
    },
    [enabled, repoPath, setBranchCache, setBusy, setError, workspaceKey],
  );

  const handleSyncBranches = useCallback(
    (projectKey = selectedProject) => syncBranches(projectKey),
    [selectedProject, syncBranches],
  );

  useEffect(() => {
    if (!enabled || !selectedProject) {
      return;
    }
    void syncBranches(selectedProject);
  }, [enabled, selectedProject, syncBranches]);

  return {
    branchEntries,
    branchOptions,
    selectionStorageKey,
    selectedBranchCache,
    selectedProjectSelection,
    handleSyncBranches,
    branchSyncText: selectedBranchCache
      ? formatBranchSyncSummary(selectedBranchCache, t)
      : t("进入 Git 或切换项目时会自动拉取远程分支，也可点右侧刷新图标重试"),
  };
}
