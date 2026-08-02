import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
} from "@mui/material";
import type { WorkspaceRuntimePreflightFixPlan } from "../lib/workspaceRuntimePreflightFixes";
import type { WorkspaceRuntimePortFixDraft } from "../hooks/useWorkspaceRuntimePreflightFix";
import { useI18n, type Translate } from "../i18n";
import { CheckIcon, PlayIcon, PlusIcon, SettingsIcon } from "./AppIcons";
import { AppActionDialog } from "./AppActionDialog";

export type WorkspaceRuntimePreflightFixDialogProps = {
  plan: WorkspaceRuntimePreflightFixPlan | null;
  busy: boolean;
  error: string;
  portDraft: WorkspaceRuntimePortFixDraft;
  onClose: () => void;
  onPortDraftChange: (patch: Partial<WorkspaceRuntimePortFixDraft>) => void;
  onConfirm: () => Promise<boolean> | boolean;
};

export function WorkspaceRuntimePreflightFixDialog({
  plan,
  busy,
  error,
  portDraft,
  onClose,
  onPortDraftChange,
  onConfirm,
}: WorkspaceRuntimePreflightFixDialogProps) {
  const { t } = useI18n();
  const portPlan = plan?.kind === "changePort" ? plan : null;
  const profilePlan = plan?.kind === "createProfile" ? plan : null;
  const confirmLabel = portPlan
    ? t("使用 {port} 启动", {
        port: portDraft.portText || portPlan.suggestedPort,
      })
    : plan?.confirmLabel
      ? t(plan.confirmLabel)
      : t("执行修复");
  const busyLabel = portPlan
    ? portDraft.saveProfile
      ? t("正在保存并启动")
      : t("正在启动")
    : profilePlan
      ? t("正在创建")
      : plan?.kind === "resetProfile"
        ? t("正在恢复")
        : t("正在启动");

  return (
    <AppActionDialog
      open={Boolean(plan)}
      onClose={onClose}
      busy={busy}
      className="overview-runtime-fix-dialog"
      title={t("快速修复")}
      subtitle={translatedPlanTitle(plan, t)}
      icon={<SettingsIcon />}
      contentIcon={false}
      tone="primary"
      actions={
        <>
          <Button
            variant="outlined"
            color="inherit"
            onClick={onClose}
            disabled={busy}
            className="app-action-dialog-cancel"
          >
            {t("取消")}
          </Button>
          <Button
            autoFocus
            variant="contained"
            startIcon={
              busy ? (
                <CircularProgress size={13} color="inherit" />
              ) : profilePlan ? (
                <PlusIcon fontSize="small" />
              ) : plan?.kind === "resetProfile" ? (
                <CheckIcon fontSize="small" />
              ) : (
                <PlayIcon fontSize="small" />
              )
            }
            onClick={() => void onConfirm()}
            disabled={busy || !plan}
            className="app-action-dialog-confirm"
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="overview-runtime-fix-summary">
        {translatedPlanSummary(plan, t)}
      </p>
      <div className="overview-runtime-fix-steps">
        {plan?.steps.map((step, index) => (
          <div key={step.key}>
            <i>{index + 1}</i>
            <span>
              <strong>{t(step.label)}</strong>
              <small>{translatedStepDetail(plan, step.key, step.detail, t)}</small>
            </span>
          </div>
        ))}
      </div>
      {portPlan ? (
        <div className="overview-runtime-port-fix-options">
          <TextField
            label={t("本次启动端口")}
            type="number"
            size="small"
            value={portDraft.portText}
            onChange={(event) =>
              onPortDraftChange({ portText: event.target.value })
            }
            inputProps={{ min: 1, max: 65_535, step: 1 }}
            disabled={busy}
            fullWidth
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={portDraft.saveProfile}
                onChange={(event) =>
                  onPortDraftChange({ saveProfile: event.target.checked })
                }
              />
            }
            label={t("同时保存为启动档案")}
            disabled={busy}
          />
          {portDraft.saveProfile ? (
            <>
              <TextField
                label={t("启动档案名称")}
                size="small"
                value={portDraft.profileLabel}
                onChange={(event) =>
                  onPortDraftChange({ profileLabel: event.target.value })
                }
                disabled={busy}
                fullWidth
              />
              <small>{t("保存到项目配置，所有工作区均可选择。")}</small>
            </>
          ) : null}
        </div>
      ) : null}
      {profilePlan ? (
        <div className="overview-runtime-profile-fix-options">
          <TextField
            label={t("启动档案名称")}
            size="small"
            value={portDraft.profileLabel}
            onChange={(event) =>
              onPortDraftChange({ profileLabel: event.target.value })
            }
            disabled={busy}
            fullWidth
          />
          <small>
            {t("继承项目基础命令与目录，仅保存检测端口 {port}。", {
              port: profilePlan.expectedPort,
            })}
          </small>
        </div>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </AppActionDialog>
  );
}

function translatedPlanTitle(
  plan: WorkspaceRuntimePreflightFixPlan | null,
  t: Translate,
) {
  if (!plan) {
    return undefined;
  }
  if (plan.kind === "startProxy") {
    const name =
      plan.fix.profileName?.trim() || plan.fix.profileId?.trim() || "";
    return t("启动 {name}", { name });
  }
  return t(plan.title);
}

function translatedPlanSummary(
  plan: WorkspaceRuntimePreflightFixPlan | null,
  t: Translate,
) {
  if (!plan) {
    return "";
  }
  if (plan.fix.description.trim()) {
    return plan.summary;
  }
  switch (plan.kind) {
    case "startProxy":
      return t("启动已绑定的本地代理，成功后重新检查项目运行条件。");
    case "createProfile":
      return t("根据已检测的项目运行信息生成可复用启动档案。");
    case "resetProfile":
      return t("清除已失效的工作区启动档案选择，恢复项目基础配置。");
    case "changePort":
      return t("端口 {currentPort} 已被占用，使用 {suggestedPort} 启动当前项目。", {
        currentPort: plan.currentPort,
        suggestedPort: plan.suggestedPort,
      });
  }
}

function translatedStepDetail(
  plan: WorkspaceRuntimePreflightFixPlan,
  stepKey: string,
  detail: string,
  t: Translate,
) {
  if (plan.kind === "resetProfile") {
    return t(detail);
  }
  if (plan.kind === "startProxy" && stepKey === "verify") {
    return t(detail);
  }
  if (plan.kind === "changePort") {
    if (stepKey === "occupied") {
      return t("{port} · 已被占用", { port: plan.currentPort });
    }
    if (stepKey === "override") {
      return t("{port} · Vite strictPort", { port: plan.suggestedPort });
    }
    if (stepKey === "persist") {
      return t(detail);
    }
  }
  return detail;
}
