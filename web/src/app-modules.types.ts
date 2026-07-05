import type {
  ComponentType,
  Dispatch,
  LazyExoticComponent,
  SetStateAction,
} from "react";
import type {
  BranchOption,
  BranchPushAction,
  BranchPushStatus,
  BranchTaskHistoryEntry,
  BranchTaskResponse,
  BranchWorkflowMode,
  BranchWorktreeSummary,
} from "./app-types";
import type {
  ProjectSelectionEntry,
  ProjectSummary,
} from "./hooks/useBranchContext";
import type { BuildRequest } from "./hooks/useBuildContext";
import type { WorkflowSignalsState } from "./hooks/useWorkflowSignals";
import type { WorkflowProjectReplay } from "./lib/workflowSignals";
import type { BuildPageProps } from "./pages/BuildPage";
import type { MergePageProps } from "./pages/MergePage";
import type { ProxyPageProps } from "./pages/ProxyPage";
import type { ProjectsPageProps } from "./pages/ProjectsPage";

export type PageComponent = LazyExoticComponent<ComponentType<any>>;

export type AppPagePropsMap = {
  build: BuildPageProps;
  merge: MergePageProps;
  proxy: ProxyPageProps;
  projects: ProjectsPageProps;
};

export type AppShellContext = {
  enabledPages: Array<"projects" | "merge" | "build" | "proxy">;
  projects: ProjectSummary[];
  buildProjects: ProjectSummary[];
  branchProjects: ProjectSummary[];
  selectedProject: string;
  selectedProjectInfo: ProjectSummary | null;
  setSelectedProject: (projectKey: string) => void;
  setPage: (page: "projects" | "merge" | "build" | "proxy") => void;
};

export type BuildModuleContext = {
  branch: string;
  setBranch: (value: string) => void;
  env: string;
  setEnv: (value: string) => void;
  target: string;
  setTarget: Dispatch<SetStateAction<string>>;
  targetMeta: BuildPageProps["targetMeta"];
  paramValues: BuildPageProps["paramValues"];
  defaultParamValues: BuildPageProps["defaultParamValues"];
  setParamValue: BuildPageProps["onParamChange"];
  setBuildContextLoadedKey: (value: string) => void;
  buildContextStatus: "idle" | "loading" | "ready" | "error";
  buildContextError: string;
  plan: BuildPageProps["plan"];
  buildResult: BuildPageProps["buildResult"];
  buildResultUpdatedAtMs: BuildPageProps["buildResultUpdatedAtMs"];
  buildAutoRefreshTimedOut: boolean;
  visibleBuildHistory: BuildPageProps["buildHistory"];
  handleTriggerBuild: () => Promise<void>;
  handleTriggerBuildRequest: (
    request: BuildRequest,
    busyText?: string,
  ) => Promise<void>;
  handleRefreshBuild: () => Promise<void>;
  handleReplayBuildHistory: BuildPageProps["onReplayBuildHistory"];
  handleOpenBuildRecord: () => Promise<void>;
  handleOpenBuildUrl: BuildPageProps["onOpenBuildUrl"];
  currentBuildRequest: () => BuildRequest;
  loadBuildHistory: () => Promise<void>;
  refreshBuildHistoryStatuses: () => Promise<void>;
  handleClearBuildHistory: () => Promise<void>;
};

export type BranchModuleContext = {
  branchEntries: BranchOption[];
  branchOptions: string[];
  selectedProjectSelection: ProjectSelectionEntry | null;
  handleSyncBranches: (projectKey: string) => Promise<void>;
  branchSyncText: string;
};

export type MergeSelectionContext = {
  mergeSource: string;
  setMergeSource: (value: string) => void;
  mergeTarget: string;
  setMergeTarget: (value: string) => void;
  sourceBranchEntries: BranchOption[];
  targetBranchEntries: BranchOption[];
  sourceBranchOptions: string[];
  targetBranchOptions: string[];
};

