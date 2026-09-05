import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import runtimeContextFixture from "../../../tests/fixtures/runtime-context-snapshot.json";
import type { ProjectRuntimeContextSnapshot } from "../app-types";
import {
  runtimeContextFromExecutionDetail,
  runtimeContextSelectionLabel,
  runtimeReadyProbeLabel,
} from "../lib/runtimeContext";
import { RuntimeContextCard } from "./RuntimeContextCard";

const context: ProjectRuntimeContextSnapshot = runtimeContextFixture;

describe("RuntimeContextCard", () => {
  it("renders effective target and current daemon observation", () => {
    const html = renderToStaticMarkup(
      <RuntimeContextCard title="运行目标" context={context} />,
    );

    expect(html).toContain('data-runtime-context-card="running"');
    expect(html).toContain("请求");
    expect(html).toContain("工作区 · Feature Workspace");
    expect(html).toContain("demo-web");
    expect(html).toContain("feature");
    expect(html).toContain("/workspace/demo-web");
    expect(html).toContain("http://127.0.0.1:4173/debug");
    expect(html).toContain("/health · 204 · 90000ms");
    expect(html).toContain("run-demo-1");
    expect(html).toContain("rDevTool 管理");
    expect(html).toContain("工作区实例 + 启动档案");
  });

  it("extracts the same contract from Link plan and execution details", () => {
    expect(runtimeContextFromExecutionDetail(context)).toBe(context);
    expect(runtimeContextFromExecutionDetail({ runtime: context })).toBe(context);
    expect(runtimeContextFromExecutionDetail({ runtime: { schemaVersion: 1 } })).toBeNull();
    expect(
      runtimeContextFromExecutionDetail({
        runtime: {
          ...context,
          requested: { projectKey: "demo-web" },
        },
      }),
    ).toBeNull();
  });

  it("renders a concise summary without empty overrides or repeated observation copy", () => {
    const summaryContext: ProjectRuntimeContextSnapshot = {
      ...context,
      requested: {
        ...context.requested,
        command: null,
        expectedPort: null,
        envKeys: [],
      },
      observed: {
        ...context.observed,
        sessions: [],
      },
    };
    const html = renderToStaticMarkup(
      <RuntimeContextCard title="运行上下文" context={summaryContext} summary />,
    );

    expect(html).toContain("运行上下文");
    expect(html).toContain("0 会话");
    expect(html).not.toContain("生效值");
    expect(html).not.toContain("启动选择");
    expect(html).not.toContain("命令覆盖");
    expect(html).not.toContain("端口覆盖");
    expect(html).not.toContain("环境覆盖");
    expect(html).not.toContain("当前候选目录未观测到 daemon 会话");
    expect(html).not.toContain("证据与建议动作");
  });

  it("keeps profile and ready-probe labels deterministic", () => {
    expect(runtimeContextSelectionLabel(context)).toBe("Feature · Browser");
    expect(runtimeReadyProbeLabel(context.effective.target?.readyProbe)).toBe(
      "/health · 204 · 90000ms",
    );
    expect(
      runtimeReadyProbeLabel({
        url: "http://127.0.0.1:4173/ready",
        path: "/ignored",
        expectedStatuses: [],
        timeoutMs: null,
      }),
    ).toBe("http://127.0.0.1:4173/ready · 200-399");
  });
});
