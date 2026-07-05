import type {
  BranchTaskHistoryEntry,
  BranchTaskReplayRequest,
  BranchTaskResponse,
  BranchWorkflowMode,
  BuildHistoryEntry,
  FinderShortcutItem,
  ProjectRuntimeEntry,
  ProjectWorkflowAction,
} from "../app-types";

export type WorkflowSignalSource =
  | "branch.sync.success"
  | "branch.create.success"
  | "branch.checkout.success"
  | "branch.switch.success"
  | "branch.push.success"
  | "project.runtime.start.success"
  | "project.runtime.stop.success"
  | "project.build.run.success"
  | "project.build.stop.success"
  | "project.build.openOutput.success"
  | "project.runtime.focus.success"
  | "project.openDirectory.success"
  | "finder.shortcut.open.success";

export type WorkflowReplayTarget =
  | "build.replay"
  | "deploy.replay"
  | "branch.replay"
  | "project.replay";

export type WorkflowBroadcastRule = {
  id: string;
  enabled: boolean;
  source: WorkflowSignalSource;
  signalId: string;
  replayKey?: string;
  label?: string;
  replay?: WorkflowReplay;
};

export type WorkflowBuildReplay = {
  target: "build.replay";
  entry: BuildHistoryEntry;
};

export type WorkflowLegacyDeployReplay = {
  target: "deploy.replay";
  entry: BuildHistoryEntry;
};

export type WorkflowBranchReplay = {
  target: "branch.replay";
  entry: BranchTaskHistoryEntry;
};

export type WorkflowProjectReplay = {
  target: "project.replay";
  action: ProjectWorkflowAction;
  projectKey?: string;
  projectName?: string;
  shortcut?: FinderShortcutItem;
};

export type WorkflowReplay =
  | WorkflowBuildReplay
  | WorkflowLegacyDeployReplay
  | WorkflowBranchReplay
  | WorkflowProjectReplay;

export type WorkflowReceiveRule = {
  id: string;
  enabled: boolean;
  signalId: string;
  target: WorkflowReplayTarget;
  replayKey: string;
  label: string;
  replay: WorkflowReplay;
};

export type WorkflowRules = {
  broadcasts: WorkflowBroadcastRule[];
  receivers: WorkflowReceiveRule[];
};

export type WorkflowSignal = {
  instanceId: string;
  id: string;
  source: WorkflowSignalSource;
  title: string;
  summary: string;
  createdAt: string;
  chainId?: string | null;
  parentActivityId?: string | null;
  sourceStepLabel?: string | null;
  payload: {
    projectKey: string;
    projectName: string;
    taskKind?: BranchWorkflowMode;
    sourceBranch: string;
    targetBranches: string[];
    action?: ProjectWorkflowAction;
    targetLabel?: string;
  };
};

export const DEFAULT_WORKFLOW_SIGNAL_ID = "merge-to-build";

export const WORKFLOW_BRANCH_EVENT_OPTIONS: Array<{
  source: WorkflowSignalSource;
  label: string;
}> = [
  { source: "branch.sync.success", label: "合并成功" },
  { source: "branch.create.success", label: "创建成功" },
  { source: "branch.checkout.success", label: "克隆成功" },
  { source: "branch.switch.success", label: "切换成功" },
  { source: "branch.push.success", label: "推送成功" },
];

export const WORKFLOW_PROJECT_EVENT_OPTIONS: Array<{
  source: WorkflowSignalSource;
  label: string;
}> = [
  { source: "project.runtime.start.success", label: "启动成功" },
  { source: "project.runtime.stop.success", label: "停止成功" },
  { source: "project.build.run.success", label: "构建已启动" },
  { source: "project.build.stop.success", label: "构建已中止" },
  { source: "project.build.openOutput.success", label: "打开产物" },
  { source: "project.runtime.focus.success", label: "唤起成功" },
  { source: "project.openDirectory.success", label: "打开目录" },
  { source: "finder.shortcut.open.success", label: "打开入口" },
];

export const WORKFLOW_SIGNAL_SOURCE_OPTIONS = [
  ...WORKFLOW_BRANCH_EVENT_OPTIONS,
  ...WORKFLOW_PROJECT_EVENT_OPTIONS,
];

