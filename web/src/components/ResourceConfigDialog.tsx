import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Alert,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  NavigationEditorCategory,
  NavigationEditorEntry,
  NavigationEditorEntryKind,
  NavigationEditorState,
  ProjectConfigDraft,
  ProjectConfigEditorState,
  ProjectWorkspaceSummary,
  ResourceActionCatalog,
  ResourceActionSummary,
  RuntimeProfileDraft,
  WebActionListResponse,
  WebActionSummary,
} from "../app-types";
import {
  CheckIcon,
  EditIcon,
  FolderIcon,
  OpenExternalIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";
import { AppToast } from "./AppToast";
import {
  LinkToolWizardDialog,
  type LinkToolWizardSaveResult,
} from "./LinkToolWizardDialog";
import { ConfigSourceManagerDialog } from "./ConfigSourceManagerDialog";
import { ConfigSourceBar } from "./ConfigSourceBar";
import { ConfigDialogShell } from "./ConfigDialogShell";
import { useConfigSource } from "../hooks/useConfigSource";
import { useI18n, type Translate } from "../i18n";

const NAVIGATION_ENTRY_KIND_OPTIONS: Array<{
  value: NavigationEditorEntryKind;
  label: string;
}> = [
  { value: "url", label: "网站" },
  { value: "directory", label: "目录" },
  { value: "file", label: "文件" },
  { value: "app", label: "应用" },
  { value: "script", label: "脚本" },
  { value: "tool", label: "工具" },
];

const NAVIGATION_BROWSER_OPTIONS = [
  { value: "current_chrome", label: "当前 Chrome" },
  { value: "system", label: "系统默认" },
  { value: "Google Chrome", label: "Google Chrome" },
  { value: "Microsoft Edge", label: "Microsoft Edge" },
  { value: "Brave Browser", label: "Brave Browser" },
] as const;

const CUSTOM_NAVIGATION_BROWSER_VALUE = "__custom__";

type NavigationToolType = "link" | "action" | "workflow" | "webAction" | "runtime";

type NavigationToolConfig = {
  value: NavigationToolType;
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  description: string;
  defaultAction: string;
  actions: Array<{ value: string; label: string }>;
  keySource: "text" | "action" | "webAction" | "project";
  showRuntimeProfile?: boolean;
};

const NAVIGATION_TOOL_OPTIONS: NavigationToolConfig[] = [
  {
    value: "link",
    label: "Link",
    keyLabel: "Link Key",
    keyPlaceholder: "例如 workspace-start-check",
    description: "读取 Link 配置并展示计划，适合把准备、启动、检查等步骤做成入口。",
    defaultAction: "plan",
    actions: [{ value: "plan", label: "查看计划" }],
    keySource: "text",
  },
  {
    value: "action",
    label: "参数化 Action",
    keyLabel: "Action Key",
    keyPlaceholder: "选择 actions.toml 中的 Action",
    description: "根据 Action Schema 生成参数表单，并通过受控执行器运行。",
    defaultAction: "run",
    actions: [
      { value: "run", label: "执行动作" },
      { value: "inspect", label: "检查配置" },
    ],
    keySource: "action",
  },
  {
    value: "workflow",
    label: "Workflow",
    keyLabel: "Workflow Key",
    keyPlaceholder: "填写 workflow、replay 或 rule 标识",
    description: "作为自动化流程入口使用，首期只打开或预览，不直接执行。",
    defaultAction: "plan",
    actions: [
      { value: "plan", label: "查看计划" },
      { value: "open", label: "打开配置" },
    ],
    keySource: "text",
  },
  {
    value: "webAction",
    label: "网页动作入口",
    keyLabel: "引用网页动作",
    keyPlaceholder: "选择已有网页动作",
    description: "引用已有网页动作配置；脚本、受控页面和调试仍在运行环境面板维护。",
    defaultAction: "open",
    actions: [
      { value: "open", label: "打开目标" },
      { value: "run", label: "执行动作" },
      { value: "inspect", label: "检查配置" },
    ],
    keySource: "webAction",
  },
  {
    value: "runtime",
    label: "Runtime",
    keyLabel: "项目",
    keyPlaceholder: "选择或填写项目 key",
    description: "指向项目运行能力，可作为启动、聚焦、检查或停止入口。",
    defaultAction: "inspect",
    actions: [
      { value: "inspect", label: "检查配置" },
      { value: "start", label: "启动项目" },
      { value: "focus", label: "唤起页面" },
      { value: "stop", label: "停止项目" },
    ],
    keySource: "project",
    showRuntimeProfile: true,
  },
];

export type ResourceConfigDialogProps = {
  open: boolean;
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  onClose: () => void;
  onOpenNavigationConfigFile: () => void;
  onSaved?: () => Promise<void> | void;
};

function navigationEntryKindLabel(kind: string, t: Translate = (message) => message) {
  return t(NAVIGATION_ENTRY_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? "入口");
}

function navigationToolConfig(tool?: string | null): NavigationToolConfig {
  const normalized = tool?.trim() || "link";
  return (
    NAVIGATION_TOOL_OPTIONS.find((item) => item.value === normalized) ?? {
      value: "link",
      label: normalized || "自定义工具",
      keyLabel: "Tool Key",
      keyPlaceholder: "填写工具 key",
      description: "未注册的工具类型会保留配置，不会阻塞保存。",
      defaultAction: "open",
      actions: [
        { value: "open", label: "打开" },
        { value: "plan", label: "查看计划" },
      ],
      keySource: "text",
    }
  );
}

function navigationToolActionValue(entry: NavigationEditorEntry) {
  return entry.toolAction?.trim() || navigationToolConfig(entry.tool).defaultAction;
}

function navigationToolActionLabel(
  config: NavigationToolConfig,
  value: string,
  t: Translate = (message) => message,
) {
  const label = config.actions.find((item) => item.value === value)?.label;
  return label ? t(label) : value;
}

function webActionKindLabel(kind: string | null | undefined, t: Translate) {
  return t(kind === "request" ? "请求动作" : "脚本动作");
}

function navigationBrowserSelectValue(browser?: string | null) {
  const normalized = browser?.trim() ?? "";
  if (!normalized) {
    return "current_chrome";
  }
  return NAVIGATION_BROWSER_OPTIONS.some((item) => item.value === normalized)
    ? normalized
    : CUSTOM_NAVIGATION_BROWSER_VALUE;
}

function navigationBrowserSupportsProfile(browser?: string | null) {
  const normalized = browser?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("chrome") ||
    normalized.includes("edge") ||
    normalized.includes("chromium") ||
    normalized.includes("brave")
  );
}

