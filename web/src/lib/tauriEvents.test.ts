import { describe, expect, it, vi } from "vitest";
import { disposeTauriListener } from "./tauriEvents";

describe("disposeTauriListener", () => {
  it("absorbs synchronous disposal failures", () => {
    const unlisten = vi.fn(() => {
      throw new Error("listener already removed");
    });

    expect(() => disposeTauriListener(unlisten)).not.toThrow();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("absorbs asynchronous disposal failures", async () => {
    const unlisten = vi.fn(async () => {
      throw new Error("webview was reloaded");
    });

    disposeTauriListener(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("disposes the same listener only once", () => {
    const unlisten = vi.fn();

    disposeTauriListener(unlisten);
    disposeTauriListener(unlisten);

    expect(unlisten).toHaveBeenCalledOnce();
  });
});
