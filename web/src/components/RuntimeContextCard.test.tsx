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
    expect(html).toContain("REQUESTED");
    expect(html).toContain("demo-web");
    expect(html).toContain("feature");
    expect(html).toContain("/workspace/demo-web");
    expect(html).toContain("http://127.0.0.1:4173/debug");
    expect(html).toContain("/health · 204 · 90000ms");
    expect(html).toContain("run-demo-1");
    expect(html).toContain("rDevTool 管理");
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
