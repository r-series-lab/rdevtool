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
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import type {
  BranchOption,
  BranchPushAction,
  BranchPushStatus,
  BranchTaskHistoryEntry,
  BranchTaskPendingEntry,
  BranchTaskResponse,
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
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { PushCommitConfirmContent } from "../components/branch/PushCommitConfirmContent";
import {
  ClearIcon,
  FolderIcon,
  RefreshIcon,
} from "../components/AppIcons";
import { shouldHandlePrimaryEnter } from "../lib/keyboard";
import { useI18n } from "../i18n";
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
  syncProjects: string[];
  onSyncProjectsChange: (values: string[]) => void;
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
  pushSelectedPaths: string[];
  onPushSelectedPathsChange: (value: string[]) => void;
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
  onRepairWorktree: (repoPath: string) => void;
  onRefreshWorktrees: () => void;
  onRefreshPushStatus: () => void;
  onSyncBranches: () => void;
  sourceBranchEntries: BranchOption[];
  targetBranchEntries: BranchOption[];
  sourceBranchOptions: string[];
  targetBranchOptions: string[];
  busy: string;
  currentBranchTaskHistoryId: string;
  currentBranchTask: BranchTaskPendingEntry | null;
  branchTaskHistory: BranchTaskHistoryEntry[];
  onPlanSync: () => Promise<BranchTaskResponse | null>;
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
function formatBranchUpdatedAt(item: BranchOption | undefined, unknownLabel: string) {
  if (!item?.updatedAt) {
    return unknownLabel;
  }
  return item.updatedAt;
}

function normalizeBranchValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function branchSyncPlanCounts(plan: BranchTaskResponse) {
  return {
    ready: plan.items.filter((item) => item.statusKey === "ready").length,
    failed: plan.items.filter((item) => !item.success).length,
    skipped: plan.items.filter(
      (item) => item.success && item.statusKey !== "ready",
    ).length,
  };
}

function missingBranchValues(values: string[], options: string[]) {
  if (options.length === 0) {
    return [];
  }
  const optionSet = new Set(options);
  return normalizeBranchValues(values).filter((value) => !optionSet.has(value));
}

export function hasExplicitBranchValues({
  sourceBranch = "",
  targetBranch = "",
  targetBranches = [],
  requireSource = false,
  requireTarget = false,
  requireTargets = false,
}: {
  sourceBranch?: string;
  targetBranch?: string;
  targetBranches?: string[];
  requireSource?: boolean;
  requireTarget?: boolean;
  requireTargets?: boolean;
}): boolean {
  return (
    (!requireSource || Boolean(sourceBranch.trim())) &&
    (!requireTarget || Boolean(targetBranch.trim())) &&
    (!requireTargets || normalizeBranchValues(targetBranches).length > 0)
  );
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
  const { t } = useI18n();
  const missing = missingBranchValues(values, options);
  if (missing.length === 0) {
    return null;
  }

  return (
    <InlineWarningNotice
      title={t("{label} 不在当前项目分支列表中", { label: t(label) })}
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
  const { t } = useI18n();
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
        {t("本地状态可能已过期")}
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
          {t("刷新")}
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

export function WorktreeSelector({
  items,
  value,
  loading,
  error,
  disabled,
  onChange,
  onChooseDirectory,
  onRepair,
  onRefresh,
}: {
  items: BranchWorktreeSummary[];
  value: string;
  loading: boolean;
  error: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onChooseDirectory: () => void;
  onRepair: (repoPath: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const labelId = useId();
  const selected = items.find((item) => item.repoPath === value) ?? null;
  const canRepair = Boolean(
    selected?.statusKey === "missing" && selected.isGitWorktree,
  );
  const helperText =
    error ||
    selected?.detail ||
    selected?.repoPath ||
    (loading ? t("正在读取项目实例") : t("选择项目实例或本地目录后再操作"));

  return (
    <Stack spacing={0.45}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 0.45,
          alignItems: "stretch",
        }}
      >
        <FormControl fullWidth disabled={disabled}>
          <InputLabel id={labelId}>{t("项目实例")}</InputLabel>
          <Select
            labelId={labelId}
            value={value}
            label={t("项目实例")}
            displayEmpty
            onChange={(event: SelectChangeEvent<string>) => onChange(event.target.value)}
            renderValue={(selectedValue) => {
              const item = items.find((entry) => entry.repoPath === selectedValue);
              if (!item) {
                return loading ? t("正在读取项目实例") : t("选择项目实例");
              }
              return `${item.label} · ${worktreeBranchLabel(item)} · ${item.statusLabel}`;
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
                      <Chip size="small" label={t("工作区")} color="primary" variant="outlined" />
                    ) : null}
                    {item.managed ? <Chip size="small" label={t("托管")} variant="outlined" /> : null}
                    {item.isDefault ? <Chip size="small" label={t("默认")} variant="outlined" /> : null}
                    {item.isGitWorktree ? <Chip size="small" label="worktree" variant="outlined" /> : null}
                    <Chip
                      size="small"
                      label={item.statusLabel}
                      color={item.statusKey === "clean" ? "success" : ["missing", "unavailable"].includes(item.statusKey) ? "error" : "primary"}
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
        <Stack direction="row" spacing={0.35} alignItems="center">
          {canRepair && selected ? (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => onRepair(selected.repoPath)}
              disabled={disabled || loading}
              sx={{ whiteSpace: "nowrap", minHeight: 32 }}
            >
              {t("修复副本")}
            </Button>
          ) : null}
          <IconButton
            onClick={onRefresh}
            disabled={disabled || loading}
            aria-label={t("刷新项目实例")}
            title={t("刷新项目实例")}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={onChooseDirectory}
            disabled={disabled}
            aria-label={t("选择本地目录")}
            title={t("选择本地目录")}
          >
            <FolderIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
      <Typography
        variant="caption"
        color={error || selected?.statusKey === "missing" ? "error" : "text.secondary"}
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
  const { t } = useI18n();
  const translatedLabel = t(label);
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
                {formatBranchUpdatedAt(item, t("未知"))}
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
              label={translatedLabel}
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
                          aria-label={t("清空{label}", { label: translatedLabel })}
                          title={t("清空{label}", { label: translatedLabel })}
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
                        aria-label={t("同步分支")}
                        title={t("同步分支")}
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
  syncProjects,
  onSyncProjectsChange,
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
  pushSelectedPaths,
  onPushSelectedPathsChange,
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
  onRepairWorktree,
  onRefreshWorktrees,
  onRefreshPushStatus,
  onSyncBranches,
  sourceBranchEntries,
  targetBranchEntries,
  sourceBranchOptions,
  targetBranchOptions,
  busy,
  currentBranchTaskHistoryId,
  currentBranchTask,
  branchTaskHistory,
  onPlanSync,
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
  const { t } = useI18n();
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowEntry, setWorkflowEntry] = useState<BranchTaskHistoryEntry | null>(null);
  const [pushFilesExpanded, setPushFilesExpanded] = useState(false);
  const [switchFilesExpanded, setSwitchFilesExpanded] = useState(false);
  const [localOperation, setLocalOperation] = useState<LocalBranchOperation>("switch");
  const [nowMs, setNowMs] = useState(Date.now());
  const [confirm, confirmDialog] = useAppConfirmDialog();
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
  const selectedSyncProjectOptions = useMemo(
    () => projects.filter((project) => syncProjects.includes(project.key)),
    [projects, syncProjects],
  );
  const pushStatusStale = Boolean(
    pushStatusUpdatedAtMs && nowMs - pushStatusUpdatedAtMs > PUSH_STATUS_STALE_MS,
  );
  const syncReady =
    syncProjects.length > 0 &&
    hasExplicitBranchValues({
      sourceBranch: syncSource,
      targetBranches: syncTargets,
      requireSource: true,
      requireTargets: true,
    });
  const createReady =
    createProjects.length > 0 &&
    hasExplicitBranchValues({
      sourceBranch: createSource,
      targetBranch: createTarget,
      requireSource: true,
      requireTarget: true,
    }) &&
    createSource.trim() !== createTarget.trim();
  const checkoutReady =
    Boolean(selectedProject) &&
    hasExplicitBranchValues({ sourceBranch: checkoutSource, requireSource: true }) &&
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
    hasExplicitBranchValues({ targetBranch: normalizedSwitchTarget, requireTarget: true }) &&
    Boolean(pushStatus) &&
    !switchSameAsCurrent &&
    !switchBlockedByStatus;
  const pushReady =
    Boolean(selectedProject) &&
    hasSelectedWorktree &&
    Boolean(pushStatus) &&
    Boolean(pushStatus?.canPush) &&
    (pushAction === "pushOnly" || Boolean(pushCommitMessage.trim()));
  const pushButtonLabel =
    pushAction === "commitAndPush"
      ? pushSelectedPaths.length > 0
        ? t("提交已选 {count} 个文件并推送", { count: pushSelectedPaths.length })
        : t("提交全部并推送")
      : t("执行推送");
  const handlePushSelectedPathsChange = useCallback(
    (value: string[]) => {
      const normalized = normalizeBranchValues(value);
      onPushSelectedPathsChange(normalized);
      if (normalized.length > 0 && pushAction !== "commitAndPush") {
        onPushActionChange("commitAndPush");
      }
    },
    [onPushActionChange, onPushSelectedPathsChange, pushAction],
  );
  const normalizedPushSelectedPaths = useMemo(
    () => normalizeBranchValues(pushSelectedPaths),
    [pushSelectedPaths],
  );
  const pushSelectedPathSet = useMemo(
    () => new Set(normalizedPushSelectedPaths),
    [normalizedPushSelectedPaths],
  );
  const pushCommitPreviewFiles = useMemo(() => {
    if (!pushStatus) {
      return [];
    }
    return normalizedPushSelectedPaths.length > 0
      ? pushStatus.files.filter((item) => pushSelectedPathSet.has(item.path))
      : pushStatus.files;
  }, [normalizedPushSelectedPaths.length, pushSelectedPathSet, pushStatus]);
  const pushMissingSelectedPaths = useMemo(() => {
    if (!pushStatus || normalizedPushSelectedPaths.length === 0) {
      return [];
    }
    const currentPaths = new Set(pushStatus.files.map((item) => item.path));
    return normalizedPushSelectedPaths.filter((path) => !currentPaths.has(path));
  }, [normalizedPushSelectedPaths, pushStatus]);
  const pushUnselectedStagedFiles = useMemo(() => {
    if (!pushStatus || normalizedPushSelectedPaths.length === 0) {
      return [];
    }
    return pushStatus.files.filter(
      (item) => item.staged && !pushSelectedPathSet.has(item.path),
    );
  }, [normalizedPushSelectedPaths.length, pushSelectedPathSet, pushStatus]);
  const switchStatusHelper = pushStatusError
    || (pushStatusLoading
      ? t("正在读取本地仓库状态")
      : pushStatus
        ? switchSameAsCurrent
          ? t("当前已在目标分支")
          : switchBlockedByStatus
            ? t("工作副本有未提交或未跟踪文件，处理后再切换")
            : pushStatusStale
              ? t("本地状态可能已过期，建议刷新后再操作")
              : pushStatus.repoPath
          : hasSelectedWorktree
            ? t("读取本地仓库状态后可切换分支")
          : t("先选择项目实例"));
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
    if (currentBranchTask) {
      setHistoryExpanded(true);
    }
  }, [currentBranchTask?.id]);

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
      void handleExecuteSyncClick();
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

  async function handleExecuteSyncClick() {
    const plan = await onPlanSync();
    if (!plan) {
      return;
    }

    const counts = branchSyncPlanCounts(plan);
    const visibleItems = plan.items.slice(0, 12);
    const hiddenCount = Math.max(0, plan.items.length - visibleItems.length);
    const confirmed = await confirm({
      title:
        counts.ready > 0
          ? t("确认合并 {count} 项？", { count: counts.ready })
          : t("没有可执行的合并项"),
      description: (
        <Stack spacing={1.1}>
          <Typography variant="body2">
            {t("可合并 {count} 项", { count: counts.ready })}
            {counts.skipped > 0
              ? ` · ${t("跳过 {count} 项", { count: counts.skipped })}`
              : ""}
            {counts.failed > 0
              ? ` · ${t("阻止 {count} 项", { count: counts.failed })}`
              : ""}
          </Typography>
          <Stack spacing={0}>
            {visibleItems.map((item, index) => (
              <Box
                key={`${item.projectKey}-${item.targetBranch ?? "-"}-${index}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 0.8,
                  alignItems: "center",
                  py: 0.75,
                  borderBottom: index < visibleItems.length - 1 ? "1px solid" : "none",
                  borderColor: "divider",
                }}
              >
                <Box minWidth={0}>
                  <Typography variant="body2" fontWeight={700} noWrap>
                    {item.projectName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {item.sourceBranch} → {item.targetBranch || "-"} · {item.summary}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={item.statusLabel}
                  color={item.statusKey === "ready" ? "success" : item.success ? "default" : "error"}
                  variant="outlined"
                />
              </Box>
            ))}
          </Stack>
          {hiddenCount > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {t("另有 {count} 项结果", { count: hiddenCount })}
            </Typography>
          ) : null}
        </Stack>
      ),
      confirmLabel: counts.ready > 0 ? t("开始合并") : t("知道了"),
      cancelLabel: counts.ready > 0 ? t("取消") : t("关闭"),
      preferenceKey: counts.ready > 0 ? "branch.mutate" : undefined,
    });
    if (confirmed && counts.ready > 0) {
      onExecuteSync();
    }
  }

  function openWorkflowDialog(entry: BranchTaskHistoryEntry) {
    setWorkflowEntry(entry);
    setWorkflowOpen(true);
  }

  async function handleExecutePushClick() {
    if (pushAction !== "commitAndPush" || !pushStatus || pushStatus.clean) {
      onExecutePush();
      return;
    }

    if (pushStatus.conflictedCount > 0) {
      await confirm({
        title: t("存在冲突文件"),
        description: t("当前工作副本存在冲突文件，请先解决冲突后再提交并推送。"),
        confirmLabel: t("知道了"),
        cancelLabel: t("关闭"),
      });
      return;
    }

    if (pushMissingSelectedPaths.length > 0) {
      await confirm({
        title: t("所选文件已过期"),
        description: (
          <Stack spacing={0.8}>
            <Typography variant="body2">
              {t("有所选文件已经不在当前变更列表中，请刷新状态后重试。")}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontFamily: '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                overflowWrap: "anywhere",
              }}
            >
              {pushMissingSelectedPaths.join(", ")}
            </Typography>
          </Stack>
        ),
        confirmLabel: t("知道了"),
        cancelLabel: t("关闭"),
      });
      return;
    }

    if (pushUnselectedStagedFiles.length > 0) {
      await confirm({
        title: t("暂存区需要处理"),
        description: t(
          "以下 {count} 个文件已经暂存但没有被选择。部分提交会被阻止，请先处理暂存区或一并选择这些文件。",
          { count: pushUnselectedStagedFiles.length },
        ),
        content: (
          <PushCommitConfirmContent
            files={pushUnselectedStagedFiles}
            repoPath={pushStatus.repoPath}
          />
        ),
        confirmLabel: t("知道了"),
        cancelLabel: t("关闭"),
        maxWidth: false,
        dialogClassName: "push-commit-confirm-dialog",
        contentClassName: "push-commit-confirm-dialog-content",
      });
      return;
    }

    if (pushCommitPreviewFiles.length === 0) {
      onExecutePush();
      return;
    }

    const partial = normalizedPushSelectedPaths.length > 0;
    const confirmed = await confirm({
      title: partial ? t("确认提交已选文件？") : t("确认提交全部变更？"),
      description: partial
        ? t("将提交已选 {count} 个文件并推送当前分支。", {
            count: pushCommitPreviewFiles.length,
          })
        : t("将提交当前工作副本全部 {count} 个变更文件并推送。", {
            count: pushCommitPreviewFiles.length,
          }),
      content: (
        <PushCommitConfirmContent
          files={pushCommitPreviewFiles}
          repoPath={pushStatus.repoPath}
        />
      ),
      confirmLabel: partial
        ? t("提交 {count} 个文件并推送", { count: pushCommitPreviewFiles.length })
        : t("提交全部并推送"),
      preferenceKey: "branch.mutate",
      maxWidth: false,
      dialogClassName: "push-commit-confirm-dialog",
      contentClassName: "push-commit-confirm-dialog-content",
    });
    if (confirmed) {
      onExecutePush();
    }
  }

  const workflowReplay = workflowEntry ? workflowReplayFromBranchHistory(workflowEntry) : null;

  return (
    <Box className="workspace workspace--workflow" onKeyDown={handlePrimaryEnter}>
      <Box className="workflow-module workflow-module--control">
        <Stack spacing={0.85}>
          <BranchModeTabs mode={mode} onModeChange={onModeChange} />

            {mode === "sync" ? (
              <Stack spacing={0.85}>
                <Autocomplete<ProjectOption, true, false, false>
                  multiple
                  fullWidth
                  disableCloseOnSelect
                  options={projects}
                  value={selectedSyncProjectOptions}
                  getOptionLabel={(option) => `${option.name} (${option.key})`}
                  isOptionEqualToValue={(option, value) => option.key === value.key}
                  onChange={(_, values) => onSyncProjectsChange(values.map((item) => item.key))}
                  renderInput={(params) => {
                    const { ref: inputRef, ...inputProps } = params.inputProps;

                    return (
                      <TextField
                        {...params}
                        inputRef={inputRef}
                        inputProps={inputProps}
                        label={t("项目")}
                      />
                    );
                  }}
                />
                <BranchInput
                  label={t("源分支")}
                  value={syncSource}
                  options={sourceBranchOptions}
                  branchEntryMap={sourceBranchEntryMap}
                  onChange={onSyncSourceChange}
                  onClear={onClearSyncSource}
                  onSyncBranches={onSyncBranches}
                  disabled={!selectedProject || Boolean(busy)}
                />
                <BranchValueWarning
                  label={t("源分支")}
                  values={[syncSource]}
                  options={sourceBranchOptions}
                  onReset={onClearSyncSource}
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
                        label={t("目标分支")}
                        helperText={t("执行前会逐项目校验远端源分支和目标分支")}
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
                                    aria-label={t("清空目标分支")}
                                    title={t("清空目标分支")}
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
                                  aria-label={t("同步分支")}
                                  title={t("同步分支")}
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
                            {formatBranchUpdatedAt(item, t("未知"))}
                          </Typography>
                        </Stack>
                      </Box>
                    );
                  }}
                />
                <BranchValueWarning
                  label={t("目标分支")}
                  values={syncTargets}
                  options={targetBranchOptions}
                  onReset={() => onSyncTargetsChange([])}
                />
                <Button
                  variant="contained"
                  onClick={() => void handleExecuteSyncClick()}
                  disabled={actionDisabled}
                  sx={{ minHeight: 34, borderRadius: "11px" }}
                >
                  {t("批量合并")}
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

                    return (
                      <TextField
                        {...params}
                        inputRef={inputRef}
                        inputProps={inputProps}
                        label={t("项目")}
                      />
                    );
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
                    label={t("源分支")}
                    value={createSource}
                    options={sourceBranchOptions}
                    branchEntryMap={sourceBranchEntryMap}
                    onChange={onCreateSourceChange}
                    onClear={onClearCreateSource}
                    onSyncBranches={onSyncBranches}
                    disabled={!selectedProject || Boolean(busy)}
                  />
                  <BranchInput
                    label={t("目标分支")}
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
                  label={t("源分支")}
                  values={[createSource]}
                  options={sourceBranchOptions}
                  onReset={onClearCreateSource}
                />
                <Button
                  variant="contained"
                  onClick={onExecuteCreate}
                  disabled={actionDisabled}
                  sx={{ minHeight: 34, borderRadius: "11px" }}
                >
                  {t("批量创建")}
                </Button>
              </Stack>
            ) : null}

            {mode === "switch" ? (
              <Stack spacing={0.85}>
                <FormControl fullWidth>
                  <InputLabel>{t("项目")}</InputLabel>
                  <Select
                    value={selectedProject}
                    label={t("项目")}
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
                      {t(item.label)}
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
                      onRepair={onRepairWorktree}
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
                      label={t("目标分支")}
                      value={switchTarget}
                      options={targetBranchOptions}
                      branchEntryMap={targetBranchEntryMap}
                      onChange={onSwitchTargetChange}
                      onClear={onClearSwitchTarget}
                      onSyncBranches={onSyncBranches}
                      disabled={!selectedProject || Boolean(busy)}
                    />
                    <BranchValueWarning
                      label={t("目标分支")}
                      values={[switchTarget]}
                      options={targetBranchOptions}
                      onReset={onClearSwitchTarget}
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
                      {t("切换到目标分支")}
                    </Button>
                  </>
                ) : null}

                {localOperation === "clone" ? (
                  <>
                    <BranchInput
                      label={t("源分支")}
                      value={checkoutSource}
                      options={sourceBranchOptions}
                      branchEntryMap={sourceBranchEntryMap}
                      onChange={onCheckoutSourceChange}
                      onClear={onClearCheckoutSource}
                      onSyncBranches={onSyncBranches}
                      disabled={!selectedProject || Boolean(busy)}
                    />
                    <BranchValueWarning
                      label={t("源分支")}
                      values={[checkoutSource]}
                      options={sourceBranchOptions}
                      onReset={onClearCheckoutSource}
                    />
                    <TextField
                      label={t("目标目录")}
                      value={checkoutDestinationDir}
                      placeholder={workspaceInstancePath || t("选择一个目录")}
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
                                  aria-label={t("清空目标目录")}
                                  title={t("清空目标目录")}
                                >
                                  <ClearIcon fontSize="small" />
                                </IconButton>
                              ) : null}
                              <IconButton
                                size="small"
                                onClick={onChooseCheckoutDirectory}
                                edge="end"
                                aria-label={t("选择目标目录")}
                                title={t("选择目标目录")}
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
                      {t("创建工作区副本")}
                    </Button>
                  </>
                ) : null}
              </Stack>
            ) : null}

            {mode === "push" ? (
              <Stack spacing={0.85}>
                <FormControl fullWidth>
                  <InputLabel>{t("项目")}</InputLabel>
                  <Select
                    value={selectedProject}
                    label={t("项目")}
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
                  onRepair={onRepairWorktree}
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
                    selectionEnabled
                    selectedPaths={pushSelectedPaths}
                    onSelectedPathsChange={handlePushSelectedPathsChange}
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
                      {t(item.label)}
                    </Button>
                  ))}
                </Box>

                {pushAction === "commitAndPush" ? (
                  <TextField
                    fullWidth
                    label={t("提交说明")}
                    value={pushCommitMessage}
                    onChange={(event) => onPushCommitMessageChange(event.target.value)}
                    placeholder={t("输入本次提交说明")}
                  />
                ) : null}

                <Button
                  variant="contained"
                  onClick={() => void handleExecutePushClick()}
                  disabled={actionDisabled}
                  sx={{ minHeight: 34, borderRadius: "11px" }}
                >
                  {pushButtonLabel}
                </Button>
              </Stack>
            ) : null}
        </Stack>
      </Box>

      <BranchHistoryPanel
        expanded={historyExpanded}
        history={branchTaskHistory}
        currentHistoryId={currentBranchTaskHistoryId}
        currentTask={currentBranchTask}
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
        title={t("联动配置")}
        context={
          workflowEntry ? (
            <Stack direction="row" flexWrap="wrap" gap={0.7}>
              <Chip size="small" label={t(branchWorkflowModeLabel(workflowEntry.taskKind))} />
              <Chip
                size="small"
                label={t("{count} 项", { count: workflowEntry.items.length })}
                variant="outlined"
              />
              <Chip
                size="small"
                label={t("{count} 成功", {
                  count: workflowEntry.items.filter((item) => item.success).length,
                })}
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
        title={t("联动清单")}
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
      {confirmDialog}
    </Box>
  );
}
