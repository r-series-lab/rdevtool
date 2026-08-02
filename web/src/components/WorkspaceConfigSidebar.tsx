import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type {
  ProjectWorkspaceSummary,
  WorkspaceConfigFocusRequest,
} from "../app-types";
import {
  ArchiveIcon,
  FolderIcon,
  PlusIcon,
  RestoreIcon,
  TrashIcon,
  WebsiteIcon,
} from "./AppIcons";
import { AppListEndState } from "./AppListEndState";
import { workspaceArchiveMeta } from "../lib/workspaceLifecycle";
import { useI18n, type Translate } from "../i18n";

type WorkspaceConfigSidebarProps = {
  workspaces: ProjectWorkspaceSummary[];
  archivedWorkspaces: ProjectWorkspaceSummary[];
  editingWorkspaceKey: string;
  actionCounts: Record<string, number>;
  createOpen: boolean;
  busyKey: string;
  focusRequest?: WorkspaceConfigFocusRequest | null;
  onCreate: () => void;
  onSelect: (workspaceKey: string) => void;
  onArchive: (workspace: ProjectWorkspaceSummary) => void;
  onRestore: (workspace: ProjectWorkspaceSummary) => void;
  onDelete: (workspace: ProjectWorkspaceSummary) => void;
};

function workspaceMeta(
  workspace: ProjectWorkspaceSummary,
  view: "open" | "archived",
  t: Translate,
) {
  if (view === "archived") {
    const meta = workspaceArchiveMeta(workspace);
    return meta === "已归档" ? t(meta) : meta;
  }
  if (workspace.system) {
    return t("全部项目");
  }
  return `${workspace.projectScopeLabel} · ${workspace.navigationScopeLabel}`;
}

