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
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  ProxyDashboard,
  ProxyEvent,
  ProxyOutboundMode,
  ProxyProfile,
  ProxyRule,
  ProxyRuleAction,
} from "../app-types";
import {
  CheckIcon,
  ClearIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  PlusIcon,
  RefreshIcon,
  ReplayIcon,
  StarIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  WebsiteIcon,
} from "../components/AppIcons";

const HTTP_METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const ACTION_KINDS: Array<{ value: ProxyRuleAction["kind"]; label: string }> = [
  { value: "forward", label: "转发" },
  { value: "mock", label: "Mock" },
  { value: "block", label: "阻断" },
];

const OUTBOUND_MODES: Array<{ value: ProxyOutboundMode; label: string; helper: string }> = [
  { value: "inherit", label: "继承默认", helper: "使用服务配置里的上游代理；为空则直连" },
  { value: "direct", label: "直连", helper: "这条规则不走任何上游代理" },
  { value: "proxy", label: "指定代理", helper: "仅这条规则走指定 HTTP/SOCKS 上游" },
];

type RequestFilter = "all" | "success" | "failed" | "mock" | "forward" | "block";

const REQUEST_FILTERS: Array<{ value: RequestFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "mock", label: "Mock" },
  { value: "forward", label: "转发" },
  { value: "block", label: "阻断" },
];

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
  onExportProfilePack: (profileId: string, path: string) => Promise<ProxyDashboard> | void;
  onImportProfilePack: (path: string) => Promise<ProxyDashboard> | void;
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
    outboundMode: "inherit",
    outboundProxy: "",
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

function eventMatchesRequestFilter(event: ProxyEvent, filter: RequestFilter) {
  if (filter === "all") {
    return true;
  }
  if (filter === "success") {
    return !event.error && typeof event.status === "number" && event.status >= 200 && event.status < 400;
  }
  if (filter === "failed") {
    return Boolean(event.error) || event.action === "error" || (typeof event.status === "number" && event.status >= 400);
  }
  if (filter === "forward") {
    return event.action !== "mock" && event.action !== "block" && event.action !== "error";
  }
  return event.action === filter;
}

