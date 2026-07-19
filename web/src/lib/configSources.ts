import type { ConfigSource } from "../app-types";

export const DEFAULT_CONFIG_SOURCE_ID = "default";
export const SYSTEM_WORKSPACE_KEY = "system";
export const CONFIG_SOURCE_PREFERENCE_PREFIX = "rdevtool.config-source";
export const CONFIG_SOURCES_CHANGED_EVENT = "rdevtool://config-sources-changed";

export type ConfigSourcesChangedPayload = {
  revision: number;
  origin?: "internal" | "external";
  sourceIds: string[];
  catalogChanged: boolean;
};

export function mergeConfigSourcesChangedPayload(
  current: ConfigSourcesChangedPayload | null,
  next: ConfigSourcesChangedPayload,
): ConfigSourcesChangedPayload {
  if (!current) return next;
  return {
    revision: Math.max(current.revision, next.revision),
    origin:
      current.origin === "external" || next.origin === "external"
        ? "external"
        : next.origin ?? current.origin,
    sourceIds: [...new Set([...current.sourceIds, ...next.sourceIds])],
    catalogChanged: current.catalogChanged || next.catalogChanged,
  };
}

export type ConfigSourceRequestToken = {
  id: number;
  scope: string;
};

export class ConfigSourceRequestTracker {
  private sequence = 0;
  private current: ConfigSourceRequestToken | null = null;

  begin(scope: string): ConfigSourceRequestToken {
    const token = { id: this.sequence + 1, scope };
    this.sequence = token.id;
    this.current = token;
    return token;
  }

  isCurrent(token: ConfigSourceRequestToken, scope: string): boolean {
    return this.current?.id === token.id && token.scope === scope;
  }

  invalidate(): void {
    this.sequence += 1;
    this.current = null;
  }
}

export function configSourceChangeAffects(
  payload: ConfigSourcesChangedPayload,
  sourceId?: string | null,
): boolean {
  return (
    payload.catalogChanged ||
    !sourceId ||
    payload.sourceIds.some((candidate) => candidate === sourceId)
  );
}

export function normalizeConfigSourceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function configSourceIdForWorkspace(workspaceKey?: string | null): string {
  const key = normalizeConfigSourceId(workspaceKey ?? "");
  if (!key || key === SYSTEM_WORKSPACE_KEY) {
    return DEFAULT_CONFIG_SOURCE_ID;
  }
  return `workspace-${key}`;
}

export function configSourcePreferenceKey(
  workspaceKey?: string | null,
  capability = "resource",
): string {
  const workspace = normalizeConfigSourceId(workspaceKey ?? "") || SYSTEM_WORKSPACE_KEY;
  const scope = normalizeConfigSourceId(capability) || "resource";
  return `${CONFIG_SOURCE_PREFERENCE_PREFIX}.${scope}.${workspace}`;
}

export function configSourceSupports(
  source: ConfigSource | null | undefined,
  capability: string,
): boolean {
  return Boolean(
    source?.capabilities.some((item) => item.trim().toLowerCase() === capability.toLowerCase()),
  );
}

export function configSourceKindLabel(kind?: string | null): string {
  if (kind === "default") return "默认";
  if (kind === "workspace") return "工作区";
  if (kind === "custom") return "自建";
  return kind?.trim() || "配置源";
}

export function findConfigSource(
  sources: ConfigSource[],
  sourceId?: string | null,
): ConfigSource | null {
  const requested = normalizeConfigSourceId(sourceId ?? "").replaceAll("_", "-");
  if (!requested) return null;
  return (
    sources.find(
      (source) => normalizeConfigSourceId(source.id).replaceAll("_", "-") === requested,
    ) ?? null
  );
}

export function resolveConfigSource(
  sources: ConfigSource[],
  requestedSourceId?: string | null,
  requiredCapability?: string,
): ConfigSource | null {
  const supports = (source: ConfigSource) =>
    !requiredCapability || configSourceSupports(source, requiredCapability);
  const requested = findConfigSource(sources, requestedSourceId);
  if (requested && supports(requested)) return requested;
  return sources.find((source) => source.isDefault && supports(source)) ?? sources.find(supports) ?? null;
}
