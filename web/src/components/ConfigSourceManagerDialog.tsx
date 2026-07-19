import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  ConfigSource,
  ConfigSourceComparison,
  ConfigSourceCopyRequest,
  ConfigSourceCopyResult,
  ConfigSourceDefinition,
  ConfigSourceInspection,
} from "../app-types";
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  FolderIcon,
  OpenExternalIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  TrashIcon,
} from "./AppIcons";
import { useAppConfirmDialog } from "./AppConfirmDialog";
import { AppToast } from "./AppToast";
import { ConfigDialogShell } from "./ConfigDialogShell";
import { useConfigSource } from "../hooks/useConfigSource";
import { configSourceKindLabel } from "../lib/configSources";
import { UI_PROFILES, uiProfileDefinition } from "../lib/uiProfiles";

const CAPABILITIES = [
  { key: "resource", label: "资源入口" },
  { key: "link", label: "链路" },
  { key: "proxy", label: "代理" },
  { key: "runtime", label: "运行配置" },
] as const;

const FILE_FIELDS = [
  { key: "navigation", label: "资源入口", fallback: "navigation.toml" },
  { key: "links", label: "链路", fallback: "links.toml" },
  { key: "proxy", label: "代理", fallback: "proxy.toml" },
  {
    key: "runtimeOverrides",
    label: "运行配置覆盖",
    fallback: "runtime_overrides.toml",
  },
] as const;

type ConfigSourceManagerDialogProps = {
  open: boolean;
  initialSourceId?: string;
  compareOnOpen?: boolean;
  onClose: () => void;
  onChanged?: (sources: ConfigSource[], selectedSourceId: string) => void | Promise<void>;
};

type ConfigSourceCopyDraft = Omit<ConfigSourceCopyRequest, "sourceId">;

function runtimeScopeLabel(scope: string) {
  if (scope === "global") return "全局配置";
  if (scope === "override") return "当前源覆盖";
  if (scope === "inherited") return "继承全局";
  if (scope === "unsupported") return "未启用";
  return scope;
}

function healthLabel(status: string) {
  if (status === "ready") return "可用";
  if (status === "empty") return "待初始化";
  if (status === "invalid") return "需修复";
  if (status === "missing") return "未创建";
  if (status === "unsupported") return "未启用";
  return status;
}

function nextSourceId(sources: ConfigSource[]) {
  const existing = new Set(sources.map((source) => source.id));
  let index = 1;
  while (existing.has(`custom-${index}`)) index += 1;
  return `custom-${index}`;
}

function emptyDefinition(sources: ConfigSource[]): ConfigSourceDefinition {
  return {
    id: nextSourceId(sources),
    name: "新配置源",
    kind: "custom",
    baseDir: "",
    uiProfile: "resource-basic",
    capabilities: CAPABILITIES.map((item) => item.key),
    files: Object.fromEntries(
      FILE_FIELDS.map((item) => [item.key, item.fallback]),
    ) as ConfigSourceDefinition["files"],
  };
}

