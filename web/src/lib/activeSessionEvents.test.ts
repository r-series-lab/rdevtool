import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeSessionEventAffectsWorkspace,
  createActiveSessionRefreshScheduler,
} from "./activeSessionEvents";

afterEach(() => {
  vi.useRealTimers();
});

describe("active session events", () => {
  it("filters custom workspace changes but keeps shared system changes", () => {
    expect(
      activeSessionEventAffectsWorkspace(
        { workspaceKey: "feature-a" },
        "feature-a",
      ),
    ).toBe(true);
    expect(
      activeSessionEventAffectsWorkspace(
        { workspaceKey: "feature-b" },
        "feature-a",
      ),
    ).toBe(false);
    expect(
      activeSessionEventAffectsWorkspace(
        { workspaceKey: "system" },
        "feature-a",
      ),
    ).toBe(true);
    expect(
      activeSessionEventAffectsWorkspace(
        { workspaceKey: "feature-a" },
        "system",
      ),
    ).toBe(true);
  });

  it("coalesces a burst into one refresh", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createActiveSessionRefreshScheduler(refresh);

    scheduler.request();
    scheduler.request();
    scheduler.request();
    await vi.runAllTimersAsync();

    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("runs one trailing refresh when a change arrives in flight", async () => {
    vi.useFakeTimers();
    let finishFirstRefresh: (() => void) | undefined;
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          finishFirstRefresh = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    const scheduler = createActiveSessionRefreshScheduler(refresh);

    scheduler.request({ immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    scheduler.request();
    scheduler.request();
    finishFirstRefresh?.();
    await vi.runAllTimersAsync();

    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("cancels pending work when disposed", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createActiveSessionRefreshScheduler(refresh);

    scheduler.request();
    scheduler.dispose();
    await vi.runAllTimersAsync();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("continues scheduling after a refresh failure", async () => {
    vi.useFakeTimers();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const scheduler = createActiveSessionRefreshScheduler(refresh);

    scheduler.request({ immediate: true });
    await vi.runAllTimersAsync();
    scheduler.request({ immediate: true });
    await vi.runAllTimersAsync();

    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