function navigationBrowserLabel(entry: NavigationEditorEntry, t: Translate) {
  if (entry.runtimeProfile?.trim()) {
    return t("运行环境 {name}", { name: entry.runtimeProfile.trim() });
  }
  const browser = entry.browser?.trim();
  if (!browser || browser === "current_chrome") {
    return t("当前 Chrome");
  }
  if (browser === "system") {
    return t("系统默认");
  }
  return entry.browserProfile ? `${browser} · ${entry.browserProfile}` : browser;
}

function emptyNavigationEntry(
  kind: NavigationEditorEntryKind = "url",
  t: Translate = (message) => message,
): NavigationEditorEntry {
  return {
    name: t("新入口"),
    kind,
    url: "",
    browser: null,
    browserProfile: null,
    runtimeProfile: null,
    bundleId: null,
    appName: null,
    script: null,
    tool: kind === "tool" ? "link" : null,
    toolKey: null,
    toolAction: kind === "tool" ? "plan" : null,
    path: null,
    cwd: null,
    note: null,
  };
}

function uniqueNavigationCategoryTitle(
  categories: NavigationEditorCategory[],
  t: Translate = (message) => message,
) {
  const existing = new Set(categories.map((category) => category.title.trim()));
  let index = categories.length + 1;
  let title = t("新分类 {index}", { index });
  while (existing.has(title)) {
    index += 1;
    title = t("新分类 {index}", { index });
  }
  return title;
}

