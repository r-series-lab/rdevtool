import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type { PageKey } from "../app-shell";
import type {
  DeployParamConfigKind,
  DeployParamConfigSummary,
  DeployTargetConfigSummary,
  ProjectCommandConfigDraft,
  ProjectConfigDraft,
  ProjectConfigEditorState,
} from "../app-types";
import type { AppStyleMode } from "../theme";
import {
  CheckIcon,
  ClearIcon,
  CopyIcon,
  FolderIcon,
  OpenExternalIcon,
  RefreshIcon,
  TrashIcon,
} from "./AppIcons";

type SettingsSection = "general" | "projects" | "finder" | "branch" | "deploy";

type SettingsPanelProps = {
  styleMode: AppStyleMode;
  onStyleModeChange: (mode: AppStyleMode) => void;
  selectedProjectKey: string;
  onOpenConfigDir: () => void;
  onOpenConfigFile: () => void;
  onOpenNavigationConfigFile: () => void;
  activePage: PageKey;
  onProjectConfigSaved: () => Promise<void> | void;
  onClose: () => void;
};

const SECTION_ITEMS: Array<{ key: SettingsSection; label: string }> = [
  { key: "general", label: "全局" },
  { key: "projects", label: "项目" },
  { key: "finder", label: "访达" },
  { key: "branch", label: "分支" },
  { key: "deploy", label: "部署" },
];

const DEPLOY_PARAM_KIND_OPTIONS: Array<{ value: DeployParamConfigKind; label: string }> = [
  { value: "text", label: "文本" },
  { value: "select", label: "选项" },
  { value: "branch", label: "分支" },
  { value: "boolean", label: "布尔" },
  { value: "hidden", label: "隐藏" },
];

function commandValue(command: ProjectCommandConfigDraft | undefined) {
  return command ?? { command: "", cwd: null, outputDir: null, envCount: 0 };
}

function uniqueConfigKey(prefix: string, existingKeys: string[]) {
  const existing = new Set(existingKeys);
  let index = existing.size + 1;
  let key = `${prefix}-${index}`;
  while (existing.has(key)) {
    index += 1;
    key = `${prefix}-${index}`;
  }
  return key;
}

function uniqueCopiedConfigKey(sourceKey: string, existingKeys: string[]) {
  const existing = new Set(existingKeys);
  const normalizedSource = sourceKey.trim().replace(/\s+/g, "-") || "deploy";
  const baseKey = `${normalizedSource}-copy`;
  if (!existing.has(baseKey)) {
    return baseKey;
  }
  let index = 2;
  let key = `${baseKey}-${index}`;
  while (existing.has(key)) {
    index += 1;
    key = `${baseKey}-${index}`;
  }
  return key;
}

