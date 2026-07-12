import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react";
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
  BindProxyRuntimeRequest,
  ProjectWorkspaceSummary,
  ProxyDashboard,
  ProxyEvent,
  ProxyOutboundMode,
  ProxyProfile,
  ProxyRequestDiagnosis,
  ProxyRequestDiagnosisInput,
  ProxyRule,
  ProxyRuleAction,
} from "../app-types";
import {
  CheckIcon,
  ClearIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  WebsiteIcon,
} from "../components/AppIcons";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppToast } from "../components/AppToast";

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

const REQUEST_EVENT_LOAD_BATCH_SIZE = 50;

const REQUEST_FILTERS: Array<{ value: RequestFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "mock", label: "Mock" },
  { value: "forward", label: "转发" },
  { value: "block", label: "阻断" },
];

type InterfaceProxyDraft = {
  serviceName: string;
  ruleName: string;
  listenHost: string;
  listenPort: number;
  method: string;
  pathPrefix: string;
  actionKind: ProxyRuleAction["kind"];
  targetBaseUrl: string;
  rewritePrefix: string;
  mockStatus: number;
  mockContentType: string;
  mockBody: string;
  blockStatus: number;
  blockBody: string;
  bindRuntime: boolean;
  runtimeProfileKey: string;
  runtimeProfileLabel: string;
  project: string;
  createDebugProfile: boolean;
  debugProfileLabel: string;
  enableNetworkProxy: boolean;
  nodeHook: boolean;
};

export type ProxyPageProps = {
  dashboard: ProxyDashboard | null;
  selectedProfileId: string;
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  projects: Array<{ key: string; name: string }>;
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
  onBindProxyRuntimeProfile: (request: BindProxyRuntimeRequest) => Promise<ProxyDashboard> | void;
  onDiagnoseRequest: (request: ProxyRequestDiagnosisInput) => Promise<ProxyRequestDiagnosis>;
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

function createInterfaceProxyDraft(port = 8787, project = ""): InterfaceProxyDraft {
  return {
    serviceName: "接口代理",
    ruleName: "默认接口规则",
    listenHost: "127.0.0.1",
    listenPort: port,
    method: "",
    pathPrefix: "/api/",
    actionKind: "forward",
    targetBaseUrl: "",
    rewritePrefix: "",
    mockStatus: 200,
    mockContentType: "application/json; charset=utf-8",
    mockBody: '{\n  "ok": true\n}',
    blockStatus: 403,
    blockBody: "Blocked by rDevTool proxy",
    bindRuntime: true,
    runtimeProfileKey: "",
    runtimeProfileLabel: "接口代理运行配置",
    project,
    createDebugProfile: Boolean(project),
    debugProfileLabel: "代理启动",
    enableNetworkProxy: false,
    nodeHook: false,
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

function normalizeHeaderMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, headerValue]) => [
      key,
      String(headerValue ?? ""),
    ]),
  );
}

function readTextField(record: Record<string, unknown>, camelKey: string, snakeKey: string, fallback = "") {
  const value = record[camelKey] ?? record[snakeKey];
  return value === undefined || value === null ? fallback : String(value);
}

