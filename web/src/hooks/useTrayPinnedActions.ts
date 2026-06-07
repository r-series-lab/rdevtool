import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTrayPinnedActions,
  setTrayPinnedActions,
  TRAY_PINNED_LIMIT,
  type TrayPinnedAction,
} from "../lib/trayPins";

export function useTrayPinnedActions(kind?: string) {
  const [actions, setActions] = useState<TrayPinnedAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getTrayPinnedActions()
      .then((items) => {
        if (!cancelled) {
          setActions(items);
        }
      })
      .catch((error) => {
        console.error("failed to load tray pinned actions", error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scopedActions = useMemo(
    () => (kind ? actions.filter((action) => action.kind === kind) : actions),
    [actions, kind],
  );

  const persistActions = useCallback(async (next: TrayPinnedAction[]) => {
    const saved = await setTrayPinnedActions(next);
    setActions(saved);
    return saved;
  }, []);

  const isPinned = useCallback(
    (dedupeKey: string) => actions.some((action) => action.dedupeKey === dedupeKey),
    [actions],
  );

  const togglePinned = useCallback(
    async (action: TrayPinnedAction) => {
      const exists = actions.some((item) => item.dedupeKey === action.dedupeKey);
      const next = exists
        ? actions.filter((item) => item.dedupeKey !== action.dedupeKey)
        : [
            { ...action, updatedAtMs: Date.now() },
            ...actions.filter((item) => item.dedupeKey !== action.dedupeKey),
          ].slice(0, TRAY_PINNED_LIMIT);
      return persistActions(next);
    },
    [actions, persistActions],
  );

  const removePinned = useCallback(
    async (dedupeKey: string) =>
      persistActions(actions.filter((action) => action.dedupeKey !== dedupeKey)),
    [actions, persistActions],
  );

  const replacePinnedActions = useCallback(
    async (updater: (actions: TrayPinnedAction[]) => TrayPinnedAction[]) =>
      persistActions(updater(actions)),
    [actions, persistActions],
  );

  return {
    actions,
    scopedActions,
    loading,
    isPinned,
    togglePinned,
    removePinned,
    replacePinnedActions,
  };
}