export const DEFAULT_WORKFLOW_RULES: WorkflowRules = {
  broadcasts: [],
  receivers: [],
};

function makeRuleId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSignalId(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_WORKFLOW_SIGNAL_ID;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeReplayKeyPrefix(value: string) {
  return value.startsWith("deploy:") ? `build:${value.slice("deploy:".length)}` : value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isBuildReplayTarget(target?: string | null) {
  return target === "build.replay" || target === "deploy.replay";
}

function isBuildReplay(
  replay: WorkflowReplay,
): replay is WorkflowBuildReplay | WorkflowLegacyDeployReplay {
  return isBuildReplayTarget(replay.target);
}

export function workflowReplayTargetsEqual(
  left: WorkflowReplayTarget,
  right: WorkflowReplayTarget,
) {
  if (isBuildReplayTarget(left) && isBuildReplayTarget(right)) {
    return true;
  }
  return left === right;
}

function normalizeProjectWorkflowAction(value: unknown): ProjectWorkflowAction | null {
  return value === "project.runtime.start" ||
    value === "project.runtime.stop" ||
    value === "project.build.run" ||
    value === "project.build.stop" ||
    value === "project.build.openOutput" ||
    value === "project.runtime.focus" ||
    value === "project.openDirectory" ||
    value === "finder.shortcut.open"
    ? value
    : null;
}

function normalizeBroadcastRule(value: unknown): WorkflowBroadcastRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<WorkflowBroadcastRule>;
  const replay = normalizeReplay(candidate.replay);
  if (!replay) {
    return null;
  }
  const source = normalizeSignalSource(candidate.source) ?? workflowSourceForReplay(replay);
  if (!source) {
    return null;
  }

  const replayKey =
    typeof candidate.replayKey === "string" && candidate.replayKey
      ? normalizeReplayKeyPrefix(candidate.replayKey)
      : replay
        ? workflowReplayKey(replay)
        : undefined;

  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : makeRuleId("broadcast"),
    enabled: Boolean(candidate.enabled),
    source,
    signalId: normalizeSignalId(candidate.signalId),
    replayKey: replayKey ?? workflowReplayKey(replay),
    label:
      typeof candidate.label === "string" && candidate.label
        ? candidate.label
        : replay
          ? workflowReplayLabel(replay)
          : undefined,
    replay,
  };
}

function normalizeReceiveRule(value: unknown): WorkflowReceiveRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<WorkflowReceiveRule>;
  const replay = normalizeReplay(candidate.replay);
  if (!replay) {
    return null;
  }

  const replayKey =
    typeof candidate.replayKey === "string" && candidate.replayKey
      ? normalizeReplayKeyPrefix(candidate.replayKey)
      : workflowReplayKey(replay);

  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : makeRuleId("receive"),
    enabled: Boolean(candidate.enabled),
    signalId: normalizeSignalId(candidate.signalId),
    target: replay.target,
    replayKey,
    label:
      typeof candidate.label === "string" && candidate.label
        ? candidate.label
        : workflowReplayLabel(replay),
    replay,
  };
}

function normalizeSignalSource(value: unknown): WorkflowSignalSource | null {
  return WORKFLOW_SIGNAL_SOURCE_OPTIONS.some((item) => item.source === value)
    ? (value as WorkflowSignalSource)
    : null;
}

function normalizeReplay(value: unknown): WorkflowReplay | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<WorkflowReplay>;
  if (isBuildReplayTarget(candidate.target)) {
    const entry = normalizeBuildHistoryEntry(
      (candidate as Partial<WorkflowBuildReplay | WorkflowLegacyDeployReplay>).entry,
    );
    return entry ? { target: "build.replay", entry } : null;
  }
  if (candidate.target === "branch.replay") {
    const entry = normalizeBranchTaskHistoryEntry((candidate as Partial<WorkflowBranchReplay>).entry);
    return entry ? { target: "branch.replay", entry } : null;
  }
  if (candidate.target === "project.replay") {
    return normalizeProjectReplay(candidate);
  }
  return null;
}

