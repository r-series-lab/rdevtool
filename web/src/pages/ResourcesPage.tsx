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
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  onOpenNavigationConfigFile: () => void;
};

export function ResourcesPage({
  resourceConfigOpenSignal,
  activeProjectWorkspaceKey,
  projectWorkspaces,
  onOpenNavigationConfigFile,
  onRefresh,
  ...projectsPageProps
}: ResourcesPageProps) {
  const [resourceConfigOpen, setResourceConfigOpen] = useState(false);

  useEffect(() => {
    if ((resourceConfigOpenSignal ?? 0) > 0) {
      setResourceConfigOpen(true);
    }
  }, [resourceConfigOpenSignal]);

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
