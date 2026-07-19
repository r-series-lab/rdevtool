import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppExitRuntimePolicy,
  CreateProjectWorkspacePayload,
  ProjectManagementViewKey,
  ProjectWorkspaceState,
  ProjectWorkspaceSummary,
  WorkspaceAppPreferences,
} from "../app-types";
import {
  ALL_PAGE_KEYS,
  DEFAULT_VISIBLE_PAGE_KEYS,
  NAV_ITEM_MAP,
  normalizeEnabledPages,
  normalizePageKey,
  type PageKey,
} from "../app-shell";
import { getStoredJson, setStoredJson } from "../lib/storage";
import {
  EMPTY_WORKSPACE_REFRESH_PLAN,
  FULL_WORKSPACE_REFRESH_PLAN,
  hasWorkspaceRefreshWork,
  mergeWorkspaceRefreshPlans,
  projectKeyAfterRefresh,
  sameWorkspaceValue,
  WORKSPACE_STATE_CHANGED_EVENT,
  workspaceRefreshPlanForEvent,
  type WorkspaceRefreshPlan,
  type WorkspaceStateChangedPayload,
} from "../lib/workspaceSync";
import { disposeTauriListener } from "../lib/tauriEvents";
import type { AppResolvedStyleMode, AppStyleMode } from "../theme";
import {
  normalizeBranchOptions,
  loadLegacyBranchCache,
  loadLegacyProjectSelections,
  normalizeProjectSelectionEntry,
  type BranchCacheEntry,
  type BranchCacheMap,
  type ProjectSelectionMap,
  type ProjectSummary,
} from "./useBranchContext";
const APP_STORAGE_NAMESPACE = "app";
const BRANCH_CACHE_STORAGE_KEY = "branch-cache";
const PROJECT_SELECTION_STORAGE_KEY = "project-selection";
const LAST_PROJECT_STORAGE_KEY = "last-project";
const STYLE_MODE_STORAGE_KEY = "style-mode";
const PROJECT_MENU_SPLIT_MIGRATION_KEY = "project-menu-split-v1";
const PROJECT_MENU_SECONDARY_NAV_MIGRATION_KEY = "project-menu-secondary-nav-v1";
const SYSTEM_STYLE_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const EXTERNAL_WORKSPACE_FOCUS_REFRESH_INTERVAL_MS = 1200;

function normalizeExitRuntimePolicy(value: unknown): AppExitRuntimePolicy {
  return value === "keep" || value === "stop" ? value : "ask";
}

function normalizeStyleMode(value: unknown): AppStyleMode | null {
  return value === "light" || value === "mono" || value === "system" ? value : null;
}

function getSystemStyleMode(): AppResolvedStyleMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(SYSTEM_STYLE_MEDIA_QUERY).matches ? "mono" : "light";
}

function migrateProjectMenuSplit(enabledPages: PageKey[]): PageKey[] {
  const pageSet = new Set<PageKey>(enabledPages);
  pageSet.add("projectManagement");
  pageSet.add("resources");
  return normalizeEnabledPages(ALL_PAGE_KEYS.filter((page) => pageSet.has(page)));
}

function migrateProjectMenuSecondaryNav(enabledPages: PageKey[]): PageKey[] {
  const pageSet = new Set<PageKey>(enabledPages);
  pageSet.add("overview");
  pageSet.add("projectManagement");
  pageSet.add("resources");
  pageSet.add("proxy");
  return normalizePrimaryMenuPages([...pageSet]);
}

function normalizePrimaryMenuPages(enabledPages: PageKey[]): PageKey[] {
  const pageSet = new Set<PageKey>(enabledPages);
  return normalizeEnabledPages(
    DEFAULT_VISIBLE_PAGE_KEYS.filter((page) => pageSet.has(page)),
  );
}

function projectManagementViewForLegacyPage(page: PageKey | null): ProjectManagementViewKey {
  if (page === "build") {
    return "build";
  }
  if (page === "merge") {
    return "git";
  }
  return "projects";
}

