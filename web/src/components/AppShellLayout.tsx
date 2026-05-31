import { useState, type ReactNode } from "react";
import {
  Alert,
  Button,
} from "@mui/material";
import type { PageKey } from "../app-shell";
import type { ActivityEntry } from "../lib/activityCenter";
import type { AppStyleMode } from "../theme";
import { ActivityIcon, SettingsIcon, TerminalIcon } from "./AppIcons";
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
  onOpenCommandPalette: () => void;
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
  onRefreshActivities: () => Promise<void> | void;
  onAcknowledgeActivityEntry: (entry: ActivityEntry) => void;
  onAcknowledgeActivityEntries: (entries: ActivityEntry[]) => void;
  onClearActivities: () => void;
  busy: string;
  error: string;
  children: ReactNode;
};

export function AppShellLayout({
  visibleNavItems,
  activePage,
  onPageChange,
  onOpenCommandPalette,
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

  function openSettings() {
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  return (
    <div className="shell">
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
        <div className="sidebar-footer">
          <button
            type="button"
            className="command-icon-toggle"
            aria-label="打开命令面板"
            title="命令面板 Cmd/Ctrl K"
            onClick={onOpenCommandPalette}
          >
            <TerminalIcon fontSize="small" />
          </button>
          <button
            type="button"
            className="activity-icon-toggle"
            aria-label="打开活动中心"
            title="活动"
            onClick={() => setActivityOpen(true)}
            aria-expanded={activityOpen}
          >
            <ActivityIcon fontSize="small" />
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

      <main className="content">
        {busy || error ? (
          <div className="content-status-stack">
            {busy ? (
              <Alert severity="info" sx={{ py: 0 }}>
                {busy}
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
    </div>
  );
}
