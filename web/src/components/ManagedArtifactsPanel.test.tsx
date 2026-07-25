import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManagedArtifactInventoryResponse } from "../app-types";
import { ManagedArtifactsInventoryView } from "./ManagedArtifactsPanel";

const inventory: ManagedArtifactInventoryResponse = {
  schemaVersion: 1,
  requested: {
    workspace: "feature-a",
    allWorkspaces: false,
    project: null,
    kinds: [],
  },
  effective: {
    workspaceKeys: ["feature-a"],
    project: null,
    kinds: [],
    collectors: ["workspaceConfig", "runtimeDaemon", "proxyDaemon"],
  },
  observed: {
    artifacts: [
      {
        id: "artifact-proxy",
        source: "proxyDaemon",
        artifact: {
          kind: "proxyState",
          path: "/config/proxy-runtime/proxy-a.json",
          ownership: "rdevtool",
          lifecycle: "proxySession",
        },
        workspaceKey: "feature-a",
        projectKey: null,
        runId: null,
        scopePath: "/config/proxy.toml",
        exists: true,
        objectType: "file",
        active: true,
        ownershipVerified: true,
        detail: "profile=feature-proxy pid=42 compatible=true",
      },
    ],
    references: [
      {
        kind: "proxyConfig",
        path: "/config/proxy.toml",
        source: "proxyDaemon",
        workspaceKey: "feature-a",
        projectKey: null,
        exists: true,
        ownership: "referenced",
        reason: "仅证明配置引用关系",
      },
    ],
    summary: {
      artifactCount: 1,
      existingCount: 1,
      missingCount: 0,
      activeCount: 1,
      referenceCount: 1,
    },
  },
  status: {
    key: "observed",
    label: "托管产物已盘点",
    success: true,
    terminal: true,
    detail: "发现 1 条托管产物和 1 条非托管引用",
  },
  evidence: [],
  risks: [],
  managedArtifacts: [
    {
      kind: "proxyState",
      path: "/config/proxy-runtime/proxy-a.json",
      ownership: "rdevtool",
      lifecycle: "proxySession",
    },
  ],
  recommendedActions: [],
};

describe("ManagedArtifactsInventoryView", () => {
  it("renders proxy daemon ownership and keeps the surface read-only", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactsInventoryView inventory={inventory} query="" />,
    );

    expect(html).toContain('data-managed-artifacts-view="read-only"');
    expect(html).toContain("Proxy 状态");
    expect(html).toContain("活动中");
    expect(html).toContain("归属已验证");
    expect(html).toContain("非托管引用");
    expect(html).toContain("1 条");
    expect(html).not.toContain("删除");
    expect(html).not.toContain("执行清理");
  });

  it("filters records without changing the inventory response", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactsInventoryView inventory={inventory} query="workspace-copy" />,
    );

    expect(html).toContain("没有匹配的托管产物");
    expect(html).not.toContain("/config/proxy-runtime/proxy-a.json");
  });
});
