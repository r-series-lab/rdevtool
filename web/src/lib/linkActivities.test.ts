import { describe, expect, it } from "vitest";
import type { LinkExecutionReport } from "../app-types";
import {
  linkActivityDraft,
  linkActivityFailurePatch,
  linkActivityResultPatch,
  linkCheckActivityResultPatch,
  linkCheckPassed,
} from "./linkActivities";

function report(): LinkExecutionReport {
  return {
    key: "cooperation-debug",
    name: "合作渠道联调",
    mode: "run",
    plan: {
      key: "cooperation-debug",
      name: "合作渠道联调",
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
        id: "proxy",
        type: "proxy.start",
        label: "启动代理",
        status: "failed",
        summary: "端口已被占用",
        detail: null,
        risks: ["127.0.0.1:8791 已占用"],
      },
      {
        id: "runtime",
        type: "runtime.start",
        label: "启动项目",
        status: "skipped",
        summary: "前置步骤失败",
        detail: null,
        risks: [],
      },
    ],
    warnings: ["请检查本地代理"],
  };
}

describe("Link activities", () => {
  it("creates an immediate App activity with a stable execution key", () => {
    expect(linkActivityDraft("cooperation-debug", "合作渠道联调", "run")).toMatchObject({
      kind: "link",
      origin: "app",
      status: "running",
      executionKey: "link:run:cooperation-debug",
      target: { page: "overview" },
    });
  });

  it("keeps failed step evidence in the terminal patch", () => {
    expect(linkActivityResultPatch(report(), "run")).toMatchObject({
      status: "failed",
      summary: "合作渠道联调 · 完成 0 / 失败 1 / 跳过 1",
      detail: expect.stringContaining("启动代理：端口已被占用"),
      projectKey: "admin",
      diagnostics: [
        expect.objectContaining({ label: "启动代理", status: "failed" }),
        expect.objectContaining({ label: "启动项目", status: "skipped" }),
      ],
      warnings: ["请检查本地代理"],
      action: expect.objectContaining({
        kind: "linkRecover",
        linkKey: "cooperation-debug",
        replayAction: "run",
      }),
    });
  });

  it("converts invocation errors into a failed terminal patch", () => {
    expect(linkActivityFailurePatch(
      "cooperation-debug",
      "合作渠道联调",
      "stop",
      "workspace-source",
      "守护进程不可用",
    )).toMatchObject({
      status: "failed",
      summary: "合作渠道联调 · 停止失败",
      detail: "守护进程不可用",
      action: {
        kind: "linkRecover",
        label: "检查并重新停止",
        linkKey: "cooperation-debug",
        linkName: "合作渠道联调",
        sourceId: "workspace-source",
        replayAction: "stop",
      },
    });
  });

  it("blocks retries until every check step is actionable", () => {
    const blocked = report();
    const passed: LinkExecutionReport = {
      ...blocked,
      mode: "check",
      steps: blocked.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? "ready" : "checked",
        risks: [],
      })),
      warnings: [],
    };

    expect(linkCheckPassed(blocked)).toBe(false);
    expect(linkCheckPassed(passed)).toBe(true);
    expect(linkCheckActivityResultPatch(blocked)).toMatchObject({
      status: "failed",
      summary: "合作渠道联调 · 2 个步骤阻止重试",
    });
    expect(linkCheckActivityResultPatch(passed)).toMatchObject({
      status: "success",
      summary: "合作渠道联调 · 检查通过",
    });
  });
});
