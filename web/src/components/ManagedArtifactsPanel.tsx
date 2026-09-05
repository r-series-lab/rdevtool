import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type {
  ManagedArtifactCleanupAction,
  ManagedArtifactCleanupPlanResponse,
  ManagedArtifactFocusRequest,
  ManagedArtifactInventoryResponse,
  ManagedArtifactRecord,
  ManagedArtifactReference,
} from "../app-types";
import { useI18n } from "../i18n";
import {
  CheckIcon,
  CopyIcon,
  FolderIcon,
  RefreshIcon,
  SearchIcon,
} from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";
import {
  MANAGED_ARTIFACT_KIND_KEYS,
  managedArtifactCleanupPlanCommand,
  managedArtifactDetailLabel,
  managedArtifactKindLabel,
} from "../lib/managedArtifactPresentation";
import { translateInternalMessage } from "../i18n/internalMessages";

export type ManagedArtifactsPanelProps = {
  activeWorkspaceKey: string;
  initialKind?: string | null;
  initialAllWorkspaces?: boolean;
  initialFocus?: ManagedArtifactFocusRequest | null;
};

const CLEANUP_ELIGIBILITY_ORDER = ["eligible", "reviewRequired", "blocked"] as const;

function cleanupEligibilityLabel(eligibility: string) {
  if (eligibility === "eligible") return "可清理";
  if (eligibility === "reviewRequired") return "需要复核";
  if (eligibility === "blocked") return "已阻断";
  return eligibility;
}

function recordMatchesQuery(record: ManagedArtifactRecord, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    record.id,
    record.source,
    record.artifact.kind,
    record.artifact.path,
    record.artifact.lifecycle,
    record.workspaceKey,
    record.projectKey,
    record.runId,
    record.scopePath,
    record.detail,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(needle));
}

function referenceMatchesQuery(record: ManagedArtifactReference, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    record.kind,
    record.path,
    record.source,
    record.workspaceKey,
    record.projectKey,
    record.reason,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(needle));
}

