import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type {
  NavigationEditorCategory,
  NavigationEditorEntry,
  NavigationEditorEntryKind,
} from "../app-types";
import { useI18n } from "../i18n";
import {
  ActionIcon,
  AppWindowIcon,
  CheckIcon,
  CopyIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  TerminalIcon,
  TrashIcon,
  WebsiteIcon,
} from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";

const ENTRY_KINDS: Array<{ value: NavigationEditorEntryKind; label: string }> = [
  { value: "url", label: "网站" },
  { value: "directory", label: "目录" },
  { value: "file", label: "文件" },
  { value: "app", label: "应用" },
  { value: "script", label: "脚本" },
  { value: "tool", label: "工具" },
];

const TOOL_TYPES = ["link", "action", "workflow", "webAction", "runtime"];

const TOOL_ACTIONS = [
  "open",
  "plan",
  "run",
  "inspect",
  "start",
  "focus",
  "stop",
];

function emptyEntry(kind: NavigationEditorEntryKind = "url"): NavigationEditorEntry {
  return {
    name: "",
    kind,
    url: null,
    browser: kind === "url" ? "current_chrome" : null,
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

function isManagedResource(
  category: NavigationEditorCategory,
  entry: NavigationEditorEntry,
) {
  return (
    category.title === "工作区资料" &&
    (entry.name === "资料目录" || entry.name === "工作日志")
  );
}

function kindIcon(kind: NavigationEditorEntryKind) {
  switch (kind) {
    case "directory":
      return <FolderIcon fontSize="small" />;
    case "file":
      return <FileIcon fontSize="small" />;
    case "app":
      return <AppWindowIcon fontSize="small" />;
    case "script":
      return <TerminalIcon fontSize="small" />;
    case "tool":
      return <ActionIcon fontSize="small" />;
    default:
      return <WebsiteIcon fontSize="small" />;
  }
}

function entryTarget(entry: NavigationEditorEntry) {
  switch (entry.kind) {
    case "url":
      return entry.url;
    case "directory":
    case "file":
      return entry.path;
    case "app":
      return entry.appName || entry.bundleId;
    case "script":
      return entry.script;
    case "tool":
      return [entry.tool, entry.toolKey, entry.toolAction].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

function uniqueCategoryTitle(categories: NavigationEditorCategory[]) {
  const used = new Set(categories.map((category) => category.title.trim()));
  let index = categories.length + 1;
  let title = `新分类 ${index}`;
  while (used.has(title)) {
    index += 1;
    title = `新分类 ${index}`;
  }
  return title;
}

function uniqueEntryName(category: NavigationEditorCategory, base: string) {
  const used = new Set(category.entries.map((entry) => entry.name.trim()));
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

type WorkspaceResourceEditorProps = {
  categories: NavigationEditorCategory[];
  disabled?: boolean;
  onChange: (categories: NavigationEditorCategory[]) => void;
};

export function WorkspaceResourceEditor({
  categories,
  disabled = false,
  onChange,
}: WorkspaceResourceEditorProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<number | null>(null);
  const resourceCount = useMemo(
    () => categories.reduce((total, category) => total + category.entries.length, 0),
    [categories],
  );

  function updateCategory(
    categoryIndex: number,
    patch: Partial<NavigationEditorCategory>,
  ) {
    onChange(
      categories.map((category, index) =>
        index === categoryIndex ? { ...category, ...patch } : category,
      ),
    );
  }

  function updateEntry(
    categoryIndex: number,
    entryIndex: number,
    patch: Partial<NavigationEditorEntry>,
  ) {
    updateCategory(categoryIndex, {
      entries: categories[categoryIndex].entries.map((entry, index) =>
        index === entryIndex ? { ...entry, ...patch } : entry,
      ),
    });
  }

  function addCategory() {
    const title = uniqueCategoryTitle(categories);
    const categoryIndex = categories.length;
    onChange([
      ...categories,
      { title, shortLabel: title, entries: [] },
    ]);
    setEditingCategory(categoryIndex);
  }

  function addEntry(categoryIndex: number) {
    const category = categories[categoryIndex];
    const entryIndex = category.entries.length;
    updateCategory(categoryIndex, {
      entries: [
        ...category.entries,
        {
          ...emptyEntry(),
          name: uniqueEntryName(category, t("新入口")),
        },
      ],
    });
    setEditing(`${categoryIndex}:${entryIndex}`);
  }

  function duplicateEntry(categoryIndex: number, entryIndex: number) {
    const category = categories[categoryIndex];
    const source = category.entries[entryIndex];
    const nextIndex = category.entries.length;
    updateCategory(categoryIndex, {
      entries: [
        ...category.entries,
        {
          ...source,
          name: uniqueEntryName(category, `${source.name} ${t("副本")}`),
        },
      ],
    });
    setEditing(`${categoryIndex}:${nextIndex}`);
  }

  function deleteEntry(categoryIndex: number, entryIndex: number) {
    updateCategory(categoryIndex, {
      entries: categories[categoryIndex].entries.filter(
        (_, index) => index !== entryIndex,
      ),
    });
    setEditing(null);
  }

  async function chooseEntryPath(
    categoryIndex: number,
    entryIndex: number,
    directory: boolean,
  ) {
    const entry = categories[categoryIndex].entries[entryIndex];
    const selected = await openDialog({
      directory,
      multiple: false,
      defaultPath: entry.path || entry.script || entry.cwd || undefined,
    });
    if (typeof selected !== "string" || !selected.trim()) {
      return;
    }
    updateEntry(
      categoryIndex,
      entryIndex,
      entry.kind === "script" ? { script: selected } : { path: selected },
    );
  }

  return (
    <Stack className="workspace-resource-editor" spacing={0.5}>
      <Stack
        className="workspace-resource-editor-head"
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
        spacing={0.5}
      >
        <Stack className="workspace-resource-editor-title" spacing={0} minWidth={0}>
          <Stack direction="row" alignItems="center" spacing={0.6}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {t("工作区专属资源")}
            </Typography>
            <Chip className="workspace-resource-count" size="small" label={resourceCount} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {t("仅属于当前工作区；保存后会同步到首页资源和工具区域。")}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PlusIcon fontSize="small" />}
          onClick={addCategory}
          disabled={disabled}
        >
          {t("新增分类")}
        </Button>
      </Stack>

      {categories.length === 0 ? (
        <Stack spacing={0.4} alignItems="flex-start">
          <AppEmptyState
            compact
            title={t("暂无工作区专属资源")}
            description={t("新增分类后，可添加网站、目录、文件、应用、脚本或工具入口。")}
          />
          <Button
            size="small"
            startIcon={<PlusIcon fontSize="small" />}
            onClick={addCategory}
            disabled={disabled}
          >
            {t("新增分类")}
          </Button>
        </Stack>
      ) : null}

      {categories.map((category, categoryIndex) => {
        const categoryManaged = category.entries.some((entry) =>
          isManagedResource(category, entry),
        );
        return (
          <Box
            key={categoryIndex}
            className="workspace-resource-category"
            sx={(theme) => ({
              border: "1px solid",
              borderColor: theme.palette.divider,
              borderRadius: "8px",
              overflow: "hidden",
              bgcolor: alpha(theme.palette.background.paper, 0.34),
            })}
          >
            <Stack
              className="workspace-resource-category-head"
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={0.45}
              sx={(theme) => ({
                px: 0.65,
                py: 0.45,
                borderBottom: category.entries.length ? "1px solid" : 0,
                borderColor: theme.palette.divider,
                bgcolor: alpha(theme.palette.text.primary, 0.018),
              })}
            >
              {editingCategory === categoryIndex && !categoryManaged ? (
                <>
                  <TextField
                    className="workspace-resource-category-name"
                    size="small"
                    label={t("分类名称")}
                    value={category.title}
                    onChange={(event) =>
                      updateCategory(categoryIndex, { title: event.target.value })
                    }
                    disabled={disabled}
                    sx={{ flex: 1.4 }}
                  />
                  <TextField
                    className="workspace-resource-category-label"
                    size="small"
                    label={t("短标签")}
                    value={category.shortLabel}
                    onChange={(event) =>
                      updateCategory(categoryIndex, { shortLabel: event.target.value })
                    }
                    disabled={disabled}
                    sx={{ flex: 0.7 }}
                  />
                </>
              ) : (
                <Stack
                  className="workspace-resource-category-copy"
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  minWidth={0}
                  flex={1}
                >
                  <Box className="workspace-resource-category-icon">
                    <FolderIcon fontSize="small" />
                  </Box>
                  <Typography variant="subtitle2" noWrap>
                    {category.title || t("未命名分类")}
                  </Typography>
                  <Chip
                    className="workspace-resource-category-chip"
                    size="small"
                    variant="outlined"
                    label={category.shortLabel || t("无短标签")}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {category.entries.length}
                  </Typography>
                </Stack>
              )}
              <Stack
                className="workspace-resource-category-actions"
                direction="row"
                spacing={0.1}
                justifyContent="flex-end"
              >
                {!categoryManaged ? (
                  <Tooltip
                    title={
                      editingCategory === categoryIndex
                        ? t("完成分类编辑")
                        : t("编辑分类")
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        onClick={() =>
                          setEditingCategory((current) =>
                            current === categoryIndex ? null : categoryIndex,
                          )
                        }
                        disabled={disabled}
                        aria-label={t("编辑分类 {name}", { name: category.title })}
                      >
                        {editingCategory === categoryIndex ? (
                          <CheckIcon fontSize="small" />
                        ) : (
                          <EditIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
                <Tooltip title={t("新增资源")}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => addEntry(categoryIndex)}
                      disabled={disabled}
                      aria-label={t("向 {name} 添加资源", { name: category.title })}
                    >
                      <PlusIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip
                  title={
                    categoryManaged
                      ? t("包含系统生成资源的分类不能删除")
                      : t("删除分类")
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        onChange(
                          categories.filter((_, index) => index !== categoryIndex),
                        );
                        setEditingCategory(null);
                      }}
                      disabled={disabled || categoryManaged}
                      aria-label={t("删除分类 {name}", { name: category.title })}
                    >
                      <TrashIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            {category.entries.length === 0 ? (
              <Button
                size="small"
                startIcon={<PlusIcon fontSize="small" />}
                onClick={() => addEntry(categoryIndex)}
                disabled={disabled}
                sx={{ m: 0.65 }}
              >
                {t("新增资源")}
              </Button>
            ) : null}

            {category.entries.map((entry, entryIndex) => {
              const key = `${categoryIndex}:${entryIndex}`;
              const managed = isManagedResource(category, entry);
              const expanded = editing === key;
              return (
                <Box
                  key={key}
                  className="workspace-resource-row"
                  sx={(theme) => ({
                    px: 0.65,
                    py: 0.45,
                    borderTop: entryIndex ? "1px solid" : 0,
                    borderColor: theme.palette.divider,
                  })}
                >
                  <Stack direction="row" alignItems="center" spacing={0.7}>
                    <Box
                      className="workspace-resource-entry-icon"
                      sx={(theme) => ({
                        width: 26,
                        height: 26,
                        flex: "0 0 26px",
                        display: "grid",
                        placeItems: "center",
                        borderRadius: "7px",
                        color: theme.palette.primary.main,
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                      })}
                    >
                      {kindIcon(entry.kind)}
                    </Box>
                    <Stack className="workspace-resource-entry-copy" spacing={0} minWidth={0} flex={1}>
                      <Stack direction="row" spacing={0.45} alignItems="center" minWidth={0}>
                        <Typography className="workspace-resource-entry-name" variant="body2" fontWeight={760} noWrap>
                          {entry.name || t("未命名资源")}
                        </Typography>
                        {managed ? (
                          <Chip
                            className="workspace-resource-origin-chip"
                            size="small"
                            label={t("系统生成")}
                          />
                        ) : null}
                      </Stack>
                      <Typography className="workspace-resource-entry-target" variant="caption" color="text.secondary" noWrap>
                        {entryTarget(entry) || entry.note || t("待配置")}
                      </Typography>
                    </Stack>
                    {!managed ? (
                      <Stack className="workspace-resource-entry-actions" direction="row" spacing={0.05}>
                        <Tooltip title={expanded ? t("收起编辑") : t("编辑资源")}>
                          <IconButton
                            size="small"
                            onClick={() => setEditing(expanded ? null : key)}
                            disabled={disabled}
                            aria-label={t("编辑资源 {name}", { name: entry.name })}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("复制资源")}>
                          <IconButton
                            size="small"
                            onClick={() => duplicateEntry(categoryIndex, entryIndex)}
                            disabled={disabled}
                            aria-label={t("复制资源 {name}", { name: entry.name })}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("删除资源")}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => deleteEntry(categoryIndex, entryIndex)}
                            disabled={disabled}
                            aria-label={t("删除资源 {name}", { name: entry.name })}
                          >
                            <TrashIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ) : null}
                  </Stack>

                  {expanded && !managed ? (
                    <Box
                      className="workspace-resource-entry-fields"
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", md: "1.2fr 0.8fr" },
                        gap: 0.5,
                        pt: 0.55,
                        pl: { xs: 0, sm: 4.1 },
                      }}
                    >
                      <TextField
                        size="small"
                        label={t("名称")}
                        value={entry.name}
                        onChange={(event) =>
                          updateEntry(categoryIndex, entryIndex, { name: event.target.value })
                        }
                        disabled={disabled}
                      />
                      <TextField
                        select
                        size="small"
                        label={t("类型")}
                        value={entry.kind}
                        onChange={(event) =>
                          updateEntry(categoryIndex, entryIndex, {
                            kind: event.target.value as NavigationEditorEntryKind,
                          })
                        }
                        disabled={disabled}
                      >
                        {ENTRY_KINDS.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {t(option.label)}
                          </MenuItem>
                        ))}
                      </TextField>

                      {entry.kind === "url" ? (
                        <>
                          <TextField
                            size="small"
                            label="URL"
                            value={entry.url ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { url: event.target.value })
                            }
                            disabled={disabled}
                            sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                          />
                          <TextField
                            size="small"
                            label={t("浏览器")}
                            value={entry.browser ?? "current_chrome"}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { browser: event.target.value })
                            }
                            disabled={disabled}
                          />
                          <TextField
                            size="small"
                            label={t("浏览器 Profile")}
                            value={entry.browserProfile ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, {
                                browserProfile: event.target.value,
                              })
                            }
                            disabled={disabled}
                          />
                        </>
                      ) : null}

                      {entry.kind === "directory" || entry.kind === "file" ? (
                        <TextField
                          size="small"
                          label={entry.kind === "directory" ? t("目录路径") : t("文件路径")}
                          value={entry.path ?? ""}
                          onChange={(event) =>
                            updateEntry(categoryIndex, entryIndex, { path: event.target.value })
                          }
                          disabled={disabled}
                          sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <Tooltip title={t("选择路径")}>
                                  <IconButton
                                    size="small"
                                    onClick={() =>
                                      void chooseEntryPath(
                                        categoryIndex,
                                        entryIndex,
                                        entry.kind === "directory",
                                      )
                                    }
                                    disabled={disabled}
                                    aria-label={t("选择路径")}
                                  >
                                    <FolderIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </InputAdornment>
                            ),
                          }}
                        />
                      ) : null}

                      {entry.kind === "app" ? (
                        <>
                          <TextField
                            size="small"
                            label={t("应用名")}
                            value={entry.appName ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { appName: event.target.value })
                            }
                            disabled={disabled}
                          />
                          <TextField
                            size="small"
                            label="Bundle ID"
                            value={entry.bundleId ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { bundleId: event.target.value })
                            }
                            disabled={disabled}
                          />
                        </>
                      ) : null}

                      {entry.kind === "script" ? (
                        <>
                          <TextField
                            size="small"
                            label={t("脚本路径")}
                            value={entry.script ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { script: event.target.value })
                            }
                            disabled={disabled}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <Tooltip title={t("选择脚本")}>
                                    <IconButton
                                      size="small"
                                      onClick={() =>
                                        void chooseEntryPath(categoryIndex, entryIndex, false)
                                      }
                                      disabled={disabled}
                                      aria-label={t("选择脚本")}
                                    >
                                      <FolderIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </InputAdornment>
                              ),
                            }}
                          />
                          <TextField
                            size="small"
                            label={t("工作目录")}
                            value={entry.cwd ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { cwd: event.target.value })
                            }
                            disabled={disabled}
                          />
                        </>
                      ) : null}

                      {entry.kind === "tool" ? (
                        <>
                          <TextField
                            select
                            size="small"
                            label={t("工具类型")}
                            value={entry.tool ?? "link"}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { tool: event.target.value })
                            }
                            disabled={disabled}
                          >
                            {TOOL_TYPES.map((tool) => (
                              <MenuItem key={tool} value={tool}>{tool}</MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            size="small"
                            label={t("工具 Key")}
                            value={entry.toolKey ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { toolKey: event.target.value })
                            }
                            disabled={disabled}
                          />
                          <TextField
                            select
                            size="small"
                            label={t("动作")}
                            value={entry.toolAction ?? "plan"}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, {
                                toolAction: event.target.value,
                              })
                            }
                            disabled={disabled}
                          >
                            {TOOL_ACTIONS.map((action) => (
                              <MenuItem key={action} value={action}>{action}</MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            size="small"
                            label={t("工作目录")}
                            value={entry.cwd ?? ""}
                            onChange={(event) =>
                              updateEntry(categoryIndex, entryIndex, { cwd: event.target.value })
                            }
                            disabled={disabled}
                          />
                        </>
                      ) : null}

                      <TextField
                        size="small"
                        label={t("备注")}
                        value={entry.note ?? ""}
                        onChange={(event) =>
                          updateEntry(categoryIndex, entryIndex, { note: event.target.value })
                        }
                        disabled={disabled}
                        sx={{ gridColumn: { xs: "auto", md: "1 / -1" } }}
                      />
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Stack>
  );
}
