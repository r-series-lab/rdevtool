import { useEffect } from "react";
import { buildStartupTasks } from "../app-modules";
import type { AppModuleKey } from "../app-modules";

type UseAppBootstrapOptions = {
  appShell: {
    hydratePersistedState: () => Promise<{
      preferredProject: string;
      enabledPages: Parameters<typeof buildStartupTasks>[0];
      initialPage: AppModuleKey;
    }>;
  };
  modules: Parameters<typeof buildStartupTasks>[3];
  setError: (value: string) => void;
};

export function useAppBootstrap({ appShell, modules, setError }: UseAppBootstrapOptions) {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { preferredProject, enabledPages, initialPage } = await appShell.hydratePersistedState();
        if (cancelled) {
          return;
        }

        await Promise.all(
          buildStartupTasks(enabledPages, initialPage, preferredProject, modules),
        );
      } catch (reason) {
        if (!cancelled) {
          setError(String(reason));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
