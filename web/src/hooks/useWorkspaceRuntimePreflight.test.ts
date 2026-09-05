import { describe, expect, it } from "vitest";
import { translateMessage } from "../i18n";
import { runtimePreflightPreviewLabel } from "./useWorkspaceRuntimePreflight";

describe("workspace runtime preflight labels", () => {
  it("maps runtime statuses to compact card labels", () => {
    expect(runtimePreflightPreviewLabel("ok")).toBe("可启动");
    expect(runtimePreflightPreviewLabel("warning")).toBe("需留意");
    expect(runtimePreflightPreviewLabel("error")).toBe("不可启动");
    expect(runtimePreflightPreviewLabel("running")).toBe("运行中");
    expect(runtimePreflightPreviewLabel("info")).toBe("已检查");
  });

  it("translates every compact card label to English", () => {
    expect(translateMessage("en-US", runtimePreflightPreviewLabel("ok"))).toBe(
      "Ready to Start",
    );
    expect(
      translateMessage("en-US", runtimePreflightPreviewLabel("warning")),
    ).toBe("Needs Attention");
    expect(translateMessage("en-US", runtimePreflightPreviewLabel("error"))).toBe(
      "Cannot Start",
    );
    expect(
      translateMessage("en-US", runtimePreflightPreviewLabel("running")),
    ).toBe("Running");
    expect(translateMessage("en-US", runtimePreflightPreviewLabel("info"))).toBe(
      "Checked",
    );
  });
});
