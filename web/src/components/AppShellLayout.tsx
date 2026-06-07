import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
} from "@mui/material";
import type { PageKey } from "../app-shell";
import type { ActivityEntry } from "../lib/activityCenter";
import type { AppStyleMode } from "../theme";
import { PanelSideIcon, SettingsIcon } from "./AppIcons";
import { ActivityCenter } from "./ActivityCenter";
import { SettingsPanel } from "./SettingsPanel";

type NavItem = {
  key: PageKey;
  label: string;
  shortLabel: string;
};

type AppShellLayoutProps = {
  visibleNavItems: NavItem[];
  activePage: PageKey;
  onPageChange: (page: PageKey) => void;
  styleMode: AppStyleMode;
  onStyleModeChange: (mode: AppStyleMode) => void;
  selectedProjectKey: string;
  onOpenConfigDir: () => void;
  onOpenConfigFile: () => void;
  onOpenNavigationConfigFile: () => void;
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

export function AppShellLayout({
  visibleNavItems,
  activePage,
  onPageChange,
  styleMode,
  onStyleModeChange,
  selectedProjectKey,
  onOpenConfigDir,
  onOpenConfigFile,
  onOpenNavigationConfigFile,
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
  const [activityOpen, setActivityOpen] = useState(false);
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

  function openSettings() {
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  const visibleBusy = shouldShowBusyMessage(busy) ? busy : "";

  return (
      <div className="shell">
      <div className="window-drag-region" data-tauri-drag-region />
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
          onClick={openSettings}
          aria-expanded={settingsOpen}
        >
          <SettingsIcon fontSize="small" />
        </button>
      </div>
      <aside className="sidebar">
        <div className="shell-brand">
          <div className="shell-brand-mark" aria-hidden="true">
            R
          </div>
        </div>

        <nav className="nav-stack">
          {visibleNavItems.map((item) => (
            <Button
              key={item.key}
              variant={item.key === activePage ? "contained" : "outlined"}
              color={item.key === activePage ? "primary" : "inherit"}
              className="nav-item"
              onClick={() => onPageChange(item.key)}
              title={item.label}
              aria-current={item.key === activePage ? "page" : undefined}
            >
              <span className="nav-item-label">{item.shortLabel}</span>
            </Button>
          ))}
        </nav>
      </aside>

      {settingsOpen ? (
        <SettingsPanel
          styleMode={styleMode}
          onStyleModeChange={onStyleModeChange}
          selectedProjectKey={selectedProjectKey}
          onOpenConfigDir={onOpenConfigDir}
          onOpenConfigFile={onOpenConfigFile}
          onOpenNavigationConfigFile={onOpenNavigationConfigFile}
          activePage={activePage}
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
        <main className="content">
          {visibleBusy || error ? (
            <div className="content-status-stack">
              {visibleBusy ? (
                <Alert severity="info" sx={{ py: 0 }}>
                  {visibleBusy}
                </Alert>
              ) : null}
              {error ? (
                <Alert severity="error" sx={{ py: 0 }}>
                  {error}
                </Alert>
              ) : null}
            </div>
          ) : null}
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
