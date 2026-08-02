import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
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
  ConfigSource,
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
  ActivityIcon,
  AppWindowIcon,
  CheckIcon,
  ClearIcon,
  CollapseIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  ExpandIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  WebsiteIcon,
} from "../components/AppIcons";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppListEndState } from "../components/AppListEndState";
import { AppToast } from "../components/AppToast";
import { ConfigSourceManagerDialog } from "../components/ConfigSourceManagerDialog";
import { ConfigSourceBar } from "../components/ConfigSourceBar";
import {
  WorkspacePageToolbar,
  WorkspacePageToolbarAction,
} from "../components/WorkspacePageToolbar";
import { useConfigSource, type ConfigSourceStatus } from "../hooks/useConfigSource";
import { useI18n, type Translate } from "../i18n";
import { configSourceSupports } from "../lib/configSources";

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
const REQUEST_EVENT_AUTO_REFRESH_MS = 2500;
const PROXY_SERVICE_PANEL_COLLAPSED_STORAGE_KEY = "rdevtool:proxy:service-panel-collapsed";

const REQUEST_FILTERS: Array<{ value: RequestFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "mock", label: "Mock" },
  { value: "forward", label: "转发" },
  { value: "block", label: "阻断" },
];

function readProxyServicePanelCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(PROXY_SERVICE_PANEL_COLLAPSED_STORAGE_KEY) === "1";
}

type ProxyRefreshOptions = {
  silent?: boolean;
  sourceId?: string;
};

