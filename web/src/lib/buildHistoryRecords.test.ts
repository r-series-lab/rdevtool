import { describe, expect, it } from "vitest";
import type { BuildHistoryEntry } from "../app-types";
import {
  collapseLegacyPollingBuildHistory,
  normalizeBuildHistoryRecords,
} from "./buildHistoryRecords";

function historyEntry(
  timestamp: number,
  overrides: Partial<BuildHistoryEntry> = {},
): BuildHistoryEntry {
  const createdAt = new Date(timestamp).toISOString();
  return {
    historyKey: `rdevtool:package:${timestamp}`,
    workspaceKey: "r-series",
    projectInstancePath: null,
    projectKey: "rdevtool",
    projectName: "rDevTool",
    mode: "package",
    env: "",
    branch: "",
    stateKey: "running",
    stateLabel: "打包中",
    detail: "打包任务正在运行",
    queueUrl: null,
    buildUrl: null,
    params: { profile: "release" },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe("collapseLegacyPollingBuildHistory", () => {
  it("collapses a legacy polling burst into one logical execution", () => {
    const start = 1_785_203_677_904;
    const items = [
      historyEntry(start + 6_000, {
        stateKey: "cancelled",
        stateLabel: "待打包",
        detail: "配置已就绪",
        updatedAt: new Date(start + 20_000).toISOString(),
      }),
      historyEntry(start),
      historyEntry(start + 3_000),
    ];

    const collapsed = collapseLegacyPollingBuildHistory(items);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      historyKey: `rdevtool:package:${start}`,
      stateKey: "cancelled",
      stateLabel: "待打包",
      detail: "配置已就绪",
    });
  });

  it("keeps short repeats and modern operation ids visible", () => {
    const start = 1_785_203_677_904;
    const items = [
      historyEntry(start),
      historyEntry(start + 3_000),
      historyEntry(start + 6_000, {
        historyKey: "build-1785203683904-abc123",
      }),
    ];

    expect(collapseLegacyPollingBuildHistory(items)).toEqual(items);
  });

  it("does not collapse separate polling bursts or remote builds", () => {
    const start = 1_785_203_677_904;
    const firstBurst = [0, 3_000, 6_000].map((offset) =>
      historyEntry(start + offset),
    );
    const secondBurst = [30_000, 33_000, 36_000].map((offset) =>
      historyEntry(start + offset),
    );
    const remote = historyEntry(start + 60_000, {
      queueUrl: "https://jenkins.example/queue/item/1",
    });

    const collapsed = collapseLegacyPollingBuildHistory([
      ...firstBurst,
      ...secondBurst,
      remote,
    ]);

    expect(collapsed).toHaveLength(3);
    expect(collapsed[2]).toBe(remote);
  });
});

describe("normalizeBuildHistoryRecords", () => {
  it("drops config-ready local package records because they are not executions", () => {
    const start = 1_785_203_677_904;
    const items = [
      historyEntry(start + 6_000, {
        stateKey: "cancelled",
        stateLabel: "待打包",
        detail: "配置已就绪，可执行打包任务",
        updatedAt: new Date(start + 20_000).toISOString(),
      }),
      historyEntry(start),
      historyEntry(start + 3_000),
      historyEntry(start + 30_000, {
        historyKey: "build-success",
        stateKey: "success",
        stateLabel: "已打包",
        detail: "打包任务已完成",
      }),
    ];

    expect(normalizeBuildHistoryRecords(items)).toMatchObject([
      {
        historyKey: "build-success",
        stateKey: "success",
        stateLabel: "已打包",
      },
    ]);
  });
});