export function WorkspaceConfigSidebar({
  workspaces,
  archivedWorkspaces,
  editingWorkspaceKey,
  actionCounts,
  createOpen,
  busyKey,
  focusRequest,
  onCreate,
  onSelect,
  onArchive,
  onRestore,
  onDelete,
}: WorkspaceConfigSidebarProps) {
  const { t } = useI18n();
  const [view, setView] = useState<"open" | "archived">("open");
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const items = view === "open" ? workspaces : archivedWorkspaces;
  const count = items.length;
  const listEndLabel = useMemo(
    () =>
      count === 0 && view === "archived" ? t("暂无归档工作区") : undefined,
    [count, t, view],
  );

  useEffect(() => {
    if (!focusRequest) return;
    setView(focusRequest.view);
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current
        .get(focusRequest.workspaceKey)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  return (
    <Stack
      className="overview-workspace-config-sidebar"
      spacing={0.8}
      sx={{ minHeight: 0, overflow: "hidden", p: 1 }}
    >
      <Stack
        className="overview-workspace-config-menu-head"
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
      >
        <Stack className="overview-workspace-config-menu-copy" spacing={0.05}>
          <Typography
            className="overview-workspace-config-menu-title"
            variant="caption"
          >
            {t("工作区")}
          </Typography>
          <Typography
            className="overview-workspace-config-menu-count"
            variant="caption"
          >
            {t("{activeCount} 个使用中 · {archivedCount} 个已归档", {
              activeCount: workspaces.length,
              archivedCount: archivedWorkspaces.length,
            })}
          </Typography>
        </Stack>
        <Tooltip title={t("新建工作区")}>
          <IconButton
            size="small"
            color={createOpen ? "primary" : "default"}
            onClick={onCreate}
            aria-label={t("新建工作区")}
            aria-pressed={createOpen}
            sx={(theme) => ({
              width: 32,
              height: 32,
              border: "1px solid",
              borderColor: createOpen
                ? alpha(theme.palette.primary.main, 0.32)
                : theme.palette.divider,
              borderRadius: "8px",
              bgcolor: createOpen
                ? alpha(
                    theme.palette.primary.main,
                    theme.palette.mode === "dark" ? 0.12 : 0.08,
                  )
                : "transparent",
            })}
          >
            <PlusIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack
        className="overview-workspace-config-lifecycle-tabs"
        direction="row"
        spacing={0.5}
      >
        <Button
          size="small"
          variant={view === "open" ? "contained" : "text"}
          onClick={() => setView("open")}
        >
          {t("使用中 {count}", { count: workspaces.length })}
        </Button>
        <Button
          size="small"
          variant={view === "archived" ? "contained" : "text"}
          onClick={() => setView("archived")}
        >
          {t("已归档 {count}", { count: archivedWorkspaces.length })}
        </Button>
      </Stack>

      <Stack
        className="overview-workspace-config-menu-list"
        spacing={0.25}
        sx={{ overflow: "auto", minHeight: 0, flex: 1 }}
      >
        {items.map((workspace) => {
          const isEditing =
            view === "open" && workspace.key === editingWorkspaceKey;
          const busy = busyKey === workspace.key;
          const meta = workspaceMeta(workspace, view, t);
          return (
            <Box
              ref={(node: HTMLDivElement | null) => {
                if (node) {
                  itemRefs.current.set(workspace.key, node);
                } else {
                  itemRefs.current.delete(workspace.key);
                }
              }}
              key={workspace.key}
              className={`overview-workspace-config-item${isEditing ? " is-editing" : ""}${
                view === "archived" ? " is-archived" : ""
              }${
                focusRequest?.workspaceKey === workspace.key
                  ? " is-focused"
                  : ""
              }`}
              role={view === "open" ? "button" : "listitem"}
              tabIndex={view === "open" ? 0 : undefined}
              aria-pressed={view === "open" ? isEditing : undefined}
              onClick={view === "open" ? () => onSelect(workspace.key) : undefined}
              onKeyDown={(event) => {
                if (
                  view === "open" &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onSelect(workspace.key);
                }
              }}
            >
              <Stack
                className="overview-workspace-config-item-row"
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.85}
                  minWidth={0}
                  flex={1}
                >
                  <span
                    className={`overview-workspace-config-item-icon${
                      isEditing ? " is-active" : ""
                    }`}
                    aria-hidden="true"
                  >
                    {workspace.system ? (
                      <WebsiteIcon fontSize="small" />
                    ) : (
                      <FolderIcon fontSize="small" />
                    )}
                  </span>
                  <Stack
                    className="overview-workspace-config-item-copy"
                    spacing={0.18}
                    minWidth={0}
                  >
                    <Typography
                      className="overview-workspace-config-item-title"
                      variant="body2"
                      noWrap
                      title={workspace.name}
                    >
                      {workspace.name}
                    </Typography>
                    <Typography
                      className="overview-workspace-config-item-meta"
                      variant="caption"
                      noWrap
                      title={meta}
                    >
                      {meta}
                    </Typography>
                  </Stack>
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.45}
                  alignItems="center"
                  flex="0 0 auto"
                >
                  {view === "open" ? (
                    <Chip
                      className="overview-workspace-config-count-chip"
                      size="small"
                      label={actionCounts[workspace.key] ?? 0}
                    />
                  ) : null}
                  {!workspace.system && view === "open" ? (
                    <Tooltip title={t("归档工作区")}>
                      <IconButton
                        className="overview-workspace-config-archive"
                        size="small"
                        disabled={busy}
                        aria-label={t("归档工作区 {name}", {
                          name: workspace.name,
                        })}
                        onClick={(event) => {
                          event.stopPropagation();
                          onArchive(workspace);
                        }}
                      >
                        <ArchiveIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  {view === "archived" ? (
                    <>
                      <Tooltip title={t("恢复工作区")}>
                        <IconButton
                          size="small"
                          disabled={busy}
                          aria-label={t("恢复工作区 {name}", {
                            name: workspace.name,
                          })}
                          onClick={() => onRestore(workspace)}
                        >
                          <RestoreIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t("永久删除工作区配置")}>
                        <IconButton
                          className="overview-workspace-config-delete"
                          size="small"
                          disabled={busy}
                          aria-label={t("永久删除工作区配置 {name}", {
                            name: workspace.name,
                          })}
                          onClick={() => onDelete(workspace)}
                        >
                          <TrashIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : null}
                </Stack>
              </Stack>
            </Box>
          );
        })}
        <AppListEndState
          className="overview-workspace-config-list-end"
          label={listEndLabel}
        />
      </Stack>
    </Stack>
  );
}
