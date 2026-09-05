import { describe, expect, it } from "vitest";
import type { LinkExecutionReport } from "../app-types";
import { linkExecutionModeSucceeded } from "./LinkPlanDialog";

function report(
  mode: "run" | "stop",
  status: string,
  risks: string[] = [],
): LinkExecutionReport {
  return {
    key: "local-debug",
    name: "本地联调",
    mode,
    plan: {
      key: "local-debug",
      name: "本地联调",
      kind: null,
      uiProfile: "default",
      schemaVersion: 1,
      workspaceKey: "feature-a",
      project: "admin",
      sourceContext: null,
      steps: [],
      warnings: [],
    },
    steps: [
      {
        id: "runtime",
        type: "runtime.start",
        label: "启动项目",
        status,
        summary: status,
        detail: null,
        risks,
      },
    ],
    warnings: [],
  };
}

describe("LinkPlanDialog execution state", () => {
  it("accepts completed and risk-free skipped steps", () => {
    expect(linkExecutionModeSucceeded(report("run", "started"), "run")).toBe(true);
    expect(linkExecutionModeSucceeded(report("stop", "skipped"), "stop")).toBe(true);
  });

  it("does not present blocked or risky skipped execution as success", () => {
    expect(linkExecutionModeSucceeded(report("run", "blocked"), "run")).toBe(false);
    expect(
      linkExecutionModeSucceeded(
        report("run", "skipped", ["运行配置缺少启动命令"]),
        "run",
      ),
    ).toBe(false);
  });
});
