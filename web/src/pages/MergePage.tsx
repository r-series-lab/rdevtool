import {
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import type {
  BranchOption,
  BranchPushAction,
  BranchPushStatus,
  BranchTaskHistoryEntry,
  BranchWorkflowMode,
  BranchWorktreeSummary,
  ProjectWorkspaceSummary,
} from "../app-types";
import {
  BranchModeTabs,
  branchWorkflowModeLabel,
} from "../components/branch/BranchModeTabs";
import { BranchHistoryPanel } from "../components/branch/BranchHistoryPanel";
import { BranchPushStatusCard } from "../components/branch/BranchPushStatusCard";
import { LocalWorkspaceStatusCard } from "../components/branch/LocalWorkspaceStatusCard";
import {
  WorkflowLinksDialog,
  type WorkflowLinkListItem,
} from "../components/WorkflowLinksDialog";
import { WorkflowRulesConfigDialog } from "../components/WorkflowRulesConfigDialog";
import { InlineWarningNotice } from "../components/InlineWarningNotice";
import {
  ClearIcon,
  FolderIcon,
  RefreshIcon,
} from "../components/AppIcons";
import { shouldHandlePrimaryEnter } from "../lib/keyboard";
import {
  defaultSignalIdForReplay,
  workflowReplayFromBranchHistory,
  type WorkflowBroadcastRule,
  type WorkflowReceiveRule,
} from "../lib/workflowSignals";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";

type ProjectOption = {
  key: string;
  name: string;
};

type LocalBranchOperation = "switch" | "clone";

export type MergePageProps = {
  projects: ProjectOption[];
  activeWorkspace: ProjectWorkspaceSummary | null;
  selectedProject: string;
  onProjectChange: (projectKey: string) => void;
  mode: BranchWorkflowMode;
  onModeChange: (mode: BranchWorkflowMode) => void;
  syncSource: string;
  onSyncSourceChange: (value: string) => void;
  onClearSyncSource: () => void;
  syncTargets: string[];
  onSyncTargetsChange: (values: string[]) => void;
  createProjects: string[];
  onCreateProjectsChange: (values: string[]) => void;
  createSource: string;
  onCreateSourceChange: (value: string) => void;
  onClearCreateSource: () => void;
  createTarget: string;
  onCreateTargetChange: (value: string) => void;
  onClearCreateTarget: () => void;
  checkoutSource: string;
  onCheckoutSourceChange: (value: string) => void;
  onClearCheckoutSource: () => void;
  checkoutDestinationDir: string;
  onCheckoutDestinationChange: (value: string) => void;
  onClearCheckoutDestination: () => void;
  onChooseCheckoutDirectory: () => void;
  switchTarget: string;
  onSwitchTargetChange: (value: string) => void;
  onClearSwitchTarget: () => void;
  pushAction: BranchPushAction;
  onPushActionChange: (value: BranchPushAction) => void;
  pushCommitMessage: string;
  onPushCommitMessageChange: (value: string) => void;
  pushStatus: BranchPushStatus | null;
  pushStatusLoading: boolean;
  pushStatusError: string;
  pushStatusUpdatedAtMs: number;
  worktrees: BranchWorktreeSummary[];
  worktreesLoading: boolean;
  worktreesError: string;
  selectedWorktreePath: string;
  onWorktreePathChange: (value: string) => void;
  onChooseWorktreeDirectory: () => void;
  onRefreshWorktrees: () => void;
  onRefreshPushStatus: () => void;
  onSyncBranches: () => void;
  sourceBranchEntries: BranchOption[];
  targetBranchEntries: BranchOption[];
  sourceBranchOptions: string[];
  targetBranchOptions: string[];
  busy: string;
  currentBranchTaskHistoryId: string;
  currentBranchTaskRunningLabel: string;
  branchTaskHistory: BranchTaskHistoryEntry[];
  onExecuteSync: () => void;
  onExecuteCreate: () => void;
  onExecuteCheckout: () => void;
  onExecuteSwitch: () => void;
  onExecutePush: () => void;
  onReplayBranchTaskHistory: (entry: BranchTaskHistoryEntry) => void;
  workflowReceiveRules: WorkflowReceiveRule[];
  workflowBroadcastRules: WorkflowBroadcastRule[];
  workflowReceiveSignalIdsForBranchReplay: (entry: BranchTaskHistoryEntry) => string[];
  workflowBroadcastSignalIdsForBranchReplay: (entry: BranchTaskHistoryEntry) => string[];
  workflowSignalOptions: string[];
  workflowSignalSummaries: WorkflowSignalSummary[];
  onWorkflowBranchReplayRulesChange: (
    entry: BranchTaskHistoryEntry,
    value: {
      receiveSignalIds: string[];
      broadcastSignalIds: string[];
    },
  ) => void;
  onWorkflowReceiveRulesEnabledChange: (ruleIds: string[], enabled: boolean) => void;
  onWorkflowReceiveRulesDelete: (ruleIds: string[]) => void;
  onWorkflowBroadcastRulesEnabledChange: (ruleIds: string[], enabled: boolean) => void;
  onWorkflowBroadcastRulesDelete: (ruleIds: string[]) => void;
  onWorkflowSignalDelete: (signalId: string) => void;
  onWorkflowSignalsClear: () => void;
  onRefreshBranchTaskHistory: () => void;
  onClearBranchTaskHistory: () => void;
  onOpenTaskOutput: (path: string) => void;
  formatRelativeTime: (value?: string) => string;
};

const PUSH_STATUS_STALE_MS = 60_000;
const PUSH_STATUS_CLOCK_INTERVAL_MS = 15_000;

function formatBranchUpdatedAt(item?: BranchOption) {
  if (!item?.updatedAt) {
    return "未知";
  }
  return item.updatedAt;
}

function normalizeBranchValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function missingBranchValues(values: string[], options: string[]) {
  if (options.length === 0) {
    return [];
  }
  const optionSet = new Set(options);
  return normalizeBranchValues(values).filter((value) => !optionSet.has(value));
}

function groupWorkflowBroadcastRules(
  rules: WorkflowBroadcastRule[],
): WorkflowLinkListItem[] {
  const groups = new Map<string, WorkflowLinkListItem & { enabledCount: number }>();

  for (const rule of rules) {
    const groupKey = rule.replayKey || rule.id;
    const branchReplay = rule.replay?.target === "branch.replay" ? rule.replay : null;
    const current = groups.get(groupKey) ?? {
      key: groupKey,
      title: rule.label || branchReplay?.entry.summary || rule.signalId,
      kind: "Broadcast",
      ruleKind: "broadcast",
      signalIds: [] as string[],
      enabled: false,
      enabledCount: 0,
      ruleIds: [] as string[],
    };
    current.ruleIds.push(rule.id);
    current.signalIds.push(rule.signalId);
    if (rule.enabled) {
      current.enabledCount += 1;
    }
    current.enabled = current.enabledCount === current.ruleIds.length;
    groups.set(groupKey, current);
  }

  return Array.from(groups.values()).map(({ enabledCount: _, ...item }) => ({
    ...item,
    signalIds: Array.from(new Set(item.signalIds)),
  }));
}

function groupWorkflowReceiveRules(
  rules: WorkflowReceiveRule[],
): WorkflowLinkListItem[] {
  const groups = new Map<string, WorkflowLinkListItem & { enabledCount: number }>();

  for (const rule of rules) {
    const groupKey = rule.replayKey || rule.id;
    const branchReplay = rule.replay.target === "branch.replay" ? rule.replay : null;
    const current = groups.get(groupKey) ?? {
      key: groupKey,
      title: rule.label || branchReplay?.entry.summary || rule.signalId,
      kind: "Receive",
      ruleKind: "receive",
      signalIds: [] as string[],
      enabled: false,
      enabledCount: 0,
      ruleIds: [] as string[],
    };
    current.ruleIds.push(rule.id);
    current.signalIds.push(rule.signalId);
    if (rule.enabled) {
      current.enabledCount += 1;
    }
    current.enabled = current.enabledCount === current.ruleIds.length;
    groups.set(groupKey, current);
  }

  return Array.from(groups.values()).map(({ enabledCount: _, ...item }) => ({
    ...item,
    signalIds: Array.from(new Set(item.signalIds)),
  }));
}

function BranchValueWarning({
  label,
  values,
  options,
  onReset,
}: {
  label: string;
  values: string[];
  options: string[];
  onReset: () => void;
}) {
  const missing = missingBranchValues(values, options);
  if (missing.length === 0) {
    return null;
  }

  return (
    <InlineWarningNotice
      title={`${label} 不在当前项目分支列表中`}
      details={missing}
      onAction={onReset}
    />
  );
}

function PushStatusFreshness({
  updatedAtMs,
  nowMs,
  loading,
  onRefresh,
}: {
  updatedAtMs: number;
  nowMs: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  const stale = Boolean(updatedAtMs && nowMs - updatedAtMs > PUSH_STATUS_STALE_MS);
  if (!stale) {
    return null;
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="baseline" flexWrap="wrap" rowGap={0.2}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontSize: "0.7rem", lineHeight: 1.4 }}
      >
        本地状态可能已过期
      </Typography>
      {stale ? (
        <Button
          size="small"
          variant="text"
          onClick={onRefresh}
          disabled={loading}
          sx={{
            minWidth: 0,
            minHeight: 20,
            px: 0.25,
            py: 0,
            fontSize: "0.7rem",
            fontWeight: 760,
            lineHeight: 1.2,
          }}
        >
          刷新
        </Button>
      ) : null}
    </Stack>
  );
}

