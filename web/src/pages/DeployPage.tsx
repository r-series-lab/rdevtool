import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
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
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import type { BranchOption, DeployHistoryEntry } from "../app-types";
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
  OpenExternalIcon,
  RefreshIcon,
  ReplayIcon,
  StarIcon,
  TrashIcon,
} from "../components/AppIcons";
import { groupConsecutiveBy, stableStringify } from "../lib/historyGroups";
import { shouldHandlePrimaryEnter } from "../lib/keyboard";
import type { TrayPinnedAction } from "../lib/trayPins";
import { useTrayPinnedActions } from "../hooks/useTrayPinnedActions";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";
import type {
  DeployParamMeta,
  DeployPlan,
  DeployTargetMeta,
  DeployTargetSummary,
} from "../hooks/useDeployContext";
import {
  type WorkflowReceiveRule,
} from "../lib/workflowSignals";

type ProjectOption = {
  key: string;
  name: string;
  deployTargets: DeployTargetSummary[];
};

type BuildResult = {
  status?: number;
  queueUrl?: string | null;
  buildUrl?: string | null;
  stateKey: string;
  stateLabel: string;
  detail: string;
};

const HISTORY_PAGE_SIZE = 5;
const BUILD_STATUS_STALE_MS = 45_000;
const BUILD_STATUS_CLOCK_INTERVAL_MS = 15_000;
const DEPLOY_HISTORY_PARAM_PREVIEW_LIMIT = 5;
const DEPLOY_ENV_PARAM_KEYS = new Set(["ENV_PROFILE", "projectEnv", "env"]);
const DEPLOY_BRANCH_PARAM_KEYS = new Set(["BRANCH", "branch", "Branch"]);
const SENSITIVE_DEPLOY_PARAM_PATTERN = /(token|secret|password|passwd|pwd|credential|auth|private)/i;

function isActiveBuildState(stateKey?: string | null) {
  return stateKey === "accepted" || stateKey === "queued" || stateKey === "running";
}

function deployHistorySignature(item: DeployHistoryEntry) {
  return stableStringify({
    projectKey: item.projectKey,
    mode: item.mode,
    env: item.env,
    branch: item.branch,
    params: item.params ?? {},
  });
}

function normalizeDeployHistoryParams(params?: Record<string, string> | null) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    normalized[key] = value == null ? "" : String(value);
  }
  return normalized;
}

function deployTrayDedupeKeyFromHistory(item: DeployHistoryEntry) {
  return `deploy.replay:${stableStringify({
    historyKey: item.historyKey,
    projectKey: item.projectKey,
    mode: item.mode || "",
    params: normalizeDeployHistoryParams(item.params),
  })}`;
}

function deployLegacyTrayDedupeKeyFromHistory(item: DeployHistoryEntry) {
  return `deploy.replay:${stableStringify({
    projectKey: item.projectKey,
    mode: item.mode || "",
    params: normalizeDeployHistoryParams(item.params),
  })}`;
}