export type MergeModuleContext = {
  mode: BranchWorkflowMode;
  setMode: Dispatch<SetStateAction<BranchWorkflowMode>>;
  projectOptions: Array<{ key: string; name: string }>;
  syncSource: string;
  setSyncSource: Dispatch<SetStateAction<string>>;
  syncTargets: string[];
  setSyncTargets: Dispatch<SetStateAction<string[]>>;
  createProjects: string[];
  setCreateProjects: Dispatch<SetStateAction<string[]>>;
  createSource: string;
  setCreateSource: Dispatch<SetStateAction<string>>;
  createTarget: string;
  setCreateTarget: Dispatch<SetStateAction<string>>;
  checkoutSource: string;
  setCheckoutSource: Dispatch<SetStateAction<string>>;
  checkoutDestinationDir: string;
  setCheckoutDestinationDir: Dispatch<SetStateAction<string>>;
  switchTarget: string;
  setSwitchTarget: Dispatch<SetStateAction<string>>;
  pushAction: BranchPushAction;
  setPushAction: Dispatch<SetStateAction<BranchPushAction>>;
  pushCommitMessage: string;
  setPushCommitMessage: Dispatch<SetStateAction<string>>;
  pushStatus: BranchPushStatus | null;
  pushStatusLoading: boolean;
  pushStatusError: string;
  pushStatusUpdatedAtMs: number;
  worktrees: BranchWorktreeSummary[];
  worktreesLoading: boolean;
  worktreesError: string;
  selectedWorktreePath: string;
  setSelectedWorktreePath: (value: string) => void;
  branchTaskResult: BranchTaskResponse | null;
  visibleBranchTaskHistory: BranchTaskHistoryEntry[];
  loadBranchTaskHistory: () => Promise<void>;
  loadProjectWorktrees: (
    projectKey?: string,
  ) => Promise<BranchWorktreeSummary[] | undefined>;
  loadPushStatus: (
    projectKey?: string,
    repoPath?: string,
  ) => Promise<BranchPushStatus | null | undefined>;
  handleClearBranchTaskHistory: () => Promise<void>;
  handleChooseCheckoutDirectory: () => Promise<void>;
  handleChooseWorktreeDirectory: () => Promise<void>;
  handleExecuteSync: () => Promise<void>;
  handleExecuteCreate: () => Promise<void>;
  handleExecuteCheckout: () => Promise<void>;
  handleExecuteSwitch: () => Promise<void>;
  handleExecutePush: () => Promise<void>;
  handleReplayBranchTaskHistory: MergePageProps["onReplayBranchTaskHistory"];
  handleOpenTaskOutput: (path: string) => Promise<void>;
};