function worktreeBranchLabel(item: BranchWorktreeSummary) {
  if (item.detached) {
    return "detached";
  }
  return item.currentBranch || "HEAD";
}

function joinWorkspacePath(rootDir: string, projectKey: string) {
  const normalizedRoot = rootDir.trim().replace(/[\\/]+$/, "");
  const normalizedProject = projectKey.trim();
  return normalizedRoot && normalizedProject ? `${normalizedRoot}/${normalizedProject}` : "";
}

function WorktreeSelector({
  items,
  value,
  loading,
  error,
  disabled,
  onChange,
  onChooseDirectory,
  onRefresh,
}: {
  items: BranchWorktreeSummary[];
  value: string;
  loading: boolean;
  error: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onChooseDirectory: () => void;
  onRefresh: () => void;
}) {
  const selected = items.find((item) => item.repoPath === value) ?? null;
  const helperText =
    error ||
    selected?.detail ||
    selected?.repoPath ||
    (loading ? "正在读取项目实例" : "选择项目实例或本地目录后再操作");

  return (
    <Stack spacing={0.45}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto auto",
          gap: 0.45,
          alignItems: "stretch",
        }}
      >
        <FormControl fullWidth disabled={disabled}>
          <InputLabel>项目实例</InputLabel>
          <Select
            value={value}
            label="项目实例"
            displayEmpty
            onChange={(event: SelectChangeEvent<string>) => onChange(event.target.value)}
            renderValue={(selectedValue) => {
              const item = items.find((entry) => entry.repoPath === selectedValue);
              if (!item) {
                return loading ? "正在读取项目实例" : "选择项目实例";
              }
              return `${item.label} · ${worktreeBranchLabel(item)}`;
            }}
          >
            {items.map((item) => (
              <MenuItem key={item.repoPath} value={item.repoPath}>
                <Box sx={{ minWidth: 0, width: "100%" }}>
                  <Stack direction="row" spacing={0.55} alignItems="center" minWidth={0}>
                    <Typography variant="body2" fontWeight={820} noWrap>
                      {item.label}
                    </Typography>
                    {item.isWorkspaceInstance ? (
                      <Chip size="small" label="工作区" color="primary" variant="outlined" />
                    ) : null}
                    {item.managed ? <Chip size="small" label="托管" variant="outlined" /> : null}
                    {item.isDefault ? <Chip size="small" label="默认" variant="outlined" /> : null}
                    {item.isGitWorktree ? <Chip size="small" label="worktree" variant="outlined" /> : null}
                    <Chip
                      size="small"
                      label={item.statusLabel}
                      color={item.statusKey === "clean" ? "success" : item.statusKey === "unavailable" ? "error" : "primary"}
                      variant={item.statusKey === "clean" ? "outlined" : "filled"}
                    />
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: "block", mt: 0.1 }}
                  >
                    {worktreeBranchLabel(item)} · {item.repoPath}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <IconButton
          onClick={onRefresh}
          disabled={disabled || loading}
          aria-label="刷新项目实例"
          title="刷新项目实例"
          sx={{ alignSelf: "center" }}
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton
          onClick={onChooseDirectory}
          disabled={disabled}
          aria-label="选择本地目录"
          title="选择本地目录"
          sx={{ alignSelf: "center" }}
        >
          <FolderIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography
        variant="caption"
        color={error ? "error" : "text.secondary"}
        sx={{ display: "block", minHeight: 16, overflowWrap: "anywhere", lineHeight: 1.35 }}
      >
        {helperText}
      </Typography>
    </Stack>
  );
}

