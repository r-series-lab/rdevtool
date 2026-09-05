import { useCallback, useEffect, useState } from "react";
import { getStoredJson, setStoredJson } from "../lib/storage";
import {
  WORKSPACE_TYPE_OPTIONS,
  WORKSPACE_TYPE_OPTIONS_EVENT,
  WORKSPACE_TYPE_STORAGE_KEY,
  WORKSPACE_TYPE_STORAGE_NAMESPACE,
  createWorkspaceTypeOption,
  isCustomWorkspaceTypeOption,
  mergeWorkspaceTypeOptions,
  type WorkspaceTypeOption,
} from "../lib/workspaceTypes";

type WorkspaceTypeOptionsEvent = CustomEvent<{ options: WorkspaceTypeOption[] }>;

function storedCustomOptions(options: WorkspaceTypeOption[]) {
  return options.filter(isCustomWorkspaceTypeOption);
}

export function useWorkspaceTypeOptions() {
  const [options, setOptions] = useState<WorkspaceTypeOption[]>(WORKSPACE_TYPE_OPTIONS);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const stored = await getStoredJson<WorkspaceTypeOption[]>(
        WORKSPACE_TYPE_STORAGE_NAMESPACE,
        WORKSPACE_TYPE_STORAGE_KEY,
      ).catch(() => null);
      if (!cancelled) {
        setOptions(mergeWorkspaceTypeOptions(stored ?? []));
      }
    }
    void loadOptions();

    const handleOptionsChanged = (event: Event) => {
      const detail = (event as WorkspaceTypeOptionsEvent).detail;
      if (detail?.options) {
        setOptions(mergeWorkspaceTypeOptions(detail.options));
      }
    };
    window.addEventListener(WORKSPACE_TYPE_OPTIONS_EVENT, handleOptionsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_TYPE_OPTIONS_EVENT, handleOptionsChanged);
    };
  }, []);

  const persistOptions = useCallback(async (nextOptions: WorkspaceTypeOption[]) => {
    const merged = mergeWorkspaceTypeOptions(nextOptions);
    setOptions(merged);
    await setStoredJson(
      WORKSPACE_TYPE_STORAGE_NAMESPACE,
      WORKSPACE_TYPE_STORAGE_KEY,
      storedCustomOptions(merged),
    );
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_TYPE_OPTIONS_EVENT, {
        detail: { options: merged },
      }),
    );
    return merged;
  }, []);

  const addWorkspaceType = useCallback(
    async (label: string) => {
      const option = createWorkspaceTypeOption(label, options);
      await persistOptions([...options, option]);
      return option;
    },
    [options, persistOptions],
  );

  const removeWorkspaceType = useCallback(
    async (key: string) => {
      await persistOptions(options.filter((option) => option.key !== key));
    },
    [options, persistOptions],
  );

  return {
    options,
    customOptions: options.filter(isCustomWorkspaceTypeOption),
    addWorkspaceType,
    removeWorkspaceType,
  };
}
