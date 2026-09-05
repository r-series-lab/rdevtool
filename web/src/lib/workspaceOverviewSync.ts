import type { WorkspacePinnedActionsPatch } from "./trayPins";

export type WorkspaceActionsOverview = {
  key: string;
  actionCount: number;
  actions: unknown[];
};

export type WorkspaceProgressiveOverview = WorkspaceActionsOverview & {
  proxyProfileCount: number;
  resources: unknown[];
  projectDirectories: unknown[];
  proxyProfiles: unknown[];
};

export type WorkspaceOverviewPatchResult<TOverview> = {
  groups: TOverview[];
  applied: boolean;
  missingWorkspaceKeys: string[];
};

export type WorkspaceOverviewScope<TOverview> = {
  activeGroup: TOverview | null;
  systemScope: boolean;
  workspaceIndexGroups: TOverview[];
};

export const WORKSPACE_ACTION_PREVIEW_LIMIT = 4;

export function workspaceActionPreview<T>(
  actions: T[],
  expanded: boolean,
  limit = WORKSPACE_ACTION_PREVIEW_LIMIT,
) {
  const normalizedLimit = Math.max(0, limit);
  const items = expanded ? actions : actions.slice(0, normalizedLimit);
  return {
    items,
    hiddenCount: Math.max(0, actions.length - items.length),
    expandable: actions.length > normalizedLimit,
  };
}

function resolveActiveWorkspaceOverview<
  TOverview extends { key: string; system?: boolean },
>(groups: TOverview[], activeWorkspaceKey: string): TOverview | null {
  return (
    groups.find((group) => group.key === activeWorkspaceKey) ??
    groups.find((group) => group.system) ??
    groups[0] ??
    null
  );
}

export function resolveWorkspaceOverviewScope<
  TOverview extends { key: string; system: boolean },
>(
  groups: TOverview[],
  activeWorkspaceKey: string,
): WorkspaceOverviewScope<TOverview> {
  const activeGroup = resolveActiveWorkspaceOverview(
    groups,
    activeWorkspaceKey,
  );
  const systemScope = activeGroup?.system ?? activeWorkspaceKey === "system";

  return {
    activeGroup,
    systemScope,
    workspaceIndexGroups: systemScope
      ? groups.filter((group) => !group.system)
      : [],
  };
}

export function workspaceOverviewDetailKeys<
  TOverview extends { key: string; system?: boolean },
>(groups: TOverview[], activeWorkspaceKey: string): string[] {
  const activeGroup = resolveActiveWorkspaceOverview(
    groups,
    activeWorkspaceKey,
  );
  return activeGroup ? [activeGroup.key] : [];
}

export function mergeWorkspaceActionPatches<
  TOverview extends WorkspaceActionsOverview,
>(
  groups: TOverview[],
  patches: WorkspacePinnedActionsPatch[],
): WorkspaceOverviewPatchResult<TOverview> {
  if (groups.length === 0 || patches.length === 0) {
    return {
      groups,
      applied: false,
      missingWorkspaceKeys: patches.map((patch) => patch.key),
    };
  }

  const patchByKey = new Map(patches.map((patch) => [patch.key, patch]));
  const knownKeys = new Set(groups.map((group) => group.key));
  const missingWorkspaceKeys = patches
    .map((patch) => patch.key)
    .filter((key) => !knownKeys.has(key));
  let applied = false;
  const nextGroups = groups.map((group) => {
    const patch = patchByKey.get(group.key);
    if (!patch) {
      return group;
    }
    applied = true;
    return {
      ...group,
      actionCount: patch.actionCount,
      actions: patch.actions,
    };
  });

  return {
    groups: applied ? nextGroups : groups,
    applied,
    missingWorkspaceKeys,
  };
}

export function mergeWorkspaceOverviewSummaries<
  TOverview extends WorkspaceProgressiveOverview,
>(groups: TOverview[], summaries: TOverview[]): TOverview[] {
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  return summaries.map((summary) => {
    const current = groupByKey.get(summary.key);
    if (!current) {
      return summary;
    }
    return {
      ...summary,
      proxyProfileCount: current.proxyProfileCount,
      resources: current.resources,
      projectDirectories: current.projectDirectories,
      proxyProfiles: current.proxyProfiles,
    };
  });
}

export function mergeWorkspaceOverviewDetails<
  TOverview extends WorkspaceProgressiveOverview,
>(groups: TOverview[], details: TOverview[]): TOverview[] {
  if (details.length === 0) {
    return groups;
  }
  const detailByKey = new Map(details.map((detail) => [detail.key, detail]));
  return groups.map((group) => detailByKey.get(group.key) ?? group);
}
