import { useEffect, useMemo, useRef, useState } from "react";
import { InputBase, Menu, MenuItem } from "@mui/material";
import type { ProjectWorkspaceSummary } from "../app-types";
import {
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

export function workspaceDisplayName(workspace: ProjectWorkspaceSummary | null) {
  if (!workspace) {
    return "工作区";
  }
  return workspace.system ? "全局" : workspace.name;
}

function workspaceMeta(workspace: ProjectWorkspaceSummary) {
  return workspace.system ? "全部项目" : `${workspace.projectCount} 个项目`;
}

function matchesWorkspace(workspace: ProjectWorkspaceSummary, query: string) {
  const haystack = [
    workspaceDisplayName(workspace),
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
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const open = Boolean(anchorEl);
  const normalizedSearch = searchValue.trim().toLocaleLowerCase();
  const searching = Boolean(normalizedSearch);
  const visibleWorkspaces = useMemo(
    () =>
      searching
        ? workspaces.filter((workspace) => matchesWorkspace(workspace, normalizedSearch))
        : workspaces,
    [normalizedSearch, searching, workspaces],
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
        "aria-label": "切换工作区",
        className: "workspace-menu-list",
      }}
      slotProps={{
        paper: {
          className: "workspace-menu-paper",
        },
      }}
    >
      <div className="workspace-menu-search" onKeyDown={(event) => event.stopPropagation()}>
        <SearchIcon className="workspace-menu-search-icon" fontSize="small" />
        <InputBase
          inputRef={searchInputRef}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="搜索工作区名称或 ID"
          inputProps={{ "aria-label": "搜索工作区名称或 ID" }}
          className="workspace-menu-search-input"
        />
        <button
          type="button"
          className="workspace-menu-search-clear"
          aria-label="清空搜索"
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
                <span className="workspace-menu-item-copy">
                  <span className="workspace-menu-item-name">
                    {workspaceDisplayName(workspace)}
                  </span>
                  <span className="workspace-menu-item-meta">{workspaceMeta(workspace)}</span>
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
          <strong>未找到相关工作区</strong>
          <span>请尝试其他关键词</span>
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
          <span>查看全部结果</span>
          <ExpandIcon fontSize="small" />
        </button>
      ) : null}

      {!searching ? (
        <MenuItem className="workspace-menu-item workspace-menu-item--manage" onClick={onManage}>
          <span className="workspace-menu-item-icon" aria-hidden="true">
            <SettingsIcon fontSize="small" />
          </span>
          <span className="workspace-menu-item-copy">
            <span className="workspace-menu-item-name">工作区设置...</span>
            <span className="workspace-menu-item-meta">范围、目录与入口配置</span>
          </span>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
