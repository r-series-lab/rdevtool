import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  ProjectDebugProfileSummary,
  ProjectRuntimeEntry,
  ProjectRuntimeStartPromptMode,
} from "../app-types";
import { useI18n, type Translate } from "../i18n";
import { useWorkspaceRuntimePreflight } from "../hooks/useWorkspaceRuntimePreflight";
import { AppActionDialog } from "./AppActionDialog";
import { PlayIcon, RefreshIcon } from "./AppIcons";

export const PROJECT_RUNTIME_START_PROMPT_OPTIONS: Array<{
  value: ProjectRuntimeStartPromptMode;
  label: string;
}> = [
  { value: "auto", label: "仅必要时确认" },
  { value: "always", label: "每次确认" },
  { value: "never", label: "直接启动" },
];

export function RuntimeStartPromptModeControl({
  value,
  onChange,
  label = "快捷启动",
  disabled = false,
}: {
  value: ProjectRuntimeStartPromptMode;
  onChange: (value: ProjectRuntimeStartPromptMode) => void;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const translatedLabel = t(label);

  return (
    <TextField
      select
      size="small"
      label={translatedLabel}
      value={value}
      disabled={disabled}
      onChange={(event) =>
        onChange(event.target.value as ProjectRuntimeStartPromptMode)
      }
      className="runtime-start-prompt-mode-control"
      inputProps={{ "aria-label": translatedLabel }}
    >
      {PROJECT_RUNTIME_START_PROMPT_OPTIONS.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {t(option.label)}
        </MenuItem>
      ))}
    </TextField>
  );
}

function selectedProfile(
  entry: ProjectRuntimeEntry | null,
  profileKey: string,
): ProjectDebugProfileSummary | null {
  return (
    entry?.debugProfiles.find((profile) => profile.key === profileKey) ?? null
  );
}

function profileSummary(
  entry: ProjectRuntimeEntry,
  profile: ProjectDebugProfileSummary | null,
  t: Translate,
) {
  return [
    {
      label: t("启动命令"),
      value:
        profile?.command?.trim() || entry.command?.trim() || t("未配置"),
      mono: true,
    },
    {
      label: t("工作目录"),
      value:
        profile?.cwd?.trim() ||
        entry.cwd?.trim() ||
        entry.repoPath?.trim() ||
        t("未配置"),
      mono: true,
    },
    {
      label: t("端口"),
      value: profile?.expectedPort
        ? String(profile.expectedPort)
        : t("自动识别"),
    },
    {
      label: t("共享环境"),
      value: profile?.runtimeProfile?.trim() || t("默认"),
    },
  ];
}

export type ProjectRuntimeStartDialogProps = {
  open: boolean;
  entry: ProjectRuntimeEntry | null;
  initialProfileKey: string;
  defaultSelectionKnown: boolean;
  promptMode: ProjectRuntimeStartPromptMode;
  onClose: () => void;
  onPromptModeChange: (mode: ProjectRuntimeStartPromptMode) => void;
  onConfirm: (
    profileKey: string,
    saveAsDefault: boolean,
  ) => Promise<unknown> | unknown;
};

