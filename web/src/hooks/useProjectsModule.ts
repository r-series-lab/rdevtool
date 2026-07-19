import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectDebugProfileSummary,
  ProjectRuntimeEntry,
  ProjectRuntimePreflightResponse,
  ProjectWorkflowAction,
} from "../app-types";
import type {
  ActivityPatch,
  ActivityResource,
  ActivityBulkUpdater,
  ActivityRecorder,
  ActivityStatus,
  ActivityUpdater,
} from "../lib/activityCenter";
import { stableActivityJson } from "../lib/activityCenter";
import { getStoredJson, setStoredJson } from "../lib/storage";
import {
  createProjectWorkflowSignals,
  type WorkflowBroadcastRule,
  type WorkflowProjectReplay,
  type WorkflowSignal,
} from "../lib/workflowSignals";
import { configSourceIdForWorkspace } from "../lib/configSources";

type UseProjectsModuleOptions = {
  enabled: boolean;
  activeProjectWorkspaceKey: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  workflowBroadcastRules: WorkflowBroadcastRule[];
  emitWorkflowSignals: (signals: WorkflowSignal[]) => Promise<void>;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
  syncActivities?: ActivityBulkUpdater;
};

type FinderType = "项目" | "网站" | "目录" | "工具";

type NavigationEntry = {
  name: string;
  kind: string;
  targetLabel: string;
  url?: string | null;
  browser?: string | null;
  browserProfile?: string | null;
  runtimeProfile?: string | null;
  bundleId?: string | null;
  appName?: string | null;
  script?: string | null;
  tool?: string | null;
  toolKey?: string | null;
  toolAction?: string | null;
  path?: string | null;
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

const FINDER_TYPE_OPTIONS = ["项目", "网站", "目录", "工具"] as const;
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
  debugProfileKeysByProject: Record<string, string>;
  lastFinderType?: FinderType;
  lastFinderCategory?: string;
};

type LoadFinderDataOptions = {
  force?: boolean;
};

type ProjectWorkflowReplayOptions = {
  chainId?: string | null;
  parentId?: string | null;
  stepLabel?: string | null;
};

const EMPTY_FINDER_PREFERENCES: FinderPreferences = {
  favoriteProjectKeys: [],
  recentProjectKeys: [],
  favoriteShortcutKeys: [],
  recentShortcutKeys: [],
  debugProfileKeysByProject: {},
};

function normalizeFinderType(value: unknown): FinderType | undefined {
  return FINDER_TYPE_OPTIONS.includes(value as FinderType)
    ? (value as FinderType)
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

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      continue;
    }
    const normalizedKey = key.trim();
    const normalizedValue = item.trim();
    if (normalizedKey && normalizedValue) {
      next[normalizedKey] = normalizedValue;
    }
  }
  return next;
}

function normalizeRuntimeEnvOverrides(
  value?: Record<string, string> | null,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      continue;
    }
    const normalizedKey = key.trim();
    if (normalizedKey) {
      next[normalizedKey] = item;
    }
  }
  return next;
}

function normalizeRuntimeEntries(value: unknown): ProjectRuntimeEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ProjectRuntimeEntry =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as { key?: unknown }).key === "string",
      ),
  );
}

export type ProjectRuntimeDebugProfileSelection = {
  key: string;
  profile: ProjectDebugProfileSummary | null;
};

export function resolveProjectRuntimeDebugProfile(
  entry: Pick<ProjectRuntimeEntry, "debugProfiles"> | null | undefined,
  requestedKey?: string | null,
): ProjectRuntimeDebugProfileSelection {
  const candidate = requestedKey?.trim() ?? "";
  const profile =
    candidate && Array.isArray(entry?.debugProfiles)
      ? entry.debugProfiles.find((item) => item.key === candidate) ?? null
      : null;
  return {
    key: profile?.key ?? "",
    profile,
  };
}

type ProjectRuntimeLaunchPlanOptions = {
  projectKey: string;
  runtimeEntry: Pick<ProjectRuntimeEntry, "debugProfiles"> | null | undefined;
  requestedDebugProfileKey?: string | null;
  envOverrides?: Record<string, string>;
};

