import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectWorkspaceEditorState,
  ProjectWorkspaceInstanceStatus,
  ProjectWorkspaceProjectInstanceDraft,
} from "../app-types";

type UseWorkspaceProjectInstanceStatusesOptions = {
  enabled: boolean;
  workspaceKey: string;
  instances: ProjectWorkspaceProjectInstanceDraft[];
};

export function useWorkspaceProjectInstanceStatuses({
  enabled,
  workspaceKey,
  instances,
}: UseWorkspaceProjectInstanceStatusesOptions) {
  const [statuses, setStatuses] = useState<ProjectWorkspaceInstanceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const instanceIdentity = useMemo(
    () =>
      instances
        .map((instance) => `${instance.project}:${instance.path}:${instance.managed}`)
        .sort()
        .join("|"),
    [instances],
  );

  const refresh = useCallback(async () => {
    if (!enabled || !workspaceKey || instances.length === 0) {
      setStatuses([]);
      setError("");
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const response = await invoke<ProjectWorkspaceInstanceStatus[]>(
        "list_project_workspace_instance_statuses",
        { workspaceKey },
      );
      if (requestId !== requestIdRef.current) {
        return;
      }
      setStatuses(Array.isArray(response) ? response : []);
      setError("");
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setError(String(reason));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, instanceIdentity, instances.length, workspaceKey]);

  useEffect(() => {
    requestIdRef.current += 1;
    setStatuses([]);
    setError("");
    if (enabled) {
      void refresh();
    }
  }, [enabled, refresh]);

  const byProject = useMemo(
    () => new Map(statuses.map((status) => [status.projectKey, status] as const)),
    [statuses],
  );

  const repair = useCallback(
    (project: string) =>
      invoke<ProjectWorkspaceEditorState>(
        "repair_project_workspace_project_instance",
        { workspaceKey, project },
      ),
    [workspaceKey],
  );

  return { statuses, byProject, loading, error, refresh, repair };
}
