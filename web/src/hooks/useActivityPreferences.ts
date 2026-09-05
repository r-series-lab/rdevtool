import { useEffect, useState } from "react";
import {
  getCurrentActivityPreferences,
  loadActivityPreferences,
  saveActivityPreferences,
  subscribeActivityPreferences,
  type ConfigActivityVisibility,
} from "../lib/activityPreferences";

export function useActivityPreferences() {
  const [preferences, setPreferences] = useState(getCurrentActivityPreferences);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeActivityPreferences(setPreferences);
    void loadActivityPreferences().finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  return {
    preferences,
    loading,
    setConfigActivityVisibility: (visibility: ConfigActivityVisibility) =>
      saveActivityPreferences({
        ...preferences,
        configActivityVisibility: visibility,
      }),
  };
}
