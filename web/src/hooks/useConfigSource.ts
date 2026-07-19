import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConfigSource } from "../app-types";
import {
  CONFIG_SOURCES_CHANGED_EVENT,
  configSourceChangeAffects,
  configSourceIdForWorkspace,
  configSourcePreferenceKey,
  ConfigSourceRequestTracker,
  configSourceSupports,
  findConfigSource,
  mergeConfigSourcesChangedPayload,
  resolveConfigSource,
  type ConfigSourcesChangedPayload,
} from "../lib/configSources";
import { disposeTauriListener } from "../lib/tauriEvents";

type UseConfigSourceOptions = {
  workspaceKey?: string | null;
  requiredCapability?: string;
  initialSourceId?: string;
};

export type ConfigSourceRefreshResult = {
  sources: ConfigSource[];
  source: ConfigSource;
  sourceId: string;
};

export type ConfigSourceStatus = "idle" | "loading" | "saving" | "ready" | "error";

const CONFIG_SOURCE_SELECTION_EVENT = "rdevtool:config-source-selection";

type ConfigSourceSelectionDetail = {
  preferenceKey: string;
  sourceId: string;
};

export function useConfigSource({
  workspaceKey,
  requiredCapability,
  initialSourceId,
}: UseConfigSourceOptions = {}) {
  const preferenceKey = useMemo(
    () => configSourcePreferenceKey(workspaceKey, requiredCapability),
    [requiredCapability, workspaceKey],
  );
  const resolvedWorkspaceKey = workspaceKey?.trim() || "system";
  const preferredSourceId = useMemo(
    () => {
      if (initialSourceId) {
        return initialSourceId;
      }
      try {
        return window.localStorage.getItem(preferenceKey) || configSourceIdForWorkspace(workspaceKey);
      } catch {
        return configSourceIdForWorkspace(workspaceKey);
      }
    },
    [initialSourceId, preferenceKey, workspaceKey],
  );
  const [sources, setSources] = useState<ConfigSource[]>([]);
  const [selectedSourceIdState, setSelectedSourceId] = useState(preferredSourceId);
  const [selectedScopeKey, setSelectedScopeKey] = useState(preferenceKey);
  const selectedSourceId =
    selectedScopeKey === preferenceKey ? selectedSourceIdState : preferredSourceId;
  const [sourceStatus, setSourceStatus] = useState<ConfigSourceStatus>("idle");
  const [sourceError, setSourceError] = useState("");
  const [externalRevision, setExternalRevision] = useState(0);
  const [lastExternalChange, setLastExternalChange] =
    useState<ConfigSourcesChangedPayload | null>(null);
  const selectedSourceIdRef = useRef(selectedSourceId);
  const currentScopeRef = useRef(preferenceKey);
  const requestTrackerRef = useRef(new ConfigSourceRequestTracker());
  currentScopeRef.current = preferenceKey;

  useEffect(() => {
    selectedSourceIdRef.current = selectedSourceId;
  }, [selectedSourceId]);

  useEffect(() => {
    requestTrackerRef.current.invalidate();
    setSourceError("");
    setSourceStatus("idle");
  }, [preferenceKey]);

  const rememberLocalSource = useCallback(
    (sourceId: string) => {
      try {
        window.localStorage.setItem(preferenceKey, sourceId);
      } catch {
        // Selection still works when persistent browser storage is unavailable.
      }
    },
    [preferenceKey],
  );

  const notifySourceSelection = useCallback(
    (sourceId: string) => {
      window.dispatchEvent(
        new CustomEvent<ConfigSourceSelectionDetail>(CONFIG_SOURCE_SELECTION_EVENT, {
          detail: { preferenceKey, sourceId },
        }),
      );
    },
    [preferenceKey],
  );

  const selectedSource = useMemo(
    () => resolveConfigSource(sources, selectedSourceId, requiredCapability),
    [requiredCapability, selectedSourceId, sources],
  );

  const applySources = useCallback(
    (nextSources: ConfigSource[], requestedSourceId?: string | null): ConfigSourceRefreshResult => {
      const source = resolveConfigSource(
        nextSources,
        requestedSourceId ?? selectedSourceIdRef.current,
        requiredCapability,
      );
      if (!source) {
        throw new Error(
          requiredCapability
            ? `没有支持 ${requiredCapability} 的配置源`
            : "没有可用的配置源",
        );
      }
      setSources(nextSources);
      selectedSourceIdRef.current = source.id;
      setSelectedScopeKey(preferenceKey);
      setSelectedSourceId(source.id);
      rememberLocalSource(source.id);
      setSourceError("");
      setSourceStatus("ready");
      notifySourceSelection(source.id);
      return { sources: nextSources, source, sourceId: source.id };
    },
    [notifySourceSelection, preferenceKey, rememberLocalSource, requiredCapability],
  );

  const adoptSources = useCallback(
    (nextSources: ConfigSource[], requestedSourceId?: string | null): ConfigSourceRefreshResult => {
      requestTrackerRef.current.begin(preferenceKey);
      return applySources(nextSources, requestedSourceId);
    },
    [applySources, preferenceKey],
  );

  const refreshSources = useCallback(
    async (requestedSourceId?: string): Promise<ConfigSourceRefreshResult | null> => {
      const token = requestTrackerRef.current.begin(preferenceKey);
      setSourceStatus("loading");
      setSourceError("");
      try {
        const preferencePromise =
          requestedSourceId || initialSourceId || !requiredCapability
            ? Promise.resolve(requestedSourceId ?? initialSourceId ?? preferredSourceId)
            : invoke<string>("get_config_source_preference", {
                workspaceKey: resolvedWorkspaceKey,
                capability: requiredCapability,
              }).catch(() => preferredSourceId);
        const [persistedSourceId, nextSources] = await Promise.all([
          preferencePromise,
          invoke<ConfigSource[]>("list_config_sources"),
        ]);
        if (!requestTrackerRef.current.isCurrent(token, currentScopeRef.current)) {
          return null;
        }
        return applySources(nextSources, persistedSourceId);
      } catch (reason) {
        if (!requestTrackerRef.current.isCurrent(token, currentScopeRef.current)) {
          return null;
        }
        const message = String(reason);
        setSourceError(message);
        setSourceStatus("error");
        throw reason;
      }
    },
    [
      applySources,
      initialSourceId,
      preferredSourceId,
      requiredCapability,
      resolvedWorkspaceKey,
    ],
  );

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | undefined;
    let pendingChange: ConfigSourcesChangedPayload | null = null;
    let unlistenConfigSourceChanges: (() => void) | undefined;

    void listen<ConfigSourcesChangedPayload>(CONFIG_SOURCES_CHANGED_EVENT, (event) => {
      if (!configSourceChangeAffects(event.payload, selectedSourceIdRef.current)) {
        return;
      }
      pendingChange = mergeConfigSourcesChangedPayload(pendingChange, event.payload);
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        const change = pendingChange;
        pendingChange = null;
        if (!change || disposed) {
          return;
        }
        void refreshSources(selectedSourceIdRef.current)
          .then((result) => {
            if (!disposed && result) {
              setLastExternalChange(change);
              setExternalRevision((current) => Math.max(current + 1, change.revision));
            }
          })
          .catch(() => undefined);
      }, 240);
    })
      .then((unlisten) => {
        if (disposed) {
          disposeTauriListener(unlisten);
          return;
        }
        unlistenConfigSourceChanges = unlisten;
      })
      .catch((reason) => {
        if (!disposed) {
          setSourceError(`监听配置源变化失败：${String(reason)}`);
          setSourceStatus("error");
        }
      });

    return () => {
      disposed = true;
      disposeTauriListener(unlistenConfigSourceChanges);
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [refreshSources]);

  const selectSource = useCallback(
    async (sourceId: string): Promise<ConfigSource | null> => {
      const source = findConfigSource(sources, sourceId);
      if (!source || (requiredCapability && !configSourceSupports(source, requiredCapability))) {
        return null;
      }
      setSourceError("");
      const token = requestTrackerRef.current.begin(preferenceKey);
      setSourceStatus("saving");
      try {
        const persistedSourceId =
          !initialSourceId && requiredCapability
            ? await invoke<string>("save_config_source_preference", {
                workspaceKey: resolvedWorkspaceKey,
                capability: requiredCapability,
                sourceId: source.id,
              })
            : source.id;
        if (!requestTrackerRef.current.isCurrent(token, currentScopeRef.current)) {
          return null;
        }
        const persistedSource = findConfigSource(sources, persistedSourceId) ?? source;
        selectedSourceIdRef.current = persistedSource.id;
        setSelectedScopeKey(preferenceKey);
        setSelectedSourceId(persistedSource.id);
        rememberLocalSource(persistedSource.id);
        setSourceStatus("ready");
        notifySourceSelection(persistedSource.id);
        return persistedSource;
      } catch (reason) {
        if (!requestTrackerRef.current.isCurrent(token, currentScopeRef.current)) {
          return null;
        }
        setSourceError(String(reason));
        setSourceStatus("error");
        throw reason;
      }
    },
    [
      initialSourceId,
      preferenceKey,
      notifySourceSelection,
      rememberLocalSource,
      requiredCapability,
      resolvedWorkspaceKey,
      sources,
    ],
  );

  useEffect(() => {
    function handleSelection(event: Event) {
      const detail = (event as CustomEvent<ConfigSourceSelectionDetail>).detail;
      if (!detail || detail.preferenceKey !== preferenceKey) {
        return;
      }
      const source = findConfigSource(sources, detail.sourceId);
      if (
        !source ||
        selectedSourceIdRef.current === source.id ||
        (requiredCapability && !configSourceSupports(source, requiredCapability))
      ) {
        return;
      }
      requestTrackerRef.current.invalidate();
      selectedSourceIdRef.current = source.id;
      setSelectedScopeKey(preferenceKey);
      setSelectedSourceId(source.id);
      rememberLocalSource(source.id);
      setSourceError("");
      setSourceStatus("ready");
    }

    window.addEventListener(CONFIG_SOURCE_SELECTION_EVENT, handleSelection);
    return () => window.removeEventListener(CONFIG_SOURCE_SELECTION_EVENT, handleSelection);
  }, [preferenceKey, rememberLocalSource, requiredCapability, sources]);

  const loadingSources = sourceStatus === "loading";
  const savingSource = sourceStatus === "saving";

  return {
    sources,
    selectedSource,
    selectedSourceId,
    preferredSourceId,
    loadingSources,
    savingSource,
    sourceBusy: loadingSources || savingSource,
    sourceStatus,
    sourceError,
    externalRevision,
    lastExternalChange,
    refreshSources,
    adoptSources,
    selectSource,
    supports: (capability: string) => configSourceSupports(selectedSource, capability),
  };
}
