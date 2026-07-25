import { describe, expect, it } from "vitest";
import { resolveBuildExecutionWorkspaceKey } from "./useBuildHistoryState";

describe("resolveBuildExecutionWorkspaceKey", () => {
  it("keeps an explicit recovery workspace ahead of the active workspace", () => {
    expect(resolveBuildExecutionWorkspaceKey("release", " feature ")).toBe("feature");
  });

  it("uses the recorded history workspace before the active workspace", () => {
    expect(resolveBuildExecutionWorkspaceKey("release", null, " feature ")).toBe("feature");
  });

  it("falls back to the active workspace for legacy records", () => {
    expect(resolveBuildExecutionWorkspaceKey(" release ", null, null)).toBe("release");
  });
});
