import { useEffect, useState } from "react";
import type { ProjectWorkspaceSummary } from "../app-types";
import { ResourceConfigDialog } from "../components/ResourceConfigDialog";
import { ProjectsPage, type ProjectsPageProps } from "./ProjectsPage";

export type ResourcesPageProps = Pick<
  ProjectsPageProps,
  | "finderTypeOptions"
  | "finderType"
  | "finderTypeCounts"
  | "onFinderTypeChange"
  | "finderCategories"
  | "finderCategory"
  | "finderCategoryCounts"
  | "onFinderCategoryChange"
  | "finderQuery"
  | "onFinderQueryChange"
  | "shortcutEntries"
  | "filteredShortcutEntries"
  | "favoriteShortcutKeys"
  | "recentShortcutKeys"
  | "onToggleShortcutFavorite"
  | "onMarkShortcutUsed"
  | "onRefresh"
  | "onOpenFinderEntry"
  | "recordActivity"
  | "updateActivity"
> & {
  resourceConfigOpenSignal?: number;
  onResourceConfigOpenHandled?: (signal: number) => void;
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  onOpenNavigationConfigFile: () => void;
};

export function ResourcesPage({
  resourceConfigOpenSignal,
  onResourceConfigOpenHandled,
  activeProjectWorkspaceKey,
  projectWorkspaces,
  onOpenNavigationConfigFile,
  onRefresh,
  ...projectsPageProps
}: ResourcesPageProps) {
  const [resourceConfigOpen, setResourceConfigOpen] = useState(false);

  useEffect(() => {
    const signal = resourceConfigOpenSignal ?? 0;
    if (signal <= 0) {
      return;
    }
    setResourceConfigOpen(true);
    onResourceConfigOpenHandled?.(signal);
  }, [onResourceConfigOpenHandled, resourceConfigOpenSignal]);

  return (
    <>
      <ProjectsPage
        {...projectsPageProps}
        mode="resources"
        configWorkspaceKey={activeProjectWorkspaceKey}
        onRefresh={onRefresh}
        runtimeEntries={[]}
        filteredRuntimeEntries={[]}
        favoriteProjectKeys={[]}
        recentProjectKeys={[]}
        selectedDebugProfileKeys={{}}
        runtimeStartPromptMode="auto"
        workflowReceiveRules={[]}
        workflowBroadcastRules={[]}
        workflowSignalOptions={[]}
        workflowSignalSummaries={[]}
        workflowReceiveSignalIdsForProjectReplay={() => []}
        workflowBroadcastSignalIdsForProjectReplay={() => []}
        onWorkflowProjectReplayRulesChange={() => undefined}
        onWorkflowReceiveRulesEnabledChange={() => undefined}
        onWorkflowReceiveRulesDelete={() => undefined}
        onWorkflowBroadcastRulesEnabledChange={() => undefined}
        onWorkflowBroadcastRulesDelete={() => undefined}
        onWorkflowSignalDelete={() => undefined}
        onWorkflowSignalsClear={() => undefined}
        onToggleProjectFavorite={() => undefined}
        onProjectDebugProfileChange={() => undefined}
        onRuntimeStartPromptModeChange={() => undefined}
        onStartRuntime={() => undefined}
        onStopRuntime={() => undefined}
        onAdoptRuntime={() => undefined}
        onOpenBuildOutput={() => undefined}
        onFocusRuntime={() => undefined}
        onOpenProjectDirectory={() => undefined}
        onOpenResourceConfig={() => setResourceConfigOpen(true)}
      />
      <ResourceConfigDialog
        open={resourceConfigOpen}
        activeProjectWorkspaceKey={activeProjectWorkspaceKey}
        projectWorkspaces={projectWorkspaces}
        onClose={() => setResourceConfigOpen(false)}
        onOpenNavigationConfigFile={onOpenNavigationConfigFile}
        onSaved={onRefresh}
      />
    </>
  );
}
