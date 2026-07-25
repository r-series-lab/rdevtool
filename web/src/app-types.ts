import type { PageKey } from "./app-shell";

export type ProjectManagementViewKey = "projects" | "build" | "git";

export type CommitInfo = {
  shortHash: string;
  subject: string;
  committedAt: string;
};

export type BranchOption = {
  name: string;
  updatedAt: string;
  updatedTs: number;
};

export type BuildHistoryEntry = {
  historyKey: string;
  workspaceKey?: string | null;
  projectInstancePath?: string | null;
  projectKey: string;
  projectName: string;
  mode: string;
  env: string;
  branch: string;
  stateKey: string;
  stateLabel: string;
  detail: string;
  queueUrl?: string | null;
  buildUrl?: string | null;
  params?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
};

export type DeployHistoryEntry = BuildHistoryEntry;

export type MergeHistoryEntry = {
  historyKey: string;
  workspaceKey?: string | null;
  projectInstancePath?: string | null;
  projectKey: string;
  projectName: string;
  sourceBranch: string;
  targetBranch: string;
  success: boolean;
  remote: boolean;
  summary: string;
  detail: string;
  mergedCommit?: string | null;
  sourceCommit?: CommitInfo | null;
  targetCommit?: CommitInfo | null;
  createdAt: string;
};

export type BranchWorkflowMode = "sync" | "create" | "checkout" | "switch" | "push";

export type BranchPushAction = "pushOnly" | "commitAndPush";

export type BranchPushFileStatus = {
  path: string;
  code: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
};

export type BranchPushStatus = {
  projectKey: string;
  projectName: string;
  repoPath: string;
  currentBranch: string;
  upstreamBranch?: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  canPush: boolean;
  detached: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  files: BranchPushFileStatus[];
  latestCommit?: CommitInfo | null;
};

export type BranchFileDiffResponse = {
  projectKey: string;
  projectName: string;
  repoPath: string;
  path: string;
  mode: string;
  diff: string;
  truncated: boolean;
  binary: boolean;
  warnings: string[];
};

export type BranchWorktreeSummary = {
  projectKey: string;
  projectName: string;
  repoPath: string;
  label: string;
  currentBranch: string;
  detached: boolean;
  clean: boolean;
  ahead: number;
  behind: number;
  isDefault: boolean;
  isGitWorktree: boolean;
  isWorkspaceInstance: boolean;
  managed: boolean;
  statusKey: string;
  statusLabel: string;
  detail: string;
  latestCommit?: CommitInfo | null;
};

export type BranchTaskItemResult = {
  projectKey: string;
  projectName: string;
  sourceBranch: string;
  targetBranch?: string | null;
  outputPath?: string | null;
  checkoutMode?: "worktree" | "clone" | null;
  fallbackReason?: string | null;
  success: boolean;
  statusKey: string;
  statusLabel: string;
  summary: string;
  detail: string;
  remote: boolean;
  commit?: CommitInfo | null;
};

export type BranchTaskResponse = {
  taskKind: BranchWorkflowMode;
  success: boolean;
  summary: string;
  detail: string;
  items: BranchTaskItemResult[];
};

export type BranchTaskReplayCommand =
  | "execute_branch_sync_task"
  | "execute_branch_create_task"
  | "checkout_branch_to_directory_task"
  | "execute_branch_switch_task"
  | "execute_branch_push_task";

export type BranchTaskReplayRequest = {
  command: BranchTaskReplayCommand;
  busyText: string;
  request: Record<string, unknown>;
  refreshPushStatusProject?: string | null;
  clearPushCommitMessageOnSuccess?: boolean;
};

export type BranchTaskHistoryEntry = BranchTaskResponse & {
  id: string;
  createdAt: string;
  workspaceKey?: string | null;
  replay?: BranchTaskReplayRequest | null;
};

