import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import type {
  BranchOption,
  BuildHistoryEntry,
  ProjectRuntimeLogResponse,
} from "../app-types";
import { HistoryCard } from "../components/AppCards";
import {
  WorkflowLinkButton,
  WorkflowLinkSummaryButton,
} from "../components/WorkflowLinkButton";
import {
  WorkflowLinksDialog,
  type WorkflowLinkListItem,
} from "../components/WorkflowLinksDialog";
import { WorkflowRulesConfigDialog } from "../components/WorkflowRulesConfigDialog";
import { InlineWarningNotice } from "../components/InlineWarningNotice";
import {
  ClearIcon,
  CheckIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  FolderIcon,
  OpenExternalIcon,
  RefreshIcon,
  ReplayIcon,
  StarIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "../components/AppIcons";
import { groupConsecutiveBy, stableStringify } from "../lib/historyGroups";
import { shouldHandlePrimaryEnter } from "../lib/keyboard";
import type { TrayPinnedAction } from "../lib/trayPins";
import { useTrayPinnedActions } from "../hooks/useTrayPinnedActions";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";
import type {
  BuildParamMeta,
  BuildPlan,
  BuildTargetMeta,
  BuildTargetSummary,
} from "../hooks/useBuildContext";
import {
  type WorkflowReceiveRule,
} from "../lib/workflowSignals";

type ProjectOption = {
  key: string;
  name: string;
  deployTargets: BuildTargetSummary[];
};

type BuildResult = {
  status?: number;
  queueUrl?: string | null;
  buildUrl?: string | null;
  stateKey: string;
  stateLabel: string;
  detail: string;
};

type BuildActionCopy = {
  noun: string;
  start: string;
  config: string;
};

const HISTORY_PAGE_SIZE = 5;
const BUILD_STATUS_STALE_MS = 45_000;
const BUILD_STATUS_CLOCK_INTERVAL_MS = 15_000;
const BUILD_HISTORY_PARAM_PREVIEW_LIMIT = 5;
const BUILD_ENV_PARAM_KEYS = new Set(["ENV_PROFILE", "projectEnv", "env"]);
const BUILD_BRANCH_PARAM_KEYS = new Set(["BRANCH", "branch", "Branch"]);
const SENSITIVE_BUILD_PARAM_PATTERN = /(token|secret|password|passwd|pwd|credential|auth|private)/i;

function isActiveBuildState(stateKey?: string | null) {
  return stateKey === "accepted" || stateKey === "queued" || stateKey === "running";
}

function buildActionCopy(actionKind?: string | null): BuildActionCopy {
  switch (actionKind) {
    case "build":
      return { noun: "构建", start: "开始构建", config: "构建配置" };
    case "package":
      return { noun: "打包", start: "开始打包", config: "打包配置" };
    case "release":
      return { noun: "发布", start: "开始发布", config: "发布配置" };
    case "deploy":
      return { noun: "部署", start: "开始部署", config: "部署配置" };
    default:
      return { noun: "构建", start: "开始构建", config: "构建配置" };
  }
}

function buildHistorySignature(item: BuildHistoryEntry) {
  return stableStringify({
    projectKey: item.projectKey,
    mode: item.mode,
    env: item.env,
    branch: item.branch,
    params: item.params ?? {},
  });
}

function normalizeBuildHistoryParams(params?: Record<string, string> | null) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    normalized[key] = value == null ? "" : String(value);
  }
  return normalized;
}

function buildTrayDedupeKeyFromHistory(item: BuildHistoryEntry) {
  return `build.replay:${stableStringify({
    historyKey: item.historyKey,
    projectKey: item.projectKey,
    mode: item.mode || "",
    params: normalizeBuildHistoryParams(item.params),
  })}`;
}

function buildLegacyTrayDedupeKeyFromHistory(item: BuildHistoryEntry) {
  return `build.replay:${stableStringify({
    projectKey: item.projectKey,
    mode: item.mode || "",
    params: normalizeBuildHistoryParams(item.params),
  })}`;
}

function buildTrayActionFromHistory(
  item: BuildHistoryEntry,
  targetLabel: string,
  actionLabel = "部署",
): TrayPinnedAction {
  const params = normalizeBuildHistoryParams(item.params);
  return {
    kind: "build.replay",
    label: `${actionLabel}：${item.projectName} / ${targetLabel || item.mode || "默认配置"}`,
    detail: [item.env, item.branch].filter(Boolean).join(" · ") || item.stateLabel,
    projectKey: item.projectKey,
    entry: null,
    payload: {
      project: item.projectKey,
      target: item.mode || null,
      params,
    },
    dedupeKey: buildTrayDedupeKeyFromHistory(item),
    updatedAtMs: Date.now(),
  };
}

function groupWorkflowReceiveRules(
  rules: WorkflowReceiveRule[],
): WorkflowLinkListItem[] {
  const groups = new Map<string, WorkflowLinkListItem & { enabledCount: number }>();

  for (const rule of rules) {
    const groupKey = rule.replayKey || rule.id;
    const current = groups.get(groupKey) ?? {
      key: groupKey,
      title: rule.label || rule.signalId,
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

type FieldRowProps = {
  label: string;
  children: ReactNode;
};

function FieldRow({ label, children }: FieldRowProps) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "74px minmax(0, 1fr)", sm: "92px minmax(0, 1fr)" },
        alignItems: "center",
        gap: { xs: 0.6, sm: 0.8 },
        minWidth: 0,
        minHeight: 38,
        px: { xs: 0.78, sm: 0.9 },
        py: 0.42,
        borderRadius: "11px",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: (theme) =>
          theme.palette.mode === "dark"
            ? "rgba(255,255,255,0.014)"
            : "rgba(255,255,255,0.52)",
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ fontWeight: 800, letterSpacing: "0.01em" }}
      >
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

type BooleanRowProps = {
  param: BuildParamMeta;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

function BooleanRow({ param, value, disabled, onChange }: BooleanRowProps) {
  const checked = value === param.trueValue;
  return (
    <FieldRow label={param.label}>
      <Stack direction="row" alignItems="center" justifyContent="flex-end" minWidth={0}>
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? param.trueValue : param.falseValue)}
          size="small"
          sx={(theme) => ({
            p: 0.2,
            color: theme.palette.mode === "dark" ? "rgba(238,241,245,0.52)" : "rgba(35,40,53,0.46)",
            "&.Mui-checked": {
              color: theme.palette.mode === "dark" ? "#eef1f5" : theme.palette.primary.main,
            },
          })}
        />
      </Stack>
    </FieldRow>
  );
}

