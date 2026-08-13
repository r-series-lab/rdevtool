import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  DoctorCheck,
  DoctorPaths,
  DoctorSnapshot,
  DoctorWorkspaceSummary,
  HealthIdentity,
  HealthSnapshot,
  RecommendedAction,
} from "../app-types";
import {
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  FolderIcon,
  RefreshIcon,
  SearchIcon,
} from "./AppIcons";
import { useI18n } from "../i18n";
import { translateAppMessage } from "../i18n/appMessages";
import {
  compareDoctorChecks,
  doctorCheckAction,
  doctorCheckMessage,
  doctorCheckTitle,
  doctorStatusLabel,
  type DoctorCheckComparison,
} from "../lib/doctorPresentation";
import { managedArtifactObjectTypeLabel } from "../lib/managedArtifactPresentation";
import { AppEmptyState } from "./AppEmptyState";

export type SystemDiagnosticsPanelProps = {
  activeWorkspaceKey?: string;
  onOpenArtifacts?: (kind: string | null) => void;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  const next = value / 1024 ** index;
  return `${next >= 10 || index === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[index]}`;
}

function shortCommit(value?: string | null) {
  return value?.trim() ? value.trim().slice(0, 12) : "unknown";
}

function recommendedArtifactKind(action: RecommendedAction) {
  const match = action.command.match(/(?:^|\s)--kind\s+([^\s]+)/);
  return match?.[1] ?? null;
}

type DoctorChecksViewProps = {
  checks: DoctorCheck[];
  workspace?: DoctorWorkspaceSummary | null;
  paths?: DoctorPaths;
  identity?: HealthIdentity | null;
  comparison?: DoctorCheckComparison | null;
  rechecking?: boolean;
  onRecheck?: () => void;
  onOpenPath?: (path: string) => void;
  onOpenArtifacts?: (kind: string | null) => void;
};