export type ProxyPageProps = {
  dashboard: ProxyDashboard | null;
  activeProjectWorkspaceKey: string;
  selectedProfileId: string;
  loading: boolean;
  busy: string;
  error: string;
  onSelectedProfileChange: (profileId: string) => void;
  onRefresh: (options?: ProxyRefreshOptions) => Promise<void> | void;
  onSaveProfile: (profile: ProxyProfile, sourceId?: string) => Promise<ProxyDashboard> | void;
  onDeleteProfile: (profileId: string, sourceId?: string) => Promise<ProxyDashboard> | void;
  onSaveRule: (rule: ProxyRule, sourceId?: string) => Promise<ProxyDashboard> | void;
  onDeleteRule: (ruleId: string, sourceId?: string) => Promise<ProxyDashboard> | void;
  onStartProfile: (profileId: string, sourceId?: string) => Promise<ProxyDashboard> | void;
  onStopProfile: (profileId: string, sourceId?: string) => Promise<ProxyDashboard> | void;
  onClearEvents: (profileId?: string | null, sourceId?: string) => Promise<ProxyDashboard> | void;
  onExportProfilePack: (
    profileId: string,
    path: string,
    sourceId?: string,
  ) => Promise<ProxyDashboard> | void;
  onImportProfilePack: (path: string, sourceId?: string) => Promise<ProxyDashboard> | void;
  onDiagnoseRequest: (
    request: ProxyRequestDiagnosisInput,
    sourceId?: string,
  ) => Promise<ProxyRequestDiagnosis>;
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

function parseHeaderText(text: string, t: Translate) {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 1) {
      throw new Error(t("第 {line} 行缺少 header 名称或冒号", { line: index + 1 }));
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(key)) {
      throw new Error(t("第 {line} 行 header 名称无效", { line: index + 1 }));
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

function ruleMethodTone(method: string) {
  const normalized = method.trim().toUpperCase();
  if (!normalized) {
    return "any";
  }
  if (["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(normalized)) {
    return normalized.toLowerCase();
  }
  return "custom";
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

export function ProxyPage({
  dashboard,
  activeProjectWorkspaceKey,
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
  onDiagnoseRequest,
}: ProxyPageProps) {
  const { t } = useI18n();
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
    supports,
  } = useConfigSource({
    workspaceKey: activeProjectWorkspaceKey,
    requiredCapability: "proxy",
  });
  const visibleDashboard =
    dashboard &&
    selectedConfigSource?.files.proxy &&
    dashboard.configPath === selectedConfigSource.files.proxy
      ? dashboard
      : null;
  const statuses = useMemo(() => statusByProfile(visibleDashboard), [visibleDashboard]);
  const profiles = visibleDashboard?.config.profiles ?? [];
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;
  const selectedStatus = selectedProfile ? statuses.get(selectedProfile.id) : null;
  const rules = useMemo(
    () =>
      selectedProfile
        ? sortedRules(
            visibleDashboard?.config.rules.filter((rule) => rule.profileId === selectedProfile.id) ?? [],
          )
        : [],
    [visibleDashboard?.config.rules, selectedProfile],
  );
  const events = useMemo(
    () =>
      selectedProfile
        ? (visibleDashboard?.events ?? []).filter((event) => event.profileId === selectedProfile.id)
        : [],
    [visibleDashboard?.events, selectedProfile],
  );
  const [configProfileDraft, setConfigProfileDraft] = useState<ProxyProfile | null>(null);
  const [ruleDraft, setRuleDraft] = useState<ProxyRule | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [proxyConfigDialogOpen, setProxyConfigDialogOpen] = useState(false);
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(false);
  const [configSelectedProfileId, setConfigSelectedProfileId] = useState("");
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
  const [servicePanelCollapsed, setServicePanelCollapsed] = useState(
    readProxyServicePanelCollapsed,
  );
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const onRefreshRef = useRef(onRefresh);
  const requestRefreshInFlightRef = useRef(false);
  const sourceAllowsProxy = supports("proxy");
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
  const savedConfigSelectedProfile =
    profiles.find((profile) => profile.id === configSelectedProfileId) ?? null;
  const configDraftIsUnsaved = Boolean(
    configProfileDraft && !profiles.some((profile) => profile.id === configProfileDraft.id),
  );
  const configDraftHasChanges = Boolean(
    configProfileDraft &&
      (configDraftIsUnsaved ||
        JSON.stringify(configProfileDraft) !==
          JSON.stringify(profiles.find((profile) => profile.id === configProfileDraft.id))),
  );
  const configSelectedProfile =
    savedConfigSelectedProfile ??
    (configDraftIsUnsaved && configProfileDraft?.id === configSelectedProfileId
      ? configProfileDraft
      : null) ??
    selectedProfile ??
    profiles[0] ??
    null;
  const configDraftDirty = Boolean(
    configProfileDraft &&
      (configDraftIsUnsaved ||
        JSON.stringify(configProfileDraft) !== JSON.stringify(configSelectedProfile)),
  );
  const nextPort =
    Array.from({ length: 20 }, (_, index) => 8787 + index).find(
      (port) => !profiles.some((profile) => profile.listenPort === port),
    ) ?? 8787;
  const nextRulePriority = rules.length > 0 ? Math.max(...rules.map((rule) => rule.priority)) + 10 : 10;
  const existingRuleDraft =
    ruleDraft && rules.some((rule) => rule.id === ruleDraft.id) ? ruleDraft : null;
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const disabledRuleCount = rules.length - enabledRuleCount;
  const runningServiceCount = profiles.filter(
    (profile) => statuses.get(profile.id)?.running,
  ).length;
  const totalRuleCount = visibleDashboard?.config.rules.length ?? 0;
  const totalRequestCount = visibleDashboard?.events.length ?? 0;
  const ruleSaveBusy = busy === "正在保存代理规则";
  const blockingBusy = Boolean(busy) && !ruleSaveBusy;
  function setFormError(value: string) {
    setFormErrorValue(value);
    if (value.trim()) {
      setToastNonce((current) => current + 1);
    }
  }

  const loadConfigSources = useCallback(
    async (sourceId?: string) => {
      try {
        const result = await refreshSources(sourceId);
        if (!result) return;
        await onRefresh({ sourceId: result.sourceId });
      } catch (reason) {
        setFormError(String(reason));
      }
    },
    [onRefresh, refreshSources],
  );

  const refreshRequests = useCallback(async (options: ProxyRefreshOptions = {}) => {
    if (requestRefreshInFlightRef.current) {
      return;
    }
    requestRefreshInFlightRef.current = true;
    try {
      await onRefreshRef.current({ ...options, sourceId: options.sourceId ?? selectedSourceId });
    } finally {
      requestRefreshInFlightRef.current = false;
    }
  }, [selectedSourceId]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    window.localStorage.setItem(
      PROXY_SERVICE_PANEL_COLLAPSED_STORAGE_KEY,
      servicePanelCollapsed ? "1" : "0",
    );
  }, [servicePanelCollapsed]);

  useEffect(() => {
    void loadConfigSources();
  }, [loadConfigSources, preferredSourceId]);

  useEffect(() => {
    if (!requestsDialogOpen || !selectedProfile || !selectedStatus?.running) {
      return;
    }
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refreshRequests({ silent: true });
    };
    refreshIfVisible();
    const timer = window.setInterval(refreshIfVisible, REQUEST_EVENT_AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshRequests, requestsDialogOpen, selectedProfile?.id, selectedStatus?.running]);

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

  useEffect(() => {
    if (!proxyConfigDialogOpen) {
      return;
    }
    if (profiles.length === 0) {
      if (configSelectedProfileId) {
        setConfigSelectedProfileId("");
      }
      return;
    }
    const selectedIsUnsavedDraft =
      configDraftIsUnsaved && configProfileDraft?.id === configSelectedProfileId;
    if (!profiles.some((profile) => profile.id === configSelectedProfileId) && !selectedIsUnsavedDraft) {
      setConfigSelectedProfileId(selectedProfile?.id ?? profiles[0].id);
    }
  }, [
    configDraftIsUnsaved,
    configProfileDraft?.id,
    configSelectedProfileId,
    profiles,
    proxyConfigDialogOpen,
    selectedProfile?.id,
  ]);

  useEffect(() => {
    if (!proxyConfigDialogOpen) {
      setConfigProfileDraft(null);
      return;
    }
    setConfigProfileDraft((current) => {
      if (
        current?.id === configSelectedProfileId &&
        !profiles.some((profile) => profile.id === current.id)
      ) {
        return current;
      }
      if (!configSelectedProfile) {
        return null;
      }
      if (current?.id === configSelectedProfile.id) {
        return current;
      }
      return { ...configSelectedProfile };
    });
  }, [configSelectedProfile?.id, configSelectedProfileId, profiles, proxyConfigDialogOpen]);

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

  function openProxyConfigDialog() {
    setFormError("");
    setConfigSelectedProfileId(selectedProfile?.id ?? profiles[0]?.id ?? "");
    setProxyConfigDialogOpen(true);
  }

  async function handleSourceChange(nextSourceId: string) {
    if (nextSourceId === selectedSourceId || busy) {
      return;
    }
    const nextSource = configSources.find((source) => source.id === nextSourceId) ?? null;
    if (!configSourceSupports(nextSource, "proxy")) {
      setFormError(t("这个配置源不支持代理配置。"));
      return;
    }
    if (configDraftDirty || ruleDialogOpen) {
      setFormError(t("请先保存或取消当前代理改动，再切换配置源。"));
      return;
    }
    setFormError("");
    try {
      const source = await selectSource(nextSourceId);
      if (!source) return;
      setConfigProfileDraft(null);
      setConfigSelectedProfileId("");
      setRuleDraft(null);
      setDiagnosisResult(null);
      await onRefresh({ sourceId: source.id });
    } catch (reason) {
      setFormError(String(reason));
    }
  }

  function startNewConfigProfileDraft() {
    const draft = createProfile(nextPort);
    setFormError("");
    setConfigProfileDraft(draft);
    setConfigSelectedProfileId(draft.id);
  }

  function discardConfigProfileDraft() {
    setFormError("");
    setConfigProfileDraft(null);
    setConfigSelectedProfileId(selectedProfile?.id ?? profiles[0]?.id ?? "");
  }

  function closeProxyConfigDialog() {
    setProxyConfigDialogOpen(false);
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

  function updateConfigProfileDraft(patch: Partial<ProxyProfile>) {
    setConfigProfileDraft((current) => (current ? { ...current, ...patch } : current));
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
      setFormError(t("请选择代理服务"));
      return;
    }
    const url = diagnosisUrl.trim();
    if (!url) {
      setFormError(t("请输入请求路径或 URL"));
      return;
    }
    setFormError("");
    setDiagnosisLoading(true);
    try {
      const result = await onDiagnoseRequest(
        {
          profile: selectedProfile.id,
          method: diagnosisMethod.trim() || "GET",
          url,
          headers: {},
        },
        selectedSourceId,
      );
      setDiagnosisResult(result);
    } catch (reason) {
      setFormError(String(reason));
    } finally {
      setDiagnosisLoading(false);
    }
  }

  async function saveConfigProfileDraft() {
    if (!configProfileDraft) {
      return;
    }
    setFormError("");
    if (!configProfileDraft.name.trim()) {
      setFormError(t("代理名称不能为空"));
      return;
    }
    if (!configProfileDraft.listenHost.trim() || !configProfileDraft.listenPort) {
      setFormError(t("监听地址和端口不能为空"));
      return;
    }
    await onSaveProfile(configProfileDraft, selectedSourceId);
    onSelectedProfileChange(configProfileDraft.id);
    setConfigSelectedProfileId(configProfileDraft.id);
  }

  async function deleteProfile(profile: ProxyProfile) {
    const confirmed = await confirm({
      title: t("删除代理配置"),
      description: t("删除“{name}”后，相关规则和记录也会被移除。", {
        name: profile.name,
      }),
      confirmLabel: t("删除"),
      tone: "danger",
      preferenceKey: "destructive.delete",
    });
    if (!confirmed) {
      return;
    }
    await onDeleteProfile(profile.id, selectedSourceId);
  }

  async function saveRuleDraft() {
    if (!ruleDraft) {
      return;
    }
    setFormError("");
    if (!ruleDraft.name.trim()) {
      setFormError(t("规则名称不能为空"));
      return;
    }
    let action = ruleDraft.action;
    try {
      if (action.kind === "forward") {
        if ((action.outboundMode ?? "inherit") === "proxy" && !action.outboundProxy.trim()) {
          setFormError(t("选择指定代理时，上游代理地址不能为空"));
          return;
        }
        action = {
          ...action,
          requestHeaders: parseHeaderText(requestHeadersText, t),
          responseHeaders: parseHeaderText(responseHeadersText, t),
        };
      } else if (action.kind === "mock") {
        action = {
          ...action,
          headers: parseHeaderText(mockHeadersText, t),
        };
      }
    } catch (reason) {
      setFormError(String(reason instanceof Error ? reason.message : reason));
      return;
    }
    await onSaveRule({ ...ruleDraft, action }, selectedSourceId);
    closeRuleDialog();
  }

  async function toggleRuleEnabled(rule: ProxyRule, enabled: boolean) {
    if (rule.enabled === enabled || savingRuleIds.includes(rule.id)) {
      return;
    }
    setSavingRuleIds((current) => (current.includes(rule.id) ? current : [...current, rule.id]));
    try {
      await onSaveRule({ ...rule, enabled }, selectedSourceId);
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
        await onSaveRule({ ...rule, enabled }, selectedSourceId);
      }
    } finally {
      const changedIds = new Set(changedRules.map((rule) => rule.id));
      setSavingRuleIds((current) => current.filter((id) => !changedIds.has(id)));
      setBulkRuleSaving(false);
    }
  }

  async function deleteRule(rule: ProxyRule) {
    const confirmed = await confirm({
      title: t("删除规则"),
      description: t("删除“{name}”？", { name: rule.name }),
      confirmLabel: t("删除"),
      tone: "danger",
      preferenceKey: "destructive.delete",
    });
    if (!confirmed) {
      return;
    }
    await onDeleteRule(rule.id, selectedSourceId);
    closeRuleDialog();
  }

  async function importProfilePack() {
    try {
      const selected = await open({
        title: t("导入代理包"),
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
        title: t("导入代理包"),
        description: t("导入会创建一个新的代理服务，并把包内规则归属到新服务，不会覆盖现有服务。"),
        confirmLabel: t("导入"),
        preferenceKey: "configuration.import",
      });
      if (!confirmed) {
        return;
      }
      await onImportProfilePack(selected, selectedSourceId);
    } catch (reason) {
      setFormError(String(reason instanceof Error ? reason.message : reason));
    }
  }

  async function exportProfilePack(profile: ProxyProfile | null) {
    if (!profile) {
      return;
    }
    const confirmed = await confirm({
      title: t("导出代理包"),
      description: t(
        "导出的代理包会包含当前服务配置、规则、Header、Mock Body 和上游地址。请确认其中没有敏感信息。",
      ),
      confirmLabel: t("继续导出"),
    });
    if (!confirmed) {
      return;
    }
    try {
      const selected = await save({
        title: t("导出代理包"),
        defaultPath: `${safeFileName(profile.name)}.rdevproxy.json`,
        filters: [
          { name: "rDevTool Proxy Pack", extensions: ["json"] },
        ],
      });
      if (typeof selected !== "string") {
        return;
      }
      await onExportProfilePack(profile.id, selected, selectedSourceId);
    } catch (reason) {
      setFormError(String(reason instanceof Error ? reason.message : reason));
    }
  }

  if (!visibleDashboard && loading) {
    return (
      <Box className="workspace workspace--narrow proxy-workspace">
        <Alert severity="info">{t("正在加载代理配置…")}</Alert>
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

      <WorkspacePageToolbar
        ariaLabel={t("本地代理概览与配置")}
        metrics={[
          {
            key: "services",
            label: t("服务"),
            value: profiles.length,
            icon: <AppWindowIcon fontSize="small" />,
            tone: "blue",
          },
          {
            key: "running",
            label: t("运行中"),
            value: runningServiceCount,
            tone: "green",
          },
          {
            key: "rules",
            label: t("规则"),
            value: totalRuleCount,
            icon: <PackageIcon fontSize="small" />,
            tone: "violet",
          },
          {
            key: "requests",
            label: t("请求"),
            value: totalRequestCount,
            icon: <ActivityIcon fontSize="small" />,
            tone: "cyan",
          },
        ]}
        actions={
          <>
            <WorkspacePageToolbarAction
              startIcon={<WebsiteIcon fontSize="small" />}
              disabled={!selectedProfile}
              onClick={() => setRequestsDialogOpen(true)}
            >
              {t("请求记录")}
            </WorkspacePageToolbarAction>
            <WorkspacePageToolbarAction
              startIcon={<SettingsIcon fontSize="small" />}
              onClick={openProxyConfigDialog}
            >
              {t("代理配置")}
            </WorkspacePageToolbarAction>
          </>
        }
      />

      <Box className="proxy-main-grid proxy-main-grid--config">
        <section className="workflow-panel proxy-control-panel" aria-label={t("代理服务与规则")}>
          <Box className={`proxy-control-split${servicePanelCollapsed ? " is-service-collapsed" : ""}`}>
            <Box
              component="section"
              className={`proxy-section proxy-service-panel${servicePanelCollapsed ? " is-collapsed" : ""}`}
              aria-labelledby="proxy-service-title"
            >
              <PanelHeader
                id="proxy-service-title"
                title={t("服务")}
                aside={
                  <Tooltip
                    title={servicePanelCollapsed ? t("展开服务列表") : t("向左收起服务列表")}
                  >
                    <IconButton
                      className="proxy-service-collapse-toggle"
                      aria-label={
                        servicePanelCollapsed ? t("展开服务列表") : t("向左收起服务列表")
                      }
                      aria-controls={servicePanelCollapsed ? undefined : "proxy-service-list"}
                      aria-expanded={!servicePanelCollapsed}
                      onClick={() => setServicePanelCollapsed((current) => !current)}
                    >
                      {servicePanelCollapsed ? (
                        <ExpandIcon fontSize="small" />
                      ) : (
                        <CollapseIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                }
              />

              {!servicePanelCollapsed ? (
                <Box
                  id="proxy-service-list"
                  className={`proxy-card-list module-list-scroll${profiles.length === 0 ? " is-empty" : ""}`}
                  role="list"
                  aria-label={t("代理服务列表")}
                >
                {profiles.length > 0 ? (
                  <>
                  {profiles.map((profile) => {
                    const status = statuses.get(profile.id);
                    const selected = selectedProfile?.id === profile.id;
                    const listenUrl =
                      status?.listenUrl ?? `http://${profile.listenHost}:${profile.listenPort}`;
                    const ruleCount = rulesForProfile(visibleDashboard, profile.id).length;
                    const eventCount = eventsForProfile(visibleDashboard, profile.id).length;
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
                              label={status?.running ? t("运行中") : t("已停止")}
                              color={status?.running ? "success" : "default"}
                              variant={status?.running ? "filled" : "outlined"}
                            />
                            <Chip
                              className="proxy-service-metric-chip proxy-service-metric-chip--rules"
                              size="small"
                              label={t("{count} 规则", { count: ruleCount })}
                              variant="outlined"
                            />
                            <Chip
                              className="proxy-service-metric-chip proxy-service-metric-chip--requests"
                              size="small"
                              label={t("{count} 请求", { count: eventCount })}
                              variant="outlined"
                            />
                          </span>
                          <span className="proxy-list-actions proxy-service-actions">
                            <Tooltip title={status?.running ? t("停止代理") : t("启动代理")}>
                              <IconButton
                                aria-label={status?.running ? t("停止代理") : t("启动代理")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void (status?.running
                                    ? onStopProfile(profile.id, selectedSourceId)
                                    : onStartProfile(profile.id, selectedSourceId));
                                }}
                              >
                                {status?.running ? <StopIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          </span>
                        </span>
                      </Box>
                    );
                  })}
                  <AppListEndState />
                  </>
                ) : (
                  <EmptyProxyState
                    title={t("暂无服务")}
                    description={t("打开代理配置新增服务或导入代理包。")}
                  />
                )}
                </Box>
              ) : null}
            </Box>

            <Box component="section" className="proxy-section proxy-rules-panel" aria-labelledby="proxy-rule-title">
              <PanelHeader
                id="proxy-rule-title"
                title={selectedProfile ? selectedProfile.name : t("规则")}
                description={
                  selectedProfile
                    ? selectedStatus?.listenUrl ?? `http://${selectedProfile.listenHost}:${selectedProfile.listenPort}`
                    : t("请先在代理配置中新增服务")
                }
                aside={
                  <Stack className="proxy-rule-bulk-actions" direction="row" spacing={0.55} alignItems="center">
                    <Button
                      className="proxy-rule-bulk-button proxy-tool-button proxy-tool-button--enable"
                      variant="outlined"
                      color="inherit"
                      startIcon={<PlayIcon fontSize="small" />}
                      disabled={!selectedProfile || disabledRuleCount === 0 || blockingBusy || bulkRuleSaving}
                      onClick={() => void setAllRulesEnabled(true)}
                    >
                      {t("启用")}
                    </Button>
                    <Button
                      className="proxy-rule-bulk-button proxy-tool-button proxy-tool-button--disable"
                      variant="outlined"
                      color="inherit"
                      startIcon={<StopIcon fontSize="small" />}
                      disabled={!selectedProfile || enabledRuleCount === 0 || blockingBusy || bulkRuleSaving}
                      onClick={() => void setAllRulesEnabled(false)}
                    >
                      {t("停用")}
                    </Button>
                    <Tooltip title={t("新规则")}>
                      <span>
                        <IconButton
                          className="proxy-tool-icon-button proxy-tool-icon-button--add"
                          aria-label={t("新规则")}
                          disabled={!selectedProfile}
                          onClick={() => {
                            if (selectedProfile) {
                              openRuleDialog(createRule(selectedProfile.id, nextRulePriority));
                            }
                          }}
                        >
                          <PlusIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t("刷新代理状态")}>
                      <IconButton
                        onClick={() => void onRefresh({ sourceId: selectedSourceId })}
                        aria-label={t("刷新代理状态")}
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              />

              <Box
                className={`proxy-card-list module-list-scroll${rules.length === 0 ? " is-empty" : ""}`}
                role="list"
                aria-label={t("代理规则列表")}
              >
                {!selectedProfile ? (
                  <EmptyProxyState
                    title={t("请选择服务")}
                    description={t("请先在代理配置中新增服务。")}
                  />
                ) : rules.length > 0 ? (
                  <>
                  {rules.map((rule) => {
                    const matchMethod = rule.method || t("任意");
                    const matchTarget = rule.pathPrefix || rule.urlContains || t("自定义匹配");
                    const methodTone = ruleMethodTone(rule.method);
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
                                  {t(actionKindLabel(rule.action.kind))}
                                </span>
                                {rule.action.kind === "forward" ? (
                                  <span className="proxy-rule-badge">
                                    {t("出站 {mode}", {
                                      mode: t(outboundModeLabel(forwardOutboundMode(rule.action))),
                                    })}
                                  </span>
                                ) : null}
                                <span className="proxy-rule-badge">P{rule.priority}</span>
                                {rule.action.delayMs > 0 ? (
                                  <span className="proxy-rule-badge">{formatNumber(rule.action.delayMs)} ms</span>
                                ) : null}
                              </span>
                            </span>
                            <span className="proxy-rule-match-line" translate="no">
                              <span className={`proxy-rule-method proxy-rule-method--${methodTone}`}>
                                {matchMethod}
                              </span>
                              <span className="proxy-rule-match-separator">·</span>
                              <small>{matchTarget}</small>
                            </span>
                          </span>
                        </Box>
                        <span className="proxy-rule-side">
                          <span className="proxy-list-actions proxy-rule-actions">
                            <Tooltip title={rule.enabled ? t("停用规则") : t("启用规则")}>
                              <Box
                                component="button"
                                type="button"
                                className={`proxy-rule-enabled-switch${rule.enabled ? " is-checked" : ""}`}
                                disabled={blockingBusy || bulkRuleSaving}
                                aria-pressed={rule.enabled}
                                aria-label={t("{name} 启用状态", { name: rule.name })}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleRuleEnabled(rule, !rule.enabled);
                                }}
                              >
                                <span className="proxy-rule-enabled-thumb" />
                              </Box>
                            </Tooltip>
                            <Tooltip title={t("编辑规则")}>
                              <IconButton
                                aria-label={t("编辑规则")}
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
                  })}
                  <AppListEndState />
                  </>
                ) : (
                  <EmptyProxyState
                    title={t("暂无规则")}
                    description={t("新建规则后可转发、Mock 或阻断请求。")}
                  />
                )}
              </Box>
            </Box>
          </Box>
        </section>
      </Box>

      <ProxyConfigDialog
        open={proxyConfigDialogOpen}
        profiles={profiles}
        dashboard={visibleDashboard}
        statuses={statuses}
        configSources={configSources}
        selectedSourceId={selectedSourceId}
        selectedConfigSource={selectedConfigSource}
        sourceAllowsProxy={sourceAllowsProxy}
        sourceBusy={sourceBusy}
        sourceError={sourceError}
        sourceStatus={sourceStatus}
        selectedProfile={configSelectedProfile}
        selectedProfileId={configSelectedProfile?.id ?? ""}
        profileDraft={configProfileDraft}
        busy={busy}
        error={formError}
        copiedKey={copiedKey}
        onClose={closeProxyConfigDialog}
        onSourceChange={(sourceId) => void handleSourceChange(sourceId)}
        onManageSources={() => setConfigSourceManagerOpen(true)}
        manageSourcesDisabled={configDraftHasChanges}
        onSelectProfile={setConfigSelectedProfileId}
        onCreateProfile={startNewConfigProfileDraft}
        onDiscardProfile={discardConfigProfileDraft}
        onImport={() => void importProfilePack()}
        onExport={() => void exportProfilePack(configSelectedProfile)}
        onChangeProfile={updateConfigProfileDraft}
        onCopy={copyText}
        onSaveProfile={() => void saveConfigProfileDraft()}
        onDelete={(profile) => void deleteProfile(profile)}
      />

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
              <span>{t("请求")}</span>
              <Chip
                className="proxy-request-count-chip"
                size="small"
                label={t("{visible} / {total} 条", {
                  visible: visibleEvents.length,
                  total: filteredEvents.length,
                })}
                variant="outlined"
              />
            </Stack>
            <Stack direction="row" spacing={0.6}>
              <Tooltip
                title={
                  selectedStatus?.running
                    ? t("刷新请求记录（打开时自动刷新）")
                    : t("刷新请求记录")
                }
              >
                <IconButton onClick={() => void refreshRequests()} aria-label={t("刷新请求记录")}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("关闭")}>
                <IconButton
                  onClick={() => setRequestsDialogOpen(false)}
                  aria-label={t("关闭请求面板")}
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
                placeholder={t("搜索接口 / 路径 / 状态 / 规则")}
                inputProps={{ "aria-label": t("搜索请求记录") }}
              />
              <Box className="proxy-request-filter-group" aria-label={t("筛选请求记录")}>
                {REQUEST_FILTERS.map((filter) => (
                  <Chip
                    key={filter.value}
                    className="proxy-request-filter-chip"
                    label={t(filter.label)}
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
                {t("重置")}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<TrashIcon fontSize="small" />}
                disabled={!selectedProfile || events.length === 0 || Boolean(busy)}
                onClick={() => void onClearEvents(selectedProfile?.id, selectedSourceId)}
              >
                {t("清空")}
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
                inputProps={{ "aria-label": t("诊断请求路径或 URL") }}
                sx={{ flex: 1, minWidth: 0 }}
              />
              <Button
                variant="outlined"
                color="inherit"
                disabled={!selectedEvent}
                onClick={useSelectedEventForDiagnosis}
              >
                {t("使用选中请求")}
              </Button>
              <Button
                variant="contained"
                startIcon={<CheckIcon fontSize="small" />}
                disabled={!selectedProfile || diagnosisLoading}
                onClick={() => void diagnoseRequest()}
              >
                {t("诊断")}
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
                      label={diagnosisResult.profile.listening ? t("端口监听中") : t("端口未监听")}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t("{count} 条规则匹配", {
                        count: diagnosisMatchCount(diagnosisResult),
                      })}
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
              aria-label={t("代理请求记录")}
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
                              label={t(actionLabel(event.action))}
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
                        {t("下滑加载更多")}
                      </Button>
                    ) : (
                      <AppListEndState />
                    )}
                  </Box>
                </>
              ) : (
                <AppEmptyState
                  compact
                  title={events.length > 0 ? t("没有匹配请求") : t("暂无请求记录")}
                  description={
                    events.length > 0
                      ? t("调整搜索或筛选条件。")
                      : t("代理收到请求后会显示在这里。")
                  }
                />
              )}
            </Box>

            <Box
              className={`proxy-event-detail proxy-event-detail--modal module-list-scroll${
                selectedEvent ? "" : " is-empty"
              }`}
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
                <AppEmptyState
                  compact
                  title={t("选择请求")}
                  description={t("点击左侧请求查看头信息和响应内容。")}
                />
              )}
            </Box>
          </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {confirmDialog}

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
      <ConfigSourceManagerDialog
        open={configSourceManagerOpen}
        initialSourceId={selectedSourceId}
        onClose={() => setConfigSourceManagerOpen(false)}
        onChanged={async (sources) => {
          try {
            const result = adoptSources(sources, selectedSourceId);
            if (result.sourceId !== selectedSourceId) {
              const source = await selectSource(result.sourceId);
              if (!source) return;
              await onRefresh({ sourceId: source.id });
            }
          } catch (reason) {
            setFormError(String(reason));
          }
        }}
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