export function ProjectRuntimeStartDialog({
  open,
  entry,
  initialProfileKey,
  defaultSelectionKnown,
  promptMode,
  onClose,
  onPromptModeChange,
  onConfirm,
}: ProjectRuntimeStartDialogProps) {
  const [profileKey, setProfileKey] = useState(initialProfileKey);
  const [saveAsDefault, setSaveAsDefault] = useState(!defaultSelectionKnown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useI18n();

  useEffect(() => {
    if (!open) {
      return;
    }
    setProfileKey(initialProfileKey);
    setSaveAsDefault(!defaultSelectionKnown);
    setBusy(false);
    setError("");
  }, [
    defaultSelectionKnown,
    entry?.key,
    initialProfileKey,
    open,
  ]);

  const profile = selectedProfile(entry, profileKey);
  const summary = useMemo(
    () => (entry ? profileSummary(entry, profile, t) : []),
    [entry, profile, t],
  );
  const { preflight, refresh } = useWorkspaceRuntimePreflight({
    projectKey: entry?.key ?? "",
    debugProfileKey: profileKey,
    enabled: open && Boolean(entry?.canStart),
    running: false,
  });
  const blocking = preflight.statusKey.trim().toLowerCase() === "error";
  const preflightPending = preflight.loading || preflight.updatedAtMs === null;
  const visibleChecks = preflight.checks.filter(
    (check) =>
      check.statusKey === "error" || check.statusKey === "warning",
  );

  async function confirmStart() {
    if (!entry || busy || preflightPending || blocking) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await onConfirm(profileKey, saveAsDefault);
      if (result === false) {
        setError(t("项目未启动，请查看活动记录或页面提示。"));
        return;
      }
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppActionDialog
      open={open}
      onClose={onClose}
      title={
        entry
          ? t("启动 {name}", { name: entry.name })
          : t("启动项目")
      }
      subtitle={t("确认本次使用的启动档案")}
      icon={<PlayIcon />}
      contentIcon={false}
      tone="primary"
      busy={busy}
      maxWidth="sm"
      className="project-runtime-start-dialog"
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
            variant="contained"
            startIcon={<PlayIcon />}
            disabled={
              !entry?.canStart || busy || preflightPending || blocking
            }
            onClick={() => void confirmStart()}
            className="app-action-dialog-confirm"
          >
            {busy ? t("正在启动") : t("启动项目")}
          </Button>
        </>
      }
    >
      {entry ? (
        <Stack spacing={1.1}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={0.8}
            alignItems="stretch"
          >
            <TextField
              select
              size="small"
              label={t("启动档案")}
              value={profileKey}
              onChange={(event) => setProfileKey(event.target.value)}
              fullWidth
              inputProps={{
                "aria-label": t("{name} 启动档案", { name: entry.name }),
              }}
            >
              <MenuItem value="">{t("项目基础启动")}</MenuItem>
              {entry.debugProfiles.map((item) => (
                <MenuItem key={item.key} value={item.key}>
                  {item.label || item.key}
                  {item.envCount > 0
                    ? t(" · {count} 变量", { count: item.envCount })
                    : ""}
                </MenuItem>
              ))}
            </TextField>
            <RuntimeStartPromptModeControl
              value={promptMode}
              onChange={onPromptModeChange}
            />
          </Stack>

          <Box className="project-runtime-start-summary">
            {summary.map((item) => (
              <Box key={item.label} className="project-runtime-start-summary-row">
                <Typography variant="caption">{item.label}</Typography>
                <Typography
                  variant="caption"
                  className={item.mono ? "is-mono" : undefined}
                >
                  {item.value}
                </Typography>
              </Box>
            ))}
            <Stack
              direction="row"
              spacing={0.5}
              useFlexGap
              flexWrap="wrap"
              className="project-runtime-start-summary-tags"
            >
              <Chip
                size="small"
                variant="outlined"
                label={t("{count} 个档案变量", {
                  count: profile?.envCount ?? 0,
                })}
              />
              <Chip
                size="small"
                variant="outlined"
                label={
                  profile?.networkProxy?.enabled
                    ? t("网络代理开")
                    : t("网络代理关")
                }
              />
              <Chip
                size="small"
                variant="outlined"
                label={
                  profile?.localProxy?.enabled
                    ? t("本地代理开")
                    : t("本地代理关")
                }
              />
            </Stack>
          </Box>

          <Box
            className={`project-runtime-start-preflight is-${
              preflight.loading
                ? "loading"
                : preflight.statusKey || "idle"
            }`}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={0.8}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption">
                  {preflight.loading
                    ? t("正在检查启动条件")
                    : preflight.statusLabel || t("等待启动预检")}
                </Typography>
                <Typography variant="caption">
                  {preflight.summary || t("检查命令、端口、代理和运行环境。")}
                </Typography>
              </Box>
              <Button
                size="small"
                color="inherit"
                startIcon={<RefreshIcon fontSize="small" />}
                onClick={refresh}
                disabled={preflight.loading}
              >
                {t("刷新")}
              </Button>
            </Stack>
            {visibleChecks.length > 0 ? (
              <Stack spacing={0.4} className="project-runtime-start-checks">
                {visibleChecks.slice(0, 3).map((check) => (
                  <Box key={check.key} className={`is-${check.statusKey}`}>
                    <span
                      className="project-runtime-start-check-dot"
                      aria-hidden="true"
                    />
                    <Typography variant="caption">
                      <strong>{check.title}</strong>
                      {check.detail || check.statusLabel}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            ) : null}
          </Box>

          <FormControlLabel
            className="project-runtime-start-default"
            control={
              <Checkbox
                size="small"
                checked={saveAsDefault}
                onChange={(event) => setSaveAsDefault(event.target.checked)}
              />
            }
            label={t("设为当前工作区默认档案")}
          />
          {error ? (
            <Typography
              variant="caption"
              color="error"
              role="alert"
              sx={{ overflowWrap: "anywhere" }}
            >
              {error}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
    </AppActionDialog>
  );
}