function normalizeBuildHistoryEntry(value: unknown): BuildHistoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<BuildHistoryEntry>;
  if (
    typeof candidate.historyKey !== "string" ||
    typeof candidate.projectKey !== "string" ||
    typeof candidate.projectName !== "string" ||
    typeof candidate.mode !== "string"
  ) {
    return null;
  }

  return cloneJson({
    historyKey: candidate.historyKey,
    projectKey: candidate.projectKey,
    projectName: candidate.projectName,
    mode: candidate.mode,
    env: typeof candidate.env === "string" ? candidate.env : "",
    branch: typeof candidate.branch === "string" ? candidate.branch : "",
    stateKey: typeof candidate.stateKey === "string" ? candidate.stateKey : "",
    stateLabel: typeof candidate.stateLabel === "string" ? candidate.stateLabel : "",
    detail: typeof candidate.detail === "string" ? candidate.detail : "",
    queueUrl: typeof candidate.queueUrl === "string" ? candidate.queueUrl : null,
    buildUrl: typeof candidate.buildUrl === "string" ? candidate.buildUrl : null,
    params:
      candidate.params && typeof candidate.params === "object" && !Array.isArray(candidate.params)
        ? candidate.params
        : {},
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
  });
}

function normalizeBranchReplay(value: unknown): BranchTaskReplayRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<BranchTaskReplayRequest>;
  if (
    typeof candidate.command !== "string" ||
    typeof candidate.busyText !== "string" ||
    !candidate.request ||
    typeof candidate.request !== "object" ||
    Array.isArray(candidate.request)
  ) {
    return null;
  }

  return cloneJson({
    command: candidate.command,
    busyText: candidate.busyText,
    request: candidate.request,
    refreshPushStatusProject:
      typeof candidate.refreshPushStatusProject === "string"
        ? candidate.refreshPushStatusProject
        : null,
    clearPushCommitMessageOnSuccess: Boolean(candidate.clearPushCommitMessageOnSuccess),
  } as BranchTaskReplayRequest);
}

function normalizeBranchTaskHistoryEntry(value: unknown): BranchTaskHistoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<BranchTaskHistoryEntry>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.taskKind !== "string" ||
    typeof candidate.summary !== "string" ||
    !Array.isArray(candidate.items)
  ) {
    return null;
  }
  const replay = normalizeBranchReplay(candidate.replay);
  if (!replay) {
    return null;
  }

  return cloneJson({
    ...candidate,
    replay,
  } as BranchTaskHistoryEntry);
}

function normalizeFinderShortcutItem(value: unknown): FinderShortcutItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<FinderShortcutItem>;
  const entry = candidate.entry;
  if (
    typeof candidate.categoryTitle !== "string" ||
    typeof candidate.categoryLabel !== "string" ||
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    typeof entry.name !== "string" ||
    typeof entry.kind !== "string" ||
    typeof entry.targetLabel !== "string"
  ) {
    return null;
  }

  return cloneJson({
    categoryTitle: candidate.categoryTitle,
    categoryLabel: candidate.categoryLabel,
    entry: {
      name: entry.name,
      kind: entry.kind,
      targetLabel: entry.targetLabel,
      url: typeof entry.url === "string" ? entry.url : null,
      browser: typeof entry.browser === "string" ? entry.browser : null,
      browserProfile:
        typeof entry.browserProfile === "string" ? entry.browserProfile : null,
      runtimeProfile:
        typeof entry.runtimeProfile === "string" ? entry.runtimeProfile : null,
      bundleId: typeof entry.bundleId === "string" ? entry.bundleId : null,
      appName: typeof entry.appName === "string" ? entry.appName : null,
      script: typeof entry.script === "string" ? entry.script : null,
      path: typeof entry.path === "string" ? entry.path : null,
      cwd: typeof entry.cwd === "string" ? entry.cwd : null,
      note: typeof entry.note === "string" ? entry.note : null,
    },
  });
}

function normalizeProjectReplay(value: Partial<WorkflowReplay>): WorkflowProjectReplay | null {
  const candidate = value as Partial<WorkflowProjectReplay>;
  const action = normalizeProjectWorkflowAction(candidate.action);
  if (!action) {
    return null;
  }
  if (action === "finder.shortcut.open") {
    const shortcut = normalizeFinderShortcutItem(candidate.shortcut);
    return shortcut
      ? {
          target: "project.replay",
          action,
          shortcut,
        }
      : null;
  }

  if (typeof candidate.projectKey !== "string" || !candidate.projectKey.trim()) {
    return null;
  }

  return {
    target: "project.replay",
    action,
    projectKey: candidate.projectKey.trim(),
    projectName:
      typeof candidate.projectName === "string" && candidate.projectName.trim()
        ? candidate.projectName.trim()
        : candidate.projectKey.trim(),
  };
}

