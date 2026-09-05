import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type {
  LinkConfig,
  LinkPlan,
  ProjectConfigDraft,
  ProjectConfigEditorState,
  ProjectWorkspaceSummary,
  ProxyDashboard,
  ProxyProfile,
  RuntimeProfileDraft,
  WebActionSummary,
} from "../app-types";
import {
  LINK_UI_PROFILES,
  type LinkUiProfileKey,
  linkUiProfileDefinition,
  uiProfileHasFeature,
} from "../lib/uiProfiles";
import {
  type LinkWizardDraft,
  type ProxyActionType,
  type WebActionMode,
  buildInitialLinkDraft,
  buildLinkConfig,
  buildLinkDraftFromConfig,
  defaultDebugProfile,
  linkCompatibility,
  normalizeLinkKeyInput,
} from "../lib/linkEditor";
import { CheckIcon, WorkflowIcon } from "./AppIcons";
import { ConfigSourceBar } from "./ConfigSourceBar";
import { ConfigSourceManagerDialog } from "./ConfigSourceManagerDialog";
import { useConfigSource } from "../hooks/useConfigSource";
import { useI18n, type Translate } from "../i18n";
import { configSourceSupports } from "../lib/configSources";
import { translateInternalMessage } from "../i18n/internalMessages";

export type LinkToolWizardSaveResult = {
  link: LinkConfig;
  plan: LinkPlan;
};

type LinkToolWizardDialogProps = {
  open: boolean;
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  projects: ProjectConfigDraft[];
  webActions: WebActionSummary[];
  initialLinkKey?: string | null;
  onClose: () => void;
  onSaved?: (result: LinkToolWizardSaveResult) => void | Promise<void>;
};

type LinkSaveResult = {
  link: LinkConfig;
  plan: LinkPlan;
};

type LinkWizardRuntimeProfileLoader = (
  sourceId: string,
) => Promise<ProjectConfigEditorState>;

export async function loadLinkWizardRuntimeProfiles(
  sourceId: string,
  loadEditor: LinkWizardRuntimeProfileLoader = (resolvedSourceId) =>
    invoke<ProjectConfigEditorState>("get_project_config_editor", {
      sourceId: resolvedSourceId,
    }),
  emptySourceError = "运行配置源不能为空",
) {
  const resolvedSourceId = sourceId.trim();
  if (!resolvedSourceId) {
    throw new Error(emptySourceError);
  }
  const state = await loadEditor(resolvedSourceId);
  return state.runtimeProfiles ?? [];
}

function linkUiProfileLabel(value: LinkUiProfileKey, t: Translate) {
  return t(linkUiProfileDefinition(value).label);
}

function proxyListenUrl(profile: ProxyProfile) {
  return `http://${profile.listenHost}:${profile.listenPort}`;
}

function webActionKindLabel(kind: string | null | undefined, t: Translate) {
  return kind === "request" ? t("请求动作") : t("脚本动作");
}

function translateCompatibilityMessage(message: string, t: Translate) {
  let match = message.match(/^这是旧版链路，保存后会升级为 v(.+)。$/);
  if (match) {
    return t("这是旧版链路，保存后会升级为 v{version}。", {
      version: match[1],
    });
  }
  match = message.match(/^保存后会从 v(.+) 升级为 v(.+)。$/);
  if (match) {
    return t("保存后会从 v{sourceVersion} 升级为 v{targetVersion}。", {
      sourceVersion: match[1],
      targetVersion: match[2],
    });
  }
  match = message.match(/^该链路使用 v(.+)，当前应用仅支持到 v(.+)。$/);
  if (match) {
    return t("该链路使用 v{sourceVersion}，当前应用仅支持到 v{targetVersion}。", {
      sourceVersion: match[1],
      targetVersion: match[2],
    });
  }
  match = message.match(/^未识别界面配置 (.+)，当前按 (.+) 展示。$/);
  if (match) {
    return t("未识别界面配置 {profile}，当前按 {fallback} 展示。", {
      profile: match[1],
      fallback: match[2],
    });
  }
  match = message.match(/^(\d+) 个扩展步骤会按原顺序保留。$/);
  if (match) {
    return t("{count} 个扩展步骤会按原顺序保留。", {
      count: match[1],
    });
  }
  return message;
}

