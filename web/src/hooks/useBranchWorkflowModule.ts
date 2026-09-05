import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BranchPushAction,
  BranchPushStatus,
  BranchTaskHistoryEntry,
  BranchTaskPendingEntry,
  BranchTaskReplayCommand,
  BranchTaskReplayRequest,
  BranchTaskResponse,
  BranchWorkflowMode,
  BranchWorktreeSummary,
  MergeHistoryEntry,
} from "../app-types";
import type {
  ActivityResource,
  ActivityRecorder,
  ActivityUpdater,
} from "../lib/activityCenter";
import { stableActivityJson } from "../lib/activityCenter";
import {
  branchTaskDiagnosticSteps,
  branchTaskDisplayDetail,
  branchTaskFailureReplay,
} from "../lib/branchTaskDetails";
import {
  createFailedBranchTaskEntry,
  createPendingBranchTaskEntry,
  inferBranchSyncReplay,
} from "../lib/branchOperationHistory";
import { createClientOperationId } from "../lib/operationLifecycle";
import {
  deleteStoredJson,
  getStoredJson,
  prependStoredJsonArray,
  setStoredJson,
} from "../lib/storage";
import {
  createBranchTaskSignals,
  workflowReplayFromBranchHistory,
  type WorkflowBroadcastRule,
  type WorkflowSignal,
} from "../lib/workflowSignals";
import type { ProjectSummary } from "./useBranchContext";

const BRANCH_WORKFLOW_STORAGE_NAMESPACE = "branch-workflow";
const BRANCH_WORKFLOW_HISTORY_KEY = "history";
const MAX_STORED_HISTORY_ITEMS = 200;
const MAX_VISIBLE_HISTORY_ITEMS = 20;
const CLI_BRANCH_SYNC_HISTORY_PREFIX = "branch-sync-cli-";
const PUSH_STATUS_STALE_MS = 60_000;
const PUSH_STATUS_AUTO_REFRESH_COOLDOWN_MS = 5_000;
const REPLAY_COMMANDS = new Set<BranchTaskReplayCommand>([
  "execute_branch_sync_task",
  "execute_branch_create_task",
  "checkout_branch_to_directory_task",
  "execute_branch_switch_task",
  "execute_branch_push_task",
]);

type UseBranchWorkflowModuleOptions = {
  enabled: boolean;
  activeProjectWorkspaceKey: string;
  projects: ProjectSummary[];
  selectedProject: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  workflowBroadcastRules: WorkflowBroadcastRule[];
  emitWorkflowSignals: (signals: WorkflowSignal[]) => Promise<void>;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
};

type BranchTaskRunOptions = {
  force?: boolean;
  origin?: "app" | "tray";
  workspaceKey?: string | null;
  chainId?: string | null;
  parentId?: string | null;
  stepLabel?: string | null;
};

function normalizeValues(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export function branchWorkflowReferenceProject(
  mode: BranchWorkflowMode,
  selectedProject: string,
  syncProjects: string[],
  createProjects: string[],
) {
  const selectedProjects =
    mode === "sync"
      ? normalizeValues(syncProjects)
      : mode === "create"
        ? normalizeValues(createProjects)
        : [];
  return selectedProjects[0] || selectedProject.trim();
}

export function branchWorkflowProjectReset(selectedProject: string) {
  return {
    syncProjects: selectedProject ? [selectedProject] : [],
    syncSource: "",
    syncTargets: [] as string[],
    createProjects: selectedProject ? [selectedProject] : [],
    createSource: "",
    createTarget: "",
    checkoutSource: "",
    checkoutDestinationDir: "",
    switchTarget: "",
  };
}

function cloneReplayRequest(request: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
}

function normalizeReplay(value: unknown): BranchTaskReplayRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<BranchTaskReplayRequest>;
  if (
    typeof candidate.command !== "string" ||
    !REPLAY_COMMANDS.has(candidate.command as BranchTaskReplayCommand) ||
    typeof candidate.busyText !== "string" ||
    !candidate.request ||
    typeof candidate.request !== "object" ||
    Array.isArray(candidate.request)
  ) {
    return null;
  }

  return {
    command: candidate.command as BranchTaskReplayCommand,
    busyText: candidate.busyText,
    request: cloneReplayRequest(candidate.request as Record<string, unknown>),
    refreshPushStatusProject:
      typeof candidate.refreshPushStatusProject === "string"
        ? candidate.refreshPushStatusProject
        : null,
    clearPushCommitMessageOnSuccess: Boolean(
      candidate.clearPushCommitMessageOnSuccess,
    ),
  };
}

function normalizeHistory(value: unknown): BranchTaskHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is BranchTaskHistoryEntry => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const candidate = item as Partial<BranchTaskHistoryEntry>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.taskKind === "string" &&
        typeof candidate.summary === "string" &&
        Array.isArray(candidate.items)
      );
    })
    .map((item) => {
      const replay = normalizeReplay(item.replay);
      return {
        ...item,
        replay: replay ?? inferBranchSyncReplay(item),
      };
    })
    .slice(0, MAX_STORED_HISTORY_ITEMS);
}

function cliBranchSyncBatch(historyKey: string) {
  if (!historyKey.startsWith(CLI_BRANCH_SYNC_HISTORY_PREFIX)) {
    return null;
  }
  const separatorIndex = historyKey.lastIndexOf("-");
  const itemIndex = Number(historyKey.slice(separatorIndex + 1));
  if (
    separatorIndex < CLI_BRANCH_SYNC_HISTORY_PREFIX.length ||
    !Number.isInteger(itemIndex) ||
    itemIndex < 0
  ) {
    return { batchKey: historyKey, itemIndex: 0 };
  }
  return {
    batchKey: historyKey.slice(0, separatorIndex),
    itemIndex,
  };
}