function PanelHeader({
  id,
  title,
  description,
  aside,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Stack
      className="proxy-panel-header"
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={1}
      minWidth={0}
    >
      <Box className="proxy-panel-title-copy" minWidth={0}>
        <Typography id={id} variant="h6" sx={{ fontWeight: 760 }} noWrap>
          {title}
        </Typography>
        {description ? (
          <Typography className="proxy-panel-description" variant="caption" color="text.secondary" noWrap>
            {description}
          </Typography>
        ) : null}
      </Box>
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

function ProxyConfigDialog({
  open,
  profiles,
  dashboard,
  statuses,
  configSources,
  selectedSourceId,
  selectedConfigSource,
  sourceAllowsProxy,
  sourceBusy,
  sourceError,
  sourceStatus,
  selectedProfile,
  selectedProfileId,
  profileDraft,
  busy,
  error,
  copiedKey,
  onClose,
  onSourceChange,
  onManageSources,
  manageSourcesDisabled,
  onSelectProfile,
  onCreateProfile,
  onDiscardProfile,
  onImport,
  onExport,
  onChangeProfile,
  onCopy,
  onSaveProfile,
  onDelete,
}: {
  open: boolean;
  profiles: ProxyProfile[];
  dashboard: ProxyDashboard | null;
  statuses: ReturnType<typeof statusByProfile>;
  configSources: ConfigSource[];
  selectedSourceId: string;
  selectedConfigSource: ConfigSource | null;
  sourceAllowsProxy: boolean;
  sourceBusy: boolean;
  sourceError: string;
  sourceStatus: ConfigSourceStatus;
  selectedProfile: ProxyProfile | null;
  selectedProfileId: string;
  profileDraft: ProxyProfile | null;
  busy: string;
  error: string;
  copiedKey: string;
  onClose: () => void;
  onSourceChange: (sourceId: string) => void;
  onManageSources: () => void;
  manageSourcesDisabled: boolean;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: () => void;
  onDiscardProfile: () => void;
  onImport: () => void;
  onExport: () => void;
  onChangeProfile: (patch: Partial<ProxyProfile>) => void;
  onCopy: (key: string, value: string) => Promise<void>;
  onSaveProfile: () => void;
  onDelete: (profile: ProxyProfile) => void;
}) {
  const { t } = useI18n();
  const selectedStatus = selectedProfile ? statuses.get(selectedProfile.id) : null;
  const selectedRules = selectedProfile ? rulesForProfile(dashboard, selectedProfile.id) : [];
  const selectedEvents = selectedProfile ? eventsForProfile(dashboard, selectedProfile.id) : [];
  const selectedListenUrl = profileDraft ? profileUrl(profileDraft) : "";
  const busyDisabled = Boolean(busy) || sourceBusy;
  const draftIsUnsaved = Boolean(
    profileDraft && !profiles.some((profile) => profile.id === profileDraft.id),
  );
  const displayProfiles =
    draftIsUnsaved && profileDraft ? [profileDraft, ...profiles] : profiles;
  const serviceCountLabel = draftIsUnsaved
    ? t("{count} 个 + 草稿", { count: profiles.length })
    : t("{count} 个", { count: profiles.length });
  const canExportSelected = Boolean(selectedProfile && !draftIsUnsaved);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      className="proxy-config-dialog proxy-config-manager-dialog"
    >
      <DialogTitle>
        <Stack
          className="proxy-config-manager-title"
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1.2}
        >
          <Stack direction="row" alignItems="center" spacing={1} minWidth={0}>
            <span className="proxy-config-manager-icon" aria-hidden="true">
              <SettingsIcon fontSize="small" />
            </span>
            <Box minWidth={0}>
              <Typography variant="h6" noWrap>
                {t("代理配置")}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {t("管理本地代理服务、默认转发和代理包。")}
              </Typography>
            </Box>
          </Stack>
          <Stack className="proxy-config-manager-actions" direction="row" spacing={0.7} alignItems="center">
            <Button
              variant="contained"
              startIcon={<PlusIcon fontSize="small" />}
              disabled={busyDisabled}
              onClick={onCreateProfile}
            >
              {t("新建服务")}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<UploadIcon fontSize="small" />}
              disabled={busyDisabled}
              onClick={onImport}
            >
              {t("导入")}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<DownloadIcon fontSize="small" />}
              disabled={!canExportSelected || busyDisabled}
              onClick={onExport}
            >
              {t("导出选中")}
            </Button>
            <Tooltip title={t("关闭")}>
              <IconButton
                className="proxy-config-manager-close"
                aria-label={t("关闭代理配置")}
                onClick={onClose}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent className="proxy-config-manager-content-root">
        {configSources.length > 0 ? (
          <Box className="proxy-config-source-bar">
            <ConfigSourceBar
              sources={configSources}
              selectedSourceId={selectedSourceId}
              selectedSource={selectedConfigSource}
              path={dashboard?.configPath || selectedConfigSource?.files.proxy}
              requiredCapability="proxy"
              profileFallback="proxy"
              warningLabel={!sourceAllowsProxy ? t("不支持代理") : null}
              disabled={busyDisabled}
              status={sourceStatus}
              error={sourceError}
              manageDisabled={manageSourcesDisabled}
              onSourceChange={onSourceChange}
              onManage={onManageSources}
              className="proxy-config-source-strip"
            />
          </Box>
        ) : null}
        <Box className="proxy-config-manager-content">
          <Box className="proxy-config-manager-sidebar">
            <Stack
              className="proxy-config-manager-section-head"
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
              <Typography variant="subtitle2">{t("服务配置")}</Typography>
              <Chip size="small" label={serviceCountLabel} variant="outlined" />
            </Stack>
            <Box
              className={`proxy-config-service-list module-list-scroll${
                displayProfiles.length === 0 ? " is-empty" : ""
              }`}
              role="list"
              aria-label={t("代理服务配置列表")}
            >
              {displayProfiles.length > 0 ? (
                displayProfiles.map((profile) => {
                  const isDraft = draftIsUnsaved && profileDraft?.id === profile.id;
                  const status = isDraft ? null : statuses.get(profile.id);
                  const selected = profile.id === selectedProfileId;
                  const listenUrl = status?.listenUrl ?? profileUrl(profile);
                  const ruleCount = isDraft ? 0 : rulesForProfile(dashboard, profile.id).length;
                  const eventCount = isDraft ? 0 : eventsForProfile(dashboard, profile.id).length;
                  const running = Boolean(status?.running);
                  return (
                    <Box
                      key={profile.id}
                      component="button"
                      type="button"
                      className={`proxy-config-service-item${selected ? " is-active" : ""}`}
                      onClick={() => onSelectProfile(profile.id)}
                    >
                      <span className="proxy-config-service-main">
                        <span className="proxy-config-service-title-row">
                          <b>{profile.name}</b>
                          <span className={`proxy-config-service-state${running ? " is-running" : ""}${isDraft ? " is-draft" : ""}`}>
                            {isDraft ? t("未保存") : running ? t("运行中") : t("已停止")}
                          </span>
                        </span>
                        <small translate="no">{listenUrl}</small>
                      </span>
                      <span className="proxy-config-service-meta">
                        <span>{t("{count} 规则", { count: ruleCount })}</span>
                        <span>{t("{count} 请求", { count: eventCount })}</span>
                      </span>
                    </Box>
                  );
                })
              ) : (
                <EmptyProxyState
                  title={t("暂无服务")}
                  description={t("新建服务或导入代理包后会显示在这里。")}
                />
              )}
            </Box>
          </Box>

          <Box className="proxy-config-manager-detail">
            {profileDraft ? (
              <Stack className="proxy-config-editor-shell" spacing={0}>
                <Stack
                  className="proxy-config-editor-head"
                  direction={{ xs: "column", sm: "row" }}
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Box minWidth={0}>
                    <Typography variant="h6" noWrap>
                      {profileDraft.name || t("未命名代理")}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap translate="no">
                      {selectedListenUrl}
                    </Typography>
                  </Box>
                  <Stack
                    className="proxy-config-editor-stats"
                    direction="row"
                    spacing={0.6}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Chip
                      size="small"
                      label={
                        draftIsUnsaved
                          ? t("未保存")
                          : selectedStatus?.running
                            ? t("运行中")
                            : t("已停止")
                      }
                      color={selectedStatus?.running ? "success" : "default"}
                      variant={selectedStatus?.running ? "filled" : "outlined"}
                    />
                    <Chip
                      size="small"
                      label={t("{count} 规则", {
                        count: draftIsUnsaved ? 0 : selectedRules.length,
                      })}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={t("{count} 请求", {
                        count: draftIsUnsaved ? 0 : selectedEvents.length,
                      })}
                      variant="outlined"
                    />
                  </Stack>
                </Stack>

                <Box className="proxy-config-editor-body module-list-scroll">
                  <ProfileFormContent
                    draft={profileDraft}
                    error={error}
                    copiedKey={copiedKey}
                    proxyUrl={selectedListenUrl}
                    onChange={onChangeProfile}
                    onCopy={onCopy}
                  />
                </Box>

                <Stack
                  className="proxy-config-editor-actions"
                  direction="row"
                  spacing={0.8}
                  alignItems="center"
                  justifyContent="flex-end"
                >
                  {draftIsUnsaved ? (
                    <Button
                      variant="outlined"
                      color="inherit"
                      startIcon={<ClearIcon fontSize="small" />}
                      disabled={busyDisabled}
                      onClick={onDiscardProfile}
                    >
                      {t("取消新建")}
                    </Button>
                  ) : (
                    <Tooltip
                      title={profiles.length <= 1 ? t("至少保留一个服务") : t("删除服务")}
                    >
                      <span>
                        <Button
                          variant="outlined"
                          color="error"
                          startIcon={<TrashIcon fontSize="small" />}
                          disabled={!selectedProfile || profiles.length <= 1 || busyDisabled}
                          onClick={() => selectedProfile && onDelete(selectedProfile)}
                        >
                          {t("删除")}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  <Button
                    variant="contained"
                    startIcon={<CheckIcon fontSize="small" />}
                    disabled={busyDisabled}
                    onClick={onSaveProfile}
                  >
                    {t("保存服务")}
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <EmptyProxyState
                title={t("暂无服务")}
                description={t("请先新建服务或导入代理包。")}
              />
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function profileUrl(profile: ProxyProfile) {
  return `http://${profile.listenHost}:${profile.listenPort}`;
}

function ProfileFormContent({
  draft,
  error,
  copiedKey,
  proxyUrl,
  onChange,
  onCopy,
}: {
  draft: ProxyProfile | null;
  error: string;
  copiedKey: string;
  proxyUrl: string;
  onChange: (patch: Partial<ProxyProfile>) => void;
  onCopy: (key: string, value: string) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <>
      {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
      {draft ? (
        <Stack className="proxy-profile-form" spacing={1.1} minWidth={0}>
          <Box className="proxy-profile-section">
            <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Box minWidth={0}>
                <Typography variant="subtitle2">{t("监听入口")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("其他应用连接到这个本地地址后，请求会进入 rDevTool 代理服务。")}
                </Typography>
              </Box>
              <Chip label="HTTP / HTTPS" size="small" />
            </Stack>
            <Stack spacing={1}>
              <TextField
                label={t("名称")}
                name="proxy-profile-name"
                autoComplete="off"
                value={draft.name}
                onChange={(event) => onChange({ name: event.target.value })}
              />
              <Box className="proxy-two-fields">
                <TextField
                  label={t("监听地址")}
                  name="proxy-listen-host"
                  autoComplete="off"
                  value={draft.listenHost}
                  onChange={(event) => onChange({ listenHost: event.target.value })}
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
                <TextField
                  label={t("端口")}
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
                <Typography variant="subtitle2">{t("默认转发")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("没有被规则改写时使用；规则里的出站设置可以覆盖这里。")}
                </Typography>
              </Box>
              <Chip
                label={draft.upstreamProxy ? t("代理中转") : t("默认直连")}
                size="small"
                color={draft.upstreamProxy ? "primary" : "default"}
              />
            </Stack>
            <Box className="proxy-two-fields">
              <TextField
                label={t("上游地址")}
                name="proxy-upstream-base-url"
                autoComplete="off"
                placeholder="https://api.example.com"
                value={draft.upstreamBaseUrl}
                onChange={(event) => onChange({ upstreamBaseUrl: event.target.value })}
                helperText={t("可空。用于相对路径请求的默认目标；为空时按请求原目标转发。")}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
              <TextField
                label={t("上游代理")}
                name="proxy-upstream-proxy"
                autoComplete="off"
                placeholder="socks5://127.0.0.1:7890"
                value={draft.upstreamProxy}
                onChange={(event) => onChange({ upstreamProxy: event.target.value })}
                helperText={t("可空。作为服务默认出站代理；规则选择“继承默认”时使用。")}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
            </Box>
          </Box>

          <Box className="proxy-profile-section proxy-profile-section--capture">
            <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Box minWidth={0}>
                <Typography variant="subtitle2">{t("记录")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("控制请求面板里是否保存 Body 预览，Header 与基础信息会继续记录。")}
                </Typography>
              </Box>
              <Switch
                checked={draft.captureBody}
                onChange={(event) => onChange({ captureBody: event.target.checked })}
                inputProps={{ "aria-label": t("记录正文") }}
              />
            </Stack>
            <Box className="proxy-two-fields proxy-profile-capture-grid">
              <Box className="proxy-profile-capture-card">
                <Typography variant="body2" sx={{ fontWeight: 780 }}>{t("记录正文")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {draft.captureBody
                    ? t("已开启，会保存请求与响应正文预览。")
                    : t("已关闭，只记录 URL、状态码、耗时和 Header。")}
                </Typography>
              </Box>
              <TextField
                label={t("正文预览字节")}
                name="proxy-max-body-bytes"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                value={draft.maxBodyBytes}
                onChange={(event) =>
                  onChange({ maxBodyBytes: Math.max(512, Number(event.target.value) || 512) })
                }
                helperText={t("每个请求/响应最多保留的正文预览大小。")}
              />
            </Box>
          </Box>

          {proxyUrl ? (
            <Box className="proxy-profile-section proxy-profile-section--env">
              <Stack className="proxy-profile-section-head" direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box minWidth={0}>
                  <Typography variant="subtitle2">{t("环境变量")}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("复制到终端或项目启动档案里，让命令行请求走这个代理入口。")}
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
    </>
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
  const { t } = useI18n();
  const forwardAction = draft?.action.kind === "forward" ? draft.action : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth className="proxy-config-dialog proxy-rule-dialog">
      <DialogTitle>{draft?.name ? t("规则配置") : t("新建规则")}</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
        {draft ? (
          <Stack spacing={0.85} minWidth={0}>
            <Box className="proxy-two-fields">
              <TextField
                label={t("规则名称")}
                name="proxy-rule-name"
                autoComplete="off"
                value={draft.name}
                onChange={(event) => onChange({ name: event.target.value })}
              />
              <TextField
                label={t("优先级")}
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
                label={t("方法")}
                name="proxy-rule-method"
                value={draft.method}
                onChange={(event) => onChange({ method: event.target.value })}
              >
                {HTTP_METHODS.map((method) => (
                  <MenuItem key={method || "any"} value={method}>
                    {method || t("任意")}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label={t("路径前缀")}
                name="proxy-rule-path-prefix"
                autoComplete="off"
                value={draft.pathPrefix}
                onChange={(event) => onChange({ pathPrefix: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
              <TextField
                label={t("URL 包含")}
                name="proxy-rule-url-contains"
                autoComplete="off"
                value={draft.urlContains}
                onChange={(event) => onChange({ urlContains: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
            </Box>
            <Box className="proxy-two-fields">
              <TextField
                label={t("Header 名")}
                name="proxy-rule-header-name"
                autoComplete="off"
                value={draft.headerName}
                onChange={(event) => onChange({ headerName: event.target.value })}
                inputProps={{ spellCheck: false, translate: "no" }}
              />
              <TextField
                label={t("Header 包含")}
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
                label={t("动作")}
                name="proxy-rule-action"
                value={draft.action.kind}
                onChange={(event) => onActionChange(event.target.value as ProxyRuleAction["kind"])}
              >
                {ACTION_KINDS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {t(item.label)}
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
                label={t("启用")}
              />
              <TextField
                label={t("延迟 ms")}
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
                    <b>{t("目标")}</b>
                    <small>{t("只决定请求转发到哪里，不决定是否走代理。")}</small>
                  </span>
                  <Box className="proxy-two-fields">
                    <TextField
                      label={t("转发到")}
                      name="proxy-rule-target-base-url"
                      autoComplete="off"
                      placeholder={t("为空则使用原请求地址")}
                      value={forwardAction.targetBaseUrl}
                      onChange={(event) => onForwardChange({ targetBaseUrl: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                    <TextField
                      label={t("路径改写")}
                      name="proxy-rule-rewrite-prefix"
                      autoComplete="off"
                      placeholder={t("例如 /mock-api")}
                      value={forwardAction.rewritePrefix}
                      onChange={(event) => onForwardChange({ rewritePrefix: event.target.value })}
                      inputProps={{ spellCheck: false, translate: "no" }}
                    />
                  </Box>
                </Box>
                <Box className="proxy-rule-subsection">
                  <span>
                    <b>{t("出站")}</b>
                    <small>
                      {t(
                        OUTBOUND_MODES.find(
                          (item) => item.value === forwardOutboundMode(forwardAction),
                        )?.helper ?? "",
                      )}
                    </small>
                  </span>
                  <Box className="proxy-two-fields">
                    <TextField
                      select
                      label={t("出站策略")}
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
                          {t(item.label)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label={t("指定上游代理")}
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
                    label={t("追加请求 Header")}
                    name="proxy-rule-request-headers"
                    multiline
                    minRows={2}
                    autoComplete="off"
                    value={requestHeadersText}
                    onChange={(event) => onRequestHeadersTextChange(event.target.value)}
                    inputProps={{ spellCheck: false, translate: "no" }}
                  />
                  <TextField
                    label={t("追加响应 Header")}
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
                    label={t("状态码")}
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
                  label={t("响应 Header")}
                  name="proxy-rule-mock-headers"
                  multiline
                  minRows={2}
                  autoComplete="off"
                  value={mockHeadersText}
                  onChange={(event) => onMockHeadersTextChange(event.target.value)}
                  inputProps={{ spellCheck: false, translate: "no" }}
                />
                <TextField
                  label={t("响应正文")}
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
                  label={t("状态码")}
                  name="proxy-rule-block-status"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.action.status}
                  onChange={(event) => onBlockChange({ status: Number(event.target.value) || 403 })}
                />
                <TextField
                  label={t("阻断响应")}
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
            {t("删除")}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={onClose}>{t("取消")}</Button>
        <Button variant="contained" onClick={onSave} disabled={Boolean(busy)}>
          {t("保存规则")}
        </Button>
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
