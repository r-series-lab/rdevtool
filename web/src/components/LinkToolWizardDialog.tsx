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
import { configSourceSupports } from "../lib/configSources";

export type LinkToolWizardSaveResult = {
  link: LinkConfig;
  plan: LinkPlan;
};

type LinkToolWizardDialogProps = {
  open: boolean;
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  projects: ProjectConfigDraft[];
  runtimeProfiles: RuntimeProfileDraft[];
  webActions: WebActionSummary[];
  initialLinkKey?: string | null;
  onClose: () => void;
  onSaved?: (result: LinkToolWizardSaveResult) => void | Promise<void>;
};

type LinkSaveResult = {
  link: LinkConfig;
  plan: LinkPlan;
};

function linkUiProfileLabel(value: LinkUiProfileKey) {
  return linkUiProfileDefinition(value).label;
}

function proxyListenUrl(profile: ProxyProfile) {
  return `http://${profile.listenHost}:${profile.listenPort}`;
}

function webActionKindLabel(kind?: string | null) {
  return kind === "request" ? "请求动作" : "脚本动作";
}


export function LinkToolWizardDialog({
  open,
  activeProjectWorkspaceKey,
  projectWorkspaces,
  projects,
  runtimeProfiles,
  webActions,
  initialLinkKey,
  onClose,
  onSaved,
}: LinkToolWizardDialogProps) {
  const {
    sources: configSources,
    selectedSource: selectedConfigSource,
    selectedSourceId,
    preferredSourceId,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<LinkPlan | null>(null);
  const [sourceLink, setSourceLink] = useState<LinkConfig | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    void refreshSources().catch((reason) => setError(String(reason)));
  }, [open, preferredSourceId, refreshSources]);

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
      void invoke<LinkConfig>("get_link", { sourceId: selectedSourceId, key: linkKey })
        .then((link) => {
          if (loadRequestRef.current !== requestId) return;
          setSourceLink(link);
          setDraft(buildLinkDraftFromConfig(link, projects, webActions));
          setDraftDirty(false);
        })
        .catch((reason) => {
          if (loadRequestRef.current !== requestId) return;
          setDraft((current) => ({ ...current, key: normalizeLinkKeyInput(linkKey) }));
          setError(`无法读取链路 ${linkKey}：${String(reason)}`);
        })
        .finally(() => {
          if (loadRequestRef.current === requestId) setLoadingLink(false);
        });
    }

    setProxyLoading(true);
    void invoke<ProxyDashboard>("get_proxy_dashboard", { sourceId: selectedSourceId })
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
        if (configSourceSupports(selectedConfigSource, "proxy")) {
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
    selectedSourceId,
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
      setError("请先保存或关闭当前链路改动，再切换配置源。");
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
    if (!draft.key.trim()) {
      return "Link Key 不能为空";
    }
    if (!draft.name.trim()) {
      return "链路名称不能为空";
    }
    if (hasLocalFile || hasProxy || hasRuntime) {
      const hasEnabledStep =
        (hasLocalFile && draft.includeLocalFile) ||
        (hasProxy && draft.includeProxy) ||
        (hasRuntime && draft.includeRuntime);
      if (!hasEnabledStep) {
        return "至少选择一个链路步骤";
      }
      if (
        ((hasLocalFile && draft.includeLocalFile) || (hasRuntime && draft.includeRuntime)) &&
        !draft.project
      ) {
        return "本地覆盖文件和项目运行步骤需要选择项目";
      }
      if (hasProxy && draft.includeProxy && !draft.proxyProfile) {
        return "代理步骤需要选择代理服务";
      }
      if (hasRuntime && draft.includeRuntime && draft.expectedPort) {
        const port = Number(draft.expectedPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return "预期端口必须在 1-65535 之间";
        }
      }
    }
    if (hasProxyAction && !draft.proxyProfile) {
      return "代理链路需要选择代理服务";
    }
    if (hasWebAction && !draft.webActionKey) {
      return "网页动作链路需要选择 Web Action";
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
      <Chip size="small" label={linkUiProfileLabel(draft.uiProfile)} />
      <Chip size="small" label={`${previewLink.steps.length} 步`} />
      {selectedConfigSource ? (
        <Chip size="small" label={`源 ${selectedConfigSource.name}`} />
      ) : null}
      {draft.workspaceKey ? <Chip size="small" label={`工作区 ${draft.workspaceKey}`} /> : null}
      {draft.project && hasProject ? (
        <Chip size="small" label={`项目 ${draft.project}`} />
      ) : null}
      {draft.proxyProfile && (hasProxy || hasProxyAction) ? (
        <Chip size="small" label={`代理 ${draft.proxyProfile}`} />
      ) : null}
      {draft.webActionKey && hasWebAction ? (
        <Chip size="small" label={`动作 ${draft.webActionKey}`} />
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
                {initialLinkKey?.trim() ? "编辑链路工具" : "新建链路工具"}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {selectedConfigSource
                  ? `${selectedConfigSource.name} · ${activeProfile?.label ?? "链路配置"}`
                  : "按链路类型生成对应配置界面。"}
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
            <Chip size="small" label={linkUiProfileLabel(draft.uiProfile)} />
            <Chip size="small" label={`${previewLink.steps.length} 步`} />
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
              status={loadingLink || proxyLoading ? "loading" : sourceStatus}
              error={sourceError}
              showReadyStatus
              manageDisabled={draftDirty}
              manageDisabledReason="请先保存或关闭当前链路改动"
              onSourceChange={(sourceId) => void handleSourceChange(sourceId)}
              onManage={() => setConfigSourceManagerOpen(true)}
            />
          ) : null}
          {loadingLink ? <Alert severity="info">正在读取链路配置...</Alert> : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {compatibility?.messages.map((message) => (
            <Alert key={message} severity={compatibility.readOnly ? "warning" : "info"}>
              {message}
            </Alert>
          ))}
          {plan ? (
            <Alert severity={plan.warnings.length > 0 ? "warning" : "success"}>
              已保存 {plan.name}，包含 {plan.steps.length} 个步骤
              {plan.warnings.length > 0 ? `，${plan.warnings.length} 条提示` : "。"}
            </Alert>
          ) : null}
          {plan ? (
            <Box className="resource-link-wizard-plan">
              <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" label={plan.key} />
                <Chip size="small" label={linkUiProfileLabel(plan.uiProfile as LinkUiProfileKey)} />
                {plan.workspaceKey ? <Chip size="small" label={`工作区 ${plan.workspaceKey}`} /> : null}
                {plan.project ? <Chip size="small" label={`项目 ${plan.project}`} /> : null}
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
                        {step.label}
                      </Typography>
                      <Chip size="small" variant="outlined" label={step.type} />
                    </Stack>
                    <Typography variant="caption">{step.summary}</Typography>
                    {step.risks.length > 0 ? (
                      <Stack spacing={0.25}>
                        {step.risks.map((risk) => (
                          <Typography key={risk} variant="caption" color="warning.main">
                            {risk}
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
                label="链路类型"
                value={draft.uiProfile}
                onChange={(event) => selectUiProfile(event.target.value as LinkUiProfileKey)}
                fullWidth
                helperText={activeProfile?.description ?? "选择后下方字段会随类型变化。"}
              >
                {LINK_UI_PROFILES.map((profile) => (
                  <MenuItem key={profile.id} value={profile.id}>
                    {profile.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="工作区"
                value={draft.workspaceKey}
                onChange={(event) => updateDraft({ workspaceKey: event.target.value })}
                fullWidth
                helperText={
                  selectedWorkspace && !selectedWorkspace.system
                    ? "Link 会记录该工作区。"
                    : "可不绑定工作区。"
                }
              >
                <MenuItem value="">不绑定工作区</MenuItem>
                {projectWorkspaces.map((workspace) => (
                  <MenuItem key={workspace.key} value={workspace.key}>
                    {workspace.name}
                    {workspace.system ? " · 全局" : ""}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
              <TextField
                label="链路名称"
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                fullWidth
              />
              <TextField
                label="Link Key"
                value={draft.key}
                onChange={(event) => updateDraft({ key: normalizeLinkKeyInput(event.target.value) })}
                fullWidth
                inputProps={{ spellCheck: false, translate: "no" }}
              />
            </Box>
            {hasProject ? (
              <TextField
                select
                label="项目"
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
                <MenuItem value="">暂不选择项目</MenuItem>
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
                    <Typography variant="subtitle2">本地覆盖文件</Typography>
                    <Typography variant="caption" color="text.secondary">
                      记录需要准备的本地覆盖文件，只生成计划，不直接修改仓库文件。
                    </Typography>
                  </Box>
                  <Switch
                    checked={draft.includeLocalFile}
                    onChange={(event) => updateDraft({ includeLocalFile: event.target.checked })}
                  />
                </Stack>
                <TextField
                  label="覆盖文件路径"
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
                    <Typography variant="subtitle2">代理服务</Typography>
                    <Typography variant="caption" color="text.secondary">
                      引用代理 profile，后续可执行启动、检查或诊断。
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
                    label="代理动作"
                    value={draft.proxyAction}
                    disabled={!draft.includeProxy}
                    onChange={(event) =>
                      updateDraft({ proxyAction: event.target.value as ProxyActionType })
                    }
                  >
                    <MenuItem value="proxy.start">启动代理</MenuItem>
                    <MenuItem value="proxy.check">检查代理</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label="代理服务"
                    value={draft.proxyProfile}
                    disabled={!draft.includeProxy || proxyLoading}
                    onChange={(event) => updateDraft({ proxyProfile: event.target.value })}
                    helperText={
                      proxyLoading ? "正在读取代理服务..." : "来自当前可见的代理服务。"
                    }
                  >
                    <MenuItem value="">暂不选择代理</MenuItem>
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
                    <Typography variant="subtitle2">运行配置</Typography>
                    <Typography variant="caption" color="text.secondary">
                      记录项目运行动作，实际启动前仍会先展示计划。
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
                      <MenuItem value="">使用项目默认</MenuItem>
                      {selectedProject.debugProfiles.map((profile) => (
                        <MenuItem key={profile.key} value={profile.key}>
                          {profile.label || profile.key}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label="运行配置"
                      value={draft.runtimeProfile}
                      disabled={!draft.includeRuntime}
                      onChange={(event) => updateDraft({ runtimeProfile: event.target.value })}
                      helperText="留空时继承 Debug Profile。"
                    >
                      <MenuItem value="">自动继承</MenuItem>
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
                      label="运行配置"
                      value={draft.runtimeProfile}
                      disabled={!draft.includeRuntime}
                      onChange={(event) => updateDraft({ runtimeProfile: event.target.value })}
                    >
                      <MenuItem value="">不指定</MenuItem>
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
                    label="单次启动命令"
                    value={draft.commandOverride}
                    disabled={!draft.includeRuntime}
                    onChange={(event) => updateDraft({ commandOverride: event.target.value })}
                    placeholder="留空时使用档案或项目命令"
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label="预期端口"
                    type="number"
                    value={draft.expectedPort}
                    disabled={!draft.includeRuntime}
                    onChange={(event) => updateDraft({ expectedPort: event.target.value })}
                    inputProps={{ min: 1, max: 65535 }}
                    helperText="占用时停止启动，避免自动换端口。"
                  />
                </Box>
              </Box>
          ) : null}

          {hasProxyAction ? (
            <Box className="resource-link-wizard-section resource-link-wizard-section--identity">
              <Box className="resource-link-wizard-grid resource-link-wizard-grid--two">
                <TextField
                  select
                  label="代理动作"
                  value={draft.proxyAction}
                  onChange={(event) =>
                    updateDraft({ proxyAction: event.target.value as ProxyActionType })
                  }
                  fullWidth
                >
                  <MenuItem value="proxy.start">启动代理</MenuItem>
                  <MenuItem value="proxy.check">检查代理</MenuItem>
                </TextField>
                <TextField
                  select
                  label="代理服务"
                  value={draft.proxyProfile}
                  disabled={proxyLoading}
                  onChange={(event) => updateDraft({ proxyProfile: event.target.value })}
                  helperText={proxyLoading ? "正在读取代理服务..." : "来自当前可见的代理服务。"}
                  fullWidth
                >
                  <MenuItem value="">暂不选择代理</MenuItem>
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
                      ? "只引用已有网页动作，具体脚本和请求配置仍在网页动作面板维护。"
                      : "暂无可引用网页动作。"
                  }
                  fullWidth
                >
                  <MenuItem value="">未选择</MenuItem>
                  {webActions.map((action) => (
                    <MenuItem key={action.key} value={action.key}>
                      {action.name || action.key} · {webActionKindLabel(action.kind)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="动作"
                  value={draft.webActionMode}
                  onChange={(event) =>
                    updateDraft({ webActionMode: event.target.value as WebActionMode })
                  }
                  fullWidth
                >
                  <MenuItem value="open">打开目标</MenuItem>
                  <MenuItem value="run">执行动作</MenuItem>
                  <MenuItem value="check">检查配置</MenuItem>
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
                  <Chip size="small" label={selectedWebAction.scope || "全局"} />
                  <Chip size="small" label={webActionKindLabel(selectedWebAction.kind)} />
                  {selectedWebAction.matchPatterns.length ? (
                    <Chip size="small" label={`${selectedWebAction.matchPatterns.length} 条匹配`} />
                  ) : null}
                  {selectedWebAction.params.length ? (
                    <Chip size="small" label={`${selectedWebAction.params.length} 个参数`} />
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
              关闭
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              disabled={
                saving ||
                loadingLink ||
                sourceBusy ||
                !selectedConfigSource ||
                compatibility?.readOnly
              }
              onClick={() => void saveLink()}
            >
              {saving ? "保存中" : compatibility?.readOnly ? "版本不兼容" : "保存链路"}
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