export function normalizeWorkflowRules(value: unknown): WorkflowRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WORKFLOW_RULES;
  }

  const candidate = value as Partial<WorkflowRules> & {
    mergeSyncBroadcast?: unknown;
    deployReceive?: unknown;
  };
  const broadcasts = Array.isArray(candidate.broadcasts)
    ? candidate.broadcasts
        .map(normalizeBroadcastRule)
        .filter((item): item is WorkflowBroadcastRule => Boolean(item))
    : [];
  const receivers = Array.isArray(candidate.receivers)
    ? candidate.receivers
        .map(normalizeReceiveRule)
        .filter((item): item is WorkflowReceiveRule => Boolean(item))
    : [];

  const legacyReceiver = normalizeLegacyReceiver(candidate.deployReceive);

  return {
    broadcasts,
    receivers: legacyReceiver ? [legacyReceiver, ...receivers] : receivers,
  };
}

function normalizeLegacyReceiver(value: unknown): WorkflowReceiveRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return null;
}

export function normalizeWorkflowSignals(value: unknown): WorkflowSignal[] {
  if (!Array.isArray(value)) {
    return normalizeWorkflowSignal(value) ? [normalizeWorkflowSignal(value)!] : [];
  }

  return value
    .map(normalizeWorkflowSignal)
    .filter((item): item is WorkflowSignal => Boolean(item))
    .slice(0, 20);
}

export function normalizeWorkflowSignal(value: unknown): WorkflowSignal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<WorkflowSignal> & {
    type?: unknown;
    sourceModule?: unknown;
    sourceAction?: unknown;
  };
  const source = normalizeSignalSource(candidate.source) ?? normalizeLegacySignalSource(candidate);
  if (
    typeof candidate.id !== "string" ||
    !source ||
    typeof candidate.createdAt !== "string" ||
    !candidate.payload ||
    typeof candidate.payload !== "object" ||
    Array.isArray(candidate.payload)
  ) {
    return null;
  }

  const payload = candidate.payload as Partial<WorkflowSignal["payload"]>;
  const taskKind = normalizeBranchWorkflowMode(payload.taskKind) ?? workflowSourceTaskKind(source);
  const action = normalizeProjectWorkflowAction(payload.action) ?? workflowActionForSource(source);
  return {
    instanceId:
      typeof candidate.instanceId === "string" && candidate.instanceId
        ? candidate.instanceId
        : makeRuleId("signal"),
    id: normalizeSignalId(candidate.id),
    source,
    title: typeof candidate.title === "string" ? candidate.title : workflowSourceLabel(source),
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    createdAt: candidate.createdAt,
    chainId: typeof candidate.chainId === "string" && candidate.chainId ? candidate.chainId : null,
    parentActivityId:
      typeof candidate.parentActivityId === "string" && candidate.parentActivityId
        ? candidate.parentActivityId
        : null,
    sourceStepLabel:
      typeof candidate.sourceStepLabel === "string" && candidate.sourceStepLabel
        ? candidate.sourceStepLabel
        : null,
    payload: {
      projectKey: typeof payload.projectKey === "string" ? payload.projectKey : "",
      projectName: typeof payload.projectName === "string" ? payload.projectName : "",
      ...(taskKind ? { taskKind } : {}),
      sourceBranch: typeof payload.sourceBranch === "string" ? payload.sourceBranch : "",
      targetBranches: normalizeStringArray(payload.targetBranches),
      ...(action ? { action } : {}),
      targetLabel: typeof payload.targetLabel === "string" ? payload.targetLabel : "",
    },
  };
}

function normalizeLegacySignalSource(value: {
  type?: unknown;
  sourceModule?: unknown;
  sourceAction?: unknown;
}): WorkflowSignalSource | null {
  return value.type === "branch.sync.success" &&
    value.sourceModule === "merge" &&
    value.sourceAction === "sync"
    ? "branch.sync.success"
    : null;
}

