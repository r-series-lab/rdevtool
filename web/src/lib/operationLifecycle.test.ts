import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClientOperationId,
  isOperationActiveState,
  OPERATION_SUBMITTING_STATE,
} from "./operationLifecycle";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("operation lifecycle", () => {
  it("treats the local submitting phase as active", () => {
    expect(isOperationActiveState(OPERATION_SUBMITTING_STATE)).toBe(true);
    expect(isOperationActiveState("accepted")).toBe(true);
    expect(isOperationActiveState("queued")).toBe(true);
    expect(isOperationActiveState("running")).toBe(true);
    expect(isOperationActiveState("success")).toBe(false);
  });

  it("creates a domain-prefixed client operation id", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createClientOperationId(" Build ")).toMatch(/^build-1234-[a-z0-9]+$/);
  });
});
