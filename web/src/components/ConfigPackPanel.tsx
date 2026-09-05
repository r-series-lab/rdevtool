import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import {
  DownloadIcon,
  FolderIcon,
  RefreshIcon,
  RestoreIcon,
  SearchIcon,
  UploadIcon,
} from "./AppIcons";
import { useAppConfirmDialog } from "./AppConfirmDialog";
import "./ConfigPackPanel.css";

type InventoryItem = {
  key: string;
  name: string;
  detail: string;
};

type ConfigPackInventory = {
  projects: InventoryItem[];
  workspaces: InventoryItem[];
  configSources: InventoryItem[];
};

type PackModule = {
  key: string;
  itemCount: number;
};

type PackManifest = {
  packId: string;
  name: string;
  createdAt: string;
  schemaVersion: number;
  modules: PackModule[];
  security: {
    sensitiveValuesRemoved: number;
    requiredEnvironment: string[];
    portablePathCount: number;
  };
};

type PackInspection = {
  path: string;
  sizeBytes: number;
  sha256: string;
  valid: boolean;
  manifest: PackManifest;
  projectKeys: string[];
  workspaceKeys: string[];
  configSourceIds: string[];
  issues: ImportIssue[];
};

type RequiredMapping = {
  kind: "project" | "workspace";
  key: string;
  placeholder: string;
  suggestedPath: string;
};

type ImportIssue = {
  severity: "error" | "warning";
  code: string;
  module: string;
  path: string;
  message: string;
};

type ImportOperation = {
  id: string;
  module: string;
  key: string;
  action: "add" | "merge" | "replace" | "skip";
  target: string;
  summary: string;
  selected: boolean;
};

type ImportPlan = {
  planHash: string;
  packName: string;
  expiresAt: string;
  operations: ImportOperation[];
  issues: ImportIssue[];
  requiredMappings: RequiredMapping[];
  requiredEnvironment: string[];
  blockerCount: number;
  changeCount: number;
  skipCount: number;
  excludedCount: number;
};

type ApplyResult = {
  planHash: string;
  transactionId: string;
  backupDir: string;
  changedPaths: string[];
  appliedCount: number;
  skippedCount: number;
};

type ImportTransaction = {
  transactionId: string;
  createdAt: string;
  packName: string;
  packPath: string;
  packSha256: string;
  planHash: string;
  changedPaths: string[];
  appliedCount: number;
  skippedCount: number;
  rolledBackAt: string | null;
  canRollback: boolean;
};

type ImportTransactionHistory = {
  transactions: ImportTransaction[];
  issues: string[];
};

type ConflictStrategy = "add" | "merge" | "replace" | "skip";
type TransferMode = "export" | "import" | "history";

export type ConfigPackPanelProps = {
  onApplied?: () => Promise<void> | void;
};

function safeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rdevtool-config"
  );
}

function toggleKey(values: string[], key: string) {
  return values.includes(key)
    ? values.filter((value) => value !== key)
    : [...values, key];
}

