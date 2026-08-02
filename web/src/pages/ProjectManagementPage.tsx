import { Box } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ProjectManagementOpenRequest,
  ProjectManagementViewKey,
} from "../app-types";
import {
  FolderIcon,
  PackageIcon,
  SettingsIcon,
  TerminalIcon,
} from "../components/AppIcons";
import {
  SettingsPanel,
  type SettingsSection,
} from "../components/SettingsPanel";
import {
  WorkspacePageToolbar,
  WorkspacePageToolbarAction,
  type WorkspacePageMetric,
} from "../components/WorkspacePageToolbar";
import { useI18n } from "../i18n";
import { BuildPage, type BuildPageProps } from "./BuildPage";
import { MergePage, type MergePageProps } from "./MergePage";
import { ProjectsPage, type ProjectsPageProps } from "./ProjectsPage";

export type ProjectManagementPageProps = {
  view: ProjectManagementViewKey;
  onViewChange: (view: ProjectManagementViewKey) => void;
  openRequest?: ProjectManagementOpenRequest | null;
  onOpenRequestHandled?: (nonce: number) => void;
  projectProps: Omit<ProjectsPageProps, "mode">;
  buildProps: BuildPageProps;
  gitProps: MergePageProps;
};

export function ProjectManagementPage({
  view,
  openRequest,
  onOpenRequestHandled,
  projectProps,
  buildProps,
  gitProps,
}: ProjectManagementPageProps) {
  const { t } = useI18n();
  const [projectConfigOpen, setProjectConfigOpen] = useState(false);
  const [projectConfigInitialSection, setProjectConfigInitialSection] =
    useState<SettingsSection>("projectBuild");
  const [projectConfigKey, setProjectConfigKey] = useState("");
  const handledSettingsRequestNonce = useRef(0);

  useEffect(() => {
    if (
      !openRequest ||
      openRequest.target.kind !== "projectSettings" ||
      openRequest.nonce <= handledSettingsRequestNonce.current ||
      !projectProps.projectConfigPanel
    ) {
      return;
    }
    handledSettingsRequestNonce.current = openRequest.nonce;
    setProjectConfigInitialSection(openRequest.target.section);
    setProjectConfigKey(openRequest.projectKey);
    setProjectConfigOpen(true);
    onOpenRequestHandled?.(openRequest.nonce);
  }, [onOpenRequestHandled, openRequest, projectProps.projectConfigPanel]);

  const metrics = useMemo<WorkspacePageMetric[]>(() => {
    if (view === "build") {
      const buildTargetCount = buildProps.projects.reduce(
        (count, project) => count + project.deployTargets.length,
        0,
      );

      return [
        {
          key: "projects",
          label: t("项目"),
          value: buildProps.projects.length,
          icon: <PackageIcon fontSize="small" />,
          tone: "blue",
        },
        {
          key: "buildTargets",
          label: t("构建目标"),
          value: buildTargetCount,
          icon: <TerminalIcon fontSize="small" />,
          tone: "violet",
        },
        {
          key: "buildHistory",
          label: t("构建记录"),
          value: buildProps.buildHistory.length,
          tone: "cyan",
        },
      ];
    }

    if (view === "git") {
      const changedWorktreeCount = gitProps.worktrees.filter(
        (item) => !item.clean,
      ).length;

      return [
        {
          key: "projects",
          label: t("项目"),
          value: gitProps.projects.length,
          icon: <PackageIcon fontSize="small" />,
          tone: "blue",
        },
        {
          key: "worktrees",
          label: t("工作副本"),
          value: gitProps.worktrees.length,
          icon: <FolderIcon fontSize="small" />,
          tone: "cyan",
        },
        {
          key: "changedWorktrees",
          label: t("有变更"),
          value: changedWorktreeCount,
          tone: changedWorktreeCount > 0 ? "violet" : "green",
        },
      ];
    }

    return [];
  }, [
    buildProps.buildHistory.length,
    buildProps.projects,
    gitProps.projects.length,
    gitProps.worktrees,
    t,
    view,
  ]);

  const toolbarConfig =
    view === "build"
      ? {
          ariaLabel: t("项目构建概览与配置"),
          buttonLabel: t("构建配置"),
          section: "projectBuild" as const,
          projectKey: buildProps.selectedProject,
        }
      : view === "git"
        ? {
            ariaLabel: t("项目 Git 概览与配置"),
            buttonLabel: t("Git配置"),
            section: "projectBranch" as const,
            projectKey: gitProps.selectedProject,
          }
        : null;

  function openProjectConfig(section: SettingsSection, projectKey = "") {
    if (!projectProps.projectConfigPanel) {
      return;
    }
    setProjectConfigInitialSection(section);
    setProjectConfigKey(projectKey);
    setProjectConfigOpen(true);
  }

  return (
    <Box className="project-management-page">
      {toolbarConfig ? (
        <WorkspacePageToolbar
          className={`project-management-toolbar project-management-toolbar--${view}`}
          ariaLabel={toolbarConfig.ariaLabel}
          metrics={metrics}
          actions={
            projectProps.projectConfigPanel ? (
              <WorkspacePageToolbarAction
                startIcon={<SettingsIcon sx={{ fontSize: 14 }} />}
                onClick={() =>
                  openProjectConfig(toolbarConfig.section, toolbarConfig.projectKey)
                }
              >
                {toolbarConfig.buttonLabel}
              </WorkspacePageToolbarAction>
            ) : null
          }
        />
      ) : null}
      <Box className="project-management-view">
        {view === "projects" ? (
          <ProjectsPage
            {...projectProps}
            mode="projectManagement"
            openRequest={openRequest}
            onOpenRequestHandled={onOpenRequestHandled}
          />
        ) : null}
        {view === "build" ? <BuildPage {...buildProps} /> : null}
        {view === "git" ? <MergePage {...gitProps} /> : null}
      </Box>
      {projectConfigOpen && projectProps.projectConfigPanel
        ? createPortal(
            <SettingsPanel
              {...projectProps.projectConfigPanel}
              surface="projectManagement"
              initialSection={projectConfigInitialSection}
              selectedProjectKey={
                projectConfigKey || projectProps.projectConfigPanel.selectedProjectKey
              }
              onClose={() => {
                setProjectConfigOpen(false);
                setProjectConfigKey("");
              }}
            />,
            document.body,
          )
        : null}
    </Box>
  );
}
