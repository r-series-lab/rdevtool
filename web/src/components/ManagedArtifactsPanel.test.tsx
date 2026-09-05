import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  ManagedArtifactCleanupPlanResponse,
  ManagedArtifactInventoryResponse,
} from "../app-types";
import {
  ManagedArtifactCleanupPlanView,
  ManagedArtifactsPanel,
  ManagedArtifactsInventoryView,
} from "./ManagedArtifactsPanel";

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

const cleanupPlan: ManagedArtifactCleanupPlanResponse = {
  schemaVersion: 1,
  requested: {
    workspace: "feature-a",
    allWorkspaces: false,
    project: null,
    kinds: [],
    artifactIds: [],
  },
  effective: {
    workspaceKeys: ["feature-a"],
    selectedArtifactIds: ["eligible", "review", "blocked"],
    missingArtifactIds: [],
    executionSupported: false,
  },
  observed: {
    actions: [
      {
        artifactId: "eligible",
        kind: "runtimeLog",
        path: "/logs/old.log",
        action: "removeFile",
        eligibility: "eligible",
        destructive: true,
        reason: "当前未活动且归属已验证",
        prerequisites: [],
      },
      {
        artifactId: "review",
        kind: "proxyEventLog",
        path: "/proxy/events.jsonl",
        action: "removeFile",
        eligibility: "reviewRequired",
        destructive: true,
        reason: "历史记录需要显式复核",
        prerequisites: ["确认不再需要历史事件"],
      },
      {
        artifactId: "blocked",
        kind: "runtimeState",
        path: "/runtime/active.json",
        action: "none",
        eligibility: "blocked",
        destructive: false,
        reason: "Runtime 当前活动中",
        prerequisites: ["先停止对应 Runtime"],
      },
    ],
    eligibleCount: 1,
    reviewRequiredCount: 1,
    blockedCount: 1,
  },
  status: {
    key: "blocked",
    label: "清理评估已生成",
    success: false,
    terminal: true,
    detail: "存在被阻断的候选产物",
  },
  evidence: [],
  risks: [],
  managedArtifacts: [],
  recommendedActions: [],
};

describe("ManagedArtifactsInventoryView", () => {
  it("can start in all-workspaces scope for a diagnostic handoff", () => {
    const currentWorkspaceHtml = renderToStaticMarkup(
      <ManagedArtifactsPanel activeWorkspaceKey="r-series" />,
    );
    const allWorkspacesHtml = renderToStaticMarkup(
      <ManagedArtifactsPanel
        activeWorkspaceKey="r-series"
        initialKind="runtimeLog"
        initialAllWorkspaces
      />,
    );
    expect(currentWorkspaceHtml).toContain("全部工作区");
    expect(currentWorkspaceHtml).not.toContain('checked=""');
    expect(allWorkspacesHtml).toContain('checked=""');
    expect(allWorkspacesHtml).toContain("Runtime 历史日志");
  });

  it("starts from an exact managed workspace instance focus", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactsPanel
        activeWorkspaceKey="system"
        initialFocus={{
          requestId: 1,
          workspaceKey: "feature-a",
          projectKey: "demo",
          path: "/workspaces/feature-a/demo",
          kind: "workspaceProjectInstance",
        }}
      />,
    );

    expect(html).toContain("正在定位工作区 feature-a · 项目 demo 的托管副本");
    expect(html).toContain("清除定位");
    expect(html).toContain('value="/workspaces/feature-a/demo"');
    expect(html).toContain("工作区副本");
    expect(html).toContain('disabled=""');
  });

  it("keeps normal records compact and the surface read-only", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactsInventoryView inventory={inventory} query="" />,
    );

    expect(html).toContain('data-managed-artifacts-view="read-only"');
    expect(html).toContain("Proxy 状态");
    expect(html).toContain("活动中");
    expect(html).not.toContain("归属已验证");
    expect(html).not.toContain("profile=feature-proxy");
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

  it("exposes explicit selection without changing the read-only boundary", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactsInventoryView
        inventory={inventory}
        query=""
        selectedArtifactIds={["artifact-proxy"]}
        onSelectedArtifactIdsChange={() => undefined}
        onOpenPath={() => undefined}
        onCopyPath={() => undefined}
      />,
    );

    expect(html).toContain("settings-artifact-record is-selected");
    expect(html).toContain("选择当前搜索结果");
    expect(html).toContain("选择Proxy 状态：/config/proxy-runtime/proxy-a.json");
    expect(html).toContain("打开产物路径");
    expect(html).toContain("复制产物路径");
    expect(html).not.toContain("执行清理");
  });

  it("renders cleanup eligibility without exposing an execution action", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactCleanupPlanView
        plan={cleanupPlan}
        onOpenPath={() => undefined}
        onCopyPath={() => undefined}
        onSelectArtifactIds={() => undefined}
      />,
    );

    expect(html).toContain('data-managed-artifact-cleanup-plan="read-only"');
    expect(html).toContain("可清理");
    expect(html).toContain("需要复核");
    expect(html).toContain("已阻断");
    expect(html).toContain("Runtime 当前活动中");
    expect(html).toContain("先停止对应 Runtime");
    expect(html).toContain("当前筛选范围");
    expect(html).toContain("复制复核命令");
    expect(html).toContain("清理资格筛选");
    expect(html).toContain("仅选择可清理项（1）");
    expect(html).toContain("打开产物路径");
    expect(html).toContain("复制产物路径");
    expect(html).not.toContain("rdevtool --json artifacts cleanup-plan");
    expect(html).not.toContain("确认清理");
    expect(html).not.toContain("立即清理");
  });

  it("summarizes an exact selection without exposing the raw command", () => {
    const html = renderToStaticMarkup(
      <ManagedArtifactCleanupPlanView
        plan={{
          ...cleanupPlan,
          requested: {
            ...cleanupPlan.requested,
            artifactIds: ["eligible"],
          },
        }}
      />,
    );

    expect(html).toContain("精确选择 1 条");
    expect(html).not.toContain("--artifact-id eligible");
  });
});
