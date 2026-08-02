import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Button } from "@mui/material";
import type { PageKey } from "../app-shell";
import type {
  AppExitRuntimePolicy,
  CreateProjectWorkspacePayload,
  ProjectManagementViewKey,
  ProjectWorkspaceSummary,
} from "../app-types";
import type { ActivityEntry } from "../lib/activityCenter";
import { useI18n } from "../i18n";
import type { AppStyleMode } from "../theme";
import {
  CollapseIcon,
  ExpandIcon,
  FolderIcon,
  KnowledgeIcon,
  AppWindowIcon,
  PackageIcon,
  PanelSideIcon,
  SettingsIcon,
  TerminalIcon,
  WorkflowIcon,
} from "./AppIcons";
import { ActivityCenter } from "./ActivityCenter";
import { AppToast } from "./AppToast";
import { SettingsPanel, type SettingsSection } from "./SettingsPanel";
import { OPEN_SETTINGS_EVENT } from "./settingsEvents";
import {
  WorkspaceSwitcherMenu,
  workspaceDisplayName,
} from "./WorkspaceSwitcherMenu";

type NavItem = {
  key: PageKey;
  label: string;
  shortLabel: string;
};

type AppShellLayoutProps = {
  visibleNavItems: NavItem[];
  activePage: PageKey;
  onPageChange: (page: PageKey) => void;
  projectManagementView: ProjectManagementViewKey;
  onProjectManagementViewChange: (view: ProjectManagementViewKey) => void;
  enabledPages: PageKey[];
  onEnabledPagesChange: (pages: PageKey[]) => void;
  defaultPage: PageKey;
  onDefaultPageChange: (page: PageKey) => void;
  styleMode: AppStyleMode;
  onStyleModeChange: (mode: AppStyleMode) => void;
  exitRuntimePolicy: AppExitRuntimePolicy;
  onExitRuntimePolicyChange: (policy: AppExitRuntimePolicy) => void;
  projectWorkspaces: ProjectWorkspaceSummary[];
  activeProjectWorkspaceKey: string;
  onProjectWorkspaceChange: (workspaceKey: string) => Promise<void> | void;
  selectedProjectKey: string;
  onOpenConfigDir: () => void;
  onOpenConfigFile: () => void;
  onOpenProjectWorkspacesDir: () => void;
  onOpenNavigationConfigFile: () => void;
  onOpenWorkspaceConfig: () => void;
  onOpenResourceConfig: () => void;
  onCreateProjectWorkspace: (payload: CreateProjectWorkspacePayload) => Promise<void> | void;
  onProjectConfigSaved: () => Promise<void> | void;
  activityItems: ActivityEntry[];
  activityAlertCount: number;
  onOpenActivityEntry: (entry: ActivityEntry) => void;
  onOpenActivityResource: (entry: ActivityEntry) => void;
  onRunActivityAction: (entry: ActivityEntry) => Promise<void> | void;
  onRefreshActivities: (options?: { force?: boolean }) => Promise<void> | void;
  onResolveActivityEntry: (entry: ActivityEntry) => void;
  onResolveActivityEntries: (entries: ActivityEntry[]) => void;
  onClearHandledActivities: () => void;
  busy: string;
  error: string;
  children: ReactNode;
};

function shouldShowBusyMessage(value: string) {
  const message = value.trim();
  if (!message) {
    return false;
  }
  return !(
    message.startsWith("正在刷新") ||
    message === "正在同步分支" ||
    message === "正在同步状态"
  );
}

function navIconForPage(key: PageKey) {
  switch (key) {
    case "overview":
      return <AppWindowIcon className="nav-item-icon" fontSize="small" />;
    case "knowledge":
      return <KnowledgeIcon className="nav-item-icon" fontSize="small" />;
    case "projectManagement":
      return <PackageIcon className="nav-item-icon" fontSize="small" />;
    case "resources":
      return <FolderIcon className="nav-item-icon" fontSize="small" />;
    case "merge":
      return <WorkflowIcon className="nav-item-icon" fontSize="small" />;
    case "build":
      return <PackageIcon className="nav-item-icon" fontSize="small" />;
    case "proxy":
      return <TerminalIcon className="nav-item-icon" fontSize="small" />;
    default:
      return <FolderIcon className="nav-item-icon" fontSize="small" />;
  }
}