function nextCopiedSourceId(source: ConfigSource, sources: ConfigSource[]) {
  const existing = new Set(sources.map((item) => item.id));
  const base = `${source.id}-copy`;
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function definitionFromInspection(inspection: ConfigSourceInspection): ConfigSourceDefinition {
  const definition = inspection.definition;
  return {
    id: definition?.id ?? inspection.source.id,
    name: definition?.name ?? inspection.source.name,
    kind: "custom",
    baseDir: definition?.baseDir ?? inspection.source.baseDir,
    uiProfile: definition?.uiProfile ?? inspection.source.uiProfile ?? "resource-basic",
    capabilities: [...(definition?.capabilities ?? inspection.source.capabilities)],
    files: Object.fromEntries(
      FILE_FIELDS.map((item) => [
        item.key,
        definition?.files?.[item.key] ?? item.fallback,
      ]),
    ) as ConfigSourceDefinition["files"],
  };
}

export function ConfigSourceManagerDialog({
  open,
  initialSourceId,
  compareOnOpen = false,
  onClose,
  onChanged,
}: ConfigSourceManagerDialogProps) {
  const {
    sources,
    selectedSource,
    selectedSourceId,
    loadingSources,
    sourceError,
    externalRevision,
    lastExternalChange,
    refreshSources,
    selectSource: setSelectedConfigSource,
  } = useConfigSource({ initialSourceId });
  const [inspection, setInspection] = useState<ConfigSourceInspection | null>(null);
  const [draft, setDraft] = useState<ConfigSourceDefinition | null>(null);
  const [copyDraft, setCopyDraft] = useState<ConfigSourceCopyDraft | null>(null);
  const [mode, setMode] = useState<"view" | "create" | "edit" | "copy">("view");
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState("");
  const [comparison, setComparison] = useState<ConfigSourceComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatusValue] = useState("");
  const [toastNonce, setToastNonce] = useState(0);
  const internalWriteRefreshUntilRef = useRef(0);
  const [confirm, confirmDialog] = useAppConfirmDialog();

  const loading = loadingSources || inspectionLoading;

  function setStatus(value: string) {
    setStatusValue(value);
    if (value) {
      setToastNonce((current) => current + 1);
    }
  }

  async function loadInspection(sourceId: string) {
    setInspectionLoading(true);
    setError("");
    try {
      const nextInspection = await invoke<ConfigSourceInspection>("inspect_config_source", {
        sourceId,
      });
      setInspection(nextInspection);
      return true;
    } catch (reason) {
      setInspection(null);
      setError(String(reason));
      return false;
    } finally {
      setInspectionLoading(false);
    }
  }

  async function loadSources(
    preferredSourceId = initialSourceId ?? selectedSourceId,
    options: { compareAfterLoad?: boolean } = {},
  ) {
    setError("");
    try {
      const result = await refreshSources(preferredSourceId);
      if (!result) return null;
      setMode("view");
      setDraft(null);
      setCopyDraft(null);
      setComparison(null);
      await loadInspection(result.sourceId);
      if (options.compareAfterLoad) {
        const targetSource =
          result.sources.find(
            (source) => source.isDefault && source.id !== result.sourceId,
          ) ?? result.sources.find((source) => source.id !== result.sourceId);
        setCompareTargetId(targetSource?.id ?? "");
        if (targetSource) {
          await compareSourceIds(result.sourceId, targetSource.id);
        }
      }
      return { sources: result.sources, sourceId: result.sourceId };
    } catch (reason) {
      setError(String(reason));
      return null;
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadSources(initialSourceId ?? "default", {
      compareAfterLoad: compareOnOpen,
    });
  }, [compareOnOpen, open, initialSourceId]);

  async function selectSource(sourceId: string) {
    if (saving || sourceId === selectedSourceId) return;
    setStatus("");
    try {
      const source = await setSelectedConfigSource(sourceId);
      if (!source) return;
      setMode("view");
      setDraft(null);
      setCopyDraft(null);
      setComparison(null);
      await loadInspection(source.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function updateDraft(patch: Partial<ConfigSourceDefinition>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateDraftFile(key: keyof ConfigSourceDefinition["files"], value: string) {
    setDraft((current) =>
      current
        ? { ...current, files: { ...current.files, [key]: value } }
        : current,
    );
  }

  function updateCapability(capability: string, enabled: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const capabilities = enabled
        ? [...new Set([...current.capabilities, capability])]
        : current.capabilities.filter((item) => item !== capability);
      return { ...current, capabilities };
    });
  }

  async function chooseBaseDirectory() {
    const selected = await openDialog({ directory: true, multiple: false, title: "选择配置源目录" });
    if (typeof selected === "string") updateDraft({ baseDir: selected });
  }

  async function chooseCopyBaseDirectory() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "选择副本目录",
    });
    if (typeof selected === "string") {
      setCopyDraft((current) => (current ? { ...current, baseDir: selected } : current));
    }
  }

  function beginCopy(source: ConfigSource) {
    setMode("copy");
    setDraft(null);
    setComparison(null);
    setCopyDraft({
      id: nextCopiedSourceId(source, sources),
      name: `${source.name} 副本`,
      baseDir: "",
    });
    setError("");
    setStatus("");
  }

  async function copySource() {
    if (!inspection || !copyDraft) return;
    if (!copyDraft.id.trim() || !copyDraft.name.trim()) {
      setError("副本 ID 和名称不能为空");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    internalWriteRefreshUntilRef.current = Date.now() + 1200;
    try {
      const result = await invoke<ConfigSourceCopyResult>("copy_config_source", {
        request: {
          sourceId: inspection.source.id,
          id: copyDraft.id.trim(),
          name: copyDraft.name.trim(),
          baseDir: copyDraft.baseDir?.trim() || null,
        } satisfies ConfigSourceCopyRequest,
      });
      const refreshed = await loadSources(result.target.id);
      if (refreshed) {
        await onChanged?.(refreshed.sources, refreshed.sourceId);
        setStatus(
          `已创建“${result.target.name}”，复制 ${result.copiedCount} 个文件${
            result.missingCount > 0 ? `，${result.missingCount} 个源文件缺失` : ""
          }`,
        );
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function compareSourceIds(leftSourceId: string, rightSourceId: string) {
    if (!leftSourceId || !rightSourceId || leftSourceId === rightSourceId) return;
    setComparing(true);
    setError("");
    setStatus("");
    try {
      const result = await invoke<ConfigSourceComparison>("compare_config_sources", {
        leftSourceId,
        rightSourceId,
      });
      setComparison(result);
      setStatus(
        result.identical
          ? `“${result.left.name}”与“${result.right.name}”完全一致`
          : `比较完成：${result.summary.differing} 项不同，${result.summary.matching} 项一致`,
      );
    } catch (reason) {
      setComparison(null);
      setError(String(reason));
    } finally {
      setComparing(false);
    }
  }

  async function compareSource() {
    if (!inspection) return;
    await compareSourceIds(inspection.source.id, compareTargetId);
  }

  async function saveDefinition() {
    if (!draft) return;
    if (!draft.id.trim() || !draft.name.trim()) {
      setError("配置源 ID 和名称不能为空");
      return;
    }
    if (draft.capabilities.length === 0) {
      setError("至少启用一种配置能力");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    internalWriteRefreshUntilRef.current = Date.now() + 1200;
    try {
      const nextInspection = await invoke<ConfigSourceInspection>("save_config_source", {
        definition: draft,
      });
      const result = await loadSources(nextInspection.source.id);
      if (result) {
        await onChanged?.(result.sources, result.sourceId);
        setStatus(`已保存配置源“${nextInspection.source.name}”`);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSource() {
    if (!inspection?.editable) return;
    const accepted = await confirm({
      title: "移除配置源？",
      description: `将移除“${inspection.source.name}”的注册记录，已有配置文件会保留。`,
      confirmLabel: "移除",
      tone: "danger",
    });
    if (!accepted) return;
    setSaving(true);
    setError("");
    setStatus("");
    internalWriteRefreshUntilRef.current = Date.now() + 1200;
    try {
      await invoke("delete_config_source", { sourceId: inspection.source.id });
      const result = await loadSources("default");
      if (result) {
        await onChanged?.(result.sources, result.sourceId);
        setStatus(`已移除配置源“${inspection.source.name}”`);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function openPath(path?: string | null, fallback?: string) {
    const target = path?.trim() || fallback?.trim();
    if (!target) return;
    try {
      await invoke("open_local_path", { path: target });
    } catch (reason) {
      setError(String(reason));
    }
  }

  useEffect(() => {
    if (
      !open ||
      externalRevision === 0 ||
      Date.now() < internalWriteRefreshUntilRef.current
    ) {
      return;
    }
    setComparison(null);
    void loadInspection(selectedSourceId).then((loaded) => {
      if (loaded) {
        setStatus(
          lastExternalChange?.catalogChanged
            ? "配置源列表已在外部更新"
            : "当前配置源文件已在外部更新",
        );
      }
    });
  }, [externalRevision]);

  const renderEditor = () => {
    if (mode === "copy") {
      if (!copyDraft || !inspection) return null;
      return (
        <Box className="config-source-manager-editor config-source-copy-editor">
          <Stack className="config-source-manager-section-head" direction="row" alignItems="center">
            <Box minWidth={0} flex={1}>
              <Typography variant="subtitle2">复制配置源</Typography>
              <Typography variant="caption" color="text.secondary">
                从“{inspection.source.name}”创建独立副本
              </Typography>
            </Box>
          </Stack>
          <Box className="config-source-manager-form">
            <div className="config-source-manager-form-grid">
              <TextField
                size="small"
                label="副本 ID"
                value={copyDraft.id}
                onChange={(event) =>
                  setCopyDraft((current) =>
                    current ? { ...current, id: event.target.value } : current,
                  )
                }
                helperText="保存后不可修改"
              />
              <TextField
                size="small"
                label="副本名称"
                value={copyDraft.name}
                onChange={(event) =>
                  setCopyDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </div>
            <div className="config-source-manager-path-field">
              <TextField
                fullWidth
                size="small"
                label="副本目录"
                value={copyDraft.baseDir ?? ""}
                onChange={(event) =>
                  setCopyDraft((current) =>
                    current ? { ...current, baseDir: event.target.value } : current,
                  )
                }
                helperText="留空时自动创建独立目录；已有非空目录不会被覆盖"
              />
              <Tooltip title="选择目录">
                <IconButton onClick={() => void chooseCopyBaseDirectory()} aria-label="选择副本目录">
                  <FolderIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
            <Alert severity="info">
              将复制该来源已启用的配置文件；缺失文件保持缺失，不会修改原配置源。
            </Alert>
          </Box>
        </Box>
      );
    }
    if (!draft) return null;
    return (
      <Box className="config-source-manager-editor">
        <Stack className="config-source-manager-section-head" direction="row" alignItems="center">
          <Box minWidth={0} flex={1}>
            <Typography variant="subtitle2">
              {mode === "create" ? "新增配置源" : "编辑配置源"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              绑定独立目录、文件映射和可用能力
            </Typography>
          </Box>
        </Stack>
        <Box className="config-source-manager-form">
          <div className="config-source-manager-form-grid">
            <TextField
              size="small"
              label="配置源 ID"
              value={draft.id}
              onChange={(event) => updateDraft({ id: event.target.value })}
              disabled={mode === "edit"}
              helperText="保存后 ID 不可修改"
            />
            <TextField
              size="small"
              label="名称"
              value={draft.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
          </div>
          <div className="config-source-manager-path-field">
            <TextField
              fullWidth
              size="small"
              label="基础目录"
              value={draft.baseDir ?? ""}
              onChange={(event) => updateDraft({ baseDir: event.target.value })}
              helperText="留空时由 rDevTool 在配置目录下自动创建"
            />
            <Tooltip title="选择目录">
              <IconButton onClick={() => void chooseBaseDirectory()} aria-label="选择配置源目录">
                <FolderIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </div>
          <TextField
            select
            size="small"
            label="界面配置"
            value={draft.uiProfile ?? "resource-basic"}
            onChange={(event) => updateDraft({ uiProfile: event.target.value })}
            helperText={
              uiProfileDefinition(draft.uiProfile)?.description ?? "选择内置界面配置"
            }
          >
            {UI_PROFILES.map((profile) => (
              <MenuItem key={profile.id} value={profile.id}>
                {profile.label} · {profile.id}
              </MenuItem>
            ))}
          </TextField>
          <div className="config-source-manager-fieldset">
            <Typography variant="caption">能力范围</Typography>
            <div className="config-source-manager-capabilities">
              {CAPABILITIES.map((item) => (
                <FormControlLabel
                  key={item.key}
                  control={
                    <Checkbox
                      size="small"
                      checked={draft.capabilities.includes(item.key)}
                      onChange={(event) => updateCapability(item.key, event.target.checked)}
                    />
                  }
                  label={item.label}
                />
              ))}
            </div>
          </div>
          <div className="config-source-manager-fieldset">
            <Typography variant="caption">文件映射</Typography>
            <div className="config-source-manager-file-grid">
              {FILE_FIELDS.map((item) => (
                <TextField
                  key={item.key}
                  size="small"
                  label={item.label}
                  value={draft.files[item.key] ?? ""}
                  placeholder={item.fallback}
                  onChange={(event) => updateDraftFile(item.key, event.target.value)}
                  helperText="可使用相对基础目录的路径"
                />
              ))}
            </div>
          </div>
        </Box>
      </Box>
    );
  };

  const renderInspection = () => {
    if (loading && !inspection) {
      return (
        <Box className="config-source-manager-loading">
          <CircularProgress size={24} />
        </Box>
      );
    }
    if (!inspection) return null;
    return (
      <Box className="config-source-manager-inspection">
        <Stack className="config-source-manager-section-head" direction="row" alignItems="center">
          <Box minWidth={0} flex={1}>
            <Stack direction="row" spacing={0.65} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle2">{inspection.source.name}</Typography>
              <Chip
                size="small"
                label={configSourceKindLabel(inspection.source.kind)}
                variant="outlined"
              />
              <Chip
                size="small"
                label={healthLabel(inspection.status)}
                className={`config-source-health is-${inspection.status}`}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {inspection.summary}
            </Typography>
          </Box>
          {inspection.editable ? (
            <Stack direction="row" spacing={0.35}>
              <Tooltip title="编辑配置源">
                <IconButton
                  aria-label="编辑配置源"
                  onClick={() => {
                    setDraft(definitionFromInspection(inspection));
                    setMode("edit");
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="移除配置源">
                <IconButton aria-label="移除配置源" color="error" onClick={() => void deleteSource()}>
                  <TrashIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : null}
        </Stack>

        {inspection.issues.length ? (
          <Alert severity="error">{inspection.issues.join("；")}</Alert>
        ) : null}

        <div className="config-source-manager-summary-grid">
          <div>
            <Typography variant="caption">基础目录</Typography>
            <Typography variant="body2" noWrap title={inspection.source.baseDir}>
              {inspection.source.baseDir}
            </Typography>
          </div>
          <div>
            <Typography variant="caption">运行配置</Typography>
            <Typography variant="body2">
              {runtimeScopeLabel(inspection.runtimeProfileScope)}
            </Typography>
          </div>
        </div>

        <div className="config-source-manager-capability-row">
          {CAPABILITIES.map((item) => (
            <Chip
              key={item.key}
              size="small"
              label={item.label}
              variant={inspection.source.capabilities.includes(item.key) ? "filled" : "outlined"}
              disabled={!inspection.source.capabilities.includes(item.key)}
            />
          ))}
        </div>

        <div className="config-source-manager-compare-tools">
          <TextField
            select
            size="small"
            label="对比配置源"
            value={compareTargetId}
            onChange={(event) => {
              setCompareTargetId(event.target.value);
              setComparison(null);
            }}
          >
            {sources
              .filter((source) => source.id !== inspection.source.id)
              .map((source) => (
                <MenuItem key={source.id} value={source.id}>
                  {source.name}
                </MenuItem>
              ))}
          </TextField>
          <Button
            variant="outlined"
            onClick={() => void compareSource()}
            disabled={!compareTargetId || comparing || saving}
          >
            {comparing ? "比较中" : "比较"}
          </Button>
          <Button
            variant="outlined"
            startIcon={<CopyIcon fontSize="small" />}
            onClick={() => beginCopy(inspection.source)}
            disabled={saving}
          >
            复制
          </Button>
        </div>

        {comparison ? (
          <div className="config-source-comparison">
            <Stack direction="row" spacing={0.65} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle2">
                对比 {comparison.right.name}
              </Typography>
              <Chip
                size="small"
                color={comparison.identical ? "success" : "warning"}
                label={comparison.identical ? "完全一致" : `${comparison.summary.differing} 项不同`}
              />
              <Chip size="small" variant="outlined" label={`${comparison.summary.matching} 项一致`} />
            </Stack>
            <div className="config-source-comparison-files">
              {comparison.files.map((file) => (
                <div key={file.key} className={file.equivalent ? "is-equal" : "is-different"}>
                  <span>{FILE_FIELDS.find((item) => item.key === file.key)?.label ?? file.key}</span>
                  <small>{file.summary}</small>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={file.equivalent ? "一致" : "不同"}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="config-source-manager-files">
          {inspection.files.map((file) => (
            <div key={file.key} className={`config-source-manager-file is-${file.status}`}>
              <div className="config-source-manager-file-icon">
                <FolderIcon fontSize="small" />
              </div>
              <div className="config-source-manager-file-main">
                <Stack direction="row" spacing={0.65} alignItems="center">
                  <Typography variant="body2">{file.label}</Typography>
                  <Chip size="small" label={healthLabel(file.status)} variant="outlined" />
                </Stack>
                <Typography variant="caption" noWrap title={file.path ?? ""}>
                  {file.path ?? "未配置路径"}
                </Typography>
                <Typography variant="caption" className="config-source-manager-file-message">
                  {file.message}
                </Typography>
              </div>
              {file.supported ? (
                <Tooltip title={file.exists ? "打开文件" : "打开目录"}>
                  <IconButton
                    aria-label={file.exists ? `打开${file.label}文件` : `打开${file.label}目录`}
                    onClick={() => void openPath(file.exists ? file.path : null, inspection.source.baseDir)}
                  >
                    <OpenExternalIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
            </div>
          ))}
        </div>

        {!inspection.editable ? (
          <Alert severity="info">
            {inspection.source.isDefault
              ? "默认配置由应用维护。"
              : "工作区配置源随工作区自动生成，请在工作区设置中调整归属。"}
          </Alert>
        ) : null}
      </Box>
    );
  };

  function handleClose() {
    if (!saving) onClose();
  }

  return (
    <>
      <AppToast
        message={error || sourceError || status}
        severity={error || sourceError ? "error" : "success"}
        autoHideDuration={error || sourceError ? 5200 : 3200}
        nonce={toastNonce}
      />
      <ConfigDialogShell
        open={open}
        onClose={handleClose}
        maxWidth="lg"
        className="config-source-manager-dialog"
        paperClassName="config-source-manager-paper"
        titleClassName="config-source-manager-title"
        titleIconClassName="config-source-manager-title-icon"
        contentClassName="config-source-manager-content"
        actionsClassName="config-source-manager-actions"
        title="配置源管理"
        subtitle="统一管理配置范围、文件位置和继承状态"
        titleIcon={<SettingsIcon fontSize="small" />}
        dirty={mode !== "view"}
        dirtyLabel="编辑中"
        closeDisabled={saving}
        headerActions={
            <Tooltip title="重新检查">
              <span>
                <IconButton
                  aria-label="重新检查配置源"
                  onClick={() =>
                    void loadSources(selectedSourceId).then((result) => {
                      if (result) {
                        setStatus("配置源状态已刷新");
                      }
                    })
                  }
                  disabled={loading || saving}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
        }
        actions={(requestClose) => (
          <>
            <Typography variant="caption" noWrap title={inspection?.registryPath ?? ""}>
              {inspection?.registryPath ?? selectedSource?.baseDir ?? ""}
            </Typography>
            <span className="config-source-manager-actions-spacer" />
            {mode !== "view" ? (
              <>
                <Button
                  color="inherit"
                  onClick={() => {
                  setMode("view");
                  setDraft(null);
                  setCopyDraft(null);
                  setError("");
                  }}
                  disabled={saving}
                >
                  取消编辑
                </Button>
                <Button
                  variant="contained"
                  startIcon={<CheckIcon fontSize="small" />}
                  onClick={() => void (mode === "copy" ? copySource() : saveDefinition())}
                  disabled={saving}
                >
                  {mode === "copy" ? "创建副本" : "保存配置源"}
                </Button>
              </>
            ) : (
              <Button onClick={requestClose}>关闭</Button>
            )}
          </>
        )}
      >
          {error || sourceError ? <Alert severity="error">{error || sourceError}</Alert> : null}
          <div className="config-source-manager-layout">
            <aside className="config-source-manager-sidebar">
              <Stack direction="row" alignItems="center" className="config-source-manager-sidebar-head">
                <Box flex={1} minWidth={0}>
                  <Typography variant="subtitle2">配置源</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {sources.length} 个
                  </Typography>
                </Box>
                <Tooltip title="新增配置源">
                  <IconButton
                    aria-label="新增配置源"
                    onClick={() => {
                      setDraft(emptyDefinition(sources));
                      setCopyDraft(null);
                      setMode("create");
                      setError("");
                    }}
                  >
                    <PlusIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <div className="config-source-manager-list">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className={source.id === selectedSourceId && mode === "view" ? "is-active" : ""}
                    onClick={() => void selectSource(source.id)}
                  >
                    <span className="config-source-manager-list-icon">
                      <SettingsIcon fontSize="small" />
                    </span>
                    <span className="config-source-manager-list-main">
                      <strong>{source.name}</strong>
                      <small>{source.id}</small>
                    </span>
                    <span className="config-source-manager-list-kind">
                      {configSourceKindLabel(source.kind)}
                    </span>
                  </button>
                ))}
              </div>
            </aside>
            <section className="config-source-manager-detail">
              {mode === "view" ? renderInspection() : renderEditor()}
            </section>
          </div>
      </ConfigDialogShell>
      {confirmDialog}
    </>
  );
}
