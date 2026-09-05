import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircularProgress, CssBaseline, ThemeProvider } from "@mui/material";
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
import { useActivityPreferences } from "./hooks/useActivityPreferences";
import { useActiveSessions } from "./hooks/useActiveSessions";
import { useActiveSessionEvents } from "./hooks/useActiveSessionEvents";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useBranchContext } from "./hooks/useBranchContext";
import { useMergeSelection } from "./hooks/useMergeSelection";
import { useBuildModule } from "./hooks/useBuildModule";
import {
  branchWorkflowReferenceProject,
  useBranchWorkflowModule,
} from "./hooks/useBranchWorkflowModule";
import { usePageScrollReset } from "./hooks/usePageScrollReset";
import { useProjectsModule } from "./hooks/useProjectsModule";
import { useProxyModule } from "./hooks/useProxyModule";
import { useWorkflowSignals } from "./hooks/useWorkflowSignals";
import type {
  CreateProjectWorkspacePayload,
  InitDemandWorkspacePayload,
  InitDemandWorkspaceResult,
  LinkExecutionReport,
  ProjectManagementOpenRequest,
  WorkspaceConfigFocusRequest,
} from "./app-types";
import type { ActivityEntry } from "./lib/activityCenter";
import type {
  ActiveSession,
  ActiveSessionAction,
  ActiveSessionActionResult,
  ActiveSessionPortInspection,
} from "./lib/activeSessions";
import {
  linkActivityDraft,
  linkActivityFailurePatch,
  linkActivityResultPatch,
  linkCheckActivityDraft,
  linkCheckActivityFailurePatch,
  linkCheckActivityResultPatch,
  linkCheckFailureReason,
  linkCheckPassed,
} from "./lib/linkActivities";
import type { TrayPinnedAction } from "./lib/trayPins";
import {
  executeTrayPinnedActionWorkflow,
  TRAY_DOMAIN_ACTION_REQUESTED_EVENT,
} from "./lib/trayActionExecution";
import { disposeTauriListener } from "./lib/tauriEvents";
import { createAppTheme } from "./theme";
import { useI18n } from "./i18n";

type AppInfo = {
  configDir?: string;
  configPath?: string;
  workspacesPath?: string;
  navigationPath?: string;
  linksPath?: string;
};

type CancelResourceActionResponse = {
  operationId: string;
  accepted: boolean;
};

const WORKFLOW_AUTO_OPEN_WINDOW_MS = 10 * 60 * 1000;

function isFreshWorkflowSignal(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp <= WORKFLOW_AUTO_OPEN_WINDOW_MS
  );
}

