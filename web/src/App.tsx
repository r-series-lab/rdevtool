import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  CircularProgress,
  CssBaseline,
  ThemeProvider,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { APP_MODULE_MAP, buildPagePropsFor } from "./app-modules";
import { AppShellLayout } from "./components/AppShellLayout";
import { CommandPalette } from "./components/CommandPalette";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { useAppShell } from "./hooks/useAppShell";
import { useActivityCenter } from "./hooks/useActivityCenter";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useBranchContext } from "./hooks/useBranchContext";
import { useMergeSelection } from "./hooks/useMergeSelection";
import {
  useDeployModule,
} from "./hooks/useDeployModule";
import { useBranchWorkflowModule } from "./hooks/useBranchWorkflowModule";
import { usePageModuleRuntime } from "./hooks/usePageModuleRuntime";
import { usePageScrollReset } from "./hooks/usePageScrollReset";
import { useProjectsModule } from "./hooks/useProjectsModule";
import { useWorkflowSignals } from "./hooks/useWorkflowSignals";
import type { ActivityEntry } from "./lib/activityCenter";
import { createAppTheme } from "./theme";

type AppInfo = {
  configDir?: string;
  configPath?: string;
  navigationPath?: string;
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

  const appShell = useAppShell({ setError });
  const activityCenter = useActivityCenter({ setError });
  const workflowSignals = useWorkflowSignals({ setError });
  const workflowAutoOpenKeyRef = useRef("");
  const workflowAutoRunKeyRef = useRef("");
  const deployAvailable = appShell.enabledPages.includes("deploy");
  const mergeAvailable = appShell.enabledPages.includes("merge");
  const projectsAvailable = appShell.enabledPages.includes("projects");
  const deployEnabled = deployAvailable && appShell.page === "deploy";
  const mergeEnabled = mergeAvailable && appShell.page === "merge";
  const branchEnabled = deployEnabled || mergeEnabled;
  const deployProjects = useMemo(
    () => appShell.projects.filter((item) => item.supportsDeploy),
    [appShell.projects],
  );
  const branchProjects = useMemo(
    () => appShell.projects.filter((item) => item.supportsBranch),
    [appShell.projects],
  );

  const appTheme = useMemo(() => createAppTheme(appShell.styleMode), [appShell.styleMode]);
  const activeModule = APP_MODULE_MAP[appShell.page];
  const ActivePage = activeModule.component;

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
    if (!deployEnabled) {
      return;
    }
    if (!appShell.selectedProject || !deployProjects.some((item) => item.key === appShell.selectedProject)) {
      if (deployProjects[0]) {
        appShell.setSelectedProject(deployProjects[0].key);
      }
    }
  }, [appShell, deployEnabled, deployProjects]);

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

  const deployModule = useDeployModule({
    deployEnabled,
    selectedProject: appShell.selectedProject,
    branchOptions: branchContext.branchOptions,
    setBusy,
    setError,
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
    syncActivities: activityCenter.syncActivities,
  });

  useEffect(() => {
    if (
      !deployAvailable ||
      activityCenter.items.length === 0 ||
      deployModule.visibleDeployHistory.length === 0
    ) {
      return;
    }
    deployModule.syncDeployActivitiesFromHistory();
  }, [
    activityCenter.items.length,
    deployAvailable,
    deployModule,
  ]);

  const mergeModule = useBranchWorkflowModule({
    enabled: mergeEnabled,
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
  const projectsModule = useProjectsModule({
    enabled: projectsAvailable,
    setBusy,
    setError,
    workflowBroadcastRules: workflowSignals.rules.broadcasts,
    emitWorkflowSignals: workflowSignals.emitWorkflowSignals,
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
  });
  const moduleRuntime = useMemo(
    () => ({
      appShell,
      deployModule,
      mergeModule,
      projectsModule,
    }),
    [appShell, deployModule, mergeModule, projectsModule],
  );
  const activePageProps = buildPagePropsFor(appShell.page, {
    appShell: {
      ...appShell,
      deployProjects,
      branchProjects,
    },
    branchContext,
    mergeSelection,
    deployModule,
    mergeModule,
    projectsModule,
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

  usePageScrollReset(appShell.page);

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

  function openCommandPalette() {
    setCommandPaletteOpen(true);
    if (projectsAvailable) {
      void projectsModule.loadFinderData();
    }
  }

  useEffect(() => {
    const signal = workflowSignals.nextPendingSignal;
    if (!signal) {
      return;
    }
    if (!isFreshWorkflowSignal(signal.createdAt)) {
      void workflowSignals.clearWorkflowSignal(signal.instanceId);
      return;
    }
    const receivers = workflowSignals.matchingReceivers(signal);
    const branchReceivers = receivers.filter(
      (receiver) => receiver.replay.target === "branch.replay",
    );
    const deployReceivers = receivers.filter(
      (receiver) => receiver.replay.target === "deploy.replay",
    );
    const projectReceivers = receivers.filter(
      (receiver) => receiver.replay.target === "project.replay",
    );
    if (branchReceivers.length > 0 && mergeAvailable) {
      const openKey = `${signal.instanceId}:merge`;
      if (workflowAutoOpenKeyRef.current === openKey) {
        return;
      }
      workflowAutoOpenKeyRef.current = openKey;
      appShell.setPage("merge");
      return;
    }
    if (projectReceivers.length > 0 && projectsAvailable) {
      const openKey = `${signal.instanceId}:projects`;
      if (workflowAutoOpenKeyRef.current === openKey) {
        return;
      }
      workflowAutoOpenKeyRef.current = openKey;
      appShell.setPage("projects");
      return;
    }
    if (!deployAvailable || deployReceivers.length === 0) {
      return;
    }
    const openKey = `${signal.instanceId}:deploy`;
    if (workflowAutoOpenKeyRef.current === openKey) {
      return;
    }
    workflowAutoOpenKeyRef.current = openKey;
    appShell.setPage("deploy");
  }, [appShell, deployAvailable, mergeAvailable, projectsAvailable, workflowSignals]);

  useEffect(() => {
    const signal = workflowSignals.nextPendingSignal;
    const deployReceivers = signal
      ? workflowSignals.matchingReceivers(signal).filter(
          (receiver) => receiver.replay.target === "deploy.replay",
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
        deployReceivers.length === 0)
    ) {
      return;
    }
    if (branchReceivers.length > 0 && !mergeEnabled) {
      return;
    }
    if (branchReceivers.length === 0 && projectReceivers.length > 0 && !projectsAvailable) {
      return;
    }
    if (
      branchReceivers.length === 0 &&
      projectReceivers.length > 0 &&
      appShell.page !== "projects"
    ) {
      return;
    }
    if (
      branchReceivers.length === 0 &&
      projectReceivers.length === 0 &&
      deployReceivers.length > 0 &&
      !deployEnabled
    ) {
      return;
    }

    const targetKey =
      branchReceivers.length > 0
        ? "merge"
        : projectReceivers.length > 0
          ? "projects"
          : "deploy";
    const runKey = `${signal.instanceId}:${targetKey}`;
    if (workflowAutoRunKeyRef.current === runKey) {
      return;
    }
    workflowAutoRunKeyRef.current = runKey;

    void (async () => {
      if (branchReceivers.length > 0) {
        for (const receiver of branchReceivers) {
          if (receiver.replay.target === "branch.replay") {
            await mergeModule.handleReplayBranchTaskHistory(receiver.replay.entry);
          }
        }
      } else if (projectReceivers.length > 0) {
        for (const receiver of projectReceivers) {
          if (receiver.replay.target === "project.replay") {
            await projectsModule.handleReplayProjectWorkflow(receiver.replay);
          }
        }
      } else {
        for (const receiver of deployReceivers) {
          if (receiver.replay.target === "deploy.replay") {
            await deployModule.handleReplayDeployHistory(receiver.replay.entry);
          }
        }
      }
      await workflowSignals.clearWorkflowSignal(signal.instanceId);
    })();
  }, [
    appShell.page,
    busy,
    deployEnabled,
    deployModule,
    mergeEnabled,
    mergeModule,
    projectsAvailable,
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

  async function reloadProjectsAfterConfigSave() {
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
    if (target.page === "merge" && target.branchMode) {
      mergeModule.setMode(target.branchMode);
    }
    if (target.page === "projects") {
      projectsModule.setFinderType("项目");
      if (entry.projectName || entry.projectKey) {
        projectsModule.setFinderQuery(entry.projectName || entry.projectKey || "");
      }
      void projectsModule.loadFinderData();
    }
    appShell.setPage(target.page);
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

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <AppShellLayout
        visibleNavItems={appShell.visibleNavItems}
        activePage={appShell.page}
        onPageChange={appShell.setPage}
        onOpenCommandPalette={openCommandPalette}
        styleMode={appShell.styleMode}
        onStyleModeChange={appShell.setStyleMode}
        selectedProjectKey={appShell.selectedProject}
        onOpenConfigDir={openConfigDir}
        onOpenConfigFile={openConfigFile}
        onOpenNavigationConfigFile={openNavigationConfigFile}
        onProjectConfigSaved={reloadProjectsAfterConfigSave}
        activityItems={activityCenter.items}
        activityAlertCount={activityCenter.stats.running + activityCenter.stats.failed}
        onOpenActivityEntry={openActivityEntry}
        onOpenActivityResource={(entry) => {
          void openActivityResource(entry);
        }}
        onRefreshActivities={activityCenter.refreshDeployActivities}
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
            <Alert
              severity="info"
              icon={<CircularProgress size={16} color="inherit" />}
              sx={{ py: 0 }}
            >
              正在加载页面模块
            </Alert>
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
        projects={appShell.projects}
        selectedProjectKey={appShell.selectedProject}
        runtimeEntries={projectsModule.runtimeEntries}
        shortcutEntries={projectsModule.shortcutEntries}
        onClose={() => setCommandPaletteOpen(false)}
        onPageChange={appShell.setPage}
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
    </ThemeProvider>
  );
}

export default App;
