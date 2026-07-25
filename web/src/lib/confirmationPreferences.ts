import { getStoredJson, setStoredJson } from "./storage";

export type ConfirmationMode = "strict" | "balanced" | "fast" | "custom";

export type ConfirmationPreferenceKey =
  | "branch.mutate"
  | "deploy.run"
  | "destructive.delete"
  | "configuration.discard"
  | "build.run"
  | "runtime.change"
  | "network.change"
  | "configuration.import";

export type ConfirmationPreferenceDefinition = {
  key: ConfirmationPreferenceKey;
  label: string;
  description: string;
  required: boolean;
  balancedDefault: boolean;
};

export type ConfirmationPreferences = {
  version: 1;
  mode: ConfirmationMode;
  overrides: Partial<Record<ConfirmationPreferenceKey, boolean>>;
};

export const CONFIRMATION_PREFERENCE_DEFINITIONS: ConfirmationPreferenceDefinition[] = [
  {
    key: "branch.mutate",
    label: "分支合并与重放",
    description: "合并、批量合并及分支任务重放",
    required: true,
    balancedDefault: true,
  },
  {
    key: "deploy.run",
    label: "部署与发布",
    description: "触发远端部署、发布或历史部署重放",
    required: true,
    balancedDefault: true,
  },
  {
    key: "destructive.delete",
    label: "删除与移除",
    description: "删除工作区、代理规则或配置源",
    required: true,
    balancedDefault: true,
  },
  {
    key: "configuration.discard",
    label: "放弃未保存改动",
    description: "关闭配置时丢弃尚未保存的内容",
    required: true,
    balancedDefault: true,
  },
  {
    key: "build.run",
    label: "构建与构建重放",
    description: "本地构建、打包及构建记录重放",
    required: false,
    balancedDefault: true,
  },
  {
    key: "runtime.change",
    label: "运行环境启停",
    description: "启动或停止项目运行环境",
    required: false,
    balancedDefault: true,
  },
  {
    key: "network.change",
    label: "代理与联调启停",
    description: "启动或停止代理服务、联调链",
    required: false,
    balancedDefault: false,
  },
  {
    key: "configuration.import",
    label: "导入外部配置",
    description: "导入代理包或其他外部配置",
    required: false,
    balancedDefault: true,
  },
];

export const DEFAULT_CONFIRMATION_PREFERENCES: ConfirmationPreferences = {
  version: 1,
  mode: "balanced",
  overrides: {},
};

const STORAGE_NAMESPACE = "app";
const STORAGE_KEY = "confirmation-preferences";
const definitionByKey = new Map(
  CONFIRMATION_PREFERENCE_DEFINITIONS.map((definition) => [definition.key, definition]),
);
const preferenceKeys = new Set(definitionByKey.keys());

function isConfirmationMode(value: unknown): value is ConfirmationMode {
  return value === "strict" || value === "balanced" || value === "fast" || value === "custom";
}

export function normalizeConfirmationPreferences(value: unknown): ConfirmationPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIRMATION_PREFERENCES;
  }
  const candidate = value as Partial<ConfirmationPreferences>;
  const overrides: ConfirmationPreferences["overrides"] = {};
  if (candidate.overrides && typeof candidate.overrides === "object") {
    for (const [key, enabled] of Object.entries(candidate.overrides)) {
      if (preferenceKeys.has(key as ConfirmationPreferenceKey) && typeof enabled === "boolean") {
        overrides[key as ConfirmationPreferenceKey] = enabled;
      }
    }
  }
  return {
    version: 1,
    mode: isConfirmationMode(candidate.mode) ? candidate.mode : "balanced",
    overrides,
  };
}

export function confirmationEnabled(
  preferences: ConfirmationPreferences,
  key: ConfirmationPreferenceKey,
) {
  const definition = definitionByKey.get(key);
  if (!definition || definition.required) {
    return true;
  }
  if (preferences.mode === "strict") {
    return true;
  }
  if (preferences.mode === "fast") {
    return false;
  }
  if (preferences.mode === "custom") {
    return preferences.overrides[key] ?? definition.balancedDefault;
  }
  return definition.balancedDefault;
}

export function confirmationCanBeDisabled(key: ConfirmationPreferenceKey) {
  return definitionByKey.get(key)?.required === false;
}

export function confirmationPreferencesWithMode(
  mode: Exclude<ConfirmationMode, "custom">,
): ConfirmationPreferences {
  return { version: 1, mode, overrides: {} };
}

export function confirmationPreferencesWithOverride(
  preferences: ConfirmationPreferences,
  key: ConfirmationPreferenceKey,
  enabled: boolean,
): ConfirmationPreferences {
  const definition = definitionByKey.get(key);
  if (!definition || definition.required) {
    return preferences;
  }
  const overrides: ConfirmationPreferences["overrides"] = {};
  for (const item of CONFIRMATION_PREFERENCE_DEFINITIONS) {
    if (!item.required) {
      overrides[item.key] = item.key === key ? enabled : confirmationEnabled(preferences, item.key);
    }
  }
  return { version: 1, mode: "custom", overrides };
}

export function confirmationPreferenceKeyForTrayAction(
  kind: string,
): ConfirmationPreferenceKey | null {
  switch (kind.trim()) {
    case "branch.replay":
      return "branch.mutate";
    case "deploy.replay":
      return "deploy.run";
    case "build.replay":
    case "project.build.run":
      return "build.run";
    case "project.runtime.start":
    case "project.runtime.stop":
      return "runtime.change";
    case "proxy.start":
    case "proxy.stop":
    case "link.run":
    case "link.stop":
      return "network.change";
    default:
      return null;
  }
}

type ConfirmationPreferencesListener = (preferences: ConfirmationPreferences) => void;

let currentPreferences = DEFAULT_CONFIRMATION_PREFERENCES;
let loadPromise: Promise<ConfirmationPreferences> | null = null;
let loaded = false;
const listeners = new Set<ConfirmationPreferencesListener>();

function publish(preferences: ConfirmationPreferences) {
  currentPreferences = preferences;
  for (const listener of listeners) {
    listener(preferences);
  }
}

export function getCurrentConfirmationPreferences() {
  return currentPreferences;
}

export function subscribeConfirmationPreferences(listener: ConfirmationPreferencesListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadConfirmationPreferences() {
  if (loaded) {
    return Promise.resolve(currentPreferences);
  }
  if (!loadPromise) {
    loadPromise = getStoredJson<ConfirmationPreferences>(STORAGE_NAMESPACE, STORAGE_KEY)
      .then((value) => {
        const preferences = normalizeConfirmationPreferences(value);
        publish(preferences);
        loaded = true;
        return preferences;
      })
      .catch(() => {
        loaded = true;
        return currentPreferences;
      });
  }
  return loadPromise;
}

export async function saveConfirmationPreferences(next: ConfirmationPreferences) {
  const preferences = normalizeConfirmationPreferences(next);
  loaded = true;
  publish(preferences);
  await setStoredJson(STORAGE_NAMESPACE, STORAGE_KEY, preferences);
  return preferences;
}