function BranchInput({
  label,
  value,
  options,
  branchEntryMap,
  onChange,
  onClear,
  onSyncBranches,
  disabled,
}: {
  label: string;
  value: string;
  options: string[];
  branchEntryMap: Map<string, BranchOption>;
  onChange: (value: string) => void;
  onClear: () => void;
  onSyncBranches: () => void;
  disabled: boolean;
}) {
  return (
    <Autocomplete<string, false, false, true>
      freeSolo
      fullWidth
      forcePopupIcon={false}
      options={options}
      value={value}
      inputValue={value}
      onChange={(_, nextValue) => onChange(typeof nextValue === "string" ? nextValue : nextValue ?? "")}
      onInputChange={(_, nextValue, reason) => {
        if (reason === "reset" && nextValue === value) {
          return;
        }
        onChange(nextValue);
      }}
      autoHighlight
      selectOnFocus
      clearOnBlur={false}
      handleHomeEndKeys
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
        const item = branchEntryMap.get(option);
        return (
          <Box component="li" key={key} {...optionProps} sx={{ px: 1.2, py: 0.7 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={1}
              width="100%"
              minWidth={0}
            >
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
                {option}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {formatBranchUpdatedAt(item)}
              </Typography>
            </Stack>
          </Box>
        );
      }}
      renderInput={(params) => {
        const { ref: inputRef, ...inputProps } = params.inputProps;

        return (
          <Box sx={{ position: "relative" }}>
            <TextField
              {...params}
              inputRef={inputRef}
              inputProps={inputProps}
              label={label}
              sx={{
                "& .MuiOutlinedInput-root": {
                  pr: value.trim() ? 9.5 : 5.75,
                },
                "& .MuiOutlinedInput-input": {
                  pr: 0.5,
                },
              }}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <InputAdornment
                    position="end"
                    sx={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      m: 0,
                    }}
                  >
                    <Stack direction="row" spacing={0.35} alignItems="center">
                      {value.trim() ? (
                        <IconButton
                          size="small"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onClear();
                          }}
                          disabled={disabled}
                          edge="end"
                          aria-label={`清空${label}`}
                          title={`清空${label}`}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                      <IconButton
                        size="small"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSyncBranches();
                        }}
                        disabled={disabled}
                        edge="end"
                        aria-label="同步分支"
                        title="同步分支"
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        );
      }}
    />
  );
}

