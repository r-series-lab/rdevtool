import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectRuntimeEntry, ProjectWorkflowAction } from "../app-types";
import type {
  ActivityResource,
  ActivityRecorder,
  ActivityStatus,
  ActivityUpdater,
} from "../lib/activityCenter";
import { getStoredJson, setStoredJson } from "../lib/storage";
import {
  createProjectWorkflowSignals,
  type WorkflowBroadcastRule,
  type WorkflowProjectReplay,
  type WorkflowSignal,
} from "../lib/workflowSignals";

type UseProjectsModuleOptions = {
  enabled: boolean;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  workflowBroadcastRules: WorkflowBroadcastRule[];
  emitWorkflowSignals: (signals: WorkflowSignal[]) => Promise<void>;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
};

type FinderType = "项目" | "网站" | "应用" | "脚本";
type FinderQuickFilter = "全部" | "收藏" | "最近";

type NavigationEntry = {
  name: string;
  kind: string;
  targetLabel: string;
  url?: string | null;
  bundleId?: string | null;
  appName?: string | null;
  script?: string | null;
  cwd?: string | null;
  note?: string | null;
};

type NavigationCategory = {
  title: string;
  shortLabel: string;
  entries: NavigationEntry[];
};

type NavigationData = {
  filePath: string;
  preferredCategory?: string | null;
  categories: NavigationCategory[];
};

export type FinderShortcutItem = {
  categoryTitle: string;
  categoryLabel: string;
  entry: NavigationEntry;
};

const FINDER_TYPE_OPTIONS = ["项目", "网站", "应用", "脚本"] as const;
const FINDER_QUICK_FILTER_OPTIONS = ["全部", "收藏", "最近"] as const;
const FINDER_STORAGE_NAMESPACE = "projects";
const FINDER_PREFERENCES_STORAGE_KEY = "finder-preferences";
const FINDER_DATA_CACHE_TTL_MS = 15_000;
const RUNTIME_POLL_VISIBLE_INTERVAL_MS = 2_200;
const RUNTIME_POLL_HIDDEN_INTERVAL_MS = 15_000;
const MAX_RECENT_FINDER_ITEMS = 12;

type FinderPreferences = {
  favoriteProjectKeys: string[];
  recentProjectKeys: string[];
  favoriteShortcutKeys: string[];
  recentShortcutKeys: string[];
  lastFinderType?: FinderType;
  lastFinderCategory?: string;
  lastFinderQuickFilter?: FinderQuickFilter;
};

type LoadFinderDataOptions = {
  force?: boolean;
};

const EMPTY_FINDER_PREFERENCES: FinderPreferences = {
  favoriteProjectKeys: [],
  recentProjectKeys: [],
  favoriteShortcutKeys: [],
  recentShortcutKeys: [],
};

function normalizeFinderType(value: unknown): FinderType | undefined {
  return FINDER_TYPE_OPTIONS.includes(value as FinderType)
    ? (value as FinderType)
    : undefined;
}