function eventMatchesQuery(event: ProxyEvent, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  return [
    event.method,
    event.url,
    event.path,
    String(event.status ?? ""),
    event.action,
    actionLabel(event.action),
    event.profileName,
    event.matchedRuleName ?? "",
    event.error ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(keyword);
}

function actionKindLabel(kind: ProxyRuleAction["kind"]) {
  return ACTION_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function outboundModeLabel(mode?: ProxyOutboundMode) {
  return OUTBOUND_MODES.find((item) => item.value === (mode ?? "inherit"))?.label ?? "继承默认";
}

function forwardOutboundMode(action: Extract<ProxyRuleAction, { kind: "forward" }>) {
  return action.outboundMode ?? "inherit";
}

function forwardOutboundProxy(action: Extract<ProxyRuleAction, { kind: "forward" }>) {
  return action.outboundProxy ?? "";
}

function activateRow(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  action();
}

function safeFileName(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "rdevtool-proxy";
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
  onExportProfilePack,
  onImportProfilePack,
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
  const [requestsDialogOpen, setRequestsDialogOpen] = useState(false);
  const [requestQuery, setRequestQuery] = useState("");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [formError, setFormError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [requestHeadersText, setRequestHeadersText] = useState("");
  const [responseHeadersText, setResponseHeadersText] = useState("");
  const [mockHeadersText, setMockHeadersText] = useState("");
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          eventMatchesRequestFilter(event, requestFilter) &&
          eventMatchesQuery(event, requestQuery),
      ),
    [events, requestFilter, requestQuery],
  );
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ?? filteredEvents[0] ?? null;
  const nextPort =
    Array.from({ length: 20 }, (_, index) => 8787 + index).find(
      (port) => !profiles.some((profile) => profile.listenPort === port),
    ) ?? 8787;
  const nextRulePriority = rules.length > 0 ? Math.max(...rules.map((rule) => rule.priority)) + 10 : 10;
  const existingRuleDraft =
    ruleDraft && rules.some((rule) => rule.id === ruleDraft.id) ? ruleDraft : null;

  useEffect(() => {
    if (!selectedEvent || filteredEvents.some((event) => event.id === selectedEventId)) {
      return;
    }
    setSelectedEventId(selectedEvent.id);
  }, [filteredEvents, selectedEvent, selectedEventId]);

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
        if ((action.outboundMode ?? "inherit") === "proxy" && !action.outboundProxy.trim()) {
          setFormError("选择指定代理时，上游代理地址不能为空");
          return;
        }
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

  async function importProfilePack() {
    try {
      const selected = await open({
        title: "导入代理包",
        multiple: false,
        directory: false,
        filters: [
          { name: "rDevTool Proxy Pack", extensions: ["json"] },
        ],
      });
      if (typeof selected !== "string") {
        return;
      }
      if (
        !window.confirm(
          "导入会创建一个新的代理服务，并把包内规则归属到新服务，不会覆盖现有服务。继续？",
        )
      ) {
        return;
      }
      await onImportProfilePack(selected);
    } catch (reason) {
      setFormError(String(reason instanceof Error ? reason.message : reason));
    }
  }

  async function exportSelectedProfilePack() {
    if (!selectedProfile) {
      return;
    }
    if (
      !window.confirm(
        "导出的代理包会包含当前服务配置、规则、Header、Mock Body 和上游地址。请确认其中没有敏感信息。",
      )
    ) {
      return;
    }
    try {
      const selected = await save({
        title: "导出代理包",
        defaultPath: `${safeFileName(selectedProfile.name)}.rdevproxy.json`,
        filters: [
          { name: "rDevTool Proxy Pack", extensions: ["json"] },
        ],
      });
      if (typeof selected !== "string") {
        return;
      }
      await onExportProfilePack(selectedProfile.id, selected);
    } catch (reason) {
      setFormError(String(reason instanceof Error ? reason.message : reason));
    }
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

      <Box className="proxy-main-grid proxy-main-grid--config">
        <section className="workflow-panel proxy-control-panel" aria-label="代理服务与规则">
          <Box className="proxy-control-split">
            <Box component="section" className="proxy-section proxy-service-panel" aria-labelledby="proxy-service-title">
              <PanelHeader
                id="proxy-service-title"
                title="服务"
                aside={
                  <Stack direction="row" spacing={0.6} alignItems="center">
                    <Button
                      className="proxy-request-open-button"
                      variant="outlined"
                      color="inherit"
                      startIcon={<WebsiteIcon fontSize="small" />}
                      disabled={!selectedProfile}
                      onClick={() => setRequestsDialogOpen(true)}
                    >
                      请求 {events.length}
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      startIcon={<UploadIcon fontSize="small" />}
                      disabled={Boolean(busy)}
                      onClick={() => void importProfilePack()}
                    >
                      导入
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      startIcon={<DownloadIcon fontSize="small" />}
                      disabled={!selectedProfile || Boolean(busy)}
                      onClick={() => void exportSelectedProfilePack()}
                    >
                      导出
                    </Button>
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

              <Box
                className={`proxy-card-list module-list-scroll${profiles.length === 0 ? " is-empty" : ""}`}
                role="list"
                aria-label="代理服务列表"
              >
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
                  <EmptyProxyState text="暂无代理配置。" />
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

              <Box
                className={`proxy-card-list module-list-scroll${rules.length === 0 ? " is-empty" : ""}`}
                role="list"
                aria-label="代理规则列表"
              >
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
                            {rule.action.kind === "forward" ? (
                              <Chip
                                size="small"
                                label={`出站 ${outboundModeLabel(forwardOutboundMode(rule.action))}`}
                                variant="outlined"
                              />
                            ) : null}
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
                  <EmptyProxyState text="暂无规则。" />
                )}
              </Box>
            </Box>
          </Box>
        </section>
      </Box>

      <Dialog
        open={requestsDialogOpen}
        onClose={() => setRequestsDialogOpen(false)}
        maxWidth="lg"
        fullWidth
        className="proxy-requests-dialog"
      >
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" alignItems="center" spacing={0.8} minWidth={0}>
              <WebsiteIcon fontSize="small" />
              <span>请求</span>
              <Chip size="small" label={`${filteredEvents.length} / ${events.length} 条`} variant="outlined" />
            </Stack>
            <Stack direction="row" spacing={0.6}>
              <Tooltip title="刷新请求记录">
                <IconButton onClick={() => void onRefresh()} aria-label="刷新请求记录">
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="关闭">
                <IconButton
                  onClick={() => setRequestsDialogOpen(false)}
                  aria-label="关闭请求面板"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Box className="proxy-requests-shell">
            <Box className="proxy-requests-toolbar">
              <TextField
                size="small"
                value={requestQuery}
                onChange={(event) => setRequestQuery(event.target.value)}
                placeholder="搜索接口 / 路径 / 状态 / 规则"
                inputProps={{ "aria-label": "搜索请求记录" }}
              />
              <Box className="proxy-request-filter-group" aria-label="筛选请求记录">
                {REQUEST_FILTERS.map((filter) => (
                  <Chip
                    key={filter.value}
                    label={filter.label}
                    color={requestFilter === filter.value ? "primary" : "default"}
                    variant={requestFilter === filter.value ? "filled" : "outlined"}
                    onClick={() => setRequestFilter(filter.value)}
                    clickable
                  />
                ))}
              </Box>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<ClearIcon fontSize="small" />}
                disabled={!requestQuery && requestFilter === "all"}
                onClick={() => {
                  setRequestQuery("");
                  setRequestFilter("all");
                }}
              >
                重置
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<TrashIcon fontSize="small" />}
                disabled={!selectedProfile || events.length === 0 || Boolean(busy)}
                onClick={() => void onClearEvents(selectedProfile?.id)}
              >
                清空
              </Button>
            </Box>

            <Box className="proxy-traffic-grid proxy-requests-modal-grid">
            <Box
              className={`proxy-event-list module-list-scroll${filteredEvents.length === 0 ? " is-empty" : ""}`}
              role="list"
              aria-label="代理请求记录"
            >
              {filteredEvents.length > 0 ? (
                filteredEvents.map((event) => (
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
                <Typography className="proxy-empty-copy" variant="body2" color="text.secondary">
                  {events.length > 0 ? "没有匹配的请求。" : "暂无请求记录。"}
                </Typography>
              )}
            </Box>

            <Box
              className={`proxy-event-detail module-list-scroll${selectedEvent ? "" : " is-empty"}`}
            >
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
                <Typography className="proxy-empty-copy" variant="body2" color="text.secondary">
                  选择一条请求查看详情。
                </Typography>
              )}
            </Box>
          </Box>
          </Box>
        </DialogContent>
      </Dialog>

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
    <Stack
      className="proxy-panel-header"
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={1}
      minWidth={0}
    >
      <Typography id={id} variant="h6" sx={{ fontWeight: 820, textWrap: "balance" }}>
        {title}
      </Typography>
      {aside}
    </Stack>
  );
}