export function MergePage({
  projects,
  activeWorkspace,
  selectedProject,
  onProjectChange,
  mode,
  onModeChange,
  syncSource,
  onSyncSourceChange,
  onClearSyncSource,
  syncTargets,
  onSyncTargetsChange,
  createProjects,
  onCreateProjectsChange,
  createSource,
  onCreateSourceChange,
  onClearCreateSource,
  createTarget,
  onCreateTargetChange,
  onClearCreateTarget,
  checkoutSource,
  onCheckoutSourceChange,
  onClearCheckoutSource,
  checkoutDestinationDir,
  onCheckoutDestinationChange,
  onClearCheckoutDestination,
  onChooseCheckoutDirectory,
  switchTarget,
  onSwitchTargetChange,
  onClearSwitchTarget,
  pushAction,
  onPushActionChange,
  pushCommitMessage,
  onPushCommitMessageChange,
  pushStatus,
  pushStatusLoading,
  pushStatusError,
  pushStatusUpdatedAtMs,
  worktrees,
  worktreesLoading,
  worktreesError,
  selectedWorktreePath,
  onWorktreePathChange,
  onChooseWorktreeDirectory,
  onRefreshWorktrees,
  onRefreshPushStatus,
  onSyncBranches,
  sourceBranchEntries,
  targetBranchEntries,
  sourceBranchOptions,
  targetBranchOptions,
  busy,
  currentBranchTaskHistoryId,
  currentBranchTaskRunningLabel,
  branchTaskHistory,
  onExecuteSync,
  onExecuteCreate,
  onExecuteCheckout,
  onExecuteSwitch,
  onExecutePush,
  onReplayBranchTaskHistory,
  workflowReceiveRules,
  workflowBroadcastRules,
  workflowReceiveSignalIdsForBranchReplay,
  workflowBroadcastSignalIdsForBranchReplay,
  workflowSignalOptions,
  workflowSignalSummaries,
  onWorkflowBranchReplayRulesChange,
  onWorkflowReceiveRulesEnabledChange,
  onWorkflowReceiveRulesDelete,
  onWorkflowBroadcastRulesEnabledChange,
  onWorkflowBroadcastRulesDelete,
  onWorkflowSignalDelete,
  onWorkflowSignalsClear,
  onRefreshBranchTaskHistory,
  onClearBranchTaskHistory,
  onOpenTaskOutput,
  formatRelativeTime,
}: MergePageProps) {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowEntry, setWorkflowEntry] = useState<BranchTaskHistoryEntry | null>(null);
  const [pushFilesExpanded, setPushFilesExpanded] = useState(false);
  const [switchFilesExpanded, setSwitchFilesExpanded] = useState(false);
  const [localOperation, setLocalOperation] = useState<LocalBranchOperation>("switch");
  const [nowMs, setNowMs] = useState(Date.now());
  const sourceBranchEntryMap = useMemo(
    () => new Map(sourceBranchEntries.map((item) => [item.name, item])),
    [sourceBranchEntries],
  );
  const targetBranchEntryMap = useMemo(
    () => new Map(targetBranchEntries.map((item) => [item.name, item])),
    [targetBranchEntries],
  );
  const selectedCreateProjectOptions = useMemo(
    () => projects.filter((project) => createProjects.includes(project.key)),
    [createProjects, projects],
  );
  const defaultSourceBranch = sourceBranchOptions[0] || "";
  const defaultSyncTargetBranch =
    targetBranchOptions.find((item) => item !== syncSource) ||
    targetBranchOptions[0] ||
    "";
  const defaultTargetBranch = targetBranchOptions[0] || "";
  const pushStatusStale = Boolean(
    pushStatusUpdatedAtMs && nowMs - pushStatusUpdatedAtMs > PUSH_STATUS_STALE_MS,
  );
  const syncReady =
    Boolean(selectedProject) &&
    Boolean(syncSource.trim()) &&
    normalizeBranchValues(syncTargets).length > 0;
  const createReady =
    createProjects.length > 0 &&
    Boolean(createSource.trim()) &&
    Boolean(createTarget.trim()) &&
    createSource.trim() !== createTarget.trim();
  const checkoutReady =
    Boolean(selectedProject) &&
    Boolean(checkoutSource.trim()) &&
    Boolean(checkoutDestinationDir.trim());
  const workspaceInstancePath = useMemo(
    () =>
      activeWorkspace?.rootDir
        ? joinWorkspacePath(activeWorkspace.rootDir, selectedProject)
        : "",
    [activeWorkspace?.rootDir, selectedProject],
  );
  const normalizedSwitchTarget = switchTarget.trim();
  const switchSameAsCurrent = Boolean(
    pushStatus &&
      !pushStatus.detached &&
      normalizedSwitchTarget &&
      pushStatus.currentBranch === normalizedSwitchTarget,
  );
  const switchBlockedByStatus = Boolean(pushStatus && !pushStatus.clean);
  const hasSelectedWorktree = Boolean(selectedWorktreePath.trim());
  const switchReady =
    Boolean(selectedProject) &&
    hasSelectedWorktree &&
    Boolean(normalizedSwitchTarget) &&
    Boolean(pushStatus) &&
    !switchSameAsCurrent &&
    !switchBlockedByStatus;
  const pushReady =
    Boolean(selectedProject) &&
    hasSelectedWorktree &&
    Boolean(pushStatus) &&
    Boolean(pushStatus?.canPush) &&
    (pushAction === "pushOnly" || Boolean(pushCommitMessage.trim()));
  const switchStatusHelper = pushStatusError
    || (pushStatusLoading
      ? "正在读取本地仓库状态"
      : pushStatus
        ? switchSameAsCurrent
          ? "当前已在目标分支"
          : switchBlockedByStatus
            ? "工作副本有未提交或未跟踪文件，处理后再切换"
            : pushStatusStale
              ? "本地状态可能已过期，建议刷新后再操作"
              : pushStatus.repoPath
          : hasSelectedWorktree
            ? "读取本地仓库状态后可切换分支"
          : "先选择项目实例");
  const workflowBroadcastGroups = useMemo(
    () => groupWorkflowBroadcastRules(workflowBroadcastRules),
    [workflowBroadcastRules],
  );
  const workflowReceiveGroups = useMemo(
    () => groupWorkflowReceiveRules(workflowReceiveRules),
    [workflowReceiveRules],
  );
  const workflowGroups = useMemo(
    () => [...workflowReceiveGroups, ...workflowBroadcastGroups],
    [workflowBroadcastGroups, workflowReceiveGroups],
  );
  const actionDisabled = Boolean(busy) || (
    mode === "sync"
      ? !syncReady
      : mode === "create"
        ? !createReady
        : mode === "checkout"
          ? !checkoutReady
          : mode === "switch"
            ? localOperation === "clone"
              ? !checkoutReady
              : !switchReady
            : !pushReady
  );
  useEffect(() => {
    setPushFilesExpanded(false);
    setSwitchFilesExpanded(false);
  }, [mode, selectedProject]);

  useEffect(() => {
    if (
      mode !== "switch" ||
      localOperation !== "clone" ||
      !workspaceInstancePath ||
      checkoutDestinationDir.trim()
    ) {
      return;
    }
    onCheckoutDestinationChange(workspaceInstancePath);
  }, [
    checkoutDestinationDir,
    localOperation,
    mode,
    onCheckoutDestinationChange,
    workspaceInstancePath,
  ]);

  useEffect(() => {
    if (!pushStatusUpdatedAtMs) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, PUSH_STATUS_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pushStatusUpdatedAtMs]);

  function handlePrimaryEnter(event: KeyboardEvent<HTMLElement>) {
    if (!shouldHandlePrimaryEnter(event) || actionDisabled) {
      return;
    }
    event.preventDefault();
    if (mode === "sync") {
      onExecuteSync();
    } else if (mode === "create") {
      onExecuteCreate();
    } else if (mode === "checkout") {
      onExecuteCheckout();
    } else if (mode === "switch") {
      if (localOperation === "clone") {
        onExecuteCheckout();
      } else {
        onExecuteSwitch();
      }
    } else {
      onExecutePush();
    }
  }

  function openWorkflowDialog(entry: BranchTaskHistoryEntry) {
    setWorkflowEntry(entry);
    setWorkflowOpen(true);
  }

  const workflowReplay = workflowEntry ? workflowReplayFromBranchHistory(workflowEntry) : null;

  return (
    <Box className="workspace workspace--workflow" onKeyDown={handlePrimaryEnter}>
      <Box className="workflow-module workflow-module--control">
        <Stack spacing={0.85}>
          <BranchModeTabs mode={mode} onModeChange={onModeChange} />

            {mode === "sync" ? (
              <Stack spacing={0.85}>
                <FormControl fullWidth>
                  <InputLabel>项目</InputLabel>
                  <Select
                    value={selectedProject}
                    label="项目"
                    onChange={(event: SelectChangeEvent<string>) => onProjectChange(event.target.value)}
                  >
                    {projects.map((project) => (
                      <MenuItem key={project.key} value={project.key}>
                        {project.name} ({project.key})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <BranchInput
                  label="源分支"
                  value={syncSource}
                  options={sourceBranchOptions}
                  branchEntryMap={sourceBranchEntryMap}
                  onChange={onSyncSourceChange}
                  onClear={onClearSyncSource}
                  onSyncBranches={onSyncBranches}
                  disabled={!selectedProject || Boolean(busy)}
                />
                <BranchValueWarning
                  label="源分支"
                  values={[syncSource]}
                  options={sourceBranchOptions}
                  onReset={() => onSyncSourceChange(defaultSourceBranch)}
                />
                <Autocomplete<string, true, true, true>
                  multiple
                  freeSolo
                  fullWidth
                  disableClearable
                  options={targetBranchOptions}
                  value={syncTargets}
                  onChange={(_, values) => onSyncTargetsChange(normalizeBranchValues(values))}
                  renderInput={(params) => {
                    const { ref: inputRef, ...inputProps } = params.inputProps;

                    return (
                      <TextField
                        {...params}
                        inputRef={inputRef}
                        inputProps={inputProps}
                        label="目标分支"
                        helperText="合并模式不会自动创建缺失目标分支"
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            pr: 9.5,
                          },
                          "& .MuiAutocomplete-endAdornment": {
                            position: "static",
                            transform: "none",
                            mr: 0,
                          },
                        }}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <InputAdornment
                              position="end"
                              sx={{
                                position: "absolute",
                                right: 8,
                                top: "50%",
                                transform: "translateY(-50%)",
                                m: 0,
                              }}
                            >
                              <Stack direction="row" spacing={0.35} alignItems="center">
                                {syncTargets.length > 0 ? (
                                  <IconButton
                                    size="small"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSyncTargetsChange([]);
                                    }}
                                    disabled={Boolean(busy)}
                                    edge="end"
                                    aria-label="清空目标分支"
                                    title="清空目标分支"
                                  >
                                    <ClearIcon fontSize="small" />
                                  </IconButton>
                                ) : null}
                                <IconButton
                                  size="small"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSyncBranches();
                                  }}
                                  disabled={!selectedProject || Boolean(busy)}
                                  edge="end"
                                  aria-label="同步分支"
                                  title="同步分支"
                                >
                                  <RefreshIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            </InputAdornment>
                          ),
                        }}
                      />
                    );
                  }}
                  renderOption={(props, option) => {
                    const { key, ...optionProps } = props;
                    const item = targetBranchEntryMap.get(option);
                    return (
                      <Box component="li" key={key} {...optionProps}>
                        <Stack direction="row" justifyContent="space-between" spacing={1} width="100%" minWidth={0}>
                          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
                            {option}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {formatBranchUpdatedAt(item)}
                          </Typography>
                        </Stack>
                      </Box>
                    );
                  }}
                />
                <BranchValueWarning
                  label="目标分支"
                  values={syncTargets}
                  options={targetBranchOptions}
                  onReset={() =>
                    onSyncTargetsChange(defaultSyncTargetBranch ? [defaultSyncTargetBranch] : [])
                  }
                />
                <Button
                  variant="contained"
                  onClick={onExecuteSync}
                  disabled={actionDisabled}
                  sx={{ minHeight: 34, borderRadius: "11px" }}
                >
                  执行合并
                </Button>
              </Stack>
            ) : null}

            {mode === "create" ? (
              <Stack spacing={0.85}>
                <Autocomplete<ProjectOption, true, false, false>
                  multiple
                  fullWidth
                  disableCloseOnSelect
                  options={projects}
                  value={selectedCreateProjectOptions}
                  getOptionLabel={(option) => `${option.name} (${option.key})`}
                  isOptionEqualToValue={(option, value) => option.key === value.key}
                  onChange={(_, values) => onCreateProjectsChange(values.map((item) => item.key))}
                  renderInput={(params) => {
                    const { ref: inputRef, ...inputProps } = params.inputProps;

                    return <TextField {...params} inputRef={inputRef} inputProps={inputProps} label="项目" />;
                  }}
                />
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr)",
                    gap: 0.7,
                  }}
                >
                  <BranchInput
                    label="源分支"
                    value={createSource}
                    options={sourceBranchOptions}
                    branchEntryMap={sourceBranchEntryMap}
                    onChange={onCreateSourceChange}
                    onClear={onClearCreateSource}
                    onSyncBranches={onSyncBranches}
                    disabled={!selectedProject || Boolean(busy)}
                  />
                  <BranchInput
                    label="目标分支"
                    value={createTarget}
                    options={targetBranchOptions}
                    branchEntryMap={targetBranchEntryMap}
                    onChange={onCreateTargetChange}
                    onClear={onClearCreateTarget}
                    onSyncBranches={onSyncBranches}
                    disabled={!selectedProject || Boolean(busy)}
                  />
                </Box>
                <BranchValueWarning
                  label="源分支"
                  values={[createSource]}
                  options={sourceBranchOptions}
                  onReset={() => onCreateSourceChange(defaultSourceBranch)}
                />
                <Button
                  variant="contained"
                  onClick={onExecuteCreate}
                  disabled={actionDisabled}
                  sx={{ minHeight: 34, borderRadius: "11px" }}
                >
                  批量创建
                </Button>
              </Stack>
            ) : null}

            {mode === "switch" ? (
              <Stack spacing={0.85}>
                <FormControl fullWidth>
                  <InputLabel>项目</InputLabel>
                  <Select
                    value={selectedProject}
                    label="项目"
                    onChange={(event: SelectChangeEvent<string>) => onProjectChange(event.target.value)}
                  >
                    {projects.map((project) => (
                      <MenuItem key={project.key} value={project.key}>
                        {project.name} ({project.key})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: { xs: 0.24, sm: 0.35 },
                    p: { xs: 0.2, sm: 0.28 },
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: "11px",
                    bgcolor: "rgba(255,255,255,0.01)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.014)",
                  }}
                >
                  {[
                    { key: "switch", label: "切换分支" },
                    { key: "clone", label: "创建副本" },
                  ].map((item) => (
                    <Button
                      key={item.key}
                      variant={localOperation === item.key ? "contained" : "text"}
                      color={localOperation === item.key ? "primary" : "inherit"}
                      onClick={() => setLocalOperation(item.key as LocalBranchOperation)}
                      sx={{
                        minWidth: 0,
                        minHeight: { xs: 27, sm: 29 },
                        borderRadius: { xs: "8px", sm: "8px" },
                        px: { xs: 0.32, sm: 1 },
                        py: 0,
                        fontSize: { xs: "0.72rem", sm: "0.8rem" },
                        lineHeight: 1.1,
                        whiteSpace: "normal",
                        textAlign: "center",
                        color: localOperation === item.key ? undefined : "text.secondary",
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                </Box>

                {localOperation === "switch" ? (
                  <>
                    <WorktreeSelector
                      items={worktrees}
                      value={selectedWorktreePath}
                      loading={worktreesLoading || pushStatusLoading}
                      error={worktreesError || pushStatusError}
                      disabled={!selectedProject || Boolean(busy)}
                      onChange={onWorktreePathChange}
                      onChooseDirectory={onChooseWorktreeDirectory}
                      onRefresh={() => {
                        onRefreshWorktrees();
                        onRefreshPushStatus();
                      }}
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: -0.2, overflowWrap: "anywhere", lineHeight: 1.35 }}
                    >
                      {switchStatusHelper}
                    </Typography>
                    <PushStatusFreshness
                      updatedAtMs={pushStatusUpdatedAtMs}
                      nowMs={nowMs}
                      loading={pushStatusLoading}
                      onRefresh={onRefreshPushStatus}
                    />

                    <BranchInput
                      label="目标分支"
                      value={switchTarget}
                      options={targetBranchOptions}
                      branchEntryMap={targetBranchEntryMap}
                      onChange={onSwitchTargetChange}
                      onClear={onClearSwitchTarget}
                      onSyncBranches={onSyncBranches}
                      disabled={!selectedProject || Boolean(busy)}
                    />
                    <BranchValueWarning
                      label="目标分支"
                      values={[switchTarget]}
                      options={targetBranchOptions}
                      onReset={() => onSwitchTargetChange(defaultTargetBranch)}
                    />

                    {pushStatus ? (
                      <LocalWorkspaceStatusCard
                        status={pushStatus}
                        blocked={switchBlockedByStatus}
                        filesExpanded={switchFilesExpanded}
                        onToggleFilesExpanded={() =>
                          setSwitchFilesExpanded((current) => !current)
                        }
                        onOpenPushMode={() => onModeChange("push")}
                      />
                    ) : null}

                    <Button
                      variant="contained"
                      onClick={onExecuteSwitch}
                      disabled={actionDisabled}
                      sx={{ minHeight: 34, borderRadius: "11px" }}
                    >
                      切换到目标分支
                    </Button>
                  </>
                ) : null}

                {localOperation === "clone" ? (
                  <>
                    <BranchInput
                      label="源分支"
                      value={checkoutSource}
                      options={sourceBranchOptions}
                      branchEntryMap={sourceBranchEntryMap}
                      onChange={onCheckoutSourceChange}
                      onClear={onClearCheckoutSource}
                      onSyncBranches={onSyncBranches}
                      disabled={!selectedProject || Boolean(busy)}
                    />
                    <BranchValueWarning
                      label="源分支"
                      values={[checkoutSource]}
                      options={sourceBranchOptions}
                      onReset={() => onCheckoutSourceChange(defaultSourceBranch)}
                    />
                    <TextField
                      label="目标目录"
                      value={checkoutDestinationDir}
                      placeholder={workspaceInstancePath || "选择一个目录"}
                      onChange={(event) => onCheckoutDestinationChange(event.target.value)}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <Stack direction="row" spacing={0.2}>
                              {checkoutDestinationDir ? (
                                <IconButton
                                  size="small"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={onClearCheckoutDestination}
                                  edge="end"
                                  aria-label="清空目标目录"
                                  title="清空目标目录"
                                >
                                  <ClearIcon fontSize="small" />
                                </IconButton>
                              ) : null}
                              <IconButton
                                size="small"
                                onClick={onChooseCheckoutDirectory}
                                edge="end"
                                aria-label="选择目标目录"
                                title="选择目标目录"
                              >
                                <FolderIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          </InputAdornment>
                        ),
                      }}
                    />
                    <Button
                      variant="contained"
                      onClick={onExecuteCheckout}
                      disabled={actionDisabled}
                      sx={{ minHeight: 34, borderRadius: "11px" }}
                    >
                      创建工作区副本
                    </Button>
                  </>
                ) : null}
              </Stack>
            ) : null}

            {mode === "push" ? (
              <Stack spacing={0.85}>
                <FormControl fullWidth>
                  <InputLabel>项目</InputLabel>
                  <Select
                    value={selectedProject}
                    label="项目"
                    onChange={(event: SelectChangeEvent<string>) => onProjectChange(event.target.value)}
                  >
                    {projects.map((project) => (
                      <MenuItem key={project.key} value={project.key}>
                        {project.name} ({project.key})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <WorktreeSelector
                  items={worktrees}
                  value={selectedWorktreePath}
                  loading={worktreesLoading || pushStatusLoading}
                  error={worktreesError || pushStatusError}
                  disabled={!selectedProject || Boolean(busy)}
                  onChange={onWorktreePathChange}
                  onChooseDirectory={onChooseWorktreeDirectory}
                  onRefresh={() => {
                    onRefreshWorktrees();
                    onRefreshPushStatus();
                  }}
                />
                <PushStatusFreshness
                  updatedAtMs={pushStatusUpdatedAtMs}
                  nowMs={nowMs}
                  loading={pushStatusLoading}
                  onRefresh={onRefreshPushStatus}
                />

                {pushStatus ? (
                  <BranchPushStatusCard
                    status={pushStatus}
                    filesExpanded={pushFilesExpanded}
                    onToggleFilesExpanded={() =>
                      setPushFilesExpanded((current) => !current)
                    }
                  />
                ) : null}

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: { xs: 0.24, sm: 0.35 },
                    p: { xs: 0.2, sm: 0.28 },
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: "11px",
                    bgcolor: "rgba(255,255,255,0.01)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.014)",
                  }}
                >
                  {[
                    { key: "pushOnly", label: "仅推送" },
                    { key: "commitAndPush", label: "提交并推送" },
                  ].map((item) => (
                    <Button
                      key={item.key}
                      variant={pushAction === item.key ? "contained" : "text"}
                      color={pushAction === item.key ? "primary" : "inherit"}
                      onClick={() => onPushActionChange(item.key as BranchPushAction)}
                      sx={{
                        minWidth: 0,
                        minHeight: { xs: 27, sm: 29 },
                        borderRadius: { xs: "8px", sm: "8px" },
                        px: { xs: 0.32, sm: 1 },
                        py: 0,
                        fontSize: { xs: "0.72rem", sm: "0.8rem" },
                        lineHeight: 1.1,
                        whiteSpace: "normal",
                        textAlign: "center",
                        color: pushAction === item.key ? undefined : "text.secondary",
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                </Box>

                {pushAction === "commitAndPush" ? (
                  <TextField
                    fullWidth
                    label="提交说明"
                    value={pushCommitMessage}
                    onChange={(event) => onPushCommitMessageChange(event.target.value)}
                    placeholder="输入本次提交说明"
                  />
                ) : null}

                <Button
                  variant="contained"
                  onClick={onExecutePush}
                  disabled={actionDisabled}
                  sx={{ minHeight: 34, borderRadius: "11px" }}
                >
                  执行推送
                </Button>
              </Stack>
            ) : null}
        </Stack>
      </Box>

      <BranchHistoryPanel
        expanded={historyExpanded}
        history={branchTaskHistory}
        currentHistoryId={currentBranchTaskHistoryId}
        currentTaskLabel={currentBranchTaskRunningLabel}
        busy={busy}
        workflowGroupCount={workflowGroups.length}
        workflowSignalIdsForBranchReplay={(entry) => [
          ...workflowReceiveSignalIdsForBranchReplay(entry),
          ...workflowBroadcastSignalIdsForBranchReplay(entry),
        ]}
        onToggleExpanded={() => setHistoryExpanded((current) => !current)}
        onOpenWorkflowList={() => setWorkflowListOpen(true)}
        onRefreshHistory={onRefreshBranchTaskHistory}
        onClearHistory={onClearBranchTaskHistory}
        onReplayHistory={onReplayBranchTaskHistory}
        onConfigureWorkflow={openWorkflowDialog}
        onOpenTaskOutput={onOpenTaskOutput}
        formatRelativeTime={formatRelativeTime}
      />

      <WorkflowRulesConfigDialog
        open={workflowOpen}
        title="联动配置"
        context={
          workflowEntry ? (
            <Stack direction="row" flexWrap="wrap" gap={0.7}>
              <Chip size="small" label={branchWorkflowModeLabel(workflowEntry.taskKind)} />
              <Chip size="small" label={`${workflowEntry.items.length} 项`} variant="outlined" />
              <Chip
                size="small"
                label={`${workflowEntry.items.filter((item) => item.success).length} 成功`}
                variant="outlined"
              />
            </Stack>
          ) : null
        }
        receiveSignalIds={
          workflowEntry ? workflowReceiveSignalIdsForBranchReplay(workflowEntry) : []
        }
        broadcastSignalIds={
          workflowEntry ? workflowBroadcastSignalIdsForBranchReplay(workflowEntry) : []
        }
        signalOptions={workflowSignalOptions}
        signalSummaries={workflowSignalSummaries}
        defaultBroadcastSignalId={workflowReplay ? defaultSignalIdForReplay(workflowReplay) : undefined}
        onDeleteSignal={onWorkflowSignalDelete}
        onClearSignals={onWorkflowSignalsClear}
        onClose={() => setWorkflowOpen(false)}
        onSave={({ receiveSignalIds, broadcastSignalIds }) => {
          if (workflowEntry) {
            onWorkflowBranchReplayRulesChange(workflowEntry, {
              receiveSignalIds,
              broadcastSignalIds,
            });
          }
          setWorkflowOpen(false);
        }}
      />
      <WorkflowLinksDialog
        open={workflowListOpen}
        title="联动清单"
        items={workflowGroups}
        onClose={() => setWorkflowListOpen(false)}
        onEnabledChange={(item, enabled) => {
          if (item.ruleKind === "receive") {
            onWorkflowReceiveRulesEnabledChange(item.ruleIds, enabled);
          } else {
            onWorkflowBroadcastRulesEnabledChange(item.ruleIds, enabled);
          }
        }}
        onDelete={(item) => {
          if (item.ruleKind === "receive") {
            onWorkflowReceiveRulesDelete(item.ruleIds);
          } else {
            onWorkflowBroadcastRulesDelete(item.ruleIds);
          }
        }}
        onClearAll={(items) => {
          const receiveRuleIds = items
            .filter((item) => item.ruleKind === "receive")
            .flatMap((item) => item.ruleIds);
          const broadcastRuleIds = items
            .filter((item) => item.ruleKind === "broadcast")
            .flatMap((item) => item.ruleIds);
          if (receiveRuleIds.length > 0) {
            onWorkflowReceiveRulesDelete(receiveRuleIds);
          }
          if (broadcastRuleIds.length > 0) {
            onWorkflowBroadcastRulesDelete(broadcastRuleIds);
          }
        }}
      />
    </Box>
  );
}
