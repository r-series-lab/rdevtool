import { describe, expect, it } from "vitest";
import type { ConfigSource } from "../app-types";
import {
  configSourcesChangedActivities,
  workspaceStateChangedActivities,
} from "./configChangeActivities";

function source(overrides: Partial<ConfigSource> = {}): ConfigSource {
  return {
    id: "team",
    name: "团队配置",
    kind: "custom",
    baseDir: "/config/sources/team",
    files: {
      navigation: "/config/sources/team/navigation.toml",
      links: "/config/sources/team/links.toml",
    },
    uiProfile: "resource-basic",
    capabilities: ["resource"],
    isDefault: false,
    ...overrides,
  };
}

describe("workspaceStateChangedActivities", () => {
  it("combines changed workspace categories into one actionable activity", () => {
    const activities = workspaceStateChangedActivities(
      {
        revision: 7,
        scopes: ["projectWorkspaces", "workspace", "projects", "workspace"],
      },
      {
        workspacePath: "/config/workspace.toml",
        configPath: "/config/projects.toml",
        workspacesPath: "/config/workspaces",
        configDir: "/config",
      },
    );

    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe("工作区相关配置已变更");
    expect(activities[0].detail).toBe("影响：工作区、项目、项目工作区");
    expect(activities[0].resource?.value).toBe("/config");
    expect(activities[0].target?.page).toBe("overview");
    expect(activities[0].action).toEqual({
      kind: "reloadConfig",
      label: "重新加载",
      scope: "workspace",
    });
    expect(activities.every(({ kind, status }) => kind === "config" && status === "running"))
      .toBe(true);
  });

  it("keeps the combined id stable across revisions and falls back to the config directory", () => {
    const first = workspaceStateChangedActivities(
      { revision: 1, scopes: ["workspace", "projects", "projectWorkspaces"] },
      { configDir: "/config" },
    );
    const second = workspaceStateChangedActivities(
      { revision: 99, scopes: ["workspace", "projects", "projectWorkspaces"] },
      { configDir: "/config" },
    );

    expect(second[0].id).toBe(first[0].id);
    expect(second[0].executionKey).toBe(first[0].executionKey);
    expect(first[0].resource?.value).toBe("/config");
  });

  it("keeps the specific title and path for a single changed category", () => {
    const activities = workspaceStateChangedActivities(
      { revision: 3, scopes: ["projects"] },
      { configPath: "/config/projects.toml", configDir: "/config" },
    );

    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe("项目配置已变更");
    expect(activities[0].detail).toBeUndefined();
    expect(activities[0].resource?.value).toBe("/config/projects.toml");
    expect(activities[0].target?.page).toBe("projectManagement");
  });
});

describe("configSourcesChangedActivities", () => {
  it("creates a catalog record and one comparison record per source", () => {
    const activities = configSourcesChangedActivities(
      {
        revision: 12,
        catalogChanged: true,
        sourceIds: ["team", "removed", "team"],
      },
      [source()],
      { configDir: "/config" },
    );

    expect(activities.map((activity) => activity.title)).toEqual([
      "配置源列表已变更",
      "配置源“团队配置”已变更",
      "配置源“removed”已变更",
    ]);
    expect(activities.map((activity) => activity.resource?.value)).toEqual([
      "/config",
      "/config/sources/team",
      "/config",
    ]);
    expect(activities.map((activity) => activity.target?.page)).toEqual([
      "resources",
      "resources",
      "resources",
    ]);
    expect(activities[0].action).toBeUndefined();
    expect(activities[1].action).toEqual({
      kind: "compareConfigSource",
      label: "比较配置源",
      sourceId: "team",
    });
    expect(activities[2].action).toBeUndefined();
  });

  it("uses stable source keys and falls back from an empty source directory", () => {
    const first = configSourcesChangedActivities(
      { revision: 1, catalogChanged: false, sourceIds: ["team"] },
      [source({ baseDir: "" })],
      { configDir: "/config" },
    );
    const second = configSourcesChangedActivities(
      { revision: 2, catalogChanged: false, sourceIds: ["team"] },
      [source({ baseDir: "" })],
      { configDir: "/config" },
    );

    expect(first[0].resource?.value).toBe("/config");
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].executionKey).toBe(first[0].executionKey);
  });
});
