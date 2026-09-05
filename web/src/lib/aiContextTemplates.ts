import { getStoredJson, setStoredJson } from "./storage";

export type AiContextOptions = {
  includeProjects: boolean;
  includeEntries: boolean;
  includeDirectories: boolean;
  includeActions: boolean;
  includeBuildHistory: boolean;
  includeMergeHistory: boolean;
  itemLimit: number;
  historyLimit: number;
};

export type AiContextPreset = {
  key: string;
  label: string;
  options: AiContextOptions;
  custom?: boolean;
};

export const AI_CONTEXT_STORAGE_NAMESPACE = "aiContext";
const LEGACY_AI_CONTEXT_STORAGE_NAMESPACE = "overview";
export const AI_CONTEXT_PRESETS_STORAGE_KEY = "aiContextPresets";
export const AI_CONTEXT_PRESET_EVENT = "rdevtool:ai-context-presets";

export const DEFAULT_AI_CONTEXT_OPTIONS: AiContextOptions = {
  includeProjects: true,
  includeEntries: true,
  includeDirectories: true,
  includeActions: true,
  includeBuildHistory: true,
  includeMergeHistory: true,
  itemLimit: 12,
  historyLimit: 8,
};

export const BUILTIN_AI_CONTEXT_PRESETS: AiContextPreset[] = [
  {
    key: "full",
    label: "完整",
    options: DEFAULT_AI_CONTEXT_OPTIONS,
  },
  {
    key: "develop",
    label: "开发",
    options: {
      includeProjects: true,
      includeEntries: true,
      includeDirectories: true,
      includeActions: true,
      includeBuildHistory: false,
      includeMergeHistory: false,
      itemLimit: 12,
      historyLimit: 4,
    },
  },
  {
    key: "debug",
    label: "排障",
    options: {
      includeProjects: true,
      includeEntries: false,
      includeDirectories: true,
      includeActions: true,
      includeBuildHistory: true,
      includeMergeHistory: true,
      itemLimit: 8,
      historyLimit: 12,
    },
  },
  {
    key: "release",
    label: "发布",
    options: {
      includeProjects: true,
      includeEntries: false,
      includeDirectories: true,
      includeActions: true,
      includeBuildHistory: true,
      includeMergeHistory: false,
      itemLimit: 8,
      historyLimit: 12,
    },
  },
  {
    key: "review",
    label: "审查",
    options: {
      includeProjects: true,
      includeEntries: false,
      includeDirectories: true,
      includeActions: true,
      includeBuildHistory: true,
      includeMergeHistory: true,
      itemLimit: 12,
      historyLimit: 8,
    },
  },
];

export const AI_CONTEXT_LIMIT_OPTIONS = [4, 8, 12, 20];

export const AI_CONTEXT_SCOPE_OPTIONS: Array<{
  key: keyof Pick<
    AiContextOptions,
    | "includeProjects"
    | "includeEntries"
    | "includeDirectories"
    | "includeActions"
    | "includeBuildHistory"
    | "includeMergeHistory"
  >;
  label: string;
}> = [
  { key: "includeProjects", label: "项目" },
  { key: "includeEntries", label: "入口" },
  { key: "includeDirectories", label: "目录" },
  { key: "includeActions", label: "动作" },
  { key: "includeBuildHistory", label: "构建" },
  { key: "includeMergeHistory", label: "分支" },
];

function normalizePresetSlug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^custom-+/, "")
      .replace(/^-+|-+$/g, "") || "preset"
  );
}

export function normalizeAiContextPresetKey(value: string) {
  return `custom-${normalizePresetSlug(value)}`;
}

export function normalizeAiContextOptions(
  options: Partial<AiContextOptions> = {},
): AiContextOptions {
  const itemLimit = Number(options.itemLimit);
  const historyLimit = Number(options.historyLimit);
  const normalizedItemLimit = AI_CONTEXT_LIMIT_OPTIONS.includes(itemLimit)
    ? itemLimit
    : DEFAULT_AI_CONTEXT_OPTIONS.itemLimit;
  const normalizedHistoryLimit = AI_CONTEXT_LIMIT_OPTIONS.includes(historyLimit)
    ? historyLimit
    : DEFAULT_AI_CONTEXT_OPTIONS.historyLimit;
  return {
    ...DEFAULT_AI_CONTEXT_OPTIONS,
    ...options,
    itemLimit: normalizedItemLimit,
    historyLimit: normalizedHistoryLimit,
  };
}

