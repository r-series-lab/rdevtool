import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type NavigationEntry = {
  name: string;
  kind: string;
  targetLabel: string;
  url?: string | null;
  browser?: string | null;
  browserProfile?: string | null;
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

const NAVIGATION_TYPE_OPTIONS = ["全部", "网页", "应用", "脚本"] as const;
type NavigationTypeFilter = (typeof NAVIGATION_TYPE_OPTIONS)[number];

function matchesNavigationType(entry: NavigationEntry, filter: NavigationTypeFilter) {
  switch (filter) {
    case "网页":
      return entry.kind === "url";
    case "应用":
      return entry.kind === "app";
    case "脚本":
      return entry.kind === "script";
    default:
      return true;
  }
}

type UseNavigationModuleOptions = {
  enabled: boolean;
  setError: (value: string) => void;
};

export type NavigationModuleState = {
  navigationCategories: NavigationCategory[];
  navigationCategory: string;
  navigationTypeOptions: NavigationTypeFilter[];
  navigationTypeFilter: NavigationTypeFilter;
  navigationTypeCounts: Record<string, number>;
  navigationCategoryCounts: Record<string, number>;
  navigationQuery: string;
  selectedNavigationEntries: NavigationEntry[];
  filteredNavigationResults: Array<{
    category: NavigationCategory;
    entry: NavigationEntry;
  }>;
  navigationPreferredCategory?: string | null;
  setNavigationCategory: (value: string) => void;
  setNavigationTypeFilter: (value: string) => void;
  setNavigationQuery: (value: string) => void;
  loadNavigation: () => Promise<void>;
  handleOpenNavigation: (entry: NavigationEntry) => Promise<void>;
};

export function useNavigationModule({
  enabled,
  setError,
}: UseNavigationModuleOptions): NavigationModuleState {
  const [navigationData, setNavigationData] = useState<NavigationData | null>(null);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [navigationCategory, setNavigationCategory] = useState("");
  const [navigationTypeFilter, setNavigationTypeFilter] =
    useState<NavigationTypeFilter>("全部");

  const allNavigationCategories = navigationData?.categories ?? [];
  const navigationTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      全部: 0,
      网页: 0,
      应用: 0,
      脚本: 0,
    };
    for (const category of allNavigationCategories) {
      for (const entry of category.entries) {
        counts["全部"] += 1;
        if (entry.kind === "url") {
          counts["网页"] += 1;
        } else if (entry.kind === "app") {
          counts["应用"] += 1;
        } else if (entry.kind === "script") {
          counts["脚本"] += 1;
        }
      }
    }
    return counts;
  }, [allNavigationCategories]);
  const navigationCategories = useMemo(
    () =>
      allNavigationCategories
        .map((category) => ({
          ...category,
          entries: category.entries.filter((entry) =>
            matchesNavigationType(entry, navigationTypeFilter),
          ),
        }))
        .filter((category) => category.entries.length > 0),
    [allNavigationCategories, navigationTypeFilter],
  );
  const navigationCategoryCounts = useMemo(
    () =>
      Object.fromEntries(
        navigationCategories.map((category) => [category.title, category.entries.length]),
      ),
    [navigationCategories],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (navigationCategories.some((item) => item.title === navigationCategory)) {
      return;
    }

    const fallbackCategory =
      navigationCategories.find(
        (item) => item.title === navigationData?.preferredCategory,
      )?.title ??
      navigationCategories[0]?.title ??
      "";

    if (fallbackCategory !== navigationCategory) {
      setNavigationCategory(fallbackCategory);
    }
  }, [
    enabled,
    navigationCategories,
    navigationCategory,
    navigationData?.preferredCategory,
  ]);

  const selectedNavigationEntries = useMemo(
    () =>
      (navigationCategories.find((item) => item.title === navigationCategory)?.entries ?? []).filter((entry) =>
        matchesNavigationType(entry, navigationTypeFilter),
      ),
    [navigationCategories, navigationCategory, navigationTypeFilter],
  );

  const filteredNavigationResults = useMemo(() => {
    const keyword = navigationQuery.trim().toLowerCase();
    if (!keyword) {
      return [];
    }

    return navigationCategories.flatMap((category) =>
      category.entries
        .filter((entry) => {
          const haystack =
            `${category.title} ${entry.kind} ${entry.name} ${entry.targetLabel} ${entry.note ?? ""}`.toLowerCase();
          return (
            matchesNavigationType(entry, navigationTypeFilter) &&
            haystack.includes(keyword)
          );
        })
        .slice(0, 99)
        .map((entry) => ({ category, entry })),
    );
  }, [navigationCategories, navigationQuery, navigationTypeFilter]);

  function updateNavigationTypeFilter(value: string) {
    if (NAVIGATION_TYPE_OPTIONS.includes(value as NavigationTypeFilter)) {
      setNavigationTypeFilter(value as NavigationTypeFilter);
    }
  }

  async function loadNavigation() {
    if (!enabled) {
      setNavigationData(null);
      setNavigationCategory("");
      return;
    }
    setError("");
    try {
      const data = await invoke<NavigationData>("load_page_navigation");
      setNavigationData(data);
      setNavigationCategory(
        (current) => current || data.preferredCategory || data.categories[0]?.title || "",
      );
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function handleOpenNavigation(entry: NavigationEntry) {
    if (!enabled) {
      return;
    }
    setError("");
    try {
      await invoke("open_page_navigation_entry", { entry });
    } catch (reason) {
      setError(String(reason));
    }
  }

  return {
    navigationCategories,
    navigationCategory,
    navigationTypeOptions: [...NAVIGATION_TYPE_OPTIONS],
    navigationTypeFilter,
    navigationTypeCounts,
    navigationCategoryCounts,
    navigationQuery,
    selectedNavigationEntries,
    filteredNavigationResults,
    navigationPreferredCategory: navigationData?.preferredCategory,
    setNavigationCategory,
    setNavigationTypeFilter: updateNavigationTypeFilter,
    setNavigationQuery,
    loadNavigation,
    handleOpenNavigation,
  };
}
