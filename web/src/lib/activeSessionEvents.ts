export const ACTIVE_SESSIONS_CHANGED_EVENT =
  "rdevtool://active-sessions-changed";

export const ACTIVE_SESSION_EVENT_DEBOUNCE_MS = 180;

export type ActiveSessionsChangedPayload = {
  revision: number;
  workspaceKey: string;
  domain: string;
  action: string;
};

export function activeSessionEventAffectsWorkspace(
  payload: Pick<ActiveSessionsChangedPayload, "workspaceKey">,
  activeWorkspaceKey: string,
) {
  const eventWorkspaceKey = payload.workspaceKey.trim() || "system";
  const workspaceKey = activeWorkspaceKey.trim() || "system";
  return (
    workspaceKey === "system" ||
    eventWorkspaceKey === "system" ||
    eventWorkspaceKey === workspaceKey
  );
}

type ActiveSessionRefreshSchedulerOptions = {
  delayMs?: number;
};

export type ActiveSessionRefreshScheduler = {
  request: (options?: { immediate?: boolean }) => void;
  dispose: () => void;
};

export function createActiveSessionRefreshScheduler(
  refresh: () => Promise<void> | void,
  options: ActiveSessionRefreshSchedulerOptions = {},
): ActiveSessionRefreshScheduler {
  const delayMs = options.delayMs ?? ACTIVE_SESSION_EVENT_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let trailing = false;
  let disposed = false;

  const request = (requestOptions: { immediate?: boolean } = {}) => {
    if (disposed) {
      return;
    }
    if (running) {
      trailing = true;
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(
      () => void flush(),
      requestOptions.immediate ? 0 : delayMs,
    );
  };

  const flush = async () => {
    timer = undefined;
    if (disposed) {
      return;
    }
    if (running) {
      trailing = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } catch {
      // Refresh owners surface their own errors; the scheduler stays reusable.
    } finally {
      running = false;
      if (trailing && !disposed) {
        trailing = false;
        request();
      }
    }
  };

  return {
    request,
    dispose: () => {
      disposed = true;
      trailing = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