export type OperationEventEntry = {
  version: number;
  id: string;
  origin: "app" | "cli" | "tray";
  workspaceKey: string;
  domain: string;
  action: string;
  state: "running" | "success" | "failed" | "info";
  title: string;
  summary: string;
  detail: string;
  projectKey?: string | null;
  projectName?: string | null;
  relatedHistoryKeys: string[];
  payload?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceAppPreferences = {
  styleMode: string;
  defaultPage?: PageKey | null;
  enabledPages: PageKey[];
  activeWorkspace?: string | null;
};

export type AppExitRuntimePolicy = "ask" | "keep" | "stop";

export type ProjectWorkspaceSummary = {
  key: string;
  name: string;
  description?: string | null;
  active: boolean;
  system: boolean;
  workspaceType: string;
  workspaceTypeLabel: string;
  projectCount: number;
  resourceCount: number;
  includeAllProjects: boolean;
  includeAllNavigation: boolean;
  rootDir?: string | null;
  resourceDir?: string | null;
  worklogPath?: string | null;
  worklogExists: boolean;
  worklogAutoRecord: boolean;
  workspaceKind: string;
  projectScopeLabel: string;
  navigationScopeLabel: string;
};

export type ProjectWorkspaceState = {
  activeKey: string;
  workspacesDir: string;
  workspaces: ProjectWorkspaceSummary[];
};

export type CreateProjectWorkspacePayload = {
  key: string;
  name: string;
  description?: string | null;
  workspaceType?: string | null;
  rootDir?: string | null;
  resourceDir?: string | null;
  worklogFile?: string | null;
  createWorklog: boolean;
  worklogAutoRecord: boolean;
  independentDir: boolean;
  copyCurrent: boolean;
  copyFromWorkspaceKey?: string | null;
  activate: boolean;
};

export type InitDemandWorkspacePayload = {
  key?: string | null;
  demandId?: string | null;
  name: string;
  description?: string | null;
  workspaceType?: string | null;
  requirementDir: string;
  repoPath: string;
  project?: string | null;
  branch?: string | null;
  rootDir?: string | null;
  resourceDir?: string | null;
  worklogFile?: string | null;
  createWorklog: boolean;
  worklogAutoRecord: boolean;
  requirementCategory?: string | null;
  requirementShortLabel?: string | null;
  requirementEntryName?: string | null;
  activate: boolean;
};

export type InitDemandWorkspaceResult = {
  key: string;
  name: string;
  demandId?: string | null;
  project: {
    key: string;
    name: string;
    repoPath: string;
  };
  requirementEntry: {
    category: string;
    shortLabel: string;
    name: string;
    path: string;
  };
  resources: {
    workspaceKey: string;
    workspaceName: string;
    resourceDir: string;
    worklogFile: string;
    worklogPath: string;
    worklogExists: boolean;
    worklogCreated: boolean;
    autoRecordEnabled: boolean;
  };
  branch: {
    expected?: string | null;
    current?: string | null;
    matches?: boolean | null;
  };
  metadata: Record<string, string>;
  warnings: string[];
};

export type ProjectWorkspaceProjectInstanceDraft = {
  project: string;
  path: string;
  managed: boolean;
};

export type ProjectWorkspaceEditorDraft = {
  key: string;
  name: string;
  description?: string | null;
  system: boolean;
  workspaceType: string;
  workspaceTypeLabel: string;
  rootDir?: string | null;
  resourceDir?: string | null;
  worklogFile?: string | null;
  worklogAutoRecord: boolean;
  includeAllProjects: boolean;
  includeAllNavigation: boolean;
  projects: string[];
  navigationCategories: string[];
  navigationEntries: string[];
  proxyProfiles: string[];
  projectInstances: ProjectWorkspaceProjectInstanceDraft[];
};

export type ProjectWorkspaceEditorProject = {
  key: string;
  name: string;
  category: string;
  repoPath?: string | null;
  selected: boolean;
};

export type ProjectWorkspaceEditorNavigationEntry = {
  name: string;
  scopedName: string;
  kind: string;
  selected: boolean;
};

export type ProjectWorkspaceEditorNavigationCategory = {
  title: string;
  shortLabel: string;
  selected: boolean;
  entries: ProjectWorkspaceEditorNavigationEntry[];
};

export type ProjectWorkspaceEditorProxyProfile = {
  id: string;
  name: string;
  listenHost: string;
  listenPort: number;
  workspaceKey?: string | null;
  workspaceLabel: string;
  selected: boolean;
};

export type ProjectWorkspaceEditorState = {
  workspace: ProjectWorkspaceEditorDraft;
  projects: ProjectWorkspaceEditorProject[];
  navigationCategories: ProjectWorkspaceEditorNavigationCategory[];
  proxyProfiles: ProjectWorkspaceEditorProxyProfile[];
};

export type ProxyOutboundMode = "inherit" | "direct" | "proxy";

export type ProxyRuleAction =
  | {
      kind: "forward";
      targetBaseUrl: string;
      rewritePrefix: string;
      requestHeaders: Record<string, string>;
      responseHeaders: Record<string, string>;
      outboundMode: ProxyOutboundMode;
      outboundProxy: string;
      delayMs: number;
    }
  | {
      kind: "mock";
      status: number;
      contentType: string;
      body: string;
      headers: Record<string, string>;
      delayMs: number;
    }
  | {
      kind: "block";
      status: number;
      body: string;
      delayMs: number;
    };

export type ProxyProfile = {
  id: string;
  workspaceKey?: string | null;
  name: string;
  listenHost: string;
  listenPort: number;
  upstreamBaseUrl: string;
  upstreamProxy: string;
  captureBody: boolean;
  maxBodyBytes: number;
};

export type ProxyRule = {
  id: string;
  profileId: string;
  enabled: boolean;
  name: string;
  priority: number;
  method: string;
  urlContains: string;
  pathPrefix: string;
  headerName: string;
  headerContains: string;
  action: ProxyRuleAction;
};

export type ProxyConfig = {
  profiles: ProxyProfile[];
  rules: ProxyRule[];
};

export type ProxyProfileRuntimeStatus = {
  profileId: string;
  running: boolean;
  listenUrl: string;
  startedAt?: string | null;
};

export type ProxyEvent = {
  id: string;
  profileId: string;
  profileName: string;
  startedAt: string;
  durationMs: number;
  method: string;
  url: string;
  path: string;
  status?: number | null;
  action: string;
  matchedRuleId?: string | null;
  matchedRuleName?: string | null;
  requestBytes: number;
  responseBytes: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBodyPreview: string;
  responseBodyPreview: string;
  requestBodyTruncated: boolean;
  responseBodyTruncated: boolean;
  error?: string | null;
};

export type ProxyDashboard = {
  configPath: string;
  config: ProxyConfig;
  statuses: ProxyProfileRuntimeStatus[];
  events: ProxyEvent[];
};

export type ProxyRequestDiagnosis = {
  profile: {
    id: string;
    name: string;
    listenUrl: string;
    listening: boolean;
  };
  request: {
    method: string;
    url: string;
    path: string;
    headerCount: number;
  };
  statusKey: string;
  statusLabel: string;
  summary: string;
  matchedRule?: {
    id: string;
    name: string;
    priority: number;
    action: string;
    pathPrefix: string;
  } | null;
  decisions: Array<{
    ruleId: string;
    ruleName: string;
    enabled: boolean;
    priority: number;
    action: string;
    matched: boolean;
    reasons: Array<{
      key: string;
      matched: boolean;
      detail: string;
    }>;
  }>;
  warnings: Array<{
    key: string;
    detail: string;
    action?: string | null;
  }>;
};

export type ProxyRequestDiagnosisInput = {
  profile?: string | null;
  method: string;
  url: string;
  headers?: Record<string, string> | null;
};

export type BindProxyRuntimeRequest = {
  proxyProfile: string;
  runtimeProfileKey?: string | null;
  runtimeProfileLabel?: string | null;
  project?: string | null;
  debugProfile?: string | null;
  createDebugProfile: boolean;
  debugProfileLabel?: string | null;
  enableNetworkProxy: boolean;
  nodeHook: boolean;
};

export type BindProxyRuntimeResult = {
  proxyProfile: ProxyProfile;
  runtimeProfile: {
    key: string;
    label: string;
    proxyUrl: string;
    rdevProxyProfileId: string;
    networkProxyEnabled: boolean;
    nodeHook: boolean;
    created: boolean;
  };
  projectDebugProfile?: {
    projectKey: string;
    projectName: string;
    debugProfileKey: string;
    debugProfileLabel: string;
    created: boolean;
  } | null;
  warnings: string[];
};

export type ProjectCommandConfigDraft = {
  command: string;
  cwd?: string | null;
  outputDir?: string | null;
  envCount: number;
};

export type ProjectFocusConfigDraft = {
  url?: string | null;
  bundleId?: string | null;
  autoOnStart: boolean;
  autoOpenMode?: string;
  afterReadyActionsText?: string;
  readyEnabled?: boolean;
  readyTimeoutMs?: number;
  readyUrlPatternsText?: string;
  readySuccessMarkersText?: string;
  readyFailureMarkersText?: string;
};

export type ProjectBranchRulesDraft = {
  sourceKeywords: string[];
  targetKeywords: string[];
};

export type ProjectDebugLocalFileDraft = {
  path: string;
  mode: "overwrite" | "append_block" | string;
  content: string;
  enabled: boolean;
};

export type ProjectNetworkProxyDraft = {
  enabled: boolean;
  proxyUrl: string;
  injectEnv: boolean;
  nodeHook: boolean;
  noProxy: string;
};

export type RuntimeProfileDraft = {
  key: string;
  label: string;
  browser?: string | null;
  browserProfile?: string | null;
  browserUserDataDir?: string | null;
  webActionsEnabled: boolean;
  webActionsPort: number;
  webActionsUserDataDir?: string | null;
  browserArgsText: string;
  proxyUrl: string;
  rdevProxyProfileId?: string | null;
  proxyBypass: string;
  hostResolverRulesText: string;
  networkProxy: ProjectNetworkProxyDraft;
};

export type ProjectLocalProxyRouteDraft = {
  enabled: boolean;
  matchPrefix: string;
  target: string;
  rewritePrefix: string;
  headersText: string;
};

export type ProjectAuthHelperItemDraft = {
  enabled: boolean;
  storage: "localStorage" | "sessionStorage" | "cookie" | string;
  key: string;
  fromJsonPath: string;
  value: string;
  cookiePath: string;
  cookieMaxAgeSeconds?: number | null;
  cookieSameSite: string;
};

export type ProjectAuthHelperDraft = {
  enabled: boolean;
  path: string;
  redirectPath: string;
  items: ProjectAuthHelperItemDraft[];
};

export type ProjectLocalProxyDraft = {
  enabled: boolean;
  listen: string;
  frontendUrl: string;
  upstreamProxy: string;
  routes: ProjectLocalProxyRouteDraft[];
  authHelper: ProjectAuthHelperDraft;
};

export type ProjectDebugProfileDraft = {
  key: string;
  label: string;
  command?: string | null;
  cwd?: string | null;
  expectedPort?: number | null;
  focusUrl?: string | null;
  readyProbe?: ProjectDebugReadyProbeDraft | null;
  runtimeProfile?: string | null;
  envText: string;
  localFiles: ProjectDebugLocalFileDraft[];
  browser?: string | null;
  browserProfile?: string | null;
  browserUserDataDir?: string | null;
  browserArgsText: string;
  networkProxy: ProjectNetworkProxyDraft;
  localProxy: ProjectLocalProxyDraft;
};

export type ProjectDebugReadyProbeDraft = {
  url?: string | null;
  path?: string | null;
  expectedStatuses: number[];
  timeoutMs?: number | null;
};

export type DeployParamConfigKind = "select" | "boolean" | "branch" | "text" | "hidden";

export type DeployParamConfigSummary = {
  key: string;
  label: string;
  kind: DeployParamConfigKind;
  defaultValue?: string | null;
  options: string[];
  required: boolean;
  trueValue?: string | null;
  falseValue?: string | null;
  impactPaths: string[];
};

export type DeployTargetConfigSummary = {
  key: string;
  label: string;
  adapter: "jenkins" | "local_command" | "r_series_package";
  actionKind: "build" | "deploy" | "package" | "release";
  jenkinsProfile: string;
  jobName: string;
  artifactOutputDir?: string | null;
  params: DeployParamConfigSummary[];
};

export type ProjectConfigDraft = {
  key: string;
  name: string;
  category: string;
  repoPath?: string | null;
  gitUrl: string;
  dev: ProjectCommandConfigDraft;
  build: ProjectCommandConfigDraft;
  focus: ProjectFocusConfigDraft;
  branchRules: ProjectBranchRulesDraft;
  deployTargets: DeployTargetConfigSummary[];
  debugProfiles: ProjectDebugProfileDraft[];
};

export type ProjectConfigEditorState = {
  configPath: string;
  runtimeConfigPath?: string | null;
  runtimeProfileScope?: string;
  jenkinsProfiles: string[];
  defaultBranchRules: ProjectBranchRulesDraft;
  runtimeProfiles: RuntimeProfileDraft[];
  projects: ProjectConfigDraft[];
};

export type ProjectDebugProfileSummary = {
  key: string;
  label: string;
  command?: string | null;
  cwd?: string | null;
  expectedPort?: number | null;
  focusUrl?: string | null;
  readyProbe?: ProjectDebugReadyProbeDraft | null;
  runtimeProfile?: string | null;
  env: Record<string, string>;
  envCount: number;
  localFileCount: number;
  browser?: string | null;
  browserProfile?: string | null;
  browserUserDataDir?: string | null;
  browserArgs: string[];
  networkProxy: ProjectNetworkProxySummary;
  localProxy: ProjectLocalProxySummary;
};

export type ProjectNetworkProxySummary = ProjectNetworkProxyDraft;

export type ProjectLocalProxySummary = ProjectLocalProxyDraft;

export type ProjectRuntimeEntry = {
  key: string;
  name: string;
  category: string;
  repoPath?: string | null;
  command?: string | null;
  cwd?: string | null;
  focusUrl?: string | null;
  readyUrl?: string | null;
  statusKey: string;
  statusLabel: string;
  detail: string;
  pid?: number | null;
  startedAtMs?: number | null;
  logPath?: string | null;
  buildCommand?: string | null;
  buildCwd?: string | null;
  buildOutputDir?: string | null;
  buildStatusKey: string;
  buildStatusLabel: string;
  buildDetail: string;
  buildPid?: number | null;
  buildStartedAtMs?: number | null;
  buildLogPath?: string | null;
  updatedAtMs: number;
  canStart: boolean;
  canStop: boolean;
  canAdopt: boolean;
  canBuild: boolean;
  canStopBuild: boolean;
  canOpenBuildOutput: boolean;
  canFocusRuntime: boolean;
  debugProfiles: ProjectDebugProfileSummary[];
};

export type ProjectRuntimeLogKind = "dev" | "build";

export type ProjectRuntimeReadySummary = {
  enabled: boolean;
  ready: boolean;
  failed: boolean;
  statusKey: string;
  statusLabel: string;
  detail?: string | null;
  url?: string | null;
  localUrl?: string | null;
  networkUrl?: string | null;
};

export type ProjectRuntimeLogSessionSummary = {
  active: boolean;
  runId?: string | null;
  projectKey?: string | null;
  kind?: string | null;
  startedAtMs?: number | null;
  cwd?: string | null;
  command?: string | null;
  pid?: number | null;
  currentLineCount: number;
  totalLineCount: number;
};

export type ProjectRuntimeLogResponse = {
  path: string;
  lines: string[];
  truncated: boolean;
  readySummary: ProjectRuntimeReadySummary;
  sessionSummary: ProjectRuntimeLogSessionSummary;
};

export type ProjectRuntimePreflightCheck = {
  key: string;
  title: string;
  category: string;
  statusKey: "ok" | "warning" | "error" | "info" | string;
  statusLabel: string;
  detail: string;
  action?: string | null;
};

export type OperationStatus = {
  key: string;
  label: string;
  success: boolean;
  terminal: boolean;
  detail: string;
};

export type OperationEvidence = {
  kind: string;
  source: string;
  detail: string;
};

export type OperationRisk = {
  code: string;
  severity: string;
  detail: string;
};

export type BranchCatalogResponse = {
  requested: {
    project: string;
  };
  effective: {
    repoPath?: string | null;
    strategy: string[];
    localFetchTimeoutMs: number;
    gitlabTimeoutMs: number;
    remoteTimeoutMs: number;
  };
  observed: {
    source: string;
    freshness: string;
    branchCount: number;
    elapsedMs: number;
    attempts: Array<{
      source: string;
      status: string;
      elapsedMs: number;
      detail: string;
    }>;
  };
  status: OperationStatus;
  evidence: OperationEvidence[];
  risks: OperationRisk[];
  recommendedActions: RecommendedAction[];
  branches: BranchOption[];
};

export type ManagedArtifact = {
  kind: string;
  path: string;
  ownership: string;
  lifecycle: string;
};

export type ManagedArtifactRecord = {
  id: string;
  source: string;
  artifact: ManagedArtifact;
  workspaceKey?: string | null;
  projectKey?: string | null;
  runId?: string | null;
  scopePath?: string | null;
  exists: boolean;
  objectType: string;
  active: boolean;
  ownershipVerified: boolean;
  detail: string;
};

export type ManagedArtifactReference = {
  kind: string;
  path: string;
  source: string;
  workspaceKey?: string | null;
  projectKey?: string | null;
  exists: boolean;
  ownership: string;
  reason: string;
};

export type ManagedArtifactInventoryResponse = {
  schemaVersion: number;
  requested: {
    workspace?: string | null;
    allWorkspaces: boolean;
    project?: string | null;
    kinds: string[];
  };
  effective: {
    workspaceKeys: string[];
    project?: string | null;
    kinds: string[];
    collectors: string[];
  };
  observed: {
    artifacts: ManagedArtifactRecord[];
    references: ManagedArtifactReference[];
    summary: {
      artifactCount: number;
      existingCount: number;
      missingCount: number;
      activeCount: number;
      referenceCount: number;
    };
  };
  status: OperationStatus;
  evidence: OperationEvidence[];
  risks: OperationRisk[];
  managedArtifacts: ManagedArtifact[];
  recommendedActions: RecommendedAction[];
};

export type RecommendedAction = {
  command: string;
  reason: string;
  risk: string;
};

export type ProjectRuntimeReadyProbeSummary = {
  url?: string | null;
  path?: string | null;
  expectedStatuses: number[];
  timeoutMs?: number | null;
};

export type ProjectRuntimeTargetSummary = {
  command: string;
  commandSource: string;
  cwd: string;
  cwdSource: string;
  expectedPort?: number | null;
  expectedPortSource?: string | null;
  focusUrl?: string | null;
  focusUrlSource?: string | null;
  readyProbe?: ProjectRuntimeReadyProbeSummary | null;
};

export type ProjectRuntimeContextRequest = {
  projectKey: string;
  debugProfileKey?: string | null;
  runtimeProfileKey?: string | null;
  command?: string | null;
  expectedPort?: number | null;
  envKeys: string[];
};

export type ProjectRuntimeContextEffective = {
  debugProfileKey?: string | null;
  debugProfileLabel?: string | null;
  runtimeProfileKey?: string | null;
  runtimeProfileLabel?: string | null;
  target?: ProjectRuntimeTargetSummary | null;
};

export type ProjectRuntimeSessionObservation = {
  runId?: string | null;
  phase: string;
  running: boolean;
  managed: boolean;
  adopted: boolean;
  cwd: string;
  expectedPort?: number | null;
  readyUrl?: string | null;
  readyProbe?: ProjectRuntimeReadyProbeSummary | null;
  daemonPid?: number | null;
  workerPid?: number | null;
  startedAtMs?: number | null;
  logPath?: string | null;
};

export type ProjectRuntimeContextSnapshot = {
  schemaVersion: number;
  requested: ProjectRuntimeContextRequest;
  effective: ProjectRuntimeContextEffective;
  observed: {
    available: boolean;
    sessions: ProjectRuntimeSessionObservation[];
  };
  status: OperationStatus;
  evidence: OperationEvidence[];
  risks: OperationRisk[];
  managedArtifacts: ManagedArtifact[];
  recommendedActions: RecommendedAction[];
};

export type ProjectRuntimePreflightResponse = {
  projectKey: string;
  projectName: string;
  debugProfileKey?: string | null;
  debugProfileLabel?: string | null;
  runtimeProfileKey?: string | null;
  runtimeProfileLabel?: string | null;
  statusKey: "ok" | "warning" | "error" | string;
  statusLabel: string;
  summary: string;
  target?: ProjectRuntimeTargetSummary | null;
  checks: ProjectRuntimePreflightCheck[];
};

export type ProjectRuntimeInspectResponse = {
  projectKey: string;
  projectName: string;
  repoPath?: string | null;
  debugProfileKey?: string | null;
  debugProfileLabel?: string | null;
  runtimeProfileKey?: string | null;
  runtimeProfileLabel?: string | null;
  statusKey: string;
  statusLabel: string;
  summary: string;
  target?: ProjectRuntimeTargetSummary | null;
  environment: {
    statusKey: "detected" | "partial" | "unavailable" | string;
    cwd?: string | null;
    packageJson?: {
      path: string;
      name?: string | null;
      packageManager?: string | null;
    } | null;
    nodeVersion?: {
      value: string;
      source: string;
      path?: string | null;
    } | null;
    dev: {
      configuredCommand?: string | null;
      scriptName?: string | null;
      scriptCommand?: string | null;
      packageManager?: string | null;
      vite: boolean;
    };
    port: {
      effectivePort?: number | null;
      source?: string | null;
      confidence: string;
      suggestedPort?: number | null;
    };
    viteConfig?: {
      path: string;
      evaluated: boolean;
    } | null;
    diagnostics: string[];
  };
  envPreview: Array<{
    key: string;
    value: string;
    source: string;
    masked: boolean;
  }>;
  localFiles: Array<{
    path: string;
    absolutePath?: string | null;
    mode: string;
    enabled: boolean;
    gitTracked?: boolean | null;
    gitIgnored?: boolean | null;
    statusKey: string;
    statusLabel: string;
    detail: string;
    action?: string | null;
    contentPreview: string;
    contentTruncated: boolean;
  }>;
  proxies: Array<{
    key: string;
    kind: string;
    label: string;
    enabled: boolean;
    url?: string | null;
    profileId?: string | null;
    listening?: boolean | null;
    statusKey: string;
    statusLabel: string;
    detail: string;
    action?: string | null;
  }>;
  checks: ProjectRuntimePreflightCheck[];
  handoff: {
    projectPath?: string | null;
    workspaceSensitive: boolean;
    debugProfile?: string | null;
    runtimeProfile?: string | null;
    localFiles: string[];
    proxyUrls: string[];
    verifyUrls: string[];
    risks: string[];
  };
};

export type FinderEntry = {
  name: string;
  kind: string;
  targetLabel: string;
  url?: string | null;
  browser?: string | null;
  browserProfile?: string | null;
  runtimeProfile?: string | null;
  bundleId?: string | null;
  appName?: string | null;
  script?: string | null;
  tool?: string | null;
  toolKey?: string | null;
  toolAction?: string | null;
  path?: string | null;
  cwd?: string | null;
  note?: string | null;
};

export type FinderShortcutItem = {
  categoryTitle: string;
  categoryLabel: string;
  entry: FinderEntry;
};

export type WebActionParamSummary = {
  key: string;
  label: string;
  defaultValue: string;
  source: string;
  sourceKey: string;
};

export type WebActionKind = "script" | "request";

export type WebActionRequestSummary = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxBodyBytes: number;
};

