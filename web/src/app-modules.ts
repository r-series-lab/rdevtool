import { lazy } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppModuleDefinition,
  AppPagePropsMap,
  BuildModulePropsContext,
  ModuleRuntimeContext,
} from "./app-modules.types";
import {
  workflowReplayFromBranchHistory,
  workflowReplayFromBuildHistory,
  workflowReplayFromProjectRuntime,
} from "./lib/workflowSignals";
import { executeTrayPinnedActionWorkflow } from "./lib/trayActionExecution";

function isBuildReplayTarget(target: string) {
  return target === "build.replay" || target === "deploy.replay";
}

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

function buildBuildPageProps({
  appShell,
  branchContext,
  mergeSelection,
  buildModule,
  workflowSignals,
  busy,
}: BuildModulePropsContext): AppPagePropsMap["build"] {
  return {
    projects: appShell.buildProjects,
    activeWorkspaceKey: appShell.activeProjectWorkspaceKey,
    selectedProject: appShell.selectedProject,
    onProjectChange: appShell.setSelectedProject,
    target: buildModule.target,
    onTargetChange: (value) => {
      buildModule.setBuildContextLoadedKey("");
      buildModule.setTarget(value);
    },
    targetMeta: buildModule.targetMeta,
    paramValues: buildModule.paramValues,
    defaultParamValues: buildModule.defaultParamValues,
    onParamChange: buildModule.setParamValue,
    contextLoading: buildModule.buildContextStatus === "loading",
    contextError: buildModule.buildContextStatus === "error",
    contextErrorText: buildModule.buildContextError,
    onSyncBranches: () =>
      void branchContext.handleSyncBranches(appShell.selectedProject),
    sourceBranchEntries: mergeSelection.sourceBranchEntries,
    sourceBranchOptions: mergeSelection.sourceBranchOptions,
    branchSyncText: branchContext.branchSyncText,
    busy,
    onTriggerBuild: buildModule.handleTriggerBuild,
    plan: buildModule.plan,
    buildResult: buildModule.buildResult,
    buildResultUpdatedAtMs: buildModule.buildResultUpdatedAtMs,
    currentBuildHistoryKey: buildModule.currentBuildHistoryKey,
    onRefreshBuild: buildModule.handleRefreshBuild,
    onOpenBuildRecord: buildModule.handleOpenBuildRecord,
    onOpenBuildUrl: buildModule.handleOpenBuildUrl,
    buildHistory: buildModule.visibleBuildHistory,
    onReplayBuildHistory: (entry) =>
      void buildModule.handleReplayBuildHistory(entry),
    workflowReceiveRules: workflowSignals.rules.receivers.filter(
      (rule) => isBuildReplayTarget(rule.replay.target),
    ),
    workflowSignalIdsForBuildReplay: (entry) =>
      workflowSignals.signalIdsForReplay(workflowReplayFromBuildHistory(entry)),
    workflowSignalOptions: workflowSignals.signalOptions,
    workflowSignalSummaries: workflowSignals.signalSummaries,
    onWorkflowBuildReplayReceiversChange: (entry, signalIds) =>
      void workflowSignals.setReceiveRulesForReplay(
        workflowReplayFromBuildHistory(entry),
        signalIds,
      ),
    onWorkflowReceiveRulesEnabledChange: (ruleIds, enabled) =>
      void workflowSignals.setReceiveRulesEnabled(ruleIds, enabled),
    onWorkflowReceiveRulesDelete: (ruleIds) =>
      void workflowSignals.deleteReceiveRules(ruleIds),
    onWorkflowSignalDelete: (signalId) =>
      void workflowSignals.deleteWorkflowSignal(signalId),
    onWorkflowSignalsClear: () => void workflowSignals.clearWorkflowSignals(),
    onRefreshBuildHistory: () =>
      void buildModule.refreshBuildHistoryStatuses(),
    onClearBuildHistory: () =>
      void (async () => {
        await buildModule.handleClearBuildHistory();
        await workflowSignals.deleteReceiveRules(
          workflowSignals.rules.receivers
            .filter((rule) => isBuildReplayTarget(rule.replay.target))
            .map((rule) => rule.id),
        );
      })(),
    formatRelativeTime: formatHistoryTime,
  };
}