export function ResourceConfigDialog({
  open,
  activeProjectWorkspaceKey,
  projectWorkspaces,
  onClose,
  onOpenNavigationConfigFile,
  onSaved,
}: ResourceConfigDialogProps) {
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
    requiredCapability: "resource",
  });
  const [editor, setEditor] = useState<NavigationEditorState | null>(null);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0);
  const [entryQuery, setEntryQuery] = useState("");
  const [entryKindFilter, setEntryKindFilter] =
    useState<"all" | NavigationEditorEntryKind>("all");
  const [projects, setProjects] = useState<ProjectConfigDraft[]>([]);
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfileDraft[]>([]);
  const [webActions, setWebActions] = useState<WebActionSummary[]>([]);
  const [resourceActions, setResourceActions] = useState<ResourceActionSummary[]>([]);
  const [resourceActionConfigPath, setResourceActionConfigPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [toastNonce, setToastNonce] = useState(0);
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(false);
  const [linkWizardTarget, setLinkWizardTarget] = useState<{
    categoryIndex: number;
    entryIndex: number;
    linkKey: string;
  } | null>(null);
  const navigationLoadIdRef = useRef(0);
  const lookupLoadIdRef = useRef(0);

  function showStatus(message: string) {
    setStatus(message);
    if (message.trim()) {
      setToastNonce((current) => current + 1);
    }
  }

  function showError(message: string) {
    setError(message);
    if (message.trim()) {
      setToastNonce((current) => current + 1);
    }
  }

  const sourceAllowsLink = supports("link");

  async function loadConfigSources(sourceId?: string) {
    try {
      const result = await refreshSources(sourceId);
      return result?.sourceId ?? null;
    } catch (reason) {
      showError(String(reason));
      return null;
    }
  }

  async function loadNavigationEditor(sourceId = selectedSourceId) {
    const requestId = navigationLoadIdRef.current + 1;
    navigationLoadIdRef.current = requestId;
    setLoading(true);
    showError("");
    try {
      const nextEditor = await invoke<NavigationEditorState>("get_navigation_editor", {
        sourceId,
      });
      if (navigationLoadIdRef.current !== requestId) return;
      setEditor(nextEditor);
      setDirty(false);
      const preferredIndex = nextEditor.preferredCategory
        ? nextEditor.categories.findIndex(
            (category) => category.title === nextEditor.preferredCategory,
          )
        : -1;
      setSelectedCategoryIndex(preferredIndex >= 0 ? preferredIndex : 0);
      setSelectedEntryIndex(0);
    } catch (reason) {
      if (navigationLoadIdRef.current === requestId) showError(String(reason));
    } finally {
      if (navigationLoadIdRef.current === requestId) setLoading(false);
    }
  }

  async function loadToolLookups(sourceId = selectedSourceId) {
    const requestId = lookupLoadIdRef.current + 1;
    lookupLoadIdRef.current = requestId;
    const [projectResult, webActionResult, resourceActionResult] = await Promise.allSettled([
      invoke<ProjectConfigEditorState>("get_project_config_editor", { sourceId }),
      invoke<WebActionListResponse>("list_web_actions", { scope: null, url: null }),
      invoke<ResourceActionCatalog>("list_resource_actions", { sourceId }),
    ]);
    if (lookupLoadIdRef.current !== requestId) return;
    if (projectResult.status === "fulfilled") {
      const state = projectResult.value;
      setRuntimeProfiles(state.runtimeProfiles ?? []);
      setProjects(state.projects ?? []);
    } else {
      setRuntimeProfiles([]);
      setProjects([]);
    }
    if (webActionResult.status === "fulfilled") {
      setWebActions(webActionResult.value.actions ?? []);
    } else {
      setWebActions([]);
    }
    if (resourceActionResult.status === "fulfilled") {
      setResourceActions(resourceActionResult.value.actions ?? []);
      setResourceActionConfigPath(resourceActionResult.value.configPath);
    } else {
      setResourceActions([]);
      setResourceActionConfigPath("");
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    void (async () => {
      const sourceId = await loadConfigSources();
      if (!sourceId) return;
      await Promise.all([loadNavigationEditor(sourceId), loadToolLookups(sourceId)]);
    })();
    return () => {
      navigationLoadIdRef.current += 1;
      lookupLoadIdRef.current += 1;
    };
  }, [open, preferredSourceId]);

  const activeCategory = useMemo(() => {
    if (!editor || editor.categories.length === 0) {
      return null;
    }
    return editor.categories[Math.min(selectedCategoryIndex, editor.categories.length - 1)] ?? null;
  }, [editor, selectedCategoryIndex]);

  const activeCategoryIndex = editor?.categories.length
    ? Math.min(selectedCategoryIndex, editor.categories.length - 1)
    : 0;

  const allEntryItems = useMemo(
    () =>
      (editor?.categories ?? []).flatMap((category, categoryIndex) =>
        category.entries.map((entry, entryIndex) => ({
          category,
          categoryIndex,
          entry,
          entryIndex,
        })),
      ),
    [editor],
  );

  const visibleEntryItems = useMemo(() => {
    const keyword = entryQuery.trim().toLowerCase();
    return allEntryItems.filter(({ category, entry }) => {
        if (entryKindFilter !== "all" && entry.kind !== entryKindFilter) {
          return false;
        }
        if (!keyword) {
          return true;
        }
        return [
          entry.name,
          navigationEntryKindLabel(entry.kind, t),
          entry.url,
          entry.path,
          entry.appName,
          entry.bundleId,
          entry.script,
          entry.cwd,
          entry.tool,
          entry.toolKey,
          entry.note,
          category.title,
          category.shortLabel,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword));
      });
  }, [allEntryItems, entryKindFilter, entryQuery, t]);

  const selectedEntry = activeCategory?.entries[selectedEntryIndex] ?? null;

  useEffect(() => {
    if (!editor || editor.categories.length === 0) {
      setSelectedEntryIndex(0);
      setSelectedCategoryIndex(0);
      return;
    }

    if (allEntryItems.length === 0) {
      setSelectedEntryIndex(0);
      setSelectedCategoryIndex(0);
      return;
    }

    const selectedExists = Boolean(
      editor.categories[selectedCategoryIndex]?.entries[selectedEntryIndex],
    );
    const selectedVisible = visibleEntryItems.some(
      (item) =>
        item.categoryIndex === selectedCategoryIndex && item.entryIndex === selectedEntryIndex,
    );
    const fallback = visibleEntryItems[0] ?? allEntryItems[0];

    if ((!selectedExists || !selectedVisible) && fallback) {
      setSelectedCategoryIndex(fallback.categoryIndex);
      setSelectedEntryIndex(fallback.entryIndex);
      return;
    }
  }, [allEntryItems, editor, selectedCategoryIndex, selectedEntryIndex, visibleEntryItems]);

  function updateEditor(updater: (current: NavigationEditorState) => NavigationEditorState) {
    setEditor((current) => {
      if (!current) {
        return current;
      }
      setDirty(true);
      return updater(current);
    });
  }

  function addCategory(initialKind: NavigationEditorEntryKind = "url") {
    const categories = editor?.categories ?? [];
    const title = uniqueNavigationCategoryTitle(categories, t);
    const nextIndex = categories.length;
    updateEditor((current) => ({
      ...current,
      categories: [
        ...current.categories,
        {
          title,
          shortLabel: title,
          entries: [emptyNavigationEntry(initialKind, t)],
        },
      ],
    }));
    setSelectedCategoryIndex(nextIndex);
    setSelectedEntryIndex(0);
    setEntryQuery("");
    setEntryKindFilter("all");
  }

  function addEntry(categoryIndex: number, kind: NavigationEditorEntryKind = "url") {
    const nextEntryIndex = editor?.categories[categoryIndex]?.entries.length ?? 0;
    updateEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) =>
        index === categoryIndex
              ? { ...category, entries: [...category.entries, emptyNavigationEntry(kind, t)] }
          : category,
      ),
    }));
    setSelectedEntryIndex(nextEntryIndex);
    setEntryKindFilter("all");
    setEntryQuery("");
  }

  function moveEntryToCategory(
    categoryIndex: number,
    entryIndex: number,
    nextCategoryIndex: number,
  ) {
    if (categoryIndex === nextCategoryIndex || !editor?.categories[nextCategoryIndex]) {
      return;
    }
    const nextEntryIndex = editor.categories[nextCategoryIndex].entries.length;
    updateEditor((current) => {
      const entry = current.categories[categoryIndex]?.entries[entryIndex];
      if (!entry) {
        return current;
      }
      return {
        ...current,
        categories: current.categories.map((category, index) => {
          if (index === categoryIndex) {
            return {
              ...category,
              entries: category.entries.filter((_, itemIndex) => itemIndex !== entryIndex),
            };
          }
          if (index === nextCategoryIndex) {
            return {
              ...category,
              entries: [...category.entries, entry],
            };
          }
          return category;
        }),
      };
    });
    setSelectedCategoryIndex(nextCategoryIndex);
    setSelectedEntryIndex(nextEntryIndex);
    setEntryKindFilter("all");
  }

  function moveEntryToNewCategory(categoryIndex: number, entryIndex: number) {
    if (!editor) {
      return;
    }
    const nextCategoryIndex = editor.categories.length;
    const title = uniqueNavigationCategoryTitle(editor.categories, t);
    updateEditor((current) => {
      const entry = current.categories[categoryIndex]?.entries[entryIndex];
      if (!entry) {
        return current;
      }
      return {
        ...current,
        categories: [
          ...current.categories.map((category, index) =>
            index === categoryIndex
              ? {
                  ...category,
                  entries: category.entries.filter((_, itemIndex) => itemIndex !== entryIndex),
                }
              : category,
          ),
          {
            title,
            shortLabel: title,
            entries: [entry],
          },
        ],
      };
    });
    setSelectedCategoryIndex(nextCategoryIndex);
    setSelectedEntryIndex(0);
    setEntryKindFilter("all");
  }

  function updateEntryAt(
    categoryIndex: number,
    entryIndex: number,
    patch: Partial<NavigationEditorEntry>,
  ) {
    updateEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) =>
        index === categoryIndex
          ? {
              ...category,
              entries: category.entries.map((entry, itemIndex) =>
                itemIndex === entryIndex ? { ...entry, ...patch } : entry,
              ),
            }
          : category,
      ),
    }));
  }

  function openLinkWizardForEntry(categoryIndex: number, entryIndex: number) {
    const entry = editor?.categories[categoryIndex]?.entries[entryIndex];
    setLinkWizardTarget({
      categoryIndex,
      entryIndex,
      linkKey: entry?.toolKey?.trim() ?? "",
    });
  }

  function handleLinkWizardSaved(result: LinkToolWizardSaveResult) {
    const target = linkWizardTarget;
    if (!target) {
      return;
    }
    const currentEntry =
      editor?.categories[target.categoryIndex]?.entries[target.entryIndex] ?? null;
    const nextName =
      !currentEntry?.name.trim() ||
      currentEntry.name.trim() === "新入口" ||
      currentEntry.name.trim() === t("新入口")
        ? result.link.name
        : currentEntry.name;
    updateEntryAt(target.categoryIndex, target.entryIndex, {
      name: nextName,
      kind: "tool",
      tool: "link",
      toolKey: result.link.key,
      toolAction: "plan",
      note:
        currentEntry?.note?.trim() ||
        t("Link {key} · {count} 步", {
          key: result.link.key,
          count: result.plan.steps.length,
        }),
    });
    showStatus(t("已保存链路定义，并填入当前工具入口；请保存入口配置。"));
  }

  function deleteEntryAt(categoryIndex: number, entryIndex: number) {
    const nextLength = Math.max(
      0,
      (editor?.categories[categoryIndex]?.entries.length ?? 1) - 1,
    );
    updateEditor((current) => ({
      ...current,
      categories: current.categories.map((category, index) =>
        index === categoryIndex
          ? {
              ...category,
              entries: category.entries.filter((_, itemIndex) => itemIndex !== entryIndex),
            }
          : category,
      ),
    }));
    if (categoryIndex === activeCategoryIndex) {
      setSelectedEntryIndex((current) => {
        if (nextLength === 0) {
          return 0;
        }
        if (current > entryIndex) {
          return current - 1;
        }
        if (current === entryIndex) {
          return Math.min(current, nextLength - 1);
        }
        return current;
      });
    }
  }

  async function choosePath(categoryIndex: number, entryIndex: number, directory: boolean) {
    const entry = editor?.categories[categoryIndex]?.entries[entryIndex];
    const selected = await openDialog({
      directory,
      multiple: false,
      defaultPath: entry?.path ?? undefined,
    });
    if (typeof selected === "string" && selected.trim()) {
      updateEntryAt(categoryIndex, entryIndex, { path: selected });
    }
  }

  async function handleSourceChange(nextSourceId: string) {
    if (nextSourceId === selectedSourceId) {
      return;
    }
    if (dirty) {
      showError(t("请先保存或取消当前改动，再切换配置源。"));
      return;
    }
    try {
      const source = await selectSource(nextSourceId);
      if (!source) return;
      await Promise.all([loadNavigationEditor(source.id), loadToolLookups(source.id)]);
    } catch (reason) {
      showError(String(reason));
    }
  }

  async function openSelectedNavigationConfigFile() {
    const path = editor?.filePath || selectedConfigSource?.files.navigation;
    if (!path) {
      onOpenNavigationConfigFile();
      return;
    }
    try {
      await invoke("open_local_path", { path });
    } catch (reason) {
      showError(String(reason));
    }
  }

  async function saveNavigationEditor() {
    if (!editor) {
      return;
    }
    setSaving(true);
    showError("");
    showStatus("");
    try {
      await invoke("save_navigation_editor", { sourceId: selectedSourceId, data: editor });
      const nextEditor = await invoke<NavigationEditorState>("get_navigation_editor", {
        sourceId: selectedSourceId,
      });
      setEditor(nextEditor);
      setDirty(false);
      showStatus(t("已保存资源入口配置"));
      await onSaved?.();
    } catch (reason) {
      showError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    onClose();
    showError("");
    showStatus("");
  }

  function renderEntryTargetFields(
    entry: NavigationEditorEntry,
    categoryIndex: number,
    entryIndex: number,
  ) {
    if (entry.kind === "app") {
      return (
        <>
          <TextField
            size="small"
            label="Bundle ID"
            value={entry.bundleId ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { bundleId: event.target.value })
            }
          />
          <TextField
            size="small"
            label={t("应用名")}
            value={entry.appName ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { appName: event.target.value })
            }
          />
        </>
      );
    }

    if (entry.kind === "script") {
      return (
        <>
          <TextField
            size="small"
            label={t("脚本路径")}
            value={entry.script ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { script: event.target.value })
            }
          />
          <TextField
            size="small"
            label={t("工作目录")}
            value={entry.cwd ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { cwd: event.target.value })
            }
          />
        </>
      );
    }

    if (entry.kind === "tool") {
      const toolConfig = navigationToolConfig(entry.tool);
      const currentTool = entry.tool?.trim() || "link";
      const toolValue = NAVIGATION_TOOL_OPTIONS.some((item) => item.value === currentTool)
        ? currentTool
        : "__custom__";
      const actionValue = navigationToolActionValue(entry);
      const actionOptions = toolConfig.actions.some((item) => item.value === actionValue)
        ? toolConfig.actions
        : [{ value: actionValue, label: t("自定义：{value}", { value: actionValue }) }, ...toolConfig.actions];
      const toolKey = entry.toolKey?.trim() ?? "";
      const runtimeProfileKey = entry.runtimeProfile?.trim() ?? "";
      const selectedWebAction =
        toolConfig.value === "webAction" && toolKey
          ? webActions.find((item) => item.key === toolKey) ?? null
          : null;
      const selectedResourceAction =
        toolConfig.value === "action" && toolKey
          ? resourceActions.find((item) => item.key === toolKey) ?? null
          : null;
      const selectedProject =
        toolConfig.value === "runtime" && toolKey
          ? projects.find((item) => item.key === toolKey) ?? null
          : null;
      const selectedRuntimeProfile = runtimeProfileKey
        ? runtimeProfiles.find((profile) => profile.key === runtimeProfileKey) ?? null
        : null;
      const toolMetaItems: Array<{ label: string; value: string }> = [
        { label: t("动作"), value: navigationToolActionLabel(toolConfig, actionValue, t) },
      ];
      const toolWarnings: string[] = [];

      if (toolConfig.value === "action") {
        if (selectedResourceAction) {
          toolMetaItems.push(
            { label: t("引用"), value: selectedResourceAction.name || selectedResourceAction.key },
            { label: t("参数"), value: t("{count} 个", { count: selectedResourceAction.paramCount }) },
            { label: t("影响"), value: selectedResourceAction.effect },
          );
        } else if (toolKey) {
          toolWarnings.push(t("引用的 Action 不存在：{key}", { key: toolKey }));
        } else if (resourceActions.length > 0) {
          toolWarnings.push(t("请选择一个已有 Action。"));
        } else {
          toolWarnings.push(t("暂无可引用 Action，请先在 actions.toml 中创建。"));
        }
      } else if (toolConfig.value === "webAction") {
        if (selectedWebAction) {
          toolMetaItems.push(
            { label: t("引用"), value: selectedWebAction.name || selectedWebAction.key },
            { label: t("类型"), value: webActionKindLabel(selectedWebAction.kind, t) },
            { label: t("范围"), value: selectedWebAction.scope || t("全局") },
          );
          if (selectedWebAction.matchPatterns.length > 0) {
            toolMetaItems.push({
              label: t("匹配"),
              value: t("{count} 条", { count: selectedWebAction.matchPatterns.length }),
            });
          }
          if (selectedWebAction.params.length > 0) {
            toolMetaItems.push({
              label: t("参数"),
              value: t("{count} 个", { count: selectedWebAction.params.length }),
            });
          }
        } else if (toolKey) {
          toolWarnings.push(t("引用的网页动作不存在：{key}", { key: toolKey }));
        } else if (webActions.length > 0) {
          toolWarnings.push(t("请选择一个已有网页动作。"));
        } else {
          toolWarnings.push(t("暂无可引用网页动作，请先到运行环境的网页动作面板创建。"));
        }
        if (actionValue === "run") {
          toolWarnings.push(t("执行动作会触发网页自动化，建议先在网页动作面板检查。"));
        }
      } else if (toolConfig.value === "runtime") {
        if (selectedProject) {
          toolMetaItems.push({ label: t("项目"), value: selectedProject.name || selectedProject.key });
        } else if (toolKey) {
          toolWarnings.push(t("引用的项目不存在：{key}", { key: toolKey }));
        } else {
          toolWarnings.push(t("请选择一个项目作为运行入口。"));
        }
        if (runtimeProfileKey) {
          if (selectedRuntimeProfile) {
            toolMetaItems.push({
              label: t("运行环境"),
              value: selectedRuntimeProfile.label || selectedRuntimeProfile.key,
            });
          } else {
            toolWarnings.push(t("运行环境不存在：{key}", { key: runtimeProfileKey }));
          }
        }
      } else if (toolKey) {
        toolMetaItems.push({ label: t("引用"), value: toolKey });
      } else {
        toolWarnings.push(t("请填写 {label}。", { label: t(toolConfig.keyLabel) }));
      }

      const renderToolKeyField = () => {
        if (toolConfig.keySource === "action") {
          const hasCurrent = resourceActions.some((item) => item.key === entry.toolKey);
          return (
            <TextField
              select
              size="small"
              label={t(toolConfig.keyLabel)}
              value={entry.toolKey ?? ""}
              helperText={t("Action 定义集中保存在当前配置源的 actions.toml。")}
              onChange={(event) =>
                updateEntryAt(categoryIndex, entryIndex, { toolKey: event.target.value })
              }
            >
              <MenuItem value="">{t("未选择")}</MenuItem>
              {!hasCurrent && entry.toolKey?.trim() ? (
                <MenuItem value={entry.toolKey}>
                  {t("自定义：{value}", { value: entry.toolKey })}
                </MenuItem>
              ) : null}
              {resourceActions.map((action) => (
                <MenuItem key={action.key} value={action.key}>
                  {action.name || action.key} · {t("{count} 个参数", { count: action.paramCount })}
                </MenuItem>
              ))}
            </TextField>
          );
        }

        if (toolConfig.keySource === "webAction") {
          const hasCurrent = webActions.some((item) => item.key === entry.toolKey);
          return (
            <TextField
              select
              size="small"
              label={t(toolConfig.keyLabel)}
              value={entry.toolKey ?? ""}
              helperText={
                webActions.length > 0
                  ? t("只引用已有网页动作；脚本和受控页面请到运行环境的网页动作面板维护。")
                  : t("暂无可引用网页动作，请先到运行环境的网页动作面板创建。")
              }
              onChange={(event) =>
                updateEntryAt(categoryIndex, entryIndex, { toolKey: event.target.value })
              }
            >
              <MenuItem value="">{t("未选择")}</MenuItem>
              {!hasCurrent && entry.toolKey?.trim() ? (
                <MenuItem value={entry.toolKey}>
                  {t("自定义：{value}", { value: entry.toolKey })}
                </MenuItem>
              ) : null}
              {webActions.map((action) => (
                <MenuItem key={action.key} value={action.key}>
                  {action.name || action.key} · {webActionKindLabel(action.kind, t)}
                </MenuItem>
              ))}
            </TextField>
          );
        }

        if (toolConfig.keySource === "project" && projects.length > 0) {
          const hasCurrent = projects.some((item) => item.key === entry.toolKey);
          return (
            <TextField
              select
              size="small"
              label={t(toolConfig.keyLabel)}
              value={entry.toolKey ?? ""}
              helperText={t(toolConfig.keyPlaceholder)}
              onChange={(event) =>
                updateEntryAt(categoryIndex, entryIndex, { toolKey: event.target.value })
              }
            >
              <MenuItem value="">{t("未选择")}</MenuItem>
              {!hasCurrent && entry.toolKey?.trim() ? (
                <MenuItem value={entry.toolKey}>
                  {t("自定义：{value}", { value: entry.toolKey })}
                </MenuItem>
              ) : null}
              {projects.map((project) => (
                <MenuItem key={project.key} value={project.key}>
                  {project.name || project.key}
                </MenuItem>
              ))}
            </TextField>
          );
        }

        return (
          <TextField
            size="small"
            label={t(toolConfig.keyLabel)}
            placeholder={t(toolConfig.keyPlaceholder)}
            value={entry.toolKey ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { toolKey: event.target.value })
            }
          />
        );
      };

      return (
        <>
          <TextField
            select
            size="small"
            label={t("工具类型")}
            value={toolValue}
            onChange={(event) => {
              const nextTool = event.target.value;
              if (nextTool === "__custom__") {
                return;
              }
              const nextConfig = navigationToolConfig(nextTool);
              updateEntryAt(categoryIndex, entryIndex, {
                tool: nextTool,
                toolAction: nextConfig.defaultAction,
              });
            }}
          >
            {NAVIGATION_TOOL_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {t(item.label)}
              </MenuItem>
            ))}
            {toolValue === "__custom__" ? (
              <MenuItem value="__custom__">{entry.tool || t("自定义工具")}</MenuItem>
            ) : null}
          </TextField>
          {renderToolKeyField()}
          <TextField
            select
            size="small"
            label={t("动作")}
            value={actionValue}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { toolAction: event.target.value })
            }
          >
            {actionOptions.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {t(item.label)}
              </MenuItem>
            ))}
          </TextField>
          {toolConfig.showRuntimeProfile ? (
            <TextField
              select
              size="small"
              label={t("运行环境")}
              value={entry.runtimeProfile ?? ""}
              onChange={(event) =>
                updateEntryAt(categoryIndex, entryIndex, {
                  runtimeProfile: event.target.value || null,
                })
              }
            >
              <MenuItem value="">{t("不使用")}</MenuItem>
              {runtimeProfiles.map((profile) => (
                <MenuItem key={profile.key} value={profile.key}>
                  {profile.label || profile.key}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <div className="resource-config-tool-hint settings-form-grid-wide">
            <div>
              <Typography variant="caption">{t(toolConfig.label)}</Typography>
              <Typography variant="caption">{t(toolConfig.description)}</Typography>
              <div className="resource-config-tool-meta">
                {toolMetaItems.map((item) => (
                  <span key={`${item.label}-${item.value}`}>
                    <b>{item.label}</b>
                    {item.value}
                  </span>
                ))}
              </div>
              {toolWarnings.length > 0 ? (
                <div className="resource-config-tool-warnings">
                  {toolWarnings.map((warning) => (
                    <Typography key={warning} variant="caption">
                      {warning}
                    </Typography>
                  ))}
                </div>
              ) : null}
            </div>
            {currentTool === "link" ? (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={
                  toolKey ? <EditIcon fontSize="small" /> : <PlusIcon fontSize="small" />
                }
                onClick={() => openLinkWizardForEntry(categoryIndex, entryIndex)}
                disabled={saving || !sourceAllowsLink}
              >
                {t(toolKey ? "编辑链路" : "新建链路")}
              </Button>
            ) : null}
            {currentTool === "action" && resourceActionConfigPath ? (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<OpenExternalIcon fontSize="small" />}
                onClick={() =>
                  void invoke("open_local_path", { path: resourceActionConfigPath })
                }
                disabled={saving}
              >
                {t("打开 Action 配置")}
              </Button>
            ) : null}
          </div>
        </>
      );
    }

    if (entry.kind === "directory" || entry.kind === "file") {
      const directory = entry.kind === "directory";
      return (
        <div className="settings-path-field settings-form-grid-wide">
          <TextField
            size="small"
            label={t(directory ? "目录路径" : "文件路径")}
            value={entry.path ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { path: event.target.value })
            }
          />
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FolderIcon fontSize="small" />}
            onClick={() => void choosePath(categoryIndex, entryIndex, directory)}
            disabled={saving}
          >
            {t("选择")}
          </Button>
        </div>
      );
    }

    const browserSelectValue = navigationBrowserSelectValue(entry.browser);
    const browserSupportsProfile = navigationBrowserSupportsProfile(entry.browser);
    const isCustomBrowser = browserSelectValue === CUSTOM_NAVIGATION_BROWSER_VALUE;

    return (
      <>
        <TextField
          className="settings-form-grid-wide"
          size="small"
          label="URL"
          value={entry.url ?? ""}
          onChange={(event) =>
            updateEntryAt(categoryIndex, entryIndex, { url: event.target.value })
          }
        />
        <div className="settings-browser-route settings-form-grid-wide">
          <div className="settings-browser-route-head">
            <div>
              <Typography variant="caption">{t("打开方式")}</Typography>
              <Typography variant="caption">
                {t("默认沿用当前 Chrome；指定 Chrome / Edge 时可填写 Profile。")}
              </Typography>
            </div>
            <Chip size="small" label={navigationBrowserLabel(entry, t)} variant="outlined" />
          </div>
          <div className="settings-form-grid settings-form-grid-tight">
            <TextField
              select
              size="small"
              label={t("运行环境")}
              value={entry.runtimeProfile ?? ""}
              onChange={(event) =>
                updateEntryAt(categoryIndex, entryIndex, {
                  runtimeProfile: event.target.value || null,
                })
              }
            >
              <MenuItem value="">{t("不使用")}</MenuItem>
              {runtimeProfiles.map((profile) => (
                <MenuItem key={profile.key} value={profile.key}>
                  {profile.label || profile.key}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t("浏览器")}
              value={browserSelectValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "current_chrome") {
                  updateEntryAt(categoryIndex, entryIndex, {
                    browser: null,
                    browserProfile: null,
                  });
                  return;
                }
                if (nextValue === CUSTOM_NAVIGATION_BROWSER_VALUE) {
                  updateEntryAt(categoryIndex, entryIndex, {
                    browser: isCustomBrowser ? entry.browser : "",
                    browserProfile: null,
                  });
                  return;
                }
                updateEntryAt(categoryIndex, entryIndex, {
                  browser: nextValue,
                  browserProfile: navigationBrowserSupportsProfile(nextValue)
                    ? entry.browserProfile
                    : null,
                });
              }}
            >
              {NAVIGATION_BROWSER_OPTIONS.map((item) => (
                <MenuItem key={item.value} value={item.value}>
                  {t(item.label)}
                </MenuItem>
              ))}
              <MenuItem value={CUSTOM_NAVIGATION_BROWSER_VALUE}>
                {t("自定义应用名")}
              </MenuItem>
            </TextField>
            {isCustomBrowser ? (
              <TextField
                size="small"
                label={t("浏览器应用")}
                value={entry.browser ?? ""}
                onChange={(event) =>
                  updateEntryAt(categoryIndex, entryIndex, {
                    browser: event.target.value,
                    browserProfile: navigationBrowserSupportsProfile(event.target.value)
                      ? entry.browserProfile
                      : null,
                  })
                }
              />
            ) : null}
            {browserSupportsProfile ? (
              <TextField
                size="small"
                label="Profile"
                value={entry.browserProfile ?? ""}
                helperText={t("例如 Default 或 Profile 2")}
                onChange={(event) =>
                  updateEntryAt(categoryIndex, entryIndex, {
                    browserProfile: event.target.value,
                  })
                }
              />
            ) : null}
          </div>
        </div>
      </>
    );
  }

  function renderEntryEditor(
    categoryIndex: number,
    entry: NavigationEditorEntry,
    entryIndex: number,
  ) {
    const kindLabel = navigationEntryKindLabel(entry.kind, t);

    return (
      <div className="settings-param-editor settings-finder-entry" key={`${categoryIndex}-${entryIndex}`}>
        <div className="settings-param-editor-head">
          <div className="settings-finder-entry-title">
            <Typography variant="caption">{entry.name || t("未命名入口")}</Typography>
            <Chip size="small" label={kindLabel} variant="outlined" />
          </div>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<TrashIcon fontSize="small" />}
            onClick={() => deleteEntryAt(categoryIndex, entryIndex)}
            disabled={saving}
          >
            {t("删除")}
          </Button>
        </div>
        <div className="settings-form-grid settings-form-grid-tight">
          <TextField
            size="small"
            label={t("名称")}
            value={entry.name}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { name: event.target.value })
            }
          />
          <TextField
            select
            size="small"
            label={t("类型")}
            value={entry.kind}
            onChange={(event) => {
              const kind = event.target.value as NavigationEditorEntryKind;
              updateEntryAt(categoryIndex, entryIndex, {
                kind,
                tool: kind === "tool" ? entry.tool ?? "link" : entry.tool,
                toolAction: kind === "tool" ? entry.toolAction ?? "plan" : entry.toolAction,
              });
            }}
          >
            {NAVIGATION_ENTRY_KIND_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {t(item.label)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            className="settings-form-grid-wide"
            select
            size="small"
            label={t("所属分类")}
            value={categoryIndex}
            onChange={(event) => {
              const nextCategoryIndex = Number(event.target.value);
              if (nextCategoryIndex === -1) {
                moveEntryToNewCategory(categoryIndex, entryIndex);
                return;
              }
              moveEntryToCategory(categoryIndex, entryIndex, nextCategoryIndex);
            }}
          >
            {editor?.categories.map((category, index) => (
              <MenuItem key={`${category.title}-${index}`} value={index}>
                {category.title || t("未命名分类")}
              </MenuItem>
            ))}
            <MenuItem value={-1}>{t("新建分类")}</MenuItem>
          </TextField>
          {renderEntryTargetFields(entry, categoryIndex, entryIndex)}
          <TextField
            className="resource-config-note-field settings-form-grid-wide"
            size="small"
            label={t("备注")}
            multiline
            minRows={3}
            value={entry.note ?? ""}
            onChange={(event) =>
              updateEntryAt(categoryIndex, entryIndex, { note: event.target.value })
            }
          />
        </div>
      </div>
    );
  }

  function navigationEntryTargetSummary(entry: NavigationEditorEntry) {
    if (entry.kind === "directory" || entry.kind === "file") {
      return (
        entry.path?.trim() || t(entry.kind === "directory" ? "未配置目录路径" : "未配置文件路径")
      );
    }
    if (entry.kind === "app") {
      return entry.bundleId?.trim() || entry.appName?.trim() || t("未配置应用");
    }
    if (entry.kind === "script") {
      return entry.script?.trim() || entry.cwd?.trim() || t("未配置脚本路径");
    }
    if (entry.kind === "tool") {
      const toolConfig = navigationToolConfig(entry.tool);
      const key = entry.toolKey?.trim();
      return key
        ? [toolConfig.label, key, entry.runtimeProfile?.trim()].filter(Boolean).join(" · ")
        : t("未配置工具 Key");
    }
    return entry.url?.trim() || t("未配置 URL");
  }

  function navigationEntryReady(entry: NavigationEditorEntry) {
    if (!entry.name.trim()) {
      return false;
    }
    if (entry.kind === "directory" || entry.kind === "file") {
      return Boolean(entry.path?.trim());
    }
    if (entry.kind === "app") {
      return Boolean(entry.bundleId?.trim() || entry.appName?.trim());
    }
    if (entry.kind === "script") {
      return Boolean(entry.script?.trim());
    }
    if (entry.kind === "tool") {
      return Boolean(entry.toolKey?.trim());
    }
    return Boolean(entry.url?.trim());
  }

  function renderEntryListItem(
    entry: NavigationEditorEntry,
    categoryIndex: number,
    entryIndex: number,
    category: NavigationEditorCategory,
  ) {
    const selected = categoryIndex === selectedCategoryIndex && entryIndex === selectedEntryIndex;
    const kindLabel = navigationEntryKindLabel(entry.kind, t);
    const toolLabel = entry.kind === "tool" ? t(navigationToolConfig(entry.tool).label) : null;
    const ready = navigationEntryReady(entry);
    const categoryLabel = category.shortLabel?.trim() || category.title?.trim();

    return (
      <button
        key={`${categoryIndex}-${entry.name}-${entry.kind}-${entryIndex}`}
        type="button"
        className={[
          "resource-config-entry-row",
          selected ? "is-active" : "",
          ready ? "" : "is-incomplete",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          setSelectedCategoryIndex(categoryIndex);
          setSelectedEntryIndex(entryIndex);
        }}
      >
        <span className="resource-config-entry-icon" aria-hidden="true">
          {toolLabel?.slice(0, 1) || kindLabel.slice(0, 1)}
        </span>
        <span className="resource-config-entry-main">
          <span className="resource-config-entry-title-line">
            <span className="resource-config-entry-name">{entry.name || t("未命名入口")}</span>
            <span className={`resource-config-entry-kind is-${entry.kind}`}>{kindLabel}</span>
            {toolLabel ? (
              <span className="resource-config-entry-kind is-tool-type">{toolLabel}</span>
            ) : null}
            {categoryLabel ? (
              <span className="resource-config-entry-kind is-category">{categoryLabel}</span>
            ) : null}
          </span>
          <span className="resource-config-entry-target">{navigationEntryTargetSummary(entry)}</span>
        </span>
        <span className={ready ? "resource-config-entry-status" : "resource-config-entry-status is-warn"}>
          {t(ready ? "可用" : "待补")}
        </span>
      </button>
    );
  }

  const categoryCount = editor?.categories.length ?? 0;

  return (
    <>
      <ConfigDialogShell
        open={open}
        onClose={handleClose}
        maxWidth="lg"
        className="resource-config-dialog"
        paperClassName="resource-config-dialog-paper"
        titleClassName="resource-config-dialog-title"
        contentClassName="resource-config-dialog-content"
        actionsClassName="resource-config-dialog-actions"
        title={t("资源入口配置")}
        subtitle={t("网站、目录、应用、脚本和工具入口")}
        dirty={dirty}
        closeDisabled={saving}
        actions={(requestClose) => (
          <>
            <span className="resource-config-dialog-actions-spacer" />
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<OpenExternalIcon fontSize="small" />}
              onClick={() => void openSelectedNavigationConfigFile()}
            >
              {t("打开文件")}
            </Button>
            <Button onClick={requestClose}>{t("取消")}</Button>
            <Button
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              onClick={() => void saveNavigationEditor()}
              disabled={!editor || !dirty || saving}
            >
              {t("保存")}
            </Button>
          </>
        )}
      >
        <AppToast
          message={error || status}
          severity={error ? "error" : "success"}
          autoHideDuration={error ? 5200 : 2800}
          nonce={toastNonce}
        />
        {configSources.length > 0 ? (
          <ConfigSourceBar
            sources={configSources}
            selectedSourceId={selectedSourceId}
            selectedSource={selectedConfigSource}
            path={editor?.filePath || selectedConfigSource?.files.navigation}
            requiredCapability="resource"
            warningLabel={!sourceAllowsLink ? t("不支持链路") : null}
            disabled={loading || saving || sourceBusy}
            status={sourceStatus}
            error={sourceError}
            manageDisabled={dirty}
            onSourceChange={(sourceId) => void handleSourceChange(sourceId)}
            onManage={() => setConfigSourceManagerOpen(true)}
          />
        ) : null}
        {loading && !editor ? (
          <Alert severity="info">{t("正在读取资源入口配置")}</Alert>
        ) : null}
        {!loading && !editor ? (
          <Stack spacing={1.2}>
            <AppEmptyState
              compact
              title={t("暂无资源入口配置")}
              description={t("读取配置后可维护快捷入口。")}
            />
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => void loadNavigationEditor()}
              disabled={loading}
            >
              {t("重新读取")}
            </Button>
          </Stack>
        ) : null}
        {editor ? (
          <Stack className="settings-overview" spacing={1.2}>
            {categoryCount === 0 ? (
              <Stack spacing={1.2}>
                <AppEmptyState
                  compact
                  title={t("暂无资源分类")}
                  description={t("先新增一个入口，App 会自动创建默认分类。")}
                />
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<PlusIcon fontSize="small" />}
                  onClick={() => addCategory()}
                  disabled={saving}
                >
                  {t("新增入口")}
                </Button>
              </Stack>
            ) : null}

            {categoryCount > 0 ? (
              <div className="resource-config-workspace">
                <aside className="resource-config-list-panel">
                  <div className="resource-config-list-head">
                    <div>
                      <Typography variant="subtitle2">{t("入口")}</Typography>
                      <Typography variant="caption">
                        {t("{visible}/{total} 个", {
                          visible: visibleEntryItems.length,
                          total: allEntryItems.length,
                        })}
                      </Typography>
                    </div>
                    <div className="resource-config-add-entry">
                      <Button
                        variant="outlined"
                        color="inherit"
                        startIcon={<PlusIcon fontSize="small" />}
                        onClick={() => addEntry(activeCategoryIndex)}
                        disabled={saving}
                      >
                        {t("新增")}
                      </Button>
                    </div>
                  </div>
                  <TextField
                    size="small"
                    value={entryQuery}
                    placeholder={t("搜索名称、类型、URL 或路径")}
                    onChange={(event) => setEntryQuery(event.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  <div
                    className="resource-config-kind-filter"
                    aria-label={t("入口类型筛选")}
                  >
                    <button
                      type="button"
                      className={entryKindFilter === "all" ? "is-active" : ""}
                      onClick={() => setEntryKindFilter("all")}
                    >
                      {t("全部")}
                    </button>
                    {NAVIGATION_ENTRY_KIND_OPTIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={entryKindFilter === item.value ? "is-active" : ""}
                        onClick={() => setEntryKindFilter(item.value)}
                      >
                        {t(item.label)}
                      </button>
                    ))}
                  </div>
                  <div className="resource-config-entry-list">
                    {visibleEntryItems.length === 0 ? (
                      <div className="settings-empty-row">{t("没有匹配入口")}</div>
                    ) : (
                      visibleEntryItems.map(({ category, categoryIndex, entry, entryIndex }) =>
                        renderEntryListItem(entry, categoryIndex, entryIndex, category),
                      )
                    )}
                    {visibleEntryItems.length > 0 ? (
                      <div className="resource-config-list-end">{t("没有更多了")}</div>
                    ) : null}
                  </div>
                </aside>
                <section className="resource-config-detail-panel">
                  {selectedEntry ? (
                    renderEntryEditor(activeCategoryIndex, selectedEntry, selectedEntryIndex)
                  ) : (
                    <AppEmptyState
                      compact
                      title={t("请选择入口")}
                      description={t("从左侧选择入口后，在这里编辑完整配置。")}
                    />
                  )}
                </section>
              </div>
            ) : null}
          </Stack>
        ) : null}
      </ConfigDialogShell>
      <LinkToolWizardDialog
        open={Boolean(linkWizardTarget)}
        activeProjectWorkspaceKey={activeProjectWorkspaceKey}
        projectWorkspaces={projectWorkspaces}
        projects={projects}
        webActions={webActions}
        initialLinkKey={linkWizardTarget?.linkKey}
        onClose={() => setLinkWizardTarget(null)}
        onSaved={handleLinkWizardSaved}
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
              await Promise.all([
                loadNavigationEditor(source.id),
                loadToolLookups(source.id),
              ]);
            }
          } catch (reason) {
            showError(String(reason));
          }
        }}
      />
    </>
  );
}
