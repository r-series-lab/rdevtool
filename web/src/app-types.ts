import type { PageKey } from "./app-shell";

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
  replay?: BranchTaskReplayRequest | null;
};

export type WorkspaceAppPreferences = {
  styleMode: string;
  defaultPage?: PageKey | null;
  enabledPages: PageKey[];
  activeWorkspace?: string | null;
};

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
};

export type DeployTargetConfigSummary = {
  key: string;
  label: string;
  adapter: "jenkins" | "local_command" | "r_series_package";
  actionKind: "build" | "deploy" | "package" | "release";
  jenkinsProfile: string;
  jobName: string;
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
  jenkinsProfiles: string[];
  defaultBranchRules: ProjectBranchRulesDraft;
  runtimeProfiles: RuntimeProfileDraft[];
  projects: ProjectConfigDraft[];
};

export type ProjectDebugProfileSummary = {
  key: string;
  label: string;
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

export type NavigationEditorEntryKind = "url" | "directory" | "app" | "script";

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
