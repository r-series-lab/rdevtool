import type { ActivityEntry } from "./activityCenter";
import { getStoredJson, setStoredJson } from "./storage";

export type ConfigActivityVisibility = "actionable" | "all";

export type ActivityPreferences = {
  version: 1;
  configActivityVisibility: ConfigActivityVisibility;
};

export const DEFAULT_ACTIVITY_PREFERENCES: ActivityPreferences = {
  version: 1,
  configActivityVisibility: "actionable",
};

const STORAGE_NAMESPACE = "app";
const STORAGE_KEY = "activity-preferences";

function isConfigActivityVisibility(value: unknown): value is ConfigActivityVisibility {
  return value === "actionable" || value === "all";
}

export function normalizeActivityPreferences(value: unknown): ActivityPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_ACTIVITY_PREFERENCES;
  }
  const candidate = value as Partial<ActivityPreferences>;
  return {
    version: 1,
    configActivityVisibility: isConfigActivityVisibility(
      candidate.configActivityVisibility,
    )
      ? candidate.configActivityVisibility
      : "actionable",
  };
}

export function activityVisibleWithPreferences(
  item: Pick<ActivityEntry, "kind" | "status" | "acknowledgedAt">,
  preferences: ActivityPreferences,
) {
  if (item.kind !== "config" || preferences.configActivityVisibility === "all") {
    return true;
  }
  return (
    !item.acknowledgedAt &&
    (item.status === "running" || item.status === "failed")
  );
}

type ActivityPreferencesListener = (preferences: ActivityPreferences) => void;

let currentPreferences = DEFAULT_ACTIVITY_PREFERENCES;
let loadPromise: Promise<ActivityPreferences> | null = null;
let loaded = false;
const listeners = new Set<ActivityPreferencesListener>();

function publish(preferences: ActivityPreferences) {
  currentPreferences = preferences;
  for (const listener of listeners) {
    listener(preferences);
  }
}

export function getCurrentActivityPreferences() {
  return currentPreferences;
}

export function subscribeActivityPreferences(listener: ActivityPreferencesListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadActivityPreferences() {
  if (loaded) {
    return Promise.resolve(currentPreferences);
  }
  if (!loadPromise) {
    loadPromise = getStoredJson<ActivityPreferences>(STORAGE_NAMESPACE, STORAGE_KEY)
      .then((value) => {
        const preferences = normalizeActivityPreferences(value);
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

export async function saveActivityPreferences(next: ActivityPreferences) {
  const preferences = normalizeActivityPreferences(next);
  loaded = true;
  publish(preferences);
  await setStoredJson(STORAGE_NAMESPACE, STORAGE_KEY, preferences);
  return preferences;
}
