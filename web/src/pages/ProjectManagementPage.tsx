import { Box } from "@mui/material";
import type { ProjectManagementViewKey } from "../app-types";
import { BuildPage, type BuildPageProps } from "./BuildPage";
import { MergePage, type MergePageProps } from "./MergePage";
import { ProjectsPage, type ProjectsPageProps } from "./ProjectsPage";

export type ProjectManagementPageProps = {
  view: ProjectManagementViewKey;
  onViewChange: (view: ProjectManagementViewKey) => void;
  projectProps: Omit<ProjectsPageProps, "mode">;
  buildProps: BuildPageProps;
  gitProps: MergePageProps;
};

export function ProjectManagementPage({
  view,
  projectProps,
  buildProps,
  gitProps,
}: ProjectManagementPageProps) {
  return (
    <Box className="project-management-page">
      <Box className="project-management-view">
        {view === "projects" ? (
          <ProjectsPage {...projectProps} mode="projectManagement" />
        ) : null}
        {view === "build" ? <BuildPage {...buildProps} /> : null}
        {view === "git" ? <MergePage {...gitProps} /> : null}
      </Box>
    </Box>
  );
}
