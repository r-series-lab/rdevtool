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

export type DeployHistoryEntry = {
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
};

export type ProjectBranchRulesDraft = {
  sourceKeywords: string[];
  targetKeywords: string[];
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
};

export type ProjectConfigEditorState = {
  configPath: string;
  jenkinsProfiles: string[];
  projects: ProjectConfigDraft[];
};

export type ProjectRuntimeEntry = {
  key: string;
  name: string;
  category: string;
  repoPath?: string | null;
  command?: string | null;
  cwd?: string | null;
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
  bundleId?: string | null;
  appName?: string | null;
  script?: string | null;
  cwd?: string | null;
  note?: string | null;
};

export type FinderShortcutItem = {
  categoryTitle: string;
  categoryLabel: string;
  entry: FinderEntry;
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
