import { useEffect, useMemo, useRef } from "react";
import { buildModuleLoadTask, type AppModuleKey } from "../app-modules";
import type { ModuleRuntimeContext } from "../app-modules.types";

type UsePageModuleRuntimeOptions = {
  page: AppModuleKey;
  enabledPages: AppModuleKey[];
  modules: ModuleRuntimeContext;
  setError: (value: string) => void;
};

export function usePageModuleRuntime({
  page,
  enabledPages,
  modules,
  setError,
}: UsePageModuleRuntimeOptions) {
  const enabledPagesKey = useMemo(() => enabledPages.join("|"), [enabledPages]);
  const lastRunKeyRef = useRef("");

  useEffect(() => {
    const runKey = `${enabledPagesKey}:${page}`;
    if (lastRunKeyRef.current === runKey) {
      return;
    }
    lastRunKeyRef.current = runKey;

    let cancelled = false;

    void (async () => {
      try {
        const task = buildModuleLoadTask(page, enabledPages, modules);
        if (!task) {
          return;
        }
        await task;
      } catch (reason) {
        if (!cancelled) {
          setError(String(reason));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabledPages, enabledPagesKey, modules, page, setError]);
}
