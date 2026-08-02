import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  ManagedArtifactInventoryResponse,
  ManagedArtifactRecord,
  ManagedArtifactReference,
} from "../app-types";
import { useI18n } from "../i18n";
import { RefreshIcon } from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";

export type ManagedArtifactsPanelProps = {
  activeWorkspaceKey: string;
};

const ARTIFACT_KIND_LABELS: Record<string, string> = {
  workspaceConfig: "工作区配置",
  workspaceProjectInstance: "工作区副本",
  runtimeState: "Runtime 状态",
  runtimeDaemonLog: "Runtime daemon 日志",
  runtimeLog: "Runtime 历史日志",
  proxyState: "Proxy 状态",
  proxyDaemonLog: "Proxy daemon 日志",
  proxyStopRequest: "Proxy 停止请求",
  proxyLock: "Proxy 锁文件",
  proxyEventLog: "Proxy 事件历史",
};

function kindLabel(kind: string) {
  return ARTIFACT_KIND_LABELS[kind] ?? kind;
}

function recordMatchesQuery(record: ManagedArtifactRecord, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    record.id,
    record.source,
    record.artifact.kind,
    kindLabel(record.artifact.kind),
    record.artifact.path,
    record.artifact.lifecycle,
    record.workspaceKey,
    record.projectKey,
    record.runId,
    record.scopePath,
    record.detail,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(needle));
}

function referenceMatchesQuery(record: ManagedArtifactReference, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    record.kind,
    kindLabel(record.kind),
    record.path,
    record.source,
    record.workspaceKey,
    record.projectKey,
    record.reason,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(needle));
}

