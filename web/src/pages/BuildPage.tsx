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
  Menu,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import type {
  BranchOption,
  BuildHistoryEntry,
  CommitInfo,
  ProjectRuntimeLogResponse,
} from "../app-types";
import { HistoryCard, type HistoryAccent } from "../components/AppCards";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppListEndState } from "../components/AppListEndState";
import { WorkflowLinkSummaryButton } from "../components/WorkflowLinkButton";
import {
  WorkflowLinksDialog,
  type WorkflowLinkListItem,
} from "../components/WorkflowLinksDialog";
import { WorkflowRulesConfigDialog } from "../components/WorkflowRulesConfigDialog";
import { InlineWarningNotice } from "../components/InlineWarningNotice";
import {
  ClearIcon,
  CollapseIcon,
  ExpandIcon,
  FolderIcon,
  LocateIcon,
  MoreIcon,
  OpenExternalIcon,
  PackageIcon,
  RefreshIcon,
  ReplayIcon,
  SearchIcon,
  StarIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  WorkflowIcon,
} from "../components/AppIcons";
import { groupConsecutiveBy, stableStringify } from "../lib/historyGroups";
import {
  filterHistoryGroups,
  matchesBuildHistoryEntry,
  type BuildHistoryStatusFilter,
} from "../lib/historyRecordFilters";
import { shouldHandlePrimaryEnter } from "../lib/keyboard";
import { isOperationActiveState } from "../lib/operationLifecycle";
import type { TrayPinnedAction } from "../lib/trayPins";
import { useTrayPinnedActions } from "../hooks/useTrayPinnedActions";
import type { WorkflowSignalSummary } from "../hooks/useWorkflowSignals";
import type {
  BuildParamMeta,
  BuildPlan,
  BuildTargetMeta,
  BuildTargetSummary,
} from "../hooks/useBuildContext";
import { useI18n, type Translate } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";
import {
  translateBuildDetail,
  translateBuildParameterLabel,
} from "../lib/buildPresentation";
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

const HISTORY_SCROLL_PAGE_SIZE = 8;
const BUILD_HISTORY_CHANGED_PARAM_PREVIEW_LIMIT = 3;
const BUILD_ENV_PARAM_KEYS = new Set(["ENV_PROFILE", "projectEnv", "env"]);
const BUILD_BRANCH_PARAM_KEYS = new Set(["BRANCH", "branch", "Branch"]);
const SENSITIVE_BUILD_PARAM_PATTERN = /(token|secret|password|passwd|pwd|credential|auth|private)/i;

function buildHistoryAccent(item: BuildHistoryEntry): HistoryAccent {
  const state = item.stateKey.toLowerCase();
  if (isOperationActiveState(state)) {
    return "warning";
  }
  if (
    state.includes("success") ||
    state.includes("succeed") ||
    state.includes("done") ||
    state.includes("complete")
  ) {
    return "success";
  }
  if (
    state.includes("fail") ||
    state.includes("error") ||
    state.includes("abort") ||
    state.includes("cancel")
  ) {
    return "danger";
  }
  return "info";
}

function buildActionCopy(
  actionKind: string | null | undefined,
  t: Translate,
): BuildActionCopy {
  switch (actionKind) {
    case "build":
      return { noun: t("构建"), start: t("开始构建"), config: t("构建配置") };
    case "package":
      return {
        noun: t("产物构建"),
        start: t("开始产物构建"),
        config: t("产物构建配置"),
      };
    case "release":
      return { noun: t("发布"), start: t("开始发布"), config: t("发布配置") };
    case "deploy":
      return { noun: t("部署"), start: t("开始部署"), config: t("部署配置") };
    default:
      return { noun: t("构建"), start: t("开始构建"), config: t("构建配置") };
  }
}

