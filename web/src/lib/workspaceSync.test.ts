import { describe, expect, it } from "vitest";
import {
  FULL_WORKSPACE_REFRESH_PLAN,
  mergeWorkspaceRefreshPlans,
  projectKeyAfterRefresh,
  sameWorkspaceValue,
  workspaceRefreshPlanForEvent,
} from "./workspaceSync";

const projects = [{ key: "alpha" }, { key: "beta" }];

describe("workspace incremental sync", () => {
  it("keeps the current project when it remains available", () => {
    expect(projectKeyAfterRefresh(projects, "beta", "alpha", false)).toBe("beta");
  });

  it("uses the preferred project when selection must be replaced", () => {
    expect(projectKeyAfterRefresh(projects, "beta", "alpha", true)).toBe("alpha");
  });

  it("falls back when the previous project disappears", () => {
    expect(projectKeyAfterRefresh(projects, "missing", "", false)).toBe("alpha");
  });

  it("detects unchanged workspace payloads", () => {
    expect(sameWorkspaceValue(projects, projects.map((item) => ({ ...item })))).toBe(true);
    expect(sameWorkspaceValue(projects, [{ key: "alpha" }])).toBe(false);
  });

  it("refreshes preferences and project data when workspace.toml changes", () => {
    expect(
      workspaceRefreshPlanForEvent(
        { revision: 1, scopes: ["workspace"] },
        "team",
      ),
    ).toEqual(FULL_WORKSPACE_REFRESH_PLAN);
  });

  it("only refreshes workspace summaries for an inactive workspace copy", () => {
    expect(
      workspaceRefreshPlanForEvent(
        {
          revision: 2,
          scopes: ["projectWorkspaces"],
          projectWorkspaceKeys: ["other"],
          projectWorkspacesUnknown: false,
        },
        "team",
      ),
    ).toEqual({ preferences: false, workspaceState: true, projects: false });
  });

  it("refreshes projects when the active workspace copy changes", () => {
    expect(
      workspaceRefreshPlanForEvent(
        {
          revision: 3,
          scopes: ["projectWorkspaces"],
          projectWorkspaceKeys: ["team"],
          projectWorkspacesUnknown: false,
        },
        "team",
      ),
    ).toEqual({ preferences: false, workspaceState: true, projects: true });
  });

  it("falls back to a full refresh for unknown event scopes", () => {
    expect(
      workspaceRefreshPlanForEvent({ revision: 4, scopes: ["futureScope"] }, "system"),
    ).toEqual(FULL_WORKSPACE_REFRESH_PLAN);
  });

  it("merges refresh plans without dropping queued work", () => {
    expect(
      mergeWorkspaceRefreshPlans(
        { preferences: true, workspaceState: true, projects: false },
        { preferences: false, workspaceState: false, projects: true },
      ),
    ).toEqual(FULL_WORKSPACE_REFRESH_PLAN);
  });
});
