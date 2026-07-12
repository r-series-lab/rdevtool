import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  Button,
  Menu,
  MenuItem,
} from "@mui/material";
import type { PageKey } from "../app-shell";
import type { CreateProjectWorkspacePayload, ProjectWorkspaceSummary } from "../app-types";
import type { ActivityEntry } from "../lib/activityCenter";
import type { AppStyleMode } from "../theme";
import {
  CheckIcon,
  ExpandIcon,
  FolderIcon,
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

type NavItem = {
  key: PageKey;
  label: string;
  shortLabel: string;
};

type AppShellLayoutProps = {
  visibleNavItems: NavItem[];
  activePage: PageKey;
  onPageChange: (page: PageKey) => void;
  enabledPages: PageKey[];
  onEnabledPagesChange: (pages: PageKey[]) => void;
  defaultPage: PageKey;
  onDefaultPageChange: (page: PageKey) => void;
  styleMode: AppStyleMode;
  onStyleModeChange: (mode: AppStyleMode) => void;
  projectWorkspaces: ProjectWorkspaceSummary[];
  activeProjectWorkspaceKey: string;
  onProjectWorkspaceChange: (workspaceKey: string) => Promise<void> | void;
  selectedProjectKey: string;
  onOpenConfigDir: () => void;
  onOpenConfigFile: () => void;
  onOpenProjectWorkspacesDir: () => void;
  onOpenNavigationConfigFile: () => void;
  onCreateProjectWorkspace: (payload: CreateProjectWorkspacePayload) => Promise<void> | void;
  onProjectConfigSaved: () => Promise<void> | void;
  activityItems: ActivityEntry[];
  activityAlertCount: number;
  onOpenActivityEntry: (entry: ActivityEntry) => void;
  onOpenActivityResource: (entry: ActivityEntry) => void;
  onRefreshActivities: (options?: { force?: boolean }) => Promise<void> | void;
  onAcknowledgeActivityEntry: (entry: ActivityEntry) => void;
  onAcknowledgeActivityEntries: (entries: ActivityEntry[]) => void;
  onClearActivities: () => void;
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
    case "projects":
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
  enabledPages,
  onEnabledPagesChange,
  defaultPage,
  onDefaultPageChange,
  styleMode,
  onStyleModeChange,
  projectWorkspaces,
  activeProjectWorkspaceKey,
  onProjectWorkspaceChange,
  selectedProjectKey,
  onOpenConfigDir,
  onOpenConfigFile,
  onOpenProjectWorkspacesDir,
  onOpenNavigationConfigFile,
  onCreateProjectWorkspace,
  onProjectConfigSaved,
  activityItems,
  activityAlertCount,
  onOpenActivityEntry,
  onOpenActivityResource,
  onRefreshActivities,
  onAcknowledgeActivityEntry,
  onAcknowledgeActivityEntries,
  onClearActivities,
  busy,
  error,
  children,
}: AppShellLayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSection | undefined>();
  const [activityOpen, setActivityOpen] = useState(false);
  const [workspaceMenuAnchor, setWorkspaceMenuAnchor] = useState<HTMLElement | null>(null);
  const [workspaceSwitchingKey, setWorkspaceSwitchingKey] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  function openSettings(section?: SettingsSection) {
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
    } finally {
      setWorkspaceSwitchingKey("");
    }
  }

  function openWorkspaceWorkbenchFromMenu() {
    closeWorkspaceMenu();
    openSettings("workspace");
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
          aria-label={desktopSidebarCollapsed ? "展开导航栏" : "收起导航栏"}
          title={desktopSidebarCollapsed ? "展开导航栏" : "收起导航栏"}
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-expanded={!desktopSidebarCollapsed}
        >
          <PanelSideIcon fontSize="small" />
        </button>
      ) : null}
      <div className="window-toolbar" aria-label="窗口工具">
        <button
          type="button"
          className="activity-icon-toggle"
          aria-label={activityOpen ? "关闭活动中心" : "打开活动中心"}
          title="活动"
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
          aria-label="打开设置"
          title="设置"
          onClick={() => openSettings()}
          aria-expanded={settingsOpen}
        >
          <SettingsIcon fontSize="small" />
        </button>
      </div>
      <aside className={`sidebar${desktopSidebarCollapsed ? " sidebar--collapsed" : ""}`}>
        <div className="shell-brand">
          <div className="shell-brand-mark" aria-hidden="true">
            R
          </div>
        </div>

        <nav className="nav-stack">
          {visibleNavItems.map((item) => (
            <Button
              key={item.key}
              variant="text"
              color="inherit"
              className={`nav-item${item.key === activePage ? " is-active" : ""}`}
              onClick={() => onPageChange(item.key)}
              title={item.label}
              aria-current={item.key === activePage ? "page" : undefined}
            >
              {navIconForPage(item.key)}
              <span className="nav-item-label">{item.shortLabel}</span>
            </Button>
          ))}
        </nav>
        {projectWorkspaces.length > 0 ? (
          <div className="sidebar-footer">
            <button
              type="button"
              className={`workspace-switcher${workspaceMenuOpen ? " is-open" : ""}`}
              aria-label="切换工作区"
              aria-haspopup="menu"
              aria-expanded={workspaceMenuOpen}
              onClick={openWorkspaceMenu}
              title={
                activeProjectWorkspace
                  ? `${activeProjectWorkspace.name} · 切换工作区`
                  : "切换工作区"
              }
            >
              <span className="workspace-switcher-name">
                {activeProjectWorkspace?.name ?? "工作区"}
              </span>
              <ExpandIcon className="workspace-switcher-chevron" fontSize="small" />
            </button>
            <Menu
              anchorEl={workspaceMenuAnchor}
              open={workspaceMenuOpen}
              onClose={closeWorkspaceMenu}
              anchorOrigin={{ vertical: "top", horizontal: "left" }}
              transformOrigin={{ vertical: "bottom", horizontal: "left" }}
              MenuListProps={{
                "aria-label": "切换工作区",
                className: "workspace-menu-list",
              }}
              slotProps={{
                paper: {
                  className: "workspace-menu-paper",
                },
              }}
            >
              {projectWorkspaces.map((workspace) => {
                const selected = workspace.key === activeProjectWorkspaceKey;
                const switching = workspace.key === workspaceSwitchingKey;
                return (
                  <MenuItem
                    key={workspace.key}
                    className={`workspace-menu-item${selected ? " is-active" : ""}`}
                    selected={selected}
                    disabled={switching}
                    onClick={() => void selectProjectWorkspace(workspace.key)}
                  >
                    <span className="workspace-menu-item-copy">
                      <span className="workspace-menu-item-name">{workspace.name}</span>
                      <span className="workspace-menu-item-meta">
                        {workspace.projectScopeLabel}
                      </span>
                    </span>
                    {selected ? (
                      <CheckIcon className="workspace-menu-item-check" fontSize="small" />
                    ) : null}
                  </MenuItem>
                );
              })}
              <MenuItem
                className="workspace-menu-item workspace-menu-item--manage"
                onClick={openWorkspaceWorkbenchFromMenu}
              >
                <span className="workspace-menu-item-copy">
                  <span className="workspace-menu-item-name">工作区设置...</span>
                  <span className="workspace-menu-item-meta">范围、目录与入口配置</span>
                </span>
                <SettingsIcon className="workspace-menu-item-check" fontSize="small" />
              </MenuItem>
            </Menu>
          </div>
        ) : null}
      </aside>

      {settingsOpen ? (
        <SettingsPanel
          styleMode={styleMode}
          onStyleModeChange={onStyleModeChange}
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
          onClose={closeSettings}
        />
      ) : null}
      {!activityPanelMode ? (
        <ActivityCenter
          open={activityOpen}
          items={activityItems}
          onClose={() => setActivityOpen(false)}
          onClear={onClearActivities}
          onOpenResource={onOpenActivityResource}
          onRefresh={onRefreshActivities}
          onAcknowledgeEntry={onAcknowledgeActivityEntry}
          onAcknowledgeEntries={onAcknowledgeActivityEntries}
          onOpenEntry={(entry) => {
            onOpenActivityEntry(entry);
            setActivityOpen(false);
          }}
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
            onClear={onClearActivities}
            onOpenResource={onOpenActivityResource}
            onRefresh={onRefreshActivities}
            onAcknowledgeEntry={onAcknowledgeActivityEntry}
            onAcknowledgeEntries={onAcknowledgeActivityEntries}
            onOpenEntry={(entry) => {
              onOpenActivityEntry(entry);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