function parseParamOptions(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseKeywordList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sectionForPage(page: PageKey): SettingsSection {
  if (page === "deploy") {
    return "deploy";
  }
  if (page === "merge") {
    return "branch";
  }
  if (page === "projects") {
    return "finder";
  }
  return "general";
}

export function SettingsPanel({
  styleMode,
  onStyleModeChange,
  selectedProjectKey,
  onOpenConfigDir,
  onOpenConfigFile,
  onOpenNavigationConfigFile,
  activePage,
  onProjectConfigSaved,
  onClose,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(() =>
    sectionForPage(activePage),
  );
  const [editorState, setEditorState] = useState<ProjectConfigEditorState | null>(null);
  const [selectedKey, setSelectedKey] = useState(selectedProjectKey);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [dirtyDeployProjectKeys, setDirtyDeployProjectKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedDeployTargetIndex, setSelectedDeployTargetIndex] = useState(0);
  const [newProjectKey, setNewProjectKey] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const selectedProject = useMemo(
    () => editorState?.projects.find((project) => project.key === selectedKey) ?? null,
    [editorState, selectedKey],
  );
  const jenkinsProfileOptions = editorState?.jenkinsProfiles ?? [];
  const hasDirtySelectedProject = Boolean(selectedProject && dirtyKeys.has(selectedProject.key));
  const hasDirtySelectedDeployProject = Boolean(
    selectedProject && dirtyDeployProjectKeys.has(selectedProject.key),
  );
  const hasUnsavedChanges = dirtyKeys.size > 0 || dirtyDeployProjectKeys.size > 0;

  async function loadProjectConfig(preferredKey = selectedKey || selectedProjectKey) {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("get_project_config_editor");
      setEditorState(nextState);
      setDirtyKeys(new Set());
      setDirtyDeployProjectKeys(new Set());
      const preferred =
        (preferredKey && nextState.projects.find((project) => project.key === preferredKey)?.key) ||
        (selectedProjectKey &&
          nextState.projects.find((project) => project.key === selectedProjectKey)?.key) ||
        nextState.projects[0]?.key ||
        "";
      setSelectedKey(preferred);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjectConfig();
  }, []);

  useEffect(() => {
    if (!editorState || selectedKey) {
      return;
    }
    setSelectedKey(selectedProjectKey || editorState.projects[0]?.key || "");
  }, [editorState, selectedKey, selectedProjectKey]);

  useEffect(() => {
    setSelectedDeployTargetIndex(0);
  }, [selectedProject?.key]);

  useEffect(() => {
    const targetCount = selectedProject?.deployTargets.length ?? 0;
    if (targetCount === 0) {
      setSelectedDeployTargetIndex(0);
      return;
    }
    setSelectedDeployTargetIndex((current) =>
      Math.min(Math.max(current, 0), targetCount - 1),
    );
  }, [selectedProject?.deployTargets.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, onClose]);

  function requestClose() {
    if (hasUnsavedChanges && !window.confirm("有未保存的配置修改，确定关闭？")) {
      return;
    }
    onClose();
  }

  function markDirty(key: string) {
    setDirtyKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  function markDeployProjectDirty(projectKey: string) {
    setDirtyDeployProjectKeys((current) => {
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }

  function updateSelectedProject(updater: (project: ProjectConfigDraft) => ProjectConfigDraft) {
    if (!selectedProject) {
      return;
    }
    setEditorState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) =>
          project.key === selectedProject.key ? updater(project) : project,
        ),
      };
    });
    markDirty(selectedProject.key);
  }

  function updateCommand(
    commandKey: "dev" | "build",
    patch: Partial<ProjectCommandConfigDraft>,
  ) {
    updateSelectedProject((project) => ({
      ...project,
      [commandKey]: {
        ...commandValue(project[commandKey]),
        ...patch,
      },
    }));
  }

  function updateDeployTargets(
    updater: (deployTargets: DeployTargetConfigSummary[]) => DeployTargetConfigSummary[],
  ) {
    if (!selectedProject) {
      return;
    }
    setEditorState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.key !== selectedProject.key) {
            return project;
          }
          return {
            ...project,
            deployTargets: updater(project.deployTargets),
          };
        }),
      };
    });
    markDeployProjectDirty(selectedProject.key);
  }

  function updateDeployTargetAt(
    targetIndex: number,
    patch: Partial<DeployTargetConfigSummary>,
  ) {
    updateDeployTargets((deployTargets) =>
      deployTargets.map((target, index) =>
        index === targetIndex ? { ...target, ...patch } : target,
      ),
    );
  }

  function updateDeployParamAt(
    targetIndex: number,
    paramIndex: number,
    patch: Partial<DeployParamConfigSummary>,
  ) {
    updateDeployTargets((deployTargets) =>
      deployTargets.map((target, index) => {
        if (index !== targetIndex) {
          return target;
        }
        return {
          ...target,
          params: target.params.map((param, nextParamIndex) =>
            nextParamIndex === paramIndex ? { ...param, ...patch } : param,
          ),
        };
      }),
    );
  }

  function addDeployTarget() {
    const nextIndex = selectedProject?.deployTargets.length ?? 0;
    updateDeployTargets((deployTargets) => [
      ...deployTargets,
      {
        key: uniqueConfigKey("deploy", deployTargets.map((target) => target.key)),
        label: "新部署配置",
        jenkinsProfile: deployTargets[0]?.jenkinsProfile ?? "",
        jobName: "",
        params: [],
      },
    ]);
    setSelectedDeployTargetIndex(nextIndex);
  }

  function duplicateDeployTargetAt(targetIndex: number) {
    if (!selectedProject) {
      return;
    }
    updateDeployTargets((deployTargets) => {
      const source = deployTargets[targetIndex];
      if (!source) {
        return deployTargets;
      }
      const nextKey = uniqueCopiedConfigKey(
        source.key || "deploy",
        deployTargets.map((target) => target.key),
      );
      const nextLabel = `${source.label || source.key || "部署配置"} 副本`;
      const copiedTarget: DeployTargetConfigSummary = {
        ...source,
        key: nextKey,
        label: nextLabel,
        params: source.params.map((param) => ({
          ...param,
          options: [...param.options],
        })),
      };

      return [
        ...deployTargets.slice(0, targetIndex + 1),
        copiedTarget,
        ...deployTargets.slice(targetIndex + 1),
      ];
    });
    setSelectedDeployTargetIndex(targetIndex + 1);
    setError("");
    setStatus("已复制部署配置，调整 Key 和名称后保存");
  }

  function deleteDeployTargetAt(targetIndex: number) {
    const nextIndex = Math.max(
      0,
      Math.min(targetIndex, (selectedProject?.deployTargets.length ?? 1) - 2),
    );
    updateDeployTargets((deployTargets) =>
      deployTargets.filter((_, index) => index !== targetIndex),
    );
    setSelectedDeployTargetIndex(nextIndex);
  }

  function addDeployParam(targetIndex: number) {
    const target = selectedProject?.deployTargets[targetIndex];
    if (!target) {
      return;
    }
    updateDeployTargets((deployTargets) =>
      deployTargets.map((item, index) =>
        index === targetIndex
          ? {
              ...item,
              params: [
                ...item.params,
                {
                  key: uniqueConfigKey(
                    "param",
                    item.params.map((param) => param.key),
                  ),
                  label: "新参数",
                  kind: "text",
                  defaultValue: "",
                  options: [],
                  required: false,
                  trueValue: null,
                  falseValue: null,
                },
              ],
            }
          : item,
      ),
    );
  }

  function deleteDeployParamAt(targetIndex: number, paramIndex: number) {
    updateDeployTargets((deployTargets) =>
      deployTargets.map((target, index) =>
        index === targetIndex
          ? {
              ...target,
              params: target.params.filter((_, nextParamIndex) => nextParamIndex !== paramIndex),
            }
          : target,
      ),
    );
  }

  async function saveSelectedProject() {
    if (!selectedProject) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("save_project_config_basics", {
        request: selectedProject,
      });
      setEditorState(nextState);
      setDirtyKeys((current) => {
        const next = new Set(current);
        next.delete(selectedProject.key);
        return next;
      });
      setSelectedKey(selectedProject.key);
      await onProjectConfigSaved();
      setStatus("已保存项目配置");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function addProject() {
    const key = newProjectKey.trim();
    const name = newProjectName.trim();
    if (!key || !name) {
      setError("项目 key 和名称不能为空");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const nextState = await invoke<ProjectConfigEditorState>("add_project_config", {
        request: { key, name },
      });
      setEditorState(nextState);
      setDirtyKeys(new Set());
      setDirtyDeployProjectKeys(new Set());
      setSelectedKey(key);
      setNewProjectKey("");
      setNewProjectName("");
      await onProjectConfigSaved();
      setStatus("已新增项目");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedProject() {
    if (!selectedProject) {
      return;
    }
    const confirmed = window.confirm(`删除项目配置 ${selectedProject.name || selectedProject.key}？`);
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const deletedKey = selectedProject.key;
      const nextState = await invoke<ProjectConfigEditorState>("delete_project_config", {
        request: { key: deletedKey },
      });
      setEditorState(nextState);
      setDirtyKeys(new Set());
      setDirtyDeployProjectKeys(new Set());
      setSelectedKey(nextState.projects[0]?.key ?? "");
      await onProjectConfigSaved();
      setStatus("已删除项目配置");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveDeployTargets() {
    if (!selectedProject) {
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const projectKey = selectedProject.key;
      const nextState = await invoke<ProjectConfigEditorState>("save_project_deploy_targets", {
        request: {
          projectKey,
          deployTargets: selectedProject.deployTargets,
        },
      });
      setEditorState(nextState);
      setDirtyDeployProjectKeys((current) => {
        const next = new Set(current);
        next.delete(projectKey);
        return next;
      });
      setSelectedKey(projectKey);
      await onProjectConfigSaved();
      setStatus("已保存部署配置");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  function renderGeneralSection() {
    return (
      <Stack spacing={1.4}>
        <div className="settings-row">
          <span>换肤</span>
          <div className="settings-segment">
            <button
              type="button"
              className={styleMode === "light" ? "is-active" : ""}
              onClick={() => onStyleModeChange("light")}
            >
              亮色
            </button>
            <button
              type="button"
              className={styleMode === "mono" ? "is-active" : ""}
              onClick={() => onStyleModeChange("mono")}
            >
              暗色
            </button>
          </div>
        </div>
        <Divider />
        <div className="settings-shortcut-note">
          <div>
            <Typography variant="subtitle2">命令面板</Typography>
            <Typography variant="caption">搜索页面、项目、快捷入口和常用动作</Typography>
          </div>
          <kbd>Cmd/Ctrl K</kbd>
        </div>
        <div className="settings-action-grid">
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FolderIcon fontSize="small" />}
            onClick={onOpenConfigDir}
          >
            配置文件夹
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<OpenExternalIcon fontSize="small" />}
            onClick={onOpenConfigFile}
          >
            projects.toml
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<OpenExternalIcon fontSize="small" />}
            onClick={onOpenNavigationConfigFile}
          >
            navigation.toml
          </Button>
        </div>
      </Stack>
    );
  }

  function renderProjectSelector() {
    return (
      <div className="settings-project-toolbar">
        <TextField
          select
          size="small"
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          disabled={loading || saving || !editorState?.projects.length}
          inputProps={{ "aria-label": "项目" }}
        >
          {(editorState?.projects ?? []).map((project) => (
            <MenuItem key={project.key} value={project.key}>
              {project.name || project.key}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={() => void loadProjectConfig(selectedKey)}
          disabled={loading || saving}
        >
          刷新
        </Button>
      </div>
    );
  }

  function renderCommandFields(commandKey: "dev" | "build", label: string) {
    const command = commandValue(selectedProject?.[commandKey]);
    return (
      <div className="settings-sub-block">
        <div className="settings-form-block-head">
          <Typography variant="subtitle2">{label}</Typography>
          {command.envCount > 0 ? (
            <Chip size="small" label={`${command.envCount} env`} variant="outlined" />
          ) : null}
        </div>
        <div className="settings-form-grid">
          <TextField
            size="small"
            label="命令"
            value={command.command}
            onChange={(event) => updateCommand(commandKey, { command: event.target.value })}
          />
          <TextField
            size="small"
            label="工作目录"
            value={command.cwd ?? ""}
            onChange={(event) => updateCommand(commandKey, { cwd: event.target.value })}
          />
          <TextField
            size="small"
            label="输出目录"
            value={command.outputDir ?? ""}
            onChange={(event) => updateCommand(commandKey, { outputDir: event.target.value })}
          />
        </div>
      </div>
    );
  }

  function renderProjectSectionBlock(
    title: string,
    caption: string,
    children: ReactNode,
  ) {
    return (
      <div className="settings-form-block">
        <div className="settings-form-block-head">
          <div>
            <Typography variant="subtitle2">{title}</Typography>
            <Typography variant="caption">{caption}</Typography>
          </div>
        </div>
        {children}
      </div>
    );
  }

  function renderNewProjectBlock() {
    return (
      <div className="settings-form-block settings-compact-block">
        <div className="settings-form-block-head">
          <Typography variant="subtitle2">新增项目</Typography>
        </div>
        <div className="settings-form-grid">
          <TextField
            size="small"
            label="Key"
            value={newProjectKey}
            onChange={(event) => setNewProjectKey(event.target.value)}
            disabled={saving}
          />
          <TextField
            size="small"
            label="名称"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            disabled={saving}
          />
        </div>
        <div className="settings-save-row">
          <Typography variant="caption">写入 projects.toml</Typography>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => void addProject()}
            disabled={saving || !newProjectKey.trim() || !newProjectName.trim()}
          >
            新增
          </Button>
        </div>
      </div>
    );
  }

  function renderProjectSaveRow(showDelete = false) {
    return (
      <div className="settings-save-row">
        <Typography variant="caption">{editorState?.configPath}</Typography>
        <div className="settings-inline-actions">
          {showDelete ? (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<TrashIcon fontSize="small" />}
              onClick={() => void deleteSelectedProject()}
              disabled={saving}
            >
              删除
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CheckIcon fontSize="small" />}
            onClick={() => void saveSelectedProject()}
            disabled={!hasDirtySelectedProject || saving}
          >
            保存
          </Button>
        </div>
      </div>
    );
  }

  function renderProjectsSection() {
    if (loading && !editorState) {
      return <Alert severity="info">正在读取项目配置</Alert>;
    }
    if (!selectedProject) {
      return (
        <Stack spacing={1.3}>
          <Alert severity="warning">暂无项目配置</Alert>
          {renderNewProjectBlock()}
        </Stack>
      );
    }

    return (
      <Stack spacing={1.3}>
        {renderProjectSelector()}
        {renderNewProjectBlock()}
        {renderProjectSectionBlock(
          "项目身份",
          "访达、分支、部署共用这组项目名称与分类",
          <div className="settings-form-grid">
            <TextField size="small" label="Key" value={selectedProject.key} disabled />
            <TextField
              size="small"
              label="名称"
              value={selectedProject.name}
              onChange={(event) =>
                updateSelectedProject((project) => ({ ...project, name: event.target.value }))
              }
            />
            <TextField
              size="small"
              label="分类"
              value={selectedProject.category}
              onChange={(event) =>
                updateSelectedProject((project) => ({ ...project, category: event.target.value }))
              }
            />
          </div>,
        )}
        {renderProjectSaveRow(true)}
      </Stack>
    );
  }

  function renderFinderSection() {
    if (loading && !editorState) {
      return <Alert severity="info">正在读取访达配置</Alert>;
    }
    if (!selectedProject) {
      return (
        <Stack spacing={1.3}>
          <Alert severity="warning">暂无项目配置</Alert>
          {renderNewProjectBlock()}
        </Stack>
      );
    }

    return (
      <Stack spacing={1.3}>
        {renderProjectSelector()}
        {renderProjectSectionBlock(
          "快捷入口",
          "访达页的网站、应用、脚本入口来自 navigation.toml",
          <div className="settings-action-grid">
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<OpenExternalIcon fontSize="small" />}
              onClick={onOpenNavigationConfigFile}
            >
              navigation.toml
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<FolderIcon fontSize="small" />}
              onClick={onOpenConfigDir}
            >
              配置文件夹
            </Button>
          </div>,
        )}
        {renderProjectSectionBlock(
          "仓库与本地命令",
          "访达页打开目录、启动运行和构建时使用",
          <Stack spacing={1}>
            <div className="settings-sub-block">
              <div className="settings-form-grid">
                <TextField
                  size="small"
                  label="仓库路径"
                  value={selectedProject.repoPath ?? ""}
                  onChange={(event) =>
                    updateSelectedProject((project) => ({
                      ...project,
                      repoPath: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {renderCommandFields("dev", "本地运行")}
            {renderCommandFields("build", "本地构建")}
          </Stack>,
        )}
        {renderProjectSectionBlock(
          "聚焦",
          "访达页唤起运行中的项目时使用",
          <div className="settings-form-grid">
            <TextField
              size="small"
              label="URL"
              value={selectedProject.focus.url ?? ""}
              onChange={(event) =>
                updateSelectedProject((project) => ({
                  ...project,
                  focus: { ...project.focus, url: event.target.value },
                }))
              }
            />
            <TextField
              size="small"
              label="Bundle ID"
              value={selectedProject.focus.bundleId ?? ""}
              onChange={(event) =>
                updateSelectedProject((project) => ({
                  ...project,
                  focus: { ...project.focus, bundleId: event.target.value },
                }))
              }
            />
          </div>,
        )}
        {renderProjectSaveRow()}
      </Stack>
    );
  }

  function renderBranchSection() {
    if (loading && !editorState) {
      return <Alert severity="info">正在读取分支配置</Alert>;
    }
    if (!selectedProject) {
      return (
        <Stack spacing={1.3}>
          <Alert severity="warning">暂无项目配置</Alert>
          {renderNewProjectBlock()}
        </Stack>
      );
    }

    return (
      <Stack spacing={1.3}>
        {renderProjectSelector()}
        {renderProjectSectionBlock(
          "Git 与分支规则",
          "分支页同步、创建、检出和推送时使用",
          <div className="settings-form-grid">
            <TextField
              size="small"
              label="Git URL"
              value={selectedProject.gitUrl}
              onChange={(event) =>
                updateSelectedProject((project) => ({ ...project, gitUrl: event.target.value }))
              }
            />
            <TextField
              size="small"
              label="仓库路径"
              value={selectedProject.repoPath ?? ""}
              onChange={(event) =>
                updateSelectedProject((project) => ({ ...project, repoPath: event.target.value }))
              }
            />
            <TextField
              size="small"
              label="源分支关键词"
              value={selectedProject.branchRules.sourceKeywords.join(", ")}
              onChange={(event) =>
                updateSelectedProject((project) => ({
                  ...project,
                  branchRules: {
                    ...project.branchRules,
                    sourceKeywords: parseKeywordList(event.target.value),
                  },
                }))
              }
            />
            <TextField
              size="small"
              label="目标分支关键词"
              value={selectedProject.branchRules.targetKeywords.join(", ")}
              onChange={(event) =>
                updateSelectedProject((project) => ({
                  ...project,
                  branchRules: {
                    ...project.branchRules,
                    targetKeywords: parseKeywordList(event.target.value),
                  },
                }))
              }
            />
          </div>,
        )}
        {renderProjectSaveRow()}
      </Stack>
    );
  }

  function renderDeployParamEditor(
    targetIndex: number,
    param: DeployParamConfigSummary,
    paramIndex: number,
  ) {
    const showOptions = param.kind === "select";
    const showBooleanValues = param.kind === "boolean";

    return (
      <div className="settings-param-editor" key={`${param.key}-${paramIndex}`}>
        <div className="settings-param-editor-head">
          <Typography variant="caption">{param.label || param.key}</Typography>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<TrashIcon fontSize="small" />}
            onClick={() => deleteDeployParamAt(targetIndex, paramIndex)}
            disabled={saving}
          >
            删除
          </Button>
        </div>
        <div className="settings-form-grid settings-form-grid-tight">
          <TextField
            size="small"
            label="Key"
            value={param.key}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, { key: event.target.value })
            }
          />
          <TextField
            size="small"
            label="名称"
            value={param.label}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, { label: event.target.value })
            }
          />
          <TextField
            select
            size="small"
            label="类型"
            value={param.kind}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, {
                kind: event.target.value as DeployParamConfigKind,
              })
            }
          >
            {DEPLOY_PARAM_KIND_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="默认值"
            value={param.defaultValue ?? ""}
            onChange={(event) =>
              updateDeployParamAt(targetIndex, paramIndex, {
                defaultValue: event.target.value,
              })
            }
          />
          {showOptions ? (
            <TextField
              size="small"
              label="选项"
              className="settings-form-grid-wide"
              value={param.options.join(", ")}
              onChange={(event) =>
                updateDeployParamAt(targetIndex, paramIndex, {
                  options: parseParamOptions(event.target.value),
                })
              }
            />
          ) : null}
          {showBooleanValues ? (
            <>
              <TextField
                size="small"
                label="True 值"
                value={param.trueValue ?? ""}
                onChange={(event) =>
                  updateDeployParamAt(targetIndex, paramIndex, {
                    trueValue: event.target.value,
                  })
                }
              />
              <TextField
                size="small"
                label="False 值"
                value={param.falseValue ?? ""}
                onChange={(event) =>
                  updateDeployParamAt(targetIndex, paramIndex, {
                    falseValue: event.target.value,
                  })
                }
              />
            </>
          ) : null}
        </div>
        <FormControlLabel
          className="settings-checkbox-row"
          control={
            <Checkbox
              size="small"
              checked={param.required}
              onChange={(event) =>
                updateDeployParamAt(targetIndex, paramIndex, { required: event.target.checked })
              }
            />
          }
          label="必填"
        />
      </div>
    );
  }

  function renderDeploySection() {
    if (loading && !editorState) {
      return <Alert severity="info">正在读取部署配置</Alert>;
    }
    if (!selectedProject) {
      return <Alert severity="warning">暂无项目配置</Alert>;
    }
    const deployTargetCount = selectedProject.deployTargets.length;
    const activeDeployTargetIndex =
      deployTargetCount === 0
        ? 0
        : Math.min(selectedDeployTargetIndex, deployTargetCount - 1);
    const activeDeployTarget = selectedProject.deployTargets[activeDeployTargetIndex] ?? null;

    return (
      <Stack spacing={1.2}>
        {renderProjectSelector()}
        <div className="settings-save-row">
          <Typography variant="caption">
            {selectedProject.deployTargets.length} 个部署配置
          </Typography>
          <div className="settings-inline-actions">
            <Button
              variant="outlined"
              color="inherit"
              onClick={addDeployTarget}
              disabled={saving}
            >
              新增配置
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              onClick={() => void saveDeployTargets()}
              disabled={!hasDirtySelectedDeployProject || saving}
            >
              保存部署
            </Button>
          </div>
        </div>
        {deployTargetCount === 0 ? (
          <Alert severity="info">该项目未配置部署目标</Alert>
        ) : activeDeployTarget ? (
          <>
            <div className="settings-deploy-switcher" role="tablist" aria-label="部署配置">
              {selectedProject.deployTargets.map((target, targetIndex) => (
                <button
                  key={`${target.key}-${targetIndex}`}
                  type="button"
                  className={activeDeployTargetIndex === targetIndex ? "is-active" : ""}
                  onClick={() => setSelectedDeployTargetIndex(targetIndex)}
                  aria-selected={activeDeployTargetIndex === targetIndex}
                >
                  <span>{target.label || target.key || "未命名"}</span>
                  <small>{target.key || "new"}</small>
                </button>
              ))}
            </div>
            <div className="settings-deploy-item">
              <div className="settings-deploy-item-head">
                <div>
                  <Typography variant="subtitle2">
                    {activeDeployTarget.label || activeDeployTarget.key}
                  </Typography>
                  <Typography variant="caption">
                    {activeDeployTarget.jobName || "未设置 Job Name"}
                  </Typography>
                </div>
                <div className="settings-inline-actions">
                  <Chip size="small" label={activeDeployTarget.key || "new"} variant="outlined" />
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<CopyIcon fontSize="small" />}
                    onClick={() => duplicateDeployTargetAt(activeDeployTargetIndex)}
                    disabled={saving}
                  >
                    复制当前
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<TrashIcon fontSize="small" />}
                    onClick={() => deleteDeployTargetAt(activeDeployTargetIndex)}
                    disabled={saving}
                  >
                    删除
                  </Button>
                </div>
              </div>
              <div className="settings-form-grid">
                <TextField
                  size="small"
                  label="Key"
                  value={activeDeployTarget.key}
                  onChange={(event) =>
                    updateDeployTargetAt(activeDeployTargetIndex, { key: event.target.value })
                  }
                />
                <TextField
                  size="small"
                  label="名称"
                  value={activeDeployTarget.label}
                  onChange={(event) =>
                    updateDeployTargetAt(activeDeployTargetIndex, { label: event.target.value })
                  }
                />
                <TextField
                  select={jenkinsProfileOptions.length > 0}
                  size="small"
                  label="Jenkins Profile"
                  value={activeDeployTarget.jenkinsProfile}
                  onChange={(event) =>
                    updateDeployTargetAt(activeDeployTargetIndex, {
                      jenkinsProfile: event.target.value,
                    })
                  }
                >
                  {jenkinsProfileOptions.map((profileKey) => (
                    <MenuItem key={profileKey} value={profileKey}>
                      {profileKey}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Job Name"
                  value={activeDeployTarget.jobName}
                  onChange={(event) =>
                    updateDeployTargetAt(activeDeployTargetIndex, { jobName: event.target.value })
                  }
                />
              </div>
              <div
                className="settings-param-list"
                aria-label={`${activeDeployTarget.label} 参数`}
              >
                <div className="settings-param-list-head">
                  <Typography variant="caption">
                    {activeDeployTarget.params.length} 个参数
                  </Typography>
                  <Button
                    variant="outlined"
                    color="inherit"
                    onClick={() => addDeployParam(activeDeployTargetIndex)}
                    disabled={saving}
                  >
                    新增参数
                  </Button>
                </div>
                {activeDeployTarget.params.length === 0 ? (
                  <div className="settings-empty-row">无参数</div>
                ) : (
                  activeDeployTarget.params.map((param, paramIndex) =>
                    renderDeployParamEditor(activeDeployTargetIndex, param, paramIndex),
                  )
                )}
              </div>
            </div>
          </>
        ) : null}
        <div className="settings-save-row">
          <Typography variant="caption">{editorState?.configPath}</Typography>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<OpenExternalIcon fontSize="small" />}
            onClick={onOpenConfigFile}
          >
            原始配置
          </Button>
        </div>
      </Stack>
    );
  }

  return (
    <div
      className="settings-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        className="settings-panel settings-panel-wide"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-panel-head">
          <div>
            <Typography variant="subtitle2">设置</Typography>
            <Typography variant="caption">工作台与项目配置</Typography>
          </div>
          <button
            type="button"
            className="settings-close-button"
            aria-label="关闭设置"
            onClick={requestClose}
          >
            <ClearIcon fontSize="small" />
          </button>
        </div>

        <div className="settings-panel-body">
          <div className="settings-section-nav" role="tablist" aria-label="设置分类">
            {SECTION_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={activeSection === item.key ? "is-active" : ""}
                onClick={() => setActiveSection(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="settings-section-content">
            {error ? (
              <Alert severity="error" sx={{ py: 0 }}>
                {error}
              </Alert>
            ) : null}
            {status ? (
              <Alert severity="success" sx={{ py: 0 }}>
                {status}
              </Alert>
            ) : null}
            {activeSection === "general" ? renderGeneralSection() : null}
            {activeSection === "projects" ? renderProjectsSection() : null}
            {activeSection === "finder" ? renderFinderSection() : null}
            {activeSection === "branch" ? renderBranchSection() : null}
            {activeSection === "deploy" ? renderDeploySection() : null}
          </div>
        </div>
      </div>
    </div>
  );
}
