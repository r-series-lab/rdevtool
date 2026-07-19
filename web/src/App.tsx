import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircularProgress,
  CssBaseline,
  ThemeProvider,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { APP_MODULE_MAP, buildPagePropsFor } from "./app-modules";
import { AppShellLayout } from "./components/AppShellLayout";
import { AppExitDialog } from "./components/AppExitDialog";
import { CommandPalette } from "./components/CommandPalette";
import { ConfigSourceManagerDialog } from "./components/ConfigSourceManagerDialog";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { useAppShell } from "./hooks/useAppShell";
import { useActivityCenter } from "./hooks/useActivityCenter";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useBranchContext } from "./hooks/useBranchContext";
import { useMergeSelection } from "./hooks/useMergeSelection";
import {
  useBuildModule,
} from "./hooks/useBuildModule";
import { useBranchWorkflowModule } from "./hooks/useBranchWorkflowModule";
import { usePageModuleRuntime } from "./hooks/usePageModuleRuntime";
import { usePageScrollReset } from "./hooks/usePageScrollReset";
import { useProjectsModule } from "./hooks/useProjectsModule";
import { useProxyModule } from "./hooks/useProxyModule";
import { useWorkflowSignals } from "./hooks/useWorkflowSignals";
import type {
  CreateProjectWorkspacePayload,
  InitDemandWorkspacePayload,
  InitDemandWorkspaceResult,
} from "./app-types";
import type { ActivityEntry } from "./lib/activityCenter";
import type { TrayPinnedAction } from "./lib/trayPins";
import {
  executeTrayPinnedActionWorkflow,
  TRAY_DOMAIN_ACTION_REQUESTED_EVENT,
} from "./lib/trayActionExecution";
import { disposeTauriListener } from "./lib/tauriEvents";
import { createAppTheme } from "./theme";

type AppInfo = {
  configDir?: string;
  configPath?: string;
  workspacesPath?: string;
  navigationPath?: string;
  linksPath?: string;
};

const WORKFLOW_AUTO_OPEN_WINDOW_MS = 10 * 60 * 1000;

function isFreshWorkflowSignal(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp <= WORKFLOW_AUTO_OPEN_WINDOW_MS;
}