function normalizeFinderQuickFilter(
  value: unknown,
): FinderQuickFilter | undefined {
  return FINDER_QUICK_FILTER_OPTIONS.includes(value as FinderQuickFilter)
    ? (value as FinderQuickFilter)
    : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeFinderPreferences(value: unknown): FinderPreferences {
  if (!value || typeof value !== "object") {
    return EMPTY_FINDER_PREFERENCES;
  }
  const record = value as Record<string, unknown>;
  return {
    favoriteProjectKeys: normalizeStringArray(record.favoriteProjectKeys),
    recentProjectKeys: normalizeStringArray(record.recentProjectKeys).slice(
      0,
      MAX_RECENT_FINDER_ITEMS,
    ),
    favoriteShortcutKeys: normalizeStringArray(record.favoriteShortcutKeys),
    recentShortcutKeys: normalizeStringArray(record.recentShortcutKeys).slice(
      0,
      MAX_RECENT_FINDER_ITEMS,
    ),
    lastFinderType: normalizeFinderType(record.lastFinderType),
    lastFinderCategory:
      typeof record.lastFinderCategory === "string" &&
      record.lastFinderCategory.trim()
        ? record.lastFinderCategory.trim()
        : undefined,
    lastFinderQuickFilter: normalizeFinderQuickFilter(
      record.lastFinderQuickFilter,
    ),
  };
}

function toggleKey(values: string[], key: string): string[] {
  return values.includes(key)
    ? values.filter((item) => item !== key)
    : [key, ...values];
}

function touchRecentKey(values: string[], key: string): string[] {
  return [key, ...values.filter((item) => item !== key)].slice(
    0,
    MAX_RECENT_FINDER_ITEMS,
  );
}

function kind_from_finder_type(value: FinderType): string | null {
  switch (value) {
    case "网站":
      return "url";
    case "应用":
      return "app";
    case "脚本":
      return "script";
    default:
      return null;
  }
}

function buildRuntimeHaystack(item: ProjectRuntimeEntry): string {
  return [
    item.name,
    item.key,
    item.category,
    item.repoPath ?? "",
    item.command ?? "",
    item.cwd ?? "",
    item.buildCommand ?? "",
    item.buildCwd ?? "",
    item.statusLabel,
    item.detail,
    item.buildStatusLabel,
    item.buildDetail,
  ]
    .join(" ")
    .toLowerCase();
}

function buildShortcutHaystack(item: FinderShortcutItem): string {
  return [
    item.categoryTitle,
    item.categoryLabel,
    item.entry.kind,
    item.entry.name,
    item.entry.targetLabel,
    item.entry.note ?? "",
    item.entry.url ?? "",
    item.entry.bundleId ?? "",
    item.entry.appName ?? "",
    item.entry.script ?? "",
    item.entry.cwd ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function buildFinderShortcutKey(item: FinderShortcutItem): string {
  return [
    item.categoryTitle,
    item.categoryLabel,
    item.entry.kind,
    item.entry.name,
    item.entry.targetLabel,
  ].join("\u0000");
}

function runtimeActivityStatus(statusKey: string): ActivityStatus {
  if (statusKey === "running") {
    return "running";
  }
  if (statusKey === "succeeded") {
    return "success";
  }
  if (
    statusKey === "failed" ||
    statusKey === "exited" ||
    statusKey === "invalidConfig"
  ) {
    return "failed";
  }
  return "info";
}

function runtimeActivitySummary(statusLabel: string, detail: string) {
  return detail ? `${statusLabel} · ${detail}` : statusLabel;
}

function runtimeStartActivityStatus(statusKey: string): ActivityStatus {
  return statusKey === "running" ? "success" : runtimeActivityStatus(statusKey);
}

function runtimeStartActivityTitle(statusKey: string) {
  if (statusKey === "running") {
    return "dev 服务已启动";
  }
  if (statusKey === "exited") {
    return "dev 服务已退出";
  }
  return "启动 dev 服务";
}

function runtimeStartActivitySummary(item: ProjectRuntimeEntry) {
  if (item.statusKey === "running") {
    return "已启动 · dev 服务启动成功";
  }
  return runtimeActivitySummary(item.statusLabel, item.detail);
}

function isRuntimeExitAttentionState(statusKey: string) {
  return (
    statusKey === "exited" ||
    statusKey === "failed" ||
    statusKey === "invalidConfig"
  );
}

function getInitialDocumentHidden() {
  return typeof document === "undefined" ? false : document.hidden;
}

export type ProjectsModuleState = {
  finderTypeOptions: readonly FinderType[];
  finderType: FinderType;
  finderTypeCounts: Record<FinderType, number>;
  setFinderType: (value: FinderType) => void;
  finderQuickFilterOptions: readonly FinderQuickFilter[];
  finderQuickFilter: FinderQuickFilter;
  finderQuickFilterCounts: Record<FinderQuickFilter, number>;
  setFinderQuickFilter: (value: FinderQuickFilter) => void;
  finderCategories: string[];
  finderCategory: string;
  finderCategoryCounts: Record<string, number>;
  setFinderCategory: (value: string) => void;
  finderQuery: string;
  setFinderQuery: (value: string) => void;
  runtimeEntries: ProjectRuntimeEntry[];
  filteredRuntimeEntries: ProjectRuntimeEntry[];
  shortcutEntries: FinderShortcutItem[];
  filteredShortcutEntries: FinderShortcutItem[];
  favoriteProjectKeys: string[];
  recentProjectKeys: string[];
  favoriteShortcutKeys: string[];
  recentShortcutKeys: string[];
  toggleProjectFavorite: (projectKey: string) => void;
  toggleShortcutFavorite: (item: FinderShortcutItem) => void;
  markShortcutUsed: (item: FinderShortcutItem) => void;
  loadFinderData: (options?: LoadFinderDataOptions) => Promise<void>;
  loadProjectRuntimes: () => Promise<void>;
  handleOpenFinderEntry: (entry: NavigationEntry) => Promise<boolean>;
  handleStartRuntime: (projectKey: string) => Promise<void>;
  handleStopRuntime: (projectKey: string) => Promise<void>;
  handleRunBuild: (projectKey: string) => Promise<void>;
  handleStopBuild: (projectKey: string) => Promise<void>;
  handleOpenBuildOutput: (projectKey: string) => Promise<void>;
  handleFocusRuntime: (projectKey: string) => Promise<void>;
  handleOpenProjectDirectory: (projectKey: string) => Promise<void>;
  handleReplayProjectWorkflow: (replay: WorkflowProjectReplay) => Promise<void>;
};

export function useProjectsModule({
  enabled,
  setBusy,
  setError,
  workflowBroadcastRules,
  emitWorkflowSignals,
  recordActivity,
  updateActivity,
}: UseProjectsModuleOptions): ProjectsModuleState {
  const [finderType, setFinderType] = useState<FinderType>("项目");
  const [finderQuickFilter, setFinderQuickFilter] =
    useState<FinderQuickFilter>("全部");
  const [finderCategory, setFinderCategory] = useState("全部");
  const [finderQuery, setFinderQuery] = useState("");
  const [runtimeEntries, setRuntimeEntries] = useState<ProjectRuntimeEntry[]>([]);
  const [navigationData, setNavigationData] = useState<NavigationData | null>(null);
  const [preferences, setPreferences] = useState<FinderPreferences>(
    EMPTY_FINDER_PREFERENCES,
  );
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(getInitialDocumentHidden);
  const finderDataLoadedAtRef = useRef(0);
  const finderDataPromiseRef = useRef<Promise<void> | null>(null);
  const activeRuntimeKeysRef = useRef<string[]>([]);
  const activeBuildActivityIdsRef = useRef<Record<string, string>>({});
  const previousRuntimeStatesRef = useRef<
    Map<string, { statusKey: string; buildStatusKey: string }>
  >(new Map());

  const favoriteProjectKeySet = useMemo(
    () => new Set(preferences.favoriteProjectKeys),
    [preferences.favoriteProjectKeys],
  );
  const recentProjectKeySet = useMemo(
    () => new Set(preferences.recentProjectKeys),
    [preferences.recentProjectKeys],
  );
  const favoriteShortcutKeySet = useMemo(
    () => new Set(preferences.favoriteShortcutKeys),
    [preferences.favoriteShortcutKeys],
  );
  const recentShortcutKeySet = useMemo(
    () => new Set(preferences.recentShortcutKeys),
    [preferences.recentShortcutKeys],
  );

  const shortcutEntries = useMemo(() => {
    const expectedKind = kind_from_finder_type(finderType);
    if (!expectedKind) {
      return [] as FinderShortcutItem[];
    }

    return (navigationData?.categories ?? []).flatMap((category) =>
      category.entries
        .filter((entry) => entry.kind === expectedKind)
        .map((entry) => ({
          categoryTitle: category.title,
          categoryLabel: category.shortLabel,
          entry,
        })),
    );
  }, [finderType, navigationData?.categories]);

  const finderTypeCounts = useMemo(
    () => ({
      项目: runtimeEntries.length,
      网站: (navigationData?.categories ?? []).reduce(
        (count, category) =>
          count + category.entries.filter((entry) => entry.kind === "url").length,
        0,
      ),
      应用: (navigationData?.categories ?? []).reduce(
        (count, category) =>
          count + category.entries.filter((entry) => entry.kind === "app").length,
        0,
      ),
      脚本: (navigationData?.categories ?? []).reduce(
        (count, category) =>
          count + category.entries.filter((entry) => entry.kind === "script").length,
        0,
      ),
    }),
    [navigationData?.categories, runtimeEntries],
  );

  const finderCategories = useMemo(() => {
    if (finderType === "项目") {
      return [];
    }
    const values = Array.from(new Set(shortcutEntries.map((item) => item.categoryTitle)));
    return values.length > 1 ? ["全部", ...values] : values;
  }, [finderType, shortcutEntries]);

  const finderCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of shortcutEntries) {
      counts[item.categoryTitle] = (counts[item.categoryTitle] ?? 0) + 1;
    }
    if (shortcutEntries.length > 0) {
      counts["全部"] = shortcutEntries.length;
    }
    return counts;
  }, [shortcutEntries]);

  const shortcutEntriesInCategory = useMemo(
    () =>
      shortcutEntries.filter(
        (item) =>
          finderCategory === "全部" ||
          !finderCategory ||
          item.categoryTitle === finderCategory,
      ),
    [finderCategory, shortcutEntries],
  );

  const finderQuickFilterCounts = useMemo(() => {
    if (finderType === "项目") {
      return {
        全部: runtimeEntries.length,
        收藏: runtimeEntries.filter((item) => favoriteProjectKeySet.has(item.key))
          .length,
        最近: runtimeEntries.filter((item) => recentProjectKeySet.has(item.key))
          .length,
      };
    }

    return {
      全部: shortcutEntriesInCategory.length,
      收藏: shortcutEntriesInCategory.filter((item) =>
        favoriteShortcutKeySet.has(buildFinderShortcutKey(item)),
      ).length,
      最近: shortcutEntriesInCategory.filter((item) =>
        recentShortcutKeySet.has(buildFinderShortcutKey(item)),
      ).length,
    };
  }, [
    favoriteProjectKeySet,
    favoriteShortcutKeySet,
    finderType,
    recentProjectKeySet,
    recentShortcutKeySet,
    runtimeEntries,
    shortcutEntriesInCategory,
  ]);

  useEffect(() => {
    if (finderType === "项目") {
      if (finderCategory !== "全部") {
        setFinderCategory("全部");
      }
      return;
    }

    if (finderCategories.length === 0) {
      if (finderCategory !== "全部") {
        setFinderCategory("全部");
      }
      return;
    }

    if (!finderCategories.includes(finderCategory)) {
      setFinderCategory(finderCategories[0] ?? "全部");
    }
  }, [finderCategories, finderCategory, finderType]);

  useEffect(() => {
    if (finderQuickFilter !== "全部" && finderQuickFilterCounts[finderQuickFilter] === 0) {
      setFinderQuickFilter("全部");
    }
  }, [finderQuickFilter, finderQuickFilterCounts]);

  const filteredRuntimeEntries = useMemo(() => {
    const keyword = finderQuery.trim().toLowerCase();
    const recentOrder = new Map(
      preferences.recentProjectKeys.map((key, index) => [key, index] as const),
    );
    const filtered = runtimeEntries.filter((item) => {
      if (finderType !== "项目") {
        return false;
      }
      if (finderQuickFilter === "收藏" && !favoriteProjectKeySet.has(item.key)) {
        return false;
      }
      if (finderQuickFilter === "最近" && !recentProjectKeySet.has(item.key)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return buildRuntimeHaystack(item).includes(keyword);
    });
    if (finderQuickFilter === "最近") {
      return [...filtered].sort(
        (a, b) =>
          (recentOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
          (recentOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return filtered;
  }, [
    favoriteProjectKeySet,
    finderQuery,
    finderQuickFilter,
    finderType,
    preferences.recentProjectKeys,
    recentProjectKeySet,
    runtimeEntries,
  ]);

  const filteredShortcutEntries = useMemo(() => {
    const keyword = finderQuery.trim().toLowerCase();
    const recentOrder = new Map(
      preferences.recentShortcutKeys.map((key, index) => [key, index] as const),
    );
    const filtered = shortcutEntries.filter((item) => {
      const shortcutKey = buildFinderShortcutKey(item);
      if (finderType === "项目") {
        return false;
      }
      if (finderCategory !== "全部" && finderCategory && item.categoryTitle !== finderCategory) {
        return false;
      }
      if (finderQuickFilter === "收藏" && !favoriteShortcutKeySet.has(shortcutKey)) {
        return false;
      }
      if (finderQuickFilter === "最近" && !recentShortcutKeySet.has(shortcutKey)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return buildShortcutHaystack(item).includes(keyword);
    });
    if (finderQuickFilter === "最近") {
      return [...filtered].sort(
        (a, b) =>
          (recentOrder.get(buildFinderShortcutKey(a)) ?? Number.MAX_SAFE_INTEGER) -
          (recentOrder.get(buildFinderShortcutKey(b)) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return filtered;
  }, [
    favoriteShortcutKeySet,
    finderCategory,
    finderQuery,
    finderQuickFilter,
    finderType,
    preferences.recentShortcutKeys,
    recentShortcutKeySet,
    shortcutEntries,
  ]);

  const activeRuntimeKeys = useMemo(
    () =>
      runtimeEntries
        .filter((item) => item.canStop || item.canStopBuild)
        .map((item) => item.key),
    [runtimeEntries],
  );
  const activeRuntimePollingKey = useMemo(
    () => activeRuntimeKeys.join("|"),
    [activeRuntimeKeys],
  );

  function replaceRuntimeEntry(projectKey: string, updated: ProjectRuntimeEntry) {
    setRuntimeEntries((current) =>
      current.map((item) => (item.key === projectKey ? updated : item)),
    );
  }

  function mergeRuntimeEntries(updatedEntries: ProjectRuntimeEntry[]) {
    if (updatedEntries.length === 0) {
      return;
    }

    const updatedEntriesMap = new Map(
      updatedEntries.map((item) => [item.key, item] as const),
    );
    setRuntimeEntries((current) =>
      current.map((item) => updatedEntriesMap.get(item.key) ?? item),
    );
  }

  function updatePreferences(
    updater: (current: FinderPreferences) => FinderPreferences,
  ) {
    setPreferences((current) => normalizeFinderPreferences(updater(current)));
  }

  function touchProjectUsage(projectKey: string) {
    if (!projectKey) {
      return;
    }
    updatePreferences((current) => ({
      ...current,
      recentProjectKeys: touchRecentKey(current.recentProjectKeys, projectKey),
    }));
  }

  function runtimeEntryForActivity(projectKey: string) {
    return runtimeEntries.find((item) => item.key === projectKey);
  }

  function runtimeProjectName(projectKey: string) {
    return runtimeEntryForActivity(projectKey)?.name || projectKey;
  }

  function projectWorkflowReplay(
    projectKey: string,
    action: ProjectWorkflowAction,
  ): WorkflowProjectReplay {
    return {
      target: "project.replay",
      action,
      projectKey,
      projectName: runtimeProjectName(projectKey),
    };
  }

  async function emitProjectWorkflowSignals(
    replay: WorkflowProjectReplay,
    summary?: string,
  ) {
    try {
      await emitWorkflowSignals(
        createProjectWorkflowSignals({
          broadcasts: workflowBroadcastRules,
          replay,
          summary,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    }
  }

  function runtimeActivityTarget(projectKey: string) {
    return {
      page: "projects" as const,
      projectKey,
    };
  }

  function localPathResource(label: string, value?: string | null): ActivityResource | null {
    const path = value?.trim();
    return path
      ? {
          kind: "localPath",
          label,
          value: path,
        }
      : null;
  }

  function buildResource(item: ProjectRuntimeEntry): ActivityResource | null {
    return (
      localPathResource("打开构建日志", item.buildLogPath) ??
      localPathResource("打开产物目录", item.buildOutputDir)
    );
  }

  function buildResourceForProject(projectKey: string): ActivityResource | null {
    const entry = runtimeEntryForActivity(projectKey);
    return entry ? buildResource(entry) : null;
  }

  function shortcutResource(entry: NavigationEntry): ActivityResource | null {
    if (entry.url) {
      return {
        kind: "url",
        label: "打开地址",
        value: entry.url,
      };
    }
    return (
      localPathResource("打开脚本目录", entry.cwd) ??
      localPathResource("打开脚本", entry.script)
    );
  }

  function toggleProjectFavorite(projectKey: string) {
    if (!projectKey) {
      return;
    }
    updatePreferences((current) => ({
      ...current,
      favoriteProjectKeys: toggleKey(current.favoriteProjectKeys, projectKey),
    }));
  }

  function toggleShortcutFavorite(item: FinderShortcutItem) {
    const shortcutKey = buildFinderShortcutKey(item);
    updatePreferences((current) => ({
      ...current,
      favoriteShortcutKeys: toggleKey(current.favoriteShortcutKeys, shortcutKey),
    }));
  }

  function markShortcutUsed(item: FinderShortcutItem) {
    const shortcutKey = buildFinderShortcutKey(item);
    updatePreferences((current) => ({
      ...current,
      recentShortcutKeys: touchRecentKey(current.recentShortcutKeys, shortcutKey),
    }));
  }

  async function refreshProjectRuntimes(options?: {
    silent?: boolean;
    projectKeys?: string[];
  }) {
    if (!enabled) {
      setRuntimeEntries([]);
      return;
    }

    if (!options?.silent) {
      setError("");
    }
    try {
      if (options?.projectKeys?.length) {
        const items = await invoke<ProjectRuntimeEntry[]>("list_selected_project_runtimes", {
          projects: options.projectKeys,
        });
        mergeRuntimeEntries(items);
      } else {
        const items = await invoke<ProjectRuntimeEntry[]>("list_project_runtimes");
        setRuntimeEntries(items);
      }
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function loadNavigationEntries() {
    if (!enabled) {
      setNavigationData(null);
      return;
    }
    try {
      const data = await invoke<NavigationData>("load_page_navigation");
      setNavigationData(data);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function loadFinderData(options?: LoadFinderDataOptions) {
    if (!enabled) {
      finderDataLoadedAtRef.current = 0;
      finderDataPromiseRef.current = null;
      setRuntimeEntries([]);
      setNavigationData(null);
      return;
    }

    const cacheFresh =
      finderDataLoadedAtRef.current > 0 &&
      Date.now() - finderDataLoadedAtRef.current < FINDER_DATA_CACHE_TTL_MS;
    if (!options?.force && cacheFresh) {
      return;
    }
    if (!options?.force && finderDataPromiseRef.current) {
      return finderDataPromiseRef.current;
    }

    const nextPromise = Promise.all([
      refreshProjectRuntimes(),
      loadNavigationEntries(),
    ])
      .then(() => {
        finderDataLoadedAtRef.current = Date.now();
      })
      .finally(() => {
        if (finderDataPromiseRef.current === nextPromise) {
          finderDataPromiseRef.current = null;
        }
      });
    finderDataPromiseRef.current = nextPromise;
    await nextPromise;
  }

  async function loadProjectRuntimes() {
    await refreshProjectRuntimes();
  }

  useEffect(() => {
    if (!enabled) {
      setPreferences(EMPTY_FINDER_PREFERENCES);
      setPreferencesHydrated(false);
      return;
    }

    let cancelled = false;
    void getStoredJson<unknown>(
      FINDER_STORAGE_NAMESPACE,
      FINDER_PREFERENCES_STORAGE_KEY,
    )
      .then((value) => {
        if (cancelled) {
          return;
        }
        const nextPreferences = normalizeFinderPreferences(value);
        if (nextPreferences.lastFinderType) {
          setFinderType(nextPreferences.lastFinderType);
        }
        if (nextPreferences.lastFinderCategory) {
          setFinderCategory(nextPreferences.lastFinderCategory);
        }
        if (nextPreferences.lastFinderQuickFilter) {
          setFinderQuickFilter(nextPreferences.lastFinderQuickFilter);
        }
        setPreferences(nextPreferences);
        setPreferencesHydrated(true);
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }
        setError(String(reason));
        setPreferencesHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, setError]);

  useEffect(() => {
    if (!enabled || !preferencesHydrated) {
      return;
    }

    updatePreferences((current) => ({
      ...current,
      lastFinderType: finderType,
      lastFinderCategory: finderCategory,
      lastFinderQuickFilter: finderQuickFilter,
    }));
  }, [
    enabled,
    finderCategory,
    finderQuickFilter,
    finderType,
    preferencesHydrated,
  ]);

  useEffect(() => {
    if (!enabled || !preferencesHydrated) {
      return;
    }

    void setStoredJson(
      FINDER_STORAGE_NAMESPACE,
      FINDER_PREFERENCES_STORAGE_KEY,
      preferences,
    ).catch((reason) => {
      setError(String(reason));
    });
  }, [enabled, preferences, preferencesHydrated, setError]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    function handleVisibilityChange() {
      setDocumentHidden(document.hidden);
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    activeRuntimeKeysRef.current = activeRuntimeKeys;
  }, [activeRuntimeKeys]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (activeRuntimePollingKey.length === 0) {
      return;
    }

    const intervalMs = documentHidden
      ? RUNTIME_POLL_HIDDEN_INTERVAL_MS
      : RUNTIME_POLL_VISIBLE_INTERVAL_MS;
    if (!documentHidden) {
      void refreshProjectRuntimes({
        silent: true,
        projectKeys: activeRuntimeKeysRef.current,
      });
    }

    const timer = window.setInterval(() => {
      void refreshProjectRuntimes({
        silent: true,
        projectKeys: activeRuntimeKeysRef.current,
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [activeRuntimePollingKey, documentHidden, enabled]);

  useEffect(() => {
    if (!enabled) {
      activeBuildActivityIdsRef.current = {};
      previousRuntimeStatesRef.current = new Map();
      return;
    }

    const previous = previousRuntimeStatesRef.current;
    for (const item of runtimeEntries) {
      const prev = previous.get(item.key);
      if (
        prev?.buildStatusKey === "running" &&
        item.buildStatusKey !== "running" &&
        item.buildStatusKey !== prev.buildStatusKey
      ) {
        const status = runtimeActivityStatus(item.buildStatusKey);
        const activityId = activeBuildActivityIdsRef.current[item.key];
        if (activityId) {
          updateActivity?.(activityId, {
            status,
            summary: runtimeActivitySummary(item.buildStatusLabel, item.buildDetail),
            detail: item.buildLogPath || item.buildOutputDir || null,
            projectName: item.name,
            target: runtimeActivityTarget(item.key),
            resource: buildResource(item),
          });
          delete activeBuildActivityIdsRef.current[item.key];
        } else {
          recordActivity?.({
            kind: "build",
            status,
            title: "构建完成",
            summary: runtimeActivitySummary(item.buildStatusLabel, item.buildDetail),
            detail: item.buildLogPath || item.buildOutputDir || null,
            projectKey: item.key,
            projectName: item.name,
            target: runtimeActivityTarget(item.key),
            resource: buildResource(item),
          });
        }
      }

      if (
        prev?.statusKey === "running" &&
        item.statusKey !== "running" &&
        isRuntimeExitAttentionState(item.statusKey)
      ) {
        recordActivity?.({
          kind: "runtime",
          status: "failed",
          title: item.statusKey === "exited" ? "dev 服务已退出" : "dev 服务异常退出",
          summary: runtimeActivitySummary(item.statusLabel, item.detail),
          detail: item.logPath || null,
          projectKey: item.key,
          projectName: item.name,
          target: runtimeActivityTarget(item.key),
          resource: localPathResource("打开日志", item.logPath),
        });
      }
    }

    previousRuntimeStatesRef.current = new Map(
      runtimeEntries.map((item) => [
        item.key,
        {
          statusKey: item.statusKey,
          buildStatusKey: item.buildStatusKey,
        },
      ]),
    );
  }, [enabled, recordActivity, runtimeEntries, updateActivity]);

  async function handleOpenFinderEntry(entry: NavigationEntry): Promise<boolean> {
    if (!enabled) {
      return false;
    }
    setBusy("正在打开入口");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "shortcut",
        status: "running",
        title: "打开入口",
        summary: `${entry.name} · ${entry.targetLabel}`,
        detail: entry.note || entry.url || entry.bundleId || entry.script || null,
        resource: shortcutResource(entry),
        target: {
          page: "projects",
        },
      }) || "";
    try {
      await invoke("open_page_navigation_entry", { entry });
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: `${entry.name} 已打开`,
          resource: shortcutResource(entry),
        });
      }
      return true;
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: `${entry.name} 打开失败`,
          detail: String(reason),
          resource: shortcutResource(entry),
        });
      }
      setError(String(reason));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function handleStartRuntime(projectKey: string) {
    if (!enabled) {
      return;
    }

    setBusy("正在启动 dev 服务");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "启动 dev 服务",
        summary: runtimeProjectName(projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("start_project_runtime", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.runtime.start"),
        runtimeStartActivitySummary(updated),
      );
      if (activityId) {
        updateActivity?.(activityId, {
          status: runtimeStartActivityStatus(updated.statusKey),
          title: runtimeStartActivityTitle(updated.statusKey),
          summary: runtimeStartActivitySummary(updated),
          detail: updated.logPath || null,
          projectName: updated.name,
          resource: localPathResource("打开日志", updated.logPath),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "dev 服务启动失败",
          detail: String(reason),
        });
      }
      setError(String(reason));
      await loadProjectRuntimes();
    } finally {
      setBusy("");
    }
  }

  async function handleStopRuntime(projectKey: string) {
    if (!enabled) {
      return;
    }

    setBusy("正在停止 dev 服务");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "停止 dev 服务",
        summary: runtimeProjectName(projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("stop_project_runtime", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.runtime.stop"),
        runtimeActivitySummary(updated.statusLabel, updated.detail),
      );
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: runtimeActivitySummary(updated.statusLabel, updated.detail),
          detail: updated.logPath || null,
          projectName: updated.name,
          resource: localPathResource("打开日志", updated.logPath),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "dev 服务停止失败",
          detail: String(reason),
        });
      }
      setError(String(reason));
      await loadProjectRuntimes();
    } finally {
      setBusy("");
    }
  }

  async function handleRunBuild(projectKey: string) {
    if (!enabled) {
      return;
    }

    setBusy("正在执行打包任务");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "build",
        status: "running",
        title: "执行构建",
        summary: runtimeProjectName(projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("run_project_build", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.build.run"),
        runtimeActivitySummary(updated.buildStatusLabel, updated.buildDetail),
      );
      if (activityId) {
        if (updated.buildStatusKey === "running") {
          activeBuildActivityIdsRef.current[projectKey] = activityId;
          updateActivity?.(activityId, {
            status: "running",
            summary: runtimeActivitySummary(updated.buildStatusLabel, updated.buildDetail),
            detail: updated.buildLogPath || null,
            projectName: updated.name,
            resource: buildResource(updated),
          });
        } else {
          updateActivity?.(activityId, {
            status: runtimeActivityStatus(updated.buildStatusKey),
            summary: runtimeActivitySummary(updated.buildStatusLabel, updated.buildDetail),
            detail: updated.buildLogPath || updated.buildOutputDir || null,
            projectName: updated.name,
            resource: buildResource(updated),
          });
        }
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "构建启动失败",
          detail: String(reason),
          resource: buildResourceForProject(projectKey),
        });
      }
      setError(String(reason));
      await loadProjectRuntimes();
    } finally {
      setBusy("");
    }
  }

  async function handleStopBuild(projectKey: string) {
    if (!enabled) {
      return;
    }

    setBusy("正在中止打包任务");
    setError("");
    const runningBuildActivityId = activeBuildActivityIdsRef.current[projectKey] || "";
    const activityId =
      recordActivity?.({
        kind: "build",
        status: "running",
        title: "中止构建",
        summary: runtimeProjectName(projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("stop_project_build", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      delete activeBuildActivityIdsRef.current[projectKey];
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.build.stop"),
        runtimeActivitySummary(updated.buildStatusLabel, updated.buildDetail),
      );
      if (runningBuildActivityId) {
        updateActivity?.(runningBuildActivityId, {
          status: "info",
          summary: "构建已中止",
          detail: updated.buildLogPath || null,
          projectName: updated.name,
          resource: buildResource(updated),
        });
      }
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: runtimeActivitySummary(updated.buildStatusLabel, updated.buildDetail),
          detail: updated.buildLogPath || null,
          projectName: updated.name,
          resource: buildResource(updated),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "构建中止失败",
          detail: String(reason),
          resource: buildResourceForProject(projectKey),
        });
      }
      setError(String(reason));
      await loadProjectRuntimes();
    } finally {
      setBusy("");
    }
  }

  async function handleOpenBuildOutput(projectKey: string) {
    if (!enabled) {
      return;
    }

    setBusy("正在打开产物目录");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "build",
        status: "running",
        title: "打开构建产物",
        summary: runtimeProjectName(projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
        resource: buildResourceForProject(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("open_project_build_output", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.build.openOutput"),
        updated.buildOutputDir || "构建产物目录已打开",
      );
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: updated.buildOutputDir || "构建产物目录已打开",
          projectName: updated.name,
          resource: localPathResource("打开产物目录", updated.buildOutputDir),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "构建产物打开失败",
          detail: String(reason),
          resource: buildResourceForProject(projectKey),
        });
      }
      setError(String(reason));
      await loadProjectRuntimes();
    } finally {
      setBusy("");
    }
  }

  async function handleFocusRuntime(projectKey: string) {
    if (!enabled) {
      return;
    }

    setBusy("正在唤起运行中的项目");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "唤起项目",
        summary: runtimeProjectName(projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("focus_project_runtime", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.runtime.focus"),
        runtimeActivitySummary(updated.statusLabel, updated.detail),
      );
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: runtimeActivitySummary(updated.statusLabel, updated.detail),
          projectName: updated.name,
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "项目唤起失败",
          detail: String(reason),
        });
      }
      setError(String(reason));
      await loadProjectRuntimes();
    } finally {
      setBusy("");
    }
  }

  async function handleOpenProjectDirectory(projectKey: string) {
    if (!enabled) {
      return;
    }

    const entry = runtimeEntries.find((item) => item.key === projectKey);
    const path = entry?.cwd || entry?.repoPath;
    if (!path) {
      setError("当前项目未配置目录");
      return;
    }

    setBusy("正在打开项目目录");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "打开项目目录",
        summary: entry.name,
        detail: path,
        projectKey,
        projectName: entry.name,
        target: runtimeActivityTarget(projectKey),
        resource: localPathResource("打开项目目录", path),
      }) || "";
    try {
      await invoke("open_local_path", { path });
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.openDirectory"),
        "项目目录已打开",
      );
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: "项目目录已打开",
          resource: localPathResource("打开项目目录", path),
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "项目目录打开失败",
          detail: String(reason),
          resource: localPathResource("打开项目目录", path),
        });
      }
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleReplayProjectWorkflow(replay: WorkflowProjectReplay) {
    if (replay.action === "finder.shortcut.open") {
      if (replay.shortcut) {
        await handleOpenFinderEntry(replay.shortcut.entry);
      }
      return;
    }

    const projectKey = replay.projectKey ?? "";
    if (!projectKey) {
      return;
    }

    switch (replay.action) {
      case "project.runtime.start":
        await handleStartRuntime(projectKey);
        break;
      case "project.runtime.stop":
        await handleStopRuntime(projectKey);
        break;
      case "project.build.run":
        await handleRunBuild(projectKey);
        break;
      case "project.build.stop":
        await handleStopBuild(projectKey);
        break;
      case "project.build.openOutput":
        await handleOpenBuildOutput(projectKey);
        break;
      case "project.runtime.focus":
        await handleFocusRuntime(projectKey);
        break;
      case "project.openDirectory":
        await handleOpenProjectDirectory(projectKey);
        break;
    }
  }

  return {
    finderTypeOptions: FINDER_TYPE_OPTIONS,
    finderType,
    finderTypeCounts,
    setFinderType,
    finderQuickFilterOptions: FINDER_QUICK_FILTER_OPTIONS,
    finderQuickFilter,
    finderQuickFilterCounts,
    setFinderQuickFilter,
    finderCategories,
    finderCategory,
    finderCategoryCounts,
    setFinderCategory,
    finderQuery,
    setFinderQuery,
    runtimeEntries,
    filteredRuntimeEntries,
    shortcutEntries,
    filteredShortcutEntries,
    favoriteProjectKeys: preferences.favoriteProjectKeys,
    recentProjectKeys: preferences.recentProjectKeys,
    favoriteShortcutKeys: preferences.favoriteShortcutKeys,
    recentShortcutKeys: preferences.recentShortcutKeys,
    toggleProjectFavorite,
    toggleShortcutFavorite,
    markShortcutUsed,
    loadFinderData,
    loadProjectRuntimes,
    handleOpenFinderEntry,
    handleStartRuntime,
    handleStopRuntime,
    handleRunBuild,
    handleStopBuild,
    handleOpenBuildOutput,
    handleFocusRuntime,
    handleOpenProjectDirectory,
    handleReplayProjectWorkflow,
  };
}