export function AppShellLayout({
  visibleNavItems,
  activePage,
  onPageChange,
  projectManagementView,
  onProjectManagementViewChange,
  enabledPages,
  onEnabledPagesChange,
  defaultPage,
  onDefaultPageChange,
  styleMode,
  onStyleModeChange,
  exitRuntimePolicy,
  onExitRuntimePolicyChange,
  projectWorkspaces,
  activeProjectWorkspaceKey,
  onProjectWorkspaceChange,
  selectedProjectKey,
  onOpenConfigDir,
  onOpenConfigFile,
  onOpenProjectWorkspacesDir,
  onOpenNavigationConfigFile,
  onOpenWorkspaceConfig,
  onOpenResourceConfig,
  onCreateProjectWorkspace,
  onProjectConfigSaved,
  activityItems,
  activityAlertCount,
  onOpenActivityEntry,
  onOpenActivityResource,
  onRunActivityAction,
  onRefreshActivities,
  onResolveActivityEntry,
  onResolveActivityEntries,
  onClearHandledActivities,
  busy,
  error,
  children,
}: AppShellLayoutProps) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSection | undefined>();
  const [activityOpen, setActivityOpen] = useState(false);
  const [workspaceMenuAnchor, setWorkspaceMenuAnchor] = useState<HTMLElement | null>(null);
  const [workspaceSwitchingKey, setWorkspaceSwitchingKey] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projectManagementExpanded, setProjectManagementExpanded] = useState(
    activePage === "projectManagement",
  );
  const [activityPanelMode, setActivityPanelMode] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(min-width: 901px)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 901px)");
    const handleChange = () => setActivityPanelMode(query.matches);
    handleChange();
    query.addEventListener("change", handleChange);
    return () => {
      query.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (activePage === "projectManagement") {
      setProjectManagementExpanded(true);
    }
  }, [activePage]);

  function openSettings(section?: SettingsSection) {
    if (section === "workspace") {
      onOpenWorkspaceConfig();
      return;
    }
    if (section === "finder") {
      onOpenResourceConfig();
      return;
    }
    setWorkspaceMenuAnchor(null);
    setActivityOpen(false);
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  function openWorkspaceMenu(event: MouseEvent<HTMLButtonElement>) {
    setWorkspaceMenuAnchor(event.currentTarget);
  }

  function closeWorkspaceMenu() {
    setWorkspaceMenuAnchor(null);
  }

  async function selectProjectWorkspace(workspaceKey: string) {
    closeWorkspaceMenu();
    if (!workspaceKey || workspaceKey === activeProjectWorkspaceKey) {
      return;
    }
    setWorkspaceSwitchingKey(workspaceKey);
    try {
      await onProjectWorkspaceChange(workspaceKey);
    } catch {
      // The app-level workspace handler already reports the error.
    } finally {
      setWorkspaceSwitchingKey("");
    }
  }

  function openWorkspaceWorkbenchFromMenu() {
    closeWorkspaceMenu();
    onOpenWorkspaceConfig();
  }

  function openProjectManagementFromSettings() {
    closeSettings();
    onPageChange("projectManagement");
  }

  function toggleProjectManagement() {
    if (activePage !== "projectManagement") {
      setProjectManagementExpanded(true);
      onPageChange("projectManagement");
      return;
    }
    setProjectManagementExpanded((current) => !current);
  }

  function selectProjectManagementView(view: ProjectManagementViewKey) {
    setProjectManagementExpanded(true);
    onProjectManagementViewChange(view);
    if (activePage !== "projectManagement") {
      onPageChange("projectManagement");
    }
  }

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      openSettings(section);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handleOpenSettings);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, handleOpenSettings);
    };
  }, []);

  const visibleBusy = shouldShowBusyMessage(busy) ? busy : "";
  const desktopSidebarCollapsed = activityPanelMode && sidebarCollapsed;
  const activeProjectWorkspace =
    projectWorkspaces.find((workspace) => workspace.key === activeProjectWorkspaceKey) ??
    projectWorkspaces[0] ??
    null;
  const workspaceMenuOpen = Boolean(workspaceMenuAnchor);
  const toastMessage = error || visibleBusy;
  const primaryNavItems = visibleNavItems.filter(
    (item) => item.key !== "build" && item.key !== "merge",
  );
  const projectManagementItems: Array<{
    key: ProjectManagementViewKey;
    label: string;
    icon: ReactNode;
  }> = [
    {
      key: "projects",
      label: "项目",
      icon: <AppWindowIcon fontSize="small" />,
    },
    {
      key: "build",
      label: "构建",
      icon: <PackageIcon fontSize="small" />,
    },
    {
      key: "git",
      label: "Git",
      icon: <WorkflowIcon fontSize="small" />,
    },
  ];

  return (
      <div
        className={`shell${activityPanelMode && activityOpen ? " shell--activity-open" : ""}${desktopSidebarCollapsed ? " shell--sidebar-collapsed" : ""}`}
      >
      <AppToast
        message={toastMessage}
        severity={error ? "error" : "info"}
        autoHideDuration={error ? 5200 : 2800}
      />
      <div className="window-drag-region" data-tauri-drag-region />
      {activityPanelMode ? (
        <button
          type="button"
          className="sidebar-icon-toggle sidebar-icon-toggle--leading"
          aria-label={t(desktopSidebarCollapsed ? "展开导航栏" : "收起导航栏")}
          title={t(desktopSidebarCollapsed ? "展开导航栏" : "收起导航栏")}
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-expanded={!desktopSidebarCollapsed}
        >
          <PanelSideIcon fontSize="small" />
        </button>
      ) : null}
      <div className="window-toolbar" aria-label={t("窗口工具")}>
        <button
          type="button"
          className="activity-icon-toggle"
          aria-label={t(activityOpen ? "关闭活动中心" : "打开活动中心")}
          title={t("活动")}
          onClick={() => setActivityOpen((current) => !current)}
          aria-expanded={activityOpen}
        >
          <PanelSideIcon fontSize="small" />
          {activityAlertCount > 0 ? (
            <span className="activity-badge">
              {activityAlertCount > 99 ? "99+" : activityAlertCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="settings-icon-toggle"
          aria-label={t("打开设置")}
          title={t("设置")}
          onClick={() => openSettings()}
          aria-expanded={settingsOpen}
        >
          <SettingsIcon fontSize="small" />
        </button>
      </div>
      <aside className={`sidebar${desktopSidebarCollapsed ? " sidebar--collapsed" : ""}`}>
        <div className="shell-brand">
          <span className="shell-brand-mark" aria-hidden="true">
            <img src="/rdevtool.png" alt="" />
          </span>
          <div className="shell-brand-copy">
            <div className="shell-brand-wordmark" aria-label="rDevTool">
              <span className="shell-brand-wordmark-accent">r</span>
              <span>DevTool</span>
            </div>
            <span className="shell-brand-subtitle">{t("开发工作台")}</span>
          </div>
        </div>

        <nav className="nav-stack" aria-label={t("主菜单")}>
          <span className="nav-section-label">{t("工作台")}</span>
          {primaryNavItems.map((item) =>
            item.key === "projectManagement" ? (
              <div
                className={`nav-group nav-group--project-management${
                  item.key === activePage ? " is-active" : ""
                }`}
                key={item.key}
              >
                <Button
                  variant="text"
                  color="inherit"
                  className={`nav-item nav-item--parent${
                    item.key === activePage ? " is-active" : ""
                  }`}
                  onClick={toggleProjectManagement}
                  title={t(item.label)}
                  aria-current={item.key === activePage ? "page" : undefined}
                  aria-expanded={projectManagementExpanded}
                  aria-controls="project-management-sidebar-nav"
                >
                  <span className="nav-item-icon-wrap" aria-hidden="true">
                    {navIconForPage(item.key)}
                  </span>
                  <span className="nav-item-label">{t(item.shortLabel)}</span>
                  {projectManagementExpanded ? (
                    <CollapseIcon className="nav-item-chevron" fontSize="small" />
                  ) : (
                    <ExpandIcon className="nav-item-chevron" fontSize="small" />
                  )}
                </Button>
                {projectManagementExpanded ? (
                  <div
                    className="project-management-sidebar-nav"
                    id="project-management-sidebar-nav"
                    aria-label={t("项目管理二级菜单")}
                  >
                    {projectManagementItems.map((viewItem) => (
                      <button
                        type="button"
                        key={viewItem.key}
                        className={`project-management-sidebar-item${
                          projectManagementView === viewItem.key &&
                          activePage === "projectManagement"
                            ? " is-active"
                            : ""
                        }`}
                        onClick={() => selectProjectManagementView(viewItem.key)}
                        aria-current={
                          projectManagementView === viewItem.key &&
                          activePage === "projectManagement"
                            ? "page"
                            : undefined
                        }
                      >
                        <span className="project-management-sidebar-icon" aria-hidden="true">
                          {viewItem.icon}
                        </span>
                        <span className="project-management-sidebar-label">
                          {t(viewItem.label)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <Button
                key={item.key}
                variant="text"
                color="inherit"
                className={`nav-item${item.key === activePage ? " is-active" : ""}`}
                onClick={() => onPageChange(item.key)}
                title={t(item.label)}
                aria-current={item.key === activePage ? "page" : undefined}
              >
                <span className="nav-item-icon-wrap" aria-hidden="true">
                  {navIconForPage(item.key)}
                </span>
                <span className="nav-item-label">{t(item.shortLabel)}</span>
              </Button>
            ),
          )}
        </nav>
        {projectWorkspaces.length > 0 ? (
          <div className="sidebar-footer">
            <button
              type="button"
              className={`workspace-switcher${workspaceMenuOpen ? " is-open" : ""}`}
              aria-label={t("切换工作区")}
              aria-haspopup="menu"
              aria-expanded={workspaceMenuOpen}
              onClick={openWorkspaceMenu}
              title={
                activeProjectWorkspace
                  ? `${
                      activeProjectWorkspace.system
                        ? t("全局")
                        : activeProjectWorkspace.name
                    } · ${t("切换工作区")}`
                  : t("切换工作区")
              }
            >
              <span className="workspace-switcher-icon" aria-hidden="true">
                <AppWindowIcon fontSize="small" />
              </span>
              <span className="workspace-switcher-copy">
                <span className="workspace-switcher-label">{t("当前工作区")}</span>
                <span className="workspace-switcher-name">
                  {activeProjectWorkspace?.system
                    ? t("全局")
                    : workspaceDisplayName(activeProjectWorkspace)}
                </span>
              </span>
              <ExpandIcon className="workspace-switcher-chevron" fontSize="small" />
            </button>
            <WorkspaceSwitcherMenu
              anchorEl={workspaceMenuAnchor}
              workspaces={projectWorkspaces}
              activeWorkspaceKey={activeProjectWorkspaceKey}
              switchingWorkspaceKey={workspaceSwitchingKey}
              onClose={closeWorkspaceMenu}
              onSelect={(workspaceKey) => void selectProjectWorkspace(workspaceKey)}
              onManage={openWorkspaceWorkbenchFromMenu}
            />
          </div>
        ) : null}
      </aside>

      {settingsOpen ? (
        <SettingsPanel
          styleMode={styleMode}
          onStyleModeChange={onStyleModeChange}
          exitRuntimePolicy={exitRuntimePolicy}
          onExitRuntimePolicyChange={onExitRuntimePolicyChange}
          selectedProjectKey={selectedProjectKey}
          onOpenConfigDir={onOpenConfigDir}
          onOpenConfigFile={onOpenConfigFile}
          onOpenProjectWorkspacesDir={onOpenProjectWorkspacesDir}
          onOpenNavigationConfigFile={onOpenNavigationConfigFile}
          onCreateProjectWorkspace={onCreateProjectWorkspace}
          projectWorkspaces={projectWorkspaces}
          activeProjectWorkspaceKey={activeProjectWorkspaceKey}
          initialSection={settingsInitialSection}
          activePage={activePage}
          enabledPages={enabledPages}
          onEnabledPagesChange={onEnabledPagesChange}
          defaultPage={defaultPage}
          onDefaultPageChange={onDefaultPageChange}
          onProjectConfigSaved={onProjectConfigSaved}
          onOpenProjectManagement={openProjectManagementFromSettings}
          onClose={closeSettings}
        />
      ) : null}
      {!activityPanelMode ? (
        <ActivityCenter
          open={activityOpen}
          items={activityItems}
          onClose={() => setActivityOpen(false)}
          onClear={onClearHandledActivities}
          onOpenResource={onOpenActivityResource}
          onRunAction={async (entry) => {
            if (entry.action?.kind === "compareConfigSource") {
              setActivityOpen(false);
            }
            await onRunActivityAction(entry);
          }}
          onRefresh={onRefreshActivities}
          onResolveEntry={onResolveActivityEntry}
          onResolveEntries={onResolveActivityEntries}
          onOpenEntry={(entry) => {
            onOpenActivityEntry(entry);
            setActivityOpen(false);
          }}
        />
      ) : null}

      {activityPanelMode && activityOpen ? (
        <div
          className="activity-outside-click-catcher"
          role="presentation"
          onClick={() => setActivityOpen(false)}
        />
      ) : null}

      <div className={`workspace-frame${activityPanelMode && activityOpen ? " has-activity-panel" : ""}`}>
        <main className={`content content--${activePage}`}>
          <div className="content-stage">{children}</div>
        </main>
        {activityPanelMode ? (
          <ActivityCenter
            variant="panel"
            open={activityOpen}
            items={activityItems}
            onClose={() => setActivityOpen(false)}
            onClear={onClearHandledActivities}
            onOpenResource={onOpenActivityResource}
            onRunAction={async (entry) => {
              if (entry.action?.kind === "compareConfigSource") {
                setActivityOpen(false);
              }
              await onRunActivityAction(entry);
            }}
            onRefresh={onRefreshActivities}
            onResolveEntry={onResolveActivityEntry}
            onResolveEntries={onResolveActivityEntries}
            onOpenEntry={(entry) => {
              onOpenActivityEntry(entry);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
