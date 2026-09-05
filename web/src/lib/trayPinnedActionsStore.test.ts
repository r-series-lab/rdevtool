import { describe, expect, it, vi } from "vitest";
import {
  TrayPinnedActionsStore,
  type TrayPinnedActionsGateway,
} from "./trayPinnedActionsStore";
import type {
  TrayPinnedAction,
  TrayPinnedActionsSnapshot,
} from "./trayPins";

function action(dedupeKey: string): TrayPinnedAction {
  return {
    kind: "build.replay",
    label: dedupeKey,
    detail: null,
    workspaceKey: "feature-a",
    projectKey: "admin",
    entry: null,
    payload: null,
    dedupeKey,
    updatedAtMs: 1,
  };
}

function gateway(initial: TrayPinnedActionsSnapshot = { revision: 0, actions: [] }) {
  let snapshot = initial;
  let listener: ((value: TrayPinnedActionsSnapshot) => void) | null = null;
  const calls: string[] = [];
  const implementation: TrayPinnedActionsGateway = {
    load: vi.fn(async () => snapshot),
    listen: vi.fn(async (nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
    upsert: vi.fn(async (nextAction) => {
      calls.push(`upsert:${nextAction.dedupeKey}`);
      snapshot = {
        revision: snapshot.revision + 1,
        actions: [
          nextAction,
          ...snapshot.actions.filter(
            (item) => item.dedupeKey !== nextAction.dedupeKey,
          ),
        ],
      };
      listener?.(snapshot);
      return snapshot;
    }),
    remove: vi.fn(async (dedupeKeys) => {
      calls.push(`remove:${dedupeKeys.join(",")}`);
      snapshot = {
        revision: snapshot.revision + 1,
        actions: snapshot.actions.filter(
          (item) => !dedupeKeys.includes(item.dedupeKey),
        ),
      };
      listener?.(snapshot);
      return snapshot;
    }),
  };
  return {
    implementation,
    calls,
    emit(value: TrayPinnedActionsSnapshot) {
      snapshot = value;
      listener?.(value);
    },
  };
}

describe("TrayPinnedActionsStore", () => {
  it("shares one load and native listener across subscribers", async () => {
    const fake = gateway();
    const store = new TrayPinnedActionsStore(fake.implementation);
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);
    await store.ensureStarted();

    expect(fake.implementation.load).toHaveBeenCalledOnce();
    expect(fake.implementation.listen).toHaveBeenCalledOnce();
    unsubscribeFirst();
    unsubscribeSecond();
    store.dispose();
  });

  it("publishes an optimistic pin before persistence completes", async () => {
    let resolveUpsert!: (value: TrayPinnedActionsSnapshot) => void;
    const fake = gateway();
    fake.implementation.upsert = vi.fn(
      (_action: TrayPinnedAction) =>
        new Promise<TrayPinnedActionsSnapshot>((resolve) => {
          resolveUpsert = resolve;
        }),
    );
    const store = new TrayPinnedActionsStore(fake.implementation);
    await store.ensureStarted();

    const pending = store.toggle(action("build:a"));
    expect(store.getSnapshot().actions.map((item) => item.dedupeKey)).toEqual([
      "build:a",
    ]);

    await vi.waitFor(() => {
      expect(fake.implementation.upsert).toHaveBeenCalledOnce();
    });
    resolveUpsert({ revision: 1, actions: [action("build:a")] });
    await pending;
    expect(store.getSnapshot().actions).toHaveLength(1);
    store.dispose();
  });

  it("applies native changes and ignores stale snapshots", async () => {
    const fake = gateway({ revision: 2, actions: [action("build:a")] });
    const store = new TrayPinnedActionsStore(fake.implementation);
    const subscriber = vi.fn();
    store.subscribe(subscriber);
    await store.ensureStarted();

    fake.emit({ revision: 3, actions: [action("build:b")] });
    fake.emit({ revision: 1, actions: [action("build:stale")] });

    expect(store.getSnapshot().revision).toBe(3);
    expect(store.getSnapshot().actions.map((item) => item.dedupeKey)).toEqual([
      "build:b",
    ]);
    expect(subscriber).toHaveBeenCalled();
    store.dispose();
  });

  it("serializes rapid pin and unpin without restoring the old intent", async () => {
    const fake = gateway();
    const store = new TrayPinnedActionsStore(fake.implementation);
    await store.ensureStarted();

    const pin = store.toggle(action("build:a"));
    const unpin = store.toggle(action("build:a"));
    expect(store.getSnapshot().actions).toEqual([]);

    await Promise.all([pin, unpin]);
    expect(fake.calls).toEqual(["upsert:build:a", "remove:build:a"]);
    expect(store.getSnapshot().actions).toEqual([]);
    store.dispose();
  });

  it("removes multiple legacy keys with one atomic request", async () => {
    const fake = gateway({
      revision: 1,
      actions: [action("build:a"), action("build:legacy")],
    });
    const store = new TrayPinnedActionsStore(fake.implementation);
    await store.ensureStarted();

    await store.replace((actions) =>
      actions.filter((item) => item.dedupeKey === "build:a"),
    );

    expect(fake.calls).toEqual(["remove:build:legacy"]);
    expect(store.getSnapshot().actions.map((item) => item.dedupeKey)).toEqual([
      "build:a",
    ]);
    store.dispose();
  });
});