function buildMergePageProps({
  appShell,
  branchContext,
  mergeSelection,
  mergeModule,
  workflowSignals,
  busy,
}: BuildModulePropsContext): AppPagePropsMap["merge"] {
  return {
    projects: appShell.branchProjects.map(({ key, name }) => ({ key, name })),
    activeWorkspace:
      appShell.projectWorkspaces.find(
        (workspace) => workspace.key === appShell.activeProjectWorkspaceKey,
      ) ?? null,
    selectedProject: appShell.selectedProject,
    onProjectChange: appShell.setSelectedProject,
    mode: mergeModule.mode,
    onModeChange: mergeModule.setMode,
    syncProjects: mergeModule.syncProjects,
    onSyncProjectsChange: mergeModule.setSyncProjects,
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
    onCheckoutDestinationChange: mergeModule.setCheckoutDestinationDir,
    onClearCheckoutDestination: () => mergeModule.setCheckoutDestinationDir(""),
    onChooseCheckoutDirectory: mergeModule.handleChooseCheckoutDirectory,
    switchTarget: mergeModule.switchTarget,
    onSwitchTargetChange: mergeModule.setSwitchTarget,
    onClearSwitchTarget: () => mergeModule.setSwitchTarget(""),
    pushAction: mergeModule.pushAction,
    onPushActionChange: mergeModule.setPushAction,
    pushCommitMessage: mergeModule.pushCommitMessage,
    onPushCommitMessageChange: mergeModule.setPushCommitMessage,
    pushSelectedPaths: mergeModule.pushSelectedPaths,
    onPushSelectedPathsChange: mergeModule.setPushSelectedPaths,
    pushStatus: mergeModule.pushStatus,
    pushStatusLoading: mergeModule.pushStatusLoading,
    pushStatusError: mergeModule.pushStatusError,
    pushStatusUpdatedAtMs: mergeModule.pushStatusUpdatedAtMs,
    worktrees: mergeModule.worktrees,
    worktreesLoading: mergeModule.worktreesLoading,
    worktreesError: mergeModule.worktreesError,
    selectedWorktreePath: mergeModule.selectedWorktreePath,
    onWorktreePathChange: mergeModule.setSelectedWorktreePath,
    onChooseWorktreeDirectory: mergeModule.handleChooseWorktreeDirectory,
    onRepairWorktree: (repoPath) => void mergeModule.handleRepairWorktree(repoPath),
    onRefreshWorktrees: () =>
      void mergeModule.loadProjectWorktrees(appShell.selectedProject),
    onRefreshPushStatus: () => void mergeModule.loadPushStatus(),
    onSyncBranches: () =>
      void branchContext.handleSyncBranches(appShell.selectedProject),
    sourceBranchEntries: mergeSelection.sourceBranchEntries,
    targetBranchEntries: mergeSelection.targetBranchEntries,
    sourceBranchOptions: mergeSelection.sourceBranchOptions,
    targetBranchOptions: mergeSelection.targetBranchOptions,
    busy,
    currentBranchTaskHistoryId: mergeModule.currentBranchTaskHistoryId,
    currentBranchTaskRunningLabel: mergeModule.currentBranchTaskRunningLabel,
    branchTaskHistory: mergeModule.visibleBranchTaskHistory,
    onPlanSync: mergeModule.handlePlanSync,
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
  };
}

