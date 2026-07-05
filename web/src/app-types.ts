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
  projectCount: number;
  includeAllProjects: boolean;
  includeAllNavigation: boolean;
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
  copyCurrent: boolean;
  activate: boolean;
};

export type ProjectWorkspaceEditorDraft = {
  key: string;
  name: string;
  description?: string | null;
  system: boolean;
  includeAllProjects: boolean;
  includeAllNavigation: boolean;
  projects: string[];
  navigationCategories: string[];
  navigationEntries: string[];
  proxyProfiles: string[];
};

export type ProjectWorkspaceEditorProject = {
  key: string;
  name: string;
  category: string;
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

export type ProjectRuntimeLogResponse = {
  path: string;
  lines: string[];
  truncated: boolean;
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