function normalizeMergeHistoryCreatedAt(value: string) {
  const normalized = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, "$1T$2Z");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function branchTaskHistoryTimestamp(item: BranchTaskHistoryEntry) {
  const timestamp = Date.parse(item.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function cliMergeHistoryDetail(items: BranchTaskHistoryEntry["items"]) {
  return items
    .map((item) => {
      const heading = `${item.projectName}: ${item.sourceBranch} -> ${item.targetBranch ?? "-"} [${item.statusLabel}]`;
      if (item.success) {
        return heading;
      }
      return [
        heading,
        item.summary.trim() ? `原因：${item.summary.trim()}` : "",
        item.detail.trim() && item.detail.trim() !== item.summary.trim()
          ? item.detail.trim()
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function branchTaskHistoryFromCliMergeHistory(
  history: MergeHistoryEntry[],
): BranchTaskHistoryEntry[] {
  const batches = new Map<
    string,
    Array<{ history: MergeHistoryEntry; itemIndex: number }>
  >();
  for (const item of history) {
    const batch = cliBranchSyncBatch(item.historyKey);
    if (!batch) {
      continue;
    }
    const entries = batches.get(batch.batchKey) ?? [];
    entries.push({ history: item, itemIndex: batch.itemIndex });
    batches.set(batch.batchKey, entries);
  }

  return Array.from(batches, ([batchKey, entries]) => {
    entries.sort((left, right) => left.itemIndex - right.itemIndex);
    const items = entries.map(({ history: item }) => ({
      projectKey: item.projectKey,
      projectName: item.projectName,
      sourceBranch: item.sourceBranch,
      targetBranch: item.targetBranch,
      outputPath: null,
      success: item.success,
      statusKey: item.success ? "merged" : "merge_failed",
      statusLabel: item.success ? "已合并" : "失败",
      summary: item.summary,
      detail: item.detail,
      remote: item.remote,
      commit: item.targetCommit ?? null,
    }));
    const failed = items.filter((item) => !item.success).length;
    const succeeded = items.length - failed;
    const summary = [`成功 ${succeeded}`, failed > 0 ? `失败 ${failed}` : ""]
      .filter(Boolean)
      .join(" / ");
    const createdAt = entries
      .map(({ history: item }) =>
        normalizeMergeHistoryCreatedAt(item.createdAt),
      )
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

    const entry = {
      id: batchKey,
      taskKind: "sync" as const,
      success: failed === 0,
      summary,
      detail: cliMergeHistoryDetail(items),
      items,
      createdAt,
      workspaceKey: entries[0]?.history.workspaceKey ?? null,
      replay: null,
    };
    return {
      ...entry,
      replay: inferBranchSyncReplay(entry),
    };
  }).sort(
    (left, right) =>
      branchTaskHistoryTimestamp(right) - branchTaskHistoryTimestamp(left),
  );
}

export function mergeBranchTaskHistory(
  ...sources: BranchTaskHistoryEntry[][]
): BranchTaskHistoryEntry[] {
  const historyById = new Map<string, BranchTaskHistoryEntry>();
  for (const item of sources.flat()) {
    if (!historyById.has(item.id)) {
      historyById.set(item.id, item);
    }
  }
  return Array.from(historyById.values())
    .sort(
      (left, right) =>
        branchTaskHistoryTimestamp(right) - branchTaskHistoryTimestamp(left),
    )
    .slice(0, MAX_STORED_HISTORY_ITEMS);
}

function isCliBranchTaskHistory(item: BranchTaskHistoryEntry) {
  return item.id.startsWith(CLI_BRANCH_SYNC_HISTORY_PREFIX);
}

function makeHistoryEntry(
  result: BranchTaskResponse,
  workspaceKey: string,
  replay?: BranchTaskReplayRequest | null,
  entryId?: string | null,
): BranchTaskHistoryEntry {
  return {
    ...result,
    id:
      entryId?.trim() ||
      `${result.taskKind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    workspaceKey,
    replay: replay
      ? { ...replay, request: cloneReplayRequest(replay.request) }
      : null,
  };
}

function makeReplayRequest(
  command: BranchTaskReplayCommand,
  busyText: string,
  request: Record<string, unknown>,
  options: Omit<
    BranchTaskReplayRequest,
    "command" | "busyText" | "request"
  > = {},
): BranchTaskReplayRequest {
  return {
    command,
    busyText,
    request: cloneReplayRequest(request),
    ...options,
  };
}

function requestProject(request: Record<string, unknown>) {
  return typeof request.project === "string" ? request.project : "";
}

function requestRepoPath(request: Record<string, unknown>) {
  return typeof request.repoPath === "string" ? request.repoPath : "";
}

function requestFirstProject(request: Record<string, unknown>) {
  return requestProjects(request)[0] || "";
}

function requestProjects(request: Record<string, unknown>) {
  return normalizeValues([
    requestProject(request),
    ...(Array.isArray(request.projects)
      ? request.projects.filter(
          (item): item is string => typeof item === "string",
        )
      : []),
  ]);
}

function worktreeFromPushStatus(
  status: BranchPushStatus,
): BranchWorktreeSummary {
  const name =
    status.repoPath.split(/[\\/]/).filter(Boolean).pop() || "自选目录";
  return {
    projectKey: status.projectKey,
    projectName: status.projectName,
    repoPath: status.repoPath,
    label: name,
    currentBranch: status.currentBranch,
    detached: status.detached,
    clean: status.clean,
    ahead: status.ahead,
    behind: status.behind,
    isDefault: false,
    isGitWorktree: false,
    isWorkspaceInstance: false,
    managed: false,
    statusKey: status.clean ? "clean" : "dirty",
    statusLabel: status.clean ? "干净" : "有改动",
    detail: status.upstreamBranch
      ? `upstream: ${status.upstreamBranch}`
      : "自选本地目录",
    latestCommit: status.latestCommit,
  };
}

function branchModeFromCommand(
  command: BranchTaskReplayCommand,
): BranchWorkflowMode {
  if (command === "execute_branch_create_task") {
    return "create";
  }
  if (command === "checkout_branch_to_directory_task") {
    return "checkout";
  }
  if (command === "execute_branch_switch_task") {
    return "switch";
  }
  if (command === "execute_branch_push_task") {
    return "push";
  }
  return "sync";
}

function branchActivityTitle(command: BranchTaskReplayCommand) {
  if (command === "execute_branch_create_task") {
    return "创建分支";
  }
  if (command === "checkout_branch_to_directory_task") {
    return "克隆分支";
  }
  if (command === "execute_branch_switch_task") {
    return "切换分支";
  }
  if (command === "execute_branch_push_task") {
    return "推送分支";
  }
  return "合并分支";
}

function branchActivityExecutionKey(
  command: BranchTaskReplayCommand,
  request: Record<string, unknown>,
) {
  return `branch:${command}:${stableActivityJson(request)}`;
}

function branchHistoryMatchesProjects(
  item: BranchTaskHistoryEntry,
  projectKeys: Set<string>,
) {
  if (projectKeys.size === 0) {
    return false;
  }
  return item.items.some((entry) => projectKeys.has(entry.projectKey));
}

export function branchHistoryMatchesWorkspace(
  item: BranchTaskHistoryEntry,
  workspaceKey: string,
  projectKeys: Set<string>,
) {
  if (workspaceKey === "system") {
    return true;
  }
  return (
    item.workspaceKey?.trim() === workspaceKey &&
    branchHistoryMatchesProjects(item, projectKeys)
  );
}

function branchResultResource(
  result: BranchTaskResponse,
): ActivityResource | null {
  const outputPath = result.items
    .find((item) => item.outputPath)
    ?.outputPath?.trim();
  if (!outputPath) {
    return null;
  }
  return {
    kind: "localPath",
    label: result.taskKind === "checkout" ? "打开目标目录" : "打开输出目录",
    value: outputPath,
  };
}

export function useBranchWorkflowModule({
  enabled,
  activeProjectWorkspaceKey,
  projects,
  selectedProject,
  setBusy,
  setError,
  workflowBroadcastRules,
  emitWorkflowSignals,
  recordActivity,
  updateActivity,
}: UseBranchWorkflowModuleOptions) {
  const [mode, setMode] = useState<BranchWorkflowMode>("sync");
  const [syncProjects, setSyncProjects] = useState<string[]>([]);
  const [syncSource, setSyncSource] = useState("");
  const [syncTargets, setSyncTargets] = useState<string[]>([]);
  const [createProjects, setCreateProjects] = useState<string[]>([]);
  const [createSource, setCreateSource] = useState("");
  const [createTarget, setCreateTarget] = useState("");
  const [checkoutSource, setCheckoutSource] = useState("");
  const [checkoutDestinationDir, setCheckoutDestinationDir] = useState("");
  const [switchTarget, setSwitchTarget] = useState("");
  const [pushAction, setPushAction] = useState<BranchPushAction>("pushOnly");
  const [pushCommitMessage, setPushCommitMessage] = useState("");
  const [pushSelectedPaths, setPushSelectedPaths] = useState<string[]>([]);
  const [pushStatus, setPushStatus] = useState<BranchPushStatus | null>(null);
  const [pushStatusLoading, setPushStatusLoading] = useState(false);
  const [pushStatusError, setPushStatusError] = useState("");
  const [pushStatusUpdatedAtMs, setPushStatusUpdatedAtMs] = useState(0);
  const [worktrees, setWorktrees] = useState<BranchWorktreeSummary[]>([]);
  const [worktreesLoading, setWorktreesLoading] = useState(false);
  const [worktreesError, setWorktreesError] = useState("");
  const [selectedWorktreePath, setSelectedWorktreePath] = useState("");
  const [branchTaskHistory, setBranchTaskHistory] = useState<
    BranchTaskHistoryEntry[]
  >([]);
  const [currentBranchTaskHistoryId, setCurrentBranchTaskHistoryId] =
    useState("");
  const [currentBranchTask, setCurrentBranchTask] =
    useState<BranchTaskPendingEntry | null>(null);
  const lastBranchActivityIdRef = useRef("");
  const lastBranchTaskHistoryEntryRef = useRef<BranchTaskHistoryEntry | null>(
    null,
  );
  const pushStatusLoadedProjectRef = useRef("");
  const syncReferenceProjectRef = useRef("");
  const createReferenceProjectRef = useRef("");
  const syncReferenceProject = branchWorkflowReferenceProject(
    "sync",
    selectedProject,
    syncProjects,
    createProjects,
  );
  const createReferenceProject = branchWorkflowReferenceProject(
    "create",
    selectedProject,
    syncProjects,
    createProjects,
  );

  const worktreeOptions = useMemo(() => {
    const items = [...worktrees];
    const selectedPath = selectedWorktreePath.trim();
    if (selectedPath && !items.some((item) => item.repoPath === selectedPath)) {
      if (pushStatus?.repoPath === selectedPath) {
        items.push(worktreeFromPushStatus(pushStatus));
      } else {
        items.push({
          projectKey: selectedProject,
          projectName:
            projects.find((project) => project.key === selectedProject)?.name ||
            selectedProject,
          repoPath: selectedPath,
          label: "自选目录",
          currentBranch: "",
          detached: false,
          clean: false,
          ahead: 0,
          behind: 0,
          isDefault: false,
          isGitWorktree: false,
          isWorkspaceInstance: false,
          managed: false,
          statusKey: "custom",
          statusLabel: "待刷新",
          detail: "手动选择的本地目录",
          latestCommit: null,
        });
      }
    }
    return items;
  }, [projects, pushStatus, selectedProject, selectedWorktreePath, worktrees]);

  const projectOptions = useMemo(
    () => projects.map(({ key, name }) => ({ key, name })),
    [projects],
  );
  const projectKeySet = useMemo(
    () => new Set(projects.map((project) => project.key)),
    [projects],
  );

  function handleWorktreePathChange(value: string) {
    setSelectedWorktreePath(value);
    setPushStatus(null);
    setPushStatusError("");
    setPushStatusUpdatedAtMs(0);
    setPushSelectedPaths([]);
    pushStatusLoadedProjectRef.current = "";
  }

  const visibleBranchTaskHistory = useMemo(
    () =>
      enabled
        ? branchTaskHistory
            .filter((item) =>
              branchHistoryMatchesWorkspace(
                item,
                activeProjectWorkspaceKey,
                projectKeySet,
              ),
            )
            .slice(0, MAX_VISIBLE_HISTORY_ITEMS)
        : [],
    [activeProjectWorkspaceKey, branchTaskHistory, enabled, projectKeySet],
  );

  useEffect(() => {
    if (!enabled) {
      setCurrentBranchTaskHistoryId("");
      setCurrentBranchTask(null);
      lastBranchTaskHistoryEntryRef.current = null;
      setPushStatus(null);
      setPushStatusError("");
      setPushStatusUpdatedAtMs(0);
      setWorktrees([]);
      setWorktreesError("");
      setSelectedWorktreePath("");
      setPushCommitMessage("");
      setPushSelectedPaths([]);
      pushStatusLoadedProjectRef.current = "";
      const reset = branchWorkflowProjectReset("");
      setSyncProjects(reset.syncProjects);
      setSyncSource(reset.syncSource);
      setSyncTargets(reset.syncTargets);
      setCreateProjects(reset.createProjects);
      setCreateSource(reset.createSource);
      setCreateTarget(reset.createTarget);
      setCheckoutSource(reset.checkoutSource);
      setCheckoutDestinationDir(reset.checkoutDestinationDir);
      setSwitchTarget(reset.switchTarget);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      syncReferenceProjectRef.current = "";
      return;
    }
    if (
      syncReferenceProjectRef.current &&
      syncReferenceProjectRef.current !== syncReferenceProject
    ) {
      setSyncSource("");
      setSyncTargets([]);
    }
    syncReferenceProjectRef.current = syncReferenceProject;
  }, [enabled, syncReferenceProject]);

  useEffect(() => {
    if (!enabled) {
      createReferenceProjectRef.current = "";
      return;
    }
    if (
      createReferenceProjectRef.current &&
      createReferenceProjectRef.current !== createReferenceProject
    ) {
      setCreateSource("");
      setCreateTarget("");
    }
    createReferenceProjectRef.current = createReferenceProject;
  }, [createReferenceProject, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const reset = branchWorkflowProjectReset(selectedProject);
    setSyncProjects(reset.syncProjects);
    setSyncSource(reset.syncSource);
    setSyncTargets(reset.syncTargets);
    setCreateProjects(reset.createProjects);
    setCreateSource(reset.createSource);
    setCreateTarget(reset.createTarget);
    setCheckoutSource(reset.checkoutSource);
    setCheckoutDestinationDir(reset.checkoutDestinationDir);
    setSwitchTarget(reset.switchTarget);
    setWorktrees([]);
    setWorktreesError("");
    setSelectedWorktreePath("");
    setPushSelectedPaths([]);
  }, [enabled, selectedProject]);

  useEffect(() => {
    setPushStatus(null);
    setPushStatusError("");
    setPushStatusUpdatedAtMs(0);
    setPushCommitMessage("");
    setPushSelectedPaths([]);
    pushStatusLoadedProjectRef.current = "";
  }, [selectedProject]);

  useEffect(() => {
    if (!enabled || !selectedProject) {
      return;
    }
    void loadProjectWorktrees(selectedProject);
  }, [enabled, selectedProject]);

  useEffect(() => {
    const selectedWorktree = worktrees.find(
      (item) => item.repoPath === selectedWorktreePath.trim(),
    );
    if (
      !enabled ||
      (mode !== "push" && mode !== "switch") ||
      !selectedProject ||
      !selectedWorktreePath ||
      selectedWorktree?.statusKey === "missing" ||
      selectedWorktree?.statusKey === "unavailable"
    ) {
      return;
    }
    const loadKey = `${selectedProject}:${selectedWorktreePath.trim()}`;
    const statusFresh =
      pushStatusUpdatedAtMs > 0 &&
      Date.now() - pushStatusUpdatedAtMs < PUSH_STATUS_STALE_MS;
    if (pushStatusLoadedProjectRef.current === loadKey && statusFresh) {
      return;
    }
    void loadPushStatus(selectedProject, selectedWorktreePath);
  }, [
    enabled,
    mode,
    pushStatusUpdatedAtMs,
    selectedProject,
    selectedWorktreePath,
    worktrees,
  ]);

  async function loadBranchTaskHistory() {
    if (!enabled) {
      setBranchTaskHistory([]);
      return;
    }
    try {
      const [stored, mergeHistory] = await Promise.all([
        getStoredJson<unknown>(
          BRANCH_WORKFLOW_STORAGE_NAMESPACE,
          BRANCH_WORKFLOW_HISTORY_KEY,
        ),
        invoke<MergeHistoryEntry[]>("list_merge_history").catch(() => []),
      ]);
      setBranchTaskHistory(
        mergeBranchTaskHistory(
          normalizeHistory(stored),
          branchTaskHistoryFromCliMergeHistory(mergeHistory),
        ),
      );
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function persistHistory(
    result: BranchTaskResponse,
    replay?: BranchTaskReplayRequest | null,
    workspaceKey = activeProjectWorkspaceKey,
    entryId?: string | null,
  ) {
    const entry = makeHistoryEntry(result, workspaceKey, replay, entryId);
    setBranchTaskHistory((current) => mergeBranchTaskHistory([entry], current));
    const stored = await prependStoredJsonArray<unknown>(
      BRANCH_WORKFLOW_STORAGE_NAMESPACE,
      BRANCH_WORKFLOW_HISTORY_KEY,
      entry,
      MAX_STORED_HISTORY_ITEMS,
    );
    const next = normalizeHistory(stored);
    setBranchTaskHistory((current) =>
      mergeBranchTaskHistory(next, current.filter(isCliBranchTaskHistory)),
    );
    return entry;
  }

  async function handleClearBranchTaskHistory() {
    setBusy("正在清空分支任务记录");
    setError("");
    try {
      const stored = await getStoredJson<unknown>(
        BRANCH_WORKFLOW_STORAGE_NAMESPACE,
        BRANCH_WORKFLOW_HISTORY_KEY,
      );
      const remaining = normalizeHistory(stored).filter(
        (item) =>
          !branchHistoryMatchesWorkspace(
            item,
            activeProjectWorkspaceKey,
            projectKeySet,
          ),
      );
      await Promise.all([
        remaining.length > 0
          ? setStoredJson(
              BRANCH_WORKFLOW_STORAGE_NAMESPACE,
              BRANCH_WORKFLOW_HISTORY_KEY,
              remaining,
            )
          : deleteStoredJson(
              BRANCH_WORKFLOW_STORAGE_NAMESPACE,
              BRANCH_WORKFLOW_HISTORY_KEY,
            ),
        invoke<number>("clear_merge_history"),
      ]);
      setBranchTaskHistory((current) =>
        mergeBranchTaskHistory(
          remaining,
          current.filter(
            (item) =>
              isCliBranchTaskHistory(item) &&
              !branchHistoryMatchesWorkspace(
                item,
                activeProjectWorkspaceKey,
                projectKeySet,
              ),
          ),
        ),
      );
      setCurrentBranchTaskHistoryId("");
      setCurrentBranchTask(null);
      lastBranchTaskHistoryEntryRef.current = null;
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleChooseCheckoutDirectory() {
    setError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择目标目录",
      });
      if (typeof selected === "string") {
        setCheckoutDestinationDir(selected);
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function loadProjectWorktrees(projectKey = selectedProject) {
    if (!enabled || !projectKey) {
      setWorktrees([]);
      setWorktreesError("");
      return [];
    }
    setWorktreesLoading(true);
    setWorktreesError("");
    try {
      const result = await invoke<BranchWorktreeSummary[]>(
        "list_project_worktrees",
        {
          project: projectKey,
        },
      );
      setWorktrees(result);
      setSelectedWorktreePath((current) => {
        const normalized = current.trim();
        if (normalized && result.some((item) => item.repoPath === normalized)) {
          return normalized;
        }
        return (
          result.find((item) => item.isWorkspaceInstance)?.repoPath ||
          result.find((item) => item.isDefault)?.repoPath ||
          result[0]?.repoPath ||
          ""
        );
      });
      return result;
    } catch (reason) {
      const message = String(reason);
      setWorktrees([]);
      setWorktreesError(message);
      return [];
    } finally {
      setWorktreesLoading(false);
    }
  }

  async function handleChooseWorktreeDirectory() {
    setError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择本地工作副本",
      });
      if (typeof selected === "string") {
        setSelectedWorktreePath(selected);
        await loadPushStatus(selectedProject, selected);
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function handleRepairWorktree(repoPath = selectedWorktreePath) {
    const normalizedRepoPath = repoPath.trim();
    if (!enabled || !selectedProject || !normalizedRepoPath) {
      return;
    }
    setBusy("正在修复工作副本");
    setError("");
    setWorktreesError("");
    try {
      const result = await invoke<BranchWorktreeSummary[]>(
        "repair_project_worktree",
        {
          project: selectedProject,
          repoPath: normalizedRepoPath,
        },
      );
      setWorktrees(result);
      setSelectedWorktreePath(normalizedRepoPath);
      await loadPushStatus(selectedProject, normalizedRepoPath);
    } catch (reason) {
      const message = String(reason);
      setWorktreesError(message);
      setError(message);
    } finally {
      setBusy("");
    }
  }

  async function runBranchTask(
    busyText: string,
    command: BranchTaskReplayCommand,
    request: Record<string, unknown>,
    replay = makeReplayRequest(command, busyText, request),
    options: BranchTaskRunOptions = {},
  ) {
    if (!enabled && !options.force) {
      return null;
    }
    setBusy(busyText);
    setError("");
    lastBranchTaskHistoryEntryRef.current = null;
    const taskKind = branchModeFromCommand(command);
    const requestedProjects = requestProjects(request);
    const requestedProject = requestedProjects[0] || selectedProject;
    const requestedProjectName =
      projects.find((project) => project.key === requestedProject)?.name ||
      requestedProject;
    const activityId = createClientOperationId("branch");
    const operationProjects = (
      requestedProjects.length > 0 ? requestedProjects : [requestedProject]
    ).map((projectKey) => ({
      key: projectKey,
      name:
        projects.find((project) => project.key === projectKey)?.name ||
        projectKey,
    }));
    const pendingEntry = createPendingBranchTaskEntry({
      id: activityId,
      taskKind,
      summary: busyText,
      projects: operationProjects,
    });
    setCurrentBranchTask(pendingEntry);
    setCurrentBranchTaskHistoryId(activityId);
    recordActivity?.({
      id: activityId,
      kind: "branch",
      status: "running",
      title: branchActivityTitle(command),
      summary: busyText,
      executionKey: branchActivityExecutionKey(command, request),
      chainId: options.chainId ?? null,
      parentId: options.parentId ?? null,
      stepLabel: options.stepLabel ?? branchActivityTitle(command),
      chainLabel: options.chainId ? "联动链路" : null,
      projectKey: requestedProject,
      projectName: requestedProjectName,
      target: {
        page: "merge",
        projectKey: requestedProject,
        branchMode: taskKind,
      },
    });
    lastBranchActivityIdRef.current = activityId;
    try {
      const result = await invoke<BranchTaskResponse>(command, {
        request,
        activityId: activityId || null,
        operationOrigin: options.origin ?? "app",
      });
      const recoveryReplay = branchTaskFailureReplay(result, replay);
      const historyReplay = result.success ? replay : recoveryReplay;
      const historyPromise = persistHistory(
        result,
        historyReplay,
        options.workspaceKey ?? activeProjectWorkspaceKey,
        activityId,
      );
      setCurrentBranchTask(null);
      const resultProjectKey = result.items[0]?.projectKey || requestedProject;
      const resultProjectName =
        result.items[0]?.projectName ||
        projects.find((project) => project.key === resultProjectKey)?.name ||
        resultProjectKey;
      updateActivity?.(activityId, {
        status: result.success ? "success" : "failed",
        summary: result.summary,
        detail: branchTaskDisplayDetail(result),
        chainId: options.chainId ?? undefined,
        parentId: options.parentId ?? undefined,
        stepLabel: options.stepLabel ?? branchActivityTitle(command),
        chainLabel: options.chainId ? "联动链路" : undefined,
        projectKey: resultProjectKey,
        projectName: resultProjectName,
        diagnostics: branchTaskDiagnosticSteps(result),
        warnings:
          !result.success && !recoveryReplay
            ? [
                "当前批次包含同一项目的部分成功结果，请打开 Git 页面核对后按剩余目标执行。",
              ]
            : [],
        resource: branchResultResource(result),
        target: {
          page: "merge",
          projectKey: resultProjectKey,
          branchMode: result.taskKind,
        },
        action: recoveryReplay
          ? {
              kind: "branchReplay",
              label: "检查并重试 Git 操作",
              replay: recoveryReplay,
            }
          : null,
      });
      try {
        lastBranchTaskHistoryEntryRef.current = await historyPromise;
      } catch (historyReason) {
        setError(
          `Git 操作已完成，但保存本地记录失败：${String(historyReason)}`,
        );
      }
      return result;
    } catch (reason) {
      const failureDetail = String(reason);
      const failedEntry = createFailedBranchTaskEntry({
        pending: pendingEntry,
        title: branchActivityTitle(command),
        detail: failureDetail,
        workspaceKey: options.workspaceKey ?? activeProjectWorkspaceKey,
        projects: operationProjects,
        sourceBranch:
          typeof request.sourceBranch === "string" ? request.sourceBranch : "",
        targetBranch:
          typeof request.targetBranch === "string"
            ? request.targetBranch
            : null,
        remote:
          command === "execute_branch_sync_task" ||
          command === "execute_branch_push_task",
        replay,
      });
      setBranchTaskHistory((current) =>
        mergeBranchTaskHistory([failedEntry], current),
      );
      setCurrentBranchTask(null);
      lastBranchTaskHistoryEntryRef.current = failedEntry;
      updateActivity?.(activityId, {
        status: "failed",
        summary: failedEntry.summary,
        detail: failureDetail,
        diagnostics: [
          {
            id: `${taskKind}:${requestedProject}:invoke`,
            type: `git.${taskKind}`,
            label: requestedProjectName,
            status: "failed",
            summary: failedEntry.summary,
            risks: [failureDetail],
          },
        ],
        action: {
          kind: "branchReplay",
          label: "检查并重试 Git 操作",
          replay,
        },
      });
      setError(failureDetail);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function handleReplayBranchRequest(
    replay: BranchTaskReplayRequest,
    options: BranchTaskRunOptions = {},
    sourceEntry?: BranchTaskHistoryEntry,
  ) {
    if (!enabled && !options.force) {
      return false;
    }
    const result = await runBranchTask(
      replay.busyText,
      replay.command,
      replay.request,
      replay,
      {
        ...options,
        stepLabel: options.stepLabel ?? branchActivityTitle(replay.command),
      },
    );
    if (
      replay.command === "execute_branch_push_task" ||
      replay.command === "execute_branch_switch_task"
    ) {
      const replayProject =
        replay.refreshPushStatusProject || requestProject(replay.request);
      const replayRepoPath = requestRepoPath(replay.request);
      await loadProjectWorktrees(replayProject);
      await loadPushStatus(replayProject, replayRepoPath);
      if (result?.success && replay.clearPushCommitMessageOnSuccess) {
        setPushCommitMessage("");
      }
    }
    await emitBranchTaskWorkflowSignals(
      result,
      sourceEntry ?? lastBranchTaskHistoryEntryRef.current ?? undefined,
      {
        sourceActivityId: lastBranchActivityIdRef.current,
        sourceStepLabel:
          options.stepLabel ?? branchActivityTitle(replay.command),
        chainId: options.chainId ?? undefined,
      },
    );
    return result?.success === true;
  }

  async function handleReplayBranchTaskHistory(
    item: BranchTaskHistoryEntry,
    options: BranchTaskRunOptions = {},
  ) {
    if (!item.replay) {
      return;
    }
    await handleReplayBranchRequest(item.replay, options, item);
  }

  async function loadPushStatus(
    projectKey = selectedProject,
    repoPath = selectedWorktreePath,
  ) {
    if (!enabled || !projectKey) {
      setPushStatus(null);
      setPushStatusUpdatedAtMs(0);
      return;
    }
    const normalizedRepoPath = repoPath.trim();
    const loadKey = `${projectKey}:${normalizedRepoPath}`;
    setPushStatusLoading(true);
    setPushStatusError("");
    try {
      const result = await invoke<BranchPushStatus>("get_project_push_status", {
        project: projectKey,
        repoPath: normalizedRepoPath || null,
      });
      const resolvedLoadKey = `${projectKey}:${normalizedRepoPath || result.repoPath}`;
      setPushStatus(result);
      setPushStatusUpdatedAtMs(Date.now());
      setSelectedWorktreePath((current) => current.trim() || result.repoPath);
      pushStatusLoadedProjectRef.current = resolvedLoadKey;
      return result;
    } catch (reason) {
      const message = String(reason);
      setPushStatus(null);
      setPushStatusError(message);
      setPushStatusUpdatedAtMs(0);
      pushStatusLoadedProjectRef.current = loadKey;
      setError(message);
      return null;
    } finally {
      setPushStatusLoading(false);
    }
  }

  useEffect(() => {
    if (
      !enabled ||
      (mode !== "push" && mode !== "switch") ||
      !selectedProject
    ) {
      return;
    }

    function refreshIfVisible() {
      if (pushStatusLoading) {
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      if (
        pushStatusUpdatedAtMs > 0 &&
        Date.now() - pushStatusUpdatedAtMs <
          PUSH_STATUS_AUTO_REFRESH_COOLDOWN_MS
      ) {
        return;
      }
      void loadPushStatus(selectedProject, selectedWorktreePath);
    }

    function handleVisibilityChange() {
      if (typeof document !== "undefined" && !document.hidden) {
        refreshIfVisible();
      }
    }

    window.addEventListener("focus", refreshIfVisible);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [
    enabled,
    mode,
    pushStatusLoading,
    pushStatusUpdatedAtMs,
    selectedProject,
    selectedWorktreePath,
  ]);

  useEffect(() => {
    setPushSelectedPaths((current) => {
      if (!pushStatus || current.length === 0) {
        return [];
      }
      const selectable = new Set(
        pushStatus.files
          .filter((item) => !item.conflicted)
          .map((item) => item.path),
      );
      const next = current.filter((path) => selectable.has(path));
      return next.length === current.length &&
        next.every((path, index) => path === current[index])
        ? current
        : next;
    });
  }, [pushStatus]);

  async function emitBranchTaskWorkflowSignals(
    result: BranchTaskResponse | null,
    entry?: BranchTaskHistoryEntry,
    chain?: {
      sourceActivityId?: string;
      sourceStepLabel?: string;
      chainId?: string;
    },
  ) {
    if (!result?.success) {
      return;
    }

    const projectKey = result.items[0]?.projectKey || selectedProject;
    const projectName =
      result.items[0]?.projectName ||
      projects.find((project) => project.key === projectKey)?.name ||
      projectKey;
    const sourceBranch =
      result.items.find((item) => item.sourceBranch)?.sourceBranch || "";
    const targetBranches = normalizeValues(
      result.items.map((item) => item.targetBranch || "").filter(Boolean),
    );

    try {
      const nextChainId =
        chain?.chainId ||
        (chain?.sourceActivityId ? `chain:${chain.sourceActivityId}` : "");
      const signals = createBranchTaskSignals({
        broadcasts: workflowBroadcastRules,
        replay: entry ? workflowReplayFromBranchHistory(entry) : null,
        projectKey,
        projectName,
        sourceBranch,
        targetBranches,
        result,
        chainId: nextChainId,
        parentActivityId: chain?.sourceActivityId,
        sourceStepLabel: chain?.sourceStepLabel,
      });
      if (signals.length > 0 && chain?.sourceActivityId && nextChainId) {
        updateActivity?.(chain.sourceActivityId, {
          chainId: nextChainId,
          stepLabel: chain.sourceStepLabel || "分支操作",
          chainLabel: "联动链路",
        });
      }
      await emitWorkflowSignals(signals);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function currentBranchSyncRequest() {
    const projects = normalizeValues(syncProjects);
    return {
      project: projects[0] || "",
      projects,
      sourceBranch: syncSource,
      targetBranches: normalizeValues(syncTargets),
    };
  }

  async function handlePlanSync() {
    if (!enabled) {
      return null;
    }
    setBusy("正在检查远端分支");
    setError("");
    try {
      return await invoke<BranchTaskResponse>("plan_branch_sync_task", {
        request: currentBranchSyncRequest(),
      });
    } catch (reason) {
      setError(String(reason));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function handleExecuteSync() {
    const request = currentBranchSyncRequest();
    const result = await runBranchTask(
      "正在合并分支",
      "execute_branch_sync_task",
      request,
    );
    await emitBranchTaskWorkflowSignals(
      result,
      lastBranchTaskHistoryEntryRef.current ?? undefined,
      {
        sourceActivityId: lastBranchActivityIdRef.current,
        sourceStepLabel: "合并分支",
      },
    );
  }

  async function handleExecuteCreate() {
    const result = await runBranchTask(
      "正在创建分支",
      "execute_branch_create_task",
      {
        projects: normalizeValues(createProjects),
        sourceBranch: createSource,
        targetBranch: createTarget,
      },
    );
    await emitBranchTaskWorkflowSignals(
      result,
      lastBranchTaskHistoryEntryRef.current ?? undefined,
      {
        sourceActivityId: lastBranchActivityIdRef.current,
        sourceStepLabel: "创建分支",
      },
    );
  }

  async function handleExecuteCheckout() {
    const result = await runBranchTask(
      "正在克隆分支",
      "checkout_branch_to_directory_task",
      {
        project: selectedProject,
        sourceBranch: checkoutSource,
        destinationDir: checkoutDestinationDir,
      },
    );
    await emitBranchTaskWorkflowSignals(
      result,
      lastBranchTaskHistoryEntryRef.current ?? undefined,
      {
        sourceActivityId: lastBranchActivityIdRef.current,
        sourceStepLabel: "克隆分支",
      },
    );
  }

  async function handleExecuteSwitch() {
    const repoPath = selectedWorktreePath.trim() || null;
    const result = await runBranchTask(
      "正在切换分支",
      "execute_branch_switch_task",
      {
        project: selectedProject,
        repoPath,
        targetBranch: switchTarget,
      },
      makeReplayRequest(
        "execute_branch_switch_task",
        "正在切换分支",
        {
          project: selectedProject,
          repoPath,
          targetBranch: switchTarget,
        },
        {
          refreshPushStatusProject: selectedProject,
        },
      ),
    );
    await loadProjectWorktrees(selectedProject);
    await loadPushStatus(selectedProject, repoPath || "");
    await emitBranchTaskWorkflowSignals(
      result,
      lastBranchTaskHistoryEntryRef.current ?? undefined,
      {
        sourceActivityId: lastBranchActivityIdRef.current,
        sourceStepLabel: "切换分支",
      },
    );
  }

  async function handleExecutePush() {
    const repoPath = selectedWorktreePath.trim() || null;
    const selectedPaths =
      pushAction === "commitAndPush" ? normalizeValues(pushSelectedPaths) : [];
    const request = {
      project: selectedProject,
      repoPath,
      commitBeforePush: pushAction === "commitAndPush",
      commitMessage:
        pushAction === "commitAndPush" ? pushCommitMessage.trim() : null,
      selectedPaths,
    };
    const result = await runBranchTask(
      pushAction === "commitAndPush" ? "正在提交并推送" : "正在推送当前分支",
      "execute_branch_push_task",
      request,
      makeReplayRequest(
        "execute_branch_push_task",
        pushAction === "commitAndPush" ? "正在提交并推送" : "正在推送当前分支",
        request,
        {
          refreshPushStatusProject: selectedProject,
          clearPushCommitMessageOnSuccess: pushAction === "commitAndPush",
        },
      ),
    );
    await loadProjectWorktrees(selectedProject);
    await loadPushStatus(selectedProject, repoPath || "");
    if (result?.success && pushAction === "commitAndPush") {
      setPushCommitMessage("");
      setPushSelectedPaths([]);
    }
    await emitBranchTaskWorkflowSignals(
      result,
      lastBranchTaskHistoryEntryRef.current ?? undefined,
      {
        sourceActivityId: lastBranchActivityIdRef.current,
        sourceStepLabel:
          pushAction === "commitAndPush" ? "提交并推送" : "推送分支",
      },
    );
  }

  async function handleOpenTaskOutput(path: string) {
    if (!path.trim()) {
      return;
    }
    setBusy("正在打开目录");
    setError("");
    try {
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  return {
    mode,
    setMode,
    projectOptions,
    syncProjects,
    setSyncProjects,
    syncSource,
    setSyncSource,
    syncTargets,
    setSyncTargets,
    createProjects,
    setCreateProjects,
    createSource,
    setCreateSource,
    createTarget,
    setCreateTarget,
    checkoutSource,
    setCheckoutSource,
    checkoutDestinationDir,
    setCheckoutDestinationDir,
    switchTarget,
    setSwitchTarget,
    pushAction,
    setPushAction,
    pushCommitMessage,
    setPushCommitMessage,
    pushSelectedPaths,
    setPushSelectedPaths,
    pushStatus,
    pushStatusLoading,
    pushStatusError,
    pushStatusUpdatedAtMs,
    worktrees: worktreeOptions,
    worktreesLoading,
    worktreesError,
    selectedWorktreePath,
    setSelectedWorktreePath: handleWorktreePathChange,
    currentBranchTaskHistoryId,
    currentBranchTask,
    visibleBranchTaskHistory,
    loadBranchTaskHistory,
    loadProjectWorktrees,
    loadPushStatus,
    handleClearBranchTaskHistory,
    handleChooseCheckoutDirectory,
    handleChooseWorktreeDirectory,
    handleRepairWorktree,
    handlePlanSync,
    handleExecuteSync,
    handleExecuteCreate,
    handleExecuteCheckout,
    handleExecuteSwitch,
    handleExecutePush,
    handleReplayBranchRequest,
    handleReplayBranchTaskHistory,
    handleOpenTaskOutput,
  };
}