export type WebActionSummary = {
  key: string;
  name: string;
  kind: WebActionKind;
  scope: string;
  matchPatterns: string[];
  runManually: boolean;
  params: WebActionParamSummary[];
  script: string;
  request?: WebActionRequestSummary | null;
};

export type WebActionListResponse = {
  configPath: string;
  actions: WebActionSummary[];
};

export type ConfigSourceFiles = {
  navigation: string;
  links: string;
  proxy?: string | null;
  runtimeOverrides?: string | null;
};

export type ConfigSource = {
  id: string;
  name: string;
  kind: string;
  baseDir: string;
  files: ConfigSourceFiles;
  uiProfile: string;
  capabilities: string[];
  isDefault: boolean;
};

export type ConfigSourceFileDefinition = {
  navigation?: string | null;
  links?: string | null;
  proxy?: string | null;
  runtimeOverrides?: string | null;
};

export type ConfigSourceDefinition = {
  id: string;
  name: string;
  kind?: string | null;
  baseDir?: string | null;
  files: ConfigSourceFileDefinition;
  uiProfile?: string | null;
  capabilities: string[];
};

export type ConfigSourceFileInspection = {
  key: string;
  label: string;
  capability: string;
  path?: string | null;
  supported: boolean;
  exists: boolean;
  status: "ready" | "missing" | "invalid" | "unsupported" | string;
  message: string;
};

