export const WORKSPACE_STATE_CHANGED_EVENT = "rdevtool://workspace-state-changed";

export type WorkspaceStateChangedPayload = {
  revision: number;
  origin?: "internal" | "external";
  scopes: string[];
  projectWorkspaceKeys?: string[];
  projectWorkspacesUnknown?: boolean;
};

export type WorkspaceRefreshPlan = {
  preferences: boolean;
  workspaceState: boolean;
  projects: boolean;
};

export const FULL_WORKSPACE_REFRESH_PLAN: WorkspaceRefreshPlan = {
  preferences: true,
  workspaceState: true,
  projects: true,
};

export const EMPTY_WORKSPACE_REFRESH_PLAN: WorkspaceRefreshPlan = {
  preferences: false,
  workspaceState: false,
  projects: false,
};

export function mergeWorkspaceRefreshPlans(
  left: WorkspaceRefreshPlan,
  right: WorkspaceRefreshPlan,
): WorkspaceRefreshPlan {
  return {
    preferences: left.preferences || right.preferences,
    workspaceState: left.workspaceState || right.workspaceState,
    projects: left.projects || right.projects,
  };
}

export function hasWorkspaceRefreshWork(plan: WorkspaceRefreshPlan): boolean {
  return plan.preferences || plan.workspaceState || plan.projects;
}

export function workspaceRefreshPlanForEvent(
  payload: WorkspaceStateChangedPayload,
  activeWorkspaceKey: string,
): WorkspaceRefreshPlan {
  const scopes = new Set(payload.scopes);
  if (![...scopes].some((scope) =>
    scope === "workspace" || scope === "projects" || scope === "projectWorkspaces"
  )) {
    return FULL_WORKSPACE_REFRESH_PLAN;
  }

  const workspaceChanged = scopes.has("workspace");
  const projectsChanged = scopes.has("projects");
  const projectWorkspacesChanged = scopes.has("projectWorkspaces");
  const changedWorkspaceKeys = new Set(payload.projectWorkspaceKeys ?? []);
  const activeProjectWorkspaceChanged =
    projectWorkspacesChanged &&
    activeWorkspaceKey !== "system" &&
    ((payload.projectWorkspacesUnknown ?? true) || changedWorkspaceKeys.has(activeWorkspaceKey));

  return {
    preferences: workspaceChanged,
    workspaceState: workspaceChanged || projectsChanged || projectWorkspacesChanged,
    projects: workspaceChanged || projectsChanged || activeProjectWorkspaceChanged,
  };
}

export function sameWorkspaceValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function projectKeyAfterRefresh<T extends { key: string }>(
  projects: T[],
  currentProjectKey: string,
  preferredProjectKey: string,
  replaceSelection: boolean,
): string {
  if (projects.length === 0) {
    return "";
  }
  if (
    !replaceSelection &&
    currentProjectKey &&
    projects.some((project) => project.key === currentProjectKey)
  ) {
    return currentProjectKey;
  }
  return (
    projects.find((project) => project.key === preferredProjectKey)?.key || projects[0].key
  );
}