type BuildValueWarningProps = {
  message: string;
  disabled: boolean;
  onReset: () => void;
};

function BuildValueWarning({
  message,
  disabled,
  onReset,
}: BuildValueWarningProps) {
  if (!message) {
    return null;
  }

  return (
    <InlineWarningNotice
      title={message}
      actionDisabled={disabled}
      onAction={onReset}
    />
  );
}

function buildParamResetValue(
  param: BuildParamMeta,
  sourceBranchOptions: string[],
) {
  if (param.kind === "branch") {
    return param.defaultValue || sourceBranchOptions[0] || "";
  }
  if (param.kind === "select") {
    return param.options.includes(param.defaultValue)
      ? param.defaultValue
      : param.options[0] || "";
  }
  if (param.kind === "boolean") {
    return [param.trueValue, param.falseValue].includes(param.defaultValue)
      ? param.defaultValue
      : param.falseValue;
  }
  return param.defaultValue;
}

function buildParamInvalidMessage(
  param: BuildParamMeta,
  value: string,
  sourceBranchOptions: string[],
) {
  const currentValue = value.trim();
  if (!currentValue) {
    return "";
  }
  if (
    param.kind === "branch" &&
    sourceBranchOptions.length > 0 &&
    !sourceBranchOptions.includes(currentValue)
  ) {
    return `${param.label} 不在当前项目分支列表中：${currentValue}`;
  }
  if (
    param.kind === "select" &&
    param.options.length > 0 &&
    !param.options.includes(currentValue)
  ) {
    return `${param.label} 不在当前选项中：${currentValue}`;
  }
  if (
    param.kind === "boolean" &&
    currentValue !== param.trueValue &&
    currentValue !== param.falseValue
  ) {
    return `${param.label} 不是有效的开关值：${currentValue}`;
  }
  return "";
}

type BuildStatusFreshnessProps = {
  updatedAtMs: number;
  nowMs: number;
  active: boolean;
  timedOut: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
};

function BuildStatusFreshness({
  updatedAtMs,
  nowMs,
  active,
  timedOut,
  canRefresh,
  onRefresh,
}: BuildStatusFreshnessProps) {
  const stale = Boolean(
    timedOut || (active && updatedAtMs && nowMs - updatedAtMs > BUILD_STATUS_STALE_MS),
  );
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
        {timedOut ? "自动刷新已暂停" : "状态可能已过期"}
      </Typography>
      <Button
        size="small"
        variant="text"
        disabled={!canRefresh}
        onClick={onRefresh}
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
    </Stack>
  );
}

type BuildResultRowProps = {
  label: string;
  value?: string | number | null;
  copyKey?: string;
  copied?: boolean;
  onCopy?: (field: string, value?: string | number | null) => void;
};

function BuildResultRow({
  label,
  value,
  copyKey,
  copied = false,
  onCopy,
}: BuildResultRowProps) {
  const textValue = value === null || value === undefined || value === "" ? "-" : String(value);
  const canCopy = Boolean(copyKey && textValue !== "-" && onCopy);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "76px minmax(0,1fr)", sm: "92px minmax(0,1fr)" },
        alignItems: "start",
        gap: 1,
        minWidth: 0,
        py: 0.65,
        borderTop: "1px solid",
        borderColor: "divider",
        "&:first-of-type": { borderTop: "none" },
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap sx={{ fontWeight: 800 }}>
        {label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" spacing={0.55} minWidth={0}>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            minWidth: 0,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            fontWeight: label === "状态" ? 700 : 500,
          }}
        >
          {textValue}
        </Typography>
        {canCopy && copyKey ? (
          <IconButton
            size="small"
            onClick={() => onCopy?.(copyKey, textValue)}
            title={copied ? "已复制" : "复制"}
            aria-label={copied ? `已复制${label}` : `复制${label}`}
            sx={{ mt: -0.45, flexShrink: 0 }}
          >
            {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
          </IconButton>
        ) : null}
      </Stack>
    </Box>
  );
}

type BuildResultLinkRowProps = {
  label: string;
  value?: string | null;
  copyKey: string;
  copied: boolean;
  onCopy: (field: string, value?: string | number | null) => void;
  onOpen: (url: string) => void;
};

function BuildResultLinkRow({
  label,
  value,
  copyKey,
  copied,
  onCopy,
  onOpen,
}: BuildResultLinkRowProps) {
  const url = value?.trim() ?? "";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "76px minmax(0,1fr)", sm: "92px minmax(0,1fr)" },
        alignItems: "center",
        gap: 1,
        minWidth: 0,
        py: 0.55,
        borderTop: "1px solid",
        borderColor: "divider",
        "&:first-of-type": { borderTop: "none" },
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap sx={{ fontWeight: 800 }}>
        {label}
      </Typography>
      {url ? (
        <Stack direction="row" alignItems="center" spacing={0.45} minWidth={0}>
          <Typography
            variant="body2"
            noWrap
            sx={{ flex: 1, minWidth: 0, fontWeight: 760, color: "text.primary" }}
          >
            可打开
          </Typography>
          <IconButton
            size="small"
            onClick={() => onOpen(url)}
            title={`打开${label}`}
            aria-label={`打开${label}`}
            sx={{ flexShrink: 0 }}
          >
            <OpenExternalIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onCopy(copyKey, url)}
            title={copied ? "已复制" : "复制"}
            aria-label={copied ? `已复制${label}` : `复制${label}`}
            sx={{ flexShrink: 0 }}
          >
            {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
          </IconButton>
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ fontWeight: 760 }}>
          -
        </Typography>
      )}
    </Box>
  );
}

type BuildHistoryParamEntry = {
  key: string;
  label: string;
  valueLabel: string;
  hidden: boolean;
  changed: boolean;
  defaultKnown: boolean;
};