export function LinkToolWizardDialog({
  open,
  activeProjectWorkspaceKey,
  projectWorkspaces,
  projects,
  webActions,
  initialLinkKey,
  onClose,
  onSaved,
}: LinkToolWizardDialogProps) {
  const { t } = useI18n();
  const {
    sources: configSources,
    selectedSource: selectedConfigSource,
    selectedSourceId,
    sourceBusy,
    sourceError,
    sourceStatus,
    refreshSources,
    adoptSources,
    selectSource,
  } = useConfigSource({
    workspaceKey: activeProjectWorkspaceKey,
    requiredCapability: "link",
  });
  const {
    selectedSource: selectedProxyConfigSource,
    selectedSourceId: selectedProxySourceId,
    sourceBusy: proxySourceBusy,
    refreshSources: refreshProxySources,
  } = useConfigSource({
    workspaceKey: activeProjectWorkspaceKey,
    requiredCapability: "proxy",
  });
  const {
    selectedSource: selectedRuntimeConfigSource,
    selectedSourceId: selectedRuntimeSourceId,
    sourceBusy: runtimeSourceBusy,
    sourceError: runtimeSourceError,
    refreshSources: refreshRuntimeSources,
  } = useConfigSource({
    workspaceKey: activeProjectWorkspaceKey,
    requiredCapability: "runtime",
  });
  const [draft, setDraft] = useState<LinkWizardDraft>(() =>
    buildInitialLinkDraft({
      activeProjectWorkspaceKey,
      projectWorkspaces,
      projects,
      webActions,
    }),
  );
  const [proxyProfiles, setProxyProfiles] = useState<ProxyProfile[]>([]);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfileDraft[]>(
    [],
  );
  const [runtimeProfilesLoading, setRuntimeProfilesLoading] = useState(false);
  const [runtimeProfilesError, setRuntimeProfilesError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<LinkPlan | null>(null);
  const [sourceLink, setSourceLink] = useState<LinkConfig | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(false);
  const loadRequestRef = useRef(0);
  const runtimeLoadRequestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    void Promise.all([
      refreshSources(),
      refreshProxySources(),
      refreshRuntimeSources(),
    ]).catch((reason) => setError(String(reason)));
  }, [open, refreshProxySources, refreshRuntimeSources, refreshSources]);

  useEffect(() => {
    if (!open || !selectedRuntimeConfigSource) {
      setRuntimeProfiles([]);
      setRuntimeProfilesLoading(false);
      setRuntimeProfilesError("");
      return;
    }
    const requestId = runtimeLoadRequestRef.current + 1;
    runtimeLoadRequestRef.current = requestId;
    setRuntimeProfiles([]);
    setRuntimeProfilesLoading(true);
    setRuntimeProfilesError("");
    void loadLinkWizardRuntimeProfiles(
      selectedRuntimeSourceId,
      undefined,
      t("运行配置源不能为空"),
    )
      .then((profiles) => {
        if (runtimeLoadRequestRef.current !== requestId) return;
        setRuntimeProfiles(profiles);
      })
      .catch((reason) => {
        if (runtimeLoadRequestRef.current !== requestId) return;
        setRuntimeProfiles([]);
        setRuntimeProfilesError(
          t("无法从运行配置源 {source} 读取运行配置：{reason}", {
            source: selectedRuntimeConfigSource.name,
            reason: String(reason),
          }),
        );
      })
      .finally(() => {
        if (runtimeLoadRequestRef.current === requestId) {
          setRuntimeProfilesLoading(false);
        }
      });

    return () => {
      if (runtimeLoadRequestRef.current === requestId) {
        runtimeLoadRequestRef.current += 1;
      }
    };
  }, [open, selectedRuntimeConfigSource, selectedRuntimeSourceId, t]);

  useEffect(() => {
    if (!open || !selectedConfigSource) {
      return;
    }
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    const initialDraft = buildInitialLinkDraft({
      activeProjectWorkspaceKey,
      projectWorkspaces,
      projects,
      webActions,
      defaultUiProfile: selectedConfigSource.uiProfile,
    });
    setDraft(initialDraft);
    setDraftDirty(false);
    setSourceLink(null);
    setPlan(null);
    setError("");
    const linkKey = initialLinkKey?.trim();
    if (!linkKey) {
      setLoadingLink(false);
    } else {
      setLoadingLink(true);
      void invoke<LinkConfig>("get_link", {
        sourceId: selectedSourceId,
        key: linkKey,
      })
        .then((link) => {
          if (loadRequestRef.current !== requestId) return;
          setSourceLink(link);
          setDraft(buildLinkDraftFromConfig(link, projects, webActions));
          setDraftDirty(false);
        })
        .catch((reason) => {
          if (loadRequestRef.current !== requestId) return;
          setDraft((current) => ({ ...current, key: normalizeLinkKeyInput(linkKey) }));
          setError(
            t("无法读取链路 {key}：{reason}", {
              key: linkKey,
              reason: String(reason),
            }),
          );
        })
        .finally(() => {
          if (loadRequestRef.current === requestId) setLoadingLink(false);
        });
    }

    setProxyLoading(true);
    void invoke<ProxyDashboard>("get_proxy_dashboard", {
      sourceId: selectedProxySourceId,
      workspaceKey: activeProjectWorkspaceKey,
    })
      .then((dashboard) => {
        if (loadRequestRef.current !== requestId) return;
        setProxyProfiles(dashboard.config.profiles);
        setDraft((current) => {
          if (current.proxyProfile || dashboard.config.profiles.length === 0) {
            return current;
          }
          return { ...current, proxyProfile: dashboard.config.profiles[0].id };
        });
      })
      .catch((reason) => {
        if (loadRequestRef.current !== requestId) return;
        setProxyProfiles([]);
        if (
          selectedProxyConfigSource &&
          configSourceSupports(selectedProxyConfigSource, "proxy")
        ) {
          setError(String(reason));
        }
      })
      .finally(() => {
        if (loadRequestRef.current === requestId) setProxyLoading(false);
      });

    return () => {
      if (loadRequestRef.current === requestId) {
        loadRequestRef.current += 1;
      }
    };
  }, [
    activeProjectWorkspaceKey,
    initialLinkKey,
    open,
    projectWorkspaces,
    projects,
    selectedConfigSource,
    selectedProxyConfigSource,
    selectedProxySourceId,
    selectedSourceId,
    t,
    webActions,
  ]);

  const selectedWorkspace = useMemo(
    () => projectWorkspaces.find((workspace) => workspace.key === draft.workspaceKey) ?? null,
    [draft.workspaceKey, projectWorkspaces],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.key === draft.project) ?? null,
    [draft.project, projects],
  );
  const selectedWebAction = useMemo(
    () => webActions.find((action) => action.key === draft.webActionKey) ?? null,
    [draft.webActionKey, webActions],
  );
  const activeProfile = linkUiProfileDefinition(draft.uiProfile);
  const hasProject = uiProfileHasFeature(activeProfile, "project");
  const hasLocalFile = uiProfileHasFeature(activeProfile, "localFile");
  const hasProxy = uiProfileHasFeature(activeProfile, "proxy");
  const hasRuntime = uiProfileHasFeature(activeProfile, "runtime");
  const hasProxyAction = uiProfileHasFeature(activeProfile, "proxyAction");
  const hasWebAction = uiProfileHasFeature(activeProfile, "webAction");
  const compatibility = sourceLink ? linkCompatibility(sourceLink) : null;

  function updateDraft(patch: Partial<LinkWizardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDraftDirty(true);
    setPlan(null);
  }

  async function handleSourceChange(nextSourceId: string) {
    if (nextSourceId === selectedSourceId || saving || loadingLink) {
      return;
    }
    if (draftDirty) {
      setError(t("请先保存或关闭当前链路改动，再切换配置源。"));
      return;
    }
    setError("");
    try {
      await selectSource(nextSourceId);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function selectUiProfile(uiProfile: LinkUiProfileKey) {
    const profile = linkUiProfileDefinition(uiProfile);
    updateDraft({
      uiProfile,
      includeLocalFile: uiProfileHasFeature(profile, "localFile"),
      includeProxy: uiProfileHasFeature(profile, "proxy"),
      includeRuntime: uiProfileHasFeature(profile, "runtime"),
    });
  }

  function validateDraft() {
    if (proxySourceBusy || proxyLoading || !selectedProxyConfigSource) {
      return t("代理配置源尚未就绪，请稍后重试");
    }
    if (
      runtimeSourceBusy ||
      runtimeProfilesLoading ||
      !selectedRuntimeConfigSource ||
      Boolean(runtimeProfilesError)
    ) {
      return t("运行配置源尚未就绪，请检查提示后重试");
    }
    if (!draft.key.trim()) {
      return t("Link Key 不能为空");
    }
    if (!draft.name.trim()) {
      return t("链路名称不能为空");
    }
    if (hasLocalFile || hasProxy || hasRuntime) {
      const hasEnabledStep =
        (hasLocalFile && draft.includeLocalFile) ||
        (hasProxy && draft.includeProxy) ||
        (hasRuntime && draft.includeRuntime);
      if (!hasEnabledStep) {
        return t("至少选择一个链路步骤");
      }
      if (
        ((hasLocalFile && draft.includeLocalFile) || (hasRuntime && draft.includeRuntime)) &&
        !draft.project
      ) {
        return t("本地覆盖文件和项目运行步骤需要选择项目");
      }
      if (hasProxy && draft.includeProxy && !draft.proxyProfile) {
        return t("代理步骤需要选择代理服务");
      }
      if (hasRuntime && draft.includeRuntime && draft.expectedPort) {
        const port = Number(draft.expectedPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return t("预期端口必须在 1-65535 之间");
        }
      }
    }
    if (hasProxyAction && !draft.proxyProfile) {
      return t("代理链路需要选择代理服务");
    }
    if (hasWebAction && !draft.webActionKey) {
      return t("网页动作链路需要选择 Web Action");
    }
    return "";
  }

  async function saveLink() {
    const validation = validateDraft();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const link = buildLinkConfig(draft, sourceLink);
      const result = await invoke<LinkSaveResult>("save_link", {
        sourceId: selectedSourceId,
        proxySourceId: selectedProxySourceId,
        runtimeSourceId: selectedRuntimeSourceId,
        workspaceKey: activeProjectWorkspaceKey,
        previousKey: sourceLink?.key || null,
        link,
      });
      setSourceLink(result.link);
      setPlan(result.plan);
      setDraftDirty(false);
      await onSaved?.(result);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  const previewLink = buildLinkConfig(draft, sourceLink);
  const summaryChips = (
    <>
      <Chip size="small" label={linkUiProfileLabel(draft.uiProfile, t)} />
      <Chip size="small" label={t("{count} 步", { count: previewLink.steps.length })} />
      {selectedConfigSource ? (
        <Chip size="small" label={t("源 {name}", { name: selectedConfigSource.name })} />
      ) : null}
      {draft.workspaceKey ? (
        <Chip size="small" label={t("工作区 {name}", { name: draft.workspaceKey })} />
      ) : null}
      {draft.project && hasProject ? (
        <Chip size="small" label={t("项目 {name}", { name: draft.project })} />
      ) : null}
      {draft.proxyProfile && (hasProxy || hasProxyAction) ? (
        <Chip size="small" label={t("代理 {name}", { name: draft.proxyProfile })} />
      ) : null}
      {draft.webActionKey && hasWebAction ? (
        <Chip size="small" label={t("动作 {name}", { name: draft.webActionKey })} />
      ) : null}
    </>
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        className="resource-link-wizard-dialog"
      >
      <DialogTitle>
        <Stack
          className="resource-link-wizard-title"
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1.2}
          minWidth={0}
        >
          <Stack direction="row" alignItems="center" spacing={1.1} minWidth={0}>
            <span className="resource-link-wizard-icon" aria-hidden="true">
              <WorkflowIcon fontSize="small" />
            </span>
            <Box className="resource-link-wizard-title-copy" minWidth={0}>
              <Typography variant="h6" noWrap>
                {initialLinkKey?.trim() ? t("编辑链路工具") : t("新建链路工具")}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {selectedConfigSource
                  ? `${selectedConfigSource.name} · ${t(activeProfile?.label ?? "链路配置")}`
                  : t("按链路类型生成对应配置界面。")}
              </Typography>
            </Box>
          </Stack>
          <Stack
            className="resource-link-wizard-title-metrics"
            direction="row"
            spacing={0.6}
            flexWrap="wrap"
            justifyContent="flex-end"
            useFlexGap
          >
            <Chip size="small" label={linkUiProfileLabel(draft.uiProfile, t)} />
            <Chip
              size="small"
              label={t("{count} 步", { count: previewLink.steps.length })}
            />
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.2} minWidth={0}>
          {configSources.length > 0 ? (
            <ConfigSourceBar
              sources={configSources}
              selectedSourceId={selectedSourceId}
              selectedSource={selectedConfigSource}
              path={selectedConfigSource?.files.links}
              requiredCapability="link"
              profileFallback="link"
              disabled={saving || loadingLink || sourceBusy}
              status={
                loadingLink ||
                proxySourceBusy ||
                proxyLoading ||
                runtimeSourceBusy ||
                runtimeProfilesLoading
                  ? "loading"
                  : sourceStatus
              }
              error={sourceError}
              showReadyStatus
              manageDisabled={draftDirty}
              manageDisabledReason={t("请先保存或关闭当前链路改动")}
              onSourceChange={(sourceId) => void handleSourceChange(sourceId)}
              onManage={() => setConfigSourceManagerOpen(true)}
            />
          ) : null}
          {loadingLink ? (
            <Alert severity="info">{t("正在读取链路配置...")}</Alert>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {runtimeSourceError ? (
            <Alert severity="warning">{runtimeSourceError}</Alert>
          ) : null}
          {runtimeProfilesError ? (
            <Alert severity="warning">{runtimeProfilesError}</Alert>
          ) : null}
          {compatibility?.messages.map((message) => (
            <Alert key={message} severity={compatibility.readOnly ? "warning" : "info"}>
              {translateCompatibilityMessage(message, t)}
            </Alert>
          ))}
          {plan ? (
            <Alert severity={plan.warnings.length > 0 ? "warning" : "success"}>
              {plan.warnings.length > 0
                ? t("已保存 {name}，包含 {stepCount} 个步骤，{warningCount} 条提示", {
                    name: plan.name,
                    stepCount: plan.steps.length,
                    warningCount: plan.warnings.length,
                  })
                : t("已保存 {name}，包含 {count} 个步骤。", {
                    name: plan.name,
                    count: plan.steps.length,
                  })}
            </Alert>
          ) : null}
          {plan ? (
            <Box className="resource-link-wizard-plan">
              <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" label={plan.key} />
                <Chip
                  size="small"
                  label={linkUiProfileLabel(plan.uiProfile as LinkUiProfileKey, t)}
                />
                {plan.workspaceKey ? (
                  <Chip
                    size="small"
                    label={t("工作区 {name}", { name: plan.workspaceKey })}
                  />
                ) : null}
                {plan.project ? (
                  <Chip size="small" label={t("项目 {name}", { name: plan.project })} />
                ) : null}
              </Stack>
              <Stack spacing={0.7}>
                {plan.steps.map((step, index) => (
                  <Box
                    key={`${step.id}-${index}`}
                    className={`resource-link-wizard-plan-step is-${step.status}`}
                  >
                    <Stack direction="row" spacing={0.7} alignItems="center" minWidth={0}>
                      <Chip size="small" label={index + 1} />
                      <Typography variant="subtitle2" noWrap>
                        {translateInternalMessage(step.label, t)}
                      </Typography>
                      <Chip size="small" variant="outlined" label={step.type} />
                    </Stack>
                    <Typography variant="caption">
                      {translateInternalMessage(step.summary, t)}
                    </Typography>
                    {step.risks.length > 0 ? (
                      <Stack spacing={0.25}>
                        {step.risks.map((risk) => (
                          <Typography key={risk} variant="caption" color="warning.main">
                            {translateInternalMessage(risk, t)}
                          </Typography>
                        ))}
                      </Stack>
                    ) : null}
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}

          <Box className="resource-link-wizard-section resource-link-wizard-section--identity">
            <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
              <TextField
                select
                label={t("链路类型")}
                value={draft.uiProfile}
                onChange={(event) => selectUiProfile(event.target.value as LinkUiProfileKey)}
                fullWidth
                helperText={t(
                  activeProfile?.description ?? "选择后下方字段会随类型变化。",
                )}
              >
                {LINK_UI_PROFILES.map((profile) => (
                  <MenuItem key={profile.id} value={profile.id}>
                    {t(profile.label)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t("工作区")}
                value={draft.workspaceKey}
                onChange={(event) => updateDraft({ workspaceKey: event.target.value })}
                fullWidth
                helperText={
                  selectedWorkspace && !selectedWorkspace.system
                    ? t("Link 会记录该工作区。")
                    : t("可不绑定工作区。")
                }
              >
                <MenuItem value="">{t("不绑定工作区")}</MenuItem>
                {projectWorkspaces.map((workspace) => (
                  <MenuItem key={workspace.key} value={workspace.key}>
                    {workspace.name}
                    {workspace.system ? ` · ${t("全局")}` : ""}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
              <TextField
                label={t("链路名称")}
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                fullWidth
              />
              <TextField
                label={t("Link Key")}
                value={draft.key}
                onChange={(event) => updateDraft({ key: normalizeLinkKeyInput(event.target.value) })}
                fullWidth
                inputProps={{ spellCheck: false, translate: "no" }}
              />
            </Box>
            {hasProject ? (
              <TextField
                select
                label={t("项目")}
                value={draft.project}
                onChange={(event) => {
                  const nextProject = event.target.value;
                  updateDraft({
                    project: nextProject,
                    debugProfile: nextProject
                      ? defaultDebugProfile(projects, nextProject)
                      : draft.debugProfile,
                  });
                }}
                fullWidth
              >
                <MenuItem value="">{t("暂不选择项目")}</MenuItem>
                {projects.map((project) => (
                  <MenuItem key={project.key} value={project.key}>
                    {project.name} · {project.key}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Box>

          {hasLocalFile ? (
              <Box className="resource-link-wizard-section resource-link-wizard-section--feature">
                <Stack
                  className="resource-link-wizard-section-head"
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Box className="resource-link-wizard-section-copy" minWidth={0}>
                    <Typography variant="subtitle2">{t("本地覆盖文件")}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("记录需要准备的本地覆盖文件，只生成计划，不直接修改仓库文件。")}
                    </Typography>
                  </Box>
                  <Switch
                    checked={draft.includeLocalFile}
                    onChange={(event) => updateDraft({ includeLocalFile: event.target.checked })}
                  />
                </Stack>
                <TextField
                  label={t("覆盖文件路径")}
                  value={draft.localFilePath}
                  disabled={!draft.includeLocalFile}
                  onChange={(event) => updateDraft({ localFilePath: event.target.value })}
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
              </Box>
          ) : null}

          {hasProxy ? (
              <Box className="resource-link-wizard-section resource-link-wizard-section--feature">
                <Stack
                  className="resource-link-wizard-section-head"
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Box className="resource-link-wizard-section-copy" minWidth={0}>
                    <Typography variant="subtitle2">{t("代理服务")}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("引用代理 profile，后续可执行启动、检查或诊断。")}
                    </Typography>
                  </Box>
                  <Switch
                    checked={draft.includeProxy}
                    onChange={(event) => updateDraft({ includeProxy: event.target.checked })}
                  />
                </Stack>
                <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                  <TextField
                    select
                    label={t("代理动作")}
                    value={draft.proxyAction}
                    disabled={!draft.includeProxy}
                    onChange={(event) =>
                      updateDraft({ proxyAction: event.target.value as ProxyActionType })
                    }
                  >
                    <MenuItem value="proxy.start">{t("启动代理")}</MenuItem>
                    <MenuItem value="proxy.check">{t("检查代理")}</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label={t("代理服务")}
                    value={draft.proxyProfile}
                    disabled={!draft.includeProxy || proxyLoading}
                    onChange={(event) => updateDraft({ proxyProfile: event.target.value })}
                    helperText={
                      proxyLoading
                        ? t("正在读取代理服务...")
                        : t("来自当前可见的代理服务。")
                    }
                  >
                    <MenuItem value="">{t("暂不选择代理")}</MenuItem>
                    {proxyProfiles.map((profile) => (
                      <MenuItem key={profile.id} value={profile.id}>
                        {profile.name} · {proxyListenUrl(profile)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
              </Box>
          ) : null}

          {hasRuntime ? (
              <Box className="resource-link-wizard-section resource-link-wizard-section--feature">
                <Stack
                  className="resource-link-wizard-section-head"
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Box className="resource-link-wizard-section-copy" minWidth={0}>
                    <Typography variant="subtitle2">{t("项目启动")}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("记录项目运行动作，实际启动前仍会先展示计划。")}
                    </Typography>
                  </Box>
                  <Switch
                    checked={draft.includeRuntime}
                    onChange={(event) => updateDraft({ includeRuntime: event.target.checked })}
                  />
                </Stack>
                {selectedProject?.debugProfiles.length ? (
                  <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                    <TextField
                      select
                      label="Debug Profile"
                      value={draft.debugProfile}
                      disabled={!draft.includeRuntime}
                      onChange={(event) => updateDraft({ debugProfile: event.target.value })}
                    >
                      <MenuItem value="">{t("使用项目默认")}</MenuItem>
                      {selectedProject.debugProfiles.map((profile) => (
                        <MenuItem key={profile.key} value={profile.key}>
                          {profile.label || profile.key}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label={t("运行配置")}
                      value={draft.runtimeProfile}
                      disabled={!draft.includeRuntime || runtimeProfilesLoading}
                      onChange={(event) => updateDraft({ runtimeProfile: event.target.value })}
                      helperText={
                        runtimeProfilesLoading
                          ? t("正在读取工作区运行配置...")
                          : selectedRuntimeConfigSource
                            ? t(
                                "来自运行配置源 {source}；留空时继承 Debug Profile。",
                                { source: selectedRuntimeConfigSource.name },
                              )
                            : t("留空时继承 Debug Profile。")
                      }
                    >
                      <MenuItem value="">{t("自动继承")}</MenuItem>
                      {runtimeProfiles.map((profile) => (
                        <MenuItem key={profile.key} value={profile.key}>
                          {profile.label || profile.key}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                ) : (
                  <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                    <TextField
                      label="Debug Profile"
                      value={draft.debugProfile}
                      disabled={!draft.includeRuntime}
                      onChange={(event) => updateDraft({ debugProfile: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                    <TextField
                      select
                      label={t("运行配置")}
                      value={draft.runtimeProfile}
                      disabled={!draft.includeRuntime || runtimeProfilesLoading}
                      onChange={(event) => updateDraft({ runtimeProfile: event.target.value })}
                      helperText={
                        runtimeProfilesLoading
                          ? t("正在读取工作区运行配置...")
                          : selectedRuntimeConfigSource
                            ? t("来自运行配置源 {source}。", {
                                source: selectedRuntimeConfigSource.name,
                              })
                            : undefined
                      }
                    >
                      <MenuItem value="">{t("不指定")}</MenuItem>
                      {runtimeProfiles.map((profile) => (
                        <MenuItem key={profile.key} value={profile.key}>
                          {profile.label || profile.key}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                )}
                <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                  <TextField
                    label={t("单次启动命令")}
                    value={draft.commandOverride}
                    disabled={!draft.includeRuntime}
                    onChange={(event) => updateDraft({ commandOverride: event.target.value })}
                    placeholder={t("留空时使用档案或项目命令")}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label={t("预期端口")}
                    type="number"
                    value={draft.expectedPort}
                    disabled={!draft.includeRuntime}
                    onChange={(event) => updateDraft({ expectedPort: event.target.value })}
                    inputProps={{ min: 1, max: 65535 }}
                    helperText={t("占用时停止启动，避免自动换端口。")}
                  />
                </Box>
              </Box>
          ) : null}

          {hasProxyAction ? (
            <Box className="resource-link-wizard-section resource-link-wizard-section--identity">
              <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                <TextField
                  select
                  label={t("代理动作")}
                  value={draft.proxyAction}
                  onChange={(event) =>
                    updateDraft({ proxyAction: event.target.value as ProxyActionType })
                  }
                  fullWidth
                >
                  <MenuItem value="proxy.start">{t("启动代理")}</MenuItem>
                  <MenuItem value="proxy.check">{t("检查代理")}</MenuItem>
                </TextField>
                <TextField
                  select
                  label={t("代理服务")}
                  value={draft.proxyProfile}
                  disabled={proxyLoading}
                  onChange={(event) => updateDraft({ proxyProfile: event.target.value })}
                  helperText={
                    proxyLoading
                      ? t("正在读取代理服务...")
                      : t("来自当前可见的代理服务。")
                  }
                  fullWidth
                >
                  <MenuItem value="">{t("暂不选择代理")}</MenuItem>
                  {proxyProfiles.map((profile) => (
                    <MenuItem key={profile.id} value={profile.id}>
                      {profile.name} · {proxyListenUrl(profile)}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Box>
          ) : null}

          {hasWebAction ? (
            <Box className="resource-link-wizard-section resource-link-wizard-section--identity">
              <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                <TextField
                  select
                  label="Web Action"
                  value={draft.webActionKey}
                  onChange={(event) => updateDraft({ webActionKey: event.target.value })}
                  helperText={
                    webActions.length > 0
                      ? t("只引用已有网页动作，具体脚本和请求配置仍在网页动作面板维护。")
                      : t("暂无可引用网页动作。")
                  }
                  fullWidth
                >
                  <MenuItem value="">{t("未选择")}</MenuItem>
                  {webActions.map((action) => (
                    <MenuItem key={action.key} value={action.key}>
                      {action.name || action.key} · {webActionKindLabel(action.kind, t)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label={t("动作")}
                  value={draft.webActionMode}
                  onChange={(event) =>
                    updateDraft({ webActionMode: event.target.value as WebActionMode })
                  }
                  fullWidth
                >
                  <MenuItem value="open">{t("打开目标")}</MenuItem>
                  <MenuItem value="run">{t("执行动作")}</MenuItem>
                  <MenuItem value="check">{t("检查配置")}</MenuItem>
                </TextField>
              </Box>
              {selectedWebAction ? (
                <Stack
                  className="resource-link-wizard-inline-meta"
                  direction="row"
                  spacing={0.6}
                  flexWrap="wrap"
                  useFlexGap
                >
                  <Chip size="small" label={selectedWebAction.scope || t("全局")} />
                  <Chip
                    size="small"
                    label={webActionKindLabel(selectedWebAction.kind, t)}
                  />
                  {selectedWebAction.matchPatterns.length ? (
                    <Chip
                      size="small"
                      label={t("{count} 条匹配", {
                        count: selectedWebAction.matchPatterns.length,
                      })}
                    />
                  ) : null}
                  {selectedWebAction.params.length ? (
                    <Chip
                      size="small"
                      label={t("{count} 个参数", {
                        count: selectedWebAction.params.length,
                      })}
                    />
                  ) : null}
                </Stack>
              ) : null}
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Box
          className="resource-link-wizard-footer"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          width="100%"
        >
          <Stack
            className="resource-link-wizard-summary"
            direction="row"
            spacing={0.6}
            flexWrap="wrap"
            useFlexGap
            minWidth={0}
          >
            {summaryChips}
          </Stack>
          <Stack direction="row" spacing={0.8} flex="0 0 auto">
            <Button color="inherit" onClick={onClose}>
              {t("关闭")}
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              disabled={
                saving ||
                loadingLink ||
                sourceBusy ||
                proxySourceBusy ||
                proxyLoading ||
                !selectedProxyConfigSource ||
                runtimeSourceBusy ||
                runtimeProfilesLoading ||
                !selectedRuntimeConfigSource ||
                Boolean(runtimeProfilesError) ||
                !selectedConfigSource ||
                compatibility?.readOnly
              }
              onClick={() => void saveLink()}
            >
              {saving
                ? t("保存中")
                : compatibility?.readOnly
                  ? t("版本不兼容")
                  : t("保存链路")}
            </Button>
          </Stack>
        </Box>
        </DialogActions>
      </Dialog>
      <ConfigSourceManagerDialog
        open={configSourceManagerOpen}
        initialSourceId={selectedSourceId}
        onClose={() => setConfigSourceManagerOpen(false)}
        onChanged={(sources) => {
          try {
            adoptSources(sources, selectedSourceId);
          } catch (reason) {
            setError(String(reason));
          }
        }}
      />
    </>
  );
}
