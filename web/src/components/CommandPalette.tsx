import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectManagementViewKey, ProjectRuntimeEntry } from "../app-types";
import type { PageKey } from "../app-shell";
import type { ProjectSummary } from "../hooks/useBranchContext";
import type { FinderShortcutItem } from "../hooks/useProjectsModule";
import { useI18n } from "../i18n";
import { translateBuildDetail } from "../lib/buildPresentation";
import {
  AppWindowIcon,
  FolderIcon,
  KnowledgeIcon,
  PackageIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  WebsiteIcon,
  WorkflowIcon,
} from "./AppIcons";
import { AppEmptyState } from "./AppEmptyState";

type NavItem = {
  key: PageKey;
  label: string;
  shortLabel: string;
};

type CommandPaletteProps = {
  open: boolean;
  navItems: NavItem[];
  activePage: PageKey;
  projectManagementView: ProjectManagementViewKey;
  projects: ProjectSummary[];
  selectedProjectKey: string;
  runtimeEntries: ProjectRuntimeEntry[];
  shortcutEntries: FinderShortcutItem[];
  onClose: () => void;
  onPageChange: (page: PageKey) => void;
  onProjectManagementViewChange: (view: ProjectManagementViewKey) => void;
  onProjectChange: (projectKey: string) => void;
  onOpenFinderEntry: (entry: FinderShortcutItem["entry"]) => Promise<boolean> | boolean;
  onStartRuntime: (projectKey: string) => Promise<void> | void;
  onStopRuntime: (projectKey: string) => Promise<void> | void;
  onRunBuild: (projectKey: string) => Promise<void> | void;
  onStopBuild: (projectKey: string) => Promise<void> | void;
  onOpenBuildOutput: (projectKey: string) => Promise<void> | void;
  onFocusRuntime: (projectKey: string) => Promise<void> | void;
  onOpenProjectDirectory: (projectKey: string) => Promise<void> | void;
};

type CommandItem = {
  id: string;
  title: string;
  subtitle: string;
  group: string;
  badge?: string;
  icon: ReactNode;
  keywords: string;
  priority: number;
  run: () => Promise<void> | void;
};

const MAX_RESULTS = 36;

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function shortcutKindLabel(kind: string) {
  switch (kind) {
    case "url":
      return "网站";
    case "app":
      return "应用";
    case "script":
      return "脚本";
    case "tool":
      return "工具";
    case "directory":
      return "目录";
    case "file":
      return "文件";
    default:
      return "入口";
  }
}

function shortcutIcon(kind: string) {
  if (kind === "url") {
    return <WebsiteIcon fontSize="small" />;
  }
  if (kind === "directory" || kind === "file") {
    return <FolderIcon fontSize="small" />;
  }
  if (kind === "script") {
    return <TerminalIcon fontSize="small" />;
  }
  if (kind === "tool") {
    return <TerminalIcon fontSize="small" />;
  }
  return <AppWindowIcon fontSize="small" />;
}

function commandScore(command: CommandItem, keyword: string) {
  if (!keyword) {
    return command.priority;
  }
  const title = normalizeText(command.title);
  const badge = normalizeText(command.badge ?? "");
  const haystack = normalizeText(command.keywords);
  if (title === keyword || badge === keyword) {
    return command.priority + 120;
  }
  if (title.startsWith(keyword) || badge.startsWith(keyword)) {
    return command.priority + 80;
  }
  if (haystack.includes(keyword)) {
    return command.priority + 20;
  }
  return -1;
}

function buildProjectKeywords(project: ProjectSummary, runtime?: ProjectRuntimeEntry) {
  return [
    project.key,
    project.name,
    project.category,
    project.repoPath ?? "",
    runtime?.repoPath ?? "",
    runtime?.cwd ?? "",
    runtime?.command ?? "",
    runtime?.buildCommand ?? "",
    runtime?.statusLabel ?? "",
    runtime?.buildStatusLabel ?? "",
  ].join(" ");
}

