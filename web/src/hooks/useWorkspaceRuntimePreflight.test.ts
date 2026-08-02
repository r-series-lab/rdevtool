import { describe, expect, it } from "vitest";
import { runtimePreflightPreviewLabel } from "./useWorkspaceRuntimePreflight";

describe("workspace runtime preflight labels", () => {
  it("maps runtime statuses to compact card labels", () => {
    expect(runtimePreflightPreviewLabel("ok")).toBe("可启动");
    expect(runtimePreflightPreviewLabel("warning")).toBe("需留意");
    expect(runtimePreflightPreviewLabel("error")).toBe("不可启动");
    expect(runtimePreflightPreviewLabel("running")).toBe("运行中");
    expect(runtimePreflightPreviewLabel("info")).toBe("已检查");
  });
});
