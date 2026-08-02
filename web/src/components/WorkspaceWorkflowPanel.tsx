import { useMemo, useState } from "react";
import {
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { TrayPinnedAction } from "../lib/trayPins";
import { useI18n, type Translate } from "../i18n";
import {
  suggestedWorkspaceWorkflowSteps,
  validateWorkspaceWorkflowChain,
  type WorkspaceWorkflowChain,
  type WorkspaceWorkflowRunState,
} from "../lib/workflowChains";
import { AppActionDialog } from "./AppActionDialog";
import {
  CheckIcon,
  CollapseIcon,
  EditIcon,
  ExpandIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  WorkflowIcon,
} from "./AppIcons";

export type WorkspaceWorkflowActionOption = {
  action: TrayPinnedAction;
  label: string;
  kindLabel: string;
};

type WorkspaceWorkflowPanelProps = {
  workspaceKey: string;
  chains: WorkspaceWorkflowChain[];
  actions: WorkspaceWorkflowActionOption[];
  runStates: WorkspaceWorkflowRunState[];
  runningChainId?: string;
  onSave: (chain: WorkspaceWorkflowChain) => Promise<void> | void;
  onDelete: (chainId: string) => Promise<void> | void;
  onEnabledChange: (
    chainId: string,
    enabled: boolean,
  ) => Promise<void> | void;
  onRun: (chain: WorkspaceWorkflowChain) => Promise<void> | void;
  onCancelRun: (run: WorkspaceWorkflowRunState) => Promise<void> | void;
};

function chainId(workspaceKey: string) {
  return `${workspaceKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultChainName(actions: TrayPinnedAction[]) {
  return actions.length === 3 ? "推送、合并并构建" : "工作区联动";
}

function actionKindLabel(action: TrayPinnedAction, t: Translate) {
  if (action.kind === "branch.replay") return "Git";
  if (action.kind === "build.replay" || action.kind === "deploy.replay") {
    return t("构建");
  }
  if (action.kind.startsWith("project.runtime.")) return t("运行");
  if (action.kind.startsWith("proxy.")) return t("代理");
  if (action.kind.startsWith("link.")) return "Link";
  return t("操作");
}

function runStatusLabel(run: WorkspaceWorkflowRunState, t: Translate) {
  if (run.status === "running") {
    return t("运行中 {completed}/{total}", {
      completed: run.completedStepCount,
      total: run.totalStepCount,
    });
  }
  if (run.status === "success") {
    return t("已完成");
  }
  if (run.status === "failed") {
    return t("失败");
  }
  return t("已停止");
}

function workflowValidationMessage(error: string, t: Translate) {
  const stepMatch = error.match(
    /^第 (\d+) 步(不属于当前工作区|不是可联动动作)$/,
  );
  if (stepMatch) {
    const params = { count: stepMatch[1] };
    if (stepMatch[2] === "不属于当前工作区") {
      return t("第 {count} 步不属于当前工作区", params);
    }
    return t("第 {count} 步不是可联动动作", params);
  }
  return t(error);
}

export function WorkspaceWorkflowPanel({
  workspaceKey,
  chains,
  actions,
  runStates,
  runningChainId = "",
  onSave,
  onDelete,
  onEnabledChange,
  onRun,
  onCancelRun,
}: WorkspaceWorkflowPanelProps) {
  const { t } = useI18n();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingChain, setEditingChain] =
    useState<WorkspaceWorkflowChain | null>(null);
  const [name, setName] = useState("");
  const [stepKeys, setStepKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const editorActionOptions = useMemo(() => {
    const options = new Map(
      actions.map((option) => [option.action.dedupeKey, option]),
    );
    chains.forEach((chain) => {
      chain.steps.forEach((step) => {
        if (!options.has(step.action.dedupeKey)) {
          options.set(step.action.dedupeKey, {
            action: step.action,
            label: step.label,
            kindLabel: actionKindLabel(step.action, t),
          });
        }
      });
    });
    return Array.from(options.values());
  }, [actions, chains, t]);
  const actionByKey = useMemo(
    () =>
      new Map(
        editorActionOptions.map((option) => [
          option.action.dedupeKey,
          option,
        ]),
      ),
    [editorActionOptions],
  );
  const runStateByChainId = useMemo(
    () => new Map(runStates.map((run) => [run.chainId, run])),
    [runStates],
  );
  const hasActiveRun =
    Boolean(runningChainId) ||
    runStates.some((run) => run.status === "running");

  function openCreate() {
    const suggested = suggestedWorkspaceWorkflowSteps(
      actions.map((option) => option.action),
    );
    const initial = suggested.length >= 2
      ? suggested
      : actions.slice(0, Math.min(2, actions.length)).map((item) => item.action);
    setEditingChain(null);
    setName(defaultChainName(initial));
    setStepKeys(initial.map((action) => action.dedupeKey));
    setEditorError("");
    setEditorOpen(true);
  }

  function openEdit(chain: WorkspaceWorkflowChain) {
    setEditingChain(chain);
    setName(chain.name);
    setStepKeys(chain.steps.map((step) => step.action.dedupeKey));
    setEditorError("");
    setEditorOpen(true);
  }

  function moveStep(index: number, offset: -1 | 1) {
    setStepKeys((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    const now = new Date().toISOString();
    const selected = stepKeys
      .map((key) => actionByKey.get(key))
      .filter((option): option is WorkspaceWorkflowActionOption =>
        Boolean(option),
      );
    const next: WorkspaceWorkflowChain = {
      id: editingChain?.id ?? chainId(workspaceKey),
      workspaceKey,
      name: name.trim(),
      enabled: editingChain?.enabled ?? true,
      steps: selected.map((option, index) => ({
        id: editingChain?.steps[index]?.id ?? `step-${index + 1}`,
        label: option.label,
        action: option.action,
      })),
      createdAt: editingChain?.createdAt ?? now,
      updatedAt: now,
    };
    const validation = validateWorkspaceWorkflowChain(next);
    if (!validation.valid) {
      setEditorError(
        validation.errors
          .map((error) => workflowValidationMessage(error, t))
          .join(t("；")),
      );
      return;
    }
    setSaving(true);
    setEditorError("");
    try {
      await onSave(next);
      setEditorOpen(false);
    } catch (error) {
      setEditorError(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overview-workflow-panel">
      <div className="overview-section-heading">
        <div className="overview-section-heading-copy">
          <Typography className="overview-section-label">{t("联动操作")}</Typography>
          <Chip
            size="small"
            className="overview-count-chip"
            label={chains.length}
          />
        </div>
        <Tooltip
          title={
            actions.length >= 2
              ? t("新建联动流程")
              : t("至少标记两个可执行动作后才能创建")
          }
        >
          <span>
            <IconButton
              size="small"
              className="overview-section-action-button"
              onClick={openCreate}
              disabled={actions.length < 2}
              aria-label={t("新建联动流程")}
            >
              <PlusIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </div>

      {chains.length === 0 ? (
        <div className="overview-workflow-empty">
          <WorkflowIcon fontSize="small" />
          <span>
            {actions.length >= 2
              ? t("把已标记的动作串成一条工作区流程")
              : t("标记可执行动作后可创建联动流程")}
          </span>
        </div>
      ) : (
        <div className="overview-workflow-list">
          {chains.map((chain) => {
            const run = runStateByChainId.get(chain.id);
            const starting = runningChainId === chain.id;
            const running = starting || run?.status === "running";
            const runDetail =
              run?.status === "running"
                ? t("当前：{step}", { step: run.activeStepLabel })
                : run?.status === "failed" || run?.status === "cancelled"
                  ? run.detail
                  : "";
            return (
              <div
                key={chain.id}
                className={`overview-workflow-row${chain.enabled ? "" : " is-disabled"}`}
              >
                <div className="overview-workflow-copy">
                  <div className="overview-workflow-title">
                    <strong>{chain.name}</strong>
                    {run ? (
                      <span
                        className={`overview-workflow-state is-${run.status}`}
                        title={run.detail || run.activeStepLabel}
                      >
                        {runStatusLabel(run, t)}
                      </span>
                    ) : null}
                  </div>
                  <div className="overview-workflow-steps">
                    {chain.steps.map((step, index) => (
                      <span key={step.id} className="overview-workflow-step">
                        {index > 0 ? (
                          <span className="overview-workflow-arrow">›</span>
                        ) : null}
                        <span>{step.label}</span>
                      </span>
                    ))}
                  </div>
                  {runDetail ? (
                    <span
                      className="overview-workflow-run-detail"
                      title={runDetail}
                    >
                      {runDetail}
                    </span>
                  ) : null}
                </div>
                <div className="overview-workflow-tools">
                  <Tooltip title={chain.enabled ? t("停用流程") : t("启用流程")}>
                    <Switch
                      className="overview-workflow-switch"
                      size="small"
                      checked={chain.enabled}
                      disabled={running}
                      onChange={(_, checked) =>
                        void onEnabledChange(chain.id, checked)
                      }
                    />
                  </Tooltip>
                  <Tooltip title={t("编辑流程")}>
                    <IconButton
                      size="small"
                      disabled={running}
                      onClick={() => openEdit(chain)}
                      aria-label={t("编辑 {name}", { name: chain.name })}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("删除流程")}>
                    <IconButton
                      size="small"
                      disabled={running}
                      onClick={() => void onDelete(chain.id)}
                      aria-label={t("删除 {name}", { name: chain.name })}
                    >
                      <TrashIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {run?.status === "running" ? (
                    <Tooltip title={t("停止尚未开始的后续步骤")}>
                      <IconButton
                        size="small"
                        className="overview-workflow-stop"
                        onClick={() => void onCancelRun(run)}
                        aria-label={t("停止 {name} 的后续步骤", { name: chain.name })}
                      >
                        <StopIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      title={
                        chain.enabled
                          ? hasActiveRun
                            ? t("已有联动流程正在运行")
                            : t("运行流程")
                          : t("流程已停用")
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          className="overview-workflow-run"
                          disabled={!chain.enabled || hasActiveRun}
                          onClick={() => void onRun(chain)}
                          aria-label={t("运行 {name}", { name: chain.name })}
                        >
                          {starting ? (
                            <CircularProgress size={14} thickness={5} />
                          ) : (
                            <PlayIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AppActionDialog
        open={editorOpen}
        title={editingChain ? t("编辑联动流程") : t("新建联动流程")}
        subtitle={t("工作区内已标记的可执行动作")}
        icon={<WorkflowIcon />}
        contentIcon={false}
        maxWidth="sm"
        busy={saving}
        onClose={() => setEditorOpen(false)}
        actions={
          <>
            <Button color="inherit" onClick={() => setEditorOpen(false)}>
              {t("取消")}
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon />}
              disabled={saving}
              onClick={() => void save()}
            >
              {t("保存流程")}
            </Button>
          </>
        }
      >
        <Stack className="workspace-workflow-editor" spacing={1.2}>
          <TextField
            label={t("流程名称")}
            size="small"
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
          />
          <div className="workspace-workflow-editor-steps">
            {stepKeys.map((key, index) => (
              <div
                key={`${index}:${key}`}
                className="workspace-workflow-editor-step"
              >
                <span className="workspace-workflow-editor-index">
                  {index + 1}
                </span>
                <TextField
                  select
                  size="small"
                  label={t("步骤 {count}", { count: index + 1 })}
                  value={key}
                  onChange={(event) =>
                    setStepKeys((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                  fullWidth
                >
                  {editorActionOptions.map((option) => (
                    <MenuItem
                      key={option.action.dedupeKey}
                      value={option.action.dedupeKey}
                      disabled={
                        stepKeys.includes(option.action.dedupeKey) &&
                        option.action.dedupeKey !== key
                      }
                    >
                      {option.kindLabel} · {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton
                  size="small"
                  onClick={() => moveStep(index, -1)}
                  disabled={index === 0}
                  aria-label={t("上移步骤 {count}", { count: index + 1 })}
                >
                  <CollapseIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => moveStep(index, 1)}
                  disabled={index === stepKeys.length - 1}
                  aria-label={t("下移步骤 {count}", { count: index + 1 })}
                >
                  <ExpandIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() =>
                    setStepKeys((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  disabled={stepKeys.length <= 2}
                  aria-label={t("删除步骤 {count}", { count: index + 1 })}
                >
                  <TrashIcon fontSize="small" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button
            size="small"
            startIcon={<PlusIcon />}
            disabled={actions.every((option) =>
              stepKeys.includes(option.action.dedupeKey),
            )}
            onClick={() => {
              const next = actions.find(
                (option) => !stepKeys.includes(option.action.dedupeKey),
              );
              if (next) {
                setStepKeys((current) => [
                  ...current,
                  next.action.dedupeKey,
                ]);
              }
            }}
          >
            {t("添加步骤")}
          </Button>
          {editorError ? (
            <Typography className="workspace-workflow-editor-error">
              {editorError}
            </Typography>
          ) : null}
        </Stack>
      </AppActionDialog>
    </div>
  );
}