export function BuildPlanCommitSummary({
  commit,
  changedPathCount,
  projectName = "",
  targetLabel = "",
  branch = "",
}: {
  commit: CommitInfo | null;
  changedPathCount: number;
  projectName?: string;
  targetLabel?: string;
  branch?: string;
}) {
  const { t } = useI18n();
  const revisionDetails = commit
    ? [
        commit.subject,
        t("提交于 {time}", { time: commit.committedAt }),
      ].filter(Boolean)
    : [];
  const rowSx = {
    minWidth: 0,
    fontSize: "0.72rem",
    fontWeight: 560,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  } as const;
  const labelSx = {
    color: "inherit",
    fontWeight: 650,
  } as const;
  const iconSx = {
    mt: "1px",
    color: "var(--activity-running)",
    fontSize: 15.5,
    flexShrink: 0,
  } as const;

  return (
    <Stack
      spacing={0.38}
      minWidth={0}
      data-build-plan-commit-summary="visible"
      sx={{ py: 0.3 }}
    >
      <Stack spacing={0.38} minWidth={0} data-build-plan-primary="visible">
        {projectName || targetLabel || branch ? (
          <Stack direction="row" spacing={0.65} alignItems="flex-start" minWidth={0}>
            <LocateIcon sx={iconSx} />
            <Typography variant="caption" color="text.secondary" sx={rowSx}>
              <Box component="span" sx={labelSx}>
                {t("计划：")}
              </Box>{" "}
              {projectName}
              {projectName && targetLabel ? " / " : ""}
              {targetLabel}
              {branch ? t(" · 分支 {branch}", { branch }) : ""}
            </Typography>
          </Stack>
        ) : null}
        <Stack direction="row" spacing={0.65} alignItems="flex-start" minWidth={0}>
          <PackageIcon sx={iconSx} />
          <Typography
            variant="caption"
            color={commit ? "text.secondary" : "warning.main"}
            sx={rowSx}
          >
            <Box component="span" sx={commit ? labelSx : undefined}>
              {t("目标提交：")}
            </Box>{" "}
            <Box
              component="span"
              sx={{
                fontFamily:
                  '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                fontWeight: 600,
              }}
            >
              {commit?.shortHash || t("未解析")}
            </Box>
            {changedPathCount > 0
              ? t(" · 检测到 {count} 个改动文件", {
                  count: changedPathCount,
                })
              : ""}
          </Typography>
        </Stack>
      </Stack>
      {commit ? (
        <Stack
          direction="row"
          spacing={0.7}
          alignItems="flex-start"
          minWidth={0}
          data-build-plan-revision="visible"
        >
          <WorkflowIcon sx={iconSx} />
          <Typography variant="caption" color="text.secondary" sx={rowSx}>
            {revisionDetails.join(" · ")}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
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

function workspacePinnedKey(workspaceKey: string | null | undefined, dedupeKey: string) {
  return `${workspaceKey?.trim() ?? ""}\n${dedupeKey}`;
}

function buildTrayActionFromHistory(
  item: BuildHistoryEntry,
  targetLabel: string,
  t: Translate,
  actionLabel = t("部署"),
): TrayPinnedAction {
  const params = normalizeBuildHistoryParams(item.params);
  return {
    kind: "build.replay",
    label: t("{action}：{project} / {target}", {
      action: actionLabel,
      project: item.projectName,
      target: targetLabel || item.mode || t("默认配置"),
    }),
    detail:
      [item.env, item.branch].filter(Boolean).join(" · ") ||
      translateInternalMessage(item.stateLabel, t),
    workspaceKey: item.workspaceKey ?? null,
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
  const { t } = useI18n();
  const checked = value === param.trueValue;
  return (
    <FieldRow label={translateBuildParameterLabel(param, t)}>
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
  t: Translate,
) {
  const currentValue = value.trim();
  const label = translateBuildParameterLabel(param, t);
  if (!currentValue) {
    return "";
  }
  if (
    param.kind === "branch" &&
    sourceBranchOptions.length > 0 &&
    !sourceBranchOptions.includes(currentValue)
  ) {
    return t("{label} 不在当前项目分支列表中：{value}", {
      label,
      value: currentValue,
    });
  }
  if (
    param.kind === "select" &&
    param.options.length > 0 &&
    !param.options.includes(currentValue)
  ) {
    return t("{label} 不在当前选项中：{value}", {
      label,
      value: currentValue,
    });
  }
  if (
    param.kind === "boolean" &&
    currentValue !== param.trueValue &&
    currentValue !== param.falseValue
  ) {
    return t("{label} 不是有效的开关值：{value}", {
      label,
      value: currentValue,
    });
  }
  return "";
}

export type BuildHistoryParamEntry = {
  key: string;
  label: string;
  valueLabel: string;
  defaultValueLabel: string;
  hidden: boolean;
  changed: boolean;
  defaultKnown: boolean;
};

function hasRecordValue(record: Record<string, string>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function buildHistoryParamLabel(
  key: string,
  t: Translate,
  param?: BuildParamMeta,
) {
  if (param?.label) {
    return translateBuildParameterLabel(param, t);
  }
  if (BUILD_ENV_PARAM_KEYS.has(key)) {
    return t("环境");
  }
  if (BUILD_BRANCH_PARAM_KEYS.has(key)) {
    return t("分支");
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

export function buildHistoryParamEntries(
  item: BuildHistoryEntry,
  paramMetaByKey: Map<string, BuildParamMeta>,
  defaultParamValues: Record<string, string>,
  t: Translate,
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
      const displayValue = (candidate: string) =>
        hidden
          ? candidate
            ? t("已配置")
            : t("未配置")
          : candidate || "-";
      return {
        key,
        label: buildHistoryParamLabel(key, t, param),
        valueLabel: displayValue(textValue),
        defaultValueLabel: defaultKnown ? displayValue(defaultValue) : "-",
        hidden,
        changed: defaultKnown && textValue !== defaultValue,
        defaultKnown,
      };
    });
}

export function BuildHistoryRecordDetail({
  detail,
  paramEntries,
  danger = false,
}: {
  detail: string;
  paramEntries: BuildHistoryParamEntry[];
  danger?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const changedEntries = paramEntries.filter((entry) => entry.changed);
  const previewEntries = changedEntries.slice(
    0,
    BUILD_HISTORY_CHANGED_PARAM_PREVIEW_LIMIT,
  );
  const hiddenChangedCount = Math.max(
    0,
    changedEntries.length - previewEntries.length,
  );
  const detailNeedsExpansion =
    detail.includes("\n") || Array.from(detail).length > 88;
  const canExpand = paramEntries.length > 0 || detailNeedsExpansion;

  return (
    <Stack
      className={`build-history-record-detail${expanded ? " is-expanded" : ""}${danger ? " is-danger" : ""}`}
      spacing={0.55}
      minWidth={0}
    >
      {detail ? (
        <Typography
          className="build-history-record-message"
          variant="caption"
          color={danger ? "error.main" : "text.secondary"}
          title={detail}
        >
          {detail}
        </Typography>
      ) : null}

      {!expanded && paramEntries.length > 0 ? (
        <Stack className="build-history-parameter-summary" spacing={0.42} minWidth={0}>
          <Typography
            className="build-history-parameter-summary-label"
            variant="caption"
            color="text.secondary"
          >
            {changedEntries.length > 0
              ? t("参数变更 {count} 项", { count: changedEntries.length })
              : t("执行参数 {count} 项", { count: paramEntries.length })}
          </Typography>
          {previewEntries.length > 0 ? (
            <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap" minWidth={0}>
              {previewEntries.map((entry) => (
                <Box
                  className="build-history-parameter-preview"
                  component="span"
                  key={entry.key}
                  title={`${entry.label}: ${entry.valueLabel}`}
                >
                  <Box component="span" className="build-history-parameter-preview-label">
                    {entry.label}
                  </Box>
                  <Box component="span" className="build-history-parameter-preview-value">
                    {entry.valueLabel}
                  </Box>
                </Box>
              ))}
              {hiddenChangedCount > 0 ? (
                <Typography
                  className="build-history-parameter-more"
                  variant="caption"
                  color="text.secondary"
                >
                  {t("还有 {count} 项变更", { count: hiddenChangedCount })}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        {paramEntries.length > 0 ? (
          <Box className="build-history-parameter-details">
            <Typography
              className="build-history-parameter-details-title"
              variant="caption"
              color="text.secondary"
            >
              {t("全部执行参数")}
            </Typography>
            <Box className="build-history-parameter-table">
              {paramEntries.map((entry) => (
                <Box
                  className={`build-history-parameter-row${entry.changed ? " is-changed" : ""}`}
                  key={entry.key}
                >
                  <Typography
                    className="build-history-parameter-name"
                    variant="caption"
                    title={entry.label}
                  >
                    {entry.label}
                  </Typography>
                  <Typography
                    className="build-history-parameter-value"
                    variant="caption"
                    title={entry.valueLabel}
                  >
                    {entry.valueLabel}
                  </Typography>
                  <Typography
                    className="build-history-parameter-default"
                    variant="caption"
                    color="text.secondary"
                    title={
                      entry.defaultKnown
                        ? t("默认：{value}", { value: entry.defaultValueLabel })
                        : t("默认值未知")
                    }
                  >
                    {entry.defaultKnown
                      ? t("默认：{value}", { value: entry.defaultValueLabel })
                      : t("默认值未知")}
                  </Typography>
                  {entry.changed ? (
                    <Chip
                      className="build-history-parameter-changed"
                      size="small"
                      variant="outlined"
                      color="primary"
                      label={t("已覆盖默认值")}
                    />
                  ) : null}
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}
      </Collapse>

      {canExpand ? (
        <Box className="build-history-detail-actions">
          <Button
            className="build-history-detail-toggle"
            size="small"
            variant="text"
            startIcon={expanded ? <CollapseIcon /> : <ExpandIcon />}
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
          >
            {t(expanded ? "收起详情" : "展开详情")}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}

export type BuildHistoryMenuAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
};

export function BuildHistoryMoreMenu({
  actions,
}: {
  actions: BuildHistoryMenuAction[];
}) {
  const { t } = useI18n();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (actions.length === 0) {
    return null;
  }

  const menuOpen = Boolean(anchorEl);
  const active = actions.some((action) => action.active);

  return (
    <>
      <IconButton
        className={active ? "build-history-more-trigger is-active" : "build-history-more-trigger"}
        size="small"
        color={active ? "primary" : "default"}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={t("更多操作")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={t("更多操作")}
      >
        <MoreIcon fontSize="small" />
      </IconButton>
      <Menu
        className="build-history-more-menu"
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {actions.map((action) => (
          <MenuItem
            className={action.active ? "is-active" : undefined}
            key={action.key}
            disabled={action.disabled}
            onClick={() => {
              setAnchorEl(null);
              action.onClick();
            }}
          >
            <Box className="build-history-more-menu-icon">{action.icon}</Box>
            <Typography variant="body2">{action.label}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function BuildHistoryRunTimeline({
  items,
  formatRelativeTime,
}: {
  items: BuildHistoryEntry[];
  formatRelativeTime: (value?: string) => string;
}) {
  const { t } = useI18n();

  return (
    <Box className="build-history-run-timeline">
      {items.map((item, index) => {
        const accent = buildHistoryAccent(item);
        const stateLabel = translateInternalMessage(item.stateLabel, t);
        const detail = translateBuildDetail(item.detail, t);
        return (
          <Box
            className={`build-history-run-row is-${accent}`}
            key={item.historyKey}
          >
            <Box className="build-history-run-marker" aria-hidden="true" />
            <Typography className="build-history-run-attempt" variant="caption">
              {index === 0
                ? t("最新")
                : t("第 {count} 次", { count: index + 1 })}
            </Typography>
            <Box className="build-history-run-body">
              <Typography
                className="build-history-run-state"
                variant="caption"
                title={stateLabel}
              >
                {stateLabel}
              </Typography>
              <Typography
                className="build-history-run-detail"
                variant="caption"
                color="text.secondary"
                title={detail}
              >
                {detail}
              </Typography>
            </Box>
            <Typography
              className="build-history-run-time"
              variant="caption"
              color="text.secondary"
              title={item.updatedAt}
            >
              {formatRelativeTime(item.updatedAt)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function buildHistoryEntriesReferToSameRun(
  left: BuildHistoryEntry,
  right: BuildHistoryEntry,
) {
  if (left.historyKey && left.historyKey === right.historyKey) {
    return true;
  }
  if (left.queueUrl && right.queueUrl && left.queueUrl === right.queueUrl) {
    return true;
  }
  if (left.buildUrl && right.buildUrl && left.buildUrl === right.buildUrl) {
    return true;
  }
  return false;
}

export type BuildPageProps = {
  projects: ProjectOption[];
  activeWorkspaceKey: string;
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
  currentBuildHistoryKey: string;
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
  activeWorkspaceKey,
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
  currentBuildHistoryKey,
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
  const { t } = useI18n();
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(
    HISTORY_SCROLL_PAGE_SIZE,
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] =
    useState<BuildHistoryStatusFilter>("all");
  const [historyModeFilter, setHistoryModeFilter] = useState("all");
  const [historyMarkedOnly, setHistoryMarkedOnly] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);
  const [workflowEntry, setWorkflowEntry] = useState<BuildHistoryEntry | null>(null);
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
  const currentBuildHistoryEntry = useMemo(() => {
    if (!buildResult) {
      return null;
    }
    const resultKey =
      currentBuildHistoryKey || buildResult.queueUrl || buildResult.buildUrl || "";
    const matchedEntry = buildHistory.find((item) => {
      if (resultKey && item.historyKey === resultKey) {
        return true;
      }
      if (buildResult.queueUrl && item.queueUrl === buildResult.queueUrl) {
        return true;
      }
      if (buildResult.buildUrl && item.buildUrl === buildResult.buildUrl) {
        return true;
      }
      return false;
    });
    const projectOption = projects.find((item) => item.key === selectedProject);
    const planParams = matchedEntry?.params ?? plan?.params ?? paramValues;
    const updatedAt = new Date(buildResultUpdatedAtMs || Date.now()).toISOString();
    return {
      historyKey:
        matchedEntry?.historyKey ||
        resultKey ||
        `${plan?.projectKey || selectedProject}:${plan?.jobKind || target || "default"}:${updatedAt}`,
      workspaceKey: matchedEntry?.workspaceKey ?? activeWorkspaceKey,
      projectInstancePath: matchedEntry?.projectInstancePath ?? null,
      projectKey: matchedEntry?.projectKey || plan?.projectKey || selectedProject,
      projectName:
        matchedEntry?.projectName ||
        plan?.projectName ||
        projectOption?.name ||
        selectedProject,
      mode: matchedEntry?.mode || plan?.jobKind || target || "",
      env:
        matchedEntry?.env ||
        planParams.ENV_PROFILE ||
        planParams.projectEnv ||
        planParams.env ||
        "",
      branch:
        matchedEntry?.branch ||
        planParams.BRANCH ||
        planParams.branch ||
        planParams.Branch ||
        "",
      stateKey: buildResult.stateKey,
      stateLabel: buildResult.stateLabel,
      detail: buildResult.detail,
      queueUrl: buildResult.queueUrl ?? matchedEntry?.queueUrl ?? null,
      buildUrl: buildResult.buildUrl ?? matchedEntry?.buildUrl ?? null,
      params: planParams,
      createdAt: matchedEntry?.createdAt || updatedAt,
      updatedAt,
    } satisfies BuildHistoryEntry;
  }, [
    buildHistory,
    buildResult,
    buildResultUpdatedAtMs,
    currentBuildHistoryKey,
    activeWorkspaceKey,
    paramValues,
    plan,
    projects,
    selectedProject,
    target,
  ]);
  const displayBuildHistory = useMemo(() => {
    if (!currentBuildHistoryEntry) {
      return buildHistory;
    }
    return [
      currentBuildHistoryEntry,
      ...buildHistory.filter(
        (item) => !buildHistoryEntriesReferToSameRun(item, currentBuildHistoryEntry),
      ),
    ];
  }, [buildHistory, currentBuildHistoryEntry]);
  const latestTaskAnchorEntry = useMemo(() => {
    if (currentBuildHistoryEntry) {
      return currentBuildHistoryEntry;
    }
    if (currentBuildHistoryKey) {
      return (
        buildHistory.find((item) => item.historyKey === currentBuildHistoryKey) ??
        null
      );
    }
    return buildHistory[0] ?? null;
  }, [buildHistory, currentBuildHistoryEntry, currentBuildHistoryKey]);
  const buildHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, BuildHistoryEntry>();
    for (const item of displayBuildHistory) {
      const key = buildTrayDedupeKeyFromHistory(item);
      if (!next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [displayBuildHistory]);
  const buildLegacyHistoryByPinnedKey = useMemo(() => {
    const next = new Map<string, BuildHistoryEntry>();
    for (const item of displayBuildHistory) {
      const key = workspacePinnedKey(
        item.workspaceKey,
        buildLegacyTrayDedupeKeyFromHistory(item),
      );
      if (!next.has(key)) {
        next.set(key, item);
      }
    }
    return next;
  }, [displayBuildHistory]);
  const buildSpecificLegacyPinnedKeys = useMemo(() => {
    const next = new Set<string>();
    for (const action of pinnedBuildActions) {
      const item = buildHistoryByPinnedKey.get(action.dedupeKey);
      if (item && (action.workspaceKey ?? null) === (item.workspaceKey ?? null)) {
        next.add(
          workspacePinnedKey(
            item.workspaceKey,
            buildLegacyTrayDedupeKeyFromHistory(item),
          ),
        );
      }
    }
    return next;
  }, [buildHistoryByPinnedKey, pinnedBuildActions]);
  const duplicateLegacyBuildPinnedKeys = useMemo(
    () =>
      pinnedBuildActions
        .filter(
          (action) => {
            const key = workspacePinnedKey(action.workspaceKey, action.dedupeKey);
            return (
              buildLegacyHistoryByPinnedKey.has(key) &&
              buildSpecificLegacyPinnedKeys.has(key)
            );
          },
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
        const exactItem = buildHistoryByPinnedKey.get(action.dedupeKey);
        if (
          exactItem &&
          (action.workspaceKey ?? null) === (exactItem.workspaceKey ?? null)
        ) {
          return true;
        }
        const legacyKey = workspacePinnedKey(action.workspaceKey, action.dedupeKey);
        return (
          buildLegacyHistoryByPinnedKey.has(legacyKey) &&
          !buildSpecificLegacyPinnedKeys.has(legacyKey)
        );
      }),
    [
      buildHistoryByPinnedKey,
      buildLegacyHistoryByPinnedKey,
      buildSpecificLegacyPinnedKeys,
      pinnedBuildActions,
    ],
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
    t,
  );
  const targetOptions = targetMeta?.targets.length
    ? targetMeta.targets
    : projects.find((project) => project.key === selectedProject)?.deployTargets ?? [];
  const targetOptionKeys = targetOptions.map((item) => item.key);
  const targetValueInvalid = Boolean(
    target && targetOptionKeys.length > 0 && !targetOptionKeys.includes(target),
  );
  const planRisks = plan?.risks ?? [];
  const planBlocked = Boolean(
    plan &&
      (plan.status?.success === false ||
        planRisks.some((risk) => risk.severity.toLowerCase() === "error")),
  );
  const contextBlocked = contextLoading || contextError || planBlocked;
  const planBranch =
    plan?.params.BRANCH || plan?.params.branch || plan?.params.Branch || "";
  const planCommit = plan?.observed?.commit ?? null;
  const planChangedPathCount = plan?.observed?.changedPaths?.length ?? 0;
  const isLocalBuildPlan = Boolean(plan && plan.adapter !== "jenkins");
  const localBuildProjectKey = isLocalBuildPlan ? plan?.projectKey || selectedProject : "";
  const canRefreshBuild = Boolean(
    buildResult?.queueUrl || buildResult?.buildUrl || localBuildProjectKey,
  );
  const buildResultActive = isOperationActiveState(buildResult?.stateKey);
  const groupedBuildHistory = useMemo(
    () =>
      groupConsecutiveBy(
        displayBuildHistory,
        buildHistorySignature,
        (item) => item.historyKey,
      ),
    [displayBuildHistory],
  );
  function pinnedActionForBuildItem(item: BuildHistoryEntry) {
    const exactAction = pinnedActionByKey.get(buildTrayDedupeKeyFromHistory(item));
    if (
      exactAction &&
      (exactAction.workspaceKey ?? null) === (item.workspaceKey ?? null)
    ) {
      return exactAction;
    }
    const legacyAction = pinnedActionByKey.get(buildLegacyTrayDedupeKeyFromHistory(item));
    return legacyAction &&
      (legacyAction.workspaceKey ?? null) === (item.workspaceKey ?? null)
      ? legacyAction
      : null;
  }
  function pinnedActionForBuildGroup(group: (typeof groupedBuildHistory)[number]) {
    return group.items.map(pinnedActionForBuildItem).find(Boolean) ?? null;
  }
  const buildHistoryModeOptions = useMemo(
    () =>
      [...new Set(displayBuildHistory.map((item) => item.mode).filter(Boolean))].map(
        (value) => ({ value, label: targetMetaByKey.get(value)?.label ?? value }),
      ),
    [displayBuildHistory, targetMetaByKey],
  );
  const filteredBuildHistoryGroups = useMemo(
    () =>
      filterHistoryGroups(groupedBuildHistory, (item) =>
        matchesBuildHistoryEntry(
          item,
          {
            query: historyQuery,
            status: historyStatusFilter,
            mode: historyModeFilter,
            markedOnly: historyMarkedOnly,
          },
          (entry) => Boolean(pinnedActionForBuildItem(entry)),
        ),
      ),
    [
      groupedBuildHistory,
      historyMarkedOnly,
      historyModeFilter,
      historyQuery,
      historyStatusFilter,
      pinnedActionByKey,
    ],
  );
  const visibleBuildHistoryGroups = useMemo(
    () => filteredBuildHistoryGroups.slice(0, historyVisibleCount),
    [filteredBuildHistoryGroups, historyVisibleCount],
  );
  const hasMoreBuildHistoryGroups =
    historyVisibleCount < filteredBuildHistoryGroups.length;
  const filteredBuildHistoryRecordCount = useMemo(
    () =>
      filteredBuildHistoryGroups.reduce((count, group) => count + group.items.length, 0),
    [filteredBuildHistoryGroups],
  );
  const hasBuildHistoryFilters = Boolean(
    historyQuery.trim() ||
      historyStatusFilter !== "all" ||
      historyModeFilter !== "all" ||
      historyMarkedOnly,
  );
  const currentBuildHistoryGroupId = useMemo(() => {
    if (!latestTaskAnchorEntry) {
      return "";
    }
    return (
      filteredBuildHistoryGroups.find((group) =>
        group.items.some((item) =>
          buildHistoryEntriesReferToSameRun(item, latestTaskAnchorEntry),
        ),
      )?.id ?? ""
    );
  }, [filteredBuildHistoryGroups, latestTaskAnchorEntry]);
  const hasDisplayBuildHistory = displayBuildHistory.length > 0;
  const workflowReceiveGroups = useMemo(
    () => groupWorkflowReceiveRules(workflowReceiveRules),
    [workflowReceiveRules],
  );

  useEffect(() => {
    if (currentBuildHistoryKey) {
      setHistoryExpanded(true);
    }
  }, [currentBuildHistoryKey]);

  useEffect(() => {
    setHistoryVisibleCount((current) => {
      if (current <= HISTORY_SCROLL_PAGE_SIZE) {
        return HISTORY_SCROLL_PAGE_SIZE;
      }
      return Math.min(
        current,
        Math.max(HISTORY_SCROLL_PAGE_SIZE, filteredBuildHistoryGroups.length),
      );
    });
  }, [filteredBuildHistoryGroups.length]);

  useEffect(() => {
    setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE);
  }, [historyMarkedOnly, historyModeFilter, historyQuery, historyStatusFilter]);

  useEffect(() => {
    setExpandedHistoryGroups((current) => {
      const visibleIds = new Set(filteredBuildHistoryGroups.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredBuildHistoryGroups]);

  useEffect(() => {
    if (!currentBuildHistoryGroupId) {
      return;
    }
    setExpandedHistoryGroups((current) => {
      if (current.has(currentBuildHistoryGroupId)) {
        return current;
      }
      const next = new Set(current);
      next.add(currentBuildHistoryGroupId);
      return next;
    });
  }, [currentBuildHistoryGroupId]);

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

  function loadMoreBuildHistoryGroups() {
    setHistoryVisibleCount((current) =>
      Math.min(
        current + HISTORY_SCROLL_PAGE_SIZE,
        filteredBuildHistoryGroups.length,
      ),
    );
  }

  function handleBuildHistoryScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreBuildHistoryGroups) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 84) {
      loadMoreBuildHistoryGroups();
    }
  }

  function openWorkflowReceiveDialog(entry: BuildHistoryEntry) {
    setWorkflowEntry(entry);
    setWorkflowOpen(true);
  }

  function handleTogglePinned(action: TrayPinnedAction) {
    togglePinned(action)
      .then(() => setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE))
      .catch((error) => {
        console.error("failed to update tray pinned action", error);
      });
  }

  function handleRemovePinned(dedupeKey: string) {
    removePinned(dedupeKey)
      .then(() => setHistoryVisibleCount(HISTORY_SCROLL_PAGE_SIZE))
      .catch((error) => {
        console.error("failed to remove tray pinned action", error);
      });
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
      await invoke("open_project_build_output", {
        project: localBuildProjectKey,
        outputDir: plan?.outputDir ?? null,
      });
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
      t,
    );
    const handleResetParam = () =>
      onParamChange(param.key, buildParamResetValue(param, sourceBranchOptions));
    if (param.kind === "select") {
      return (
        <Stack key={param.key} spacing={0.55}>
          <FieldRow label={translateBuildParameterLabel(param, t)}>
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
          <FieldRow label={translateBuildParameterLabel(param, t)}>
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
                  placeholder={t("选择或输入分支")}
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
                            aria-label={t("清空分支")}
                            title={t("清空分支")}
                          >
                            <ClearIcon fontSize="small" />
                          </IconButton>
                          ) : null}
                          <IconButton
                            size="small"
                            onClick={onSyncBranches}
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
        <FieldRow label={translateBuildParameterLabel(param, t)}>
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
              <FieldRow label={t("项目")}>
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
                  <FieldRow label={t("配置")}>
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
                        ? t("{config}不在当前项目配置中：{target}", {
                            config: actionCopy.config,
                            target,
                          })
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
                {t(branchSyncText)}
                {sourceBranchEntries.some((item) => item.updatedTs > 0)
                  ? t(" · 已按最近活跃排序")
                  : ""}
              </Typography>
            ) : null}

            {plan ? (
              <Stack spacing={0.25} minWidth={0} aria-label={t("构建计划摘要")}>
                {planBranch ? (
                  <BuildPlanCommitSummary
                    commit={planCommit}
                    changedPathCount={planChangedPathCount}
                    projectName={plan.projectName}
                    targetLabel={
                      targetMetaByKey.get(plan.jobKind)?.label ?? plan.jobKind
                    }
                    branch={planBranch}
                  />
                ) : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {t("计划：{project} / {target}", {
                      project: plan.projectName,
                      target:
                        targetMetaByKey.get(plan.jobKind)?.label ?? plan.jobKind,
                    })}
                  </Typography>
                )}
                {planRisks.length > 0 ? (
                  <InlineWarningNotice
                    title={t(planBlocked ? "计划检查未通过" : "计划提醒")}
                    details={planRisks.map((risk) =>
                      translateInternalMessage(risk.detail, t),
                    )}
                  />
                ) : null}
              </Stack>
            ) : null}

            {plan?.outputDir ? (
              <Typography variant="caption" color="text.secondary" noWrap title={plan.outputDir}>
                {t("产物目录：{path}", { path: plan.outputDir })}
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

      <Box className="workflow-panel workflow-history-panel">
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8} flexWrap="wrap" rowGap={0.45} minWidth={0} mb={historyExpanded ? 0.8 : 0}>
            <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 700 }}>
              {t("记录")}
            </Typography>
            <Stack direction="row" spacing={0.55} alignItems="center" flexWrap="wrap" rowGap={0.4} justifyContent="flex-end">
              <WorkflowLinkSummaryButton
                count={workflowReceiveGroups.length}
                onClick={() => setWorkflowListOpen(true)}
              />
              <IconButton
                size="small"
                onClick={onRefreshBuildHistory}
                title={t("刷新{noun}记录", { noun: actionCopy.noun })}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={onClearBuildHistory}
                title={t("清空{noun}记录", { noun: actionCopy.noun })}
              >
                <TrashIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setHistoryExpanded((current) => !current)}
                title={t(
                  historyExpanded ? "收起{noun}记录" : "展开{noun}记录",
                  { noun: actionCopy.noun },
                )}
              >
                {historyExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
          <Collapse in={historyExpanded} timeout="auto" unmountOnExit>
            {hasDisplayBuildHistory ? (
              <Stack className="workflow-history-content" spacing={0.65} minWidth={0}>
                <Stack
                  className="history-filter-toolbar"
                  direction="row"
                  spacing={0.65}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                >
                  <TextField
                    size="small"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder={t("搜索项目、分支、环境或参数")}
                    className="history-filter-search"
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <TextField
                    select
                    size="small"
                    value={historyStatusFilter}
                    onChange={(event) =>
                      setHistoryStatusFilter(event.target.value as BuildHistoryStatusFilter)
                    }
                    className="history-filter-select"
                    slotProps={{ htmlInput: { "aria-label": t("记录状态") } }}
                  >
                    <MenuItem value="all">{t("全部状态")}</MenuItem>
                    <MenuItem value="active">{t("执行中")}</MenuItem>
                    <MenuItem value="success">{t("成功")}</MenuItem>
                    <MenuItem value="failed">{t("失败或终止")}</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    value={historyModeFilter}
                    onChange={(event) => setHistoryModeFilter(event.target.value)}
                    className="history-filter-select history-filter-select--wide"
                    slotProps={{ htmlInput: { "aria-label": t("构建目标") } }}
                  >
                    <MenuItem value="all">{t("全部目标")}</MenuItem>
                    {buildHistoryModeOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <IconButton
                    size="small"
                    className={historyMarkedOnly ? "is-active" : ""}
                    color={historyMarkedOnly ? "primary" : "default"}
                    onClick={() => setHistoryMarkedOnly((current) => !current)}
                    aria-pressed={historyMarkedOnly}
                    aria-label={t("仅看已标记")}
                    title={t("仅看已标记")}
                  >
                    <StarIcon fontSize="small" />
                  </IconButton>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("{count} 条记录", {
                      count: filteredBuildHistoryRecordCount,
                    })}
                  />
                </Stack>
                {filteredBuildHistoryGroups.length > 0 ? (
                  <Box
                    className="module-list-scroll"
                    onScroll={handleBuildHistoryScroll}
                  >
                  <Stack spacing={0.65} minWidth={0}>
                    {visibleBuildHistoryGroups.map((group) => {
                      const item = group.latest;
                      const isGrouped = group.items.length > 1;
                      const groupExpanded = expandedHistoryGroups.has(group.id);
                      const isTaskAnchorGroup =
                        latestTaskAnchorEntry !== null &&
                        group.items.some((historyItem) =>
                          buildHistoryEntriesReferToSameRun(
                            historyItem,
                            latestTaskAnchorEntry,
                          ),
                        );
                      const isLiveCurrentTask =
                        currentBuildHistoryEntry !== null &&
                        group.items.some((historyItem) =>
                          buildHistoryEntriesReferToSameRun(
                            historyItem,
                            currentBuildHistoryEntry,
                          ),
                        );
                      const taskBadgeActive =
                        isTaskAnchorGroup &&
                        isOperationActiveState(latestTaskAnchorEntry?.stateKey);
                      const workflowSignalIds = workflowSignalIdsForBuildReplay(item);
                      const historyTargetMeta = targetMetaByKey.get(item.mode);
                      const historyActionCopy = buildActionCopy(
                        historyTargetMeta?.actionKind,
                        t,
                      );
                      const targetLabel = historyTargetMeta?.label ?? item.mode;
                      const trayAction = buildTrayActionFromHistory(
                        item,
                        targetLabel,
                        t,
                        historyActionCopy.noun,
                      );
                      const groupPinnedAction = pinnedActionForBuildGroup(group);
                      const pinned = Boolean(groupPinnedAction);
                      const historyAccent = buildHistoryAccent(item);
                      const paramEntries = buildHistoryParamEntries(
                        item,
                        paramMetaByKey,
                        defaultParamValues,
                        t,
                      );
                      const secondaryActions: BuildHistoryMenuAction[] = [];
                      if (isLiveCurrentTask && isLocalBuildPlan) {
                        secondaryActions.push(
                          {
                            key: "log",
                            label: t("查看构建日志"),
                            icon: <TerminalIcon fontSize="small" />,
                            onClick: openLocalBuildLog,
                            disabled: !localBuildProjectKey || runtimeLogLoading,
                          },
                          {
                            key: "output",
                            label: t("打开产物目录"),
                            icon: <FolderIcon fontSize="small" />,
                            onClick: openLocalBuildOutput,
                            disabled:
                              !localBuildProjectKey || localBuildAction === "output",
                          },
                        );
                      }
                      if (isLiveCurrentTask && (buildResult?.queueUrl || buildResult?.buildUrl)) {
                        secondaryActions.push({
                          key: "current-record",
                          label: t("打开构建记录页"),
                          icon: <OpenExternalIcon fontSize="small" />,
                          onClick: onOpenBuildRecord,
                        });
                      } else if (!isLiveCurrentTask && (item.buildUrl || item.queueUrl)) {
                        secondaryActions.push({
                          key: "record",
                          label: t("打开记录"),
                          icon: <OpenExternalIcon fontSize="small" />,
                          onClick: () => onOpenBuildUrl((item.buildUrl || item.queueUrl)!),
                        });
                      }
                      secondaryActions.push({
                        key: "workflow",
                        label: t("配置联动"),
                        icon: <WorkflowIcon fontSize="small" />,
                        onClick: () => openWorkflowReceiveDialog(item),
                        active: workflowSignalIds.length > 0,
                      });
                      return (
                        <HistoryCard
                          key={group.id}
                          title={`${item.projectName} / ${targetLabel || t("默认配置")}`}
                          subtitle={`${translateInternalMessage(item.stateLabel, t)} · ${formatRelativeTime(item.updatedAt)}`}
                          pinned={pinned}
                          accent={historyAccent}
                          badge={
                            <Stack
                              direction="row"
                              spacing={0.4}
                              alignItems="center"
                              flexWrap="wrap"
                              rowGap={0.4}
                              justifyContent="flex-end"
                            >
                              {!item.workspaceKey ? (
                                <Chip
                                  size="small"
                                  label={t("未归属")}
                                  color="default"
                                  variant="outlined"
                                />
                              ) : null}
                              {isTaskAnchorGroup ? (
                                <Chip
                                  size="small"
                                  label={t(
                                    taskBadgeActive ? "正在执行" : "最新任务",
                                  )}
                                  color={taskBadgeActive ? "warning" : "primary"}
                                  variant="filled"
                                />
                              ) : null}
                              {isLiveCurrentTask ? (
                                <>
                                  <IconButton
                                    onClick={onRefreshBuild}
                                    disabled={!canRefreshBuild}
                                    size="small"
                                    title={t("刷新{noun}状态", {
                                      noun: actionCopy.noun,
                                    })}
                                  >
                                    <RefreshIcon fontSize="small" />
                                  </IconButton>
                                  {isLocalBuildPlan ? (
                                    <>
                                      <IconButton
                                        onClick={stopLocalBuild}
                                        disabled={!buildResultActive || localBuildAction === "stop"}
                                        size="small"
                                        title={t("停止本地构建")}
                                      >
                                        <StopIcon fontSize="small" />
                                      </IconButton>
                                    </>
                                  ) : null}
                                </>
                              ) : null}
                              <IconButton
                                size="small"
                                onClick={() => onReplayBuildHistory(item)}
                                disabled={Boolean(busy)}
                                aria-label={t("重播{noun}", {
                                  noun: historyActionCopy.noun,
                                })}
                                title={t("使用相同参数重播")}
                              >
                                <ReplayIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={() =>
                                  groupPinnedAction
                                    ? handleRemovePinned(groupPinnedAction.dedupeKey)
                                    : handleTogglePinned(trayAction)
                                }
                                color={pinned ? "primary" : "default"}
                                aria-label={t(pinned ? "取消标记" : "标记记录")}
                                title={t(pinned ? "取消标记" : "标记记录")}
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
                                  aria-label={t(
                                    groupExpanded
                                      ? "收起同参数{noun}"
                                      : "展开同参数{noun}",
                                    { noun: historyActionCopy.noun },
                                  )}
                                  title={t(
                                    groupExpanded
                                      ? "收起同参数{noun}"
                                      : "展开同参数{noun}",
                                    { noun: historyActionCopy.noun },
                                  )}
                                >
                                  {groupExpanded ? (
                                    <CollapseIcon fontSize="small" />
                                  ) : (
                                    <ExpandIcon fontSize="small" />
                                  )}
                                </IconButton>
                              ) : null}
                              <BuildHistoryMoreMenu actions={secondaryActions} />
                            </Stack>
                          }
                          detail={
                            <BuildHistoryRecordDetail
                              detail={translateBuildDetail(item.detail, t)}
                              paramEntries={paramEntries}
                              danger={historyAccent === "danger"}
                            />
                          }
                          meta={[
                            isGrouped
                              ? t("连续 {count} 次", {
                                  count: group.items.length,
                                })
                              : "",
                            item.env,
                            item.branch,
                          ].filter(Boolean)}
                        >
                          {isGrouped ? (
                            <Collapse in={groupExpanded} timeout="auto" unmountOnExit>
                              <BuildHistoryRunTimeline
                                items={group.items}
                                formatRelativeTime={formatRelativeTime}
                              />
                            </Collapse>
                          ) : null}
                        </HistoryCard>
                      );
                    })}
                    <Box
                      className={
                        hasMoreBuildHistoryGroups
                          ? "workflow-history-footer"
                          : "workflow-history-footer workflow-history-footer--done"
                      }
                    >
                      {hasMoreBuildHistoryGroups ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={loadMoreBuildHistoryGroups}
                          className="workflow-history-footer-action"
                        >
                          {t("下滑加载更多")}
                        </Button>
                      ) : (
                        <AppListEndState label={t("没有更多了")} />
                      )}
                    </Box>
                  </Stack>
                  </Box>
                ) : (
                  <Stack alignItems="center" spacing={0.4}>
                    <AppEmptyState
                      compact
                      title={t("没有符合条件的记录")}
                      description={t("调整搜索或筛选条件。")}
                    />
                    {hasBuildHistoryFilters ? (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          setHistoryQuery("");
                          setHistoryStatusFilter("all");
                          setHistoryModeFilter("all");
                          setHistoryMarkedOnly(false);
                        }}
                      >
                        {t("清除筛选")}
                      </Button>
                    ) : null}
                  </Stack>
                )}
              </Stack>
            ) : (
              <AppEmptyState
                compact
                title={t("暂无{noun}记录", { noun: actionCopy.noun })}
                description={t("执行任务后会保留最近结果。")}
              />
            )}
          </Collapse>
      </Box>

      <Dialog
        open={runtimeLogOpen}
        onClose={() => setRuntimeLogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{t("构建日志")}</DialogTitle>
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
                ? t("加载中...")
                : runtimeLogLines.length > 0
                  ? runtimeLogLines.join("\n")
                  : t("暂无构建日志。")}
            </Box>
            {runtimeLogTruncated ? (
              <Typography variant="caption" color="text.secondary">
                {t("已显示最后 {count} 行", {
                  count: runtimeLogLines.length,
                })}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuntimeLogOpen(false)}>{t("关闭")}</Button>
        </DialogActions>
      </Dialog>

      <WorkflowRulesConfigDialog
        open={workflowOpen}
        title={t("联动配置")}
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
        title={t("联动清单")}
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