function deployTrayActionFromHistory(
  item: DeployHistoryEntry,
  targetLabel: string,
): TrayPinnedAction {
  const params = normalizeDeployHistoryParams(item.params);
  return {
    kind: "deploy.replay",
    label: `部署：${item.projectName} / ${targetLabel || item.mode || "默认配置"}`,
    detail: [item.env, item.branch].filter(Boolean).join(" · ") || item.stateLabel,
    projectKey: item.projectKey,
    entry: null,
    payload: {
      project: item.projectKey,
      target: item.mode || null,
      params,
    },
    dedupeKey: deployTrayDedupeKeyFromHistory(item),
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
        gridTemplateColumns: { xs: "82px minmax(0, 1fr)", sm: "104px minmax(0, 1fr)" },
        alignItems: "center",
        gap: { xs: 0.75, sm: 1 },
        minWidth: 0,
        minHeight: 42,
        px: { xs: 0.9, sm: 1 },
        py: 0.55,
        borderRadius: "13px",
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
  param: DeployParamMeta;
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

type DeployValueWarningProps = {
  message: string;
  disabled: boolean;
  onReset: () => void;
};

function DeployValueWarning({
  message,
  disabled,
  onReset,
}: DeployValueWarningProps) {
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

function deployParamResetValue(
  param: DeployParamMeta,
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

function deployParamInvalidMessage(
  param: DeployParamMeta,
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

type DeployResultRowProps = {
  label: string;
  value?: string | number | null;
  copyKey?: string;
  copied?: boolean;
  onCopy?: (field: string, value?: string | number | null) => void;
};

function DeployResultRow({
  label,
  value,
  copyKey,
  copied = false,
  onCopy,
}: DeployResultRowProps) {
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

type DeployResultLinkRowProps = {
  label: string;
  value?: string | null;
  copyKey: string;
  copied: boolean;
  onCopy: (field: string, value?: string | number | null) => void;
  onOpen: (url: string) => void;
};

function DeployResultLinkRow({
  label,
  value,
  copyKey,
  copied,
  onCopy,
  onOpen,
}: DeployResultLinkRowProps) {
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

type DeployHistoryParamEntry = {
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

function deployHistoryParamLabel(key: string, param?: DeployParamMeta) {
  if (param?.label) {
    return param.label;
  }
  if (DEPLOY_ENV_PARAM_KEYS.has(key)) {
    return "环境";
  }
  if (DEPLOY_BRANCH_PARAM_KEYS.has(key)) {
    return "分支";
  }
  return key;
}

function shouldMaskDeployHistoryParam(key: string, param?: DeployParamMeta) {
  return param?.kind === "hidden" || SENSITIVE_DEPLOY_PARAM_PATTERN.test(key);
}

function shouldSkipDeployHistoryParam(
  item: DeployHistoryEntry,
  key: string,
  value: string,
) {
  const normalizedValue = value.trim();
  if (DEPLOY_ENV_PARAM_KEYS.has(key) && item.env && normalizedValue === item.env.trim()) {
    return true;
  }
  if (
    DEPLOY_BRANCH_PARAM_KEYS.has(key) &&
    item.branch &&
    normalizedValue === item.branch.trim()
  ) {
    return true;
  }
  return false;
}

function buildDeployHistoryParamEntries(
  item: DeployHistoryEntry,
  paramMetaByKey: Map<string, DeployParamMeta>,
  defaultParamValues: Record<string, string>,
): DeployHistoryParamEntry[] {
  return Object.entries(item.params ?? {})
    .filter(([key, value]) => !shouldSkipDeployHistoryParam(item, key, String(value ?? "")))
    .map(([key, value]) => {
      const param = paramMetaByKey.get(key);
      const textValue = String(value ?? "");
      const defaultKnown = hasRecordValue(defaultParamValues, key) || Boolean(param);
      const defaultValue = hasRecordValue(defaultParamValues, key)
        ? defaultParamValues[key]
        : param?.defaultValue ?? "";
      const hidden = shouldMaskDeployHistoryParam(key, param);
      return {
        key,
        label: deployHistoryParamLabel(key, param),
        valueLabel: hidden ? (textValue ? "已配置" : "未配置") : textValue || "-",
        hidden,
        changed: defaultKnown && textValue !== defaultValue,
        defaultKnown,
      };
    });
}

function buildDeployHistoryParamMetaLabels(
  item: DeployHistoryEntry,
  paramMetaByKey: Map<string, DeployParamMeta>,
  defaultParamValues: Record<string, string>,
) {
  const entries = buildDeployHistoryParamEntries(item, paramMetaByKey, defaultParamValues);
  if (entries.length === 0) {
    return [];
  }

  const visibleEntries = entries.slice(0, DEPLOY_HISTORY_PARAM_PREVIEW_LIMIT);
  const extraCount = Math.max(0, entries.length - visibleEntries.length);
  const labels = visibleEntries.map((entry) => `${entry.label}: ${entry.valueLabel}`);
  return extraCount > 0 ? [...labels, `+${extraCount}`] : labels;
}

export type DeployPageProps = {
  projects: ProjectOption[];
  selectedProject: string;
  onProjectChange: (projectKey: string) => void;
  target: string;
  onTargetChange: (value: string) => void;
  targetMeta: DeployTargetMeta | null;
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
  plan: DeployPlan | null;
  buildResult: BuildResult | null;
  buildResultUpdatedAtMs: number;
  buildAutoRefreshTimedOut: boolean;
  onRefreshBuild: () => void;
  onOpenBuildRecord: () => void;
  onOpenBuildUrl: (url: string) => void;
  deployHistory: DeployHistoryEntry[];
  onReplayDeployHistory: (entry: DeployHistoryEntry) => void;
  workflowReceiveRules: WorkflowReceiveRule[];
  workflowSignalIdsForDeployReplay: (entry: DeployHistoryEntry) => string[];
  workflowSignalOptions: string[];
  workflowSignalSummaries: WorkflowSignalSummary[];
  onWorkflowDeployReplayReceiversChange: (
    entry: DeployHistoryEntry,
    signalIds: string[],
  ) => void;
  onWorkflowReceiveRulesEnabledChange: (ruleIds: string[], enabled: boolean) => void;
  onWorkflowReceiveRulesDelete: (ruleIds: string[]) => void;
  onWorkflowSignalDelete: (signalId: string) => void;
  onWorkflowSignalsClear: () => void;
  onRefreshDeployHistory: () => void;
  onClearDeployHistory: () => void;
  formatRelativeTime: (value?: string) => string;
};

export function DeployPage({
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
  deployHistory,
  onReplayDeployHistory,
  workflowReceiveRules,
  workflowSignalIdsForDeployReplay,
  workflowSignalOptions,
  workflowSignalSummaries,
  onWorkflowDeployReplayReceiversChange,
  onWorkflowReceiveRulesEnabledChange,
  onWorkflowReceiveRulesDelete,
  onWorkflowSignalDelete,
  onWorkflowSignalsClear,
  onRefreshDeployHistory,
  onClearDeployHistory,
  formatRelativeTime,
}: DeployPageProps) {
  const [resultExpanded, setResultExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowEntry, setWorkflowEntry] = useState<DeployHistoryEntry | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [copiedResultField, setCopiedResultField] = useState("");
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const {
    scopedActions: pinnedDeployActions,
    togglePinned,
    removePinned,
    replacePinnedActions,
  } = useTrayPinnedActions("deploy.replay");
  const deployHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, DeployHistoryEntry>();
    for (const item of deployHistory) {
      const key = deployTrayDedupeKeyFromHistory(item);
      if (!next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [deployHistory]);
  const deployLegacyHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, DeployHistoryEntry>();
    for (const item of deployHistory) {
      const key = deployLegacyTrayDedupeKeyFromHistory(item);
      if (!next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [deployHistory]);
  const deploySpecificLegacyPinnedKeys = useMemo(() => {
    const next = new Set<string>();
    for (const action of pinnedDeployActions) {
      const item = deployHistoryByPinnedKey.get(action.dedupeKey);
      if (item) {
        next.add(deployLegacyTrayDedupeKeyFromHistory(item));
      }
    }
    return next;
  }, [deployHistoryByPinnedKey, pinnedDeployActions]);
  const duplicateLegacyDeployPinnedKeys = useMemo(
    () =>
      pinnedDeployActions
        .filter(
          (action) =>
            deployLegacyHistoryByPinnedKey.has(action.dedupeKey) &&
            deploySpecificLegacyPinnedKeys.has(action.dedupeKey),
        )
        .map((action) => action.dedupeKey)
        .sort(),
    [deployLegacyHistoryByPinnedKey, deploySpecificLegacyPinnedKeys, pinnedDeployActions],
  );
  const duplicateLegacyDeployPinnedKeySignature =
    duplicateLegacyDeployPinnedKeys.join("\n");
  useEffect(() => {
    if (!duplicateLegacyDeployPinnedKeySignature) {
      return;
    }
    const duplicateKeys = new Set(duplicateLegacyDeployPinnedKeySignature.split("\n"));
    replacePinnedActions((actions) =>
      actions.filter((action) => !duplicateKeys.has(action.dedupeKey)),
    ).catch((error) => {
      console.error("failed to prune legacy deploy pinned actions", error);
    });
  }, [duplicateLegacyDeployPinnedKeySignature, replacePinnedActions]);
  const displayPinnedDeployActions = useMemo(
    () =>
      pinnedDeployActions.filter((action) => {
        if (deployHistoryByPinnedKey.has(action.dedupeKey)) {
          return true;
        }
        return (
          deployLegacyHistoryByPinnedKey.has(action.dedupeKey) &&
          !deploySpecificLegacyPinnedKeys.has(action.dedupeKey)
        );
      }),
    [
      deployHistoryByPinnedKey,
      deployLegacyHistoryByPinnedKey,
      deploySpecificLegacyPinnedKeys,
      pinnedDeployActions,
    ],
  );
  const pinnedActionOrder = useMemo(
    () =>
      new Map(
        displayPinnedDeployActions.map((action, index) => [action.dedupeKey, index]),
      ),
    [displayPinnedDeployActions],
  );
  const pinnedActionByKey = useMemo(
    () =>
      new Map(
        displayPinnedDeployActions.map((action) => [action.dedupeKey, action]),
      ),
    [displayPinnedDeployActions],
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
  const targetOptions = targetMeta?.targets.length
    ? targetMeta.targets
    : projects.find((project) => project.key === selectedProject)?.deployTargets ?? [];
  const targetOptionKeys = targetOptions.map((item) => item.key);
  const targetValueInvalid = Boolean(
    target && targetOptionKeys.length > 0 && !targetOptionKeys.includes(target),
  );
  const contextBlocked = contextLoading || contextError;
  const canRefreshBuild = Boolean(buildResult?.queueUrl || buildResult?.buildUrl);
  const buildResultActive = isActiveBuildState(buildResult?.stateKey);
  const groupedDeployHistory = useMemo(
    () =>
      groupConsecutiveBy(
        deployHistory,
        deployHistorySignature,
        (item) => item.historyKey,
      ),
    [deployHistory],
  );
  function pinnedOrderForDeployGroup(group: (typeof groupedDeployHistory)[number]) {
    let order: number | undefined;
    for (const item of group.items) {
      const itemOrder = pinnedActionOrder.get(deployTrayDedupeKeyFromHistory(item));
      if (itemOrder !== undefined) {
        order = order === undefined ? itemOrder : Math.min(order, itemOrder);
      }
    }
    if (order !== undefined) {
      return order;
    }
    return pinnedActionOrder.get(deployLegacyTrayDedupeKeyFromHistory(group.latest));
  }

  const sortedDeployHistoryGroups = useMemo(() => {
    const originalOrder = new Map(
      groupedDeployHistory.map((group, index) => [group.id, index]),
    );
    return [...groupedDeployHistory].sort((left, right) => {
      const leftPinnedOrder = pinnedOrderForDeployGroup(left);
      const rightPinnedOrder = pinnedOrderForDeployGroup(right);
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
  }, [groupedDeployHistory, pinnedActionOrder]);
  const pinnedDeployHistoryGroups = useMemo(
    () =>
      sortedDeployHistoryGroups.filter(
        (group) => pinnedOrderForDeployGroup(group) !== undefined,
      ),
    [pinnedActionOrder, sortedDeployHistoryGroups],
  );
  const unpinnedDeployHistoryGroups = useMemo(
    () =>
      sortedDeployHistoryGroups.filter(
        (group) => pinnedOrderForDeployGroup(group) === undefined,
      ),
    [pinnedActionOrder, sortedDeployHistoryGroups],
  );
  function pinnedActionForDeployGroup(group: (typeof groupedDeployHistory)[number]) {
    let pinnedAction: TrayPinnedAction | null = null;
    let pinnedOrder = Number.POSITIVE_INFINITY;
    for (const item of group.items) {
      const key = deployTrayDedupeKeyFromHistory(item);
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
    const legacyKey = deployLegacyTrayDedupeKeyFromHistory(group.latest);
    return pinnedActionByKey.get(legacyKey) ?? null;
  }
  const historyPageCount = Math.max(
    1,
    Math.ceil(unpinnedDeployHistoryGroups.length / HISTORY_PAGE_SIZE),
  );
  const pagedDeployHistoryGroups = useMemo(
    () =>
      unpinnedDeployHistoryGroups.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [historyPage, unpinnedDeployHistoryGroups],
  );
  const visibleDeployHistoryGroups = useMemo(
    () => [...pinnedDeployHistoryGroups, ...pagedDeployHistoryGroups],
    [pagedDeployHistoryGroups, pinnedDeployHistoryGroups],
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
      const visibleIds = new Set(sortedDeployHistoryGroups.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [sortedDeployHistoryGroups]);

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

  function openWorkflowReceiveDialog(entry: DeployHistoryEntry) {
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

  function renderParam(param: DeployParamMeta) {
    const value = paramValues[param.key] ?? param.defaultValue ?? "";
    const invalidMessage = deployParamInvalidMessage(
      param,
      value,
      sourceBranchOptions,
    );
    const handleResetParam = () =>
      onParamChange(param.key, deployParamResetValue(param, sourceBranchOptions));
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
          <DeployValueWarning
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
          <DeployValueWarning
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
          <DeployValueWarning
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
        <DeployValueWarning
          message={invalidMessage}
          disabled={contextBlocked}
          onReset={handleResetParam}
        />
      </Stack>
    );
  }

  return (
    <Box className="workspace workspace--narrow" onKeyDown={handlePrimaryEnter}>
      <Card variant="outlined" sx={{ borderRadius: "20px", overflow: "hidden", minWidth: 0, maxWidth: "100%" }}>
        <CardContent>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{ mb: 1.5 }}
          >
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              部署
            </Typography>
          </Stack>

          <Stack spacing={1.05}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 0.8,
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
                  <DeployValueWarning
                    message={
                      targetValueInvalid
                        ? `部署配置不在当前项目配置中：${target}`
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
                  gap: 0.8,
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
                mt: 0.35,
                minHeight: 38,
                borderRadius: "13px",
                width: "100%",
              }}
            >
              开始部署
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: "20px", overflow: "hidden", minWidth: 0, maxWidth: "100%" }}>
        <CardContent>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
            flexWrap="wrap"
            rowGap={0.6}
            minWidth={0}
            mb={resultExpanded ? 1.2 : 0}
          >
            <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 700 }}>
              结果
            </Typography>
            <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" rowGap={0.5} justifyContent="flex-end">
              <IconButton onClick={onRefreshBuild} disabled={!buildResult?.queueUrl && !buildResult?.buildUrl} size="small" title="刷新部署状态">
                <RefreshIcon fontSize="small" />
              </IconButton>
              <IconButton onClick={onOpenBuildRecord} disabled={!buildResult?.queueUrl && !buildResult?.buildUrl} size="small" title="打开构建记录页">
                <OpenExternalIcon fontSize="small" />
              </IconButton>
              {buildResult ? (
                <BuildStatusFreshness
                  updatedAtMs={buildResultUpdatedAtMs}
                  nowMs={nowMs}
                  active={buildResultActive}
                  timedOut={buildAutoRefreshTimedOut}
                  canRefresh={canRefreshBuild}
                  onRefresh={onRefreshBuild}
                />
              ) : null}
              <IconButton size="small" onClick={() => setResultExpanded((current) => !current)} title={resultExpanded ? "收起部署结果" : "展开部署结果"}>
                {resultExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
          <Collapse in={resultExpanded} timeout="auto" unmountOnExit>
            {buildResult ? (
              <Stack spacing={0.1} minWidth={0}>
                <DeployResultRow label="状态" value={buildResult.stateLabel} />
                <DeployResultRow label="HTTP" value={buildResult.status} />
                <DeployResultLinkRow
                  label="队列"
                  value={buildResult.queueUrl}
                  copyKey="queueUrl"
                  copied={copiedResultField === "queueUrl"}
                  onCopy={copyResultValue}
                  onOpen={onOpenBuildUrl}
                />
                <DeployResultLinkRow
                  label="构建"
                  value={buildResult.buildUrl}
                  copyKey="buildUrl"
                  copied={copiedResultField === "buildUrl"}
                  onCopy={copyResultValue}
                  onOpen={onOpenBuildUrl}
                />
                <DeployResultRow
                  label="说明"
                  value={buildResult.detail}
                  copyKey="detail"
                  copied={copiedResultField === "detail"}
                  onCopy={copyResultValue}
                />
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                部署完成后，这里展示状态和 Jenkins 地址。
              </Typography>
            )}
          </Collapse>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: "20px", overflow: "hidden", minWidth: 0, maxWidth: "100%" }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" rowGap={0.6} minWidth={0} mb={historyExpanded ? 1.2 : 0}>
            <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 700 }}>
              记录
            </Typography>
            <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" rowGap={0.5} justifyContent="flex-end">
              <WorkflowLinkSummaryButton
                count={workflowReceiveGroups.length}
                onClick={() => setWorkflowListOpen(true)}
              />
              <IconButton size="small" onClick={onRefreshDeployHistory} title="刷新部署记录">
                <RefreshIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={onClearDeployHistory} title="清空部署记录">
                <TrashIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setHistoryExpanded((current) => !current)} title={historyExpanded ? "收起部署记录" : "展开部署记录"}>
                {historyExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
          <Collapse in={historyExpanded} timeout="auto" unmountOnExit>
            {deployHistory.length > 0 ? (
              <Stack spacing={1} minWidth={0}>
                {visibleDeployHistoryGroups.map((group) => {
                  const item = group.latest;
                  const isGrouped = group.items.length > 1;
                  const groupExpanded = expandedHistoryGroups.has(group.id);
                  const workflowSignalIds = workflowSignalIdsForDeployReplay(item);
                  const targetLabel = targetMetaByKey.get(item.mode)?.label ?? item.mode;
                  const trayAction = deployTrayActionFromHistory(item, targetLabel);
                  const groupPinnedAction = pinnedActionForDeployGroup(group);
                  const pinned = Boolean(groupPinnedAction);
                  const paramMetaLabels = buildDeployHistoryParamMetaLabels(
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
                            onClick={() => onReplayDeployHistory(item)}
                            disabled={Boolean(busy)}
                            aria-label="重播部署"
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
                              aria-label={groupExpanded ? "收起同参数部署" : "展开同参数部署"}
                              title={groupExpanded ? "收起同参数部署" : "展开同参数部署"}
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
                {historyPageCount > 1 ? (
                  <Stack direction="row" justifyContent="flex-end" sx={{ pt: 0.4 }}>
                    <Pagination
                      size="small"
                      page={historyPage}
                      count={historyPageCount}
                      siblingCount={0}
                      boundaryCount={1}
                      onChange={(_, nextPage) => setHistoryPage(nextPage)}
                      sx={{
                        "& .MuiPaginationItem-root": {
                          minWidth: 28,
                          height: 28,
                          borderRadius: "10px",
                          fontWeight: 800,
                        },
                      }}
                    />
                  </Stack>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无部署记录。
              </Typography>
            )}
          </Collapse>
        </CardContent>
      </Card>

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
          workflowEntry ? workflowSignalIdsForDeployReplay(workflowEntry) : []
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
            onWorkflowDeployReplayReceiversChange(workflowEntry, receiveSignalIds);
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