export type ConfigSourceInspection = {
  source: ConfigSource;
  definition?: ConfigSourceDefinition | null;
  editable: boolean;
  registryPath: string;
  status: "ready" | "empty" | "invalid" | "unsupported" | string;
  summary: string;
  issues: string[];
  files: ConfigSourceFileInspection[];
  runtimeProfileScope: string;
};

export type ConfigSourceReference = {
  id: string;
  name: string;
  kind: string;
};

export type ConfigSourceFileState = {
  supported: boolean;
  exists: boolean;
  sizeBytes?: number | null;
};

export type ConfigSourceFileComparison = {
  key: string;
  capability: string;
  left: ConfigSourceFileState;
  right: ConfigSourceFileState;
  sizeEqual?: boolean | null;
  contentEqual?: boolean | null;
  equivalent: boolean;
  status: string;
  summary: string;
};

export type ConfigSourceComparison = {
  left: ConfigSourceReference;
  right: ConfigSourceReference;
  identical: boolean;
  summary: {
    total: number;
    matching: number;
    differing: number;
    missingLeft: number;
    missingRight: number;
    missingBoth: number;
    capabilityMismatches: number;
  };
  files: ConfigSourceFileComparison[];
};

export type ConfigSourceCopyRequest = {
  sourceId: string;
  id: string;
  name: string;
  baseDir?: string | null;
};

