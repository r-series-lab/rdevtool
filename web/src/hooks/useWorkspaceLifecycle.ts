import { Fragment, createElement, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectWorkspaceState,
  ProjectWorkspaceSummary,
  WorkspaceArchivePlan,
} from "../app-types";
import { useAppConfirmDialog } from "../components/AppConfirmDialog";
import {
  unmanagedWorkspaceArchiveBlocker,
} from "../lib/workspaceLifecycle";
import { useWorkspaceArchiveDialog } from "./useWorkspaceArchiveDialog";

type UseWorkspaceLifecycleOptions = {
  onChanged: () => Promise<void> | void;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
};

export function useWorkspaceLifecycle({
  onChanged,
  setError,
  setStatus,
}: UseWorkspaceLifecycleOptions) {
  const [busyKey, setBusyKey] = useState("");
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const [requestArchive, archiveDialog] = useWorkspaceArchiveDialog();

  async function archiveWorkspace(workspace: ProjectWorkspaceSummary) {
    setBusyKey(workspace.key);
    setError("");
    setStatus("");
    try {
      const plan = await invoke<WorkspaceArchivePlan>(
        "plan_project_workspace_archive",
        { workspaceKey: workspace.key },
      );
      const unmanaged = unmanagedWorkspaceArchiveBlocker(plan);
      if (unmanaged) {
        throw new Error(
          `${unmanaged.label}不是 rDevTool 受管进程，请先处理后再归档。${unmanaged.detail}`,
        );
      }
      const decision = await requestArchive(plan);
      if (!decision.confirmed) {
        return;
      }
      await invoke<ProjectWorkspaceState>("archive_project_workspace", {
        workspaceKey: workspace.key,
        reason: decision.reason,
        stopRunning: plan.blockers.length > 0,
      });
      await onChanged();
      setStatus(`已归档工作区：${workspace.name}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyKey("");
    }
  }

  async function restoreWorkspace(workspace: ProjectWorkspaceSummary) {
    setBusyKey(workspace.key);
    setError("");
    setStatus("");
    try {
      const confirmed = await confirm({
        title: "恢复工作区",
        description: `恢复“${workspace.name}”后，它会重新出现在工作区列表和相关快捷入口中。`,
        confirmLabel: "恢复",
        tone: "neutral",
      });
      if (!confirmed) {
        return;
      }
      await invoke<ProjectWorkspaceState>("restore_project_workspace", {
        workspaceKey: workspace.key,
      });
      await onChanged();
      setStatus(`已恢复工作区：${workspace.name}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyKey("");
    }
  }

  return {
    busyKey,
    archiveWorkspace,
    restoreWorkspace,
    confirmDialog: createElement(
      Fragment,
      null,
      archiveDialog,
      confirmDialog,
    ),
  };
}
