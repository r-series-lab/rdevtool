import { describe, expect, it } from "vitest";
import {
  mergeWorkspaceActionPatches,
  mergeWorkspaceOverviewDetails,
  mergeWorkspaceOverviewSummaries,
  resolveWorkspaceOverviewScope,
  workspaceActionPreview,
  workspaceOverviewDetailKeys,
} from "./workspaceOverviewSync";

describe("workspaceActionPreview", () => {
  const actions = ["latest", "pinned-1", "pinned-2", "pinned-3", "pinned-4"];

  it("keeps the latest action and three marked actions in the compact view", () => {
    expect(workspaceActionPreview(actions, false)).toEqual({
      items: actions.slice(0, 4),
      hiddenCount: 1,
      expandable: true,
    });
  });

  it("returns every unique action after expansion", () => {
    expect(workspaceActionPreview(actions, true)).toEqual({
      items: actions,
      hiddenCount: 0,
      expandable: true,
    });
  });

  it("does not expose an expansion control for four or fewer actions", () => {
    expect(workspaceActionPreview(actions.slice(0, 4), false)).toMatchObject({
      hiddenCount: 0,
      expandable: false,
    });
  });
});

type Overview = {
  key: string;
  name: string;
  actionCount: number;
  actions: unknown[];
  runtimeCount: number;
  proxyProfileCount: number;
  resources: unknown[];
  projectDirectories: unknown[];
  proxyProfiles: unknown[];
};

function overview(key: string, actionCount = 0): Overview {
  return {
    key,
    name: key,
    actionCount,
    actions: [],
    runtimeCount: 2,
    proxyProfileCount: 1,
    resources: ["entry"],
    projectDirectories: ["project"],
    proxyProfiles: ["proxy"],
  };
}

describe("mergeWorkspaceActionPatches", () => {
  it("updates only action fields and preserves expensive overview data", () => {
    const system = overview("system");
    const feature = overview("feature");
    const result = mergeWorkspaceActionPatches([system, feature], [
      {
        key: "feature",
        actionCount: 1,
        actions: [{ action: { dedupeKey: "branch:a" } }],
      },
    ]);

    expect(result.applied).toBe(true);
    expect(result.missingWorkspaceKeys).toEqual([]);
    expect(result.groups[0]).toBe(system);
    expect(result.groups[1]).toMatchObject({
      key: "feature",
      name: "feature",
      runtimeCount: 2,
      actionCount: 1,
    });
    expect(result.groups[1]).not.toBe(feature);
  });

  it("reports unknown workspaces so the caller can refresh fully", () => {
    const groups = [overview("system")];
    const result = mergeWorkspaceActionPatches(groups, [
      { key: "feature", actionCount: 0, actions: [] },
    ]);

    expect(result.applied).toBe(false);
    expect(result.groups).toBe(groups);
    expect(result.missingWorkspaceKeys).toEqual(["feature"]);
  });

  it("does not claim an empty patch set was applied", () => {
    const groups = [overview("system")];
    expect(mergeWorkspaceActionPatches(groups, [])).toEqual({
      groups,
      applied: false,
      missingWorkspaceKeys: [],
    });
  });
});

describe("progressive workspace overview merging", () => {
  it("updates summary fields while preserving already hydrated details", () => {
    const current = overview("feature", 1);
    const summary = {
      ...overview("feature", 2),
      name: "Feature workspace",
      proxyProfileCount: 0,
      resources: [],
      projectDirectories: [],
      proxyProfiles: [],
    };

    expect(mergeWorkspaceOverviewSummaries([current], [summary])).toEqual([
      {
        ...summary,
        proxyProfileCount: 1,
        resources: ["entry"],
        projectDirectories: ["project"],
        proxyProfiles: ["proxy"],
      },
    ]);
  });

  it("replaces only workspaces returned by a detail request", () => {
    const system = overview("system");
    const feature = overview("feature");
    const detail = {
      ...overview("feature"),
      runtimeCount: 4,
      projectDirectories: ["project-a", "project-b"],
    };
    const result = mergeWorkspaceOverviewDetails(
      [system, feature],
      [detail],
    );

    expect(result[0]).toBe(system);
    expect(result[1]).toBe(detail);
  });
});

describe("workspace overview scope", () => {
  const system = { ...overview("system"), system: true };
  const featureA = { ...overview("feature-a"), system: false };
  const featureB = { ...overview("feature-b"), system: false };

  it("uses the system workspace as an index of concrete workspaces", () => {
    expect(
      resolveWorkspaceOverviewScope([system, featureA, featureB], "system"),
    ).toEqual({
      activeGroup: system,
      systemScope: true,
      workspaceIndexGroups: [featureA, featureB],
    });
  });

  it("keeps a concrete workspace focused on its own details", () => {
    expect(
      resolveWorkspaceOverviewScope([system, featureA, featureB], "feature-a"),
    ).toEqual({
      activeGroup: featureA,
      systemScope: false,
      workspaceIndexGroups: [],
    });
  });

  it("hydrates only the active workspace details in either scope", () => {
    expect(
      workspaceOverviewDetailKeys([system, featureA, featureB], "system"),
    ).toEqual(["system"]);
    expect(
      workspaceOverviewDetailKeys(
        [system, featureA, featureB],
        "feature-b",
      ),
    ).toEqual(["feature-b"]);
  });
});