function normalizeBranchWorkflowMode(value: unknown): BranchWorkflowMode | null {
  return value === "sync" || value === "create" || value === "checkout" || value === "switch" || value === "push"
    ? value
    : null;
}

function workflowSourceTaskKind(source: WorkflowSignalSource): BranchWorkflowMode | null {
  if (source === "branch.create.success") {
    return "create";
  }
  if (source === "branch.checkout.success") {
    return "checkout";
  }
  if (source === "branch.switch.success") {
    return "switch";
  }
  if (source === "branch.push.success") {
    return "push";
  }
  if (source === "branch.sync.success") {
    return "sync";
  }
  return null;
}

export function workflowSourceForBranchTask(
  taskKind: BranchWorkflowMode,
): WorkflowSignalSource {
  if (taskKind === "create") {
    return "branch.create.success";
  }
  if (taskKind === "checkout") {
    return "branch.checkout.success";
  }
  if (taskKind === "switch") {
    return "branch.switch.success";
  }
  if (taskKind === "push") {
    return "branch.push.success";
  }
  return "branch.sync.success";
}

export function workflowSourceForProjectAction(
  action: ProjectWorkflowAction,
): WorkflowSignalSource {
  switch (action) {
    case "project.runtime.start":
      return "project.runtime.start.success";
    case "project.runtime.stop":
      return "project.runtime.stop.success";
    case "project.build.run":
      return "project.build.run.success";
    case "project.build.stop":
      return "project.build.stop.success";
    case "project.build.openOutput":
      return "project.build.openOutput.success";
    case "project.runtime.focus":
      return "project.runtime.focus.success";
    case "project.openDirectory":
      return "project.openDirectory.success";
    case "finder.shortcut.open":
      return "finder.shortcut.open.success";
  }
}

function workflowActionForSource(source: WorkflowSignalSource): ProjectWorkflowAction | null {
  switch (source) {
    case "project.runtime.start.success":
      return "project.runtime.start";
    case "project.runtime.stop.success":
      return "project.runtime.stop";
    case "project.build.run.success":
      return "project.build.run";
    case "project.build.stop.success":
      return "project.build.stop";
    case "project.build.openOutput.success":
      return "project.build.openOutput";
    case "project.runtime.focus.success":
      return "project.runtime.focus";
    case "project.openDirectory.success":
      return "project.openDirectory";
    case "finder.shortcut.open.success":
      return "finder.shortcut.open";
    default:
      return null;
  }
}

export function workflowProjectActionLabel(action: ProjectWorkflowAction) {
  switch (action) {
    case "project.runtime.start":
      return "启动 dev";
    case "project.runtime.stop":
      return "停止 dev";
    case "project.build.run":
      return "执行构建";
    case "project.build.stop":
      return "中止构建";
    case "project.build.openOutput":
      return "打开产物";
    case "project.runtime.focus":
      return "唤起项目";
    case "project.openDirectory":
      return "打开目录";
    case "finder.shortcut.open":
      return "打开入口";
  }
}

function workflowSourceForReplay(replay: WorkflowReplay): WorkflowSignalSource | null {
  if (replay.target === "branch.replay") {
    return workflowSourceForBranchTask(replay.entry.taskKind);
  }
  if (replay.target === "project.replay") {
    return workflowSourceForProjectAction(replay.action);
  }
  return null;
}

export function workflowSourceLabel(source: WorkflowSignalSource) {
  return WORKFLOW_SIGNAL_SOURCE_OPTIONS.find((item) => item.source === source)?.label ?? source;
}

