export type TauriUnlisten = () => void | Promise<void>;

const disposedListeners = new WeakSet<TauriUnlisten>();

export function disposeTauriListener(
  unlisten: TauriUnlisten | null | undefined,
) {
  if (!unlisten || disposedListeners.has(unlisten)) {
    return;
  }
  disposedListeners.add(unlisten);
  try {
    void Promise.resolve(unlisten()).catch(() => undefined);
  } catch {
    // A stale webview listener is already detached and needs no further cleanup.
  }
}