export function DoctorChecksView({
  checks,
  workspace,
  paths,
  identity,
  comparison,
  rechecking = false,
  onRecheck,
  onOpenPath,
  onOpenArtifacts,
}: DoctorChecksViewProps) {
  const { language, t } = useI18n();
  const [view, setView] = useState<"attention" | "all">("attention");
  const errorCount = checks.filter((check) => check.status === "error").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const passedCount = checks.length - errorCount - warningCount;
  const visibleChecks =
    view === "attention"
      ? checks.filter((check) => check.status !== "ok")
      : checks;
  const introducedCodes = new Set(
    comparison?.introduced.map((check) => check.code) ?? [],
  );
  const remainingCodes = new Set(
    comparison?.remaining.map((check) => check.code) ?? [],
  );

  return (
    <Box className="settings-doctor" data-doctor-checks={view}>
      <div className="settings-doctor-head">
        <div>
          <Typography variant="subtitle2">{t("环境检查")}</Typography>
          <Typography variant="caption">
            {workspace
              ? t("工作区：{name} · 共 {count} 项", {
                  name: workspace.name,
                  count: checks.length,
                })
              : t("共 {count} 项", { count: checks.length })}
          </Typography>
        </div>
        <div className="settings-doctor-head-actions">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, nextView: "attention" | "all" | null) => {
              if (nextView) setView(nextView);
            }}
            aria-label={t("检查范围")}
          >
            <ToggleButton value="attention">{t("需关注")}</ToggleButton>
            <ToggleButton value="all">{t("全部")}</ToggleButton>
          </ToggleButtonGroup>
          {onRecheck ? (
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              disabled={rechecking}
              startIcon={
                rechecking ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <RefreshIcon fontSize="small" />
                )
              }
              onClick={onRecheck}
            >
              {rechecking ? t("正在重新检查") : t("重新检查")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="settings-doctor-metrics" aria-label={t("检查汇总")}>
        <span><strong>{errorCount}</strong>{t("错误")}</span>
        <span><strong>{warningCount}</strong>{t("警告")}</span>
        <span><strong>{passedCount}</strong>{t("通过")}</span>
      </div>
      {comparison ? (
        <div className="settings-doctor-comparison" data-doctor-comparison="complete" role="status">
          <div className="settings-doctor-comparison-head">
            <Typography variant="subtitle2">{t("重新检查完成")}</Typography>
            <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                color="success"
                label={t("已解决 {count}", { count: comparison.resolved.length })}
              />
              <Chip
                size="small"
                color={comparison.introduced.length > 0 ? "warning" : "default"}
                label={t("新增 {count}", { count: comparison.introduced.length })}
              />
              <Chip
                size="small"
                label={t("仍存在 {count}", { count: comparison.remaining.length })}
              />
            </Stack>
          </div>
          {comparison.resolved.length > 0 ? (
            <Typography variant="caption">
              {t("已解决：{items}", {
                items: comparison.resolved
                  .map((check) => doctorCheckTitle(check.code, t))
                  .join("、"),
              })}
            </Typography>
          ) : null}
        </div>
      ) : null}
      {visibleChecks.length === 0 ? (
        <AppEmptyState
          compact
          className="settings-doctor-empty"
          title={t("没有需要关注的环境检查")}
          description={t("当前工作区的配置、路径和服务检查均通过。")}
        />
      ) : (
        <div className="settings-doctor-list">
          {visibleChecks.map((check, index) => {
            const detail = check.detail
              ? translateAppMessage(undefined, check.detail, t)
              : "";
            const action = paths
              ? doctorCheckAction(check, paths, identity)
              : null;
            const actionEnabled = action
              ? action.type === "path"
                ? Boolean(onOpenPath)
                : Boolean(onOpenArtifacts)
              : false;
            const changeStatus = introducedCodes.has(check.code)
              ? "introduced"
              : remainingCodes.has(check.code)
                ? "remaining"
                : null;
            return (
              <div className="settings-doctor-row" key={`${check.code}-${index}`}>
                <div className="settings-doctor-row-main">
                  <div className="settings-doctor-row-title">
                    <Typography variant="subtitle2">
                      {doctorCheckTitle(check.code, t)}
                    </Typography>
                    <Chip
                      size="small"
                      color={
                        check.status === "error"
                          ? "error"
                          : check.status === "warning"
                            ? "warning"
                            : "success"
                      }
                      label={doctorStatusLabel(check.status, t)}
                    />
                    {changeStatus ? (
                      <Chip
                        className="settings-doctor-change"
                        size="small"
                        variant="outlined"
                        color={changeStatus === "introduced" ? "warning" : "default"}
                        label={changeStatus === "introduced" ? t("新增") : t("仍存在")}
                      />
                    ) : null}
                  </div>
                  <Typography variant="caption">
                    {doctorCheckMessage(check, language, t)}
                  </Typography>
                  {detail ? (
                    <Typography
                      className="settings-doctor-detail"
                      variant="caption"
                      title={detail}
                    >
                      {detail}
                    </Typography>
                  ) : null}
                </div>
                <div className="settings-doctor-row-side">
                  <Typography className="settings-doctor-code" variant="caption">
                    {check.code}
                  </Typography>
                  {action && actionEnabled ? (
                    <Button
                      size="small"
                      color="inherit"
                      variant="outlined"
                      startIcon={
                        action.type === "path" ? (
                          <FolderIcon fontSize="small" />
                        ) : (
                          <SearchIcon fontSize="small" />
                        )
                      }
                      onClick={() => {
                        if (action.type === "path") {
                          onOpenPath?.(action.path);
                        } else {
                          onOpenArtifacts?.(action.artifactKind);
                        }
                      }}
                    >
                      {t(action.label)}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Box>
  );
}

export function SystemDiagnosticsPanel({
  activeWorkspaceKey = "system",
  onOpenArtifacts,
}: SystemDiagnosticsPanelProps = {}) {
  const { t } = useI18n();
  const [doctor, setDoctor] = useState<DoctorSnapshot | null>(null);
  const [comparison, setComparison] = useState<DoctorCheckComparison | null>(null);
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const doctorRef = useRef<DoctorSnapshot | null>(null);
  const refreshRequestRef = useRef(0);

  const refresh = useCallback(async (compareWithPrevious = false) => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    const previous = doctorRef.current;
    setLoading(true);
    setError("");
    try {
      const nextDoctor = await invoke<DoctorSnapshot>("get_doctor_snapshot", {
        workspace: activeWorkspaceKey,
      });
      if (requestId !== refreshRequestRef.current) return;
      setComparison(
        compareWithPrevious && previous
          ? compareDoctorChecks(previous.checks, nextDoctor.checks)
          : null,
      );
      doctorRef.current = nextDoctor;
      setDoctor(nextDoctor);
    } catch (reason) {
      if (requestId !== refreshRequestRef.current) return;
      setError(String(reason));
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false);
      }
    }
  }, [activeWorkspaceKey]);

  useEffect(() => {
    doctorRef.current = null;
    setComparison(null);
    setTechnicalDetailsOpen(false);
    void refresh(false);
  }, [refresh]);

  const health: HealthSnapshot | null = doctor?.health ?? null;

  const identityStatus = useMemo(() => {
    if (!health) {
      return "unknown";
    }
    if (health.identity.sourceCommitMatchesBuild === false) {
      return "mismatch";
    }
    if (health.identity.buildDirty || health.identity.currentSourceDirty) {
      return "dirty";
    }
    return "clean";
  }, [health]);

  const storage = useMemo(
    () => [...(health?.storage ?? [])].sort((left, right) => right.sizeBytes - left.sizeBytes),
    [health],
  );
  const doctorSummary = doctor
    ? doctor.errorCount > 0
      ? t("发现 {errorCount} 个错误和 {warningCount} 个警告", {
          errorCount: doctor.errorCount,
          warningCount: doctor.warningCount,
        })
      : doctor.warningCount > 0
        ? t("发现 {count} 个需要关注的环境检查", {
            count: doctor.warningCount,
          })
        : t("环境检查均通过")
    : "";

  async function copyDiagnostics() {
    if (!doctor) return;
    await navigator.clipboard.writeText(JSON.stringify(doctor, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function openDiagnosticPath(path: string) {
    setError("");
    try {
      await invoke("open_local_path", { path });
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <div className="settings-diagnostics" data-system-diagnostics="read-only">
      <header className="settings-diagnostics-head">
        <div>
          <Typography variant="subtitle2">{t("系统诊断")}</Typography>
          <Typography variant="caption">
            {t("工作区检查、可执行文件身份、受管数据占用与健康风险")}
          </Typography>
        </div>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title={copied ? t("已复制诊断报告") : t("复制诊断报告")}>
            <span>
              <IconButton
                size="small"
                onClick={() => void copyDiagnostics()}
                disabled={!doctor}
                aria-label={t("复制诊断报告")}
              >
                <CopyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("刷新系统诊断")}>
            <span>
              <IconButton
                size="small"
                onClick={() => void refresh(true)}
                disabled={loading}
                aria-label={t("刷新系统诊断")}
              >
                {loading ? <CircularProgress size={15} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </header>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading && !doctor ? (
        <div className="settings-diagnostics-loading">
          <CircularProgress size={18} />
          <Typography variant="caption">{t("正在收集本机状态")}</Typography>
        </div>
      ) : null}

      {doctor && health ? (
        <>
          <Alert
            severity={
              doctor.status === "error"
                ? "error"
                : doctor.status === "warning"
                  ? "warning"
                  : "success"
            }
          >
            {doctorSummary}
          </Alert>
          <Typography className="settings-diagnostics-generated-at" variant="caption">
            {t("检查时间：{time}", {
              time: new Date(health.generatedAtMs).toLocaleString(),
            })}
          </Typography>
          <DoctorChecksView
            checks={doctor.checks}
            workspace={doctor.activeWorkspace}
            paths={doctor.paths}
            identity={health.identity}
            comparison={comparison}
            rechecking={loading}
            onRecheck={() => void refresh(true)}
            onOpenPath={(path) => void openDiagnosticPath(path)}
            onOpenArtifacts={onOpenArtifacts}
          />
          {health.risks.map((risk) => (
            <Alert
              key={risk.code}
              severity={risk.severity === "error" ? "error" : "warning"}
            >
              <strong>
                {translateAppMessage(risk.summaryMessage, risk.summary, t)}
              </strong>
              <br />
              {translateAppMessage(risk.detailMessage, risk.detail, t)}
            </Alert>
          ))}

          {health.recommendedActions.length > 0 ? (
            <Box className="settings-diagnostics-actions">
              <div className="settings-list-group-head">
                <Typography variant="caption">{t("建议动作")}</Typography>
                <Typography variant="caption">{t("只读")}</Typography>
              </div>
              {health.recommendedActions.map((action) => {
                const artifactKind = recommendedArtifactKind(action);
                return (
                  <div className="settings-diagnostics-action-row" key={action.command}>
                    <div>
                      <Typography variant="subtitle2">
                        {translateAppMessage(action.reasonMessage, action.reason, t)}
                      </Typography>
                      <Typography variant="caption">{action.command}</Typography>
                    </div>
                    {artifactKind ? (
                      <Button
                        size="small"
                        color="inherit"
                        variant="outlined"
                        startIcon={<SearchIcon fontSize="small" />}
                        onClick={() => onOpenArtifacts?.(artifactKind)}
                        disabled={!onOpenArtifacts}
                      >
                        {t("查看相关产物")}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        color="inherit"
                        variant="outlined"
                        startIcon={<CopyIcon fontSize="small" />}
                        onClick={() => void navigator.clipboard.writeText(action.command)}
                      >
                        {t("复制命令")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </Box>
          ) : null}

          <Box className="settings-diagnostics-technical">
            <div className="settings-diagnostics-technical-head">
              <Typography variant="subtitle2">{t("技术详情")}</Typography>
              <Tooltip
                title={t(
                  technicalDetailsOpen ? "收起技术详情" : "展开技术详情",
                )}
              >
                <IconButton
                  size="small"
                  aria-label={t(
                    technicalDetailsOpen ? "收起技术详情" : "展开技术详情",
                  )}
                  aria-expanded={technicalDetailsOpen}
                  onClick={() => setTechnicalDetailsOpen((current) => !current)}
                >
                  {technicalDetailsOpen ? (
                    <CollapseIcon fontSize="small" />
                  ) : (
                    <ExpandIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </div>
            <Collapse in={technicalDetailsOpen} timeout="auto" unmountOnExit>
              <div className="settings-diagnostics-technical-content">
                <div className="settings-diagnostics-summary">
                  <div className="settings-diagnostics-block">
                    <div className="settings-diagnostics-block-head">
                      <Typography variant="subtitle2">{t("当前执行文件")}</Typography>
                      <Chip
                        size="small"
                        color={
                          identityStatus === "mismatch"
                            ? "warning"
                            : identityStatus === "clean"
                              ? "success"
                              : "default"
                        }
                        label={`${t(health.identity.installKind)} · ${t(identityStatus)}`}
                      />
                    </div>
                    <Typography className="settings-diagnostics-path" variant="caption">
                      {health.identity.executablePath}
                    </Typography>
                    <Typography variant="caption">
                      v{health.identity.version} · build{" "}
                      {shortCommit(health.identity.buildCommit)} · source{" "}
                      {shortCommit(health.identity.currentSourceCommit)} ·{" "}
                      {health.identity.buildProfile ?? "unknown"}
                    </Typography>
                  </div>
                  <div className="settings-diagnostics-block">
                    <div className="settings-diagnostics-block-head">
                      <Typography variant="subtitle2">{t("受管数据")}</Typography>
                      <Chip
                        size="small"
                        label={formatBytes(health.storageTotalBytes)}
                      />
                    </div>
                    <Typography variant="caption">
                      {t("日志、代理事件、浏览器档案、知识文件与应用数据库。")}
                    </Typography>
                  </div>
                </div>

                <div className="settings-diagnostics-storage">
                  <div className="settings-list-group-head">
                    <Typography variant="caption">{t("存储明细")}</Typography>
                    <Typography variant="caption">
                      {formatBytes(health.storageTotalBytes)}
                    </Typography>
                  </div>
                  {storage.map((entry) => (
                    <div key={entry.key} className="settings-diagnostics-storage-row">
                      <div className="settings-diagnostics-storage-main">
                        <Stack direction="row" spacing={0.6} alignItems="center">
                          <Typography variant="subtitle2">
                            {translateAppMessage(entry.labelMessage, entry.label, t)}
                          </Typography>
                          {entry.statusKey !== "ok" ? (
                            <Chip size="small" color="warning" label={t("需要关注")} />
                          ) : null}
                        </Stack>
                        <Typography variant="caption" title={entry.path}>
                          {entry.path}
                        </Typography>
                        {entry.largestFilePath ? (
                          <Typography variant="caption" title={entry.largestFilePath}>
                            {t("最大文件：{path}（{size}）", {
                              path: entry.largestFilePath,
                              size: formatBytes(entry.largestFileBytes),
                            })}
                          </Typography>
                        ) : null}
                      </div>
                      <span className="settings-diagnostics-storage-meta">
                        {entry.exists
                          ? managedArtifactObjectTypeLabel(entry.objectType, t)
                          : t("未创建")} ·{" "}
                        {formatBytes(entry.sizeBytes)} ·{" "}
                        {t("{count} 个文件", { count: entry.fileCount })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Collapse>
          </Box>
        </>
      ) : null}
    </div>
  );
}