export function createBranchTaskSignals({
  broadcasts,
  replay,
  projectKey,
  projectName,
  sourceBranch,
  targetBranches,
  result,
  chainId,
  parentActivityId,
  sourceStepLabel,
}: {
  broadcasts: WorkflowBroadcastRule[];
  replay?: WorkflowReplay | null;
  projectKey: string;
  projectName: string;
  sourceBranch: string;
  targetBranches: string[];
  result: BranchTaskResponse;
  chainId?: string;
  parentActivityId?: string;
  sourceStepLabel?: string;
}): WorkflowSignal[] {
  const source = workflowSourceForBranchTask(result.taskKind);
  const replayKey = replay ? workflowReplayKey(replay) : "";
  const seenSignalIds = new Set<string>();
  return broadcasts
    .filter(
      (rule) =>
        rule.enabled &&
        rule.source === source &&
        rule.signalId.trim() &&
        (!rule.replayKey || rule.replayKey === replayKey),
    )
    .filter((rule) => {
      const signalId = normalizeSignalId(rule.signalId);
      if (seenSignalIds.has(signalId)) {
        return false;
      }
      seenSignalIds.add(signalId);
      return true;
    })
    .map((rule) => ({
      instanceId: makeRuleId("signal"),
      id: normalizeSignalId(rule.signalId),
      source,
      title: workflowSourceLabel(source),
      summary: result.summary,
      createdAt: new Date().toISOString(),
      chainId: chainId || null,
      parentActivityId: parentActivityId || null,
      sourceStepLabel: sourceStepLabel || null,
      payload: {
        projectKey,
        projectName,
        taskKind: result.taskKind,
        sourceBranch,
        targetBranches,
      },
    }));
}

export function createProjectWorkflowSignals({
  broadcasts,
  replay,
  summary,
  chainId,
  parentActivityId,
  sourceStepLabel,
}: {
  broadcasts: WorkflowBroadcastRule[];
  replay: WorkflowProjectReplay;
  summary?: string;
  chainId?: string;
  parentActivityId?: string;
  sourceStepLabel?: string;
}): WorkflowSignal[] {
  const source = workflowSourceForProjectAction(replay.action);
  const replayKey = workflowReplayKey(replay);
  const seenSignalIds = new Set<string>();
  const projectKey = replay.projectKey ?? "";
  const projectName =
    replay.projectName || replay.shortcut?.entry.name || replay.shortcut?.entry.targetLabel || "";
  return broadcasts
    .filter(
      (rule) =>
        rule.enabled &&
        rule.source === source &&
        rule.signalId.trim() &&
        (!rule.replayKey || rule.replayKey === replayKey),
    )
    .filter((rule) => {
      const signalId = normalizeSignalId(rule.signalId);
      if (seenSignalIds.has(signalId)) {
        return false;
      }
      seenSignalIds.add(signalId);
      return true;
    })
    .map((rule) => ({
      instanceId: makeRuleId("signal"),
      id: normalizeSignalId(rule.signalId),
      source,
      title: workflowSourceLabel(source),
      summary: summary || workflowReplayLabel(replay),
      createdAt: new Date().toISOString(),
      chainId: chainId || null,
      parentActivityId: parentActivityId || null,
      sourceStepLabel: sourceStepLabel || null,
      payload: {
        projectKey,
        projectName,
        sourceBranch: "",
        targetBranches: [],
        action: replay.action,
        targetLabel: replay.shortcut?.entry.targetLabel || "",
      },
    }));
}

export function workflowReplayFromBuildHistory(entry: BuildHistoryEntry): WorkflowBuildReplay {
  return {
    target: "build.replay",
    entry: cloneJson(entry),
  };
}

export function workflowReplayFromBranchHistory(
  entry: BranchTaskHistoryEntry,
): WorkflowBranchReplay | null {
  return entry.replay
    ? {
        target: "branch.replay",
        entry: cloneJson(entry),
      }
    : null;
}

export function workflowReplayFromProjectRuntime(
  entry: ProjectRuntimeEntry,
  action: ProjectWorkflowAction,
): WorkflowProjectReplay {
  return {
    target: "project.replay",
    action,
    projectKey: entry.key,
    projectName: entry.name,
  };
}

export function workflowReplayFromFinderShortcut(
  item: FinderShortcutItem,
): WorkflowProjectReplay {
  return {
    target: "project.replay",
    action: "finder.shortcut.open",
    shortcut: cloneJson(item),
  };
}

export function workflowReplayKey(replay: WorkflowReplay) {
  if (isBuildReplay(replay)) {
    return `build:${replay.entry.projectKey}:${replay.entry.mode}:${stableJson(replay.entry.params ?? {})}`;
  }
  if (replay.target === "branch.replay") {
    return `branch:${replay.entry.taskKind}:${stableJson(replay.entry.replay?.request ?? {})}`;
  }
  if (replay.action === "finder.shortcut.open") {
    return `project:${replay.action}:${stableJson(replay.shortcut ?? {})}`;
  }
  return `project:${replay.action}:${replay.projectKey ?? ""}`;
}

