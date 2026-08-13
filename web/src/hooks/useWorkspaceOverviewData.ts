import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectWorkspaceEditorDraft,
  ProjectWorkspaceEditorState,
} from "../app-types";
import { listenTrayPinnedActionsChanged } from "../lib/trayPins";
import { disposeTauriListener } from "../lib/tauriEvents";
import {
  mergeWorkspaceActionPatches,
  mergeWorkspaceOverviewDetails,
  mergeWorkspaceOverviewSummaries,
  workspaceOverviewDetailKeys,
  type WorkspaceProgressiveOverview,
} from "../lib/workspaceOverviewSync";

type UseWorkspaceOverviewDataOptions = {
  activeWorkspaceKey: string;
  editorOpen: boolean;
  onError: (message: string) => void;
};

export function useWorkspaceOverviewData<TOverview extends WorkspaceProgressiveOverview>({
  activeWorkspaceKey,
  editorOpen,
  onError,
}: UseWorkspaceOverviewDataOptions) {
  const [groups, setGroups] = useState<TOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceEditor, setWorkspaceEditor] =
    useState<ProjectWorkspaceEditorState | null>(null);
  const [workspaceDraft, setWorkspaceDraft] =
    useState<ProjectWorkspaceEditorDraft | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const onErrorRef = useRef(onError);
  const editorAutoLoadKeyRef = useRef("");
  const editorRequestIdRef = useRef(0);
  const overviewRequestIdRef = useRef(0);
  const groupsRef = useRef<TOverview[]>([]);
  const activeWorkspaceKeyRef = useRef(activeWorkspaceKey);
  const previousActiveWorkspaceKeyRef = useRef(activeWorkspaceKey);

  useEffect(() => {
    onErrorRef.current = onError;
    activeWorkspaceKeyRef.current = activeWorkspaceKey;
  }, [activeWorkspaceKey, onError]);

  const commitGroups = useCallback((next: TOverview[]) => {
    groupsRef.current = next;
    setGroups(next);
  }, []);

  const loadOverview = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = overviewRequestIdRef.current + 1;
    overviewRequestIdRef.current = requestId;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      let summaries: TOverview[];
      try {
        summaries = await invoke<TOverview[]>(
          "get_workspace_pinned_actions_overview_summary",
        );
      } catch {
        const fallback = await invoke<TOverview[]>(
          "get_workspace_pinned_actions_overview",
        );
        if (requestId === overviewRequestIdRef.current) {
          commitGroups(fallback);
        }
        return;
      }
      if (requestId !== overviewRequestIdRef.current) {
        return;
      }
      commitGroups(
        options?.silent
          ? mergeWorkspaceOverviewSummaries(groupsRef.current, summaries)
          : summaries,
      );
      setLoading(false);

      const activeKey = activeWorkspaceKeyRef.current.trim();
      const activeKeys = workspaceOverviewDetailKeys(summaries, activeKey);
      if (activeKeys.length > 0) {
        const activeDetails = await invoke<TOverview[]>(
          "get_workspace_pinned_actions_overview_details",
          { workspaceKeys: activeKeys },
        );
        if (requestId !== overviewRequestIdRef.current) {
          return;
        }
        commitGroups(
          mergeWorkspaceOverviewDetails(
            groupsRef.current,
            activeDetails,
          ),
        );
      }
    } catch (reason) {
      if (requestId === overviewRequestIdRef.current) {
        onErrorRef.current(String(reason));
      }
    } finally {
      if (requestId === overviewRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [commitGroups]);

  const loadProjectWorkspaceEditor = useCallback(
    async (workspaceKey?: string) => {
      const requestId = editorRequestIdRef.current + 1;
      editorRequestIdRef.current = requestId;
      setWorkspaceLoading(true);
      try {
        const nextState = await invoke<ProjectWorkspaceEditorState>(
          "get_project_workspace_editor",
          {
            workspaceKey: workspaceKey || activeWorkspaceKey,
          },
        );
        if (requestId !== editorRequestIdRef.current) {
          return null;
        }
        setWorkspaceEditor(nextState);
        setWorkspaceDraft(nextState.workspace);
        return nextState;
      } catch (reason) {
        if (requestId === editorRequestIdRef.current) {
          onErrorRef.current(String(reason));
        }
        return null;
      } finally {
        if (requestId === editorRequestIdRef.current) {
          setWorkspaceLoading(false);
        }
      }
    },
    [activeWorkspaceKey],
  );

  const applyWorkspaceEditorState = useCallback(
    (nextState: ProjectWorkspaceEditorState) => {
      setWorkspaceEditor(nextState);
      setWorkspaceDraft(nextState.workspace);
    },
    [],
  );

  useEffect(() => {
    void loadOverview();
  }, [activeWorkspaceKey, loadOverview]);

  useEffect(() => {
    let disposed = false;
    let refreshTimer = 0;
    let unlisten: (() => void) | null = null;

    const scheduleFullRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (!disposed) {
          void loadOverview({ silent: true });
        }
      }, 80);
    };

    void listenTrayPinnedActionsChanged((payload) => {
      if (
        payload.requiresOverviewRefresh ||
        payload.workspacePatches.length === 0
      ) {
        scheduleFullRefresh();
        return;
      }
      const result = mergeWorkspaceActionPatches(
        groupsRef.current,
        payload.workspacePatches,
      );
      if (!result.applied || result.missingWorkspaceKeys.length > 0) {
        scheduleFullRefresh();
        return;
      }
      overviewRequestIdRef.current += 1;
      commitGroups(result.groups);
      setLoading(false);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          disposeTauriListener(nextUnlisten);
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.error("failed to listen for tray pinned action changes", error);
        }
      });

    return () => {
      disposed = true;
      window.clearTimeout(refreshTimer);
      disposeTauriListener(unlisten);
    };
  }, [commitGroups, loadOverview]);

  useEffect(() => {
    if (
      previousActiveWorkspaceKeyRef.current !== activeWorkspaceKey &&
      !editorOpen
    ) {
      editorRequestIdRef.current += 1;
      editorAutoLoadKeyRef.current = "";
      setWorkspaceEditor(null);
      setWorkspaceDraft(null);
      setWorkspaceLoading(false);
    }
    previousActiveWorkspaceKeyRef.current = activeWorkspaceKey;
  }, [activeWorkspaceKey, editorOpen]);

  useEffect(() => {
    if (!editorOpen) {
      editorAutoLoadKeyRef.current = "";
      return;
    }
    if (
      workspaceEditor ||
      workspaceLoading ||
      editorAutoLoadKeyRef.current === activeWorkspaceKey
    ) {
      return;
    }
    editorAutoLoadKeyRef.current = activeWorkspaceKey;
    void loadProjectWorkspaceEditor(activeWorkspaceKey);
  }, [
    activeWorkspaceKey,
    editorOpen,
    loadProjectWorkspaceEditor,
    workspaceEditor,
    workspaceLoading,
  ]);

  return {
    groups,
    loading,
    loadOverview,
    workspaceEditor,
    workspaceDraft,
    setWorkspaceDraft,
    workspaceLoading,
    loadProjectWorkspaceEditor,
    applyWorkspaceEditorState,
  };
}
