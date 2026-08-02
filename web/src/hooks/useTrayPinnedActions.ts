import { useCallback, useMemo, useSyncExternalStore } from "react";
import { trayPinnedActionsStore } from "../lib/trayPinnedActionsStore";
import type { TrayPinnedAction } from "../lib/trayPins";

export function useTrayPinnedActions(kind?: string) {
  const { actions, loading } = useSyncExternalStore(
    trayPinnedActionsStore.subscribe,
    trayPinnedActionsStore.getSnapshot,
    trayPinnedActionsStore.getSnapshot,
  );

  const scopedActions = useMemo(
    () => (kind ? actions.filter((action) => action.kind === kind) : actions),
    [actions, kind],
  );

  const isPinned = useCallback(
    (dedupeKey: string) => actions.some((action) => action.dedupeKey === dedupeKey),
    [actions],
  );

  const togglePinned = useCallback(
    (action: TrayPinnedAction) => trayPinnedActionsStore.toggle(action),
    [],
  );

  const removePinned = useCallback(
    (dedupeKey: string) => trayPinnedActionsStore.remove(dedupeKey),
    [],
  );

  const replacePinnedActions = useCallback(
    (updater: (actions: TrayPinnedAction[]) => TrayPinnedAction[]) =>
      trayPinnedActionsStore.replace(updater),
    [],
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