export type ConfigSourceCopyResult = {
  source: ConfigSourceReference;
  target: ConfigSource;
  copiedCount: number;
  missingCount: number;
  files: Array<{
    key: string;
    capability: string;
    status: string;
    sizeBytes?: number | null;
  }>;
};

export type WebActionTarget = {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string | null;
};

export type WebActionRunResult = {
  actionKey: string;
  targetId: string;
  title: string;
  url: string;
  success: boolean;
  result?: unknown;
  resultText: string;
  error?: string | null;
};

export type LinkSummary = {
  key: string;
  name: string;
  kind?: string | null;
  uiProfile: string;
  schemaVersion: number;
  workspaceKey?: string | null;
  project?: string | null;
  stepCount: number;
  proxyProfiles: Array<{
    id: string;
    name: string;
    listenUrl: string;
  }>;
  runtime?: LinkRuntimeSummary | null;
  warnings: string[];
};

export type LinkRuntimeSummary = {
  status: string;
  label: string;
  runningSteps: number;
  controllableSteps: number;
  blockedSteps: number;
  canRun: boolean;
  canStop: boolean;
};

export type LinkConfig = {
  key: string;
  name: string;
  kind?: string | null;
  uiProfile?: string | null;
  schemaVersion?: number | null;
  workspaceKey?: string | null;
  project?: string | null;
  steps: LinkStepConfig[];
};