function shortHash(value: string) {
  return value.replace(/^rdtpack-/, "").slice(0, 12);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const operationActionLabels: Record<ImportOperation["action"], string> = {
  add: "新增",
  merge: "合并",
  replace: "替换",
  skip: "跳过",
};

const moduleLabels: Record<string, string> = {
  projects: "项目配置",
  workspaces: "工作区配置",
  preferences: "界面偏好",
  config_sources: "资源配置",
  security: "凭据安全",
};

export function ConfigPackPanel({ onApplied }: ConfigPackPanelProps) {
  const { t } = useI18n();
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const [mode, setMode] = useState<TransferMode>("export");
  const [inventory, setInventory] = useState<ConfigPackInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [packName, setPackName] = useState("rDevTool configuration");
  const [includeProjects, setIncludeProjects] = useState(true);
  const [includeWorkspaces, setIncludeWorkspaces] = useState(true);
  const [includePreferences, setIncludePreferences] = useState(false);
  const [includeConfigSources, setIncludeConfigSources] = useState(true);
  const [includeDependencies, setIncludeDependencies] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([]);
  const [selectedConfigSources, setSelectedConfigSources] = useState<string[]>([]);
  const [inspection, setInspection] = useState<PackInspection | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>("merge");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [projectRoots, setProjectRoots] = useState<Record<string, string>>({});
  const [workspaceRoots, setWorkspaceRoots] = useState<Record<string, string>>({});
  const [sourceMappings, setSourceMappings] = useState<Record<string, string>>({});
  const [lastApply, setLastApply] = useState<ApplyResult | null>(null);
  const [operationQuery, setOperationQuery] = useState("");
  const [operationModule, setOperationModule] = useState("all");
  const [operationAction, setOperationAction] = useState("all");
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
  const [operationSelectionDirty, setOperationSelectionDirty] = useState(false);
  const [history, setHistory] = useState<ImportTransactionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const selectedModuleCount = useMemo(
    () =>
      Number(includeProjects && selectedProjects.length > 0) +
      Number(includeWorkspaces && selectedWorkspaces.length > 0) +
      Number(includePreferences) +
      Number(includeConfigSources && selectedConfigSources.length > 0),
    [
      includeConfigSources,
      includePreferences,
      includeProjects,
      includeWorkspaces,
      selectedConfigSources.length,
      selectedProjects.length,
      selectedWorkspaces.length,
    ],
  );

  const operationModules = useMemo(
    () => Array.from(new Set(plan?.operations.map((operation) => operation.module) ?? [])),
    [plan],
  );

  const filteredOperations = useMemo(() => {
    const query = operationQuery.trim().toLocaleLowerCase();
    return (plan?.operations ?? []).filter((operation) => {
      if (operationModule !== "all" && operation.module !== operationModule) {
        return false;
      }
      if (operationAction !== "all" && operation.action !== operationAction) {
        return false;
      }
      return (
        !query ||
        [operation.key, operation.summary, operation.target, operation.module].some((value) =>
          value.toLocaleLowerCase().includes(query),
        )
      );
    });
  }, [operationAction, operationModule, operationQuery, plan]);

  async function loadInventory() {
    setInventoryLoading(true);
    setError("");
    try {
      const next = await invoke<ConfigPackInventory>("get_config_pack_inventory");
      setInventory(next);
      const preferredSources = next.configSources.some((item) => item.key === "default")
        ? ["default"]
        : next.configSources.slice(0, 1).map((item) => item.key);
      setSelectedProjects((current) =>
        current.length ? current.filter((key) => next.projects.some((item) => item.key === key)) : next.projects.map((item) => item.key),
      );
      setSelectedWorkspaces((current) =>
        current.length
          ? current.filter((key) => next.workspaces.some((item) => item.key === key))
          : next.workspaces.map((item) => item.key),
      );
      setSelectedConfigSources((current) => {
        const available = current.filter((key) =>
          next.configSources.some((item) => item.key === key),
        );
        return available.length ? available : preferredSources;
      });
      setSourceMappings((current) =>
        Object.fromEntries(
          Object.entries(current).map(([sourceId, targetId]) => [
            sourceId,
            next.configSources.some((item) => item.key === targetId)
              ? targetId
              : (next.configSources[0]?.key ?? ""),
          ]),
        ),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  async function loadHistory() {
    setHistoryLoading(true);
    setError("");
    try {
      const next = await invoke<ImportTransactionHistory>("list_config_pack_import_history");
      setHistory(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (mode === "history" && !history) {
      void loadHistory();
    }
  }, [history, mode]);

  async function handleExport() {
    if (selectedModuleCount === 0) {
      setError(t("至少选择一个有内容的配置模块。"));
      return;
    }
    const output = await save({
      title: t("导出配置包"),
      defaultPath: `${safeFileName(packName)}.rdtpack`,
      filters: [{ name: "rDevTool Config Pack", extensions: ["rdtpack"] }],
    });
    if (typeof output !== "string") {
      return;
    }
    setBusy("export");
    setError("");
    setStatus("");
    try {
      const result = await invoke<{ outputPath: string; sizeBytes: number }>(
        "export_config_pack_file",
        {
          request: {
            outputPath: output,
            name: packName,
            includeProjects: includeProjects && selectedProjects.length > 0,
            includeWorkspaces: includeWorkspaces && selectedWorkspaces.length > 0,
            includePreferences,
            includeConfigSources: includeConfigSources && selectedConfigSources.length > 0,
            includeDependencies,
            projectKeys: selectedProjects,
            workspaceKeys: selectedWorkspaces,
            configSourceIds: includeConfigSources ? selectedConfigSources : [],
          },
        },
      );
      setStatus(
        t("配置包已导出：{path}", {
          path: result.outputPath,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleChoosePack() {
    const selected = await open({
      title: t("选择配置包"),
      multiple: false,
      directory: false,
      filters: [{ name: "rDevTool Config Pack", extensions: ["rdtpack"] }],
    });
    if (typeof selected !== "string") {
      return;
    }
    setBusy("inspect");
    setError("");
    setStatus("");
    setPlan(null);
    setLastApply(null);
    setSelectedOperationIds([]);
    setOperationSelectionDirty(false);
    setOperationQuery("");
    setOperationModule("all");
    setOperationAction("all");
    setProjectRoots({});
    setWorkspaceRoots({});
    setSourceMappings({});
    try {
      const next = await invoke<PackInspection>("inspect_config_pack_file", {
        path: selected,
      });
      setInspection(next);
      setSourceMappings(
        Object.fromEntries(
          next.configSourceIds.map((sourceId) => [
            sourceId,
            inventory?.configSources.some((item) => item.key === sourceId)
              ? sourceId
              : (inventory?.configSources[0]?.key ?? ""),
          ]),
        ),
      );
      if (next.valid) {
        setStatus(t("配置包校验通过，可以生成导入计划。"));
      } else {
        setError(t("配置包校验未通过，请查看问题后更换配置包。"));
      }
    } catch (reason) {
      setInspection(null);
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handlePlan() {
    if (!inspection || !inspection.valid) {
      return;
    }
    setBusy("plan");
    setError("");
    setStatus("");
    try {
      const next = await invoke<ImportPlan>("plan_config_pack_import_file", {
        request: {
          packPath: inspection.path,
          strategy,
          projectRootMappings: projectRoots,
          workspaceRootMappings: workspaceRoots,
          configSourceMappings: sourceMappings,
          requireSecrets: false,
          includedOperationIds: plan ? selectedOperationIds : null,
        },
      });
      setPlan(next);
      setSelectedOperationIds(
        next.operations.filter((operation) => operation.selected).map((operation) => operation.id),
      );
      setOperationSelectionDirty(false);
      setProjectRoots((current) => ({
        ...Object.fromEntries(
          next.requiredMappings
            .filter((mapping) => mapping.kind === "project")
            .map((mapping) => [mapping.key, mapping.suggestedPath]),
        ),
        ...current,
      }));
      setWorkspaceRoots((current) => ({
        ...Object.fromEntries(
          next.requiredMappings
            .filter((mapping) => mapping.kind === "workspace")
            .map((mapping) => [mapping.key, mapping.suggestedPath]),
        ),
        ...current,
      }));
      setStatus(
        next.blockerCount
          ? t("计划已生成，请补齐路径映射后重新检查。")
          : t("导入计划已就绪，请复核后执行。"),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleApply() {
    if (!plan || plan.blockerCount > 0 || plan.changeCount === 0 || operationSelectionDirty) {
      return;
    }
    const confirmed = await confirm({
      title: t("执行配置导入"),
      description: t("将按已校验计划写入 {count} 项配置，并先创建完整事务备份。", {
        count: plan.changeCount,
      }),
      confirmLabel: t("执行导入"),
      preferenceKey: "configuration.import",
    });
    if (!confirmed) {
      return;
    }
    setBusy("apply");
    setError("");
    try {
      const result = await invoke<ApplyResult>("apply_config_pack_import_plan", {
        planHash: plan.planHash,
      });
      setLastApply(result);
      setStatus(t("配置已导入，可在当前面板回滚本次事务。"));
      await onApplied?.();
      await loadInventory();
      await loadHistory();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function handleRollback(transactionId = lastApply?.transactionId) {
    if (!transactionId) {
      return;
    }
    const confirmed = await confirm({
      title: t("回滚本次配置导入"),
      description: t("仅当相关配置仍保持导入后的状态时执行回滚，避免覆盖后续改动。"),
      confirmLabel: t("回滚"),
      tone: "danger",
      preferenceKey: "configuration.import",
    });
    if (!confirmed) {
      return;
    }
    setBusy("rollback");
    setError("");
    try {
      await invoke("rollback_config_pack_import_transaction", {
        transactionId,
      });
      if (lastApply?.transactionId === transactionId) {
        setLastApply(null);
        setPlan(null);
      }
      setStatus(t("配置导入已回滚。"));
      await onApplied?.();
      await loadInventory();
      await loadHistory();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  function updateOperationSelection(operationIds: string[], selected: boolean) {
    const candidates = new Set(operationIds);
    setSelectedOperationIds((current) => {
      const next = selected
        ? Array.from(new Set([...current, ...operationIds]))
        : current.filter((operationId) => !candidates.has(operationId));
      return next;
    });
    setOperationSelectionDirty(true);
  }

  function renderScopeList(
    items: InventoryItem[],
    selected: string[],
    onChange: (next: string[]) => void,
    disabled: boolean,
  ) {
    return (
      <div className="config-pack-scope-list">
        {items.length ? (
          items.map((item) => (
            <FormControlLabel
              key={item.key}
              className="config-pack-scope-item"
              control={
                <Checkbox
                  size="small"
                  checked={selected.includes(item.key)}
                  onChange={() => onChange(toggleKey(selected, item.key))}
                  disabled={disabled}
                />
              }
              label={
                <span>
                  <strong>{item.name}</strong>
                  <small title={`${item.key} · ${item.detail}`}>
                    {item.key}{item.detail ? ` · ${item.detail}` : ""}
                  </small>
                </span>
              }
            />
          ))
        ) : (
          <Typography variant="caption">{t("暂无可导出项")}</Typography>
        )}
      </div>
    );
  }

  return (
    <Stack className="config-pack-panel" spacing={1.2}>
      <div className="config-pack-mode-bar">
        <Tabs
          value={mode}
          onChange={(_, value: TransferMode) => {
            setMode(value);
            setError("");
            setStatus("");
          }}
          aria-label={t("配置迁移模式")}
        >
          <Tab
            value="export"
            icon={<DownloadIcon fontSize="small" />}
            iconPosition="start"
            label={t("导出")}
          />
          <Tab
            value="import"
            icon={<UploadIcon fontSize="small" />}
            iconPosition="start"
            label={t("导入")}
          />
          <Tab
            value="history"
            icon={<RestoreIcon fontSize="small" />}
            iconPosition="start"
            label={t("历史")}
          />
        </Tabs>
        <div className="config-pack-format-mark">
          <span>.rdtpack</span>
          <code>schema v1</code>
        </div>
      </div>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {status ? <Alert severity="success">{status}</Alert> : null}

      {mode === "export" ? (
      <section className="config-pack-section" aria-labelledby="config-pack-export-title">
        <header className="config-pack-section-head">
          <div>
            <Typography id="config-pack-export-title" variant="subtitle2">
              {t("导出配置包")}
            </Typography>
            <Typography variant="caption">
              {t("按模块和范围生成可审查、可迁移的 .rdtpack 文件。")}
            </Typography>
          </div>
          <Button
            size="small"
            color="inherit"
            startIcon={<RefreshIcon fontSize="small" />}
            onClick={() => void loadInventory()}
            disabled={inventoryLoading || Boolean(busy)}
          >
            {t("刷新范围")}
          </Button>
        </header>

        <div className="config-pack-export-basics">
          <TextField
            label={t("配置包名称")}
            size="small"
            value={packName}
            onChange={(event) => setPackName(event.target.value)}
          />
          <TextField
            select
            size="small"
            label={t("资源配置源（可多选）")}
            value={selectedConfigSources}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedConfigSources(
                Array.isArray(value) ? value : String(value).split(","),
              );
            }}
            disabled={!includeConfigSources}
            SelectProps={{
              multiple: true,
              renderValue: (value) =>
                (value as string[])
                  .map(
                    (key) =>
                      inventory?.configSources.find((source) => source.key === key)?.name ?? key,
                  )
                  .join(", "),
            }}
          >
            {(inventory?.configSources ?? []).map((source) => (
              <MenuItem key={source.key} value={source.key}>
                <Checkbox size="small" checked={selectedConfigSources.includes(source.key)} />
                {source.name} · {source.key}
              </MenuItem>
            ))}
          </TextField>
        </div>

        <div className="config-pack-module-grid">
          <div className={includeProjects ? "config-pack-module-option is-active" : "config-pack-module-option"}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeProjects}
                    onChange={(event) => setIncludeProjects(event.target.checked)}
                  />
                }
                label={t("项目、构建、部署与 Git")}
              />
              <span>{selectedProjects.length}/{inventory?.projects.length ?? 0}</span>
          </div>
          <div className={includeWorkspaces ? "config-pack-module-option is-active" : "config-pack-module-option"}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeWorkspaces}
                    onChange={(event) => setIncludeWorkspaces(event.target.checked)}
                  />
                }
                label={t("工作区与资源范围")}
              />
              <span>{selectedWorkspaces.length}/{inventory?.workspaces.length ?? 0}</span>
          </div>
          <div className={includeConfigSources ? "config-pack-module-option is-active" : "config-pack-module-option"}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeConfigSources}
                    onChange={(event) => setIncludeConfigSources(event.target.checked)}
                  />
                }
                label={t("资源、Action、Link 与代理")}
              />
              <span>{selectedConfigSources.length}/{inventory?.configSources.length ?? 0}</span>
          </div>
          <div className={includePreferences ? "config-pack-module-option is-active" : "config-pack-module-option"}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includePreferences}
                    onChange={(event) => setIncludePreferences(event.target.checked)}
                  />
                }
                label={t("界面偏好（不含当前工作区）")}
              />
              <span>{includePreferences ? 1 : 0}/1</span>
          </div>
        </div>

        <div className="config-pack-scope-grid">
          <div className={includeProjects ? "config-pack-scope-column" : "config-pack-scope-column is-disabled"}>
            <div className="config-pack-scope-head">
              <div>
                <Typography variant="subtitle2">{t("项目范围")}</Typography>
                <Typography variant="caption">
                  {t("{selected}/{total} 已选", {
                    selected: selectedProjects.length,
                    total: inventory?.projects.length ?? 0,
                  })}
                </Typography>
              </div>
              <div className="config-pack-scope-actions">
                <button
                  type="button"
                  onClick={() => setSelectedProjects(inventory?.projects.map((item) => item.key) ?? [])}
                  disabled={!includeProjects}
                >
                  {t("全选")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProjects([])}
                  disabled={!includeProjects || selectedProjects.length === 0}
                >
                  {t("清空")}
                </button>
              </div>
            </div>
            {renderScopeList(
              inventory?.projects ?? [],
              selectedProjects,
              setSelectedProjects,
              !includeProjects,
            )}
          </div>

          <div className={includeWorkspaces ? "config-pack-scope-column" : "config-pack-scope-column is-disabled"}>
            <div className="config-pack-scope-head">
              <div>
                <Typography variant="subtitle2">{t("工作区范围")}</Typography>
                <Typography variant="caption">
                  {t("{selected}/{total} 已选", {
                    selected: selectedWorkspaces.length,
                    total: inventory?.workspaces.length ?? 0,
                  })}
                </Typography>
              </div>
              <div className="config-pack-scope-actions">
                <button
                  type="button"
                  onClick={() => setSelectedWorkspaces(inventory?.workspaces.map((item) => item.key) ?? [])}
                  disabled={!includeWorkspaces}
                >
                  {t("全选")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWorkspaces([])}
                  disabled={!includeWorkspaces || selectedWorkspaces.length === 0}
                >
                  {t("清空")}
                </button>
              </div>
            </div>
            {renderScopeList(
              inventory?.workspaces ?? [],
              selectedWorkspaces,
              setSelectedWorkspaces,
              !includeWorkspaces,
            )}
          </div>
        </div>

        <div className="config-pack-dependency-row">
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeDependencies}
                    onChange={(event) => setIncludeDependencies(event.target.checked)}
                    disabled={!includeWorkspaces || !includeProjects}
                  />
                }
                label={t("自动包含工作区引用的项目")}
              />
        </div>

        <div className="config-pack-action-row">
          <Typography variant="caption">
            {t("已选择 {count} 个配置模块；敏感值不会写入包内。", {
              count: selectedModuleCount,
            })}
          </Typography>
          <Button
            variant="contained"
            startIcon={<DownloadIcon fontSize="small" />}
            onClick={() => void handleExport()}
            disabled={Boolean(busy) || selectedModuleCount === 0}
          >
            {busy === "export" ? t("正在导出") : t("导出")}
          </Button>
        </div>
      </section>
      ) : null}

      {mode === "import" ? (
      <section className="config-pack-section" aria-labelledby="config-pack-import-title">
        <header className="config-pack-section-head">
          <div>
            <Typography id="config-pack-import-title" variant="subtitle2">
              {t("导入配置包")}
            </Typography>
            <Typography variant="caption">
              {t("检查包内容，映射本机路径，生成计划后再执行。")}
            </Typography>
          </div>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<UploadIcon fontSize="small" />}
            onClick={() => void handleChoosePack()}
            disabled={Boolean(busy)}
          >
            {busy === "inspect" ? t("正在检查") : t("选择配置包")}
          </Button>
        </header>

        {inspection ? (
          <>
            <div className="config-pack-file-summary">
              <div className="config-pack-file-copy">
                <div className="config-pack-file-title-row">
                  <Typography variant="subtitle2">{inspection.manifest.name}</Typography>
                  <Chip
                    size="small"
                    color={inspection.valid ? "success" : "error"}
                    variant="outlined"
                    label={t(inspection.valid ? "校验通过" : "校验失败")}
                  />
                </div>
                <Typography variant="caption" title={inspection.path}>
                  {inspection.path}
                </Typography>
                <div className="config-pack-file-meta">
                  <span>{formatFileSize(inspection.sizeBytes)}</span>
                  <span>{formatCreatedAt(inspection.manifest.createdAt)}</span>
                  <code>{shortHash(inspection.sha256)}</code>
                </div>
              </div>
              <Stack className="config-pack-module-chips" direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`v${inspection.manifest.schemaVersion}`} />
                {inspection.manifest.modules.map((module) => (
                  <Chip
                    key={module.key}
                    size="small"
                    variant="outlined"
                    label={`${t(moduleLabels[module.key] ?? module.key)} ${module.itemCount}`}
                  />
                ))}
                {inspection.manifest.security.sensitiveValuesRemoved ? (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={t("已移除 {count} 个敏感值", {
                      count: inspection.manifest.security.sensitiveValuesRemoved,
                    })}
                  />
                ) : null}
              </Stack>
            </div>

            {inspection.issues.length ? (
              <div className="config-pack-issues config-pack-inspection-issues">
                {inspection.issues.map((issue, index) => (
                  <Alert key={`${issue.code}:${issue.path}:${index}`} severity={issue.severity}>
                    {issue.message}
                  </Alert>
                ))}
              </div>
            ) : null}

            <div className="config-pack-plan-controls">
              <TextField
                select
                size="small"
                label={t("冲突策略")}
                value={strategy}
                onChange={(event) => {
                  setStrategy(event.target.value as ConflictStrategy);
                  setPlan(null);
                  setSelectedOperationIds([]);
                  setOperationSelectionDirty(false);
                }}
              >
                <MenuItem value="merge">{t("合并（推荐）")}</MenuItem>
                <MenuItem value="add">{t("仅新增")}</MenuItem>
                <MenuItem value="replace">{t("覆盖冲突项")}</MenuItem>
                <MenuItem value="skip">{t("跳过冲突项")}</MenuItem>
              </TextField>
              {inspection.configSourceIds.length ? (
                <div className="config-pack-source-mappings">
                  {inspection.configSourceIds.map((sourceId) => (
                    <TextField
                      key={sourceId}
                      select
                      size="small"
                      label={t("配置源 {source} 导入到", { source: sourceId })}
                      value={sourceMappings[sourceId] ?? ""}
                      onChange={(event) => {
                        setSourceMappings((current) => ({
                          ...current,
                          [sourceId]: event.target.value,
                        }));
                        setPlan(null);
                        setSelectedOperationIds([]);
                        setOperationSelectionDirty(false);
                      }}
                    >
                      {(inventory?.configSources ?? []).map((source) => (
                        <MenuItem key={source.key} value={source.key}>
                          {source.name} · {source.key}
                        </MenuItem>
                      ))}
                    </TextField>
                  ))}
                </div>
              ) : null}
              <Button
                variant="outlined"
                startIcon={<RefreshIcon fontSize="small" />}
                onClick={() => void handlePlan()}
                disabled={
                  Boolean(busy) ||
                  !inspection.valid ||
                  inspection.configSourceIds.some((sourceId) => !sourceMappings[sourceId])
                }
              >
                {busy === "plan"
                  ? t("正在生成计划")
                  : t(
                      operationSelectionDirty
                        ? "更新导入计划"
                        : plan
                          ? "重新检查计划"
                          : "生成导入计划",
                    )}
              </Button>
            </div>

            {plan?.requiredMappings.length ? (
              <div className="config-pack-mapping-list">
                <div className="config-pack-mapping-head">
                  <FolderIcon fontSize="small" />
                  <div>
                    <Typography variant="subtitle2">{t("本机路径映射")}</Typography>
                    <Typography variant="caption">
                      {t("确认目标目录后重新检查计划；rDevTool 不会自动创建项目仓库。")}
                    </Typography>
                  </div>
                </div>
                {plan.requiredMappings.map((mapping) => {
                  const values = mapping.kind === "project" ? projectRoots : workspaceRoots;
                  const setValues = mapping.kind === "project" ? setProjectRoots : setWorkspaceRoots;
                  return (
                    <TextField
                      key={`${mapping.kind}:${mapping.key}`}
                      size="small"
                      label={`${mapping.kind === "project" ? t("项目") : t("工作区")} · ${mapping.key}`}
                      value={values[mapping.key] ?? ""}
                      onChange={(event) => {
                        setValues((current) => ({
                          ...current,
                          [mapping.key]: event.target.value,
                        }));
                      }}
                      helperText={mapping.placeholder}
                    />
                  );
                })}
              </div>
            ) : null}

            {plan ? (
              <div className="config-pack-plan-summary">
                <div className="config-pack-plan-metrics">
                  <span><strong>{plan.changeCount}</strong>{t("变更")}</span>
                  <span><strong>{plan.skipCount}</strong>{t("跳过")}</span>
                  <span><strong>{plan.excludedCount}</strong>{t("已排除")}</span>
                  <span className={plan.blockerCount ? "is-blocked" : ""}>
                    <strong>{plan.blockerCount}</strong>{t("阻断")}
                  </span>
                  <code>{shortHash(plan.planHash)}</code>
                </div>
                {operationSelectionDirty ? (
                  <Alert severity="warning">
                    {t("操作选择已更改，请更新计划后再执行导入。")}
                  </Alert>
                ) : null}
                {plan.issues.length ? (
                  <div className="config-pack-issues">
                    {plan.issues.slice(0, 8).map((issue, index) => (
                      <Alert key={`${issue.code}:${issue.path}:${index}`} severity={issue.severity}>
                        {issue.message}
                      </Alert>
                    ))}
                  </div>
                ) : null}
                <div className="config-pack-operation-tools">
                  <TextField
                    size="small"
                    placeholder={t("搜索配置项或目标路径")}
                    value={operationQuery}
                    onChange={(event) => setOperationQuery(event.target.value)}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <TextField
                    select
                    size="small"
                    label={t("模块")}
                    value={operationModule}
                    onChange={(event) => setOperationModule(event.target.value)}
                  >
                    <MenuItem value="all">{t("全部模块")}</MenuItem>
                    {operationModules.map((module) => (
                      <MenuItem key={module} value={module}>
                        {t(moduleLabels[module] ?? module)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label={t("操作")}
                    value={operationAction}
                    onChange={(event) => setOperationAction(event.target.value)}
                  >
                    <MenuItem value="all">{t("全部操作")}</MenuItem>
                    {Object.entries(operationActionLabels).map(([action, label]) => (
                      <MenuItem key={action} value={action}>{t(label)}</MenuItem>
                    ))}
                  </TextField>
                  <div className="config-pack-operation-selection-actions">
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() =>
                        updateOperationSelection(
                          filteredOperations
                            .filter((operation) => operation.action !== "skip")
                            .map((operation) => operation.id),
                          true,
                        )
                      }
                    >
                      {t("选择当前结果")}
                    </Button>
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() =>
                        updateOperationSelection(
                          filteredOperations
                            .filter((operation) => operation.action !== "skip")
                            .map((operation) => operation.id),
                          false,
                        )
                      }
                    >
                      {t("排除当前结果")}
                    </Button>
                  </div>
                </div>
                <div className="config-pack-operation-list">
                  <div className="config-pack-operation-head" aria-hidden="true">
                    <span>{t("选择与操作")}</span>
                    <span>{t("模块")}</span>
                    <span>{t("配置项")}</span>
                    <span>{t("目标")}</span>
                  </div>
                  {filteredOperations.map((operation) => (
                    <div
                      className={`config-pack-operation-row${selectedOperationIds.includes(operation.id) ? "" : " is-excluded"}`}
                      key={operation.id}
                    >
                      <div className="config-pack-operation-action">
                        <Checkbox
                          size="small"
                          checked={selectedOperationIds.includes(operation.id)}
                          disabled={operation.action === "skip"}
                          onChange={(event) =>
                            updateOperationSelection([operation.id], event.target.checked)
                          }
                          inputProps={{
                            "aria-label": t("选择配置项 {key}", { key: operation.key }),
                          }}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          color={
                            operation.action === "add"
                              ? "success"
                              : operation.action === "replace"
                                ? "warning"
                                : operation.action === "merge"
                                  ? "info"
                                  : "default"
                          }
                          label={t(operationActionLabels[operation.action])}
                        />
                      </div>
                      <span>{t(moduleLabels[operation.module] ?? operation.module)}</span>
                      <strong>{operation.key}</strong>
                      <small title={operation.target}>{operation.target}</small>
                    </div>
                  ))}
                  {!filteredOperations.length ? (
                    <Typography className="config-pack-operation-empty" variant="caption">
                      {t("没有符合当前筛选条件的配置项。")}
                    </Typography>
                  ) : null}
                </div>
                <div className="config-pack-action-row config-pack-action-row--apply">
                  <Typography variant="caption">
                    {plan.blockerCount
                      ? t("解决阻断项并重新检查后才能执行。")
                      : t("执行前会再次校验配置状态与包校验和。")}
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<UploadIcon fontSize="small" />}
                    onClick={() => void handleApply()}
                    disabled={
                      Boolean(busy) ||
                      plan.blockerCount > 0 ||
                      plan.changeCount === 0 ||
                      operationSelectionDirty
                    }
                  >
                    {busy === "apply" ? t("正在导入") : t("执行导入")}
                  </Button>
                </div>
              </div>
            ) : null}

            {lastApply ? (
              <Alert
                severity="success"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<RestoreIcon fontSize="small" />}
                    onClick={() => void handleRollback()}
                    disabled={Boolean(busy)}
                  >
                    {busy === "rollback" ? t("正在回滚") : t("回滚本次导入")}
                  </Button>
                }
              >
                {t("事务 {id} 已完成，备份保存在 {path}", {
                  id: lastApply.transactionId,
                  path: lastApply.backupDir,
                })}
              </Alert>
            ) : null}
          </>
        ) : (
          <div className="config-pack-empty">
            <UploadIcon />
            <Typography variant="subtitle2">{t("尚未选择配置包")}</Typography>
            <Typography variant="caption">
              {t("支持 rDevTool .rdtpack；选择后先校验，不会立即写入配置。")}
            </Typography>
          </div>
        )}
      </section>
      ) : null}

      {mode === "history" ? (
        <section className="config-pack-section" aria-labelledby="config-pack-history-title">
          <header className="config-pack-section-head">
            <div>
              <Typography id="config-pack-history-title" variant="subtitle2">
                {t("迁移历史")}
              </Typography>
              <Typography variant="caption">
                {t("查看已执行的配置导入事务，并在配置未发生后续变化时安全回滚。")}
              </Typography>
            </div>
            <Button
              size="small"
              color="inherit"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => void loadHistory()}
              disabled={historyLoading || Boolean(busy)}
            >
              {historyLoading ? t("正在刷新") : t("刷新历史")}
            </Button>
          </header>

          {history?.issues.length ? (
            <div className="config-pack-issues config-pack-history-issues">
              {history.issues.map((issue) => (
                <Alert key={issue} severity="warning">{issue}</Alert>
              ))}
            </div>
          ) : null}

          {history?.transactions.length ? (
            <div className="config-pack-history-list">
              {history.transactions.map((transaction) => (
                <article className="config-pack-history-row" key={transaction.transactionId}>
                  <div className="config-pack-history-main">
                    <div className="config-pack-history-title-row">
                      <Typography variant="subtitle2">
                        {transaction.packName || t("未命名配置包")}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={transaction.canRollback ? "success" : "default"}
                        label={t(transaction.canRollback ? "可回滚" : "已回滚")}
                      />
                    </div>
                    <Typography variant="caption" title={transaction.packPath}>
                      {transaction.packPath || transaction.transactionId}
                    </Typography>
                    <div className="config-pack-history-meta">
                      <span>{formatCreatedAt(transaction.createdAt)}</span>
                      <code>{shortHash(transaction.planHash)}</code>
                      <span>{t("{count} 个文件", { count: transaction.changedPaths.length })}</span>
                    </div>
                  </div>
                  <div className="config-pack-history-result">
                    <span><strong>{transaction.appliedCount}</strong>{t("已应用")}</span>
                    <span><strong>{transaction.skippedCount}</strong>{t("未应用")}</span>
                  </div>
                  <Button
                    size="small"
                    color="inherit"
                    variant="outlined"
                    startIcon={<RestoreIcon fontSize="small" />}
                    onClick={() => void handleRollback(transaction.transactionId)}
                    disabled={!transaction.canRollback || Boolean(busy)}
                  >
                    {busy === "rollback" ? t("正在回滚") : t("回滚")}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="config-pack-empty">
              <RestoreIcon />
              <Typography variant="subtitle2">
                {historyLoading ? t("正在读取迁移历史") : t("暂无迁移历史")}
              </Typography>
              <Typography variant="caption">
                {t("执行配置导入后，事务记录和回滚状态会显示在这里。")}
              </Typography>
            </div>
          )}
        </section>
      ) : null}
      {confirmDialog}
    </Stack>
  );
}
