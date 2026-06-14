import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceAppPreferences } from "../app-types";
import {
  NAV_ITEM_MAP,
  normalizeEnabledPages,
  normalizePageKey,
  type PageKey,
} from "../app-shell";
import { getStoredJson, setStoredJson } from "../lib/storage";
import type { AppStyleMode } from "../theme";
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

function normalizeStyleMode(value: unknown): AppStyleMode | null {
  return value === "light" || value === "mono" ? value : null;
}

type UseAppShellOptions = {
  setError: (value: string) => void;
};

export function useAppShell({ setError }: UseAppShellOptions) {
  const [page, setPage] = useState<PageKey>("projects");
  const [enabledPages, setEnabledPages] = useState<PageKey[]>(normalizeEnabledPages(undefined));
  const [defaultPage, setDefaultPage] = useState<PageKey>("projects");
  const [styleMode, setStyleMode] = useState<AppStyleMode>("light");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [lastProjectKey, setLastProjectKey] = useState("");
  const [branchCache, setBranchCache] = useState<BranchCacheMap>({});
  const [projectSelections, setProjectSelections] = useState<ProjectSelectionMap>({});
  const [storageHydrated, setStorageHydrated] = useState(false);

  const visibleNavItems = useMemo(
    () => enabledPages.map((key) => NAV_ITEM_MAP[key]).filter(Boolean),
    [enabledPages],
  );

  const selectedProjectInfo = useMemo(
    () => projects.find((item) => item.key === selectedProject) ?? null,
    [projects, selectedProject],
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.style = styleMode;
  }, [styleMode]);

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

  async function loadProjects(preferredProjectKey = lastProjectKey, replaceSelection = false) {
    setError("");
    try {
      const items = await invoke<ProjectSummary[]>("list_projects");
      setProjects(items);
      if (items.length === 0) {
        setSelectedProject("");
        return;
      }

      if (
        replaceSelection ||
        !selectedProject ||
        !items.some((item) => item.key === selectedProject)
      ) {
        const preferred =
          (preferredProjectKey &&
            items.find((item) => item.key === preferredProjectKey)?.key) ||
          "";
        setSelectedProject(preferred || items[0].key);
      }
    } catch (reason) {
      setError(String(reason));
    }
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
      workspacePreferences,
    ] = await Promise.all([
      getStoredJson<Record<string, unknown>>(APP_STORAGE_NAMESPACE, BRANCH_CACHE_STORAGE_KEY),
      getStoredJson<Record<string, unknown>>(APP_STORAGE_NAMESPACE, PROJECT_SELECTION_STORAGE_KEY),
      getStoredJson<string>(APP_STORAGE_NAMESPACE, LAST_PROJECT_STORAGE_KEY),
      getStoredJson<string>(APP_STORAGE_NAMESPACE, STYLE_MODE_STORAGE_KEY),
      invoke<WorkspaceAppPreferences>("get_workspace_app_preferences").catch(() => null),
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

    const nextStyleMode =
      normalizeStyleMode(workspacePreferences?.styleMode) ??
      normalizeStyleMode(storedStyleMode);
    if (nextStyleMode) {
      setStyleMode(nextStyleMode);
    }

    const nextEnabledPages = normalizeEnabledPages(workspacePreferences?.enabledPages);
    setEnabledPages(nextEnabledPages);
    const nextDefaultPage = normalizePageKey(workspacePreferences?.defaultPage);
    const fallbackPage = nextEnabledPages[0] ?? "projects";
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
    styleMode,
    setStyleMode,
    projects,
    selectedProject,
    setSelectedProject,
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
