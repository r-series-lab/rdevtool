import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  ProxyDashboard,
  ProxyEvent,
  ProxyProfile,
  ProxyRule,
  ProxyRuleAction,
} from "../app-types";
import {
  CheckIcon,
  ClearIcon,
  CopyIcon,
  EditIcon,
  PlusIcon,
  RefreshIcon,
  ReplayIcon,
  StarIcon,
  StopIcon,
  TrashIcon,
} from "../components/AppIcons";

const HTTP_METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const ACTION_KINDS: Array<{ value: ProxyRuleAction["kind"]; label: string }> = [
  { value: "forward", label: "转发" },
  { value: "mock", label: "Mock" },
  { value: "block", label: "阻断" },
];

type ProxyView = "config" | "requests";

export type ProxyPageProps = {
  dashboard: ProxyDashboard | null;
  selectedProfileId: string;
  loading: boolean;
  busy: string;
  error: string;
  onSelectedProfileChange: (profileId: string) => void;
  onRefresh: () => Promise<void> | void;
  onSaveProfile: (profile: ProxyProfile) => Promise<ProxyDashboard> | void;
  onDeleteProfile: (profileId: string) => Promise<ProxyDashboard> | void;
  onSaveRule: (rule: ProxyRule) => Promise<ProxyDashboard> | void;
  onDeleteRule: (ruleId: string) => Promise<ProxyDashboard> | void;
  onStartProfile: (profileId: string) => Promise<ProxyDashboard> | void;
  onStopProfile: (profileId: string) => Promise<ProxyDashboard> | void;
  onClearEvents: (profileId?: string | null) => Promise<ProxyDashboard> | void;
  demoAvailable?: boolean;
  onLoadDemoData?: () => void;
};

function newId(prefix: string) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function createProfile(port = 8787): ProxyProfile {
  return {
    id: newId("proxy"),
    name: "新代理",
    listenHost: "127.0.0.1",
    listenPort: port,
    upstreamBaseUrl: "",
    upstreamProxy: "",
    captureBody: true,
    maxBodyBytes: 4096,
  };
}

function createRule(profileId: string, priority = 10): ProxyRule {
  return {
    id: newId("rule"),
    profileId,
    enabled: true,
    name: "新规则",
    priority,
    method: "",
    urlContains: "",
    pathPrefix: "/api/",
    headerName: "",
    headerContains: "",
    action: {
      kind: "mock",
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: '{\n  "ok": true\n}',
      headers: {},
      delayMs: 0,
    },
  };
}

function defaultAction(kind: ProxyRuleAction["kind"]): ProxyRuleAction {
  if (kind === "mock") {
    return {
      kind,
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: '{\n  "ok": true\n}',
      headers: {},
      delayMs: 0,
    };
  }
  if (kind === "block") {
    return {
      kind,
      status: 403,
      body: "Blocked by rDevTool proxy",
      delayMs: 0,
    };
  }
  return {
    kind,
    targetBaseUrl: "",
    rewritePrefix: "",
    requestHeaders: {},
    responseHeaders: {},
    delayMs: 0,
  };
}

function headersToText(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseHeaderText(text: string) {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 1) {
      throw new Error(`第 ${index + 1} 行缺少 header 名称或冒号`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(key)) {
      throw new Error(`第 ${index + 1} 行 header 名称无效`);
    }
    headers[key] = value;
  }
  return headers;
}

function selectedActionHeaders(rule: ProxyRule) {
  if (rule.action.kind === "forward") {
    return {
      requestHeadersText: headersToText(rule.action.requestHeaders),
      responseHeadersText: headersToText(rule.action.responseHeaders),
      mockHeadersText: "",
    };
  }
  if (rule.action.kind === "mock") {
    return {
      requestHeadersText: "",
      responseHeadersText: "",
      mockHeadersText: headersToText(rule.action.headers),
    };
  }
  return {
    requestHeadersText: "",
    responseHeadersText: "",
    mockHeadersText: "",
  };
}

function sortedRules(rules: ProxyRule[]) {
  return [...rules].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
}

function statusByProfile(dashboard: ProxyDashboard | null) {
  return new Map((dashboard?.statuses ?? []).map((item) => [item.profileId, item]));
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ").slice(0, 16);
  }
  return new Intl.DateTimeFormat(navigator.language || "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(navigator.language || "zh-CN", {
    maximumFractionDigits: 1,
  }).format(value);
}