function App() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [activityConfigSourceRequest, setActivityConfigSourceRequest] = useState<{
    sourceId: string;
    nonce: number;
  } | null>(null);

  const appShell = useAppShell({ setError });
  const [workspaceConfigOpenSignal, setWorkspaceConfigOpenSignal] = useState(0);
  const [resourceConfigOpenSignal, setResourceConfigOpenSignal] = useState(0);
  const openWorkspaceConfig = useCallback(() => {
    appShell.setPage("overview");
    setWorkspaceConfigOpenSignal((current) => current + 1);
  }, [appShell]);
  const openResourceConfig = useCallback(() => {
    appShell.setPage("resources");
    setResourceConfigOpenSignal((current) => current + 1);
  }, [appShell]);
  const activeProjectWorkspace = useMemo(
    () =>
      appShell.projectWorkspaces.find(
        (workspace) => workspace.key === appShell.activeProjectWorkspaceKey,
      ) ?? null,
    [appShell.activeProjectWorkspaceKey, appShell.projectWorkspaces],
  );
  const activeProjectKeys = useMemo(
    () => appShell.projects.map((project) => project.key),
    [appShell.projects],
  );
  const activityCenter = useActivityCenter({
    setError,
    projectKeys: activeProjectKeys,
    includeAllProjects: activeProjectWorkspace?.includeAllProjects ?? true,
  });
  const workflowSignals = useWorkflowSignals({ setError });
  const workflowAutoRunKeyRef = useRef("");
  const projectManagementAvailable = appShell.enabledPages.includes("projectManagement");
  const resourcesAvailable = appShell.enabledPages.includes("resources");
  const projectsAvailable = projectManagementAvailable || resourcesAvailable;
  const buildAvailable = appShell.enabledPages.includes("build") || projectManagementAvailable;
  const mergeAvailable = appShell.enabledPages.includes("merge") || projectManagementAvailable;
  const proxyAvailable = appShell.enabledPages.includes("proxy");
  const projectManagementBuildActive =
    appShell.page === "projectManagement" && appShell.projectManagementView === "build";
  const projectManagementGitActive =
    appShell.page === "projectManagement" && appShell.projectManagementView === "git";
  const buildEnabled =
    buildAvailable && (appShell.page === "build" || projectManagementBuildActive);
  const mergeEnabled =
    mergeAvailable && (appShell.page === "merge" || projectManagementGitActive);
  const proxyEnabled = proxyAvailable && appShell.page === "proxy";
  const branchEnabled = buildEnabled || mergeEnabled;
  const buildProjects = useMemo(
    () => appShell.projects.filter((item) => item.supportsDeploy),
    [appShell.projects],
  );
  const branchProjects = useMemo(
    () => appShell.projects.filter((item) => item.supportsBranch),
    [appShell.projects],
  );

  const appTheme = useMemo(
    () => createAppTheme(appShell.effectiveStyleMode),
    [appShell.effectiveStyleMode],
  );
  const activeModule = APP_MODULE_MAP[appShell.page];
  const ActivePage = activeModule.component;

  useEffect(() => {
    if (appShell.page === "build") {
      appShell.setProjectManagementView("build");
      appShell.setPage("projectManagement");
      return;
    }
    if (appShell.page === "merge") {
      appShell.setProjectManagementView("git");
      appShell.setPage("projectManagement");
    }
  }, [appShell]);

  useEffect(() => {
    if (!mergeEnabled) {
      return;
    }
    if (!appShell.selectedProject || !branchProjects.some((item) => item.key === appShell.selectedProject)) {
      if (branchProjects[0]) {
        appShell.setSelectedProject(branchProjects[0].key);
      }
    }
  }, [appShell, branchProjects, mergeEnabled]);

  useEffect(() => {
    if (!buildEnabled) {
      return;
    }
    if (!appShell.selectedProject || !buildProjects.some((item) => item.key === appShell.selectedProject)) {
      if (buildProjects[0]) {
        appShell.setSelectedProject(buildProjects[0].key);
      }
    }
  }, [appShell, buildEnabled, buildProjects]);

  const branchContext = useBranchContext({
    enabled: branchEnabled,
    selectedProject: appShell.selectedProject,
    branchCache: appShell.branchCache,
    setBranchCache: appShell.setBranchCache,
    projectSelections: appShell.projectSelections,
    setBusy,
    setError,
  });
  const mergeSelection = useMergeSelection({
    enabled: mergeEnabled,
    selectedProject: appShell.selectedProject,
    selectedProjectInfo: appShell.selectedProjectInfo,
    branchEntries: branchContext.branchEntries,
    branchOptions: branchContext.branchOptions,
    selectedProjectSelection: branchContext.selectedProjectSelection,
    setProjectSelections: appShell.setProjectSelections,
  });

  const buildModule = useBuildModule({
    buildEnabled,
    activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
    selectedProject: appShell.selectedProject,
    branchOptions: branchContext.branchOptions,
    setBusy,
    setError,
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
    syncActivities: activityCenter.syncActivities,
  });

  useEffect(() => {
    if (!buildEnabled) {
      return;
    }
    void buildModule.loadBuildHistory();
  }, [appShell.activeProjectWorkspaceKey, buildEnabled]);

  useEffect(() => {
    if (
      !buildAvailable ||
      activityCenter.items.length === 0 ||
      buildModule.visibleBuildHistory.length === 0
    ) {
      return;
    }
    buildModule.syncBuildActivitiesFromHistory();
  }, [
    activityCenter.items.length,
    buildAvailable,
    buildModule,
  ]);

  const mergeModule = useBranchWorkflowModule({
    enabled: mergeEnabled,
    activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
    projects: branchProjects,
    selectedProject: appShell.selectedProject,
    sourceBranchOptions: mergeSelection.sourceBranchOptions,
    targetBranchOptions: mergeSelection.targetBranchOptions,
    setBusy,
    setError,
    workflowBroadcastRules: workflowSignals.rules.broadcasts,
    emitWorkflowSignals: workflowSignals.emitWorkflowSignals,
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
  });

  useEffect(() => {
    if (!mergeEnabled) {
      return;
    }
    void mergeModule.loadBranchTaskHistory();
  }, [appShell.activeProjectWorkspaceKey, mergeEnabled]);
  const projectsModule = useProjectsModule({
    enabled: projectsAvailable,
    activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
    setBusy,
    setError,
    workflowBroadcastRules: workflowSignals.rules.broadcasts,
    emitWorkflowSignals: workflowSignals.emitWorkflowSignals,
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
    syncActivities: activityCenter.syncActivities,
  });
  const proxyModule = useProxyModule({
    enabled: proxyEnabled,
    setError,
  });
  const trayDomainActionRunningRef = useRef(false);
  const trayDomainActionHandlerRef = useRef<
    (action: TrayPinnedAction) => Promise<void>
  >(async () => undefined);
  trayDomainActionHandlerRef.current = async (action) => {
    if (trayDomainActionRunningRef.current) {
      return;
    }
    trayDomainActionRunningRef.current = true;
    try {
      await executeTrayPinnedActionWorkflow(action, {
        activateWorkspace: async (workspaceKey) => {
          if (workspaceKey !== appShell.activeProjectWorkspaceKey) {
            await changeProjectWorkspace(workspaceKey);
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
    } finally {
      trayDomainActionRunningRef.current = false;
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<TrayPinnedAction>(
      TRAY_DOMAIN_ACTION_REQUESTED_EVENT,
      (event) => {
        void trayDomainActionHandlerRef.current(event.payload).catch((reason) => {
          setError(String(reason));
        });
      },
    ).then((nextUnlisten) => {
      if (disposed) {
        disposeTauriListener(nextUnlisten);
      } else {
        unlisten = nextUnlisten;
      }
    });
    return () => {
      disposed = true;
      disposeTauriListener(unlisten);
    };
  }, []);

  const moduleRuntime = useMemo(
    () => ({
      appShell,
      buildModule,
      mergeModule,
      projectsModule,
      proxyModule,
    }),
    [appShell, buildModule, mergeModule, projectsModule, proxyModule],
  );
  const activePageProps = buildPagePropsFor(appShell.page, {
    appShell: {
      ...appShell,
      buildProjects,
      branchProjects,
      onProjectWorkspaceChange: changeProjectWorkspace,
      onCreateProjectWorkspace: createProjectWorkspace,
      onInitDemandWorkspace: initDemandWorkspace,
      onProjectConfigSaved: reloadProjectsAfterConfigSave,
      workspaceConfigOpenSignal,
      resourceConfigOpenSignal,
      onOpenWorkspaceConfig: openWorkspaceConfig,
      onOpenResourceConfig: openResourceConfig,
      onOpenProjectWorkspacesDir: openProjectWorkspacesDir,
      onOpenConfigDir: openConfigDir,
      onOpenConfigFile: openConfigFile,
      onOpenNavigationConfigFile: openNavigationConfigFile,
    },
    branchContext,
    mergeSelection,
    buildModule,
    mergeModule,
    projectsModule,
    proxyModule,
    busy,
    workflowSignals,
  });

  useAppBootstrap({
    appShell,
    modules: moduleRuntime,
    setError,
  });
  usePageModuleRuntime({
    page: appShell.page,
    enabledPages: appShell.enabledPages,
    modules: moduleRuntime,
    setError,
  });

  usePageScrollReset(
    appShell.page === "projectManagement"
      ? `${appShell.page}:${appShell.projectManagementView}`
      : appShell.page,
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "k" ||
        event.defaultPrevented ||
        event.isComposing ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      setCommandPaletteOpen(true);
      if (projectsAvailable) {
        void projectsModule.loadFinderData();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projectsAvailable, projectsModule]);

  useEffect(() => {
    const signal = workflowSignals.nextPendingSignal;
    const buildReceivers = signal
      ? workflowSignals.matchingReceivers(signal).filter(
          (receiver) =>
            receiver.replay.target === "build.replay" ||
            receiver.replay.target === "deploy.replay",
        )
      : [];
    const branchReceivers = signal
      ? workflowSignals.matchingReceivers(signal).filter(
          (receiver) => receiver.replay.target === "branch.replay",
        )
      : [];
    const projectReceivers = signal
      ? workflowSignals.matchingReceivers(signal).filter(
          (receiver) => receiver.replay.target === "project.replay",
        )
      : [];
    if (
      !signal ||
      Boolean(busy) ||
      !isFreshWorkflowSignal(signal.createdAt) ||
      (branchReceivers.length === 0 &&
        projectReceivers.length === 0 &&
        buildReceivers.length === 0)
    ) {
      return;
    }
    if (branchReceivers.length > 0 && !mergeAvailable) {
      return;
    }
    if (projectReceivers.length > 0 && !projectManagementAvailable) {
      return;
    }
    if (buildReceivers.length > 0 && !buildAvailable) {
      return;
    }

    const runKey = signal.instanceId;
    if (workflowAutoRunKeyRef.current === runKey) {
      return;
    }
    workflowAutoRunKeyRef.current = runKey;

    void (async () => {
      const chainId = signal.chainId || `chain:${signal.instanceId}`;
      const parentId = signal.parentActivityId || null;
      if (branchReceivers.length > 0) {
        for (const receiver of branchReceivers) {
          if (receiver.replay.target === "branch.replay") {
            await mergeModule.handleReplayBranchTaskHistory(receiver.replay.entry, {
              force: true,
              chainId,
              parentId,
              stepLabel: "重播分支",
            });
          }
        }
      }
      if (projectReceivers.length > 0) {
        for (const receiver of projectReceivers) {
          if (receiver.replay.target === "project.replay") {
            await projectsModule.handleReplayProjectWorkflow(receiver.replay, {
              chainId,
              parentId,
              stepLabel: "重播项目",
            });
          }
        }
      }
      if (buildReceivers.length > 0) {
        for (const receiver of buildReceivers) {
          if (
            receiver.replay.target === "build.replay" ||
            receiver.replay.target === "deploy.replay"
          ) {
            await buildModule.handleReplayBuildHistory(receiver.replay.entry, {
              force: true,
              chainId,
              parentId,
              stepLabel: "触发构建",
            });
          }
        }
      }
      await workflowSignals.clearWorkflowSignal(signal.instanceId);
    })();
  }, [
    busy,
    buildAvailable,
    buildModule,
    mergeAvailable,
    mergeModule,
    projectManagementAvailable,
    projectsModule,
    workflowSignals,
  ]);

  async function openConfigDir() {
    try {
      const info = await invoke<AppInfo>("app_info");
      const path = info.configDir;
      if (!path) {
        throw new Error("未找到配置文件夹路径");
      }
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function openConfigFile() {
    try {
      const info = await invoke<AppInfo>("app_info");
      const path = info.configPath;
      if (!path) {
        throw new Error("未找到项目配置文件路径");
      }
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function openNavigationConfigFile() {
    try {
      const info = await invoke<AppInfo>("app_info");
      const path = info.navigationPath;
      if (!path) {
        throw new Error("未找到快捷入口配置文件路径");
      }
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function openProjectWorkspacesDir() {
    try {
      const info = await invoke<AppInfo>("app_info");
      const path = info.workspacesPath;
      if (!path) {
        throw new Error("未找到工作区配置目录");
      }
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function changeProjectWorkspace(workspaceKey: string) {
    try {
      setError("");
      await appShell.setActiveProjectWorkspace(workspaceKey);
      if (projectsAvailable) {
        await projectsModule.loadFinderData({ force: true });
      }
      if (buildEnabled) {
        await buildModule.loadBuildHistory();
      }
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function createProjectWorkspace(payload: CreateProjectWorkspacePayload) {
    try {
      setError("");
      await appShell.createProjectWorkspace(payload);
      if (projectsAvailable) {
        await projectsModule.loadFinderData({ force: true });
      }
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function initDemandWorkspace(
    payload: InitDemandWorkspacePayload,
  ): Promise<InitDemandWorkspaceResult> {
    try {
      setError("");
      const result = await invoke<InitDemandWorkspaceResult>("init_demand_workspace_config", {
        payload,
      });
      await appShell.loadProjectWorkspaces();
      if (projectsAvailable) {
        await projectsModule.loadFinderData({ force: true });
      }
      return result;
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function reloadProjectsAfterConfigSave() {
    await appShell.loadProjectWorkspaces();
    await appShell.loadProjects(appShell.selectedProject, true);
    if (projectsAvailable) {
      await projectsModule.loadFinderData({ force: true });
    }
  }

  function openActivityEntry(entry: ActivityEntry) {
    const target = entry.target;
    if (!target) {
      return;
    }
    if (target.projectKey) {
      appShell.setSelectedProject(target.projectKey);
    }
    let nextPage = target.page;
    if (target.page === "build") {
      appShell.setProjectManagementView("build");
      nextPage = "projectManagement";
    }
    if (target.page === "merge") {
      appShell.setProjectManagementView("git");
      nextPage = "projectManagement";
      if (target.branchMode) {
        mergeModule.setMode(target.branchMode);
      }
    }
    if (target.page === "projectManagement") {
      appShell.setProjectManagementView("projects");
      projectsModule.setFinderType("项目");
      if (entry.projectName || entry.projectKey) {
        projectsModule.setFinderQuery(entry.projectName || entry.projectKey || "");
      }
      void projectsModule.loadFinderData();
    }
    if (target.page === "resources") {
      if (projectsModule.finderType === "项目") {
        projectsModule.setFinderType("网站");
      }
      void projectsModule.loadFinderData();
    }
    appShell.setPage(nextPage);
  }

  async function openActivityResource(entry: ActivityEntry) {
    const resource = entry.resource;
    if (!resource?.value) {
      return;
    }
    try {
      await invoke("open_external_resource", {
        kind: resource.kind,
        value: resource.value,
      });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function runActivityAction(entry: ActivityEntry) {
    const action = entry.action;
    if (!action) {
      return;
    }
    if (action.kind === "compareConfigSource") {
      setActivityConfigSourceRequest({
        sourceId: action.sourceId,
        nonce: Date.now(),
      });
      return;
    }

    setBusy("正在重新加载配置");
    setError("");
    try {
      await appShell.reloadWorkspaceConfiguration();
      if (projectsAvailable) {
        await projectsModule.loadFinderData({ force: true });
      }
      activityCenter.updateActivity(entry.id, {
        status: "success",
        summary: "已重新加载并应用最新配置",
        action: null,
        acknowledgedAt: new Date().toISOString(),
      });
    } catch (reason) {
      const message = String(reason);
      setError(message);
      activityCenter.updateActivity(entry.id, {
        status: "failed",
        summary: "重新加载配置失败",
        detail: message,
        acknowledgedAt: null,
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <AppShellLayout
        visibleNavItems={appShell.visibleNavItems}
        activePage={appShell.page}
        onPageChange={appShell.setPage}
        projectManagementView={appShell.projectManagementView}
        onProjectManagementViewChange={appShell.setProjectManagementView}
        enabledPages={appShell.enabledPages}
        onEnabledPagesChange={appShell.setEnabledPages}
        defaultPage={appShell.defaultPage}
        onDefaultPageChange={appShell.setDefaultPage}
        styleMode={appShell.styleMode}
        onStyleModeChange={appShell.setStyleMode}
        exitRuntimePolicy={appShell.exitRuntimePolicy}
        onExitRuntimePolicyChange={appShell.setExitRuntimePolicy}
        projectWorkspaces={appShell.projectWorkspaces}
        activeProjectWorkspaceKey={appShell.activeProjectWorkspaceKey}
        onProjectWorkspaceChange={changeProjectWorkspace}
        selectedProjectKey={appShell.selectedProject}
        onOpenConfigDir={openConfigDir}
        onOpenConfigFile={openConfigFile}
        onOpenProjectWorkspacesDir={openProjectWorkspacesDir}
        onOpenNavigationConfigFile={openNavigationConfigFile}
        onOpenWorkspaceConfig={openWorkspaceConfig}
        onOpenResourceConfig={openResourceConfig}
        onCreateProjectWorkspace={createProjectWorkspace}
        onProjectConfigSaved={reloadProjectsAfterConfigSave}
        activityItems={activityCenter.items}
        activityAlertCount={activityCenter.stats.running + activityCenter.stats.failed}
        onOpenActivityEntry={openActivityEntry}
        onOpenActivityResource={(entry) => {
          void openActivityResource(entry);
        }}
        onRunActivityAction={runActivityAction}
        onRefreshActivities={activityCenter.refreshBuildActivities}
        onAcknowledgeActivityEntry={(entry) => {
          activityCenter.acknowledgeActivity(entry.id);
        }}
        onAcknowledgeActivityEntries={(entries) => {
          activityCenter.acknowledgeActivities(entries.map((entry) => entry.id));
        }}
        onClearActivities={() => {
          void activityCenter.clearActivities().catch((reason) => {
            setError(String(reason));
          });
        }}
        busy={busy}
        error={error}
      >
        <Suspense
          fallback={
            <div className="page-loading-strip" role="status" aria-live="polite">
              <CircularProgress size={16} thickness={5} />
              正在加载页面模块
            </div>
          }
          >
          <PageErrorBoundary resetKey={appShell.page}>
            <ActivePage {...activePageProps} />
          </PageErrorBoundary>
        </Suspense>
      </AppShellLayout>
      <CommandPalette
        open={commandPaletteOpen}
        navItems={appShell.visibleNavItems}
        activePage={appShell.page}
        projectManagementView={appShell.projectManagementView}
        projects={appShell.projects}
        selectedProjectKey={appShell.selectedProject}
        runtimeEntries={projectsModule.runtimeEntries}
        shortcutEntries={projectsModule.shortcutEntries}
        onClose={() => setCommandPaletteOpen(false)}
        onPageChange={appShell.setPage}
        onProjectManagementViewChange={appShell.setProjectManagementView}
        onProjectChange={appShell.setSelectedProject}
        onOpenFinderEntry={projectsModule.handleOpenFinderEntry}
        onStartRuntime={projectsModule.handleStartRuntime}
        onStopRuntime={projectsModule.handleStopRuntime}
        onRunBuild={projectsModule.handleRunBuild}
        onStopBuild={projectsModule.handleStopBuild}
        onOpenBuildOutput={projectsModule.handleOpenBuildOutput}
        onFocusRuntime={projectsModule.handleFocusRuntime}
        onOpenProjectDirectory={projectsModule.handleOpenProjectDirectory}
      />
      <ConfigSourceManagerDialog
        key={activityConfigSourceRequest?.nonce ?? "activity-config-source"}
        open={Boolean(activityConfigSourceRequest)}
        initialSourceId={activityConfigSourceRequest?.sourceId}
        compareOnOpen
        onClose={() => setActivityConfigSourceRequest(null)}
      />
      <AppExitDialog onError={setError} />
    </ThemeProvider>
  );
}

export default App;
