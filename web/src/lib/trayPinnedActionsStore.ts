import {
  TRAY_PINNED_STORAGE_LIMIT,
  getTrayPinnedActionsSnapshot,
  listenTrayPinnedActionsChanged,
  normalizeTrayPinnedActions,
  removeTrayPinnedActions,
  upsertTrayPinnedAction,
  type TrayPinnedAction,
  type TrayPinnedActionsSnapshot,
} from "./trayPins";

export type TrayPinnedActionsGateway = {
  load: () => Promise<TrayPinnedActionsSnapshot>;
  upsert: (action: TrayPinnedAction) => Promise<TrayPinnedActionsSnapshot>;
  remove: (dedupeKeys: string[]) => Promise<TrayPinnedActionsSnapshot>;
  listen: (
    listener: (snapshot: TrayPinnedActionsSnapshot) => void,
  ) => Promise<() => void>;
};

export type TrayPinnedActionsStoreState = TrayPinnedActionsSnapshot & {
  loading: boolean;
};

type PendingIntent =
  | { sequence: number; pinned: true; action: TrayPinnedAction }
  | { sequence: number; pinned: false };

const defaultGateway: TrayPinnedActionsGateway = {
  load: getTrayPinnedActionsSnapshot,
  upsert: upsertTrayPinnedAction,
  remove: removeTrayPinnedActions,
  listen: (listener) =>
    listenTrayPinnedActionsChanged((payload) => listener(payload)),
};

function sameAction(left: TrayPinnedAction, right: TrayPinnedAction) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class TrayPinnedActionsStore {
  private authoritative: TrayPinnedActionsSnapshot = {
    revision: 0,
    actions: [],
  };
  private state: TrayPinnedActionsStoreState = {
    ...this.authoritative,
    loading: true,
  };
  private listeners = new Set<() => void>();
  private pending = new Map<string, PendingIntent>();
  private sequence = 0;
  private started = false;
  private disposed = false;
  private mutationQueue: Promise<void> = Promise.resolve();
  private unlisten: (() => void) | null = null;

  constructor(private readonly gateway: TrayPinnedActionsGateway = defaultGateway) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    void this.ensureStarted();
    return () => {
      this.listeners.delete(listener);
    };
  };

  async ensureStarted() {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    try {
      this.unlisten = await this.gateway.listen((snapshot) => {
        this.applyAuthoritative(snapshot);
      });
      const snapshot = await this.gateway.load();
      this.applyAuthoritative(snapshot);
    } catch (error) {
      console.error("failed to initialize tray pinned actions", error);
    } finally {
      this.publish(false);
    }
  }

  async toggle(action: TrayPinnedAction) {
    const normalized = normalizeTrayPinnedActions([
      { ...action, updatedAtMs: Date.now() },
    ])[0];
    if (!normalized) {
      throw new Error("标记动作缺少 kind、label 或 dedupeKey");
    }
    const pinned = this.currentActions().some(
      (item) => item.dedupeKey === normalized.dedupeKey,
    );
    return pinned
      ? this.enqueueRemove([normalized.dedupeKey])
      : this.enqueueUpsert(normalized);
  }

  async remove(dedupeKey: string) {
    return this.enqueueRemove([dedupeKey]);
  }

  async replace(
    updater: (actions: TrayPinnedAction[]) => TrayPinnedAction[],
  ) {
    const current = this.currentActions();
    const next = normalizeTrayPinnedActions(updater(current));
    const currentByKey = new Map(current.map((action) => [action.dedupeKey, action]));
    const nextByKey = new Map(next.map((action) => [action.dedupeKey, action]));
    const removed = current
      .filter((action) => !nextByKey.has(action.dedupeKey))
      .map((action) => action.dedupeKey);
    const upserts = next.filter((action) => {
      const previous = currentByKey.get(action.dedupeKey);
      return !previous || !sameAction(previous, action);
    });

    if (removed.length === 0 && upserts.length === 0) {
      return current;
    }
    if (removed.length > 0) {
      await this.enqueueRemove(removed);
    }
    for (const action of upserts.reverse()) {
      await this.enqueueUpsert(action);
    }
    return this.currentActions();
  }

  dispose() {
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = null;
    this.listeners.clear();
  }

  private currentActions() {
    return this.deriveActions();
  }

  private enqueueUpsert(action: TrayPinnedAction) {
    const sequence = ++this.sequence;
    this.pending.set(action.dedupeKey, {
      sequence,
      pinned: true,
      action,
    });
    this.publish();
    return this.enqueueMutation(
      () => this.gateway.upsert(action),
      [action.dedupeKey],
      sequence,
    );
  }

  private enqueueRemove(dedupeKeys: string[]) {
    const keys = Array.from(
      new Set(dedupeKeys.map((key) => key.trim()).filter(Boolean)),
    );
    if (keys.length === 0) {
      return Promise.resolve(this.currentActions());
    }
    const sequence = ++this.sequence;
    for (const key of keys) {
      this.pending.set(key, { sequence, pinned: false });
    }
    this.publish();
    return this.enqueueMutation(
      () => this.gateway.remove(keys),
      keys,
      sequence,
    );
  }

  private enqueueMutation(
    mutate: () => Promise<TrayPinnedActionsSnapshot>,
    dedupeKeys: string[],
    sequence: number,
  ) {
    const operation = this.mutationQueue
      .catch(() => undefined)
      .then(mutate)
      .then((snapshot) => {
        this.applyAuthoritative(snapshot);
        this.clearPending(dedupeKeys, sequence);
        return this.currentActions();
      })
      .catch(async (error) => {
        this.clearPending(dedupeKeys, sequence);
        try {
          this.applyAuthoritative(await this.gateway.load());
        } catch {
          this.publish();
        }
        throw error;
      });
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private clearPending(dedupeKeys: string[], sequence: number) {
    for (const key of dedupeKeys) {
      if (this.pending.get(key)?.sequence === sequence) {
        this.pending.delete(key);
      }
    }
    this.publish();
  }

  private applyAuthoritative(snapshot: TrayPinnedActionsSnapshot) {
    if (snapshot.revision < this.authoritative.revision) {
      return;
    }
    this.authoritative = {
      revision: snapshot.revision,
      actions: normalizeTrayPinnedActions(snapshot.actions),
    };
    this.publish(false);
  }

  private deriveActions() {
    const actions = [...this.authoritative.actions];
    for (const [dedupeKey, intent] of this.pending) {
      const index = actions.findIndex((action) => action.dedupeKey === dedupeKey);
      if (!intent.pinned) {
        if (index >= 0) actions.splice(index, 1);
        continue;
      }
      if (index >= 0) actions.splice(index, 1);
      actions.unshift(intent.action);
    }
    return actions.slice(0, TRAY_PINNED_STORAGE_LIMIT);
  }

  private publish(loading = this.state.loading) {
    const next: TrayPinnedActionsStoreState = {
      revision: this.authoritative.revision,
      actions: this.deriveActions(),
      loading,
    };
    if (
      next.revision === this.state.revision &&
      next.loading === this.state.loading &&
      JSON.stringify(next.actions) === JSON.stringify(this.state.actions)
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const trayPinnedActionsStore = new TrayPinnedActionsStore();