export function buildProjectRuntimeLaunchPlan({
  projectKey,
  runtimeEntry,
  requestedDebugProfileKey,
  envOverrides,
}: ProjectRuntimeLaunchPlanOptions) {
  const selection = resolveProjectRuntimeDebugProfile(
    runtimeEntry,
    requestedDebugProfileKey,
  );
  const debugProfile = selection.key || null;
  const hasExplicitEnvOverrides = envOverrides != null;
  const normalizedEnvOverrides = normalizeRuntimeEnvOverrides(envOverrides);
  return {
    selection,
    hasExplicitEnvOverrides,
    preflightArgs: {
      project: projectKey,
      debugProfile,
    },
    startArgs: {
      project: projectKey,
      debugProfile,
      envOverrides: hasExplicitEnvOverrides ? normalizedEnvOverrides : null,
    },
  };
}

export function projectRuntimePreflightBlocksStart(statusKey: string) {
  return statusKey.trim().toLowerCase() === "error";
}

export function projectRuntimePreferencesAllowStart(
  enabled: boolean,
  preferencesHydrated: boolean,
) {
  return enabled && preferencesHydrated;
}

function normalizeNavigationData(value: unknown): NavigationData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    filePath?: unknown;
    preferredCategory?: unknown;
    categories?: unknown;
  };
  const categories = Array.isArray(data.categories)
    ? data.categories
        .filter((category): category is Record<string, unknown> =>
          Boolean(category && typeof category === "object"),
        )
        .map((category) => ({
          title: typeof category.title === "string" ? category.title : "",
          shortLabel:
            typeof category.shortLabel === "string" ? category.shortLabel : "",
          entries: Array.isArray(category.entries)
            ? category.entries.filter(
                (entry): entry is NavigationEntry =>
                  Boolean(entry && typeof entry === "object"),
              )
            : [],
        }))
        .filter((category) => category.title || category.entries.length > 0)
    : [];

  return {
    filePath: typeof data.filePath === "string" ? data.filePath : "",
    preferredCategory:
      typeof data.preferredCategory === "string" ? data.preferredCategory : null,
    categories,
  };
}

function projectWorkflowActionLabel(action: ProjectWorkflowAction) {
  switch (action) {
    case "project.runtime.start":
      return "启动 dev 服务";
    case "project.runtime.stop":
      return "停止 dev 服务";
    case "project.build.run":
      return "执行构建";
    case "project.build.stop":
      return "中止构建";
    case "project.build.openOutput":
      return "打开构建产物";
    case "project.runtime.focus":
      return "唤起项目";
    case "project.openDirectory":
      return "打开项目目录";
    case "finder.shortcut.open":
      return "打开入口";
  }
}

function projectActivityExecutionKey(
  action: ProjectWorkflowAction | string,
  projectKey: string,
  variant = "",
) {
  return `project:${action}:${projectKey}:${variant}`;
}