function workspacePreferencesSignature(
  styleMode: AppStyleMode,
  defaultPage: PageKey,
  enabledPages: PageKey[],
): string {
  return JSON.stringify({ styleMode, defaultPage, enabledPages });
}

type UseAppShellOptions = {
  setError: (value: string) => void;
};

export function useAppShell({ setError }: UseAppShellOptions) {
  const [page, setPage] = useState<PageKey>("overview");
  const [enabledPages, setEnabledPages] = useState<PageKey[]>(normalizeEnabledPages(undefined));
  const [defaultPage, setDefaultPage] = useState<PageKey>("overview");
  const [projectManagementView, setProjectManagementView] =
    useState<ProjectManagementViewKey>("projects");
  const [styleMode, setStyleMode] = useState<AppStyleMode>("system");
  const [exitRuntimePolicy, setExitRuntimePolicy] =
    useState<AppExitRuntimePolicy>("ask");
  const [systemStyleMode, setSystemStyleMode] =
    useState<AppResolvedStyleMode>(() => getSystemStyleMode());
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectWorkspaces, setProjectWorkspaces] = useState<ProjectWorkspaceSummary[]>([]);
  const [projectWorkspacesDir, setProjectWorkspacesDir] = useState("");
  const [activeProjectWorkspaceKey, setActiveProjectWorkspaceKey] = useState("system");
  const [selectedProject, setSelectedProject] = useState("");
  const [lastProjectKey, setLastProjectKey] = useState("");
  const [branchCache, setBranchCache] = useState<BranchCacheMap>({});
  const [projectSelections, setProjectSelections] = useState<ProjectSelectionMap>({});
  const [storageHydrated, setStorageHydrated] = useState(false);
  const lastProjectKeyRef = useRef(lastProjectKey);
  const activeProjectWorkspaceKeyRef = useRef(activeProjectWorkspaceKey);
  const workspacePreferencesRef = useRef({ styleMode, defaultPage, enabledPages });
  const externalWorkspacePreferencesSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    lastProjectKeyRef.current = lastProjectKey;
  }, [lastProjectKey]);

  useEffect(() => {
    activeProjectWorkspaceKeyRef.current = activeProjectWorkspaceKey;
  }, [activeProjectWorkspaceKey]);

  useEffect(() => {
    workspacePreferencesRef.current = { styleMode, defaultPage, enabledPages };
  }, [defaultPage, enabledPages, styleMode]);

  const visibleNavItems = useMemo(
    () => enabledPages.map((key) => NAV_ITEM_MAP[key]).filter(Boolean),
    [enabledPages],
  );

  const selectedProjectInfo = useMemo(
    () => projects.find((item) => item.key === selectedProject) ?? null,
    [projects, selectedProject],
  );

  const effectiveStyleMode: AppResolvedStyleMode =
    styleMode === "system" ? systemStyleMode : styleMode;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia(SYSTEM_STYLE_MEDIA_QUERY);
    const updateSystemStyleMode = () => {
      setSystemStyleMode(mediaQuery.matches ? "mono" : "light");
    };
    updateSystemStyleMode();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateSystemStyleMode);
      return () => mediaQuery.removeEventListener("change", updateSystemStyleMode);
    }
    mediaQuery.addListener(updateSystemStyleMode);
    return () => mediaQuery.removeListener(updateSystemStyleMode);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.style = effectiveStyleMode;
    document.documentElement.dataset.stylePreference = styleMode;
  }, [effectiveStyleMode, styleMode]);

  useEffect(() => {
    if (visibleNavItems.length === 0) {
      return;
    }
    if (!visibleNavItems.some((item) => item.key === page)) {
      setPage(visibleNavItems[0].key);
    }
    if (!enabledPages.includes(defaultPage)) {
      setDefaultPage(visibleNavItems[0].key);
    }
  }, [defaultPage, enabledPages, page, visibleNavItems]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }
    const signature = workspacePreferencesSignature(styleMode, defaultPage, enabledPages);
    if (externalWorkspacePreferencesSignatureRef.current) {
      if (externalWorkspacePreferencesSignatureRef.current === signature) {
        externalWorkspacePreferencesSignatureRef.current = null;
      }
      return;
    }
    void invoke("save_workspace_app_preferences", {
      preferences: {
        styleMode,
        defaultPage,
        enabledPages,
      },
    }).catch((reason) => {
      setError(String(reason));
    });
  }, [defaultPage, enabledPages, setError, storageHydrated, styleMode]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }
    void invoke("save_app_exit_runtime_policy", {
      policy: exitRuntimePolicy,
    }).catch((reason) => {
      setError(String(reason));
    });
  }, [exitRuntimePolicy, setError, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }
    void setStoredJson(APP_STORAGE_NAMESPACE, BRANCH_CACHE_STORAGE_KEY, branchCache);
  }, [branchCache, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }
    void setStoredJson(APP_STORAGE_NAMESPACE, PROJECT_SELECTION_STORAGE_KEY, projectSelections);
  }, [projectSelections, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated || !selectedProject) {
      return;
    }
    setLastProjectKey(selectedProject);
    void setStoredJson(APP_STORAGE_NAMESPACE, LAST_PROJECT_STORAGE_KEY, selectedProject);
  }, [selectedProject, storageHydrated]);

  const applyProjectList = useCallback(
    (items: ProjectSummary[], preferredProjectKey = "", replaceSelection = false) => {
      setProjects((current) =>
        sameWorkspaceValue(current, items) ? current : items,
      );
      setSelectedProject((current) =>
        projectKeyAfterRefresh(
          items,
          current,
          preferredProjectKey || lastProjectKeyRef.current,
          replaceSelection,
        ),
      );
    },
    [],
  );

  const loadProjects = useCallback(
    async (preferredProjectKey = lastProjectKeyRef.current, replaceSelection = false) => {
      setError("");
      try {
        const items = await invoke<ProjectSummary[]>("list_projects");
        applyProjectList(items, preferredProjectKey, replaceSelection);
      } catch (reason) {
        setError(String(reason));
      }
    },
    [applyProjectList, setError],
  );

  const applyProjectWorkspaceState = useCallback((state: ProjectWorkspaceState | null) => {
    if (!state) {
      return;
    }
    setProjectWorkspaces((current) =>
      sameWorkspaceValue(current, state.workspaces) ? current : state.workspaces,
    );
    setProjectWorkspacesDir((current) =>
      current === state.workspacesDir ? current : state.workspacesDir,
    );
    setActiveProjectWorkspaceKey((current) => {
      const next = state.activeKey || "system";
      activeProjectWorkspaceKeyRef.current = next;
      return current === next ? current : next;
    });
  }, []);

  const applyExternalWorkspacePreferences = useCallback(
    (preferences: WorkspaceAppPreferences | null) => {
      if (!preferences) {
        return;
      }
      const nextStyleMode = normalizeStyleMode(preferences.styleMode) ?? "system";
      const nextEnabledPages = normalizePrimaryMenuPages(
        normalizeEnabledPages(preferences.enabledPages),
      );
      const rawDefaultPage = normalizePageKey(preferences.defaultPage);
      const normalizedDefaultPage =
        rawDefaultPage === "build" || rawDefaultPage === "merge"
          ? "projectManagement"
          : rawDefaultPage;
      const nextDefaultPage =
        normalizedDefaultPage && nextEnabledPages.includes(normalizedDefaultPage)
          ? normalizedDefaultPage
          : nextEnabledPages[0] ?? "overview";
      const current = workspacePreferencesRef.current;
      if (
        current.styleMode === nextStyleMode &&
        current.defaultPage === nextDefaultPage &&
        sameWorkspaceValue(current.enabledPages, nextEnabledPages)
      ) {
        return;
      }

      externalWorkspacePreferencesSignatureRef.current = workspacePreferencesSignature(
        nextStyleMode,
        nextDefaultPage,
        nextEnabledPages,
      );
      workspacePreferencesRef.current = {
        styleMode: nextStyleMode,
        defaultPage: nextDefaultPage,
        enabledPages: nextEnabledPages,
      };
      setStyleMode(nextStyleMode);
      setDefaultPage(nextDefaultPage);
      setEnabledPages(nextEnabledPages);
    },
    [],
  );

  const loadProjectWorkspaces = useCallback(async () => {
    const state = await invoke<ProjectWorkspaceState>("get_project_workspaces");
    applyProjectWorkspaceState(state);
    return state;
  }, [applyProjectWorkspaceState]);

  const reloadWorkspaceConfiguration = useCallback(async () => {
    const [preferences, state, items] = await Promise.all([
      invoke<WorkspaceAppPreferences>("get_workspace_app_preferences"),
      invoke<ProjectWorkspaceState>("get_project_workspaces"),
      invoke<ProjectSummary[]>("list_projects"),
    ]);
    applyExternalWorkspacePreferences(preferences);
    applyProjectWorkspaceState(state);
    applyProjectList(items);
    return { preferences, state, projects: items };
  }, [
    applyExternalWorkspacePreferences,
    applyProjectList,
    applyProjectWorkspaceState,
  ]);

  useEffect(() => {
    let refreshInFlight = false;
    let refreshQueued = false;
    let pendingRefreshPlan: WorkspaceRefreshPlan = EMPTY_WORKSPACE_REFRESH_PLAN;
    let refreshTimer: number | undefined;
    let refreshTimerDueAt = 0;
    let lastRefreshAt = 0;
    let disposed = false;
    let unlistenWorkspaceChanges: (() => void) | undefined;

    async function refreshExternalWorkspaceChanges() {
      if (
        !storageHydrated ||
        refreshInFlight ||
        (typeof document !== "undefined" && document.visibilityState !== "visible")
      ) {
        return;
      }
      if (!hasWorkspaceRefreshWork(pendingRefreshPlan)) {
        return;
      }
      const refreshPlan = pendingRefreshPlan;
      pendingRefreshPlan = EMPTY_WORKSPACE_REFRESH_PLAN;
      refreshInFlight = true;
      try {
        const [preferences, state, items] = await Promise.all([
          refreshPlan.preferences
            ? invoke<WorkspaceAppPreferences>("get_workspace_app_preferences")
            : Promise.resolve(null),
          refreshPlan.workspaceState
            ? invoke<ProjectWorkspaceState>("get_project_workspaces")
            : Promise.resolve(null),
          refreshPlan.projects
            ? invoke<ProjectSummary[]>("list_projects")
            : Promise.resolve(null),
        ]);
        applyExternalWorkspacePreferences(preferences);
        applyProjectWorkspaceState(state);
        if (items) {
          applyProjectList(items);
        }
        lastRefreshAt = Date.now();
      } catch (reason) {
        setError(`刷新工作区状态失败：${String(reason)}`);
      } finally {
        refreshInFlight = false;
        if (refreshQueued || hasWorkspaceRefreshWork(pendingRefreshPlan)) {
          refreshQueued = false;
          scheduleExternalWorkspaceRefresh(EMPTY_WORKSPACE_REFRESH_PLAN, 0);
        }
      }
    }

    function scheduleExternalWorkspaceRefresh(
      refreshPlan: WorkspaceRefreshPlan,
      minimumDelayMs?: number,
    ) {
      if (!storageHydrated) {
        return;
      }
      pendingRefreshPlan = mergeWorkspaceRefreshPlans(pendingRefreshPlan, refreshPlan);
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      const delay =
        minimumDelayMs ??
        Math.max(
          0,
          EXTERNAL_WORKSPACE_FOCUS_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAt),
        );
      const dueAt = Date.now() + delay;
      if (refreshTimer !== undefined) {
        if (dueAt >= refreshTimerDueAt) {
          return;
        }
        window.clearTimeout(refreshTimer);
      }
      refreshTimerDueAt = dueAt;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        refreshTimerDueAt = 0;
        void refreshExternalWorkspaceChanges();
      }, delay);
    }

    function handleWindowFocus() {
      scheduleExternalWorkspaceRefresh(FULL_WORKSPACE_REFRESH_PLAN);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        scheduleExternalWorkspaceRefresh(FULL_WORKSPACE_REFRESH_PLAN);
      }
    }

    void listen<WorkspaceStateChangedPayload>(WORKSPACE_STATE_CHANGED_EVENT, (event) => {
      scheduleExternalWorkspaceRefresh(
        workspaceRefreshPlanForEvent(
          event.payload,
          activeProjectWorkspaceKeyRef.current,
        ),
        0,
      );
    })
      .then((unlisten) => {
        if (disposed) {
          disposeTauriListener(unlisten);
          return;
        }
        unlistenWorkspaceChanges = unlisten;
      })
      .catch((reason) => {
        if (!disposed) {
          setError(`监听工作区配置变化失败：${String(reason)}`);
        }
      });

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      disposeTauriListener(unlistenWorkspaceChanges);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [
    applyExternalWorkspacePreferences,
    applyProjectList,
    applyProjectWorkspaceState,
    setError,
    storageHydrated,
  ]);

  async function setActiveProjectWorkspace(workspaceKey: string) {
    const state = await invoke<ProjectWorkspaceState>("set_active_project_workspace", {
      workspaceKey,
    });
    applyProjectWorkspaceState(state);
    await loadProjects("", true);
  }

  async function createProjectWorkspace(payload: CreateProjectWorkspacePayload) {
    const state = await invoke<ProjectWorkspaceState>("create_project_workspace_config", {
      payload,
    });
    applyProjectWorkspaceState(state);
    await loadProjects("", true);
    return state;
  }

  async function hydratePersistedState(): Promise<{
    preferredProject: string;
    enabledPages: PageKey[];
    initialPage: PageKey;
  }> {
    const [
      storedBranchCache,
      storedProjectSelections,
      storedLastProject,
      storedStyleMode,
      projectMenuSplitMigrated,
      projectMenuSecondaryNavMigrated,
      workspacePreferences,
      projectWorkspaceState,
      storedExitRuntimePolicy,
    ] = await Promise.all([
      getStoredJson<Record<string, unknown>>(APP_STORAGE_NAMESPACE, BRANCH_CACHE_STORAGE_KEY),
      getStoredJson<Record<string, unknown>>(APP_STORAGE_NAMESPACE, PROJECT_SELECTION_STORAGE_KEY),
      getStoredJson<string>(APP_STORAGE_NAMESPACE, LAST_PROJECT_STORAGE_KEY),
      getStoredJson<string>(APP_STORAGE_NAMESPACE, STYLE_MODE_STORAGE_KEY),
      getStoredJson<boolean>(APP_STORAGE_NAMESPACE, PROJECT_MENU_SPLIT_MIGRATION_KEY),
      getStoredJson<boolean>(APP_STORAGE_NAMESPACE, PROJECT_MENU_SECONDARY_NAV_MIGRATION_KEY),
      invoke<WorkspaceAppPreferences>("get_workspace_app_preferences").catch(() => null),
      invoke<ProjectWorkspaceState>("get_project_workspaces").catch(() => null),
      invoke<string>("get_app_exit_runtime_policy").catch(() => "ask"),
    ]);

    const nextBranchCache = storedBranchCache
      ? Object.fromEntries(
          Object.entries(storedBranchCache)
            .map(([project, value]) => {
              if (!value || typeof value !== "object") {
                return null;
              }
              const branchesValue = (value as { branches?: unknown }).branches;
              const syncedAtValue = (value as { syncedAt?: unknown }).syncedAt;
              const branches = Array.isArray(branchesValue)
                ? normalizeBranchOptions(branchesValue)
                : [];
              if (branches.length === 0) {
                return null;
              }
              return [
                project,
                {
                  branches,
                  syncedAt:
                    typeof syncedAtValue === "number" && Number.isFinite(syncedAtValue)
                      ? syncedAtValue
                      : 0,
                },
              ];
            })
            .filter((item): item is [string, BranchCacheEntry] => Boolean(item)),
        )
      : loadLegacyBranchCache();

    const nextProjectSelections: ProjectSelectionMap = {};
    const rawSelections = storedProjectSelections ?? loadLegacyProjectSelections();
    for (const [project, value] of Object.entries(rawSelections)) {
      const normalized = normalizeProjectSelectionEntry(value);
      if (normalized) {
        nextProjectSelections[project] = normalized;
      }
    }

    setBranchCache(nextBranchCache);
    setProjectSelections(nextProjectSelections);
    setLastProjectKey(typeof storedLastProject === "string" ? storedLastProject : "");
    applyProjectWorkspaceState(projectWorkspaceState);
    setExitRuntimePolicy(normalizeExitRuntimePolicy(storedExitRuntimePolicy));

    const nextStyleMode =
      normalizeStyleMode(workspacePreferences?.styleMode) ??
      normalizeStyleMode(storedStyleMode);
    if (nextStyleMode) {
      setStyleMode(nextStyleMode);
    }

    const normalizedEnabledPages = normalizeEnabledPages(workspacePreferences?.enabledPages);
    const splitEnabledPages = projectMenuSplitMigrated
      ? normalizedEnabledPages
      : migrateProjectMenuSplit(normalizedEnabledPages);
    const nextEnabledPages = projectMenuSecondaryNavMigrated
      ? normalizePrimaryMenuPages(splitEnabledPages)
      : migrateProjectMenuSecondaryNav(splitEnabledPages);
    setEnabledPages(nextEnabledPages);
    const rawDefaultPage = normalizePageKey(workspacePreferences?.defaultPage);
    const nextProjectManagementView = projectManagementViewForLegacyPage(rawDefaultPage);
    setProjectManagementView(nextProjectManagementView);
    const nextDefaultPage =
      rawDefaultPage === "build" || rawDefaultPage === "merge"
        ? "projectManagement"
        : rawDefaultPage;
    const fallbackPage = nextEnabledPages[0] ?? "overview";
    const initialPage =
      nextDefaultPage && nextEnabledPages.includes(nextDefaultPage)
        ? nextDefaultPage
        : fallbackPage;
    setDefaultPage(initialPage);
    setPage(initialPage);
    setStorageHydrated(true);

    if (!storedBranchCache && Object.keys(nextBranchCache).length > 0) {
      await setStoredJson(APP_STORAGE_NAMESPACE, BRANCH_CACHE_STORAGE_KEY, nextBranchCache);
    }
    if (!storedProjectSelections && Object.keys(nextProjectSelections).length > 0) {
      await setStoredJson(
        APP_STORAGE_NAMESPACE,
        PROJECT_SELECTION_STORAGE_KEY,
        nextProjectSelections,
      );
    }
    if (!projectMenuSplitMigrated) {
      await setStoredJson(APP_STORAGE_NAMESPACE, PROJECT_MENU_SPLIT_MIGRATION_KEY, true);
    }
    if (!projectMenuSecondaryNavMigrated) {
      await setStoredJson(
        APP_STORAGE_NAMESPACE,
        PROJECT_MENU_SECONDARY_NAV_MIGRATION_KEY,
        true,
      );
    }

    return {
      preferredProject: typeof storedLastProject === "string" ? storedLastProject : "",
      enabledPages: nextEnabledPages,
      initialPage,
    };
  }

  return {
    page,
    setPage,
    enabledPages,
    setEnabledPages,
    defaultPage,
    setDefaultPage,
    projectManagementView,
    setProjectManagementView,
    styleMode,
    effectiveStyleMode,
    setStyleMode,
    exitRuntimePolicy,
    setExitRuntimePolicy,
    projects,
    selectedProject,
    setSelectedProject,
    projectWorkspaces,
    projectWorkspacesDir,
    activeProjectWorkspaceKey,
    loadProjectWorkspaces,
    reloadWorkspaceConfiguration,
    setActiveProjectWorkspace,
    createProjectWorkspace,
    branchCache,
    setBranchCache,
    projectSelections,
    setProjectSelections,
    visibleNavItems,
    selectedProjectInfo,
    hydratePersistedState,
    loadProjects,
  };
}