export function CommandPalette({
  open,
  navItems,
  activePage,
  projectManagementView,
  projects,
  selectedProjectKey,
  runtimeEntries,
  shortcutEntries,
  onClose,
  onPageChange,
  onProjectManagementViewChange,
  onProjectChange,
  onOpenFinderEntry,
  onStartRuntime,
  onStopRuntime,
  onRunBuild,
  onStopBuild,
  onOpenBuildOutput,
  onFocusRuntime,
  onOpenProjectDirectory,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const runtimeByProject = useMemo(
    () => new Map(runtimeEntries.map((item) => [item.key, item] as const)),
    [runtimeEntries],
  );

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    for (const item of navItems) {
      items.push({
        id: `page:${item.key}`,
        title: t(item.label),
        subtitle:
          item.key === activePage
            ? t("当前页面")
            : t("切换到 {page}", { page: t(item.label) }),
        group: t("页面"),
        badge: t(item.shortLabel),
        icon: <AppWindowIcon fontSize="small" />,
        keywords: `${item.key} ${item.label} ${item.shortLabel} ${t(item.label)} ${t(item.shortLabel)} 页面 pages tab`,
        priority: item.key === activePage ? 64 : 72,
        run: () => {
          if (item.key === "projectManagement") {
            onProjectManagementViewChange("projects");
          }
          onPageChange(item.key);
        },
      });
    }

    if (navItems.some((item) => item.key === "projectManagement")) {
      items.push(
        {
          id: "page:projectManagement:build",
          title: t("项目管理 / 构建"),
          subtitle:
            activePage === "projectManagement" && projectManagementView === "build"
              ? t("当前页面")
              : t("切换到项目构建"),
          group: t("页面"),
          badge: t("构建"),
          icon: <PackageIcon fontSize="small" />,
          keywords: "projectManagement build deploy package 构建 任务 部署 项目管理",
          priority:
            activePage === "projectManagement" && projectManagementView === "build"
              ? 66
              : 76,
          run: () => {
            onProjectManagementViewChange("build");
            onPageChange("projectManagement");
          },
        },
        {
          id: "page:projectManagement:git",
          title: t("项目管理 / Git"),
          subtitle:
            activePage === "projectManagement" && projectManagementView === "git"
              ? t("当前页面")
              : t("切换到 Git 工作流"),
          group: t("页面"),
          badge: "Git",
          icon: <WorkflowIcon fontSize="small" />,
          keywords: "projectManagement git merge branch workflow 分支 工作流 项目管理",
          priority:
            activePage === "projectManagement" && projectManagementView === "git"
              ? 66
              : 76,
          run: () => {
            onProjectManagementViewChange("git");
            onPageChange("projectManagement");
          },
        },
      );
    }

    for (const project of projects) {
      const runtime = runtimeByProject.get(project.key);
      const projectKeywords = buildProjectKeywords(project, runtime);
      const projectPriority = project.key === selectedProjectKey ? 74 : 58;

      items.push({
        id: `project:${project.key}`,
        title: project.name || project.key,
        subtitle: project.category || project.key,
        group: t("项目"),
        badge: project.key,
        icon: <AppWindowIcon fontSize="small" />,
        keywords: `${projectKeywords} 选择项目 select project`,
        priority: projectPriority,
        run: () => {
          onProjectChange(project.key);
          onProjectManagementViewChange("projects");
          onPageChange("projectManagement");
        },
      });

      if (navItems.some((item) => item.key === "knowledge")) {
        items.push({
          id: `project:${project.key}:knowledge`,
          title: t("{name} · 知识库", { name: project.name || project.key }),
          subtitle: t("打开项目经验与共享手册"),
          group: t("项目动作"),
          badge: t("知识库"),
          icon: <KnowledgeIcon fontSize="small" />,
          keywords: `${projectKeywords} knowledge base note markdown 知识库 知识 笔记 文档`,
          priority: projectPriority + 2,
          run: () => {
            onProjectChange(project.key);
            onPageChange("knowledge");
          },
        });
      }

      if (runtime?.repoPath || runtime?.cwd || project.repoPath) {
        items.push({
          id: `project:${project.key}:open-dir`,
          title: t("打开 {name}", { name: project.name || project.key }),
          subtitle:
            runtime?.cwd || runtime?.repoPath || project.repoPath || t("项目目录"),
          group: t("项目动作"),
          badge: t("目录"),
          icon: <FolderIcon fontSize="small" />,
          keywords: `${projectKeywords} open folder directory 目录 打开`,
          priority: projectPriority + 4,
          run: () => onOpenProjectDirectory(project.key),
        });
      }

      if (runtime?.canStart) {
        items.push({
          id: `project:${project.key}:start`,
          title: t("启动 {name}", { name: project.name || project.key }),
          subtitle: runtime.command || t("运行 dev 服务"),
          group: t("项目动作"),
          badge: "dev",
          icon: <PlayIcon fontSize="small" />,
          keywords: `${projectKeywords} start dev run 启动 运行`,
          priority: projectPriority + 8,
          run: () => onStartRuntime(project.key),
        });
      }

      if (runtime?.canStop) {
        items.push({
          id: `project:${project.key}:stop`,
          title: t("停止 {name}", { name: project.name || project.key }),
          subtitle: runtime.detail || t("停止 dev 服务"),
          group: t("项目动作"),
          badge: "stop",
          icon: <StopIcon fontSize="small" />,
          keywords: `${projectKeywords} stop dev 停止`,
          priority: projectPriority + 10,
          run: () => onStopRuntime(project.key),
        });
      }

      if (runtime?.canBuild) {
        items.push({
          id: `project:${project.key}:build`,
          title: t("构建 {name}", { name: project.name || project.key }),
          subtitle: runtime.buildCommand || t("执行构建命令"),
          group: t("项目动作"),
          badge: "build",
          icon: <PackageIcon fontSize="small" />,
          keywords: `${projectKeywords} build package 构建 打包`,
          priority: projectPriority + 6,
          run: () => onRunBuild(project.key),
        });
      }

      if (runtime?.canStopBuild) {
        items.push({
          id: `project:${project.key}:stop-build`,
          title: t("停止构建 {name}", { name: project.name || project.key }),
          subtitle:
            translateBuildDetail(runtime.buildDetail || "", t) ||
            t("中止构建任务"),
          group: t("项目动作"),
          badge: "stop",
          icon: <StopIcon fontSize="small" />,
          keywords: `${projectKeywords} stop build 停止 构建`,
          priority: projectPriority + 10,
          run: () => onStopBuild(project.key),
        });
      }

      if (runtime?.canOpenBuildOutput) {
        items.push({
          id: `project:${project.key}:output`,
          title: t("打开产物 {name}", { name: project.name || project.key }),
          subtitle: runtime.buildOutputDir || t("构建产物目录"),
          group: t("项目动作"),
          badge: t("产物"),
          icon: <FolderIcon fontSize="small" />,
          keywords: `${projectKeywords} output dist build folder 产物 目录`,
          priority: projectPriority + 3,
          run: () => onOpenBuildOutput(project.key),
        });
      }

      if (runtime?.canFocusRuntime) {
        items.push({
          id: `project:${project.key}:focus`,
          title: t("聚焦 {name}", { name: project.name || project.key }),
          subtitle: runtime.detail || t("唤起运行中的项目"),
          group: t("项目动作"),
          badge: t("聚焦"),
          icon: <AppWindowIcon fontSize="small" />,
          keywords: `${projectKeywords} focus open browser app 聚焦 唤起`,
          priority: projectPriority + 5,
          run: () => onFocusRuntime(project.key),
        });
      }
    }

    for (const item of shortcutEntries) {
      const kindLabel = shortcutKindLabel(item.entry.kind);
      items.push({
        id: `shortcut:${item.categoryTitle}:${item.entry.kind}:${item.entry.name}`,
        title: item.entry.name,
        subtitle: item.entry.targetLabel || item.entry.note || item.categoryTitle,
        group: t("快捷入口"),
        badge: t(kindLabel),
        icon: shortcutIcon(item.entry.kind),
        keywords: [
          item.categoryTitle,
          item.categoryLabel,
          item.entry.kind,
          item.entry.name,
          item.entry.targetLabel,
          item.entry.note ?? "",
          item.entry.url ?? "",
          item.entry.runtimeProfile ?? "",
          item.entry.bundleId ?? "",
          item.entry.appName ?? "",
          item.entry.script ?? "",
          item.entry.path ?? "",
          item.entry.cwd ?? "",
          kindLabel,
          t(kindLabel),
        ].join(" "),
        priority: 50,
        run: async () => {
          await onOpenFinderEntry(item.entry);
        },
      });
    }

    return items;
  }, [
    activePage,
    navItems,
    onFocusRuntime,
    onOpenBuildOutput,
    onOpenFinderEntry,
    onOpenProjectDirectory,
    onPageChange,
    onProjectManagementViewChange,
    onProjectChange,
    onRunBuild,
    onStartRuntime,
    onStopBuild,
    onStopRuntime,
    projects,
    projectManagementView,
    runtimeByProject,
    selectedProjectKey,
    shortcutEntries,
    t,
  ]);

  const results = useMemo(() => {
    const keyword = normalizeText(query);
    return commands
      .map((command) => ({
        command,
        score: commandScore(command, keyword),
      }))
      .filter((item) => item.score >= 0)
      .sort((left, right) => right.score - left.score || left.command.title.localeCompare(right.command.title))
      .slice(0, MAX_RESULTS)
      .map((item) => item.command);
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setSelectedIndex(0);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex > results.length - 1) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  if (!open) {
    return null;
  }

  function executeCommand(command: CommandItem | undefined) {
    if (!command) {
      return;
    }
    onClose();
    void Promise.resolve(command.run());
  }

  return (
    <div
      className="command-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="command-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("命令面板")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-search-row">
          <TerminalIcon fontSize="small" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(results.length - 1, current + 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(0, current - 1));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                executeCommand(results[selectedIndex]);
              }
            }}
            placeholder={t("搜索页面、项目、快捷入口或动作")}
            aria-label={t("搜索命令")}
          />
          <span className="command-shortcut">Cmd/Ctrl K</span>
        </div>

        <div className="command-result-list" role="listbox" aria-label={t("命令结果")}>
          {results.length === 0 ? (
            <AppEmptyState
              compact
              className="command-empty"
              title={t("没有匹配命令")}
              description={t("换个关键词试试。")}
            />
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={index === selectedIndex ? "command-result is-active" : "command-result"}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => executeCommand(command)}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <span className="command-result-icon">{command.icon}</span>
                <span className="command-result-copy">
                  <span className="command-result-title">{command.title}</span>
                  <span className="command-result-subtitle">{command.subtitle}</span>
                </span>
                <span className="command-result-meta">
                  <span>{command.group}</span>
                  {command.badge ? <b>{command.badge}</b> : null}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
