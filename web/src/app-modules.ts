import { lazy } from "react";
import type {
  AppModuleDefinition,
  AppPagePropsMap,
  BuildModulePropsContext,
  ModuleRuntimeContext,
} from "./app-modules.types";
import {
  workflowReplayFromBranchHistory,
  workflowReplayFromDeployHistory,
  workflowReplayFromProjectRuntime,
} from "./lib/workflowSignals";

function formatHistoryTime(value?: string) {
  if (!value) {
    return "-";
  }
  const normalizedValue = normalizeHistoryTimestamp(value);
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ").slice(0, 16);
  }
  const pad = (next: number) => String(next).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

function normalizeHistoryTimestamp(value: string) {
  const trimmed = value.trim();
  const sqlTimestampPattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/;
  if (!sqlTimestampPattern.test(trimmed)) {
    return trimmed;
  }

  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  return `${withSeconds.replace(" ", "T")}Z`;
}

export const APP_MODULES = [
  {
    key: "deploy",
    label: "项目部署",
    shortLabel: "部署",
    component: lazy(() =>
      import("./pages/DeployPage").then((module) => ({
        default: module.DeployPage,
      })),
    ),
    loadOnStartup: ({ deployModule }) => deployModule.loadDeployHistory(),
    buildProps: ({
      appShell,
      branchContext,
      mergeSelection,
      deployModule,
      workflowSignals,
      busy,
    }) => ({
      projects: appShell.deployProjects,
      selectedProject: appShell.selectedProject,
      onProjectChange: appShell.setSelectedProject,
      target: deployModule.target,
      onTargetChange: (value) => {
        deployModule.setDeployContextLoadedKey("");
        deployModule.setTarget(value);
      },
      targetMeta: deployModule.targetMeta,
      paramValues: deployModule.paramValues,
      defaultParamValues: deployModule.defaultParamValues,
      onParamChange: deployModule.setParamValue,
      contextLoading: deployModule.deployContextStatus === "loading",
      contextError: deployModule.deployContextStatus === "error",
      contextErrorText: deployModule.deployContextError,
      onSyncBranches: () =>
        void branchContext.handleSyncBranches(appShell.selectedProject),
      sourceBranchEntries: mergeSelection.sourceBranchEntries,
      sourceBranchOptions: mergeSelection.sourceBranchOptions,
      branchSyncText: branchContext.branchSyncText,
      busy,
      onTriggerBuild: deployModule.handleTriggerBuild,
      plan: deployModule.plan,
      buildResult: deployModule.buildResult,
      buildResultUpdatedAtMs: deployModule.buildResultUpdatedAtMs,
      buildAutoRefreshTimedOut: deployModule.buildAutoRefreshTimedOut,
      onRefreshBuild: deployModule.handleRefreshBuild,
      onOpenBuildRecord: deployModule.handleOpenBuildRecord,
      onOpenBuildUrl: deployModule.handleOpenBuildUrl,
      deployHistory: deployModule.visibleDeployHistory,
      onReplayDeployHistory: (entry) =>
        void deployModule.handleReplayDeployHistory(entry),
      workflowReceiveRules: workflowSignals.rules.receivers.filter(
        (rule) => rule.replay.target === "deploy.replay",
      ),
      workflowSignalIdsForDeployReplay: (entry) =>
        workflowSignals.signalIdsForReplay(workflowReplayFromDeployHistory(entry)),
      workflowSignalOptions: workflowSignals.signalOptions,
      workflowSignalSummaries: workflowSignals.signalSummaries,
      onWorkflowDeployReplayReceiversChange: (entry, signalIds) =>
        void workflowSignals.setReceiveRulesForReplay(
          workflowReplayFromDeployHistory(entry),
          signalIds,
        ),
      onWorkflowReceiveRulesEnabledChange: (ruleIds, enabled) =>
        void workflowSignals.setReceiveRulesEnabled(ruleIds, enabled),
      onWorkflowReceiveRulesDelete: (ruleIds) =>
        void workflowSignals.deleteReceiveRules(ruleIds),
      onWorkflowSignalDelete: (signalId) =>
        void workflowSignals.deleteWorkflowSignal(signalId),
      onWorkflowSignalsClear: () => void workflowSignals.clearWorkflowSignals(),
      onRefreshDeployHistory: () =>
        void deployModule.refreshDeployHistoryStatuses(),
      onClearDeployHistory: () =>
        void (async () => {
          await deployModule.handleClearDeployHistory();
          await workflowSignals.deleteReceiveRules(
            workflowSignals.rules.receivers
              .filter((rule) => rule.replay.target === "deploy.replay")
              .map((rule) => rule.id),
          );
        })(),
      formatRelativeTime: formatHistoryTime,
    }),
  },
  {
    key: "merge",
    label: "分支",
    shortLabel: "分支",
    component: lazy(() =>
      import("./pages/MergePage").then((module) => ({
        default: module.MergePage,
      })),
    ),
    loadOnStartup: ({ mergeModule }) => mergeModule.loadBranchTaskHistory(),
    buildProps: ({
      appShell,
      branchContext,
      mergeSelection,
      mergeModule,
      workflowSignals,
      busy,
    }) => ({
      projects: appShell.branchProjects.map(({ key, name }) => ({ key, name })),
      selectedProject: appShell.selectedProject,
      onProjectChange: appShell.setSelectedProject,
      mode: mergeModule.mode,
      onModeChange: mergeModule.setMode,
      syncSource: mergeModule.syncSource,
      onSyncSourceChange: mergeModule.setSyncSource,
      onClearSyncSource: () => mergeModule.setSyncSource(""),
      syncTargets: mergeModule.syncTargets,
      onSyncTargetsChange: mergeModule.setSyncTargets,
      createProjects: mergeModule.createProjects,
      onCreateProjectsChange: mergeModule.setCreateProjects,
      createSource: mergeModule.createSource,
      onCreateSourceChange: mergeModule.setCreateSource,
      onClearCreateSource: () => mergeModule.setCreateSource(""),
      createTarget: mergeModule.createTarget,
      onCreateTargetChange: mergeModule.setCreateTarget,
      onClearCreateTarget: () => mergeModule.setCreateTarget(""),
      checkoutSource: mergeModule.checkoutSource,
      onCheckoutSourceChange: mergeModule.setCheckoutSource,
      onClearCheckoutSource: () => mergeModule.setCheckoutSource(""),
      checkoutDestinationDir: mergeModule.checkoutDestinationDir,
      onClearCheckoutDestination: () => mergeModule.setCheckoutDestinationDir(""),
      onChooseCheckoutDirectory: mergeModule.handleChooseCheckoutDirectory,
      switchTarget: mergeModule.switchTarget,
      onSwitchTargetChange: mergeModule.setSwitchTarget,
      onClearSwitchTarget: () => mergeModule.setSwitchTarget(""),
      pushAction: mergeModule.pushAction,
      onPushActionChange: mergeModule.setPushAction,
      pushCommitMessage: mergeModule.pushCommitMessage,
      onPushCommitMessageChange: mergeModule.setPushCommitMessage,
      pushStatus: mergeModule.pushStatus,
      pushStatusLoading: mergeModule.pushStatusLoading,
      pushStatusError: mergeModule.pushStatusError,
      pushStatusUpdatedAtMs: mergeModule.pushStatusUpdatedAtMs,
      onRefreshPushStatus: () => void mergeModule.loadPushStatus(),
      onSyncBranches: () =>
        void branchContext.handleSyncBranches(appShell.selectedProject),
      sourceBranchEntries: mergeSelection.sourceBranchEntries,
      targetBranchEntries: mergeSelection.targetBranchEntries,
      sourceBranchOptions: mergeSelection.sourceBranchOptions,
      targetBranchOptions: mergeSelection.targetBranchOptions,
      busy,
      branchTaskResult: mergeModule.branchTaskResult,
      branchTaskHistory: mergeModule.visibleBranchTaskHistory,
      onExecuteSync: mergeModule.handleExecuteSync,
      onExecuteCreate: mergeModule.handleExecuteCreate,
      onExecuteCheckout: mergeModule.handleExecuteCheckout,
      onExecuteSwitch: () =>
        void (async () => {
          await mergeModule.handleExecuteSwitch();
          await branchContext.handleSyncBranches(appShell.selectedProject);
        })(),
      onExecutePush: mergeModule.handleExecutePush,
      onReplayBranchTaskHistory: (entry) =>
        void mergeModule.handleReplayBranchTaskHistory(entry),
      workflowReceiveRules: workflowSignals.rules.receivers.filter(
        (rule) => rule.replay.target === "branch.replay",
      ),
      workflowBroadcastRules: workflowSignals.rules.broadcasts.filter(
        (rule) => rule.replay?.target === "branch.replay",
      ),
      workflowReceiveSignalIdsForBranchReplay: (entry) => {
        const replay = workflowReplayFromBranchHistory(entry);
        return replay ? workflowSignals.signalIdsForReplay(replay) : [];
      },
      workflowBroadcastSignalIdsForBranchReplay: (entry) => {
        const replay = workflowReplayFromBranchHistory(entry);
        return replay ? workflowSignals.signalIdsForBroadcastReplay(replay) : [];
      },
      workflowSignalOptions: workflowSignals.signalOptions,
      workflowSignalSummaries: workflowSignals.signalSummaries,
      onWorkflowBranchReplayRulesChange: (entry, value) => {
        const replay = workflowReplayFromBranchHistory(entry);
        if (replay) {
          void workflowSignals.setWorkflowRulesForReplay({
            replay,
            receiveSignalIds: value.receiveSignalIds,
            broadcastSignalIds: value.broadcastSignalIds,
          });
        }
      },
      onWorkflowReceiveRulesEnabledChange: (ruleIds, enabled) =>
        void workflowSignals.setReceiveRulesEnabled(ruleIds, enabled),
      onWorkflowReceiveRulesDelete: (ruleIds) =>
        void workflowSignals.deleteReceiveRules(ruleIds),
      onWorkflowBroadcastRulesEnabledChange: (ruleIds, enabled) =>
        void workflowSignals.setBroadcastRulesEnabled(ruleIds, enabled),
      onWorkflowBroadcastRulesDelete: (ruleIds) =>
        void workflowSignals.deleteBroadcastRules(ruleIds),
      onWorkflowSignalDelete: (signalId) =>
        void workflowSignals.deleteWorkflowSignal(signalId),
      onWorkflowSignalsClear: () => void workflowSignals.clearWorkflowSignals(),
      onRefreshBranchTaskHistory: () => void mergeModule.loadBranchTaskHistory(),
      onClearBranchTaskHistory: () =>
        void (async () => {
          await mergeModule.handleClearBranchTaskHistory();
          await workflowSignals.deleteReceiveRules(
            workflowSignals.rules.receivers
              .filter((rule) => rule.replay.target === "branch.replay")
              .map((rule) => rule.id),
          );
          await workflowSignals.deleteBroadcastRules(
            workflowSignals.rules.broadcasts
              .filter((rule) => rule.replay?.target === "branch.replay")
              .map((rule) => rule.id),
          );
        })(),
      onOpenTaskOutput: (path) => void mergeModule.handleOpenTaskOutput(path),
      formatRelativeTime: formatHistoryTime,
    }),
  },
  {
    key: "projects",
    label: "访达",
    shortLabel: "访达",
    component: lazy(() =>
      import("./pages/ProjectsPage").then((module) => ({
        default: module.ProjectsPage,
      })),
    ),
    loadOnStartup: ({ projectsModule }) => projectsModule.loadFinderData({ force: true }),
    buildProps: ({ appShell, projectsModule, workflowSignals }) => ({
      finderTypeOptions: projectsModule.finderTypeOptions,
      finderType: projectsModule.finderType,
      finderTypeCounts: projectsModule.finderTypeCounts,
      onFinderTypeChange: projectsModule.setFinderType,
      finderQuickFilterOptions: projectsModule.finderQuickFilterOptions,
      finderQuickFilter: projectsModule.finderQuickFilter,
      finderQuickFilterCounts: projectsModule.finderQuickFilterCounts,
      onFinderQuickFilterChange: projectsModule.setFinderQuickFilter,
      finderCategories: projectsModule.finderCategories,
      finderCategory: projectsModule.finderCategory,
      finderCategoryCounts: projectsModule.finderCategoryCounts,
      onFinderCategoryChange: projectsModule.setFinderCategory,
      finderQuery: projectsModule.finderQuery,
      onFinderQueryChange: projectsModule.setFinderQuery,
      runtimeEntries: projectsModule.runtimeEntries,
      filteredRuntimeEntries: projectsModule.filteredRuntimeEntries,
      shortcutEntries: projectsModule.shortcutEntries,
      filteredShortcutEntries: projectsModule.filteredShortcutEntries,
      favoriteProjectKeys: projectsModule.favoriteProjectKeys,
      recentProjectKeys: projectsModule.recentProjectKeys,
      favoriteShortcutKeys: projectsModule.favoriteShortcutKeys,
      recentShortcutKeys: projectsModule.recentShortcutKeys,
      selectedDebugProfileKeys: projectsModule.selectedDebugProfileKeys,
      branchProjectKeys: appShell.enabledPages.includes("merge")
        ? appShell.branchProjects.map((item) => item.key)
        : [],
      deployProjectKeys: appShell.enabledPages.includes("deploy")
        ? appShell.deployProjects.map((item) => item.key)
        : [],
      workflowReceiveRules: workflowSignals.rules.receivers.filter(
        (rule) => rule.replay.target === "project.replay",
      ),
      workflowBroadcastRules: workflowSignals.rules.broadcasts.filter(
        (rule) => rule.replay?.target === "project.replay",
      ),
      workflowSignalOptions: workflowSignals.signalOptions,
      workflowSignalSummaries: workflowSignals.signalSummaries,
      workflowReceiveSignalIdsForProjectReplay: (entry, action) =>
        workflowSignals.signalIdsForReplay(workflowReplayFromProjectRuntime(entry, action)),
      workflowBroadcastSignalIdsForProjectReplay: (entry, action) =>
        workflowSignals.signalIdsForBroadcastReplay(
          workflowReplayFromProjectRuntime(entry, action),
        ),
      onWorkflowProjectReplayRulesChange: (entry, action, value) => {
        void workflowSignals.setWorkflowRulesForReplay({
          replay: workflowReplayFromProjectRuntime(entry, action),
          receiveSignalIds: value.receiveSignalIds,
          broadcastSignalIds: value.broadcastSignalIds,
        });
      },
      onWorkflowReceiveRulesEnabledChange: (ruleIds, enabled) =>
        void workflowSignals.setReceiveRulesEnabled(ruleIds, enabled),
      onWorkflowReceiveRulesDelete: (ruleIds) =>
        void workflowSignals.deleteReceiveRules(ruleIds),
      onWorkflowBroadcastRulesEnabledChange: (ruleIds, enabled) =>
        void workflowSignals.setBroadcastRulesEnabled(ruleIds, enabled),
      onWorkflowBroadcastRulesDelete: (ruleIds) =>
        void workflowSignals.deleteBroadcastRules(ruleIds),
      onWorkflowSignalDelete: (signalId) =>
        void workflowSignals.deleteWorkflowSignal(signalId),
      onWorkflowSignalsClear: () => void workflowSignals.clearWorkflowSignals(),
      onToggleProjectFavorite: projectsModule.toggleProjectFavorite,
      onToggleShortcutFavorite: projectsModule.toggleShortcutFavorite,
      onProjectDebugProfileChange: projectsModule.setProjectDebugProfile,
      onMarkShortcutUsed: projectsModule.markShortcutUsed,
      onOpenProjectBranch: (projectKey) => {
        appShell.setSelectedProject(projectKey);
        appShell.setPage("merge");
      },
      onOpenProjectDeploy: (projectKey) => {
        appShell.setSelectedProject(projectKey);
        appShell.setPage("deploy");
      },
      onRefresh: () => void projectsModule.loadFinderData({ force: true }),
      onOpenFinderEntry: (entry) =>
        projectsModule.handleOpenFinderEntry(entry),
      onStartRuntime: (projectKey, debugProfileKey, envOverrides) =>
        void projectsModule.handleStartRuntime(
          projectKey,
          debugProfileKey,
          envOverrides,
        ),
      onStopRuntime: (projectKey) =>
        void projectsModule.handleStopRuntime(projectKey),
      onRunBuild: (projectKey) =>
        void projectsModule.handleRunBuild(projectKey),
      onStopBuild: (projectKey) =>
        void projectsModule.handleStopBuild(projectKey),
      onOpenBuildOutput: (projectKey) =>
        void projectsModule.handleOpenBuildOutput(projectKey),
      onFocusRuntime: (projectKey) =>
        void projectsModule.handleFocusRuntime(projectKey),
      onOpenProjectDirectory: (projectKey) =>
        void projectsModule.handleOpenProjectDirectory(projectKey),
    }),
  },
] as const satisfies readonly [
  AppModuleDefinition<"deploy">,
  AppModuleDefinition<"merge">,
  AppModuleDefinition<"projects">,
];