function ArtifactPathActions({
  path,
  exists = true,
  copied = false,
  onOpenPath,
  onCopyPath,
}: {
  path: string;
  exists?: boolean;
  copied?: boolean;
  onOpenPath?: (path: string) => void;
  onCopyPath?: (path: string) => void;
}) {
  const { t } = useI18n();

  if (!onOpenPath && !onCopyPath) return null;

  return (
    <Stack className="settings-artifact-path-actions" direction="row" spacing={0.35}>
      {onOpenPath ? (
        <Tooltip title={t("打开产物路径")}>
          <span>
            <IconButton
              size="small"
              disabled={!exists}
              onClick={() => onOpenPath(path)}
              aria-label={t("打开产物路径")}
            >
              <FolderIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {onCopyPath ? (
        <Tooltip title={copied ? t("已复制产物路径") : t("复制产物路径")}>
          <IconButton
            size="small"
            onClick={() => onCopyPath(path)}
            aria-label={t("复制产物路径")}
          >
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
}

function ArtifactRecordCard({
  record,
  selected = false,
  copied = false,
  onSelectedChange,
  onOpenPath,
  onCopyPath,
}: {
  record: ManagedArtifactRecord;
  selected?: boolean;
  copied?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onOpenPath?: (path: string) => void;
  onCopyPath?: (path: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Box
      component="article"
      className={`settings-artifact-record${selected ? " is-selected" : ""}${record.active ? " is-active" : ""}${
        !record.exists || !record.ownershipVerified ? " has-warning" : ""
      }`}
    >
      <Stack
        className="settings-artifact-record-head"
        direction="row"
        spacing={0.65}
        alignItems="center"
      >
        {onSelectedChange ? (
          <Checkbox
            className="settings-artifact-record-selection"
            size="small"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            inputProps={{
              "aria-label": t("选择{kind}：{path}", {
                kind: managedArtifactKindLabel(record.artifact.kind, t),
                path: record.artifact.path,
              }),
            }}
          />
        ) : null}
        <Typography className="settings-artifact-record-title" variant="subtitle2">
          {managedArtifactKindLabel(record.artifact.kind, t)}
        </Typography>
        <Stack
          className="settings-artifact-record-tags"
          direction="row"
          spacing={0.45}
          useFlexGap
          flexWrap="wrap"
        >
          {record.active ? (
            <Chip className="settings-artifact-chip is-active" size="small" label={t("活动中")} />
          ) : null}
          {!record.exists ? (
            <Chip
              className="settings-artifact-chip is-warning"
              size="small"
              variant="outlined"
              label={t("路径缺失")}
            />
          ) : null}
          {!record.ownershipVerified ? (
            <Chip
              className="settings-artifact-chip is-warning"
              size="small"
              variant="outlined"
              label={t("归属待验证")}
            />
          ) : null}
        </Stack>
        <ArtifactPathActions
          path={record.artifact.path}
          exists={record.exists}
          copied={copied}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />
      </Stack>
      <Typography
        className="settings-artifact-path"
        variant="body2"
        noWrap
        title={record.artifact.path}
      >
        {record.artifact.path}
      </Typography>
      <Typography className="settings-artifact-meta" variant="caption">
        {[
          record.workspaceKey
            ? t("工作区 {key}", { key: record.workspaceKey })
            : t("未映射工作区"),
          record.projectKey ? t("项目 {key}", { key: record.projectKey }) : "",
          record.runId ? `Run ${record.runId}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </Typography>
    </Box>
  );
}

function ArtifactReferenceCard({ record }: { record: ManagedArtifactReference }) {
  const { t } = useI18n();

  return (
    <Box component="article" className="settings-artifact-reference">
      <Stack
        className="settings-artifact-record-head"
        direction="row"
        spacing={0.6}
        alignItems="center"
      >
        <Typography className="settings-artifact-record-title" variant="subtitle2">
          {managedArtifactKindLabel(record.kind, t)}
        </Typography>
        <Stack
          className="settings-artifact-record-tags"
          direction="row"
          spacing={0.45}
          useFlexGap
          flexWrap="wrap"
        >
          <Chip
            className="settings-artifact-chip"
            size="small"
            variant="outlined"
            label={t("仅引用")}
          />
          {!record.exists ? (
            <Chip
              className="settings-artifact-chip is-warning"
              size="small"
              variant="outlined"
              label={t("路径缺失")}
            />
          ) : null}
        </Stack>
      </Stack>
      <Typography
        className="settings-artifact-path"
        variant="body2"
        noWrap
        title={record.path}
      >
        {record.path}
      </Typography>
      <Typography className="settings-artifact-detail" variant="caption">
        {managedArtifactDetailLabel(record.reason, t)}
      </Typography>
    </Box>
  );
}

export function ManagedArtifactsInventoryView({
  inventory,
  query,
  selectedArtifactIds = [],
  onSelectedArtifactIdsChange,
  copiedPath,
  onOpenPath,
  onCopyPath,
}: {
  inventory: ManagedArtifactInventoryResponse;
  query: string;
  selectedArtifactIds?: string[];
  onSelectedArtifactIdsChange?: (ids: string[]) => void;
  copiedPath?: string | null;
  onOpenPath?: (path: string) => void;
  onCopyPath?: (path: string) => void;
}) {
  const { t } = useI18n();
  const artifacts = useMemo(
    () => inventory.observed.artifacts.filter((record) => recordMatchesQuery(record, query)),
    [inventory, query],
  );
  const references = useMemo(
    () => inventory.observed.references.filter((record) => referenceMatchesQuery(record, query)),
    [inventory, query],
  );
  const summary = inventory.observed.summary;
  const selectedIds = useMemo(
    () => new Set(selectedArtifactIds),
    [selectedArtifactIds],
  );
  const selectedVisibleCount = artifacts.filter((record) => selectedIds.has(record.id)).length;
  const allVisibleSelected = artifacts.length > 0 && selectedVisibleCount === artifacts.length;

  function updateVisibleSelection(selected: boolean) {
    if (!onSelectedArtifactIdsChange) return;
    const next = new Set(selectedArtifactIds);
    for (const record of artifacts) {
      if (selected) next.add(record.id);
      else next.delete(record.id);
    }
    onSelectedArtifactIdsChange([...next]);
  }

  function updateRecordSelection(recordId: string, selected: boolean) {
    if (!onSelectedArtifactIdsChange) return;
    const next = new Set(selectedArtifactIds);
    if (selected) next.add(recordId);
    else next.delete(recordId);
    onSelectedArtifactIdsChange([...next]);
  }

  return (
    <Stack
      className="settings-artifacts-inventory"
      spacing={0}
      data-managed-artifacts-view="read-only"
    >
      <Box className="settings-artifacts-summary" aria-label={t("受管产物盘点概览")}>
        {[
          [t("托管记录"), summary.artifactCount],
          [t("已存在"), summary.existingCount],
          [t("活动中"), summary.activeCount],
          [t("仅引用"), summary.referenceCount],
        ].map(([label, value]) => (
          <Box className="settings-artifacts-metric" key={label}>
            <Typography component="strong">{value}</Typography>
            <Typography component="span">{label}</Typography>
          </Box>
        ))}
      </Box>
      {inventory.risks.length > 0 ? (
        <Stack className="settings-artifact-risks" spacing={0.65}>
          {inventory.risks.map((risk) => (
            <Alert
              className="settings-artifact-risk"
              key={`${risk.code}:${risk.detail}`}
              severity={
                risk.severity === "error"
                  ? "error"
                  : risk.severity === "warning"
                    ? "warning"
                    : "info"
              }
              variant="outlined"
            >
              {translateInternalMessage(risk.detail, t)}
            </Alert>
          ))}
        </Stack>
      ) : null}
      <Box className="settings-artifacts-record-group">
        <header className="settings-artifacts-record-group-head">
          <Stack direction="row" spacing={0.5} alignItems="center">
            {onSelectedArtifactIdsChange ? (
              <Checkbox
                className="settings-artifacts-select-visible"
                size="small"
                checked={allVisibleSelected}
                indeterminate={selectedVisibleCount > 0 && !allVisibleSelected}
                disabled={artifacts.length === 0}
                onChange={(event) => updateVisibleSelection(event.target.checked)}
                inputProps={{ "aria-label": t("选择当前搜索结果") }}
              />
            ) : null}
            <Typography variant="subtitle2">{t("托管产物")}</Typography>
          </Stack>
          <Typography variant="caption">{t("{count} 条", { count: artifacts.length })}</Typography>
        </header>
        <Stack className="settings-artifacts-record-list" spacing={0.7}>
          {artifacts.length > 0 ? (
            artifacts.map((record) => (
              <ArtifactRecordCard
                key={record.id}
                record={record}
                selected={selectedIds.has(record.id)}
                copied={copiedPath === record.artifact.path}
                onSelectedChange={
                  onSelectedArtifactIdsChange
                    ? (selected) => updateRecordSelection(record.id, selected)
                    : undefined
                }
                onOpenPath={onOpenPath}
                onCopyPath={onCopyPath}
              />
            ))
          ) : (
            <AppEmptyState
              compact
              title={t("没有匹配的托管产物")}
              description={t("调整搜索或工作区范围后重试。")}
            />
          )}
        </Stack>
      </Box>
      {references.length > 0 ? (
        <Box component="details" className="settings-artifacts-references">
          <Typography component="summary" variant="subtitle2">
            <Box component="span">{t("非托管引用")}</Box>
            <Box component="span">{t("{count} 条", { count: references.length })}</Box>
          </Typography>
          <Stack className="settings-artifacts-reference-list" spacing={0.7}>
            {references.map((record) => (
              <ArtifactReferenceCard
                key={`${record.kind}:${record.path}:${record.workspaceKey ?? ""}`}
                record={record}
              />
            ))}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

function CleanupPlanActionRow({
  action,
  copied = false,
  onOpenPath,
  onCopyPath,
}: {
  action: ManagedArtifactCleanupAction;
  copied?: boolean;
  onOpenPath?: (path: string) => void;
  onCopyPath?: (path: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Box className="settings-artifact-plan-row">
      <Stack direction="row" spacing={0.65} alignItems="center">
        <Typography className="settings-artifact-record-title" variant="subtitle2">
          {managedArtifactKindLabel(action.kind, t)}
        </Typography>
        <Chip
          className={`settings-artifact-chip is-${action.eligibility}`}
          size="small"
          variant="outlined"
          label={t(cleanupEligibilityLabel(action.eligibility))}
        />
        <ArtifactPathActions
          path={action.path}
          copied={copied}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />
      </Stack>
      <Typography
        className="settings-artifact-path"
        variant="body2"
        noWrap
        title={action.path}
      >
        {action.path}
      </Typography>
      <Typography className="settings-artifact-detail" variant="caption">
        {translateInternalMessage(action.reason, t)}
      </Typography>
      {action.prerequisites.length > 0 ? (
        <Typography className="settings-artifact-prerequisites" variant="caption">
          {t("前置条件：{items}", {
            items: action.prerequisites
              .map((item) => translateInternalMessage(item, t))
              .join("; "),
          })}
        </Typography>
      ) : null}
    </Box>
  );
}

export function ManagedArtifactCleanupPlanView({
  plan,
  copiedPath,
  onOpenPath,
  onCopyPath,
  onSelectArtifactIds,
}: {
  plan: ManagedArtifactCleanupPlanResponse;
  copiedPath?: string | null;
  onOpenPath?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onSelectArtifactIds?: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [eligibilityFilter, setEligibilityFilter] = useState("all");
  const command = useMemo(() => managedArtifactCleanupPlanCommand(plan), [plan]);
  const eligibleArtifactIds = useMemo(
    () =>
      plan.observed.actions
        .filter((action) => action.eligibility === "eligible")
        .map((action) => action.artifactId),
    [plan],
  );
  const visibleActionCount =
    eligibilityFilter === "all"
      ? plan.observed.actions.length
      : plan.observed.actions.filter(
          (action) => action.eligibility === eligibilityFilter,
        ).length;

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Box className="settings-artifacts-plan" data-managed-artifact-cleanup-plan="read-only">
      <header className="settings-artifacts-plan-head">
        <Typography variant="subtitle2">{t("只读清理评估")}</Typography>
        <Stack direction="row" spacing={0.55} alignItems="center" useFlexGap flexWrap="wrap">
          <Chip
            size="small"
            variant="outlined"
            label={
              plan.requested.artifactIds.length > 0
                ? t("精确选择 {count} 条", { count: plan.requested.artifactIds.length })
                : t("当前筛选范围")
            }
          />
          <Tooltip title={copied ? t("已复制复核命令") : t("复制复核命令")}>
            <IconButton
              size="small"
              onClick={() => void copyCommand()}
              aria-label={t("复制复核命令")}
            >
              <CopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </header>
      <Box className="settings-artifacts-plan-summary">
        {[
          [t("可清理"), plan.observed.eligibleCount, "eligible"],
          [t("需要复核"), plan.observed.reviewRequiredCount, "reviewRequired"],
          [t("已阻断"), plan.observed.blockedCount, "blocked"],
        ].map(([label, value, tone]) => (
          <Box className={`settings-artifacts-plan-metric is-${tone}`} key={label}>
            <Typography component="strong">{value}</Typography>
            <Typography component="span">{label}</Typography>
          </Box>
        ))}
      </Box>
      <div className="settings-artifacts-plan-controls">
        <ToggleButtonGroup
          size="small"
          exclusive
          value={eligibilityFilter}
          onChange={(_, value: string | null) => {
            if (value) setEligibilityFilter(value);
          }}
          aria-label={t("清理资格筛选")}
        >
          <ToggleButton value="all">{t("全部")}</ToggleButton>
          {CLEANUP_ELIGIBILITY_ORDER.map((eligibility) => (
            <ToggleButton value={eligibility} key={eligibility}>
              {t(cleanupEligibilityLabel(eligibility))}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {onSelectArtifactIds ? (
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            startIcon={<CheckIcon fontSize="small" />}
            disabled={eligibleArtifactIds.length === 0}
            onClick={() => onSelectArtifactIds(eligibleArtifactIds)}
          >
            {t("仅选择可清理项（{count}）", { count: eligibleArtifactIds.length })}
          </Button>
        ) : null}
      </div>
      {plan.risks.length > 0 ? (
        <Stack className="settings-artifact-risks" spacing={0.65}>
          {plan.risks.map((risk) => (
            <Alert
              className="settings-artifact-risk"
              key={`${risk.code}:${risk.detail}`}
              severity={
                risk.severity === "error"
                  ? "error"
                  : risk.severity === "warning"
                    ? "warning"
                    : "info"
              }
              variant="outlined"
            >
              {translateInternalMessage(risk.detail, t)}
            </Alert>
          ))}
        </Stack>
      ) : null}
      {visibleActionCount === 0 ? (
        <AppEmptyState
          compact
          className="settings-artifacts-plan-empty"
          title={t("该资格下没有候选产物")}
          description={t("切换其他资格或重新生成清理评估。")}
        />
      ) : (
        CLEANUP_ELIGIBILITY_ORDER.map((eligibility) => {
          if (eligibilityFilter !== "all" && eligibilityFilter !== eligibility) {
            return null;
          }
          const actions = plan.observed.actions.filter(
            (action) => action.eligibility === eligibility,
          );
          if (actions.length === 0) return null;
          return (
            <section className="settings-artifacts-plan-group" key={eligibility}>
              <header className="settings-artifacts-record-group-head">
                <Typography variant="subtitle2">
                  {t(cleanupEligibilityLabel(eligibility))}
                </Typography>
                <Typography variant="caption">
                  {t("{count} 条", { count: actions.length })}
                </Typography>
              </header>
              <Stack className="settings-artifacts-plan-list" spacing={0}>
                {actions.map((action) => (
                  <CleanupPlanActionRow
                    key={action.artifactId}
                    action={action}
                    copied={copiedPath === action.path}
                    onOpenPath={onOpenPath}
                    onCopyPath={onCopyPath}
                  />
                ))}
              </Stack>
            </section>
          );
        })
      )}
    </Box>
  );
}

export function ManagedArtifactsPanel({
  activeWorkspaceKey,
  initialKind = null,
  initialAllWorkspaces = false,
  initialFocus = null,
}: ManagedArtifactsPanelProps) {
  const { t } = useI18n();
  const [focusCleared, setFocusCleared] = useState(false);
  const focus = focusCleared ? null : initialFocus;
  const focusedWorkspaceKey = focus?.workspaceKey.trim() || activeWorkspaceKey;
  const focusedProjectKey = focus?.projectKey.trim() || "";
  const focusedPath = focus?.path.trim() || "";
  const focusedKind = focus?.kind.trim() || "";
  const [allWorkspaces, setAllWorkspaces] = useState(
    focus ? false : initialAllWorkspaces || activeWorkspaceKey === "system",
  );
  const [inventory, setInventory] = useState<ManagedArtifactInventoryResponse | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<ManagedArtifactCleanupPlanResponse | null>(null);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState(focusedKind || initialKind || "");
  const [query, setQuery] = useState(focusedPath);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState("");
  const [copiedArtifactPath, setCopiedArtifactPath] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const planRequestIdRef = useRef(0);
  const copiedPathTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setFocusCleared(false);
  }, [initialFocus?.requestId]);

  useEffect(() => {
    setAllWorkspaces(
      focus ? false : initialAllWorkspaces || activeWorkspaceKey === "system",
    );
    setKindFilter(focusedKind || initialKind || "");
    setQuery(focusedPath);
    setSelectedArtifactIds([]);
    setCleanupPlan(null);
  }, [
    activeWorkspaceKey,
    focus?.requestId,
    focusedKind,
    focusedPath,
    initialAllWorkspaces,
    initialKind,
  ]);

  useEffect(() => {
    setSelectedArtifactIds([]);
    setCleanupPlan(null);
  }, [focusedProjectKey, focusedWorkspaceKey, allWorkspaces, kindFilter]);

  useEffect(
    () => () => {
      if (copiedPathTimerRef.current !== null) {
        window.clearTimeout(copiedPathTimerRef.current);
      }
    },
    [],
  );

  const loadInventory = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    setCleanupPlan(null);
    setPlanError("");
    try {
      const response = await invoke<ManagedArtifactInventoryResponse>("list_managed_artifacts", {
        workspace: allWorkspaces ? null : focusedWorkspaceKey,
        allWorkspaces,
        project: focusedProjectKey || null,
        kinds: kindFilter ? [kindFilter] : [],
      });
      if (requestIdRef.current === requestId) {
        const availableIds = new Set(
          response.observed.artifacts.map((record) => record.id),
        );
        const focusedRecord = focusedPath
          ? response.observed.artifacts.find(
              (record) =>
                record.artifact.path === focusedPath &&
                (!focusedKind || record.artifact.kind === focusedKind) &&
                (!focusedProjectKey || record.projectKey === focusedProjectKey),
            )
          : null;
        setSelectedArtifactIds((current) =>
          focusedRecord
            ? [focusedRecord.id]
            : current.filter((artifactId) => availableIds.has(artifactId)),
        );
        setInventory(response);
      }
    } catch (reason) {
      if (requestIdRef.current === requestId) {
        setError(String(reason));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    allWorkspaces,
    focusedKind,
    focusedPath,
    focusedProjectKey,
    focusedWorkspaceKey,
    kindFilter,
  ]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const loadCleanupPlan = useCallback(async () => {
    const requestId = planRequestIdRef.current + 1;
    planRequestIdRef.current = requestId;
    setPlanning(true);
    setPlanError("");
    try {
      const response = await invoke<ManagedArtifactCleanupPlanResponse>(
        "plan_managed_artifact_cleanup",
        {
          workspace: allWorkspaces ? null : focusedWorkspaceKey,
          allWorkspaces,
          project: focusedProjectKey || null,
          kinds: kindFilter ? [kindFilter] : [],
          artifactIds: selectedArtifactIds,
        },
      );
      if (planRequestIdRef.current === requestId) {
        setCleanupPlan(response);
      }
    } catch (reason) {
      if (planRequestIdRef.current === requestId) {
        setPlanError(String(reason));
      }
    } finally {
      if (planRequestIdRef.current === requestId) {
        setPlanning(false);
      }
    }
  }, [
    allWorkspaces,
    focusedProjectKey,
    focusedWorkspaceKey,
    kindFilter,
    selectedArtifactIds,
  ]);

  function updateSelectedArtifactIds(ids: string[]) {
    const next = [...new Set(ids)].sort();
    const current = [...selectedArtifactIds].sort();
    if (
      next.length === current.length &&
      next.every((artifactId, index) => artifactId === current[index])
    ) {
      return;
    }
    setSelectedArtifactIds(next);
    setCleanupPlan(null);
    setPlanError("");
  }

  function clearFocus() {
    setAllWorkspaces(initialAllWorkspaces || activeWorkspaceKey === "system");
    setKindFilter(initialKind || "");
    setQuery("");
    setSelectedArtifactIds([]);
    setCleanupPlan(null);
    setPlanError("");
    setFocusCleared(true);
  }

  async function openArtifactPath(path: string) {
    setError("");
    try {
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function copyArtifactPath(path: string) {
    setError("");
    try {
      await navigator.clipboard.writeText(path);
      setCopiedArtifactPath(path);
      if (copiedPathTimerRef.current !== null) {
        window.clearTimeout(copiedPathTimerRef.current);
      }
      copiedPathTimerRef.current = window.setTimeout(() => {
        setCopiedArtifactPath(null);
        copiedPathTimerRef.current = null;
      }, 1600);
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <Stack className="settings-overview" spacing={1.15}>
      <section
        className="settings-list-section settings-list-section--global-combined settings-artifacts-section"
        aria-labelledby="settings-artifacts-title"
      >
        <header className="settings-list-head settings-artifacts-head">
          <div className="settings-artifacts-head-copy">
            <Typography id="settings-artifacts-title" variant="subtitle2">
              {t("受管产物")}
            </Typography>
            <Typography variant="caption">
              {t("汇总工作区副本、Runtime 与 Proxy daemon 的持久化产物")}
            </Typography>
          </div>
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Tooltip title={t("盘点和清理评估均为只读操作，不会删除或修改本地文件。")}>
              <Chip
                className="settings-artifacts-readonly-chip"
                size="small"
                variant="outlined"
                label={t("只读")}
              />
            </Tooltip>
            <Button
              className="settings-artifacts-plan-button"
              size="small"
              color="inherit"
              variant="outlined"
              startIcon={planning ? <CircularProgress size={14} /> : <SearchIcon fontSize="small" />}
              onClick={() => void loadCleanupPlan()}
              disabled={loading || planning || !inventory}
            >
              {selectedArtifactIds.length > 0
                ? t("评估选中项（{count}）", { count: selectedArtifactIds.length })
                : t("评估清理")}
            </Button>
            <Tooltip title={t("刷新受管产物")}>
              <span>
                <IconButton
                  className="settings-artifacts-refresh"
                  size="small"
                  onClick={() => void loadInventory()}
                  disabled={loading}
                  aria-label={t("刷新受管产物")}
                >
                  {loading ? <CircularProgress size={15} /> : <RefreshIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </header>
        <Stack className="settings-artifacts-content" spacing={0}>
          {focus ? (
            <Alert
              className="settings-artifacts-focus"
              severity="info"
              action={
                <Button
                  size="small"
                  color="inherit"
                  onClick={clearFocus}
                >
                  {t("清除定位")}
                </Button>
              }
            >
              {t("正在定位工作区 {workspace} · 项目 {project} 的托管副本", {
                workspace: focusedWorkspaceKey,
                project: focusedProjectKey,
              })}
            </Alert>
          ) : null}
          <div className="settings-artifacts-toolbar">
            <Stack
              className="settings-artifacts-controls"
              direction="row"
              spacing={0.8}
              alignItems="center"
            >
              <TextField
                className="settings-artifacts-search"
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("搜索类型、路径、工作区或项目")}
                inputProps={{ "aria-label": t("搜索受管产物") }}
                sx={{ flex: 1 }}
              />
              <TextField
                className="settings-artifacts-kind-filter"
                select
                size="small"
                label={t("类型")}
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
              >
                <MenuItem value="">{t("全部类型")}</MenuItem>
                {MANAGED_ARTIFACT_KIND_KEYS.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {managedArtifactKindLabel(kind, t)}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                className="settings-artifacts-scope"
                control={
                  <Switch
                    size="small"
                    checked={allWorkspaces}
                    onChange={(event) => setAllWorkspaces(event.target.checked)}
                    disabled={Boolean(focus)}
                    inputProps={{ "aria-label": t("查看全部工作区产物") }}
                  />
                }
                label={t("全部工作区")}
              />
            </Stack>
          </div>
          {error ? (
            <Alert className="settings-artifacts-error" severity="error">
              {error}
            </Alert>
          ) : null}
          {planError ? (
            <Alert className="settings-artifacts-error" severity="error">
              {planError}
            </Alert>
          ) : null}
          {loading && !inventory ? (
            <Stack className="settings-artifacts-loading" direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                {t("正在读取受管产物台账…")}
              </Typography>
            </Stack>
          ) : inventory ? (
            <>
              <ManagedArtifactsInventoryView
                inventory={inventory}
                query={query}
                selectedArtifactIds={selectedArtifactIds}
                onSelectedArtifactIdsChange={updateSelectedArtifactIds}
                copiedPath={copiedArtifactPath}
                onOpenPath={(path) => void openArtifactPath(path)}
                onCopyPath={(path) => void copyArtifactPath(path)}
              />
              {cleanupPlan ? (
                <ManagedArtifactCleanupPlanView
                  plan={cleanupPlan}
                  copiedPath={copiedArtifactPath}
                  onOpenPath={(path) => void openArtifactPath(path)}
                  onCopyPath={(path) => void copyArtifactPath(path)}
                  onSelectArtifactIds={updateSelectedArtifactIds}
                />
              ) : null}
            </>
          ) : null}
        </Stack>
      </section>
    </Stack>
  );
}