export function isSameAiContextOptions(left: AiContextOptions, right: AiContextOptions) {
  return (
    left.includeProjects === right.includeProjects &&
    left.includeEntries === right.includeEntries &&
    left.includeDirectories === right.includeDirectories &&
    left.includeActions === right.includeActions &&
    left.includeBuildHistory === right.includeBuildHistory &&
    left.includeMergeHistory === right.includeMergeHistory &&
    left.itemLimit === right.itemLimit &&
    left.historyLimit === right.historyLimit
  );
}

export function normalizeAiContextPreset(candidate: unknown): AiContextPreset | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const source = candidate as Partial<AiContextPreset>;
  const label = typeof source.label === "string" ? source.label.trim() : "";
  if (!label) {
    return null;
  }
  const key = normalizeAiContextPresetKey(typeof source.key === "string" ? source.key : label);
  const builtInKeys = new Set(BUILTIN_AI_CONTEXT_PRESETS.map((preset) => preset.key));
  if (builtInKeys.has(key)) {
    return null;
  }
  return {
    key,
    label,
    options: normalizeAiContextOptions(source.options ?? {}),
    custom: true,
  };
}

export function mergeAiContextPresets(stored: unknown): AiContextPreset[] {
  const custom = Array.isArray(stored)
    ? stored
        .map(normalizeAiContextPreset)
        .filter((preset): preset is AiContextPreset => Boolean(preset))
    : [];
  const byKey = new Map<string, AiContextPreset>();
  for (const preset of custom) {
    byKey.set(preset.key, preset);
  }
  return [...BUILTIN_AI_CONTEXT_PRESETS, ...Array.from(byKey.values())];
}

export async function loadAiContextPresets() {
  const stored = await getStoredJson<unknown>(
    AI_CONTEXT_STORAGE_NAMESPACE,
    AI_CONTEXT_PRESETS_STORAGE_KEY,
  ).catch(() => null);
  if (stored != null) {
    return mergeAiContextPresets(stored);
  }
  const legacy = await getStoredJson<unknown>(
    LEGACY_AI_CONTEXT_STORAGE_NAMESPACE,
    AI_CONTEXT_PRESETS_STORAGE_KEY,
  ).catch(() => null);
  const merged = mergeAiContextPresets(legacy);
  await setStoredJson(
    AI_CONTEXT_STORAGE_NAMESPACE,
    AI_CONTEXT_PRESETS_STORAGE_KEY,
    merged.filter((preset) => preset.custom),
  ).catch(() => undefined);
  return merged;
}

export async function persistAiContextCustomPresets(nextPresets: AiContextPreset[]) {
  const customPresets = nextPresets
    .filter((preset) => preset.custom)
    .map(normalizeAiContextPreset)
    .filter((preset): preset is AiContextPreset => Boolean(preset));
  const merged = mergeAiContextPresets(customPresets);
  await setStoredJson(
    AI_CONTEXT_STORAGE_NAMESPACE,
    AI_CONTEXT_PRESETS_STORAGE_KEY,
    customPresets,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AI_CONTEXT_PRESET_EVENT, {
        detail: { presets: customPresets },
      }),
    );
  }
  return merged;
}

export function subscribeAiContextPresets(
  onChange: (presets: AiContextPreset[]) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handlePresetsChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ presets?: AiContextPreset[] }>).detail;
    onChange(mergeAiContextPresets(detail?.presets ?? []));
  };
  window.addEventListener(AI_CONTEXT_PRESET_EVENT, handlePresetsChanged);
  return () => window.removeEventListener(AI_CONTEXT_PRESET_EVENT, handlePresetsChanged);
}