function eventStatusTone(event: ProxyEvent) {
  if (event.error || (event.status ?? 0) >= 500) {
    return "error" as const;
  }
  if ((event.status ?? 0) >= 400 || event.action === "block") {
    return "warning" as const;
  }
  if (event.action === "mock") {
    return "info" as const;
  }
  return "success" as const;
}

function actionLabel(action: string) {
  if (action === "mock") {
    return "Mock";
  }
  if (action === "block") {
    return "阻断";
  }
  if (action === "tunnel") {
    return "隧道";
  }
  if (action === "error") {
    return "失败";
  }
  return "转发";
}

function actionKindLabel(kind: ProxyRuleAction["kind"]) {
  return ACTION_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function activateRow(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  action();
}

export function ProxyPage({
  dashboard,
  selectedProfileId,
  loading,
  busy,
  error,
  onSelectedProfileChange,
  onRefresh,
  onSaveProfile,
  onDeleteProfile,
  onSaveRule,
  onDeleteRule,
  onStartProfile,
  onStopProfile,
  onClearEvents,
  demoAvailable = false,
  onLoadDemoData,
}: ProxyPageProps) {
  const statuses = useMemo(() => statusByProfile(dashboard), [dashboard]);
  const profiles = dashboard?.config.profiles ?? [];
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;
  const selectedStatus = selectedProfile ? statuses.get(selectedProfile.id) : null;
  const rules = useMemo(
    () =>
      selectedProfile
        ? sortedRules(
            dashboard?.config.rules.filter((rule) => rule.profileId === selectedProfile.id) ?? [],
          )
        : [],
    [dashboard?.config.rules, selectedProfile],
  );
  const events = useMemo(
    () =>
      selectedProfile
        ? (dashboard?.events ?? []).filter((event) => event.profileId === selectedProfile.id)
        : [],
    [dashboard?.events, selectedProfile],
  );
  const [profileDraft, setProfileDraft] = useState<ProxyProfile | null>(null);
  const [ruleDraft, setRuleDraft] = useState<ProxyRule | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [view, setView] = useState<ProxyView>("config");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [formError, setFormError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [requestHeadersText, setRequestHeadersText] = useState("");
  const [responseHeadersText, setResponseHeadersText] = useState("");
  const [mockHeadersText, setMockHeadersText] = useState("");
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;
  const nextPort =
    Array.from({ length: 20 }, (_, index) => 8787 + index).find(
      (port) => !profiles.some((profile) => profile.listenPort === port),
    ) ?? 8787;
  const nextRulePriority = rules.length > 0 ? Math.max(...rules.map((rule) => rule.priority)) + 10 : 10;
  const existingRuleDraft =
    ruleDraft && rules.some((rule) => rule.id === ruleDraft.id) ? ruleDraft : null;

  useEffect(() => {
    if (!selectedEvent || events.some((event) => event.id === selectedEventId)) {
      return;
    }
    setSelectedEventId(selectedEvent.id);
  }, [events, selectedEvent, selectedEventId]);

  function openProfileDialog(profile: ProxyProfile) {
    setFormError("");
    setProfileDraft(profile);
    setProfileDialogOpen(true);
  }

  function closeProfileDialog() {
    setProfileDialogOpen(false);
    setProfileDraft(null);
    setFormError("");
  }

  function openRuleDialog(rule: ProxyRule) {
    setFormError("");
    setRuleDraft(rule);
    const headers = selectedActionHeaders(rule);
    setRequestHeadersText(headers.requestHeadersText);
    setResponseHeadersText(headers.responseHeadersText);
    setMockHeadersText(headers.mockHeadersText);
    setRuleDialogOpen(true);
  }

  function closeRuleDialog() {
    setRuleDialogOpen(false);
    setRuleDraft(null);
    setFormError("");
    setRequestHeadersText("");
    setResponseHeadersText("");
    setMockHeadersText("");
  }

  function updateProfileDraft(patch: Partial<ProxyProfile>) {
    setProfileDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateRuleDraft(patch: Partial<ProxyRule>) {
    setRuleDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function setRuleAction(kind: ProxyRuleAction["kind"]) {
    setRuleDraft((current) => (current ? { ...current, action: defaultAction(kind) } : current));
    setRequestHeadersText("");
    setResponseHeadersText("");
    setMockHeadersText("");
  }

  function updateForwardAction(patch: Partial<Extract<ProxyRuleAction, { kind: "forward" }>>) {
    setRuleDraft((current) =>
      current && current.action.kind === "forward"
        ? { ...current, action: { ...current.action, ...patch } }
        : current,
    );
  }

  function updateMockAction(patch: Partial<Extract<ProxyRuleAction, { kind: "mock" }>>) {
    setRuleDraft((current) =>
      current && current.action.kind === "mock"
        ? { ...current, action: { ...current.action, ...patch } }
        : current,
    );
  }

  function updateBlockAction(patch: Partial<Extract<ProxyRuleAction, { kind: "block" }>>) {
    setRuleDraft((current) =>
      current && current.action.kind === "block"
        ? { ...current, action: { ...current.action, ...patch } }
        : current,
    );
  }

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1200);
  }

  async function saveProfileDraft() {
    if (!profileDraft) {
      return;
    }
    setFormError("");
    if (!profileDraft.name.trim()) {
      setFormError("代理名称不能为空");
      return;
    }
    if (!profileDraft.listenHost.trim() || !profileDraft.listenPort) {
      setFormError("监听地址和端口不能为空");
      return;
    }
    await onSaveProfile(profileDraft);
    onSelectedProfileChange(profileDraft.id);
    closeProfileDialog();
  }

  async function deleteProfile(profile: ProxyProfile) {
    if (!window.confirm(`删除代理配置“${profile.name}”？相关规则和记录也会被移除。`)) {
      return;
    }
    await onDeleteProfile(profile.id);
  }

  async function saveRuleDraft() {
    if (!ruleDraft) {
      return;
    }
    setFormError("");
    if (!ruleDraft.name.trim()) {
      setFormError("规则名称不能为空");
      return;
    }
    let action = ruleDraft.action;
    try {
      if (action.kind === "forward") {
        action = {
          ...action,
          requestHeaders: parseHeaderText(requestHeadersText),
          responseHeaders: parseHeaderText(responseHeadersText),
        };
      } else if (action.kind === "mock") {
        action = {
          ...action,
          headers: parseHeaderText(mockHeadersText),
        };
      }
    } catch (reason) {
      setFormError(String(reason instanceof Error ? reason.message : reason));
      return;
    }
    await onSaveRule({ ...ruleDraft, action });
    closeRuleDialog();
  }

  async function deleteRule(rule: ProxyRule) {
    if (!window.confirm(`删除规则“${rule.name}”？`)) {
      return;
    }
    await onDeleteRule(rule.id);
    closeRuleDialog();
  }

  if (!dashboard && loading) {
    return (
      <Box className="workspace workspace--narrow proxy-workspace">
        <Alert severity="info">正在加载代理配置…</Alert>
      </Box>
    );
  }

  return (
    <Box className="workspace workspace--narrow proxy-workspace">
      {(error || formError || busy) ? (
        <Stack spacing={0.7} aria-live="polite">
          {busy ? <Alert severity="info" sx={{ py: 0 }}>{busy}</Alert> : null}
          {error ? <Alert severity="error" sx={{ py: 0 }}>{error}</Alert> : null}
          {formError ? <Alert severity="warning" sx={{ py: 0 }}>{formError}</Alert> : null}
        </Stack>
      ) : null}

      <Box className="proxy-view-tabs" role="tablist" aria-label="代理子页面">
        <button
          type="button"
          role="tab"
          aria-selected={view === "config"}
          className={`proxy-view-tab${view === "config" ? " is-active" : ""}`}
          onClick={() => setView("config")}
        >
          <span>配置</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "requests"}
          className={`proxy-view-tab${view === "requests" ? " is-active" : ""}`}
          onClick={() => setView("requests")}
        >
          <span>请求</span>
        </button>
      </Box>

      <Box className={`proxy-main-grid proxy-main-grid--${view}`}>
        {view === "config" ? (
        <section className="workflow-panel proxy-control-panel" aria-label="代理服务与规则">
          <Box className="proxy-control-split">
            <Box component="section" className="proxy-section proxy-service-panel" aria-labelledby="proxy-service-title">
              <PanelHeader
                id="proxy-service-title"
                title="服务"
                aside={
                  <Stack direction="row" spacing={0.6}>
                    <Tooltip title="新建代理配置">
                      <IconButton
                        aria-label="新建代理配置"
                        onClick={() => openProfileDialog(createProfile(nextPort))}
                      >
                        <PlusIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="刷新代理状态">
                      <IconButton onClick={() => void onRefresh()} aria-label="刷新代理状态">
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              />

              <Box className="proxy-card-list module-list-scroll" role="list" aria-label="代理服务列表">
                {profiles.length > 0 ? (
                  profiles.map((profile) => {
                    const status = statuses.get(profile.id);
                    const selected = selectedProfile?.id === profile.id;
                    return (
                      <Box
                        key={profile.id}
                        className={`proxy-list-item${selected ? " is-active" : ""}`}
                        role="listitem"
                      >
                        <Box
                          component="div"
                          role="button"
                          tabIndex={0}
                          className="proxy-list-item-main proxy-list-main-button"
                          onClick={() => onSelectedProfileChange(profile.id)}
                          onKeyDown={(event) =>
                            activateRow(event, () => onSelectedProfileChange(profile.id))
                          }
                        >
                          <span className="proxy-list-title-row">
                            <b>{profile.name}</b>
                            <Chip
                              size="small"
                              label={status?.running ? "运行中" : "已停止"}
                              color={status?.running ? "success" : "default"}
                              variant={status?.running ? "filled" : "outlined"}
                            />
                          </span>
                          <span className="proxy-list-detail-row">
                            <small translate="no">
                              {status?.listenUrl ?? `http://${profile.listenHost}:${profile.listenPort}`}
                            </small>
                            <span className="proxy-list-meta">
                              <Chip size="small" label={`${rulesForProfile(dashboard, profile.id).length} 规则`} variant="outlined" />
                              <Chip size="small" label={`${eventsForProfile(dashboard, profile.id).length} 请求`} variant="outlined" />
                            </span>
                          </span>
                        </Box>
                        <span className="proxy-list-actions">
                          <Tooltip title={status?.running ? "停止代理" : "启动代理"}>
                            <IconButton
                              aria-label={status?.running ? "停止代理" : "启动代理"}
                              onClick={(event) => {
                                event.stopPropagation();
                                void (status?.running
                                  ? onStopProfile(profile.id)
                                  : onStartProfile(profile.id));
                              }}
                            >
                              {status?.running ? <StopIcon fontSize="small" /> : <ReplayIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="编辑代理配置">
                            <IconButton
                              aria-label="编辑代理配置"
                              onClick={(event) => {
                                event.stopPropagation();
                                openProfileDialog(profile);
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="删除代理配置">
                            <span>
                              <IconButton
                                aria-label="删除代理配置"
                                disabled={profiles.length <= 1 || Boolean(busy)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void deleteProfile(profile);
                                }}
                              >
                                <TrashIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </span>
                      </Box>
                    );
                  })
                ) : (
                  <EmptyProxyState
                    text="暂无代理配置。"
                    demoAvailable={demoAvailable}
                    onLoadDemoData={onLoadDemoData}
                  />
                )}
              </Box>
            </Box>

            <Box component="section" className="proxy-section proxy-rules-panel" aria-labelledby="proxy-rule-title">
              <PanelHeader
                id="proxy-rule-title"
                title="规则"
                aside={
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<PlusIcon fontSize="small" />}
                    disabled={!selectedProfile}
                    onClick={() => {
                      if (selectedProfile) {
                        openRuleDialog(createRule(selectedProfile.id, nextRulePriority));
                      }
                    }}
                  >
                    新规则
                  </Button>
                }
              />

              <Box className="proxy-card-list module-list-scroll" role="list" aria-label="代理规则列表">
                {rules.length > 0 ? (
                  rules.map((rule) => (
                    <Box
                      key={rule.id}
                      className="proxy-list-item proxy-rule-row"
                      role="listitem"
                    >
                      <Box
                        component="div"
                        role="button"
                        tabIndex={0}
                        className="proxy-list-item-main proxy-list-main-button"
                        onClick={() => openRuleDialog(rule)}
                        onKeyDown={(event) => activateRow(event, () => openRuleDialog(rule))}
                      >
                        <span className="proxy-list-title-row">
                          <b>{rule.name}</b>
                          <Chip
                            size="small"
                            label={rule.enabled ? "启用" : "停用"}
                            color={rule.enabled ? "primary" : "default"}
                            variant={rule.enabled ? "filled" : "outlined"}
                          />
                        </span>
                        <span className="proxy-list-detail-row">
                          <small translate="no">
                            {rule.method || "任意"} · {rule.pathPrefix || rule.urlContains || "自定义匹配"}
                          </small>
                          <span className="proxy-list-meta">
                            <Chip size="small" label={actionKindLabel(rule.action.kind)} variant="outlined" />
                            <Chip size="small" label={`优先级 ${rule.priority}`} variant="outlined" />
                            {rule.action.delayMs > 0 ? (
                              <Chip size="small" label={`${formatNumber(rule.action.delayMs)} ms`} variant="outlined" />
                            ) : null}
                          </span>
                        </span>
                      </Box>
                      <span className="proxy-list-actions">
                        <Tooltip title="编辑规则">
                          <IconButton aria-label="编辑规则" onClick={() => openRuleDialog(rule)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </span>
                    </Box>
                  ))
                ) : (
                  <EmptyProxyState
                    text="暂无规则。"
                    demoAvailable={demoAvailable}
                    onLoadDemoData={onLoadDemoData}
                  />
                )}
              </Box>
            </Box>
          </Box>
        </section>
        ) : null}

        {view === "requests" ? (
        <section className="workflow-panel proxy-traffic-panel" aria-labelledby="proxy-traffic-title">
          <PanelHeader
            id="proxy-traffic-title"
            title="请求"
            aside={
              <Stack direction="row" spacing={0.6}>
                <Tooltip title="刷新请求记录">
                  <IconButton onClick={() => void onRefresh()} aria-label="刷新请求记录">
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="清空当前代理记录">
                  <span>
                    <IconButton
                      onClick={() => void onClearEvents(selectedProfile?.id)}
                      disabled={!selectedProfile || events.length === 0 || Boolean(busy)}
                      aria-label="清空当前代理记录"
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            }
          />

          <Box className="proxy-traffic-grid">
            <Box className="proxy-event-list module-list-scroll" role="list" aria-label="代理请求记录">
              {events.length > 0 ? (
                events.map((event) => (
                  <Box
                    component="div"
                    key={event.id}
                    role="listitem"
                    className={`proxy-event-item${selectedEvent?.id === event.id ? " is-active" : ""}`}
                  >
                    <Box
                      component="div"
                      className="proxy-event-button"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedEventId(event.id)}
                      onKeyDown={(keyboardEvent) =>
                        activateRow(keyboardEvent, () => setSelectedEventId(event.id))
                      }
                    >
                      <span className="proxy-event-main">
                        <span>
                          <b>{event.method}</b>
                          <small translate="no">{event.path || event.url}</small>
                        </span>
                        <span>{formatDateTime(event.startedAt)}</span>
                      </span>
                      <span className="proxy-event-meta">
                        <Chip
                          size="small"
                          color={eventStatusTone(event)}
                          label={event.status ?? "-"}
                          variant={event.error ? "outlined" : "filled"}
                        />
                        <Chip size="small" label={actionLabel(event.action)} variant="outlined" />
                        {event.matchedRuleName ? (
                          <Chip
                            size="small"
                            icon={<StarIcon fontSize="small" />}
                            label={event.matchedRuleName}
                            variant="outlined"
                          />
                        ) : null}
                      </span>
                    </Box>
                  </Box>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  暂无请求记录。
                </Typography>
              )}
            </Box>

            <Box className="proxy-event-detail module-list-scroll">
              {selectedEvent ? (
                <Stack spacing={1} minWidth={0}>
                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip label={selectedEvent.method} color="primary" />
                    <Chip label={selectedEvent.status ?? "-"} color={eventStatusTone(selectedEvent)} />
                    <Chip label={`${formatNumber(selectedEvent.durationMs)} ms`} variant="outlined" />
                    <Chip
                      label={`${formatNumber(selectedEvent.requestBytes)} B / ${formatNumber(selectedEvent.responseBytes)} B`}
                      variant="outlined"
                    />
                  </Stack>
                  <Typography variant="body2" translate="no" sx={{ overflowWrap: "anywhere", fontWeight: 760 }}>
                    {selectedEvent.url}
                  </Typography>
                  {selectedEvent.error ? (
                    <Alert severity="error" sx={{ py: 0 }}>
                      {selectedEvent.error}
                    </Alert>
                  ) : null}
                  <Divider />
                  <Box className="proxy-detail-grid">
                    <ProxyPreview title="Request Headers" value={selectedEvent.requestHeaders} />
                    <ProxyPreview title="Response Headers" value={selectedEvent.responseHeaders} />
                    <ProxyPreview
                      title={selectedEvent.requestBodyTruncated ? "Request Body +" : "Request Body"}
                      value={selectedEvent.requestBodyPreview}
                    />
                    <ProxyPreview
                      title={selectedEvent.responseBodyTruncated ? "Response Body +" : "Response Body"}
                      value={selectedEvent.responseBodyPreview}
                    />
                  </Box>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  选择一条请求查看详情。
                </Typography>
              )}
            </Box>
          </Box>
        </section>
        ) : null}
      </Box>

      <ProfileDialog
        open={profileDialogOpen}
        draft={profileDraft}
        busy={busy}
        error={formError}
        copiedKey={copiedKey}
        selectedStatusUrl={profileDraft ? statuses.get(profileDraft.id)?.listenUrl : null}
        onClose={closeProfileDialog}
        onChange={updateProfileDraft}
        onCopy={copyText}
        onSave={() => void saveProfileDraft()}
      />

      <RuleDialog
        open={ruleDialogOpen}
        draft={ruleDraft}
        busy={busy}
        error={formError}
        requestHeadersText={requestHeadersText}
        responseHeadersText={responseHeadersText}
        mockHeadersText={mockHeadersText}
        onClose={closeRuleDialog}
        onChange={updateRuleDraft}
        onActionChange={setRuleAction}
        onForwardChange={updateForwardAction}
        onMockChange={updateMockAction}
        onBlockChange={updateBlockAction}
        onRequestHeadersTextChange={setRequestHeadersText}
        onResponseHeadersTextChange={setResponseHeadersText}
        onMockHeadersTextChange={setMockHeadersText}
        onSave={() => void saveRuleDraft()}
        onDelete={existingRuleDraft ? () => void deleteRule(existingRuleDraft) : null}
      />
    </Box>
  );
}

function rulesForProfile(dashboard: ProxyDashboard | null, profileId: string) {
  return dashboard?.config.rules.filter((rule) => rule.profileId === profileId) ?? [];
}

function eventsForProfile(dashboard: ProxyDashboard | null, profileId: string) {
  return dashboard?.events.filter((event) => event.profileId === profileId) ?? [];
}

function PanelHeader({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} minWidth={0}>
      <Typography id={id} variant="h6" sx={{ fontWeight: 820, textWrap: "balance" }}>
        {title}
      </Typography>
      {aside}
    </Stack>
  );
}

function EmptyProxyState({
  text,
  demoAvailable,
  onLoadDemoData,
}: {
  text: string;
  demoAvailable: boolean;
  onLoadDemoData?: () => void;
}) {
  return (
    <Stack spacing={0.7} alignItems="flex-start" className="proxy-empty-state">
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
      {demoAvailable && onLoadDemoData ? (
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<PlusIcon fontSize="small" />}
          onClick={onLoadDemoData}
        >
          载入示例数据
        </Button>
      ) : null}
    </Stack>
  );
}

function ProfileDialog({
  open,
  draft,
  busy,
  error,
  copiedKey,
  selectedStatusUrl,
  onClose,
  onChange,
  onCopy,
  onSave,
}: {
  open: boolean;
  draft: ProxyProfile | null;
  busy: string;
  error: string;
  copiedKey: string;
  selectedStatusUrl?: string | null;
  onClose: () => void;
  onChange: (patch: Partial<ProxyProfile>) => void;
  onCopy: (key: string, value: string) => Promise<void>;
  onSave: () => void;
}) {
  const proxyUrl = selectedStatusUrl || (draft ? `http://${draft.listenHost}:${draft.listenPort}` : "");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth className="proxy-config-dialog">
      <DialogTitle>{draft?.name ? "代理配置" : "新建代理"}</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
        {draft ? (
          <Stack spacing={1.2} minWidth={0}>
            <TextField
              label="名称"
              name="proxy-profile-name"
              autoComplete="off"
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            <Box className="proxy-two-fields">
              <TextField
                label="监听地址"
                name="proxy-listen-host"
                autoComplete="off"
                value={draft.listenHost}
                onChange={(event) => onChange({ listenHost: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
              <TextField
                label="端口"
                name="proxy-listen-port"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                value={draft.listenPort}
                onChange={(event) =>
                  onChange({ listenPort: Math.max(1, Number(event.target.value) || 0) })
                }
              />
            </Box>
            <TextField
              label="上游地址"
              name="proxy-upstream-base-url"
              autoComplete="off"
              value={draft.upstreamBaseUrl}
              onChange={(event) => onChange({ upstreamBaseUrl: event.target.value })}
              helperText="可空。为空时按请求原目标转发。"
              inputProps={{ spellCheck: false, translate: "no" }}
            />
            <TextField
              label="上游代理"
              name="proxy-upstream-proxy"
              autoComplete="off"
              value={draft.upstreamProxy}
              onChange={(event) => onChange({ upstreamProxy: event.target.value })}
              helperText="可空，例如 socks5://127.0.0.1:7890"
              inputProps={{ spellCheck: false, translate: "no" }}
            />
            <Box className="proxy-two-fields">
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.captureBody}
                    onChange={(event) => onChange({ captureBody: event.target.checked })}
                  />
                }
                label="记录正文"
              />
              <TextField
                label="正文预览字节"
                name="proxy-max-body-bytes"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                value={draft.maxBodyBytes}
                onChange={(event) =>
                  onChange({ maxBodyBytes: Math.max(512, Number(event.target.value) || 512) })
                }
              />
            </Box>
            {proxyUrl ? (
              <Stack spacing={0.55}>
                {[
                  ["HTTP_PROXY", proxyUrl],
                  ["HTTPS_PROXY", proxyUrl],
                ].map(([key, value]) => (
                  <Button
                    key={key}
                    variant="text"
                    color="inherit"
                    onClick={() => void onCopy(key, `${key}=${value}`)}
                    startIcon={copiedKey === key ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                    sx={{ justifyContent: "flex-start", fontFamily: "monospace" }}
                  >
                    {key}={value}
                  </Button>
                ))}
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={onSave} disabled={Boolean(busy)}>保存配置</Button>
      </DialogActions>
    </Dialog>
  );
}

function RuleDialog({
  open,
  draft,
  busy,
  error,
  requestHeadersText,
  responseHeadersText,
  mockHeadersText,
  onClose,
  onChange,
  onActionChange,
  onForwardChange,
  onMockChange,
  onBlockChange,
  onRequestHeadersTextChange,
  onResponseHeadersTextChange,
  onMockHeadersTextChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  draft: ProxyRule | null;
  busy: string;
  error: string;
  requestHeadersText: string;
  responseHeadersText: string;
  mockHeadersText: string;
  onClose: () => void;
  onChange: (patch: Partial<ProxyRule>) => void;
  onActionChange: (kind: ProxyRuleAction["kind"]) => void;
  onForwardChange: (patch: Partial<Extract<ProxyRuleAction, { kind: "forward" }>>) => void;
  onMockChange: (patch: Partial<Extract<ProxyRuleAction, { kind: "mock" }>>) => void;
  onBlockChange: (patch: Partial<Extract<ProxyRuleAction, { kind: "block" }>>) => void;
  onRequestHeadersTextChange: (value: string) => void;
  onResponseHeadersTextChange: (value: string) => void;
  onMockHeadersTextChange: (value: string) => void;
  onSave: () => void;
  onDelete: (() => void) | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth className="proxy-config-dialog">
      <DialogTitle>{draft?.name ? "规则配置" : "新建规则"}</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
        {draft ? (
          <Stack spacing={1.15} minWidth={0}>
            <Box className="proxy-two-fields">
              <TextField
                label="规则名称"
                name="proxy-rule-name"
                autoComplete="off"
                value={draft.name}
                onChange={(event) => onChange({ name: event.target.value })}
              />
              <TextField
                label="优先级"
                name="proxy-rule-priority"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                value={draft.priority}
                onChange={(event) => onChange({ priority: Number(event.target.value) || 0 })}
              />
            </Box>
            <Box className="proxy-three-fields">
              <TextField
                select
                label="方法"
                name="proxy-rule-method"
                value={draft.method}
                onChange={(event) => onChange({ method: event.target.value })}
              >
                {HTTP_METHODS.map((method) => (
                  <MenuItem key={method || "any"} value={method}>
                    {method || "任意"}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="路径前缀"
                name="proxy-rule-path-prefix"
                autoComplete="off"
                value={draft.pathPrefix}
                onChange={(event) => onChange({ pathPrefix: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
              <TextField
                label="URL 包含"
                name="proxy-rule-url-contains"
                autoComplete="off"
                value={draft.urlContains}
                onChange={(event) => onChange({ urlContains: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
            </Box>
            <Box className="proxy-two-fields">
              <TextField
                label="Header 名"
                name="proxy-rule-header-name"
                autoComplete="off"
                value={draft.headerName}
                onChange={(event) => onChange({ headerName: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
              <TextField
                label="Header 包含"
                name="proxy-rule-header-contains"
                autoComplete="off"
                value={draft.headerContains}
                onChange={(event) => onChange({ headerContains: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
            </Box>
            <Box className="proxy-three-fields">
              <TextField
                select
                label="动作"
                name="proxy-rule-action"
                value={draft.action.kind}
                onChange={(event) => onActionChange(event.target.value as ProxyRuleAction["kind"])}
              >
                {ACTION_KINDS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.enabled}
                    onChange={(event) => onChange({ enabled: event.target.checked })}
                  />
                }
                label="启用"
              />
              <TextField
                label="延迟 ms"
                name="proxy-rule-delay-ms"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                value={draft.action.delayMs}
                onChange={(event) => {
                  const delayMs = Math.max(0, Number(event.target.value) || 0);
                  if (draft.action.kind === "forward") onForwardChange({ delayMs });
                  if (draft.action.kind === "mock") onMockChange({ delayMs });
                  if (draft.action.kind === "block") onBlockChange({ delayMs });
                }}
              />
            </Box>

            {draft.action.kind === "forward" ? (
              <Stack spacing={1.05}>
                <Box className="proxy-two-fields">
                  <TextField
                    label="目标上游"
                    name="proxy-rule-target-base-url"
                    autoComplete="off"
                    value={draft.action.targetBaseUrl}
                    onChange={(event) => onForwardChange({ targetBaseUrl: event.target.value })}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label="重写前缀"
                    name="proxy-rule-rewrite-prefix"
                    autoComplete="off"
                    value={draft.action.rewritePrefix}
                    onChange={(event) => onForwardChange({ rewritePrefix: event.target.value })}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                </Box>
                <Box className="proxy-two-fields">
                  <TextField
                    label="请求 Header"
                    name="proxy-rule-request-headers"
                    multiline
                    minRows={3}
                    autoComplete="off"
                    value={requestHeadersText}
                    onChange={(event) => onRequestHeadersTextChange(event.target.value)}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label="响应 Header"
                    name="proxy-rule-response-headers"
                    multiline
                    minRows={3}
                    autoComplete="off"
                    value={responseHeadersText}
                    onChange={(event) => onResponseHeadersTextChange(event.target.value)}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                </Box>
              </Stack>
            ) : null}

            {draft.action.kind === "mock" ? (
              <Stack spacing={1.05}>
                <Box className="proxy-two-fields">
                  <TextField
                    label="状态码"
                    name="proxy-rule-mock-status"
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.action.status}
                    onChange={(event) => onMockChange({ status: Number(event.target.value) || 200 })}
                  />
                  <TextField
                    label="Content-Type"
                    name="proxy-rule-mock-content-type"
                    autoComplete="off"
                    value={draft.action.contentType}
                    onChange={(event) => onMockChange({ contentType: event.target.value })}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                </Box>
                <TextField
                  label="响应 Header"
                  name="proxy-rule-mock-headers"
                  multiline
                  minRows={2}
                  autoComplete="off"
                  value={mockHeadersText}
                  onChange={(event) => onMockHeadersTextChange(event.target.value)}
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
                <TextField
                  label="响应正文"
                  name="proxy-rule-mock-body"
                  multiline
                  minRows={5}
                  autoComplete="off"
                  value={draft.action.body}
                  onChange={(event) => onMockChange({ body: event.target.value })}
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
              </Stack>
            ) : null}

            {draft.action.kind === "block" ? (
              <Stack spacing={1.05}>
                <TextField
                  label="状态码"
                  name="proxy-rule-block-status"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.action.status}
                  onChange={(event) => onBlockChange({ status: Number(event.target.value) || 403 })}
                />
                <TextField
                  label="阻断响应"
                  name="proxy-rule-block-body"
                  multiline
                  minRows={4}
                  autoComplete="off"
                  value={draft.action.body}
                  onChange={(event) => onBlockChange({ body: event.target.value })}
                />
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        {onDelete ? (
          <Button color="error" startIcon={<TrashIcon fontSize="small" />} onClick={onDelete}>
            删除
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={onSave} disabled={Boolean(busy)}>保存规则</Button>
      </DialogActions>
    </Dialog>
  );
}

function ProxyPreview({
  title,
  value,
}: {
  title: string;
  value: string | Record<string, string>;
}) {
  const text =
    typeof value === "string"
      ? value
      : Object.entries(value)
          .map(([key, item]) => `${key}: ${item}`)
          .join("\n");
  return (
    <Box className="proxy-preview">
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 820 }}>
        {title}
      </Typography>
      <Box component="pre" translate="no">
        {text || "-"}
      </Box>
    </Box>
  );
}