export function workflowReplayLabel(replay: WorkflowReplay) {
  if (isBuildReplay(replay)) {
    return `${replay.entry.projectName} / ${replay.entry.mode}`;
  }
  if (replay.target === "branch.replay") {
    return `${workflowSourceLabel(workflowSourceForBranchTask(replay.entry.taskKind))} / ${replay.entry.summary}`;
  }
  if (replay.action === "finder.shortcut.open") {
    const name = replay.shortcut?.entry.name || replay.shortcut?.entry.targetLabel || "入口";
    return `${workflowProjectActionLabel(replay.action)} / ${name}`;
  }
  return `${workflowProjectActionLabel(replay.action)} / ${replay.projectName || replay.projectKey || "项目"}`;
}

export function makeReceiveRulesForReplay({
  replay,
  signalIds,
  existing,
}: {
  replay: WorkflowReplay;
  signalIds: string[];
  existing: WorkflowReceiveRule[];
}): WorkflowReceiveRule[] {
  const replayKey = workflowReplayKey(replay);
  const label = workflowReplayLabel(replay);
  const normalizedIds = Array.from(
    new Set(signalIds.map((item) => item.trim()).filter(Boolean)),
  );

  const keptRules = existing.filter(
    (rule) => !(workflowReplayTargetsEqual(rule.target, replay.target) && rule.replayKey === replayKey),
  );
  const nextRules = normalizedIds.map((signalId) => ({
    id: makeRuleId("receive"),
    enabled: true,
    signalId,
    target: replay.target,
    replayKey,
    label,
    replay,
  }));

  return [...keptRules, ...nextRules];
}

export function makeBroadcastRulesForReplay({
  replay,
  signalIds,
  existing,
}: {
  replay: WorkflowReplay;
  signalIds: string[];
  existing: WorkflowBroadcastRule[];
}): WorkflowBroadcastRule[] {
  const source = workflowSourceForReplay(replay);
  if (!source) {
    return existing;
  }

  const replayKey = workflowReplayKey(replay);
  const label = workflowReplayLabel(replay);
  const normalizedIds = Array.from(
    new Set(signalIds.map((item) => item.trim()).filter(Boolean)),
  );

  const keptRules = existing.filter((rule) => rule.replayKey !== replayKey);
  const nextRules = normalizedIds.map((signalId) => ({
    id: makeRuleId("broadcast"),
    enabled: true,
    source,
    signalId,
    replayKey,
    label,
    replay,
  }));

  return [...keptRules, ...nextRules];
}

function slugSignalPart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workflow";
}

export function defaultSignalIdForReplay(replay: WorkflowReplay) {
  if (replay.target === "branch.replay") {
    switch (replay.entry.taskKind) {
      case "push":
        return "push-to-merge";
      case "sync":
        return DEFAULT_WORKFLOW_SIGNAL_ID;
      case "create":
        return "branch-create-success";
      case "checkout":
        return "branch-checkout-success";
      case "switch":
        return "branch-switch-success";
    }
  }
  if (isBuildReplay(replay)) {
    return `${slugSignalPart(replay.entry.projectKey)}-build-success`;
  }
  if (replay.action === "finder.shortcut.open") {
    return `${slugSignalPart(replay.shortcut?.entry.name || "shortcut")}-open-success`;
  }
  const project = slugSignalPart(replay.projectKey || replay.projectName || "project");
  const action = replay.action
    .replace(/^project\./, "")
    .replace(/\./g, "-")
    .replace(/openOutput/g, "open-output");
  return `${project}-${action}-success`;
}

export function parseSignalIdList(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatSignalIdList(values: string[]) {
  return values.join("\n");
}

export function matchingReceiversForSignal(
  signal: WorkflowSignal,
  receivers: WorkflowReceiveRule[],
) {
  return receivers.filter(
    (rule) => rule.enabled && rule.signalId.trim() && rule.signalId.trim() === signal.id,
  );
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