export type LinkStepConfig = {
  id: string;
  type: string;
  label?: string | null;
  project?: string | null;
  path?: string | null;
  profile?: string | null;
  debugProfile?: string | null;
  runtimeProfile?: string | null;
  command?: string | null;
  expectedPort?: number | null;
  env?: Record<string, string>;
  action?: string | null;
  note?: string | null;
  [key: string]: unknown;
};

export type LinkPlan = {
  key: string;
  name: string;
  kind?: string | null;
  uiProfile: string;
  schemaVersion: number;
  workspaceKey?: string | null;
  project?: string | null;
  sourceContext?: {
    linkSourceId: string;
    linkSourceName: string;
    proxySourceId: string;
    proxySourceName: string;
    runtimeSourceId: string;
    runtimeSourceName: string;
    aligned: boolean;
  } | null;
  steps: LinkPlanStep[];
  warnings: string[];
};

export type LinkPlanStep = {
  id: string;
  type: string;
  label: string;
  summary: string;
  status: "planned" | "invalid" | string;
  risks: string[];
  runtime?: ProjectRuntimeContextSnapshot | null;
};

export type LinkExecutionReport = {
  key: string;
  name: string;
  mode: "check" | "run" | "stop" | string;
  plan: LinkPlan;
  steps: LinkExecutionStepReport[];
  warnings: string[];
};

