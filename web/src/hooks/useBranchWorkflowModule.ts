import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BranchPushAction,
  BranchPushStatus,
  BranchTaskHistoryEntry,
  BranchTaskReplayCommand,
  BranchTaskReplayRequest,
  BranchTaskResponse,
  BranchWorkflowMode,
  BranchWorktreeSummary,
} from "../app-types";
import type {
  ActivityResource,
  ActivityRecorder,
  ActivityUpdater,
} from "../lib/activityCenter";
import { stableActivityJson } from "../lib/activityCenter";
import { deleteStoredJson, getStoredJson, setStoredJson } from "../lib/storage";
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
  sourceBranchOptions: string[];
  targetBranchOptions: string[];
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  workflowBroadcastRules: WorkflowBroadcastRule[];
  emitWorkflowSignals: (signals: WorkflowSignal[]) => Promise<void>;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
};

type BranchTaskRunOptions = {
  force?: boolean;
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

export function branchWorkflowProjectReset(selectedProject: string) {
  return {
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
    clearPushCommitMessageOnSuccess: Boolean(candidate.clearPushCommitMessageOnSuccess),
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
    .map((item) => ({
      ...item,
      replay: normalizeReplay(item.replay),
    }))
    .slice(0, MAX_STORED_HISTORY_ITEMS);
}

function makeHistoryEntry(
  result: BranchTaskResponse,
  workspaceKey: string,
  replay?: BranchTaskReplayRequest | null,
): BranchTaskHistoryEntry {
  return {
    ...result,
    id: `${result.taskKind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    workspaceKey,
    replay: replay ? { ...replay, request: cloneReplayRequest(replay.request) } : null,
  };
}

function makeReplayRequest(
  command: BranchTaskReplayCommand,
  busyText: string,
  request: Record<string, unknown>,
  options: Omit<BranchTaskReplayRequest, "command" | "busyText" | "request"> = {},
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
  const project = requestProject(request);
  if (project) {
    return project;
  }
  return Array.isArray(request.projects) && typeof request.projects[0] === "string"
    ? request.projects[0]
    : "";
}

function worktreeFromPushStatus(status: BranchPushStatus): BranchWorktreeSummary {
  const name = status.repoPath.split(/[\\/]/).filter(Boolean).pop() || "自选目录";
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
    detail: status.upstreamBranch ? `upstream: ${status.upstreamBranch}` : "自选本地目录",
    latestCommit: status.latestCommit,
  };
}

function branchModeFromCommand(command: BranchTaskReplayCommand): BranchWorkflowMode {
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

function branchResultResource(result: BranchTaskResponse): ActivityResource | null {
  const outputPath = result.items.find((item) => item.outputPath)?.outputPath?.trim();
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
  const [branchTaskHistory, setBranchTaskHistory] = useState<BranchTaskHistoryEntry[]>([]);
  const [currentBranchTaskHistoryId, setCurrentBranchTaskHistoryId] = useState("");
  const [currentBranchTaskRunningLabel, setCurrentBranchTaskRunningLabel] = useState("");
  const lastBranchActivityIdRef = useRef("");
  const lastBranchTaskHistoryEntryRef = useRef<BranchTaskHistoryEntry | null>(null);
  const pushStatusLoadedProjectRef = useRef("");

  const worktreeOptions = useMemo(() => {
    const items = [...worktrees];
    const selectedPath = selectedWorktreePath.trim();
    if (
      selectedPath &&
      !items.some((item) => item.repoPath === selectedPath)
    ) {
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
      setCurrentBranchTaskRunningLabel("");
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
      return;
    }
    const reset = branchWorkflowProjectReset(selectedProject);
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
      const stored = await getStoredJson<unknown>(
        BRANCH_WORKFLOW_STORAGE_NAMESPACE,
        BRANCH_WORKFLOW_HISTORY_KEY,
      );
      setBranchTaskHistory(normalizeHistory(stored));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function persistHistory(
    result: BranchTaskResponse,
    replay?: BranchTaskReplayRequest | null,
    workspaceKey = activeProjectWorkspaceKey,
  ) {
    const entry = makeHistoryEntry(result, workspaceKey, replay);
    const stored = await getStoredJson<unknown>(
      BRANCH_WORKFLOW_STORAGE_NAMESPACE,
      BRANCH_WORKFLOW_HISTORY_KEY,
    );
    const allHistory = normalizeHistory(stored);
    const next = [entry, ...allHistory.filter((item) => item.id !== entry.id)].slice(
      0,
      MAX_STORED_HISTORY_ITEMS,
    );
    setBranchTaskHistory(next);
    await setStoredJson(
      BRANCH_WORKFLOW_STORAGE_NAMESPACE,
      BRANCH_WORKFLOW_HISTORY_KEY,
      next,
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
      if (remaining.length > 0) {
        await setStoredJson(
          BRANCH_WORKFLOW_STORAGE_NAMESPACE,
          BRANCH_WORKFLOW_HISTORY_KEY,
          remaining,
        );
      } else {
        await deleteStoredJson(BRANCH_WORKFLOW_STORAGE_NAMESPACE, BRANCH_WORKFLOW_HISTORY_KEY);
      }
      setBranchTaskHistory(remaining);
      setCurrentBranchTaskHistoryId("");
      setCurrentBranchTaskRunningLabel("");
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
      const result = await invoke<BranchWorktreeSummary[]>("list_project_worktrees", {
        project: projectKey,
      });
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
      const result = await invoke<BranchWorktreeSummary[]>("repair_project_worktree", {
        project: selectedProject,
        repoPath: normalizedRepoPath,
      });
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
    setCurrentBranchTaskRunningLabel(busyText);
    lastBranchTaskHistoryEntryRef.current = null;
    const taskKind = branchModeFromCommand(command);
    const requestedProject = requestFirstProject(request) || selectedProject;
    const requestedProjectName =
      projects.find((project) => project.key === requestedProject)?.name ||
      requestedProject;
    const activityId =
      recordActivity?.({
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
      }) || "";
    lastBranchActivityIdRef.current = activityId;
    try {
      const result = await invoke<BranchTaskResponse>(command, { request });
      const historyEntry = await persistHistory(
        result,
        replay,
        options.workspaceKey ?? activeProjectWorkspaceKey,
      );
      setCurrentBranchTaskHistoryId(historyEntry.id);
      setCurrentBranchTaskRunningLabel("");
      lastBranchTaskHistoryEntryRef.current = historyEntry;
      if (activityId) {
        const resultProjectKey = result.items[0]?.projectKey || requestedProject;
        const resultProjectName =
          result.items[0]?.projectName ||
          projects.find((project) => project.key === resultProjectKey)?.name ||
          resultProjectKey;
        updateActivity?.(activityId, {
          status: result.success ? "success" : "failed",
          summary: result.summary,
          detail: result.detail,
          chainId: options.chainId ?? undefined,
          parentId: options.parentId ?? undefined,
          stepLabel: options.stepLabel ?? branchActivityTitle(command),
          chainLabel: options.chainId ? "联动链路" : undefined,
          projectKey: resultProjectKey,
          projectName: resultProjectName,
          resource: branchResultResource(result),
          target: {
            page: "merge",
            projectKey: resultProjectKey,
            branchMode: result.taskKind,
          },
        });
      }
      return result;
    } catch (reason) {
      setCurrentBranchTaskRunningLabel("");
      lastBranchTaskHistoryEntryRef.current = null;
      if (activityId) {
        updateActivity?.(activityId, {
          status: "failed",
          summary: `${branchActivityTitle(command)}失败`,
          detail: String(reason),
        });
      }
      setError(String(reason));
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
        sourceStepLabel: options.stepLabel ?? branchActivityTitle(replay.command),
        chainId: options.chainId ?? undefined,
      },
    );
    return result !== null;
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
    if (!enabled || (mode !== "push" && mode !== "switch") || !selectedProject) {
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
        Date.now() - pushStatusUpdatedAtMs < PUSH_STATUS_AUTO_REFRESH_COOLDOWN_MS
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
        document.removeEventListener("visibilitychange", handleVisibilityChange);
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
      return next.length === current.length && next.every((path, index) => path === current[index])
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
    const sourceBranch = result.items.find((item) => item.sourceBranch)?.sourceBranch || "";
    const targetBranches = normalizeValues(
      result.items
        .map((item) => item.targetBranch || "")
        .filter(Boolean),
    );

    try {
      const nextChainId = chain?.chainId || (chain?.sourceActivityId ? `chain:${chain.sourceActivityId}` : "");
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

  async function handleExecuteSync() {
    const request = {
      project: selectedProject,
      sourceBranch: syncSource,
      targetBranches: normalizeValues(syncTargets),
    };
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
    const result = await runBranchTask("正在创建分支", "execute_branch_create_task", {
      projects: normalizeValues(createProjects),
      sourceBranch: createSource,
      targetBranch: createTarget,
    });
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
    const result = await runBranchTask("正在克隆分支", "checkout_branch_to_directory_task", {
      project: selectedProject,
      sourceBranch: checkoutSource,
      destinationDir: checkoutDestinationDir,
    });
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
        sourceStepLabel: pushAction === "commitAndPush" ? "提交并推送" : "推送分支",
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
    currentBranchTaskRunningLabel,
    visibleBranchTaskHistory,
    loadBranchTaskHistory,
    loadProjectWorktrees,
    loadPushStatus,
    handleClearBranchTaskHistory,
    handleChooseCheckoutDirectory,
    handleChooseWorktreeDirectory,
    handleRepairWorktree,
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