function readNumberField(record: Record<string, unknown>, camelKey: string, snakeKey: string, fallback = 0) {
  const value = record[camelKey] ?? record[snakeKey];
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function readOutboundMode(record: Record<string, unknown>) {
  const value = record.outboundMode ?? record.outbound_mode;
  return value === "direct" || value === "proxy" || value === "inherit" ? value : "inherit";
}

function normalizeRuleAction(action: ProxyRuleAction): ProxyRuleAction {
  const record = action as ProxyRuleAction & Record<string, unknown>;
  const delayMs = readNumberField(record, "delayMs", "delay_ms", 0);
  if (action.kind === "forward") {
    return {
      kind: "forward",
      targetBaseUrl: readTextField(record, "targetBaseUrl", "target_base_url"),
      rewritePrefix: readTextField(record, "rewritePrefix", "rewrite_prefix"),
      requestHeaders: normalizeHeaderMap(record.requestHeaders ?? record.request_headers),
      responseHeaders: normalizeHeaderMap(record.responseHeaders ?? record.response_headers),
      outboundMode: readOutboundMode(record),
      outboundProxy: readTextField(record, "outboundProxy", "outbound_proxy"),
      delayMs,
    };
  }
  if (action.kind === "mock") {
    return {
      kind: "mock",
      status: readNumberField(record, "status", "status", 200),
      contentType: readTextField(record, "contentType", "content_type", "application/json; charset=utf-8"),
      body: readTextField(record, "body", "body"),
      headers: normalizeHeaderMap(record.headers),
      delayMs,
    };
  }
  return {
    kind: "block",
    status: readNumberField(record, "status", "status", 403),
    body: readTextField(record, "body", "body"),
    delayMs,
  };
}

function normalizeRule(rule: ProxyRule): ProxyRule {
  return {
    ...rule,
    action: normalizeRuleAction(rule.action),
  };
}

function headersToText(headers?: Record<string, string> | null) {
  return Object.entries(headers ?? {})
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
  const action = normalizeRuleAction(rule.action);
  if (action.kind === "forward") {
    return {
      requestHeadersText: headersToText(action.requestHeaders),
      responseHeadersText: headersToText(action.responseHeaders),
      mockHeadersText: "",
    };
  }
  if (action.kind === "mock") {
    return {
      requestHeadersText: "",
      responseHeadersText: "",
      mockHeadersText: headersToText(action.headers),
    };
  }
  return {
    requestHeadersText: "",
    responseHeadersText: "",
    mockHeadersText: "",
  };
}

function sortedRules(rules: ProxyRule[]) {
  return rules.map(normalizeRule).sort(
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

function diagnosisSeverity(result: ProxyRequestDiagnosis | null) {
  if (!result) {
    return "info" as const;
  }
  if (result.statusKey === "matched") {
    return "success" as const;
  }
  return result.statusKey === "notMatched" ? "warning" as const : "info" as const;
}

function diagnosisMatchCount(result: ProxyRequestDiagnosis | null) {
  return result?.decisions.filter((decision) => decision.matched).length ?? 0;
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
  const normalizedAction = normalizeRuleAction(action);
  return normalizedAction.kind === "forward" ? normalizedAction.outboundMode : "inherit";
}

function forwardOutboundProxy(action: Extract<ProxyRuleAction, { kind: "forward" }>) {
  const normalizedAction = normalizeRuleAction(action);
  return normalizedAction.kind === "forward" ? normalizedAction.outboundProxy : "";
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

function normalizePathPrefix(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function profileFromInterfaceDraft(draft: InterfaceProxyDraft): ProxyProfile {
  return {
    ...createProfile(draft.listenPort),
    name: draft.serviceName.trim(),
    listenHost: draft.listenHost.trim(),
    listenPort: draft.listenPort,
  };
}

function ruleActionFromInterfaceDraft(draft: InterfaceProxyDraft): ProxyRuleAction {
  if (draft.actionKind === "mock") {
    return {
      kind: "mock",
      status: draft.mockStatus,
      contentType: draft.mockContentType.trim() || "application/json; charset=utf-8",
      body: draft.mockBody,
      headers: {},
      delayMs: 0,
    };
  }
  if (draft.actionKind === "block") {
    return {
      kind: "block",
      status: draft.blockStatus,
      body: draft.blockBody,
      delayMs: 0,
    };
  }
  return {
    kind: "forward",
    targetBaseUrl: draft.targetBaseUrl.trim(),
    rewritePrefix: draft.rewritePrefix.trim(),
    requestHeaders: {},
    responseHeaders: {},
    outboundMode: "inherit",
    outboundProxy: "",
    delayMs: 0,
  };
}

function ruleFromInterfaceDraft(
  profileId: string,
  draft: InterfaceProxyDraft,
): ProxyRule {
  return {
    ...createRule(profileId, 10),
    name: draft.ruleName.trim(),
    method: draft.method.trim(),
    pathPrefix: normalizePathPrefix(draft.pathPrefix),
    action: ruleActionFromInterfaceDraft(draft),
  };
}

export function ProxyPage({
  dashboard,
  selectedProfileId,
  activeProjectWorkspaceKey,
  projectWorkspaces,
  projects,
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
  onBindProxyRuntimeProfile,
  onDiagnoseRequest,
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
  const [interfaceProxyDraft, setInterfaceProxyDraft] = useState<InterfaceProxyDraft | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [interfaceProxyDialogOpen, setInterfaceProxyDialogOpen] = useState(false);
  const [requestsDialogOpen, setRequestsDialogOpen] = useState(false);
  const [requestQuery, setRequestQuery] = useState("");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [formError, setFormErrorValue] = useState("");
  const [toastNonce, setToastNonce] = useState(0);
  const [copiedKey, setCopiedKey] = useState("");
  const [savingRuleIds, setSavingRuleIds] = useState<string[]>([]);
  const [bulkRuleSaving, setBulkRuleSaving] = useState(false);
  const [requestHeadersText, setRequestHeadersText] = useState("");
  const [responseHeadersText, setResponseHeadersText] = useState("");
  const [mockHeadersText, setMockHeadersText] = useState("");
  const [diagnosisMethod, setDiagnosisMethod] = useState("POST");
  const [diagnosisUrl, setDiagnosisUrl] = useState("");
  const [diagnosisResult, setDiagnosisResult] = useState<ProxyRequestDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [requestVisibleCount, setRequestVisibleCount] = useState(REQUEST_EVENT_LOAD_BATCH_SIZE);
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          eventMatchesRequestFilter(event, requestFilter) &&
          eventMatchesQuery(event, requestQuery),
      ),
    [events, requestFilter, requestQuery],
  );
  const visibleEvents = filteredEvents.slice(0, requestVisibleCount);
  const hasMoreRequestEvents = visibleEvents.length < filteredEvents.length;
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ?? filteredEvents[0] ?? null;
  const nextPort =
    Array.from({ length: 20 }, (_, index) => 8787 + index).find(
      (port) => !profiles.some((profile) => profile.listenPort === port),
    ) ?? 8787;
  const nextRulePriority = rules.length > 0 ? Math.max(...rules.map((rule) => rule.priority)) + 10 : 10;
  const existingRuleDraft =
    ruleDraft && rules.some((rule) => rule.id === ruleDraft.id) ? ruleDraft : null;
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const disabledRuleCount = rules.length - enabledRuleCount;
  const ruleSaveBusy = busy === "正在保存代理规则";
  const blockingBusy = Boolean(busy) && !ruleSaveBusy;
  const activeWorkspace =
    projectWorkspaces.find((workspace) => workspace.key === activeProjectWorkspaceKey) ?? null;
  const workspaceSaveLabel = activeWorkspace
    ? activeWorkspace.system
      ? "全局视图"
      : activeWorkspace.name
    : activeProjectWorkspaceKey || "当前工作区";
  const defaultBindProject = projects.length === 1 ? projects[0].key : "";

  function setFormError(value: string) {
    setFormErrorValue(value);
    if (value.trim()) {
      setToastNonce((current) => current + 1);
    }
  }

  useEffect(() => {
    if (!selectedEvent || filteredEvents.some((event) => event.id === selectedEventId)) {
      return;
    }
    setSelectedEventId(selectedEvent.id);
  }, [filteredEvents, selectedEvent, selectedEventId]);

  useEffect(() => {
    if (!selectedEvent || diagnosisUrl.trim()) {
      return;
    }
    setDiagnosisMethod(selectedEvent.method || "GET");
    setDiagnosisUrl(selectedEvent.path || selectedEvent.url || "");
  }, [diagnosisUrl, selectedEvent]);

  useEffect(() => {
    setRequestVisibleCount(REQUEST_EVENT_LOAD_BATCH_SIZE);
  }, [requestFilter, requestQuery, selectedProfile?.id]);

  function loadMoreRequestEvents() {
    setRequestVisibleCount((current) =>
      Math.min(current + REQUEST_EVENT_LOAD_BATCH_SIZE, filteredEvents.length),
    );
  }

  function handleRequestListScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreRequestEvents) {
      return;
    }
    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 40) {
      loadMoreRequestEvents();
    }
  }

  function openProfileDialog(profile: ProxyProfile) {
    setFormError("");
    setProfileDraft(profile);
    setProfileDialogOpen(true);
  }

  function openInterfaceProxyDialog() {
    setFormError("");
    setInterfaceProxyDraft(createInterfaceProxyDraft(nextPort, defaultBindProject));
    setInterfaceProxyDialogOpen(true);
  }

  function closeProfileDialog() {
    setProfileDialogOpen(false);
    setProfileDraft(null);
    setFormError("");
  }

  function closeInterfaceProxyDialog() {
    setInterfaceProxyDialogOpen(false);
    setInterfaceProxyDraft(null);
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

  function updateInterfaceProxyDraft(patch: Partial<InterfaceProxyDraft>) {
    setInterfaceProxyDraft((current) => (current ? { ...current, ...patch } : current));
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

  function useSelectedEventForDiagnosis() {
    if (!selectedEvent) {
      return;
    }
    setDiagnosisMethod(selectedEvent.method || "GET");
    setDiagnosisUrl(selectedEvent.path || selectedEvent.url || "");
    setDiagnosisResult(null);
  }

  async function diagnoseRequest() {
    if (!selectedProfile) {
      setFormError("请选择代理服务");
      return;
    }
    const url = diagnosisUrl.trim();
    if (!url) {
      setFormError("请输入请求路径或 URL");
      return;
    }
    setFormError("");
    setDiagnosisLoading(true);
    try {
      const result = await onDiagnoseRequest({
        profile: selectedProfile.id,
        method: diagnosisMethod.trim() || "GET",
        url,
        headers: {},
      });
      setDiagnosisResult(result);
    } catch (reason) {
      setFormError(String(reason));
    } finally {
      setDiagnosisLoading(false);
    }
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

  async function saveInterfaceProxyDraft() {
    if (!interfaceProxyDraft) {
      return;
    }
    setFormError("");
    if (!interfaceProxyDraft.serviceName.trim()) {
      setFormError("服务名称不能为空");
      return;
    }
    if (!interfaceProxyDraft.ruleName.trim()) {
      setFormError("规则名称不能为空");
      return;
    }
    if (!interfaceProxyDraft.listenHost.trim() || !interfaceProxyDraft.listenPort) {
      setFormError("监听地址和端口不能为空");
      return;
    }
    if (!normalizePathPrefix(interfaceProxyDraft.pathPrefix)) {
      setFormError("接口前缀不能为空");
      return;
    }
    if (interfaceProxyDraft.actionKind === "forward" && !interfaceProxyDraft.targetBaseUrl.trim()) {
      setFormError("转发目标不能为空");
      return;
    }
    const profile = profileFromInterfaceDraft(interfaceProxyDraft);
    const rule = ruleFromInterfaceDraft(profile.id, interfaceProxyDraft);
    await onSaveProfile(profile);
    await onSaveRule(rule);
    if (interfaceProxyDraft.bindRuntime) {
      await onBindProxyRuntimeProfile({
        proxyProfile: profile.id,
        runtimeProfileKey: interfaceProxyDraft.runtimeProfileKey.trim() || null,
        runtimeProfileLabel: interfaceProxyDraft.runtimeProfileLabel.trim() || null,
        project:
          interfaceProxyDraft.project.trim() && interfaceProxyDraft.createDebugProfile
            ? interfaceProxyDraft.project.trim()
            : null,
        debugProfile: null,
        createDebugProfile: Boolean(
          interfaceProxyDraft.project.trim() && interfaceProxyDraft.createDebugProfile,
        ),
        debugProfileLabel: interfaceProxyDraft.debugProfileLabel.trim() || null,
        enableNetworkProxy: interfaceProxyDraft.enableNetworkProxy,
        nodeHook: interfaceProxyDraft.nodeHook,
      });
    }
    onSelectedProfileChange(profile.id);
    closeInterfaceProxyDialog();
  }

  async function deleteProfile(profile: ProxyProfile) {
    const confirmed = await confirm({
      title: "删除代理配置",
      description: `删除“${profile.name}”后，相关规则和记录也会被移除。`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!confirmed) {
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

  async function toggleRuleEnabled(rule: ProxyRule, enabled: boolean) {
    if (rule.enabled === enabled || savingRuleIds.includes(rule.id)) {
      return;
    }
    setSavingRuleIds((current) => (current.includes(rule.id) ? current : [...current, rule.id]));
    try {
      await onSaveRule({ ...rule, enabled });
    } finally {
      setSavingRuleIds((current) => current.filter((id) => id !== rule.id));
    }
  }

  async function setAllRulesEnabled(enabled: boolean) {
    const changedRules = rules.filter((rule) => rule.enabled !== enabled);
    if (changedRules.length === 0) {
      return;
    }
    setBulkRuleSaving(true);
    setSavingRuleIds((current) => Array.from(new Set([...current, ...changedRules.map((rule) => rule.id)])));
    try {
      for (const rule of changedRules) {
        await onSaveRule({ ...rule, enabled });
      }
    } finally {
      const changedIds = new Set(changedRules.map((rule) => rule.id));
      setSavingRuleIds((current) => current.filter((id) => !changedIds.has(id)));
      setBulkRuleSaving(false);
    }
  }

  async function deleteRule(rule: ProxyRule) {
    const confirmed = await confirm({
      title: "删除规则",
      description: `删除“${rule.name}”？`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!confirmed) {
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
      const confirmed = await confirm({
        title: "导入代理包",
        description: "导入会创建一个新的代理服务，并把包内规则归属到新服务，不会覆盖现有服务。",
        confirmLabel: "导入",
      });
      if (!confirmed) {
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
    const confirmed = await confirm({
      title: "导出代理包",
      description:
        "导出的代理包会包含当前服务配置、规则、Header、Mock Body 和上游地址。请确认其中没有敏感信息。",
      confirmLabel: "继续导出",
    });
    if (!confirmed) {
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
      <AppToast
        message={error || formError || busy}
        severity={error ? "error" : formError ? "warning" : "info"}
        autoHideDuration={error || formError ? 5200 : 2800}
        nonce={toastNonce}
      />

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
                      variant="contained"
                      startIcon={<PlusIcon fontSize="small" />}
                      disabled={blockingBusy}
                      onClick={openInterfaceProxyDialog}
                    >
                      接口代理
                    </Button>
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
                      disabled={blockingBusy}
                      onClick={() => void importProfilePack()}
                    >
                      导入
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      startIcon={<DownloadIcon fontSize="small" />}
                      disabled={!selectedProfile || blockingBusy}
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
                    const listenUrl =
                      status?.listenUrl ?? `http://${profile.listenHost}:${profile.listenPort}`;
                    const ruleCount = rulesForProfile(dashboard, profile.id).length;
                    const eventCount = eventsForProfile(dashboard, profile.id).length;
                    return (
                      <Box
                        key={profile.id}
                        className={`proxy-list-item proxy-service-card${
                          selected ? " is-active" : ""
                        }${status?.running ? " is-running" : " is-stopped"}`}
                        role="listitem"
                      >
                        <Box
                          component="div"
                          role="button"
                          tabIndex={0}
                          className="proxy-list-item-main proxy-list-main-button proxy-service-main"
                          onClick={() => onSelectedProfileChange(profile.id)}
                          onKeyDown={(event) =>
                            activateRow(event, () => onSelectedProfileChange(profile.id))
                          }
                        >
                          <span className="proxy-service-mark" aria-hidden="true">
                            <WebsiteIcon fontSize="small" />
                          </span>
                          <span className="proxy-service-copy">
                            <span className="proxy-list-title-row proxy-service-title-row">
                              <b>{profile.name}</b>
                            </span>
                            <span className="proxy-list-detail-row proxy-service-detail-row">
                              <small className="proxy-service-url" translate="no">
                                {listenUrl}
                              </small>
                            </span>
                          </span>
                        </Box>
                        <span className="proxy-service-side">
                          <span className="proxy-service-tags">
                            <Chip
                              className="proxy-service-status-chip"
                              size="small"
                              label={status?.running ? "运行中" : "已停止"}
                              color={status?.running ? "success" : "default"}
                              variant={status?.running ? "filled" : "outlined"}
                            />
                            <Chip
                              className="proxy-service-metric-chip"
                              size="small"
                              label={`${ruleCount} 规则`}
                              variant="outlined"
                            />
                            <Chip
                              className="proxy-service-metric-chip"
                              size="small"
                              label={`${eventCount} 请求`}
                              variant="outlined"
                            />
                          </span>
                          <span className="proxy-list-actions proxy-service-actions">
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
                                {status?.running ? <StopIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
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
                                  disabled={profiles.length <= 1 || blockingBusy}
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
                        </span>
                      </Box>
                    );
                  })
                ) : (
                  <EmptyProxyState title="暂无代理配置" description="新增一个本地代理后即可开始监听请求。" />
                )}
              </Box>
            </Box>

            <Box component="section" className="proxy-section proxy-rules-panel" aria-labelledby="proxy-rule-title">
              <PanelHeader
                id="proxy-rule-title"
                title="规则"
                aside={
                  <Stack className="proxy-rule-bulk-actions" direction="row" spacing={0.55} alignItems="center">
                    <Button
                      className="proxy-rule-bulk-button"
                      variant="outlined"
                      color="inherit"
                      startIcon={<PlayIcon fontSize="small" />}
                      disabled={!selectedProfile || disabledRuleCount === 0 || blockingBusy || bulkRuleSaving}
                      onClick={() => void setAllRulesEnabled(true)}
                    >
                      全部启用
                    </Button>
                    <Button
                      className="proxy-rule-bulk-button"
                      variant="outlined"
                      color="inherit"
                      startIcon={<StopIcon fontSize="small" />}
                      disabled={!selectedProfile || enabledRuleCount === 0 || blockingBusy || bulkRuleSaving}
                      onClick={() => void setAllRulesEnabled(false)}
                    >
                      全部停用
                    </Button>
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
                  </Stack>
                }
              />

              <Box
                className={`proxy-card-list module-list-scroll${rules.length === 0 ? " is-empty" : ""}`}
                role="list"
                aria-label="代理规则列表"
              >
                {rules.length > 0 ? (
                  rules.map((rule) => {
                    const matchMethod = rule.method || "任意";
                    const matchTarget = rule.pathPrefix || rule.urlContains || "自定义匹配";
                    return (
                      <Box
                        key={rule.id}
                        className={`proxy-list-item proxy-rule-row${
                          rule.enabled ? " is-enabled" : " is-disabled"
                        } is-${rule.action.kind}`}
                        role="listitem"
                      >
                        <Box
                          component="div"
                          role="button"
                          tabIndex={0}
                          className="proxy-list-item-main proxy-list-main-button proxy-rule-main"
                          onClick={() => openRuleDialog(rule)}
                          onKeyDown={(event) => activateRow(event, () => openRuleDialog(rule))}
                        >
                          <span className="proxy-rule-head">
                            <span className="proxy-rule-title-line">
                              <b>{rule.name}</b>
                              <span className="proxy-rule-badges">
                                <span className="proxy-rule-badge proxy-rule-badge--kind">
                                  {actionKindLabel(rule.action.kind)}
                                </span>
                                {rule.action.kind === "forward" ? (
                                  <span className="proxy-rule-badge">
                                    出站 {outboundModeLabel(forwardOutboundMode(rule.action))}
                                  </span>
                                ) : null}
                                <span className="proxy-rule-badge">P{rule.priority}</span>
                                {rule.action.delayMs > 0 ? (
                                  <span className="proxy-rule-badge">{formatNumber(rule.action.delayMs)} ms</span>
                                ) : null}
                              </span>
                            </span>
                            <span className="proxy-rule-match-line" translate="no">
                              <span className="proxy-rule-method">{matchMethod}</span>
                              <span className="proxy-rule-match-separator">·</span>
                              <small>{matchTarget}</small>
                            </span>
                          </span>
                        </Box>
                        <span className="proxy-rule-side">
                          <span className="proxy-list-actions proxy-rule-actions">
                            <Tooltip title={rule.enabled ? "停用规则" : "启用规则"}>
                              <Box
                                component="button"
                                type="button"
                                className={`proxy-rule-enabled-switch${rule.enabled ? " is-checked" : ""}`}
                                disabled={blockingBusy || bulkRuleSaving}
                                aria-pressed={rule.enabled}
                                aria-label={`${rule.name} 启用状态`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleRuleEnabled(rule, !rule.enabled);
                                }}
                              >
                                <span className="proxy-rule-enabled-thumb" />
                              </Box>
                            </Tooltip>
                            <Tooltip title="编辑规则">
                              <IconButton
                                aria-label="编辑规则"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openRuleDialog(rule);
                                }}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </span>
                        </span>
                      </Box>
                    );
                  })
                ) : (
                  <EmptyProxyState title="暂无规则" description="新建规则后可转发、Mock 或阻断请求。" />
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
              <Chip
                className="proxy-request-count-chip"
                size="small"
                label={`${visibleEvents.length} / ${filteredEvents.length} 条`}
                variant="outlined"
              />
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
                    className="proxy-request-filter-chip"
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

            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={0.8}
              alignItems={{ xs: "stretch", md: "center" }}
              sx={{ minWidth: 0 }}
            >
              <TextField
                select
                size="small"
                label="Method"
                value={diagnosisMethod}
                onChange={(event) => setDiagnosisMethod(event.target.value)}
                sx={{ minWidth: { md: 116 } }}
              >
                {HTTP_METHODS.filter(Boolean).map((method) => (
                  <MenuItem key={method} value={method}>
                    {method}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Path / URL"
                value={diagnosisUrl}
                onChange={(event) => {
                  setDiagnosisUrl(event.target.value);
                  setDiagnosisResult(null);
                }}
                inputProps={{ "aria-label": "诊断请求路径或 URL" }}
                sx={{ flex: 1, minWidth: 0 }}
              />
              <Button
                variant="outlined"
                color="inherit"
                disabled={!selectedEvent}
                onClick={useSelectedEventForDiagnosis}
              >
                使用选中请求
              </Button>
              <Button
                variant="contained"
                startIcon={<CheckIcon fontSize="small" />}
                disabled={!selectedProfile || diagnosisLoading}
                onClick={() => void diagnoseRequest()}
              >
                诊断
              </Button>
            </Stack>

            {diagnosisResult ? (
              <Alert severity={diagnosisSeverity(diagnosisResult)} sx={{ py: 0.8 }}>
                <Stack spacing={0.5} minWidth={0}>
                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" fontWeight={760}>
                      {diagnosisResult.summary}
                    </Typography>
                    <Chip size="small" label={diagnosisResult.statusLabel} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={diagnosisResult.profile.listening ? "端口监听中" : "端口未监听"}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${diagnosisMatchCount(diagnosisResult)} 条规则匹配`}
                    />
                  </Stack>
                  {diagnosisResult.matchedRule ? (
                    <Typography variant="caption" translate="no">
                      {diagnosisResult.matchedRule.name} · P{diagnosisResult.matchedRule.priority} ·{" "}
                      {diagnosisResult.matchedRule.pathPrefix}
                    </Typography>
                  ) : null}
                  {diagnosisResult.warnings.length > 0 ? (
                    <Stack spacing={0.25}>
                      {diagnosisResult.warnings.map((warning) => (
                        <Typography key={warning.key} variant="caption">
                          {warning.detail}
                        </Typography>
                      ))}
                    </Stack>
                  ) : null}
                </Stack>
              </Alert>
            ) : null}

            <Box className="proxy-traffic-grid proxy-requests-modal-grid">
            <Box
              className={`proxy-event-list module-list-scroll${filteredEvents.length === 0 ? " is-empty" : ""}`}
              onScroll={handleRequestListScroll}
              role="list"
              aria-label="代理请求记录"
            >
              {filteredEvents.length > 0 ? (
                <>
                  {visibleEvents.map((event) => (
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
                          <span className="proxy-event-title-line">
                            <b>{event.method}</b>
                            <Chip
                              size="small"
                              className="proxy-event-status-chip"
                              color={eventStatusTone(event)}
                              label={event.status ?? "-"}
                              variant={event.error ? "outlined" : "filled"}
                            />
                            <Chip
                              size="small"
                              className="proxy-event-action-chip"
                              label={actionLabel(event.action)}
                              variant="outlined"
                            />
                          </span>
                          <span className="proxy-event-time">{formatDateTime(event.startedAt)}</span>
                          <small className="proxy-event-path" translate="no">
                            {event.path || event.url}
                          </small>
                        </span>
                      </Box>
                    </Box>
                  ))}
                  <Box
                    className={
                      hasMoreRequestEvents
                        ? "workflow-history-footer"
                        : "workflow-history-footer workflow-history-footer--done"
                    }
                  >
                    {hasMoreRequestEvents ? (
                      <Button
                        type="button"
                        onClick={loadMoreRequestEvents}
                        className="workflow-history-footer-action"
                      >
                        下滑加载更多
                      </Button>
                    ) : (
                      <Typography variant="caption" className="workflow-history-footer-text">
                        没有更多了
                      </Typography>
                    )}
                  </Box>
                </>
              ) : (
                <AppEmptyState
                  compact
                  title={events.length > 0 ? "没有匹配请求" : "暂无请求记录"}
                  description={events.length > 0 ? "调整搜索或筛选条件。" : "代理收到请求后会显示在这里。"}
                />
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
                <AppEmptyState compact title="选择请求" description="点击左侧请求查看头信息和响应内容。" />
              )}
            </Box>
          </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {confirmDialog}

      <InterfaceProxyDialog
        open={interfaceProxyDialogOpen}
        draft={interfaceProxyDraft}
        busy={busy}
        error={formError}
        workspaceLabel={workspaceSaveLabel}
        projects={projects}
        onClose={closeInterfaceProxyDialog}
        onChange={updateInterfaceProxyDraft}
        onSave={() => void saveInterfaceProxyDraft()}
      />

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

function EmptyProxyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <AppEmptyState compact className="proxy-empty-state" title={title} description={description} />
  );
}

function InterfaceProxyDialog({
  open,
  draft,
  busy,
  error,
  workspaceLabel,
  projects,
  onClose,
  onChange,
  onSave,
}: {
  open: boolean;
  draft: InterfaceProxyDraft | null;
  busy: string;
  error: string;
  workspaceLabel: string;
  projects: Array<{ key: string; name: string }>;
  onClose: () => void;
  onChange: (patch: Partial<InterfaceProxyDraft>) => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      className="proxy-config-dialog proxy-interface-dialog"
    >
      <DialogTitle>
        <Stack className="proxy-profile-title" direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
          <Box minWidth={0}>
            <Typography variant="h6">接口代理</Typography>
            <Typography variant="body2" color="text.secondary">
              创建本地服务，并生成第一条接口规则。
            </Typography>
          </Box>
          <Chip className="proxy-profile-url-chip" label={`保存到 ${workspaceLabel}`} size="small" />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
        {draft ? (
          <Stack className="proxy-profile-form" spacing={1.1} minWidth={0}>
            <Box className="proxy-profile-section">
              <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box minWidth={0}>
                  <Typography variant="subtitle2">服务</Typography>
                </Box>
                <Chip label={`http://${draft.listenHost}:${draft.listenPort}`} size="small" />
              </Stack>
              <Stack spacing={1}>
                <Box className="proxy-two-fields">
                  <TextField
                    label="服务名称"
                    name="proxy-interface-service-name"
                    autoComplete="off"
                    value={draft.serviceName}
                    onChange={(event) => onChange({ serviceName: event.target.value })}
                  />
                  <TextField
                    label="规则名称"
                    name="proxy-interface-rule-name"
                    autoComplete="off"
                    value={draft.ruleName}
                    onChange={(event) => onChange({ ruleName: event.target.value })}
                  />
                </Box>
                <Box className="proxy-two-fields">
                  <TextField
                    label="监听地址"
                    name="proxy-interface-listen-host"
                    autoComplete="off"
                    value={draft.listenHost}
                    onChange={(event) => onChange({ listenHost: event.target.value })}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label="端口"
                    name="proxy-interface-listen-port"
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
                  <Typography variant="subtitle2">接口</Typography>
                </Box>
                <Chip label={actionKindLabel(draft.actionKind)} size="small" color="primary" />
              </Stack>
              <Stack spacing={1}>
                <Box className="proxy-three-fields">
                  <TextField
                    select
                    label="方法"
                    name="proxy-interface-method"
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
                    label="接口前缀"
                    name="proxy-interface-path-prefix"
                    autoComplete="off"
                    placeholder="/api/"
                    value={draft.pathPrefix}
                    onChange={(event) => onChange({ pathPrefix: event.target.value })}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    select
                    label="动作"
                    name="proxy-interface-action-kind"
                    value={draft.actionKind}
                    onChange={(event) =>
                      onChange({ actionKind: event.target.value as ProxyRuleAction["kind"] })
                    }
                  >
                    {ACTION_KINDS.map((item) => (
                      <MenuItem key={item.value} value={item.value}>
                        {item.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>

                {draft.actionKind === "forward" ? (
                  <Box className="proxy-two-fields">
                    <TextField
                      label="转发目标"
                      name="proxy-interface-target-base-url"
                      autoComplete="off"
                      placeholder="https://api.example.com"
                      value={draft.targetBaseUrl}
                      onChange={(event) => onChange({ targetBaseUrl: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                    <TextField
                      label="路径改写"
                      name="proxy-interface-rewrite-prefix"
                      autoComplete="off"
                      placeholder="/"
                      value={draft.rewritePrefix}
                      onChange={(event) => onChange({ rewritePrefix: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                  </Box>
                ) : null}

                {draft.actionKind === "mock" ? (
                  <Stack spacing={1}>
                    <Box className="proxy-two-fields">
                      <TextField
                        label="状态码"
                        name="proxy-interface-mock-status"
                        type="number"
                        inputMode="numeric"
                        autoComplete="off"
                        value={draft.mockStatus}
                        onChange={(event) =>
                          onChange({ mockStatus: Number(event.target.value) || 200 })
                        }
                      />
                      <TextField
                        label="Content-Type"
                        name="proxy-interface-mock-content-type"
                        autoComplete="off"
                        value={draft.mockContentType}
                        onChange={(event) => onChange({ mockContentType: event.target.value })}
                        inputProps={{ spellCheck: false, translate: "no" }}
                      />
                    </Box>
                    <TextField
                      label="响应正文"
                      name="proxy-interface-mock-body"
                      multiline
                      minRows={4}
                      autoComplete="off"
                      value={draft.mockBody}
                      onChange={(event) => onChange({ mockBody: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                  </Stack>
                ) : null}

                {draft.actionKind === "block" ? (
                  <Box className="proxy-two-fields">
                    <TextField
                      label="状态码"
                      name="proxy-interface-block-status"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      value={draft.blockStatus}
                      onChange={(event) =>
                        onChange({ blockStatus: Number(event.target.value) || 403 })
                      }
                    />
                    <TextField
                      label="阻断响应"
                      name="proxy-interface-block-body"
                      autoComplete="off"
                      value={draft.blockBody}
                      onChange={(event) => onChange({ blockBody: event.target.value })}
                    />
                  </Box>
                ) : null}
              </Stack>
            </Box>

            <Box className="proxy-profile-section proxy-profile-section--runtime">
              <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box minWidth={0}>
                  <Typography variant="subtitle2">运行配置</Typography>
                </Box>
                <Switch
                  checked={draft.bindRuntime}
                  onChange={(event) => onChange({ bindRuntime: event.target.checked })}
                  inputProps={{ "aria-label": "接入运行配置" }}
                />
              </Stack>
              <Stack spacing={1}>
                <Box className="proxy-two-fields">
                  <TextField
                    label="配置 Key"
                    name="proxy-interface-runtime-key"
                    autoComplete="off"
                    placeholder="自动生成"
                    value={draft.runtimeProfileKey}
                    disabled={!draft.bindRuntime}
                    onChange={(event) => onChange({ runtimeProfileKey: event.target.value })}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label="配置名称"
                    name="proxy-interface-runtime-label"
                    autoComplete="off"
                    value={draft.runtimeProfileLabel}
                    disabled={!draft.bindRuntime}
                    onChange={(event) => onChange({ runtimeProfileLabel: event.target.value })}
                  />
                </Box>
                <Box className="proxy-two-fields">
                  <TextField
                    select
                    label="绑定项目"
                    name="proxy-interface-runtime-project"
                    value={draft.project}
                    disabled={!draft.bindRuntime || projects.length === 0}
                    onChange={(event) =>
                      onChange({
                        project: event.target.value,
                        createDebugProfile: Boolean(event.target.value),
                      })
                    }
                  >
                    <MenuItem value="">不绑定项目</MenuItem>
                    {projects.map((project) => (
                      <MenuItem key={project.key} value={project.key}>
                        {project.name} · {project.key}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="项目启动档案"
                    name="proxy-interface-debug-profile-label"
                    autoComplete="off"
                    value={draft.debugProfileLabel}
                    disabled={!draft.bindRuntime || !draft.project || !draft.createDebugProfile}
                    onChange={(event) => onChange({ debugProfileLabel: event.target.value })}
                  />
                </Box>
                <Box className="proxy-runtime-options">
                  <FormControlLabel
                    control={
                      <Switch
                        checked={draft.createDebugProfile}
                        disabled={!draft.bindRuntime || !draft.project}
                        onChange={(event) => onChange({ createDebugProfile: event.target.checked })}
                      />
                    }
                    label="创建项目启动档案"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={draft.enableNetworkProxy}
                        disabled={!draft.bindRuntime}
                        onChange={(event) =>
                          onChange({
                            enableNetworkProxy: event.target.checked,
                            nodeHook: event.target.checked ? draft.nodeHook : false,
                          })
                        }
                      />
                    }
                    label="启动命令也走代理"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={draft.nodeHook}
                        disabled={!draft.bindRuntime || !draft.enableNetworkProxy}
                        onChange={(event) => onChange({ nodeHook: event.target.checked })}
                      />
                    }
                    label="Node Hook"
                  />
                </Box>
              </Stack>
            </Box>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={onSave} disabled={Boolean(busy)}>创建</Button>
      </DialogActions>
    </Dialog>
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
