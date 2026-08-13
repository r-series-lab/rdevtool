import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ACTIVE_SESSIONS_CHANGED_EVENT,
  activeSessionEventAffectsWorkspace,
  createActiveSessionRefreshScheduler,
  type ActiveSessionRefreshScheduler,
  type ActiveSessionsChangedPayload,
} from "../lib/activeSessionEvents";
import { disposeTauriListener } from "../lib/tauriEvents";

type UseActiveSessionEventsOptions = {
  enabled: boolean;
  workspaceKey: string;
  refresh: () => Promise<void> | void;
};

export function useActiveSessionEvents({
  enabled,
  workspaceKey,
  refresh,
}: UseActiveSessionEventsOptions) {
  const refreshRef = useRef(refresh);
  const schedulerRef = useRef<ActiveSessionRefreshScheduler | null>(null);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    let unlistenActiveSessionChanges: (() => void) | undefined;
    const scheduler = createActiveSessionRefreshScheduler(() =>
      refreshRef.current(),
    );
    schedulerRef.current = scheduler;

    void listen<ActiveSessionsChangedPayload>(
      ACTIVE_SESSIONS_CHANGED_EVENT,
      (event) => {
        if (activeSessionEventAffectsWorkspace(event.payload, workspaceKey)) {
          scheduler.request();
        }
      },
    )
      .then((unlisten) => {
        if (disposed) {
          disposeTauriListener(unlisten);
        } else {
          unlistenActiveSessionChanges = unlisten;
        }
      })
      .catch(() => undefined);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduler.request({ immediate: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      scheduler.dispose();
      if (schedulerRef.current === scheduler) {
        schedulerRef.current = null;
      }
      disposeTauriListener(unlistenActiveSessionChanges);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, workspaceKey]);

  return useCallback((options: { immediate?: boolean } = {}) => {
    schedulerRef.current?.request(options);
  }, []);
}
