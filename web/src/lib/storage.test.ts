import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { prependStoredJsonArray, setStoredJson } from "./storage";

describe("storage write queue", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("preserves write order for the same namespace and key", async () => {
    let releaseFirst: (() => void) | undefined;
    invokeMock
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(undefined);

    const first = setStoredJson("app", "preferences", { page: "overview" });
    const second = setStoredJson("app", "preferences", { page: "proxy" });

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
    releaseFirst?.();
    await first;
    await second;

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({
      value: { page: "proxy" },
    });
  });

  it("returns the atomically prepended array", async () => {
    const stored = [{ id: "new" }, { id: "old" }];
    invokeMock.mockResolvedValueOnce(stored);

    await expect(
      prependStoredJsonArray("branch-workflow", "history", { id: "new" }, 200),
    ).resolves.toEqual(stored);
    expect(invokeMock).toHaveBeenCalledWith("storage_prepend_json_array", {
      namespace: "branch-workflow",
      key: "history",
      value: { id: "new" },
      limit: 200,
    });
  });
});
