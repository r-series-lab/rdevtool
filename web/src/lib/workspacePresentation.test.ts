import { describe, expect, it } from "vitest";
import { translateMessage } from "../i18n";
import {
  missingDirectoryCountLabel,
  workspaceDisplayName,
  workspaceLinkToolSummary,
  workspaceSummaryCountLabel,
} from "./workspacePresentation";

describe("workspace presentation", () => {
  it("localizes the system workspace name", () => {
    const t = (message: string) => translateMessage("en-US", message);
    expect(workspaceDisplayName({ name: "全局", system: true }, t)).toBe(
      "Global",
    );
  });

  it("uses correct English singular and plural count labels", () => {
    expect(workspaceSummaryCountLabel("en-US", "project", 1)).toBe(
      "1 project",
    );
    expect(workspaceSummaryCountLabel("en-US", "project", 2)).toBe(
      "2 projects",
    );
    expect(missingDirectoryCountLabel("en-US", 1)).toBe(
      "1 directory needs setup",
    );
  });

  it("translates Link tool summaries without translating configured names or repeating status", () => {
    const t = (message: string, params?: Record<string, string | number>) =>
      translateMessage("en-US", message, params);
    expect(
      workspaceLinkToolSummary(
        "3 步 · 未启动 · 项目 demo-console · 代理 REQ-1234 权益兑换 Mock",
        "Link",
        "未启动",
        t,
      ),
    ).toBe(
      "3 steps · Not Started · Project demo-console · Proxy REQ-1234 权益兑换 Mock",
    );
  });
});
