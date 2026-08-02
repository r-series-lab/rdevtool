import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Typography,
} from "@mui/material";
import { RefreshIcon } from "./AppIcons";
import { useI18n } from "../i18n";

type HealthIdentity = {
  executablePath: string;
  installKind: string;
  version: string;
  buildCommit?: string | null;
  buildDirty?: boolean | null;
  buildProfile?: string | null;
  currentSourceCommit?: string | null;
  currentSourceDirty?: boolean | null;
  sourceCommitMatchesBuild?: boolean | null;
};

type HealthStorageEntry = {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  objectType: string;
  sizeBytes: number;
  fileCount: number;
  statusKey: string;
};

type HealthRisk = {
  code: string;
  severity: string;
  summary: string;
  detail: string;
};

type HealthSnapshot = {
  schemaVersion: number;
  generatedAtMs: number;
  statusKey: string;
  statusLabel: string;
  summary: string;
  identity: HealthIdentity;
  storageTotalBytes: number;
  storage: HealthStorageEntry[];
  risks: HealthRisk[];
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

export function SystemDiagnosticsPanel() {
  const { t } = useI18n();
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setHealth(await invoke<HealthSnapshot>("get_health_snapshot"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return (
    <div className="settings-diagnostics" data-system-diagnostics="read-only">
      <header className="settings-diagnostics-head">
        <div>
          <Typography variant="subtitle2">{t("系统诊断")}</Typography>
          <Typography variant="caption">
            {t("可执行文件身份、受管数据占用与健康风险")}
          </Typography>
        </div>
        <Button
          size="small"
          color="inherit"
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={() => void refresh()}
          disabled={loading}
        >
          {t("刷新")}
        </Button>
      </header>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading && !health ? (
        <div className="settings-diagnostics-loading">
          <CircularProgress size={18} />
          <Typography variant="caption">{t("正在收集本机状态")}</Typography>
        </div>
      ) : null}

      {health ? (
        <>
          <Alert severity={health.statusKey === "ok" ? "success" : "warning"}>
            {health.summary}
          </Alert>
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
                  label={`${health.identity.installKind} · ${identityStatus}`}
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

          {health.risks.map((risk) => (
            <Alert
              key={risk.code}
              severity={risk.severity === "error" ? "error" : "warning"}
            >
              <strong>{risk.summary}</strong>
              <br />
              {risk.detail}
            </Alert>
          ))}

          <div className="settings-diagnostics-storage">
            <div className="settings-list-group-head">
              <Typography variant="caption">{t("存储明细")}</Typography>
              <Typography variant="caption">
                {formatBytes(health.storageTotalBytes)}
              </Typography>
            </div>
            {health.storage.map((entry) => (
              <div key={entry.key} className="settings-diagnostics-storage-row">
                <div>
                  <Typography variant="subtitle2">{entry.label}</Typography>
                  <Typography variant="caption">{entry.path}</Typography>
                </div>
                <span>
                  {entry.exists ? entry.objectType : t("未创建")} ·{" "}
                  {formatBytes(entry.sizeBytes)} ·{" "}
                  {t("{count} 个文件", { count: entry.fileCount })}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