export type ProjectsModuleContext = {
  finderTypeOptions: ProjectsPageProps["finderTypeOptions"];
  finderType: ProjectsPageProps["finderType"];
  finderTypeCounts: ProjectsPageProps["finderTypeCounts"];
  finderQuickFilterOptions: ProjectsPageProps["finderQuickFilterOptions"];
  finderQuickFilter: ProjectsPageProps["finderQuickFilter"];
  finderQuickFilterCounts: ProjectsPageProps["finderQuickFilterCounts"];
  finderCategories: ProjectsPageProps["finderCategories"];
  finderCategory: ProjectsPageProps["finderCategory"];
  finderCategoryCounts: ProjectsPageProps["finderCategoryCounts"];
  finderQuery: string;
  runtimeEntries: ProjectsPageProps["runtimeEntries"];
  filteredRuntimeEntries: ProjectsPageProps["filteredRuntimeEntries"];
  shortcutEntries: ProjectsPageProps["shortcutEntries"];
  filteredShortcutEntries: ProjectsPageProps["filteredShortcutEntries"];
  favoriteProjectKeys: ProjectsPageProps["favoriteProjectKeys"];
  recentProjectKeys: ProjectsPageProps["recentProjectKeys"];
  favoriteShortcutKeys: ProjectsPageProps["favoriteShortcutKeys"];
  recentShortcutKeys: ProjectsPageProps["recentShortcutKeys"];
  selectedDebugProfileKeys: ProjectsPageProps["selectedDebugProfileKeys"];
  setFinderType: ProjectsPageProps["onFinderTypeChange"];
  setFinderQuickFilter: ProjectsPageProps["onFinderQuickFilterChange"];
  setFinderCategory: ProjectsPageProps["onFinderCategoryChange"];
  setFinderQuery: ProjectsPageProps["onFinderQueryChange"];
  toggleProjectFavorite: ProjectsPageProps["onToggleProjectFavorite"];
  toggleShortcutFavorite: ProjectsPageProps["onToggleShortcutFavorite"];
  setProjectDebugProfile: ProjectsPageProps["onProjectDebugProfileChange"];
  markShortcutUsed: ProjectsPageProps["onMarkShortcutUsed"];
  loadFinderData: (options?: { force?: boolean }) => Promise<void>;
  loadProjectRuntimes: () => Promise<void>;
  handleOpenFinderEntry: (
    entry: ProjectsPageProps["shortcutEntries"][number]["entry"],
  ) => Promise<boolean>;
  handleStartRuntime: (
    projectKey: string,
    debugProfileKey?: string,
    envOverrides?: Record<string, string>,
  ) => Promise<void>;
  handleStopRuntime: (projectKey: string) => Promise<void>;
  handleRunBuild: (projectKey: string) => Promise<void>;
  handleStopBuild: (projectKey: string) => Promise<void>;
  handleOpenBuildOutput: (projectKey: string) => Promise<void>;
  handleFocusRuntime: (projectKey: string, debugProfileKey?: string) => Promise<void>;
  handleOpenProjectDirectory: (projectKey: string) => Promise<void>;
  handleReplayProjectWorkflow: (
    replay: WorkflowProjectReplay,
    options?: {
      chainId?: string | null;
      parentId?: string | null;
      stepLabel?: string | null;
    },
  ) => Promise<void>;
};

export type ProxyModuleContext = {
  dashboard: ProxyPageProps["dashboard"];
  selectedProfileId: ProxyPageProps["selectedProfileId"];
  loading: boolean;
  busy: string;
  error: string;
  setSelectedProfileId: ProxyPageProps["onSelectedProfileChange"];
  loadProxyDashboard: () => Promise<void>;
  saveProxyProfile: ProxyPageProps["onSaveProfile"];
  deleteProxyProfile: ProxyPageProps["onDeleteProfile"];
  saveProxyRule: ProxyPageProps["onSaveRule"];
  deleteProxyRule: ProxyPageProps["onDeleteRule"];
  startProxyProfile: ProxyPageProps["onStartProfile"];
  stopProxyProfile: ProxyPageProps["onStopProfile"];
  clearProxyEvents: ProxyPageProps["onClearEvents"];
  exportProxyProfilePack: ProxyPageProps["onExportProfilePack"];
  importProxyProfilePack: ProxyPageProps["onImportProfilePack"];
};

export type BuildModulePropsContext = {
  appShell: AppShellContext;
  branchContext: BranchModuleContext;
  mergeSelection: MergeSelectionContext;
  buildModule: BuildModuleContext;
  mergeModule: MergeModuleContext;
  projectsModule: ProjectsModuleContext;
  proxyModule: ProxyModuleContext;
  workflowSignals: WorkflowSignalsState;
  busy: string;
};

export type ModuleRuntimeContext = {
  appShell: {
    loadProjects: (
      preferredProjectKey?: string,
      replaceSelection?: boolean,
    ) => Promise<void>;
  };
  buildModule: Pick<BuildModuleContext, "loadBuildHistory">;
  mergeModule: Pick<MergeModuleContext, "loadBranchTaskHistory">;
  projectsModule: Pick<ProjectsModuleContext, "loadFinderData">;
  proxyModule: Pick<ProxyModuleContext, "loadProxyDashboard">;
};

export type AppModuleDefinition<TKey extends keyof AppPagePropsMap> = {
  key: TKey;
  label: string;
  shortLabel: string;
  component: PageComponent;
  buildProps: (context: BuildModulePropsContext) => AppPagePropsMap[TKey];
  loadOnStartup?: (context: ModuleRuntimeContext) => Promise<void>;
};
