import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import MarkdownIt from "markdown-it";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { AppEmptyState } from "../components/AppEmptyState";
import {
  CopyIcon,
  EditIcon,
  FolderIcon,
  KnowledgeIcon,
  MoreIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from "../components/AppIcons";
import { useI18n, type AppLanguage, type Translate } from "../i18n";

type KnowledgeScope =
  | "all"
  | "inbox"
  | "project"
  | "playbook"
  | "environment";
type CreatableKnowledgeScope = Exclude<KnowledgeScope, "all">;

type NoteDocumentSummary = {
  source: string;
  scope: Exclude<KnowledgeScope, "all"> | "root";
  projectKey?: string | null;
  title: string;
  summary: string;
  matchExcerpt?: string | null;
  path: string;
  relativePath: string;
  updatedAtMs?: number | null;
  score: number;
};

type NotesFileIndex = {
  schemaVersion: number;
  notesRoot: string;
  projectKey?: string | null;
  scope?: string | null;
  query?: string | null;
  scannedCount: number;
  matchedCount: number;
  truncated: boolean;
  documents: NoteDocumentSummary[];
};

type NoteDocument = {
  schemaVersion: number;
  summary: NoteDocumentSummary;
  content: string;
};

type CreateNoteDocumentResult = {
  created: boolean;
  document: NoteDocument;
};

type ResolveNoteDocumentLinkResult = {
  document: NoteDocument;
  fragment?: string | null;
};

type IndexRequest = {
  scope?: KnowledgeScope;
  project?: string;
  query?: string;
  selectPath?: string;
};

export type KnowledgePageProps = {
  projects: Array<{ key: string; name: string }>;
  selectedProject: string;
};

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

const PRIMARY_SCOPE_OPTIONS: Array<{
  value: Extract<KnowledgeScope, "project" | "playbook" | "environment">;
  label: string;
}> = [
  { value: "project", label: "项目" },
  { value: "playbook", label: "手册" },
  { value: "environment", label: "环境" },
];

const SECONDARY_SCOPE_OPTIONS: Array<{
  value: Extract<KnowledgeScope, "all" | "inbox">;
  label: string;
}> = [
  { value: "all", label: "全部知识" },
  { value: "inbox", label: "收件箱" },
];

const CREATE_SCOPE_OPTIONS: Array<{
  value: CreatableKnowledgeScope;
  label: string;
}> = [
  { value: "inbox", label: "收件箱" },
  { value: "project", label: "项目经验" },
  { value: "playbook", label: "通用手册" },
  { value: "environment", label: "环境约定" },
];

function scopeLabel(document: NoteDocumentSummary, t: Translate) {
  switch (document.scope) {
    case "inbox":
      return t("收件箱");
    case "project":
      return document.projectKey
        ? t("项目 · {key}", { key: document.projectKey })
        : t("项目");
    case "playbook":
      return t("通用手册");
    case "environment":
      return t("环境约定");
    default:
      return t("知识根目录");
  }
}

function formatUpdatedAt(value: number | null | undefined, language: AppLanguage) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function headingId(value: string) {
  const normalized = Array.from(value.trim().toLocaleLowerCase())
    .map((character) => {
      if (
        /[a-z0-9_-]/i.test(character) ||
        (character >= "\u3400" && character <= "\u9fff")
      ) {
        return character;
      }
      return /\s/.test(character) ? "-" : "";
    })
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "section";
}

markdown.renderer.rules.heading_open = (
  tokens,
  index,
  options,
  environment,
  renderer,
) => {
  const title = tokens[index + 1]?.content ?? "";
  const state = environment as { headingIds?: Map<string, number> };
  state.headingIds ??= new Map<string, number>();
  const baseId = headingId(title);
  const duplicateCount = state.headingIds.get(baseId) ?? 0;
  state.headingIds.set(baseId, duplicateCount + 1);
  tokens[index].attrSet(
    "id",
    duplicateCount === 0 ? baseId : `${baseId}-${duplicateCount + 1}`,
  );
  return renderer.renderToken(tokens, index, options);
};

function highlightText(value: string, activeQuery: string): ReactNode {
  const tokens = Array.from(
    new Set(
      activeQuery
        .trim()
        .split(/\s+/)
        .map((token) => token.toLocaleLowerCase())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);
  if (!value || tokens.length === 0) {
    return value;
  }
  const expression = new RegExp(
    `(${tokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "gi",
  );
  return value.split(expression).map((part, index) =>
    tokens.includes(part.toLocaleLowerCase()) ? (
      <mark key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  );
}

export function KnowledgePage({
  projects,
  selectedProject,
}: KnowledgePageProps) {
  const { language, t } = useI18n();
  const [scope, setScope] = useState<KnowledgeScope>(
    selectedProject ? "project" : "all",
  );
  const [notesProject, setNotesProject] = useState(selectedProject);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<NotesFileIndex | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [document, setDocument] = useState<NoteDocument | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createScope, setCreateScope] =
    useState<CreatableKnowledgeScope>("inbox");
  const [createProject, setCreateProject] = useState(selectedProject);
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [scopeMenuAnchor, setScopeMenuAnchor] =
    useState<HTMLElement | null>(null);
  const [readerMenuAnchor, setReaderMenuAnchor] =
    useState<HTMLElement | null>(null);
  const activeSecondaryScope = SECONDARY_SCOPE_OPTIONS.find(
    (option) => option.value === scope,
  );
  const secondaryScopeTooltip = activeSecondaryScope
    ? t("切换知识范围")
    : t("更多知识范围");
  const emptyIndexTitle = query ? t("没有匹配知识") : t("暂无知识文档");
  const emptyIndexDescription = query
    ? t("调整关键词或知识范围。")
    : t("新建一篇开始沉淀。");
  const createSubmitLabel = creating ? t("正在创建") : t("新建并编辑");
  const selectedPathRef = useRef("");
  const documentRequestRef = useRef(0);
  const lastReturnRefreshRef = useRef(0);
  const pendingFragmentRef = useRef<string | null>(null);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      selectedProject &&
      projects.some((project) => project.key === selectedProject)
    ) {
      setNotesProject(selectedProject);
      setCreateProject(selectedProject);
    }
  }, [projects, selectedProject]);

  const loadIndex = useCallback(
    async (request: IndexRequest = {}) => {
      const nextScope = request.scope ?? scope;
      const nextProject =
        "project" in request ? (request.project ?? "") : notesProject;
      const nextQuery = "query" in request ? (request.query ?? "") : query;
      setIndexLoading(true);
      setError("");
      try {
        const nextIndex = await invoke<NotesFileIndex>(
          "get_notes_file_index",
          {
            project:
              (nextScope === "all" || nextScope === "project") &&
              nextProject
                ? nextProject
                : null,
            scope:
              nextScope === "all" || nextScope === "project"
                ? null
                : nextScope,
            query: nextQuery.trim() || null,
            limit: 100,
          },
        );
        setIndex(nextIndex);
        setSelectedPath((current) => {
          const requested = request.selectPath;
          if (
            requested &&
            nextIndex.documents.some((item) => item.path === requested)
          ) {
            return requested;
          }
          if (nextIndex.documents.some((item) => item.path === current)) {
            return current;
          }
          return nextIndex.documents[0]?.path ?? "";
        });
      } catch (reason) {
        setError(String(reason));
        setIndex(null);
        setSelectedPath("");
      } finally {
        setIndexLoading(false);
      }
    },
    [notesProject, query, scope],
  );

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  const loadDocument = useCallback(
    async (path: string, silent = false) => {
      const requestId = ++documentRequestRef.current;
      if (!silent) {
        setDocumentLoading(true);
      }
      setError("");
      try {
        const nextDocument = await invoke<NoteDocument>("get_note_document", {
          path,
        });
        if (requestId === documentRequestRef.current) {
          setDocument(nextDocument);
        }
      } catch (reason) {
        if (requestId === documentRequestRef.current) {
          setError(String(reason));
          setDocument(null);
        }
      } finally {
        if (requestId === documentRequestRef.current) {
          setDocumentLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    selectedPathRef.current = selectedPath;
    if (!selectedPath) {
      documentRequestRef.current += 1;
      setDocument(null);
      setDocumentLoading(false);
      return;
    }
    if (document?.summary.path !== selectedPath) {
      void loadDocument(selectedPath);
    }
  }, [document?.summary.path, loadDocument, selectedPath]);

  const refreshKnowledge = useCallback(() => {
    const currentPath = selectedPathRef.current;
    void loadIndex({ selectPath: currentPath });
    if (currentPath) {
      void loadDocument(currentPath, true);
    }
  }, [loadDocument, loadIndex]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (globalThis.document.visibilityState !== "visible") {
        return;
      }
      const now = Date.now();
      if (now - lastReturnRefreshRef.current < 800) {
        return;
      }
      lastReturnRefreshRef.current = now;
      refreshKnowledge();
    };
    globalThis.addEventListener("focus", refreshOnReturn);
    globalThis.document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      globalThis.removeEventListener("focus", refreshOnReturn);
      globalThis.document.removeEventListener(
        "visibilitychange",
        refreshOnReturn,
      );
    };
  }, [refreshKnowledge]);

  const renderedContent = useMemo(
    () =>
      document
        ? markdown.render(document.content, {
            headingIds: new Map<string, number>(),
          })
        : "",
    [document],
  );

  const scrollToFragment = useCallback((fragment: string) => {
    let decoded = fragment;
    try {
      decoded = decodeURIComponent(fragment);
    } catch {
      // Keep malformed fragments literal and let the lookup fail quietly.
    }
    const targetId = headingId(decoded);
    const target = Array.from(
      readerScrollRef.current?.querySelectorAll<HTMLElement>("[id]") ?? [],
    ).find((element) => element.id === targetId || element.id === decoded);
    target?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    const fragment = pendingFragmentRef.current;
    if (!fragment || !renderedContent) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrollToFragment(fragment);
      pendingFragmentRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [renderedContent, scrollToFragment]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = queryDraft.trim();
    if (nextQuery === query) {
      void loadIndex();
    } else {
      setQuery(nextQuery);
    }
  }

  function handleScopeChange(nextScope: KnowledgeScope | null) {
    if (!nextScope) {
      return;
    }
    setScope(nextScope);
  }

  async function handleMarkdownClick(
    event: ReactMouseEvent<HTMLElement>,
  ) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      "a[href]",
    );
    const href = anchor?.getAttribute("href")?.trim();
    if (!href || !document) {
      return;
    }
    event.preventDefault();
    if (href.startsWith("#")) {
      scrollToFragment(href.slice(1));
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      try {
        await invoke("open_external_resource", { kind: "url", value: href });
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }

    setDocumentLoading(true);
    setError("");
    try {
      const result = await invoke<ResolveNoteDocumentLinkResult>(
        "resolve_note_document_link",
        {
          sourcePath: document.summary.path,
          href,
        },
      );
      pendingFragmentRef.current = result.fragment ?? null;
      const linkedScope = result.document.summary.scope;
      setScope(
        linkedScope === "root" ? "all" : (linkedScope as KnowledgeScope),
      );
      if (linkedScope === "project" && result.document.summary.projectKey) {
        setNotesProject(result.document.summary.projectKey);
      }
      selectedPathRef.current = result.document.summary.path;
      setSelectedPath(result.document.summary.path);
      setDocument(result.document);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDocumentLoading(false);
    }
  }

  function openCreateDialog() {
    const nextScope =
      scope === "all"
        ? notesProject
          ? "project"
          : "inbox"
        : scope;
    setCreateScope(nextScope);
    setCreateProject(notesProject || selectedProject);
    setCreateTitle("");
    setCreateOpen(true);
  }

  async function handleCreate() {
    const title = createTitle.trim();
    if (!title || (createScope === "project" && !createProject)) {
      return;
    }
    const project = projects.find((item) => item.key === createProject);
    setCreating(true);
    setError("");
    try {
      const result = await invoke<CreateNoteDocumentResult>(
        "create_note_document",
        {
          request: {
            scope: createScope,
            projectKey: createScope === "project" ? createProject : null,
            projectName: createScope === "project" ? project?.name : null,
            title,
          },
        },
      );
      setCreateOpen(false);
      setScope(createScope);
      if (createScope === "project") {
        setNotesProject(createProject);
      }
      setQuery("");
      setQueryDraft("");
      setSelectedPath(result.document.summary.path);
      setDocument(result.document);
      await invoke("open_local_path", {
        path: result.document.summary.path,
      });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="knowledge-page" data-knowledge-library="markdown">
      <header className="knowledge-page-head">
        <div>
          <Typography component="h1" variant="h6">
            {t("知识库")}
          </Typography>
          <Typography variant="caption">
            {t("面向项目与自动化工具的 Markdown 长期知识")}
          </Typography>
        </div>
        <div className="knowledge-page-actions">
          <Tooltip title={t("刷新知识库")}>
            <span>
              <IconButton
                size="small"
                aria-label={t("刷新知识库")}
                onClick={refreshKnowledge}
                disabled={indexLoading}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<FolderIcon fontSize="small" />}
            disabled={!index?.notesRoot}
            onClick={() =>
              void invoke("open_local_path", { path: index?.notesRoot })
            }
          >
            {t("目录")}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<PlusIcon fontSize="small" />}
            onClick={openCreateDialog}
          >
            {t("新建")}
          </Button>
        </div>
      </header>

      <form className="knowledge-toolbar" onSubmit={handleSearch}>
        <ToggleButtonGroup
          className="knowledge-scope-control"
          size="small"
          exclusive
          value={scope}
          onChange={(_event, value: KnowledgeScope | null) =>
            handleScopeChange(value)
          }
          aria-label={t("知识范围")}
        >
          {PRIMARY_SCOPE_OPTIONS.map((option) => (
            <ToggleButton key={option.value} value={option.value}>
              {t(option.label)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Tooltip
          title={secondaryScopeTooltip}
        >
          <Button
            type="button"
            size="small"
            color="inherit"
            aria-label={t("更多知识范围")}
            aria-haspopup="menu"
            aria-expanded={Boolean(scopeMenuAnchor)}
            className={`knowledge-scope-more${
              scope === "all" || scope === "inbox" ? " is-active" : ""
            }`}
            onClick={(event) => setScopeMenuAnchor(event.currentTarget)}
          >
            {activeSecondaryScope ? (
              t(activeSecondaryScope.label)
            ) : (
              <MoreIcon fontSize="small" />
            )}
          </Button>
        </Tooltip>
        <TextField
          select
          size="small"
          value={notesProject}
          disabled={scope !== "all" && scope !== "project"}
          onChange={(event) => setNotesProject(event.target.value)}
          inputProps={{ "aria-label": t("项目范围") }}
          className="knowledge-project-select"
        >
          <MenuItem value="">{t("所有项目")}</MenuItem>
          {projects.map((project) => (
            <MenuItem key={project.key} value={project.key}>
              {project.name || project.key}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
          placeholder={t("搜索标题、正文或路径")}
          className="knowledge-search"
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
        <Button type="submit" size="small" variant="outlined" color="inherit">
          {t("搜索")}
        </Button>
      </form>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <div className="knowledge-workbench">
        <aside className="knowledge-index" aria-label={t("知识文档列表")}>
          <div
            className="knowledge-document-list"
            aria-busy={indexLoading}
          >
            {index?.truncated ? (
              <div className="knowledge-list-status">
                <Chip
                  size="small"
                  label={t("仅显示前 {count} 篇", { count: 100 })}
                />
              </div>
            ) : null}
            {indexLoading && !index ? (
              <div className="knowledge-loading">
                <CircularProgress size={18} />
                <Typography variant="caption">{t("正在读取知识目录")}</Typography>
              </div>
            ) : null}
            {!indexLoading && index?.documents.length === 0 ? (
              <AppEmptyState
                compact
                title={emptyIndexTitle}
                description={emptyIndexDescription}
              />
            ) : null}
            {index?.documents.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`knowledge-document-item${
                  selectedPath === item.path ? " is-active" : ""
                }`}
                onClick={() => {
                  selectedPathRef.current = item.path;
                  setSelectedPath(item.path);
                }}
              >
                <span className="knowledge-document-heading">
                  <span
                    className={`knowledge-document-icon is-${item.scope}`}
                    aria-hidden="true"
                  >
                    <KnowledgeIcon fontSize="small" />
                  </span>
                  <span className="knowledge-document-heading-copy">
                    <span className="knowledge-document-title">
                      {highlightText(item.title, query)}
                    </span>
                    <span className="knowledge-document-meta">
                      <span className="knowledge-document-scope">
                        {scopeLabel(item, t)}
                      </span>
                      <time>{formatUpdatedAt(item.updatedAtMs, language)}</time>
                    </span>
                  </span>
                </span>
                {item.matchExcerpt || item.summary ? (
                  <span className="knowledge-document-summary">
                    {highlightText(item.matchExcerpt || item.summary, query)}
                  </span>
                ) : null}
                <span className="knowledge-document-path">
                  {item.relativePath}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="knowledge-reader" aria-label={t("知识文档预览")}>
          {document ? (
            <div
              className="knowledge-reader-scroll"
              ref={readerScrollRef}
            >
              <header className="knowledge-reader-head">
                <Typography variant="caption">
                  {document.summary.relativePath}
                </Typography>
                <div className="knowledge-reader-actions">
                  <Tooltip title={t("在默认编辑器中打开")}>
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<EditIcon fontSize="small" />}
                      onClick={() =>
                        void invoke("open_local_path", {
                          path: document.summary.path,
                        })
                      }
                    >
                      {t("编辑")}
                    </Button>
                  </Tooltip>
                  <Tooltip title={t("更多文档操作")}>
                    <IconButton
                      size="small"
                      aria-label={t("更多文档操作")}
                      aria-haspopup="menu"
                      aria-expanded={Boolean(readerMenuAnchor)}
                      onClick={(event) =>
                        setReaderMenuAnchor(event.currentTarget)
                      }
                    >
                      <MoreIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </div>
              </header>
              {documentLoading ? (
                <div className="knowledge-loading">
                  <CircularProgress size={18} />
                </div>
              ) : (
                <article
                  className="markdown-preview knowledge-markdown"
                  onClick={(event) => void handleMarkdownClick(event)}
                  dangerouslySetInnerHTML={{ __html: renderedContent }}
                />
              )}
            </div>
          ) : (
            <AppEmptyState
              title={t("选择一篇知识文档")}
              description={t("左侧目录保持轻量索引，正文按需加载。")}
            />
          )}
        </section>
      </div>

      <Menu
        anchorEl={scopeMenuAnchor}
        open={Boolean(scopeMenuAnchor)}
        onClose={() => setScopeMenuAnchor(null)}
      >
        {SECONDARY_SCOPE_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={scope === option.value}
            onClick={() => {
              setScope(option.value);
              setScopeMenuAnchor(null);
            }}
          >
            {t(option.label)}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={readerMenuAnchor}
        open={Boolean(readerMenuAnchor)}
        onClose={() => setReaderMenuAnchor(null)}
      >
        <MenuItem
          className="knowledge-menu-item"
          onClick={() => {
            setReaderMenuAnchor(null);
            if (document) {
              void navigator.clipboard
                .writeText(document.summary.path)
                .catch((reason) => setError(String(reason)));
            }
          }}
        >
          <CopyIcon fontSize="small" />
          {t("复制文件路径")}
        </MenuItem>
        <MenuItem
          className="knowledge-menu-item"
          disabled={!index?.notesRoot}
          onClick={() => {
            setReaderMenuAnchor(null);
            void invoke("open_local_path", { path: index?.notesRoot });
          }}
        >
          <FolderIcon fontSize="small" />
          {t("打开知识目录")}
        </MenuItem>
      </Menu>

      <Dialog
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{t("新建知识文档")}</DialogTitle>
        <DialogContent className="knowledge-create-dialog">
          <TextField
            select
            size="small"
            label={t("归档范围")}
            value={createScope}
            onChange={(event) =>
              setCreateScope(event.target.value as CreatableKnowledgeScope)
            }
          >
            {CREATE_SCOPE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {t(option.label)}
              </MenuItem>
            ))}
          </TextField>
          {createScope === "project" ? (
            <TextField
              select
              size="small"
              label={t("项目")}
              value={createProject}
              onChange={(event) => setCreateProject(event.target.value)}
            >
              {projects.map((project) => (
                <MenuItem key={project.key} value={project.key}>
                  {project.name || project.key}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            autoFocus
            size="small"
            label={t("标题")}
            value={createTitle}
            onChange={(event) => setCreateTitle(event.target.value)}
            inputProps={{ maxLength: 120 }}
            helperText={t("将按标题生成 Markdown 文件，并填入对应范围模板。")}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setCreateOpen(false)}>
            {t("取消")}
          </Button>
          <Button
            variant="contained"
            disabled={
              creating ||
              !createTitle.trim() ||
              (createScope === "project" && !createProject)
            }
            onClick={() => void handleCreate()}
          >
            {createSubmitLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