export type AppModuleKey = (typeof APP_MODULES)[number]["key"];

export const APP_MODULE_MAP = Object.fromEntries(
  APP_MODULES.map((module) => [module.key, module]),
) as {
  [K in AppModuleKey]: Extract<(typeof APP_MODULES)[number], { key: K }>;
};

export type BuildPagePropsContext = BuildModulePropsContext;

export function buildPageProps(
  context: BuildModulePropsContext,
): AppPagePropsMap {
  return {
    deploy: APP_MODULE_MAP.deploy.buildProps(context),
    merge: APP_MODULE_MAP.merge.buildProps(context),
    projects: APP_MODULE_MAP.projects.buildProps(context),
  };
}

export function buildPagePropsFor<TKey extends AppModuleKey>(
  page: TKey,
  context: BuildModulePropsContext,
): AppPagePropsMap[TKey] {
  const module = APP_MODULE_MAP[page] as AppModuleDefinition<TKey>;
  return module.buildProps(context);
}

export function buildStartupTasks(
  enabledPages: AppModuleKey[],
  startupPage: AppModuleKey,
  preferredProject: string,
  context: ModuleRuntimeContext,
): Array<Promise<void>> {
  const tasks: Array<Promise<void>> = [
    context.appShell.loadProjects(preferredProject),
  ];

  const task = buildModuleLoadTask(startupPage, enabledPages, context);
  if (task) {
    tasks.push(task);
  }

  return tasks;
}

export function buildModuleLoadTask(
  page: AppModuleKey,
  enabledPages: AppModuleKey[],
  context: ModuleRuntimeContext,
): Promise<void> | null {
  if (!enabledPages.includes(page)) {
    return null;
  }

  const loader = APP_MODULE_MAP[page].loadOnStartup;
  return loader ? loader(context) : null;
}