function shortcutActivityExecutionKey(entry: NavigationEntry) {
  return `shortcut:finder.shortcut.open:${stableActivityJson({
    appName: entry.appName ?? null,
    browser: entry.browser ?? null,
    browserProfile: entry.browserProfile ?? null,
    bundleId: entry.bundleId ?? null,
    cwd: entry.cwd ?? null,
    kind: entry.kind,
    name: entry.name,
    path: entry.path ?? null,
    runtimeProfile: entry.runtimeProfile ?? null,
    script: entry.script ?? null,
    targetLabel: entry.targetLabel,
    url: entry.url ?? null,
  })}`;
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
    debugProfileKeysByProject: normalizeStringRecord(record.debugProfileKeysByProject),
    lastFinderType: normalizeFinderType(record.lastFinderType),
    lastFinderCategory:
      typeof record.lastFinderCategory === "string" &&
      record.lastFinderCategory.trim()
        ? record.lastFinderCategory.trim()
        : undefined,
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

function compareMarkedFirst(leftMarked: boolean, rightMarked: boolean) {
  return Number(rightMarked) - Number(leftMarked);
}

function entry_matches_finder_type(entry: NavigationEntry, value: FinderType) {
  switch (value) {
    case "网站":
      return entry.kind === "url";
    case "目录":
      return entry.kind === "directory";
    case "工具":
      return entry.kind === "app" || entry.kind === "script" || entry.kind === "tool";
    default:
      return false;
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
    item.entry.runtimeProfile ?? "",
    item.entry.bundleId ?? "",
    item.entry.appName ?? "",
    item.entry.script ?? "",
    item.entry.tool ?? "",
    item.entry.toolKey ?? "",
    item.entry.toolAction ?? "",
    item.entry.path ?? "",
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
    item.entry.tool ?? "",
    item.entry.toolKey ?? "",
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
  selectedDebugProfileKeys: Record<string, string>;
  preferencesHydrated: boolean;
  toggleProjectFavorite: (projectKey: string) => void;
  toggleShortcutFavorite: (item: FinderShortcutItem) => void;
  setProjectDebugProfile: (projectKey: string, profileKey: string) => void;
  markShortcutUsed: (item: FinderShortcutItem) => void;
  loadFinderData: (options?: LoadFinderDataOptions) => Promise<void>;
  loadProjectRuntimes: () => Promise<void>;
  handleOpenFinderEntry: (entry: NavigationEntry) => Promise<boolean>;
  handleStartRuntime: (
    projectKey: string,
    debugProfileKey?: string,
    envOverrides?: Record<string, string>,
  ) => Promise<void>;
  handleStopRuntime: (projectKey: string) => Promise<void>;
  handleAdoptRuntime: (projectKey: string, debugProfileKey?: string) => Promise<void>;
  handleRunBuild: (projectKey: string) => Promise<void>;
  handleStopBuild: (projectKey: string) => Promise<void>;
  handleOpenBuildOutput: (projectKey: string) => Promise<void>;
  handleFocusRuntime: (projectKey: string, debugProfileKey?: string) => Promise<void>;
  handleOpenProjectDirectory: (projectKey: string) => Promise<void>;
  handleReplayProjectWorkflow: (
    replay: WorkflowProjectReplay,
    options?: ProjectWorkflowReplayOptions,
  ) => Promise<void>;
};

export function useProjectsModule({
  enabled,
  activeProjectWorkspaceKey,
  setBusy,
  setError,
  workflowBroadcastRules,
  emitWorkflowSignals,
  recordActivity,
  updateActivity,
  syncActivities,
}: UseProjectsModuleOptions): ProjectsModuleState {
  const [finderType, setFinderType] = useState<FinderType>("项目");
  const [finderCategory, setFinderCategory] = useState("全部");
  const [finderQuery, setFinderQuery] = useState("");
  const [runtimeEntries, setRuntimeEntries] = useState<ProjectRuntimeEntry[]>([]);
  const [navigationData, setNavigationData] = useState<NavigationData | null>(null);
  const [preferences, setPreferences] = useState<FinderPreferences>(
    EMPTY_FINDER_PREFERENCES,
  );
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(getInitialDocumentHidden);
  const navigationConfigSourceId = useMemo(
    () => configSourceIdForWorkspace(activeProjectWorkspaceKey),
    [activeProjectWorkspaceKey],
  );
  const finderDataLoadedAtRef = useRef(0);
  const finderDataSourceIdRef = useRef("");
  const finderDataPromiseRef = useRef<Promise<void> | null>(null);
  const activeRuntimeKeysRef = useRef<string[]>([]);
  const activeBuildActivityIdsRef = useRef<Record<string, string>>({});
  const projectWorkflowReplayOptionsRef = useRef<ProjectWorkflowReplayOptions | null>(null);
  const previousRuntimeStatesRef = useRef<
    Map<string, { statusKey: string; buildStatusKey: string }>
  >(new Map());
  const runtimeItems = useMemo(
    () => normalizeRuntimeEntries(runtimeEntries),
    [runtimeEntries],
  );
  const navigationCategories = useMemo(
    () => (Array.isArray(navigationData?.categories) ? navigationData.categories : []),
    [navigationData?.categories],
  );

  const favoriteProjectKeySet = useMemo(
    () => new Set(preferences.favoriteProjectKeys),
    [preferences.favoriteProjectKeys],
  );
  const favoriteShortcutKeySet = useMemo(
    () => new Set(preferences.favoriteShortcutKeys),
    [preferences.favoriteShortcutKeys],
  );

  const shortcutEntries = useMemo(() => {
    if (finderType === "项目") {
      return [] as FinderShortcutItem[];
    }

    return navigationCategories.flatMap((category) =>
      category.entries
        .filter((entry) => entry_matches_finder_type(entry, finderType))
        .map((entry) => ({
          categoryTitle: category.title,
          categoryLabel: category.shortLabel,
          entry,
        })),
    );
  }, [finderType, navigationCategories]);

  const finderTypeCounts = useMemo(
    () => ({
      项目: runtimeItems.length,
      网站: navigationCategories.reduce(
        (count, category) =>
          count + category.entries.filter((entry) => entry.kind === "url").length,
        0,
      ),
      目录: navigationCategories.reduce(
        (count, category) =>
          count + category.entries.filter((entry) => entry.kind === "directory").length,
        0,
      ),
      工具: navigationCategories.reduce(
        (count, category) =>
          count +
          category.entries.filter(
            (entry) => entry.kind === "app" || entry.kind === "script" || entry.kind === "tool",
          ).length,
        0,
      ),
    }),
    [navigationCategories, runtimeItems],
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

  const filteredRuntimeEntries = useMemo(() => {
    const keyword = finderQuery.trim().toLowerCase();
    const filtered = runtimeItems.filter((item) => {
      if (finderType !== "项目") {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return buildRuntimeHaystack(item).includes(keyword);
    });
    return [...filtered].sort(
      (a, b) =>
        compareMarkedFirst(
          favoriteProjectKeySet.has(a.key),
          favoriteProjectKeySet.has(b.key),
        ),
    );
  }, [
    favoriteProjectKeySet,
    finderQuery,
    finderType,
    runtimeItems,
  ]);

  const filteredShortcutEntries = useMemo(() => {
    const keyword = finderQuery.trim().toLowerCase();
    const filtered = shortcutEntries.filter((item) => {
      const shortcutKey = buildFinderShortcutKey(item);
      if (finderType === "项目") {
        return false;
      }
      if (finderCategory !== "全部" && finderCategory && item.categoryTitle !== finderCategory) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return buildShortcutHaystack(item).includes(keyword);
    });
    return [...filtered].sort(
      (a, b) => {
        const aKey = buildFinderShortcutKey(a);
        const bKey = buildFinderShortcutKey(b);
        return (
          compareMarkedFirst(
            favoriteShortcutKeySet.has(aKey),
            favoriteShortcutKeySet.has(bKey),
          )
        );
      },
    );
  }, [
    favoriteShortcutKeySet,
    finderCategory,
    finderQuery,
    finderType,
    shortcutEntries,
  ]);

  const activeRuntimeKeys = useMemo(
    () =>
      runtimeItems
        .filter((item) => item.canStop || item.canAdopt || item.canStopBuild)
        .map((item) => item.key),
    [runtimeItems],
  );
  const activeRuntimePollingKey = useMemo(
    () => activeRuntimeKeys.join("|"),
    [activeRuntimeKeys],
  );

  function replaceRuntimeEntry(projectKey: string, updated: ProjectRuntimeEntry) {
    setRuntimeEntries((current) =>
      normalizeRuntimeEntries(current).map((item) =>
        item.key === projectKey ? updated : item,
      ),
    );
  }

  function mergeRuntimeEntries(updatedEntries: unknown) {
    const normalizedEntries = normalizeRuntimeEntries(updatedEntries);
    if (normalizedEntries.length === 0) {
      return;
    }

    const updatedEntriesMap = new Map(
      normalizedEntries.map((item) => [item.key, item] as const),
    );
    setRuntimeEntries((current) =>
      normalizeRuntimeEntries(current).map(
        (item) => updatedEntriesMap.get(item.key) ?? item,
      ),
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
    return runtimeItems.find((item) => item.key === projectKey);
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

  function projectWorkflowChainFields(fallbackStepLabel: string) {
    const options = projectWorkflowReplayOptionsRef.current;
    if (!options?.chainId) {
      return {};
    }
    return {
      chainId: options.chainId,
      parentId: options.parentId ?? null,
      stepLabel: options.stepLabel || fallbackStepLabel,
      chainLabel: "联动链路",
    };
  }

  async function emitProjectWorkflowSignals(
    replay: WorkflowProjectReplay,
    summary?: string,
    chain?: {
      sourceActivityId?: string;
      sourceStepLabel?: string;
      chainId?: string | null;
    },
  ) {
    try {
      const nextChainId =
        chain?.chainId || (chain?.sourceActivityId ? `chain:${chain.sourceActivityId}` : "");
      const signals = createProjectWorkflowSignals({
        broadcasts: workflowBroadcastRules,
        replay,
        summary,
        chainId: nextChainId,
        parentActivityId: chain?.sourceActivityId,
        sourceStepLabel: chain?.sourceStepLabel,
      });
      if (signals.length > 0 && chain?.sourceActivityId && nextChainId) {
        updateActivity?.(chain.sourceActivityId, {
          chainId: nextChainId,
          stepLabel: chain.sourceStepLabel || projectWorkflowActionLabel(replay.action),
          chainLabel: "联动链路",
        });
      }
      await emitWorkflowSignals(signals);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function runtimeActivityTarget(projectKey: string) {
    return {
      page: "projectManagement" as const,
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
    if (entry.path) {
      return localPathResource("打开目录", entry.path);
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

  function setProjectDebugProfile(projectKey: string, profileKey: string) {
    const normalizedProjectKey = projectKey.trim();
    if (!normalizedProjectKey) {
      return;
    }
    const normalizedProfileKey = profileKey.trim();
    updatePreferences((current) => {
      const nextProfiles = { ...current.debugProfileKeysByProject };
      if (normalizedProfileKey) {
        nextProfiles[normalizedProjectKey] = normalizedProfileKey;
      } else {
        delete nextProfiles[normalizedProjectKey];
      }
      return {
        ...current,
        debugProfileKeysByProject: nextProfiles,
      };
    });
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
        const items = await invoke<unknown>("list_selected_project_runtimes", {
          projects: options.projectKeys,
        });
        mergeRuntimeEntries(items);
      } else {
        const items = await invoke<unknown>("list_project_runtimes");
        setRuntimeEntries(normalizeRuntimeEntries(items));
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
      const data = await invoke<unknown>("load_page_navigation", {
        sourceId: navigationConfigSourceId,
      });
      setNavigationData(normalizeNavigationData(data));
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
      finderDataSourceIdRef.current === navigationConfigSourceId &&
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
        finderDataSourceIdRef.current = navigationConfigSourceId;
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

  useEffect(() => {
    finderDataLoadedAtRef.current = 0;
    finderDataPromiseRef.current = null;
    if (enabled) {
      void loadFinderData({ force: true });
    }
  }, [enabled, navigationConfigSourceId]);

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
    }));
  }, [
    enabled,
    finderCategory,
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
        const completionPatch: ActivityPatch = {
          status,
          summary: runtimeActivitySummary(item.buildStatusLabel, item.buildDetail),
          detail: item.buildLogPath || item.buildOutputDir || null,
          projectName: item.name,
          target: runtimeActivityTarget(item.key),
          resource: buildResource(item),
        };
        if (activityId) {
          updateActivity?.(activityId, completionPatch);
          delete activeBuildActivityIdsRef.current[item.key];
        } else if (
          !syncActivities?.(
            {
              kind: "build",
              status: "running",
              projectKey: item.key,
            },
            completionPatch,
          )
        ) {
          recordActivity?.({
            kind: "build",
            status,
            title: "构建完成",
            summary: runtimeActivitySummary(item.buildStatusLabel, item.buildDetail),
            detail: item.buildLogPath || item.buildOutputDir || null,
            executionKey: projectActivityExecutionKey("project.build.run", item.key),
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
          executionKey: projectActivityExecutionKey(
            "project.runtime.exit",
            item.key,
            item.statusKey,
          ),
          projectKey: item.key,
          projectName: item.name,
          target: runtimeActivityTarget(item.key),
          resource: localPathResource("打开日志", item.logPath),
        });
      }
    }

    previousRuntimeStatesRef.current = new Map(
      runtimeItems.map((item) => [
        item.key,
        {
          statusKey: item.statusKey,
          buildStatusKey: item.buildStatusKey,
        },
      ]),
    );
  }, [enabled, recordActivity, runtimeItems, syncActivities, updateActivity]);

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
        detail:
          entry.note ||
          entry.url ||
          entry.bundleId ||
          entry.path ||
          entry.script ||
          entry.toolKey ||
          null,
        executionKey: shortcutActivityExecutionKey(entry),
        ...projectWorkflowChainFields("打开入口"),
        resource: shortcutResource(entry),
        target: {
          page: "resources",
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

  async function handleStartRuntime(
    projectKey: string,
    debugProfileKey?: string,
    envOverrides?: Record<string, string>,
  ) {
    if (!projectRuntimePreferencesAllowStart(enabled, preferencesHydrated)) {
      return;
    }
    const launchPlan = buildProjectRuntimeLaunchPlan({
      projectKey,
      runtimeEntry: runtimeItems.find((item) => item.key === projectKey),
      requestedDebugProfileKey:
        debugProfileKey ?? preferences.debugProfileKeysByProject[projectKey],
      envOverrides,
    });
    const selectedDebugProfile = launchPlan.selection.key;
    const { hasExplicitEnvOverrides } = launchPlan;
    const normalizedEnvOverrides = launchPlan.startArgs.envOverrides ?? {};
    const envOverrideCount = Object.keys(normalizedEnvOverrides).length;

    setBusy("正在检查并启动 dev 服务");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "启动 dev 服务",
        summary: hasExplicitEnvOverrides && envOverrideCount
          ? `${runtimeProjectName(projectKey)} · 临时参数 ${envOverrideCount} 项`
          : runtimeProjectName(projectKey),
        executionKey: projectActivityExecutionKey(
          "project.runtime.start",
          projectKey,
          hasExplicitEnvOverrides
            ? `${selectedDebugProfile || "default"}:${stableActivityJson(
                normalizedEnvOverrides,
              )}`
            : selectedDebugProfile || "default",
        ),
        ...projectWorkflowChainFields("启动 dev 服务"),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const preflight = await invoke<ProjectRuntimePreflightResponse>(
        "preflight_project_runtime",
        launchPlan.preflightArgs,
      );
      if (projectRuntimePreflightBlocksStart(preflight.statusKey)) {
        const detail = preflight.summary.trim() || preflight.statusLabel || "启动前检查未通过";
        if (activityId) {
          updateActivity?.(activityId, {
            status: "failed",
            title: "启动前检查未通过",
            summary: detail,
          });
        }
        setError(detail);
        return;
      }
      const updated = await invoke<ProjectRuntimeEntry>("start_project_runtime", {
        ...launchPlan.startArgs,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.runtime.start"),
        runtimeStartActivitySummary(updated),
        {
          sourceActivityId: activityId,
          sourceStepLabel: "启动 dev 服务",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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
        executionKey: projectActivityExecutionKey("project.runtime.stop", projectKey),
        ...projectWorkflowChainFields("停止 dev 服务"),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("stop_project_runtime", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      syncActivities?.(
        { kind: "runtime", status: "failed", projectKey },
        { acknowledgedAt: new Date().toISOString() },
      );
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.runtime.stop"),
        runtimeActivitySummary(updated.statusLabel, updated.detail),
        {
          sourceActivityId: activityId,
          sourceStepLabel: "停止 dev 服务",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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

  async function handleAdoptRuntime(projectKey: string, debugProfileKey?: string) {
    if (!enabled) {
      return;
    }
    const runtime = runtimeItems.find((item) => item.key === projectKey);
    if (!runtime?.canAdopt || !runtime.pid) {
      setError("未检测到可认领的外部 dev 服务");
      return;
    }
    const selectedDebugProfile =
      debugProfileKey ?? preferences.debugProfileKeysByProject[projectKey];
    setBusy("正在认领外部 dev 服务");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "认领外部 dev 服务",
        summary: runtimeProjectName(projectKey),
        executionKey: projectActivityExecutionKey("project.runtime.adopt", projectKey),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("adopt_project_runtime", {
        project: projectKey,
        pid: runtime.pid,
        debugProfile: selectedDebugProfile || null,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      if (activityId) {
        updateActivity?.(activityId, {
          status: "success",
          summary: `${updated.name} 已由 Runtime Daemon 托管`,
          detail: updated.detail,
          projectName: updated.name,
        });
      }
    } catch (reason) {
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: "外部 dev 服务认领失败",
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

    setBusy("正在执行构建任务");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "build",
        status: "running",
        title: "执行构建",
        summary: runtimeProjectName(projectKey),
        executionKey: projectActivityExecutionKey("project.build.run", projectKey),
        ...projectWorkflowChainFields("执行构建"),
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
        {
          sourceActivityId: activityId,
          sourceStepLabel: "执行构建",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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

    setBusy("正在中止构建任务");
    setError("");
    const runningBuildActivityId = activeBuildActivityIdsRef.current[projectKey] || "";
    const activityId =
      recordActivity?.({
        kind: "build",
        status: "running",
        title: "中止构建",
        summary: runtimeProjectName(projectKey),
        executionKey: projectActivityExecutionKey("project.build.stop", projectKey),
        ...projectWorkflowChainFields("中止构建"),
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
        {
          sourceActivityId: activityId,
          sourceStepLabel: "中止构建",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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
        executionKey: projectActivityExecutionKey("project.build.openOutput", projectKey),
        ...projectWorkflowChainFields("打开构建产物"),
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
        {
          sourceActivityId: activityId,
          sourceStepLabel: "打开构建产物",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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

  async function handleFocusRuntime(projectKey: string, debugProfileKey?: string) {
    if (!enabled) {
      return;
    }

    const selectedDebugProfile = resolveProjectRuntimeDebugProfile(
      runtimeItems.find((item) => item.key === projectKey),
      debugProfileKey ?? preferences.debugProfileKeysByProject[projectKey],
    ).key;
    setBusy("正在唤起运行中的项目");
    setError("");
    const activityId =
      recordActivity?.({
        kind: "runtime",
        status: "running",
        title: "唤起项目",
        summary: selectedDebugProfile
          ? `${runtimeProjectName(projectKey)} · ${selectedDebugProfile}`
          : runtimeProjectName(projectKey),
        executionKey: projectActivityExecutionKey(
          "project.runtime.focus",
          projectKey,
          selectedDebugProfile || "default",
        ),
        ...projectWorkflowChainFields("唤起项目"),
        projectKey,
        projectName: runtimeProjectName(projectKey),
        target: runtimeActivityTarget(projectKey),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("focus_project_runtime", {
        project: projectKey,
        debugProfile: selectedDebugProfile || null,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.runtime.focus"),
        runtimeActivitySummary(updated.statusLabel, updated.detail),
        {
          sourceActivityId: activityId,
          sourceStepLabel: "唤起项目",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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

    const entry = runtimeItems.find((item) => item.key === projectKey);
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
        executionKey: projectActivityExecutionKey("project.openDirectory", projectKey),
        ...projectWorkflowChainFields("打开项目目录"),
        projectKey,
        projectName: entry.name,
        target: runtimeActivityTarget(projectKey),
        resource: localPathResource("打开项目目录", path),
      }) || "";
    try {
      const updated = await invoke<ProjectRuntimeEntry>("open_project_directory", {
        project: projectKey,
      });
      replaceRuntimeEntry(projectKey, updated);
      touchProjectUsage(projectKey);
      await emitProjectWorkflowSignals(
        projectWorkflowReplay(projectKey, "project.openDirectory"),
        "项目目录已打开",
        {
          sourceActivityId: activityId,
          sourceStepLabel: "打开项目目录",
          chainId: projectWorkflowReplayOptionsRef.current?.chainId,
        },
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

  async function handleReplayProjectWorkflow(
    replay: WorkflowProjectReplay,
    options: ProjectWorkflowReplayOptions = {},
  ) {
    const previousOptions = projectWorkflowReplayOptionsRef.current;
    projectWorkflowReplayOptionsRef.current = options.chainId
      ? {
          ...options,
          stepLabel: options.stepLabel || projectWorkflowActionLabel(replay.action),
        }
      : null;
    try {
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
    } finally {
      projectWorkflowReplayOptionsRef.current = previousOptions;
    }
  }

  return {
    finderTypeOptions: FINDER_TYPE_OPTIONS,
    finderType,
    finderTypeCounts,
    setFinderType,
    finderCategories,
    finderCategory,
    finderCategoryCounts,
    setFinderCategory,
    finderQuery,
    setFinderQuery,
    runtimeEntries: runtimeItems,
    filteredRuntimeEntries,
    shortcutEntries,
    filteredShortcutEntries,
    favoriteProjectKeys: preferences.favoriteProjectKeys,
    recentProjectKeys: preferences.recentProjectKeys,
    favoriteShortcutKeys: preferences.favoriteShortcutKeys,
    recentShortcutKeys: preferences.recentShortcutKeys,
    selectedDebugProfileKeys: preferences.debugProfileKeysByProject,
    preferencesHydrated,
    toggleProjectFavorite,
    toggleShortcutFavorite,
    setProjectDebugProfile,
    markShortcutUsed,
    loadFinderData,
    loadProjectRuntimes,
    handleOpenFinderEntry,
    handleStartRuntime,
    handleStopRuntime,
    handleAdoptRuntime,
    handleRunBuild,
    handleStopBuild,
    handleOpenBuildOutput,
    handleFocusRuntime,
    handleOpenProjectDirectory,
    handleReplayProjectWorkflow,
  };
}