function ArtifactRecordCard({ record }: { record: ManagedArtifactRecord }) {
  const { t } = useI18n();

  return (
    <Box
      component="article"
      className={`settings-artifact-record${record.active ? " is-active" : ""}${
        !record.exists || !record.ownershipVerified ? " has-warning" : ""
      }`}
    >
      <Stack
        className="settings-artifact-record-head"
        direction="row"
        spacing={0.65}
        alignItems="center"
      >
        <Typography className="settings-artifact-record-title" variant="subtitle2">
          {kindLabel(record.artifact.kind)}
        </Typography>
        <Stack
          className="settings-artifact-record-tags"
          direction="row"
          spacing={0.45}
          useFlexGap
          flexWrap="wrap"
        >
          {record.active ? (
            <Chip className="settings-artifact-chip is-active" size="small" label={t("活动中")} />
          ) : null}
          <Chip
            className={`settings-artifact-chip${record.exists ? "" : " is-warning"}`}
            size="small"
            variant="outlined"
            label={record.exists ? record.objectType : t("路径缺失")}
          />
          <Chip
            className={`settings-artifact-chip${record.ownershipVerified ? " is-verified" : " is-warning"}`}
            size="small"
            variant="outlined"
            label={record.ownershipVerified ? t("归属已验证") : t("归属待验证")}
          />
        </Stack>
      </Stack>
      <Typography className="settings-artifact-path" variant="body2">
        {record.artifact.path}
      </Typography>
      <Typography className="settings-artifact-meta" variant="caption">
        {[
          record.workspaceKey
            ? t("工作区 {key}", { key: record.workspaceKey })
            : t("未映射工作区"),
          record.projectKey ? t("项目 {key}", { key: record.projectKey }) : "",
          record.runId ? `Run ${record.runId}` : "",
          record.source,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Typography>
      <Typography className="settings-artifact-detail" variant="caption">
        {record.detail}
      </Typography>
    </Box>
  );
}

function ArtifactReferenceCard({ record }: { record: ManagedArtifactReference }) {
  const { t } = useI18n();

  return (
    <Box component="article" className="settings-artifact-reference">
      <Stack
        className="settings-artifact-record-head"
        direction="row"
        spacing={0.6}
        alignItems="center"
      >
        <Typography className="settings-artifact-record-title" variant="subtitle2">
          {kindLabel(record.kind)}
        </Typography>
        <Stack
          className="settings-artifact-record-tags"
          direction="row"
          spacing={0.45}
          useFlexGap
          flexWrap="wrap"
        >
          <Chip
            className="settings-artifact-chip"
            size="small"
            variant="outlined"
            label={t("仅引用")}
          />
          {!record.exists ? (
            <Chip
              className="settings-artifact-chip is-warning"
              size="small"
              variant="outlined"
              label={t("路径缺失")}
            />
          ) : null}
        </Stack>
      </Stack>
      <Typography className="settings-artifact-path" variant="body2">
        {record.path}
      </Typography>
      <Typography className="settings-artifact-detail" variant="caption">
        {record.reason}
      </Typography>
    </Box>
  );
}

export function ManagedArtifactsInventoryView({
  inventory,
  query,
}: {
  inventory: ManagedArtifactInventoryResponse;
  query: string;
}) {
  const { t } = useI18n();
  const artifacts = useMemo(
    () => inventory.observed.artifacts.filter((record) => recordMatchesQuery(record, query)),
    [inventory, query],
  );
  const references = useMemo(
    () => inventory.observed.references.filter((record) => referenceMatchesQuery(record, query)),
    [inventory, query],
  );
  const summary = inventory.observed.summary;

  return (
    <Stack
      className="settings-artifacts-inventory"
      spacing={0}
      data-managed-artifacts-view="read-only"
    >
      <div className="settings-list-group-head settings-artifacts-group-label">
        <Typography variant="caption">{t("盘点概览")}</Typography>
        <Typography variant="caption">{inventory.status.label}</Typography>
      </div>
      <Box className="settings-artifacts-summary" aria-label={t("受管产物盘点概览")}>
        {[
          [t("托管记录"), summary.artifactCount],
          [t("已存在"), summary.existingCount],
          [t("活动中"), summary.activeCount],
          [t("仅引用"), summary.referenceCount],
        ].map(([label, value]) => (
          <Box className="settings-artifacts-metric" key={label}>
            <Typography component="strong">{value}</Typography>
            <Typography component="span">{label}</Typography>
          </Box>
        ))}
      </Box>
      {inventory.risks.length > 0 ? (
        <Stack className="settings-artifact-risks" spacing={0.65}>
          {inventory.risks.map((risk) => (
            <Alert
              className="settings-artifact-risk"
              key={`${risk.code}:${risk.detail}`}
              severity={
                risk.severity === "error"
                  ? "error"
                  : risk.severity === "warning"
                    ? "warning"
                    : "info"
              }
              variant="outlined"
            >
              {risk.detail}
            </Alert>
          ))}
        </Stack>
      ) : null}
      <Box className="settings-artifacts-record-group">
        <header className="settings-artifacts-record-group-head">
          <Typography variant="subtitle2">{t("托管产物")}</Typography>
          <Typography variant="caption">{t("{count} 条", { count: artifacts.length })}</Typography>
        </header>
        <Stack className="settings-artifacts-record-list" spacing={0.7}>
          {artifacts.length > 0 ? (
            artifacts.map((record) => <ArtifactRecordCard key={record.id} record={record} />)
          ) : (
            <AppEmptyState
              compact
              title={t("没有匹配的托管产物")}
              description={t("调整搜索或工作区范围后重试。")}
            />
          )}
        </Stack>
      </Box>
      {references.length > 0 ? (
        <Box component="details" className="settings-artifacts-references">
          <Typography component="summary" variant="subtitle2">
            <Box component="span">{t("非托管引用")}</Box>
            <Box component="span">{t("{count} 条", { count: references.length })}</Box>
          </Typography>
          <Stack className="settings-artifacts-reference-list" spacing={0.7}>
            {references.map((record) => (
              <ArtifactReferenceCard
                key={`${record.kind}:${record.path}:${record.workspaceKey ?? ""}`}
                record={record}
              />
            ))}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

export function ManagedArtifactsPanel({ activeWorkspaceKey }: ManagedArtifactsPanelProps) {
  const { t } = useI18n();
  const [allWorkspaces, setAllWorkspaces] = useState(activeWorkspaceKey === "system");
  const [inventory, setInventory] = useState<ManagedArtifactInventoryResponse | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    setAllWorkspaces(activeWorkspaceKey === "system");
  }, [activeWorkspaceKey]);

  const loadInventory = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const response = await invoke<ManagedArtifactInventoryResponse>("list_managed_artifacts", {
        workspace: allWorkspaces ? null : activeWorkspaceKey,
        allWorkspaces,
        project: null,
        kinds: [],
      });
      if (requestIdRef.current === requestId) {
        setInventory(response);
      }
    } catch (reason) {
      if (requestIdRef.current === requestId) {
        setError(String(reason));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [activeWorkspaceKey, allWorkspaces]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  return (
    <Stack className="settings-overview" spacing={1.15}>
      <section
        className="settings-list-section settings-list-section--global-combined settings-artifacts-section"
        aria-labelledby="settings-artifacts-title"
      >
        <header className="settings-list-head settings-artifacts-head">
          <div className="settings-artifacts-head-copy">
            <Typography id="settings-artifacts-title" variant="subtitle2">
              {t("受管产物")}
            </Typography>
            <Typography variant="caption">
              {t("汇总工作区副本、Runtime 与 Proxy daemon 的持久化产物")}
            </Typography>
          </div>
          <Tooltip title={t("刷新受管产物")}>
            <span>
              <IconButton
                className="settings-artifacts-refresh"
                size="small"
                onClick={() => void loadInventory()}
                disabled={loading}
                aria-label={t("刷新受管产物")}
              >
                {loading ? <CircularProgress size={15} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </header>
        <Stack className="settings-artifacts-content" spacing={0}>
          <div className="settings-list-group-head settings-artifacts-group-label">
            <Typography variant="caption">{t("范围")}</Typography>
            <Typography variant="caption">{t("筛选当前盘点结果")}</Typography>
          </div>
          <div className="settings-list-row settings-list-row--split settings-artifacts-toolbar">
            <div className="settings-overview-copy">
              <Typography variant="subtitle2">{t("搜索与工作区")}</Typography>
              <Typography variant="caption">
                {t("按类型、路径、工作区或项目快速定位。")}
              </Typography>
            </div>
            <Stack
              className="settings-artifacts-controls"
              direction="row"
              spacing={0.8}
              alignItems="center"
            >
              <TextField
                className="settings-artifacts-search"
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("搜索类型、路径、工作区或项目")}
                inputProps={{ "aria-label": t("搜索受管产物") }}
                sx={{ flex: 1 }}
              />
              <FormControlLabel
                className="settings-artifacts-scope"
                control={
                  <Switch
                    size="small"
                    checked={allWorkspaces}
                    onChange={(event) => setAllWorkspaces(event.target.checked)}
                    inputProps={{ "aria-label": t("查看全部工作区产物") }}
                  />
                }
                label={t("全部工作区")}
              />
            </Stack>
          </div>
          <Alert className="settings-artifacts-readonly" severity="info" variant="outlined">
            {t("仅提供盘点视图，不执行删除或清理；cleanup-plan 同样只生成只读计划。")}
          </Alert>
          {error ? (
            <Alert className="settings-artifacts-error" severity="error">
              {error}
            </Alert>
          ) : null}
          {loading && !inventory ? (
            <Stack className="settings-artifacts-loading" direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                {t("正在读取受管产物台账…")}
              </Typography>
            </Stack>
          ) : inventory ? (
            <ManagedArtifactsInventoryView inventory={inventory} query={query} />
          ) : null}
        </Stack>
      </section>
    </Stack>
  );
}