function EmptyProxyState({ text }: { text: string }) {
  return (
    <Stack spacing={0.7} alignItems="flex-start" className="proxy-empty-state">
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
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
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth className="proxy-config-dialog">
      <DialogTitle>
        <Stack className="proxy-profile-title" direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
          <Box minWidth={0}>
            <Typography variant="h6">{draft?.name ? "代理配置" : "新建代理"}</Typography>
            <Typography variant="body2" color="text.secondary">
              配置本机监听入口、默认转发目标和请求记录策略。
            </Typography>
          </Box>
          {proxyUrl ? <Chip className="proxy-profile-url-chip" label={proxyUrl} size="small" /> : null}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
        {draft ? (
          <Stack className="proxy-profile-form" spacing={1.1} minWidth={0}>
            <Box className="proxy-profile-section">
              <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box minWidth={0}>
                  <Typography variant="subtitle2">监听入口</Typography>
                  <Typography variant="caption" color="text.secondary">
                    其他应用连接到这个本地地址后，请求会进入 rDevTool 代理服务。
                  </Typography>
                </Box>
                <Chip label="HTTP / HTTPS" size="small" />
              </Stack>
              <Stack spacing={1}>
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
              </Stack>
            </Box>

            <Box className="proxy-profile-section proxy-profile-section--route">
              <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box minWidth={0}>
                  <Typography variant="subtitle2">默认转发</Typography>
                  <Typography variant="caption" color="text.secondary">
                    没有被规则改写时使用；规则里的出站设置可以覆盖这里。
                  </Typography>
                </Box>
                <Chip label={draft.upstreamProxy ? "代理中转" : "默认直连"} size="small" color={draft.upstreamProxy ? "primary" : "default"} />
              </Stack>
              <Box className="proxy-two-fields">
                <TextField
                  label="上游地址"
                  name="proxy-upstream-base-url"
                  autoComplete="off"
                  placeholder="https://api.example.com"
                  value={draft.upstreamBaseUrl}
                  onChange={(event) => onChange({ upstreamBaseUrl: event.target.value })}
                  helperText="可空。用于相对路径请求的默认目标；为空时按请求原目标转发。"
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
                <TextField
                  label="上游代理"
                  name="proxy-upstream-proxy"
                  autoComplete="off"
                  placeholder="socks5://127.0.0.1:7890"
                  value={draft.upstreamProxy}
                  onChange={(event) => onChange({ upstreamProxy: event.target.value })}
                  helperText="可空。作为服务默认出站代理；规则选择“继承默认”时使用。"
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
              </Box>
            </Box>

            <Box className="proxy-profile-section proxy-profile-section--capture">
              <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box minWidth={0}>
                  <Typography variant="subtitle2">记录</Typography>
                  <Typography variant="caption" color="text.secondary">
                    控制请求面板里是否保存 Body 预览，Header 与基础信息会继续记录。
                  </Typography>
                </Box>
                <Switch
                  checked={draft.captureBody}
                  onChange={(event) => onChange({ captureBody: event.target.checked })}
                  inputProps={{ "aria-label": "记录正文" }}
                />
              </Stack>
              <Box className="proxy-two-fields proxy-profile-capture-grid">
                <Box className="proxy-profile-capture-card">
                  <Typography variant="body2" sx={{ fontWeight: 780 }}>记录正文</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {draft.captureBody ? "已开启，会保存请求与响应正文预览。" : "已关闭，只记录 URL、状态码、耗时和 Header。"}
                  </Typography>
                </Box>
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
                  helperText="每个请求/响应最多保留的正文预览大小。"
                />
              </Box>
            </Box>

            {proxyUrl ? (
              <Box className="proxy-profile-section proxy-profile-section--env">
                <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                  <Box minWidth={0}>
                    <Typography variant="subtitle2">环境变量</Typography>
                    <Typography variant="caption" color="text.secondary">
                      复制到终端或项目运行配置里，让命令行请求走这个代理入口。
                    </Typography>
                  </Box>
                </Stack>
                <Box className="proxy-profile-env-list">
                  {[
                    ["HTTP_PROXY", proxyUrl],
                    ["HTTPS_PROXY", proxyUrl],
                  ].map(([key, value]) => (
                    <Button
                      key={key}
                      className="proxy-profile-env-button"
                      variant="outlined"
                      color="inherit"
                      onClick={() => void onCopy(key, `${key}=${value}`)}
                      startIcon={copiedKey === key ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                    >
                      <span>{key}</span>
                      <code>{value}</code>
                    </Button>
                  ))}
                </Box>
              </Box>
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
  const forwardAction = draft?.action.kind === "forward" ? draft.action : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth className="proxy-config-dialog proxy-rule-dialog">
      <DialogTitle>{draft?.name ? "规则配置" : "新建规则"}</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
        {draft ? (
          <Stack spacing={0.85} minWidth={0}>
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

            {forwardAction ? (
              <Stack spacing={0.85}>
                <Box className="proxy-rule-subsection">
                  <span>
                    <b>目标</b>
                    <small>只决定请求转发到哪里，不决定是否走代理。</small>
                  </span>
                  <Box className="proxy-two-fields">
                    <TextField
                      label="转发到"
                      name="proxy-rule-target-base-url"
                      autoComplete="off"
                      placeholder="为空则使用原请求地址"
                      value={forwardAction.targetBaseUrl}
                      onChange={(event) => onForwardChange({ targetBaseUrl: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                    <TextField
                      label="路径改写"
                      name="proxy-rule-rewrite-prefix"
                      autoComplete="off"
                      placeholder="例如 /mock-api"
                      value={forwardAction.rewritePrefix}
                      onChange={(event) => onForwardChange({ rewritePrefix: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                  </Box>
                </Box>
                <Box className="proxy-rule-subsection">
                  <span>
                    <b>出站</b>
                    <small>{OUTBOUND_MODES.find((item) => item.value === forwardOutboundMode(forwardAction))?.helper}</small>
                  </span>
                  <Box className="proxy-two-fields">
                    <TextField
                      select
                      label="出站策略"
                      name="proxy-rule-outbound-mode"
                      value={forwardOutboundMode(forwardAction)}
                      onChange={(event) =>
                        onForwardChange({
                          outboundMode: event.target.value as ProxyOutboundMode,
                          outboundProxy:
                            event.target.value === "proxy"
                              ? forwardOutboundProxy(forwardAction)
                              : "",
                        })
                      }
                    >
                      {OUTBOUND_MODES.map((item) => (
                        <MenuItem key={item.value} value={item.value}>
                          {item.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="指定上游代理"
                      name="proxy-rule-outbound-proxy"
                      autoComplete="off"
                      placeholder="socks5://127.0.0.1:7890"
                      value={forwardOutboundProxy(forwardAction)}
                      onChange={(event) => onForwardChange({ outboundProxy: event.target.value })}
                      disabled={forwardOutboundMode(forwardAction) !== "proxy"}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                  </Box>
                </Box>
                <Box className="proxy-two-fields">
                  <TextField
                    label="追加请求 Header"
                    name="proxy-rule-request-headers"
                    multiline
                    minRows={2}
                    autoComplete="off"
                    value={requestHeadersText}
                    onChange={(event) => onRequestHeadersTextChange(event.target.value)}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label="追加响应 Header"
                    name="proxy-rule-response-headers"
                    multiline
                    minRows={2}
                    autoComplete="off"
                    value={responseHeadersText}
                    onChange={(event) => onResponseHeadersTextChange(event.target.value)}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                </Box>
              </Stack>
            ) : null}

            {draft.action.kind === "mock" ? (
              <Stack spacing={0.85}>
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
                  minRows={4}
                  autoComplete="off"
                  value={draft.action.body}
                  onChange={(event) => onMockChange({ body: event.target.value })}
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
              </Stack>
            ) : null}

            {draft.action.kind === "block" ? (
              <Stack spacing={0.85}>
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
                  minRows={3}
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