export const APP_MODULES = [
  {
    key: "overview",
    label: "工作区",
    shortLabel: "工作区",
    component: lazy(() =>
      import("./pages/OverviewPage").then((module) => ({
        default: module.OverviewPage,
      })),
    ),
    loadOnStartup: undefined,
    buildProps: ({
      appShell,
      buildModule,
      mergeModule,
      projectsModule,
      proxyModule,
      activityCenter,
    }) => ({
      projectWorkspaces: appShell.projectWorkspaces,
      activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
      onProjectWorkspaceChange: appShell.onProjectWorkspaceChange,
      onNavigateToPage: appShell.setPage,
      onProjectManagementViewChange: appShell.setProjectManagementView,
      onProjectChange: appShell.setSelectedProject,
      onCreateProjectWorkspace: appShell.onCreateProjectWorkspace,
      onInitDemandWorkspace: appShell.onInitDemandWorkspace,
      onProjectConfigSaved: appShell.onProjectConfigSaved,
      workspaceConfigOpenSignal: appShell.workspaceConfigOpenSignal,
      runtimeEntries: projectsModule.runtimeEntries,
      selectedDebugProfileKeys: projectsModule.selectedDebugProfileKeys,
      projectRuntimePreferencesHydrated:
        "preferencesHydrated" in projectsModule &&
        projectsModule.preferencesHydrated === true,
      onStartProjectRuntime: projectsModule.handleStartRuntime,
      onStartProxyProfile: proxyModule.startProxyProfile,
      onStopProxyProfile: proxyModule.stopProxyProfile,
      onFocusProjectRuntime: projectsModule.handleFocusRuntime,
      recordActivity: activityCenter.recordActivity,
      updateActivity: activityCenter.updateActivity,
      onExecutePinnedAction: async (action) => {
        await executeTrayPinnedActionWorkflow(action, {
          activateWorkspace: async (workspaceKey) => {
            if (workspaceKey !== appShell.activeProjectWorkspaceKey) {
              await appShell.onProjectWorkspaceChange(workspaceKey);
            }
          },
          replayBuild: (request, options) =>
            buildModule.handleTriggerBuildRequest(
              request,
              "正在重播构建",
              options,
            ),
          replayBranch: (replay, options) =>
            mergeModule.handleReplayBranchRequest(replay, options),
          executeFallback: (nextAction) =>
            invoke("execute_tray_pinned_action", { action: nextAction }),
          recordDomainExecution: (nextAction) =>
            invoke("record_tray_pinned_action_execution", {
              action: nextAction,
            }),
        });
      },
    }),
  },
  {
    key: "projectManagement",
    label: "项目管理",
    shortLabel: "项目管理",
    component: lazy(() =>
      import("./pages/ProjectManagementPage").then((module) => ({
        default: module.ProjectManagementPage,
      })),
    ),
    loadOnStartup: ({ projectsModule }) => projectsModule.loadFinderData({ force: true }),
    buildProps: (context) => {
      const { appShell, projectsModule, workflowSignals, activityCenter } = context;
      return {
        view: appShell.projectManagementView,
        onViewChange: appShell.setProjectManagementView,
        projectProps: {
          finderTypeOptions: projectsModule.finderTypeOptions,
          finderType: "项目",
          finderTypeCounts: projectsModule.finderTypeCounts,
          onFinderTypeChange: projectsModule.setFinderType,
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
          onAdoptRuntime: (projectKey, debugProfileKey) =>
            void projectsModule.handleAdoptRuntime(projectKey, debugProfileKey),
          onOpenBuildOutput: (projectKey) =>
            void projectsModule.handleOpenBuildOutput(projectKey),
          onFocusRuntime: (projectKey, debugProfileKey) =>
            void projectsModule.handleFocusRuntime(projectKey, debugProfileKey),
          onOpenProjectDirectory: (projectKey) =>
            void projectsModule.handleOpenProjectDirectory(projectKey),
          recordActivity: activityCenter.recordActivity,
          updateActivity: activityCenter.updateActivity,
          projectConfigPanel: {
            styleMode: appShell.styleMode,
            exitRuntimePolicy: appShell.exitRuntimePolicy,
            activePage: appShell.page,
            enabledPages: appShell.enabledPages,
            defaultPage: appShell.defaultPage,
            projectWorkspaces: appShell.projectWorkspaces,
            activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
            selectedProjectKey: appShell.selectedProject,
            onStyleModeChange: appShell.setStyleMode,
            onExitRuntimePolicyChange: appShell.setExitRuntimePolicy,
            onEnabledPagesChange: appShell.setEnabledPages,
            onDefaultPageChange: appShell.setDefaultPage,
            onCreateProjectWorkspace: appShell.onCreateProjectWorkspace,
            onProjectConfigSaved: appShell.onProjectConfigSaved,
            onOpenConfigDir: appShell.onOpenConfigDir,
            onOpenConfigFile: appShell.onOpenConfigFile,
            onOpenProjectWorkspacesDir: appShell.onOpenProjectWorkspacesDir,
            onOpenNavigationConfigFile: appShell.onOpenNavigationConfigFile,
          },
        },
        buildProps: buildBuildPageProps(context),
        gitProps: buildMergePageProps(context),
      };
    },
  },
  {
    key: "resources",
    label: "资源入口",
    shortLabel: "资源入口",
    component: lazy(() =>
      import("./pages/ResourcesPage").then((module) => ({
        default: module.ResourcesPage,
      })),
    ),
    loadOnStartup: ({ projectsModule }) => projectsModule.loadFinderData({ force: true }),
    buildProps: ({ appShell, projectsModule, activityCenter }) => {
      const resourceFinderType =
        projectsModule.finderType === "项目" ? "网站" : projectsModule.finderType;
      return {
        finderTypeOptions: ["网站", "目录", "工具"] as const,
        finderType: resourceFinderType,
        finderTypeCounts: projectsModule.finderTypeCounts,
        onFinderTypeChange: projectsModule.setFinderType,
        finderCategories: projectsModule.finderCategories,
        finderCategory: projectsModule.finderCategory,
        finderCategoryCounts: projectsModule.finderCategoryCounts,
        onFinderCategoryChange: projectsModule.setFinderCategory,
        finderQuery: projectsModule.finderQuery,
        onFinderQueryChange: projectsModule.setFinderQuery,
        shortcutEntries: projectsModule.shortcutEntries,
        filteredShortcutEntries: projectsModule.filteredShortcutEntries,
        favoriteShortcutKeys: projectsModule.favoriteShortcutKeys,
        recentShortcutKeys: projectsModule.recentShortcutKeys,
        onToggleShortcutFavorite: projectsModule.toggleShortcutFavorite,
        onMarkShortcutUsed: projectsModule.markShortcutUsed,
        onRefresh: () => void projectsModule.loadFinderData({ force: true }),
        onOpenFinderEntry: (entry) =>
          projectsModule.handleOpenFinderEntry(entry),
        recordActivity: activityCenter.recordActivity,
        updateActivity: activityCenter.updateActivity,
        resourceConfigOpenSignal: appShell.resourceConfigOpenSignal,
        activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
        projectWorkspaces: appShell.projectWorkspaces,
        onOpenNavigationConfigFile: appShell.onOpenNavigationConfigFile,
      };
    },
  },
  {
    key: "build",
    label: "构建任务",
    shortLabel: "构建任务",
    component: lazy(() =>
      import("./pages/BuildPage").then((module) => ({
        default: module.BuildPage,
      })),
    ),
    loadOnStartup: ({ buildModule }) => buildModule.loadBuildHistory(),
    buildProps: buildBuildPageProps,
  },
  {
    key: "merge",
    label: "Git工作流",
    shortLabel: "Git工作流",
    component: lazy(() =>
      import("./pages/MergePage").then((module) => ({
        default: module.MergePage,
      })),
    ),
    loadOnStartup: ({ mergeModule }) => mergeModule.loadBranchTaskHistory(),
    buildProps: buildMergePageProps,
  },
  {
    key: "proxy",
    label: "本地代理",
    shortLabel: "本地代理",
    component: lazy(() =>
      import("./pages/ProxyPage").then((module) => ({
        default: module.ProxyPage,
      })),
    ),
    loadOnStartup: undefined,
    buildProps: ({ appShell, proxyModule }) => ({
      dashboard: proxyModule.dashboard,
      activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
      selectedProfileId: proxyModule.selectedProfileId,
      loading: proxyModule.loading,
      busy: proxyModule.busy,
      error: proxyModule.error,
      onSelectedProfileChange: proxyModule.setSelectedProfileId,
      onRefresh: proxyModule.loadProxyDashboard,
      onSaveProfile: proxyModule.saveProxyProfile,
      onDeleteProfile: proxyModule.deleteProxyProfile,
      onSaveRule: proxyModule.saveProxyRule,
      onDeleteRule: proxyModule.deleteProxyRule,
      onStartProfile: proxyModule.startProxyProfile,
      onStopProfile: proxyModule.stopProxyProfile,
      onClearEvents: proxyModule.clearProxyEvents,
      onExportProfilePack: proxyModule.exportProxyProfilePack,
      onImportProfilePack: proxyModule.importProxyProfilePack,
      onDiagnoseRequest: proxyModule.diagnoseProxyRequest,
    }),
  },
] as const satisfies readonly [
  AppModuleDefinition<"overview">,
  AppModuleDefinition<"projectManagement">,
  AppModuleDefinition<"resources">,
  AppModuleDefinition<"build">,
  AppModuleDefinition<"merge">,
  AppModuleDefinition<"proxy">,
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
    overview: APP_MODULE_MAP.overview.buildProps(context),
    projectManagement: APP_MODULE_MAP.projectManagement.buildProps(context),
    resources: APP_MODULE_MAP.resources.buildProps(context),
    build: APP_MODULE_MAP.build.buildProps(context),
    merge: APP_MODULE_MAP.merge.buildProps(context),
    proxy: APP_MODULE_MAP.proxy.buildProps(context),
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