function hasRecordValue(record: Record<string, string>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function buildHistoryParamLabel(key: string, param?: BuildParamMeta) {
  if (param?.label) {
    return param.label;
  }
  if (BUILD_ENV_PARAM_KEYS.has(key)) {
    return "环境";
  }
  if (BUILD_BRANCH_PARAM_KEYS.has(key)) {
    return "分支";
  }
  return key;
}

function shouldMaskBuildHistoryParam(key: string, param?: BuildParamMeta) {
  return param?.kind === "hidden" || SENSITIVE_BUILD_PARAM_PATTERN.test(key);
}

function shouldSkipBuildHistoryParam(
  item: BuildHistoryEntry,
  key: string,
  value: string,
) {
  const normalizedValue = value.trim();
  if (BUILD_ENV_PARAM_KEYS.has(key) && item.env && normalizedValue === item.env.trim()) {
    return true;
  }
  if (
    BUILD_BRANCH_PARAM_KEYS.has(key) &&
    item.branch &&
    normalizedValue === item.branch.trim()
  ) {
    return true;
  }
  return false;
}

function buildHistoryParamEntries(
  item: BuildHistoryEntry,
  paramMetaByKey: Map<string, BuildParamMeta>,
  defaultParamValues: Record<string, string>,
): BuildHistoryParamEntry[] {
  return Object.entries(item.params ?? {})
    .filter(([key, value]) => !shouldSkipBuildHistoryParam(item, key, String(value ?? "")))
    .map(([key, value]) => {
      const param = paramMetaByKey.get(key);
      const textValue = String(value ?? "");
      const defaultKnown = hasRecordValue(defaultParamValues, key) || Boolean(param);
      const defaultValue = hasRecordValue(defaultParamValues, key)
        ? defaultParamValues[key]
        : param?.defaultValue ?? "";
      const hidden = shouldMaskBuildHistoryParam(key, param);
      return {
        key,
        label: buildHistoryParamLabel(key, param),
        valueLabel: hidden ? (textValue ? "已配置" : "未配置") : textValue || "-",
        hidden,
        changed: defaultKnown && textValue !== defaultValue,
        defaultKnown,
      };
    });
}

function buildHistoryParamMetaLabels(
  item: BuildHistoryEntry,
  paramMetaByKey: Map<string, BuildParamMeta>,
  defaultParamValues: Record<string, string>,
) {
  const entries = buildHistoryParamEntries(item, paramMetaByKey, defaultParamValues);
  if (entries.length === 0) {
    return [];
  }

  const visibleEntries = entries.slice(0, BUILD_HISTORY_PARAM_PREVIEW_LIMIT);
  const extraCount = Math.max(0, entries.length - visibleEntries.length);
  const labels = visibleEntries.map((entry) => `${entry.label}: ${entry.valueLabel}`);
  return extraCount > 0 ? [...labels, `+${extraCount}`] : labels;
}

export type BuildPageProps = {
  projects: ProjectOption[];
  selectedProject: string;
  onProjectChange: (projectKey: string) => void;
  target: string;
  onTargetChange: (value: string) => void;
  targetMeta: BuildTargetMeta | null;
  paramValues: Record<string, string>;
  defaultParamValues: Record<string, string>;
  onParamChange: (key: string, value: string) => void;
  contextLoading: boolean;
  contextError: boolean;
  contextErrorText: string;
  onSyncBranches: () => void;
  sourceBranchEntries: BranchOption[];
  sourceBranchOptions: string[];
  branchSyncText: string;
  busy: string;
  onTriggerBuild: () => void;
  plan: BuildPlan | null;
  buildResult: BuildResult | null;
  buildResultUpdatedAtMs: number;
  buildAutoRefreshTimedOut: boolean;
  onRefreshBuild: () => void;
  onOpenBuildRecord: () => void;
  onOpenBuildUrl: (url: string) => void;
  buildHistory: BuildHistoryEntry[];
  onReplayBuildHistory: (entry: BuildHistoryEntry) => void;
  workflowReceiveRules: WorkflowReceiveRule[];
  workflowSignalIdsForBuildReplay: (entry: BuildHistoryEntry) => string[];
  workflowSignalOptions: string[];
  workflowSignalSummaries: WorkflowSignalSummary[];
  onWorkflowBuildReplayReceiversChange: (
    entry: BuildHistoryEntry,
    signalIds: string[],
  ) => void;
  onWorkflowReceiveRulesEnabledChange: (ruleIds: string[], enabled: boolean) => void;
  onWorkflowReceiveRulesDelete: (ruleIds: string[]) => void;
  onWorkflowSignalDelete: (signalId: string) => void;
  onWorkflowSignalsClear: () => void;
  onRefreshBuildHistory: () => void;
  onClearBuildHistory: () => void;
  formatRelativeTime: (value?: string) => string;
};

export function BuildPage({
  projects,
  selectedProject,
  onProjectChange,
  target,
  onTargetChange,
  targetMeta,
  paramValues,
  defaultParamValues,
  onParamChange,
  contextLoading,
  contextError,
  contextErrorText,
  onSyncBranches,
  sourceBranchEntries,
  sourceBranchOptions,
  branchSyncText,
  busy,
  onTriggerBuild,
  plan,
  buildResult,
  buildResultUpdatedAtMs,
  buildAutoRefreshTimedOut,
  onRefreshBuild,
  onOpenBuildRecord,
  onOpenBuildUrl,
  buildHistory,
  onReplayBuildHistory,
  workflowReceiveRules,
  workflowSignalIdsForBuildReplay,
  workflowSignalOptions,
  workflowSignalSummaries,
  onWorkflowBuildReplayReceiversChange,
  onWorkflowReceiveRulesEnabledChange,
  onWorkflowReceiveRulesDelete,
  onWorkflowSignalDelete,
  onWorkflowSignalsClear,
  onRefreshBuildHistory,
  onClearBuildHistory,
  formatRelativeTime,
}: BuildPageProps) {
  const [resultExpanded, setResultExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowEntry, setWorkflowEntry] = useState<BuildHistoryEntry | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [copiedResultField, setCopiedResultField] = useState("");
  const [runtimeLogOpen, setRuntimeLogOpen] = useState(false);
  const [runtimeLogLoading, setRuntimeLogLoading] = useState(false);
  const [runtimeLogError, setRuntimeLogError] = useState("");
  const [runtimeLogPath, setRuntimeLogPath] = useState("");
  const [runtimeLogLines, setRuntimeLogLines] = useState<string[]>([]);
  const [runtimeLogTruncated, setRuntimeLogTruncated] = useState(false);
  const [localBuildAction, setLocalBuildAction] = useState("");
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const {
    scopedActions: pinnedBuildActions,
    togglePinned,
    removePinned,
    replacePinnedActions,
  } = useTrayPinnedActions("build.replay");
  const buildHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, BuildHistoryEntry>();
    for (const item of buildHistory) {
      const key = buildTrayDedupeKeyFromHistory(item);
      if (!next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [buildHistory]);
  const buildLegacyHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, BuildHistoryEntry>();
    for (const item of buildHistory) {
      const key = buildLegacyTrayDedupeKeyFromHistory(item);
      if (!next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [buildHistory]);
  const buildSpecificLegacyPinnedKeys = useMemo(() => {
    const next = new Set<string>();
    for (const action of pinnedBuildActions) {
      const item = buildHistoryByPinnedKey.get(action.dedupeKey);
      if (item) {
        next.add(buildLegacyTrayDedupeKeyFromHistory(item));
      }
    }
    return next;
  }, [buildHistoryByPinnedKey, pinnedBuildActions]);
  const duplicateLegacyBuildPinnedKeys = useMemo(
    () =>
      pinnedBuildActions
        .filter(
          (action) =>
            buildLegacyHistoryByPinnedKey.has(action.dedupeKey) &&
            buildSpecificLegacyPinnedKeys.has(action.dedupeKey),
        )
        .map((action) => action.dedupeKey)
        .sort(),
    [buildLegacyHistoryByPinnedKey, buildSpecificLegacyPinnedKeys, pinnedBuildActions],
  );
  const duplicateLegacyBuildPinnedKeySignature =
    duplicateLegacyBuildPinnedKeys.join("\n");
  useEffect(() => {
    if (!duplicateLegacyBuildPinnedKeySignature) {
      return;
    }
    const duplicateKeys = new Set(duplicateLegacyBuildPinnedKeySignature.split("\n"));
    replacePinnedActions((actions) =>
      actions.filter((action) => !duplicateKeys.has(action.dedupeKey)),
    ).catch((error) => {
      console.error("failed to prune legacy build pinned actions", error);
    });
  }, [duplicateLegacyBuildPinnedKeySignature, replacePinnedActions]);
  const displayPinnedBuildActions = useMemo(
    () =>
      pinnedBuildActions.filter((action) => {
        if (buildHistoryByPinnedKey.has(action.dedupeKey)) {
          return true;
        }
        return (
          buildLegacyHistoryByPinnedKey.has(action.dedupeKey) &&
          !buildSpecificLegacyPinnedKeys.has(action.dedupeKey)
        );
      }),
    [
      buildHistoryByPinnedKey,
      buildLegacyHistoryByPinnedKey,
      buildSpecificLegacyPinnedKeys,
      pinnedBuildActions,
    ],
  );
  const pinnedActionOrder = useMemo(
    () =>
      new Map(
        displayPinnedBuildActions.map((action, index) => [action.dedupeKey, index]),
      ),
    [displayPinnedBuildActions],
  );
  const pinnedActionByKey = useMemo(
    () =>
      new Map(
        displayPinnedBuildActions.map((action) => [action.dedupeKey, action]),
      ),
    [displayPinnedBuildActions],
  );
  const sourceBranchEntryMap = useMemo(
    () => new Map(sourceBranchEntries.map((item) => [item.name, item])),
    [sourceBranchEntries],
  );
  const visibleParams = targetMeta?.params.filter((param) => param.kind !== "hidden") ?? [];
  const paramMetaByKey = useMemo(
    () => new Map((targetMeta?.params ?? []).map((param) => [param.key, param])),
    [targetMeta],
  );
  const targetMetaByKey = useMemo(
    () => new Map((targetMeta?.targets ?? []).map((item) => [item.key, item])),
    [targetMeta],
  );
  const actionCopy = buildActionCopy(
    plan?.actionKind || targetMetaByKey.get(target)?.actionKind,
  );
  const targetOptions = targetMeta?.targets.length
    ? targetMeta.targets
    : projects.find((project) => project.key === selectedProject)?.deployTargets ?? [];
  const targetOptionKeys = targetOptions.map((item) => item.key);
  const targetValueInvalid = Boolean(
    target && targetOptionKeys.length > 0 && !targetOptionKeys.includes(target),
  );
  const contextBlocked = contextLoading || contextError;
  const isLocalBuildPlan = Boolean(plan && plan.adapter !== "jenkins");
  const localBuildProjectKey = isLocalBuildPlan ? plan?.projectKey || selectedProject : "";
  const canRefreshBuild = Boolean(
    buildResult?.queueUrl || buildResult?.buildUrl || localBuildProjectKey,
  );
  const buildResultActive = isActiveBuildState(buildResult?.stateKey);
  const groupedBuildHistory = useMemo(
    () =>
      groupConsecutiveBy(
        buildHistory,
        buildHistorySignature,
        (item) => item.historyKey,
      ),
    [buildHistory],
  );
  function pinnedOrderForBuildGroup(group: (typeof groupedBuildHistory)[number]) {
    let order: number | undefined;
    for (const item of group.items) {
      const itemOrder = pinnedActionOrder.get(buildTrayDedupeKeyFromHistory(item));
      if (itemOrder !== undefined) {
        order = order === undefined ? itemOrder : Math.min(order, itemOrder);
      }
    }
    if (order !== undefined) {
      return order;
    }
    return pinnedActionOrder.get(buildLegacyTrayDedupeKeyFromHistory(group.latest));
  }

  const sortedBuildHistoryGroups = useMemo(() => {
    const originalOrder = new Map(
      groupedBuildHistory.map((group, index) => [group.id, index]),
    );
    return [...groupedBuildHistory].sort((left, right) => {
      const leftPinnedOrder = pinnedOrderForBuildGroup(left);
      const rightPinnedOrder = pinnedOrderForBuildGroup(right);
      const leftPinned = leftPinnedOrder !== undefined;
      const rightPinned = rightPinnedOrder !== undefined;

      if (leftPinned && rightPinned) {
        return (
          (leftPinnedOrder ?? 0) - (rightPinnedOrder ?? 0) ||
          (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
        );
      }
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }
      return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
    });
  }, [groupedBuildHistory, pinnedActionOrder]);
  const pinnedBuildHistoryGroups = useMemo(
    () =>
      sortedBuildHistoryGroups.filter(
        (group) => pinnedOrderForBuildGroup(group) !== undefined,
      ),
    [pinnedActionOrder, sortedBuildHistoryGroups],
  );
  const unpinnedBuildHistoryGroups = useMemo(
    () =>
      sortedBuildHistoryGroups.filter(
        (group) => pinnedOrderForBuildGroup(group) === undefined,
      ),
    [pinnedActionOrder, sortedBuildHistoryGroups],
  );
  function pinnedActionForBuildGroup(group: (typeof groupedBuildHistory)[number]) {
    let pinnedAction: TrayPinnedAction | null = null;
    let pinnedOrder = Number.POSITIVE_INFINITY;
    for (const item of group.items) {
      const key = buildTrayDedupeKeyFromHistory(item);
      const order = pinnedActionOrder.get(key);
      const action = pinnedActionByKey.get(key);
      if (action && order !== undefined && order < pinnedOrder) {
        pinnedAction = action;
        pinnedOrder = order;
      }
    }
    if (pinnedAction) {
      return pinnedAction;
    }
    const legacyKey = buildLegacyTrayDedupeKeyFromHistory(group.latest);
    return pinnedActionByKey.get(legacyKey) ?? null;
  }
  const historyPageCount = Math.max(
    1,
    Math.ceil(unpinnedBuildHistoryGroups.length / HISTORY_PAGE_SIZE),
  );
  const pagedBuildHistoryGroups = useMemo(
    () =>
      unpinnedBuildHistoryGroups.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [historyPage, unpinnedBuildHistoryGroups],
  );
  const visibleBuildHistoryGroups = useMemo(
    () => [...pinnedBuildHistoryGroups, ...pagedBuildHistoryGroups],
    [pagedBuildHistoryGroups, pinnedBuildHistoryGroups],
  );
  const workflowReceiveGroups = useMemo(
    () => groupWorkflowReceiveRules(workflowReceiveRules),
    [workflowReceiveRules],
  );

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

  useEffect(() => {
    setExpandedHistoryGroups((current) => {
      const visibleIds = new Set(sortedBuildHistoryGroups.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [sortedBuildHistoryGroups]);

  useEffect(() => {
    if (!buildResultUpdatedAtMs) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, BUILD_STATUS_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [buildResultUpdatedAtMs]);

  function handlePrimaryEnter(event: KeyboardEvent<HTMLElement>) {
    if (!shouldHandlePrimaryEnter(event) || contextBlocked) {
      return;
    }
    event.preventDefault();
    onTriggerBuild();
  }

  function toggleHistoryGroup(groupId: string) {
    setExpandedHistoryGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function openWorkflowReceiveDialog(entry: BuildHistoryEntry) {
    setWorkflowEntry(entry);
    setWorkflowOpen(true);
  }

  function handleTogglePinned(action: TrayPinnedAction) {
    togglePinned(action)
      .then(() => setHistoryPage(1))
      .catch((error) => {
        console.error("failed to update tray pinned action", error);
      });
  }

  function handleRemovePinned(dedupeKey: string) {
    removePinned(dedupeKey)
      .then(() => setHistoryPage(1))
      .catch((error) => {
        console.error("failed to remove tray pinned action", error);
      });
  }

  async function copyResultValue(
    field: string,
    value?: string | number | null,
  ) {
    const text = value === null || value === undefined || value === "" ? "" : String(value);
    if (!text || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedResultField(field);
      window.setTimeout(() => {
        setCopiedResultField((current) => (current === field ? "" : current));
      }, 1200);
    } catch {
      setCopiedResultField("");
    }
  }

  async function openLocalBuildLog() {
    if (!localBuildProjectKey) {
      return;
    }

    setRuntimeLogOpen(true);
    setRuntimeLogLoading(true);
    setRuntimeLogError("");
    setRuntimeLogPath("");
    setRuntimeLogLines([]);
    setRuntimeLogTruncated(false);
    try {
      const response = await invoke<ProjectRuntimeLogResponse>(
        "read_project_runtime_log",
        {
          project: localBuildProjectKey,
          kind: "build",
          maxLines: 220,
        },
      );
      setRuntimeLogPath(response.path);
      setRuntimeLogLines(response.lines);
      setRuntimeLogTruncated(response.truncated);
    } catch (reason) {
      setRuntimeLogError(String(reason));
    } finally {
      setRuntimeLogLoading(false);
    }
  }

  async function stopLocalBuild() {
    if (!localBuildProjectKey) {
      return;
    }

    setLocalBuildAction("stop");
    setRuntimeLogError("");
    try {
      await invoke("stop_project_build", { project: localBuildProjectKey });
      onRefreshBuild();
    } catch (reason) {
      setRuntimeLogError(String(reason));
      setRuntimeLogOpen(true);
    } finally {
      setLocalBuildAction("");
    }
  }

  async function openLocalBuildOutput() {
    if (!localBuildProjectKey) {
      return;
    }

    setLocalBuildAction("output");
    setRuntimeLogError("");
    try {
      await invoke("open_project_build_output", { project: localBuildProjectKey });
    } catch (reason) {
      setRuntimeLogError(String(reason));
      setRuntimeLogOpen(true);
    } finally {
      setLocalBuildAction("");
    }
  }

  function renderParam(param: BuildParamMeta) {
    const value = paramValues[param.key] ?? param.defaultValue ?? "";
    const invalidMessage = buildParamInvalidMessage(
      param,
      value,
      sourceBranchOptions,
    );
    const handleResetParam = () =>
      onParamChange(param.key, buildParamResetValue(param, sourceBranchOptions));
    if (param.kind === "select") {
      return (
        <Stack key={param.key} spacing={0.55}>
          <FieldRow label={param.label}>
            <FormControl fullWidth variant="standard">
              <Select
                value={invalidMessage ? "" : value}
                variant="standard"
                disabled={contextBlocked}
                onChange={(event: SelectChangeEvent<string>) => onParamChange(param.key, event.target.value)}
                sx={{
                  "&:before, &:after": { display: "none" },
                  "& .MuiSelect-select": {
                    py: 0.2,
                    pl: 0,
                    pr: "28px !important",
                    fontWeight: 800,
                  },
                }}
              >
                {invalidMessage ? (
                  <MenuItem value="" disabled>
                    {value}
                  </MenuItem>
                ) : null}
                {param.options.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </FieldRow>
          <BuildValueWarning
            message={invalidMessage}
            disabled={contextBlocked}
            onReset={handleResetParam}
          />
        </Stack>
      );
    }

    if (param.kind === "branch") {
      return (
        <Stack key={param.key} spacing={0.55}>
          <FieldRow label={param.label}>
            <Autocomplete
              freeSolo
              fullWidth
              disableClearable
              forcePopupIcon={false}
              options={sourceBranchOptions}
              value={value}
              inputValue={value}
              onChange={(_, next) => onParamChange(param.key, typeof next === "string" ? next : next ?? "")}
              onInputChange={(_, next, reason) => {
                if (reason !== "reset" || next !== value) {
                  onParamChange(param.key, next);
                }
              }}
              autoHighlight
              selectOnFocus
              clearOnBlur={false}
              handleHomeEndKeys
              renderOption={(props, option) => {
                const item = sourceBranchEntryMap.get(option);
                return (
                  <Box component="li" {...props} sx={{ px: 1.2, py: 0.7 }}>
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
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder="选择或输入分支"
                  InputProps={{
                    ...params.InputProps,
                    disableUnderline: true,
                    sx: {
                      fontWeight: 800,
                      "& .MuiInputBase-input": { py: 0.2, px: 0 },
                    },
                    endAdornment: (
                      <InputAdornment position="end">
                        <Stack direction="row" spacing={0.2}>
                          {value.trim() ? (
                          <IconButton
                            size="small"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onParamChange(param.key, "")}
                            edge="end"
                            aria-label="清空分支"
                            title="清空分支"
                          >
                            <ClearIcon fontSize="small" />
                          </IconButton>
                          ) : null}
                          <IconButton
                            size="small"
                            onClick={onSyncBranches}
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
              )}
            />
          </FieldRow>
          <BuildValueWarning
            message={invalidMessage}
            disabled={contextBlocked}
            onReset={handleResetParam}
          />
        </Stack>
      );
    }

    if (param.kind === "boolean") {
      return (
        <Stack key={param.key} spacing={0.55}>
          <BooleanRow
            param={param}
            value={value}
            disabled={contextBlocked}
            onChange={(nextValue) => onParamChange(param.key, nextValue)}
          />
          <BuildValueWarning
            message={invalidMessage}
            disabled={contextBlocked}
            onReset={handleResetParam}
          />
        </Stack>
      );
    }

    return (
      <Stack key={param.key} spacing={0.55}>
        <FieldRow label={param.label}>
          <TextField
            fullWidth
            variant="standard"
            value={value}
            disabled={contextBlocked}
            onChange={(event) => onParamChange(param.key, event.target.value)}
            InputProps={{
              disableUnderline: true,
              sx: {
                fontWeight: 800,
                "& .MuiInputBase-input": { py: 0.2, px: 0 },
              },
            }}
          />
        </FieldRow>
        <BuildValueWarning
          message={invalidMessage}
          disabled={contextBlocked}
          onReset={handleResetParam}
        />
      </Stack>
    );
  }

  return (
    <Box className="workspace workspace--workflow" onKeyDown={handlePrimaryEnter}>
      <Box className="workflow-module workflow-module--control">
          <Stack spacing={0.75}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 0.65,
              }}
            >
              <FieldRow label="项目">
                <FormControl fullWidth variant="standard">
                  <Select
                    value={selectedProject}
                    variant="standard"
                    onChange={(event: SelectChangeEvent<string>) => onProjectChange(event.target.value)}
                    sx={{
                      "&:before, &:after": { display: "none" },
                      "& .MuiSelect-select": {
                        py: 0.2,
                        pl: 0,
                        pr: "28px !important",
                        fontWeight: 800,
                      },
                    }}
                  >
                    {projects.map((project) => (
                      <MenuItem key={project.key} value={project.key}>
                        {project.name} ({project.key})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </FieldRow>

              {targetOptions.length > 1 ? (
                <Stack spacing={0.55}>
                  <FieldRow label="配置">
                    <FormControl fullWidth variant="standard">
                      <Select
                        value={targetValueInvalid ? "" : target}
                        variant="standard"
                        disabled={contextLoading}
                        onChange={(event: SelectChangeEvent<string>) => onTargetChange(event.target.value)}
                        sx={{
                          "&:before, &:after": { display: "none" },
                          "& .MuiSelect-select": {
                            py: 0.2,
                            pl: 0,
                            pr: "28px !important",
                            fontWeight: 800,
                          },
                        }}
                      >
                        {targetValueInvalid ? (
                          <MenuItem value="" disabled>
                            {target}
                          </MenuItem>
                        ) : null}
                        {targetOptions.map((item) => (
                          <MenuItem key={item.key} value={item.key}>
                            {item.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </FieldRow>
                  <BuildValueWarning
                    message={
                      targetValueInvalid
                        ? `${actionCopy.config}不在当前项目配置中：${target}`
                        : ""
                    }
                    disabled={contextLoading}
                    onReset={() => onTargetChange(targetOptions[0]?.key ?? "")}
                  />
                </Stack>
              ) : null}
            </Box>

            {contextError && contextErrorText ? (
              <InlineWarningNotice title={contextErrorText} />
            ) : null}

            {contextLoading ? (
              <Stack spacing={1}>
                <Skeleton variant="rounded" height={46} />
                <Skeleton variant="rounded" height={46} />
              </Stack>
            ) : visibleParams.length > 0 ? (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 0.65,
                }}
              >
                {visibleParams.map(renderParam)}
              </Box>
            ) : null}

            {visibleParams.some((param) => param.kind === "branch") ? (
              <Typography variant="caption" color="text.secondary">
                {branchSyncText} {sourceBranchEntries.some((item) => item.updatedTs > 0) ? " · 已按最近活跃排序" : ""}
              </Typography>
            ) : null}

            <Button
              variant="contained"
              onClick={onTriggerBuild}
              disabled={contextBlocked}
              size="medium"
              sx={{
                mt: 0.1,
                minHeight: 34,
                borderRadius: "11px",
                width: "100%",
              }}
            >
              {actionCopy.start}
            </Button>
          </Stack>
      </Box>

      {buildResult ? (
      <Box className="workflow-panel workflow-result-panel">
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={0.8}
            flexWrap="wrap"
            rowGap={0.45}
            minWidth={0}
            mb={resultExpanded ? 0.8 : 0}
          >
            <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 700 }}>
              结果
            </Typography>
            <Stack direction="row" spacing={0.55} alignItems="center" flexWrap="wrap" rowGap={0.4} justifyContent="flex-end">
              <IconButton onClick={onRefreshBuild} disabled={!canRefreshBuild} size="small" title={`刷新${actionCopy.noun}状态`}>
                <RefreshIcon fontSize="small" />
              </IconButton>
              {isLocalBuildPlan ? (
                <>
                  <IconButton
                    onClick={openLocalBuildLog}
                    disabled={!localBuildProjectKey || runtimeLogLoading}
                    size="small"
                    title="查看构建日志"
                  >
                    <TerminalIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    onClick={stopLocalBuild}
                    disabled={!buildResultActive || localBuildAction === "stop"}
                    size="small"
                    title="停止本地构建"
                  >
                    <StopIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    onClick={openLocalBuildOutput}
                    disabled={!localBuildProjectKey || localBuildAction === "output"}
                    size="small"
                    title="打开产物目录"
                  >
                    <FolderIcon fontSize="small" />
                  </IconButton>
                </>
              ) : null}
              <IconButton onClick={onOpenBuildRecord} disabled={!buildResult?.queueUrl && !buildResult?.buildUrl} size="small" title="打开构建记录页">
                <OpenExternalIcon fontSize="small" />
              </IconButton>
              <BuildStatusFreshness
                updatedAtMs={buildResultUpdatedAtMs}
                nowMs={nowMs}
                active={buildResultActive}
                timedOut={buildAutoRefreshTimedOut}
                canRefresh={canRefreshBuild}
                onRefresh={onRefreshBuild}
              />
              <IconButton size="small" onClick={() => setResultExpanded((current) => !current)} title={resultExpanded ? `收起${actionCopy.noun}结果` : `展开${actionCopy.noun}结果`}>
                {resultExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
          <Collapse in={resultExpanded} timeout="auto" unmountOnExit>
              <Stack spacing={0.1} minWidth={0}>
                <BuildResultRow label="状态" value={buildResult.stateLabel} />
                <BuildResultRow
                  label={plan?.adapter === "jenkins" ? "HTTP" : "退出码"}
                  value={buildResult.status}
                />
                <BuildResultLinkRow
                  label="队列"
                  value={buildResult.queueUrl}
                  copyKey="queueUrl"
                  copied={copiedResultField === "queueUrl"}
                  onCopy={copyResultValue}
                  onOpen={onOpenBuildUrl}
                />
                <BuildResultLinkRow
                  label="构建"
                  value={buildResult.buildUrl}
                  copyKey="buildUrl"
                  copied={copiedResultField === "buildUrl"}
                  onCopy={copyResultValue}
                  onOpen={onOpenBuildUrl}
                />
                <BuildResultRow
                  label="说明"
                  value={buildResult.detail}
                  copyKey="detail"
                  copied={copiedResultField === "detail"}
                  onCopy={copyResultValue}
                />
              </Stack>
          </Collapse>
      </Box>
      ) : null}

      <Box className="workflow-panel workflow-history-panel">
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8} flexWrap="wrap" rowGap={0.45} minWidth={0} mb={historyExpanded ? 0.8 : 0}>
            <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 700 }}>
              记录
            </Typography>
            <Stack direction="row" spacing={0.55} alignItems="center" flexWrap="wrap" rowGap={0.4} justifyContent="flex-end">
              <WorkflowLinkSummaryButton
                count={workflowReceiveGroups.length}
                onClick={() => setWorkflowListOpen(true)}
              />
              <IconButton size="small" onClick={onRefreshBuildHistory} title={`刷新${actionCopy.noun}记录`}>
                <RefreshIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={onClearBuildHistory} title={`清空${actionCopy.noun}记录`}>
                <TrashIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setHistoryExpanded((current) => !current)} title={historyExpanded ? `收起${actionCopy.noun}记录` : `展开${actionCopy.noun}记录`}>
                {historyExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
          <Collapse in={historyExpanded} timeout="auto" unmountOnExit>
            {buildHistory.length > 0 ? (
              <Stack className="workflow-history-content" spacing={0.65} minWidth={0}>
                <Box className="module-list-scroll">
                  <Stack spacing={0.65} minWidth={0}>
                    {visibleBuildHistoryGroups.map((group) => {
                      const item = group.latest;
                      const isGrouped = group.items.length > 1;
                      const groupExpanded = expandedHistoryGroups.has(group.id);
                      const workflowSignalIds = workflowSignalIdsForBuildReplay(item);
                      const historyTargetMeta = targetMetaByKey.get(item.mode);
                      const historyActionCopy = buildActionCopy(historyTargetMeta?.actionKind);
                      const targetLabel = historyTargetMeta?.label ?? item.mode;
                      const trayAction = buildTrayActionFromHistory(
                        item,
                        targetLabel,
                        historyActionCopy.noun,
                      );
                      const groupPinnedAction = pinnedActionForBuildGroup(group);
                      const pinned = Boolean(groupPinnedAction);
                      const paramMetaLabels = buildHistoryParamMetaLabels(
                        item,
                        paramMetaByKey,
                        defaultParamValues,
                      );
                      return (
                        <HistoryCard
                          key={group.id}
                          title={`${item.projectName} / ${targetLabel || "默认配置"}`}
                          subtitle={`${item.stateLabel} · ${formatRelativeTime(item.updatedAt)}`}
                          pinned={pinned}
                          badge={
                            <Stack
                              direction="row"
                              spacing={0.4}
                              alignItems="center"
                              flexWrap="wrap"
                              rowGap={0.4}
                              justifyContent="flex-end"
                            >
                              <IconButton
                                size="small"
                                onClick={() => onReplayBuildHistory(item)}
                                disabled={Boolean(busy)}
                                aria-label={`重播${historyActionCopy.noun}`}
                                title="使用相同参数重播"
                              >
                                <ReplayIcon fontSize="small" />
                              </IconButton>
                              <WorkflowLinkButton
                                active={workflowSignalIds.length > 0}
                                onClick={() => openWorkflowReceiveDialog(item)}
                              />
                              {item.buildUrl ? (
                                <IconButton
                                  size="small"
                                  onClick={() => onOpenBuildUrl(item.buildUrl!)}
                                  aria-label="打开构建"
                                  title="打开构建"
                                >
                                  <OpenExternalIcon fontSize="small" />
                                </IconButton>
                              ) : null}
                              <IconButton
                                size="small"
                                onClick={() =>
                                  groupPinnedAction
                                    ? handleRemovePinned(groupPinnedAction.dedupeKey)
                                    : handleTogglePinned(trayAction)
                                }
                                color={pinned ? "primary" : "default"}
                                aria-label={pinned ? "取消标记" : "标记记录"}
                                title={pinned ? "取消标记" : "标记记录"}
                                sx={
                                  pinned
                                    ? {
                                        bgcolor: "primary.main",
                                        color: "primary.contrastText",
                                        borderColor: "primary.main",
                                        "&:hover": {
                                          bgcolor: "primary.dark",
                                        },
                                      }
                                    : undefined
                                }
                              >
                                <StarIcon fontSize="small" />
                              </IconButton>
                              {isGrouped ? (
                                <IconButton
                                  size="small"
                                  onClick={() => toggleHistoryGroup(group.id)}
                                  aria-label={groupExpanded ? `收起同参数${historyActionCopy.noun}` : `展开同参数${historyActionCopy.noun}`}
                                  title={groupExpanded ? `收起同参数${historyActionCopy.noun}` : `展开同参数${historyActionCopy.noun}`}
                                >
                                  {groupExpanded ? (
                                    <CollapseIcon fontSize="small" />
                                  ) : (
                                    <ExpandIcon fontSize="small" />
                                  )}
                                </IconButton>
                              ) : null}
                            </Stack>
                          }
                          detail={item.detail}
                          meta={[
                            isGrouped ? `连续 ${group.items.length} 次` : "",
                            item.env,
                            item.branch,
                            ...paramMetaLabels,
                          ].filter(Boolean)}
                        >
                          {isGrouped ? (
                            <Collapse in={groupExpanded} timeout="auto" unmountOnExit>
                              <Stack
                                spacing={0.6}
                                sx={(theme) => ({
                                  mt: 0.45,
                                  pt: 0.25,
                                  color: "text.secondary",
                                  "& .history-row": {
                                    borderRadius: "12px",
                                    px: 0.9,
                                    py: 0.65,
                                    bgcolor:
                                      theme.palette.mode === "dark"
                                        ? "rgba(255,255,255,0.012)"
                                        : "rgba(31,37,48,0.025)",
                                  },
                                })}
                              >
                                {group.items.map((historyItem, index) => (
                                  <Box className="history-row" key={historyItem.historyKey}>
                                    <Stack direction="row" spacing={1} alignItems="center" minWidth={0} maxWidth="100%">
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ flexShrink: 0, fontWeight: 800 }}
                                      >
                                        {index === 0 ? "最新" : `第 ${index + 1} 次`}
                                      </Typography>
                                      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                                        {historyItem.stateLabel} · {historyItem.detail}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                                        {formatRelativeTime(historyItem.updatedAt)}
                                      </Typography>
                                    </Stack>
                                  </Box>
                                ))}
                              </Stack>
                            </Collapse>
                          ) : null}
                        </HistoryCard>
                      );
                    })}
                  </Stack>
                </Box>
                {historyPageCount > 1 ? (
                  <Stack direction="row" justifyContent="flex-end" sx={{ pt: 0.25 }}>
                    <Pagination
                      size="small"
                      page={historyPage}
                      count={historyPageCount}
                      siblingCount={0}
                      boundaryCount={1}
                      onChange={(_, nextPage) => setHistoryPage(nextPage)}
                      sx={{
                        "& .MuiPaginationItem-root": {
                          minWidth: 26,
                          height: 26,
                          borderRadius: "9px",
                          fontWeight: 800,
                        },
                      }}
                    />
                  </Stack>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无{actionCopy.noun}记录。
              </Typography>
            )}
          </Collapse>
      </Box>

      <Dialog
        open={runtimeLogOpen}
        onClose={() => setRuntimeLogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>构建日志</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.2}>
            {runtimeLogPath ? (
              <Typography variant="caption" color="text.secondary" noWrap title={runtimeLogPath}>
                {runtimeLogPath}
              </Typography>
            ) : null}
            {runtimeLogError ? <InlineWarningNotice title={runtimeLogError} /> : null}
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.4,
                minHeight: 220,
                maxHeight: "54vh",
                overflow: "auto",
                borderRadius: "14px",
                border: "1px solid rgba(148, 163, 184, 0.22)",
                bgcolor: "rgba(2, 6, 23, 0.28)",
                color: "text.primary",
                fontSize: "0.78rem",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {runtimeLogLoading
                ? "加载中..."
                : runtimeLogLines.length > 0
                  ? runtimeLogLines.join("\n")
                  : "暂无构建日志。"}
            </Box>
            {runtimeLogTruncated ? (
              <Typography variant="caption" color="text.secondary">
                已显示最后 {runtimeLogLines.length} 行
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuntimeLogOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <WorkflowRulesConfigDialog
        open={workflowOpen}
        title="联动配置"
        context={
          workflowEntry ? (
            <Stack direction="row" flexWrap="wrap" gap={0.7}>
              <Chip size="small" label={workflowEntry.projectName} />
              <Chip size="small" label={workflowEntry.mode} variant="outlined" />
              {workflowEntry.env ? (
                <Chip size="small" label={workflowEntry.env} variant="outlined" />
              ) : null}
              {workflowEntry.branch ? (
                <Chip size="small" label={workflowEntry.branch} variant="outlined" />
              ) : null}
            </Stack>
          ) : null
        }
        receiveSignalIds={
          workflowEntry ? workflowSignalIdsForBuildReplay(workflowEntry) : []
        }
        broadcastSignalIds={[]}
        signalOptions={workflowSignalOptions}
        signalSummaries={workflowSignalSummaries}
        showBroadcast={false}
        onDeleteSignal={onWorkflowSignalDelete}
        onClearSignals={onWorkflowSignalsClear}
        onClose={() => setWorkflowOpen(false)}
        onSave={({ receiveSignalIds }) => {
          if (workflowEntry) {
            onWorkflowBuildReplayReceiversChange(workflowEntry, receiveSignalIds);
          }
          setWorkflowOpen(false);
        }}
      />
      <WorkflowLinksDialog
        open={workflowListOpen}
        title="联动清单"
        items={workflowReceiveGroups}
        onClose={() => setWorkflowListOpen(false)}
        onEnabledChange={(item, enabled) =>
          onWorkflowReceiveRulesEnabledChange(item.ruleIds, enabled)
        }
        onDelete={(item) => onWorkflowReceiveRulesDelete(item.ruleIds)}
        onClearAll={(items) => {
          const ruleIds = items.flatMap((item) => item.ruleIds);
          if (ruleIds.length > 0) {
            onWorkflowReceiveRulesDelete(ruleIds);
          }
        }}
      />
    </Box>
  );
}

function formatBranchUpdatedAt(item?: BranchOption) {
  if (!item?.updatedAt) {
    return "";
  }
  return item.updatedAt.replace("T", " ").slice(0, 16);
}