export type LinkExecutionStepReport = {
  id: string;
  type: string;
  label: string;
  status:
    | "ready"
    | "blocked"
    | "checked"
    | "started"
    | "stopped"
    | "skipped"
    | "failed"
    | string;
  summary: string;
  detail?: unknown;
  risks: string[];
};

export type NavigationEditorEntryKind = "url" | "directory" | "file" | "app" | "script" | "tool";

export type NavigationEditorEntry = {
  name: string;
  kind: NavigationEditorEntryKind;
  url?: string | null;
  browser?: string | null;
  browserProfile?: string | null;
  runtimeProfile?: string | null;
  bundleId?: string | null;
  appName?: string | null;
  script?: string | null;
  tool?: string | null;
  toolKey?: string | null;
  toolAction?: string | null;
  path?: string | null;
  cwd?: string | null;
  note?: string | null;
};

export type NavigationEditorCategory = {
  title: string;
  shortLabel: string;
  entries: NavigationEditorEntry[];
};

export type NavigationEditorState = {
  filePath: string;
  preferredCategory?: string | null;
  categories: NavigationEditorCategory[];
};

export type ProjectWorkflowAction =
  | "project.runtime.start"
  | "project.runtime.stop"
  | "project.build.run"
  | "project.build.stop"
  | "project.build.openOutput"
  | "project.runtime.focus"
  | "project.openDirectory"
  | "finder.shortcut.open";