function App() {
  const { t } = useI18n();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [activityConfigSourceRequest, setActivityConfigSourceRequest] =
    useState<{
      activityId: string;
      sourceId: string;
      nonce: number;
    } | null>(null);

  const appShell = useAppShell({ setError });
  const [workspaceConfigOpenSignal, setWorkspaceConfigOpenSignal] = useState(0);
  const [workspaceConfigFocusRequest, setWorkspaceConfigFocusRequest] =
    useState<WorkspaceConfigFocusRequest | null>(null);
  const [resourceConfigOpenSignal, setResourceConfigOpenSignal] = useState(0);
  const [projectManagementOpenRequest, setProjectManagementOpenRequest] =
    useState<ProjectManagementOpenRequest | null>(null);
  const openWorkspaceConfig = useCallback(() => {
    setWorkspaceConfigFocusRequest(null);
    appShell.setPage("overview");
    setWorkspaceConfigOpenSignal((current) => current + 1);
  }, [appShell]);
  const openResourceConfig = useCallback(() => {
    appShell.setPage("resources");
    setResourceConfigOpenSignal((current) => current + 1);
  }, [appShell]);
  const handleWorkspaceConfigOpenSignal = useCallback((signal: number) => {
    setWorkspaceConfigOpenSignal((current) =>
      current === signal ? 0 : current,
    );
  }, []);
  const handleResourceConfigOpenSignal = useCallback((signal: number) => {
    setResourceConfigOpenSignal((current) =>
      current === signal ? 0 : current,
    );
  }, []);
  const openProjectManagementTarget = useCallback(
    (projectKey: string, target: ProjectManagementOpenRequest["target"]) => {
      appShell.setSelectedProject(projectKey);
      appShell.setProjectManagementView("projects");
      appShell.setPage("projectManagement");
      setProjectManagementOpenRequest((current) => ({
        nonce: (current?.nonce ?? 0) + 1,
        projectKey,
        target,
      }));
    },
    [appShell],
  );
  const handleProjectManagementOpenRequest = useCallback((nonce: number) => {
    setProjectManagementOpenRequest((current) =>
      current?.nonce === nonce ? null : current,
    );
  }, []);
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
  const { preferences: activityPreferences } = useActivityPreferences();
  const activityCenter = useActivityCenter({
    setError,
    projectKeys: activeProjectKeys,
    includeAllProjects: activeProjectWorkspace?.includeAllProjects ?? true,
    configActivityVisibility: activityPreferences.configActivityVisibility,
  });
  const workflowSignals = useWorkflowSignals({ setError });
  const workflowAutoRunKeyRef = useRef("");
  const projectManagementAvailable =
    appShell.storageHydrated &&
    appShell.enabledPages.includes("projectManagement");
  const resourcesAvailable =
    appShell.storageHydrated && appShell.enabledPages.includes("resources");
  const projectsAvailable = projectManagementAvailable || resourcesAvailable;
  const buildAvailable =
    appShell.storageHydrated &&
    (appShell.enabledPages.includes("build") || projectManagementAvailable);
  const mergeAvailable =
    appShell.storageHydrated &&
    (appShell.enabledPages.includes("merge") || projectManagementAvailable);
  const proxyAvailable =
    appShell.storageHydrated && appShell.enabledPages.includes("proxy");
  const projectManagementBuildActive =
    appShell.page === "projectManagement" &&
    appShell.projectManagementView === "build";
  const projectManagementGitActive =
    appShell.page === "projectManagement" &&
    appShell.projectManagementView === "git";
  const projectsModuleActive =
    appShell.page === "resources" ||
    (appShell.page === "projectManagement" &&
      appShell.projectManagementView === "projects");
  const buildEnabled =
    buildAvailable &&
    (appShell.page === "build" || projectManagementBuildActive);
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
    if (
      !appShell.selectedProject ||
      !branchProjects.some((item) => item.key === appShell.selectedProject)
    ) {
      if (branchProjects[0]) {
        appShell.setSelectedProject(branchProjects[0].key);
      }
    }
  }, [appShell, branchProjects, mergeEnabled]);

  useEffect(() => {
    if (!buildEnabled) {
      return;
    }
    if (
      !appShell.selectedProject ||
      !buildProjects.some((item) => item.key === appShell.selectedProject)
    ) {
      if (buildProjects[0]) {
        appShell.setSelectedProject(buildProjects[0].key);
      }
    }
  }, [appShell, buildEnabled, buildProjects]);

  const mergeModule = useBranchWorkflowModule({
    enabled: mergeEnabled,
    activeProjectWorkspaceKey: appShell.activeProjectWorkspaceKey,
    projects: branchProjects,
    selectedProject: appShell.selectedProject,
    setBusy,
    setError,
    workflowBroadcastRules: workflowSignals.rules.broadcasts,
    emitWorkflowSignals: workflowSignals.emitWorkflowSignals,
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
  });
  const branchContextProject = mergeEnabled
    ? branchWorkflowReferenceProject(
        mergeModule.mode,
        appShell.selectedProject,
        mergeModule.syncProjects,
        mergeModule.createProjects,
      )
    : appShell.selectedProject;
  const branchContextProjectInfo = useMemo(
    () =>
      appShell.projects.find(
        (project) => project.key === branchContextProject,
      ) ?? null,
    [appShell.projects, branchContextProject],
  );
  const branchContextEnabled =
    branchEnabled && Boolean(branchContextProjectInfo?.supportsBranch);
  const branchContext = useBranchContext({
    enabled: branchContextEnabled,
    workspaceKey: appShell.activeProjectWorkspaceKey,
    selectedProject: branchContextProject,
    repoPath: branchContextProjectInfo?.repoPath,
    branchCache: appShell.branchCache,
    setBranchCache: appShell.setBranchCache,
    projectSelections: appShell.projectSelections,
    setBusy,
    setError,
  });
  const mergeSelection = useMergeSelection({
    enabled: mergeEnabled,
    selectedProject: branchContextProject,
    selectedProjectInfo: branchContextProjectInfo,
    branchEntries: branchContext.branchEntries,
    branchOptions: branchContext.branchOptions,
    selectionStorageKey: branchContext.selectionStorageKey,
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
  }, [activityCenter.items.length, buildAvailable, buildModule]);

  useEffect(() => {
    if (!mergeEnabled) {
      return;
    }
    void mergeModule.loadBranchTaskHistory();
  }, [appShell.activeProjectWorkspaceKey, mergeEnabled]);
  const projectsModule = useProjectsModule({
    enabled: appShell.storageHydrated,
    active: projectsModuleActive,
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
    recordActivity: activityCenter.recordActivity,
    updateActivity: activityCenter.updateActivity,
  });
  const activeSessions = useActiveSessions({
    enabled: appShell.storageHydrated,
    workspaceKey: appShell.activeProjectWorkspaceKey,
    runtimeEntries: projectsModule.runtimeEntries,
    activeProjectKeys,
    includeAllProjects: activeProjectWorkspace?.includeAllProjects ?? true,
  });
  const requestActiveSessionsRefresh = useActiveSessionEvents({
    enabled: appShell.storageHydrated,
    workspaceKey: appShell.activeProjectWorkspaceKey,
    refresh: () => refreshActiveSessions({ silent: true }),
  });

  useEffect(() => {
    if (!appShell.storageHydrated) {
      return;
    }
    void projectsModule.loadProjectRuntimes();
  }, [appShell.activeProjectWorkspaceKey, appShell.storageHydrated]);
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
        void trayDomainActionHandlerRef
          .current(event.payload)
          .catch((reason) => {
            setError(String(reason));
          });
      },
    )
      .then((nextUnlisten) => {
        if (disposed) {
          disposeTauriListener(nextUnlisten);
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setError(`监听托盘操作失败：${String(reason)}`);
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
      workspaceConfigFocusRequest,
      resourceConfigOpenSignal,
      onWorkspaceConfigOpenHandled: handleWorkspaceConfigOpenSignal,
      onResourceConfigOpenHandled: handleResourceConfigOpenSignal,
      projectManagementOpenRequest,
      onOpenWorkspaceConfig: openWorkspaceConfig,
      onOpenResourceConfig: openResourceConfig,
      onOpenProjectManagementTarget: openProjectManagementTarget,
      onProjectManagementOpenRequestHandled: handleProjectManagementOpenRequest,
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
    activityCenter: {
      items: activityCenter.allItems,
      recordActivity: activityCenter.recordActivity,
      updateActivity: activityCenter.updateActivity,
    },
    busy,
    workflowSignals,
  });

  useAppBootstrap({
    appShell,
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
      ? workflowSignals
          .matchingReceivers(signal)
          .filter(
            (receiver) =>
              receiver.replay.target === "build.replay" ||
              receiver.replay.target === "deploy.replay",
          )
      : [];
    const branchReceivers = signal
      ? workflowSignals
          .matchingReceivers(signal)
          .filter((receiver) => receiver.replay.target === "branch.replay")
      : [];
    const projectReceivers = signal
      ? workflowSignals
          .matchingReceivers(signal)
          .filter((receiver) => receiver.replay.target === "project.replay")
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
      try {
        if (workflowSignals.isWorkflowRunCancelled(chainId)) {
          return;
        }
        if (branchReceivers.length > 0) {
          for (const receiver of branchReceivers) {
            if (receiver.replay.target === "branch.replay") {
              await mergeModule.handleReplayBranchTaskHistory(
                receiver.replay.entry,
                {
                  force: true,
                  chainId,
                  parentId,
                  stepLabel: receiver.label || "重播分支",
                },
              );
              if (workflowSignals.isWorkflowRunCancelled(chainId)) {
                return;
              }
            }
          }
        }
        if (projectReceivers.length > 0) {
          for (const receiver of projectReceivers) {
            if (receiver.replay.target === "project.replay") {
              await projectsModule.handleReplayProjectWorkflow(
                receiver.replay,
                {
                  chainId,
                  parentId,
                  stepLabel: receiver.label || "重播项目",
                },
              );
              if (workflowSignals.isWorkflowRunCancelled(chainId)) {
                return;
              }
            }
          }
        }
        if (buildReceivers.length > 0) {
          for (const receiver of buildReceivers) {
            if (
              receiver.replay.target === "build.replay" ||
              receiver.replay.target === "deploy.replay"
            ) {
              await buildModule.handleReplayBuildHistory(
                receiver.replay.entry,
                {
                  force: true,
                  chainId,
                  parentId,
                  stepLabel: receiver.label || "触发构建",
                },
              );
              if (workflowSignals.isWorkflowRunCancelled(chainId)) {
                return;
              }
            }
          }
        }
      } catch (reason) {
        setError(`联动操作失败：${String(reason)}`);
      } finally {
        await workflowSignals.clearWorkflowSignal(signal.instanceId);
        workflowAutoRunKeyRef.current = "";
      }
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

  async function createProjectWorkspace(
    payload: CreateProjectWorkspacePayload,
  ) {
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
      const result = await invoke<InitDemandWorkspaceResult>(
        "init_demand_workspace_config",
        {
          payload,
        },
      );
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
        projectsModule.setFinderQuery(
          entry.projectName || entry.projectKey || "",
        );
      }
      void projectsModule.loadFinderData();
    }
    if (target.page === "resources") {
      if (projectsModule.finderType === "项目") {
        projectsModule.setFinderType("网站");
      }
      void projectsModule.loadFinderData();
    }
    if (
      target.page === "overview" &&
      target.workspaceKey &&
      target.workspaceView
    ) {
      setWorkspaceConfigFocusRequest({
        nonce: Date.now(),
        view: target.workspaceView,
        workspaceKey: target.workspaceKey,
      });
      setWorkspaceConfigOpenSignal((current) => current + 1);
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
        activityId: entry.id,
        sourceId: action.sourceId,
        nonce: Date.now(),
      });
      return;
    }
    if (action.kind === "linkRecover") {
      const sourceId = action.sourceId || null;
      const proxySourceId = action.proxySourceId || null;
      const runtimeSourceId = action.runtimeSourceId || null;
      const workspaceKey = action.workspaceKey || null;
      setBusy("正在检查联调链路");
      setError("");
      const checkActivityId = activityCenter.recordActivity(
        linkCheckActivityDraft(
          action.linkKey,
          action.linkName,
          action.replayAction,
        ),
      );
      try {
        const checkReport = await invoke<LinkExecutionReport>("check_link", {
          sourceId,
          proxySourceId,
          runtimeSourceId,
          workspaceKey,
          key: action.linkKey,
        });
        activityCenter.updateActivity(
          checkActivityId,
          linkCheckActivityResultPatch(checkReport),
        );
        if (!linkCheckPassed(checkReport)) {
          setError(`检查未通过：${linkCheckFailureReason(checkReport)}`);
          return;
        }

        setBusy(
          action.replayAction === "stop"
            ? "正在重新停止联调链路"
            : "正在重新启动联调链路",
        );
        const replayActivityId = activityCenter.recordActivity(
          linkActivityDraft(
            action.linkKey,
            action.linkName,
            action.replayAction,
            sourceId,
          ),
        );
        try {
          const report = await invoke<LinkExecutionReport>(
            action.replayAction === "stop" ? "stop_link" : "run_link",
            {
              sourceId,
              proxySourceId,
              runtimeSourceId,
              workspaceKey,
              key: action.linkKey,
              activityId: replayActivityId,
              operationOrigin: "app",
            },
          );
          const replayPatch = linkActivityResultPatch(
            report,
            action.replayAction,
            sourceId,
            workspaceKey,
            proxySourceId,
            runtimeSourceId,
          );
          activityCenter.updateActivity(replayActivityId, replayPatch);
          if (replayPatch.status === "success") {
            activityCenter.updateActivity(entry.id, {
              action: null,
              acknowledgedAt: new Date().toISOString(),
              updatedAt: entry.updatedAt,
            });
          } else {
            setError(linkCheckFailureReason(report));
          }
        } catch (reason) {
          const message = String(reason);
          activityCenter.updateActivity(
            replayActivityId,
            linkActivityFailurePatch(
              action.linkKey,
              action.linkName,
              action.replayAction,
              sourceId,
              message,
              workspaceKey,
              proxySourceId,
              runtimeSourceId,
            ),
          );
          setError(message);
        }
      } catch (reason) {
        const message = String(reason);
        activityCenter.updateActivity(
          checkActivityId,
          linkCheckActivityFailurePatch(message),
        );
        setError(message);
      } finally {
        setBusy("");
      }
      return;
    }
    if (action.kind === "branchReplay") {
      setError("");
      try {
        const success = await mergeModule.handleReplayBranchRequest(
          action.replay,
          {
            force: true,
            origin: "app",
            stepLabel: `重试${entry.title}`,
          },
        );
        if (success) {
          activityCenter.updateActivity(entry.id, {
            action: null,
            acknowledgedAt: new Date().toISOString(),
            updatedAt: entry.updatedAt,
          });
        }
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }
    if (action.kind === "buildRecover") {
      setError("");
      try {
        const recordedWorkspaceKey = action.workspaceKey?.trim() || "";
        if (
          recordedWorkspaceKey &&
          recordedWorkspaceKey !== appShell.activeProjectWorkspaceKey
        ) {
          await changeProjectWorkspace(recordedWorkspaceKey);
        }
        openActivityEntry(entry);
        const success = await buildModule.handleTriggerBuildRequest(
          action.request,
          "正在重新规划并重试构建",
          {
            force: true,
            origin: "app",
            workspaceKey: action.workspaceKey,
            stepLabel: `重试${entry.title}`,
          },
        );
        if (success) {
          activityCenter.updateActivity(entry.id, {
            action: null,
            acknowledgedAt: new Date().toISOString(),
            updatedAt: entry.updatedAt,
          });
        }
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }
    if (action.kind === "runtimeRecover") {
      setError("");
      try {
        const success =
          action.replayAction === "stop"
            ? await projectsModule.handleStopRuntime(action.projectKey)
            : await projectsModule.handleStartRuntime(
                action.projectKey,
                action.debugProfileKey || undefined,
                action.envOverrides ?? undefined,
                action.expectedPort ?? undefined,
              );
        if (success) {
          activityCenter.updateActivity(entry.id, {
            action: null,
            acknowledgedAt: new Date().toISOString(),
            updatedAt: entry.updatedAt,
          });
        }
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }
    if (action.kind === "proxyRecover") {
      setError("");
      try {
        const dashboard =
          action.replayAction === "stop"
            ? await proxyModule.stopProxyProfile(
                action.profileId,
                action.sourceId || undefined,
              )
            : await proxyModule.startProxyProfile(
                action.profileId,
                action.sourceId || undefined,
              );
        const status = dashboard.statuses.find(
          (item) => item.profileId === action.profileId,
        );
        const success =
          action.replayAction === "stop"
            ? !status?.running
            : Boolean(status?.running);
        if (success) {
          activityCenter.updateActivity(entry.id, {
            action: null,
            acknowledgedAt: new Date().toISOString(),
            updatedAt: entry.updatedAt,
          });
        } else {
          setError(
            action.replayAction === "stop"
              ? "代理停止后仍在监听，请查看新活动的诊断详情"
              : "代理启动后未监听，请查看新活动的诊断详情",
          );
        }
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }

    setBusy("正在重新加载配置");
    setError("");
    try {
      await appShell.reloadWorkspaceConfiguration();
      if (projectsAvailable) {
        await projectsModule.loadFinderData({ force: true });
      }
      const resolvedAt = new Date().toISOString();
      activityCenter.syncActivities(
        {
          kind: "config",
          actionKind: "reloadConfig",
        },
        {
          status: "success",
          summary: "已重新加载并应用最新配置",
          detail: null,
          action: null,
          acknowledgedAt: resolvedAt,
        },
      );
    } catch (reason) {
      const message = String(reason);
      setError(message);
      activityCenter.syncActivities(
        {
          kind: "config",
          actionKind: "reloadConfig",
        },
        {
          status: "failed",
          summary: "重新加载配置失败",
          detail: message,
          acknowledgedAt: null,
        },
      );
    } finally {
      setBusy("");
    }
  }

  async function refreshActiveSessions(options: { silent?: boolean } = {}) {
    await Promise.all([
      projectsModule.loadProjectRuntimes(),
      activeSessions.refresh(options),
    ]);
  }

  async function runActiveSessionAction(
    session: ActiveSession,
    action: ActiveSessionAction,
  ): Promise<ActiveSessionActionResult> {
    setError("");
    try {
      if (action === "inspect") {
        if (!session.port) {
          return { ok: false, message: "当前资源没有可诊断的监听端口。" };
        }
        const inspection = await invoke<ActiveSessionPortInspection>(
          "inspect_active_session_port",
          {
            port: session.port,
            projectKey: session.projectKey ?? null,
            proxySourceId: session.proxySourceId ?? null,
            proxyProfileId: session.proxyProfileId ?? null,
          },
        );
        return { ok: true, inspection };
      }

      if (action === "details") {
        if (session.kind === "action") {
          appShell.setPage("resources");
        } else if (
          session.kind === "proxy" &&
          session.proxyProfileId &&
          session.proxySourceId
        ) {
          await proxyModule.loadProxyDashboard({
            sourceId: session.proxySourceId,
          });
          proxyModule.setSelectedProfileId(session.proxyProfileId);
          appShell.setPage("proxy");
        } else if (session.projectKey) {
          openProjectManagementTarget(session.projectKey, {
            kind: "runtimePanel",
            tab: "overview",
          });
        }
        return { ok: true };
      }

      if (action === "openLog" && session.logPath) {
        await invoke("open_external_resource", {
          kind: "localPath",
          value: session.logPath,
        });
        return { ok: true };
      }

      let mutationSucceeded = true;
      if (session.kind === "action") {
        if (action === "stop" && session.operationId) {
          const response = await invoke<CancelResourceActionResponse>(
            "cancel_resource_action",
            { operationId: session.operationId },
          );
          mutationSucceeded = response.accepted;
        }
      } else if (session.kind === "proxy") {
        if (
          action === "stop" &&
          session.proxyProfileId &&
          session.proxySourceId
        ) {
          await proxyModule.stopProxyProfile(
            session.proxyProfileId,
            session.proxySourceId,
          );
        }
      } else if (session.projectKey) {
        if (action === "adopt") {
          mutationSucceeded = await projectsModule.handleAdoptRuntime(
            session.projectKey,
          );
        } else if (action === "focus") {
          await projectsModule.handleFocusRuntime(session.projectKey);
        } else if (action === "openDirectory") {
          await projectsModule.handleOpenProjectDirectory(session.projectKey);
        } else if (action === "openOutput") {
          await projectsModule.handleOpenBuildOutput(session.projectKey);
        } else if (action === "stop") {
          if (session.kind === "build") {
            mutationSucceeded = await projectsModule.handleStopBuild(
              session.projectKey,
            );
          } else {
            mutationSucceeded = await projectsModule.handleStopRuntime(
              session.projectKey,
            );
          }
        }
      }
      return mutationSucceeded
        ? {
            ok: true,
            message:
              action === "adopt"
                ? "已纳入 rDevTool 管理"
                : action === "stop"
                  ? session.kind === "action"
                    ? "Action 已请求停止"
                    : "运行资源已停止"
                  : null,
          }
        : {
            ok: false,
            message: "操作未完成，请查看活动记录或页面提示。",
          };
    } catch (reason) {
      const message = String(reason);
      setError(message);
      return { ok: false, message };
    } finally {
      if (action === "adopt" || action === "stop") {
        requestActiveSessionsRefresh({ immediate: true });
      }
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
        activityAlertCount={activityCenter.stats.attention}
        activeSessions={activeSessions.sessions}
        activeSessionsLoading={activeSessions.loading}
        activeSessionsError={activeSessions.error}
        onOpenActivityEntry={openActivityEntry}
        onOpenActivityResource={(entry) => {
          void openActivityResource(entry);
        }}
        onRunActivityAction={runActivityAction}
        onRefreshActivities={activityCenter.refreshBuildActivities}
        onResolveActivityEntry={(entry) => {
          activityCenter.resolveActivity(entry.id);
        }}
        onResolveActivityEntries={(entries) => {
          activityCenter.resolveActivities(entries.map((entry) => entry.id));
        }}
        onClearHandledActivities={() => {
          void activityCenter.clearHandledActivities().catch((reason) => {
            setError(String(reason));
          });
        }}
        onRefreshActiveSessions={refreshActiveSessions}
        onRunActiveSessionAction={runActiveSessionAction}
        busy={busy}
        error={error}
      >
        <Suspense
          fallback={
            <div
              className="page-loading-strip"
              role="status"
              aria-live="polite"
            >
              <CircularProgress size={16} thickness={5} />
              {t("正在加载页面模块")}
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
        onStartRuntime={async (projectKey) => {
          await projectsModule.handleStartRuntime(projectKey);
        }}
        onStopRuntime={async (projectKey) => {
          await projectsModule.handleStopRuntime(projectKey);
        }}
        onRunBuild={projectsModule.handleRunBuild}
        onStopBuild={async (projectKey) => {
          await projectsModule.handleStopBuild(projectKey);
        }}
        onOpenBuildOutput={projectsModule.handleOpenBuildOutput}
        onFocusRuntime={projectsModule.handleFocusRuntime}
        onOpenProjectDirectory={projectsModule.handleOpenProjectDirectory}
      />
      <ConfigSourceManagerDialog
        key={activityConfigSourceRequest?.nonce ?? "activity-config-source"}
        open={Boolean(activityConfigSourceRequest)}
        initialSourceId={activityConfigSourceRequest?.sourceId}
        compareOnOpen
        onCompared={() => {
          const activityId = activityConfigSourceRequest?.activityId;
          if (!activityId) {
            return;
          }
          activityCenter.updateActivity(activityId, {
            status: "info",
            summary: "已查看配置源差异",
            action: null,
            acknowledgedAt: new Date().toISOString(),
          });
        }}
        onClose={() => setActivityConfigSourceRequest(null)}
      />
      <AppExitDialog onError={setError} />
    </ThemeProvider>
  );
}

export default App;
