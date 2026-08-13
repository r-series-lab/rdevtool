import { useEffect, useMemo, useRef, useState } from "react";
import { InputBase, Menu, MenuItem } from "@mui/material";
import type { ProjectWorkspaceSummary } from "../app-types";
import { useI18n } from "../i18n";
import { workspaceDisplayName } from "../lib/workspacePresentation";
import {
  AppWindowIcon,
  CheckIcon,
  ClearIcon,
  ExpandIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
} from "./AppIcons";

type WorkspaceSwitcherMenuProps = {
  anchorEl: HTMLElement | null;
  workspaces: ProjectWorkspaceSummary[];
  activeWorkspaceKey: string;
  switchingWorkspaceKey: string;
  onClose: () => void;
  onSelect: (workspaceKey: string) => void;
  onManage: () => void;
};

function matchesWorkspace(
  workspace: ProjectWorkspaceSummary,
  query: string,
  translatedSystemName: string,
) {
  const haystack = [
    workspace.system ? translatedSystemName : workspace.name,
    workspace.system ? translatedSystemName : "",
    workspace.name,
    workspace.key,
    workspace.description,
    workspace.workspaceTypeLabel,
    workspace.projectScopeLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

export function WorkspaceSwitcherMenu({
  anchorEl,
  workspaces,
  activeWorkspaceKey,
  switchingWorkspaceKey,
  onClose,
  onSelect,
  onManage,
}: WorkspaceSwitcherMenuProps) {
  const { t } = useI18n();
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const open = Boolean(anchorEl);
  const normalizedSearch = searchValue.trim().toLocaleLowerCase();
  const searching = Boolean(normalizedSearch);
  const visibleWorkspaces = useMemo(
    () =>
      searching
        ? workspaces.filter((workspace) =>
            matchesWorkspace(workspace, normalizedSearch, t("全局")),
          )
        : workspaces,
    [normalizedSearch, searching, t, workspaces],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearchValue("");
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }}
      transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      disableAutoFocusItem
      MenuListProps={{
        "aria-label": t("切换工作区"),
        className: "workspace-menu-list",
      }}
      slotProps={{
        paper: {
          className: "workspace-menu-paper",
        },
      }}
    >
      <div className="workspace-menu-head">
        <span className="workspace-menu-title">{t("切换工作区")}</span>
        <span className="workspace-menu-count">{workspaces.length}</span>
      </div>
      <div className="workspace-menu-search" onKeyDown={(event) => event.stopPropagation()}>
        <SearchIcon className="workspace-menu-search-icon" fontSize="small" />
        <InputBase
          inputRef={searchInputRef}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder={t("搜索工作区名称或 ID")}
          inputProps={{ "aria-label": t("搜索工作区名称或 ID") }}
          className="workspace-menu-search-input"
        />
        <button
          type="button"
          className="workspace-menu-search-clear"
          aria-label={t("清空搜索")}
          disabled={!searchValue}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setSearchValue("");
            searchInputRef.current?.focus();
          }}
        >
          <ClearIcon fontSize="small" />
        </button>
      </div>

      {visibleWorkspaces.length > 0 ? (
        <div className="workspace-menu-items">
          {visibleWorkspaces.map((workspace) => {
            const selected = workspace.key === activeWorkspaceKey;
            const switching = workspace.key === switchingWorkspaceKey;
            return (
              <MenuItem
                key={workspace.key}
                role="menuitemradio"
                aria-checked={selected}
                className={`workspace-menu-item${selected ? " is-active" : ""}`}
                selected={selected}
                disabled={switching}
                onClick={() => onSelect(workspace.key)}
              >
                <span className="workspace-menu-item-icon" aria-hidden="true">
                  {workspace.system ? (
                    <AppWindowIcon fontSize="small" />
                  ) : (
                    <PackageIcon fontSize="small" />
                  )}
                </span>
                <span className="workspace-menu-item-copy">
                  <span className="workspace-menu-item-name">
                    {workspace.system ? t("全局") : workspace.name}
                  </span>
                  <span className="workspace-menu-item-meta">
                    {workspace.system
                      ? t("全部项目")
                      : t("{count} 个项目", { count: workspace.projectCount })}
                  </span>
                </span>
                {selected ? (
                  <CheckIcon className="workspace-menu-item-check" fontSize="small" />
                ) : null}
              </MenuItem>
            );
          })}
        </div>
      ) : (
        <div className="workspace-menu-empty" role="status">
          <span className="workspace-menu-empty-icon" aria-hidden="true">
            <PackageIcon className="workspace-menu-empty-base-icon" fontSize="small" />
            <SearchIcon className="workspace-menu-empty-search-icon" fontSize="small" />
          </span>
          <strong>{t("未找到相关工作区")}</strong>
          <span>{t("请尝试其他关键词")}</span>
        </div>
      )}

      {searching && visibleWorkspaces.length > 0 ? (
        <button
          type="button"
          className="workspace-menu-show-all"
          onClick={() => {
            setSearchValue("");
            searchInputRef.current?.focus();
          }}
        >
          <span>{t("查看全部结果")}</span>
          <ExpandIcon fontSize="small" />
        </button>
      ) : null}

      {!searching ? (
        <MenuItem className="workspace-menu-item workspace-menu-item--manage" onClick={onManage}>
          <span className="workspace-menu-item-icon" aria-hidden="true">
            <SettingsIcon fontSize="small" />
          </span>
          <span className="workspace-menu-item-copy">
            <span className="workspace-menu-item-name">{t("工作区设置...")}</span>
            <span className="workspace-menu-item-meta">{t("范围、目录与入口配置")}</span>
          </span>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
