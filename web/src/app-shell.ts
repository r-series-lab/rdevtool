import { APP_MODULES, type AppModuleKey } from "./app-modules";

export type PageKey = AppModuleKey;

export const ALL_PAGE_KEYS: PageKey[] = [
  "overview",
  "knowledge",
  "projectManagement",
  "resources",
  "proxy",
  "build",
  "merge",
];

export const DEFAULT_VISIBLE_PAGE_KEYS: PageKey[] = [
  "overview",
  "knowledge",
  "projectManagement",
  "resources",
  "proxy",
];

export const NAV_ITEMS: Array<{ key: PageKey; label: string; shortLabel: string }> =
  ALL_PAGE_KEYS.flatMap((key) => {
    const module = APP_MODULES.find((item) => item.key === key);
    return module
      ? [
          {
          key,
          label: module.label,
          shortLabel: module.shortLabel,
        },
        ]
      : [];
  });

export const NAV_ITEM_MAP = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.key, item]),
) as Record<PageKey, (typeof NAV_ITEMS)[number]>;

export function normalizePageKey(value: unknown): PageKey | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value === "navigation") {
    return "resources";
  }
  if (value === "projects") {
    return "resources";
  }
  if (value === "deploy") {
    return "build";
  }
  if (value === "health") {
    return "knowledge";
  }
  return ALL_PAGE_KEYS.includes(value as PageKey) ? (value as PageKey) : null;
}

export function normalizeEnabledPages(values: unknown): PageKey[] {
  const rawValues = Array.isArray(values) ? values : [];
  const pages: PageKey[] = [];

  for (const value of rawValues) {
    const page = normalizePageKey(value);
    if (page && !pages.includes(page)) {
      pages.push(page);
    }
  }

  return pages.length > 0 ? pages : [...DEFAULT_VISIBLE_PAGE_KEYS];
}
