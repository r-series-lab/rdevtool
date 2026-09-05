import { useEffect, useState } from "react";
import {
  confirmationPreferencesWithMode,
  confirmationPreferencesWithOverride,
  getCurrentConfirmationPreferences,
  loadConfirmationPreferences,
  saveConfirmationPreferences,
  subscribeConfirmationPreferences,
  type ConfirmationMode,
  type ConfirmationPreferenceKey,
} from "../lib/confirmationPreferences";

export function useConfirmationPreferences() {
  const [preferences, setPreferences] = useState(getCurrentConfirmationPreferences);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeConfirmationPreferences(setPreferences);
    void loadConfirmationPreferences().finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  return {
    preferences,
    loading,
    setMode: (mode: Exclude<ConfirmationMode, "custom">) =>
      saveConfirmationPreferences(confirmationPreferencesWithMode(mode)),
    setCategoryEnabled: (key: ConfirmationPreferenceKey, enabled: boolean) =>
      saveConfirmationPreferences(
        confirmationPreferencesWithOverride(preferences, key, enabled),
      ),
    reset: () => saveConfirmationPreferences(confirmationPreferencesWithMode("balanced")),
  };
}
