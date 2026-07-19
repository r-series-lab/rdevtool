import type { ConfigSource } from "../app-types";
import type { ActivityDraft, ActivityResource } from "./activityCenter";
import type { ConfigSourcesChangedPayload } from "./configSources";
import { findConfigSource } from "./configSources";
import type { WorkspaceStateChangedPayload } from "./workspaceSync";

export type ConfigChangeAppInfo = {
  workspacePath?: string | null;
  configPath?: string | null;
  workspacesPath?: string | null;
  configDir?: string | null;
};

type WorkspaceConfigScope = "workspace" | "projects" | "projectWorkspaces";

const WORKSPACE_SCOPE_DETAILS: Record<
  WorkspaceConfigScope,
  {
    title: string;
    page: "overview" | "projectManagement";
    pathKey: "workspacePath" | "configPath" | "workspacesPath";
  }
> = {
  workspace: {
    title: "工作区配置已变更",
    page: "overview",
    pathKey: "workspacePath",
  },
  projects: {
    title: "项目配置已变更",
    page: "projectManagement",
    pathKey: "configPath",
  },
  projectWorkspaces: {
    title: "项目工作区配置已变更",
    page: "overview",
    pathKey: "workspacesPath",
  },
};

const WORKSPACE_CONFIG_SCOPES = Object.keys(
  WORKSPACE_SCOPE_DETAILS,
) as WorkspaceConfigScope[];

function nonEmpty(value?: string | null): string | null {
  const next = value?.trim();
  return next || null;
}

function localPathResource(value?: string | null): ActivityResource | undefined {
  const path = nonEmpty(value);
  return path
    ? {
        kind: "localPath",
        label: "打开配置位置",
        value: path,
      }
    : undefined;
}

function configActivityKey(category: string): string {
  return `config-change:${category}`;
}

export function workspaceStateChangedActivities(
  payload: WorkspaceStateChangedPayload,
  appInfo: ConfigChangeAppInfo,
): ActivityDraft[] {
  const changedScopes = new Set(payload.scopes);

  return WORKSPACE_CONFIG_SCOPES.flatMap((scope) => {
    if (!changedScopes.has(scope)) {
      return [];
    }

    const details = WORKSPACE_SCOPE_DETAILS[scope];
    const key = configActivityKey(scope);
    const resource = localPathResource(
      nonEmpty(appInfo[details.pathKey]) ?? appInfo.configDir,
    );
    return [
      {
        id: key,
        kind: "config",
        status: "running",
        title: details.title,
        summary: "检测到外部修改，请重新加载最新配置",
        executionKey: key,
        target: { page: details.page },
        ...(resource ? { resource } : {}),
        action: {
          kind: "reloadConfig",
          label: "重新加载",
          scope,
        },
      },
    ];
  });
}

export function configSourcesChangedActivities(
  payload: ConfigSourcesChangedPayload,
  sources: ConfigSource[],
  appInfo: ConfigChangeAppInfo,
): ActivityDraft[] {
  const activities: ActivityDraft[] = [];

  if (payload.catalogChanged) {
    const key = configActivityKey("sources:catalog");
    const resource = localPathResource(appInfo.configDir);
    activities.push({
      id: key,
      kind: "config",
      status: "running",
      title: "配置源列表已变更",
      summary: "检测到配置源列表发生外部修改",
      executionKey: key,
      target: { page: "resources" },
      ...(resource ? { resource } : {}),
    });
  }

  const seenSourceIds = new Set<string>();
  for (const payloadSourceId of payload.sourceIds) {
    const requestedSourceId = nonEmpty(payloadSourceId);
    if (!requestedSourceId || seenSourceIds.has(requestedSourceId)) {
      continue;
    }
    seenSourceIds.add(requestedSourceId);

    const source = findConfigSource(sources, requestedSourceId);
    const sourceId = source?.id || requestedSourceId;
    const sourceLabel = nonEmpty(source?.name) || sourceId;
    const key = configActivityKey(`source:${sourceId}`);
    const resource = localPathResource(
      nonEmpty(source?.baseDir) ?? appInfo.configDir,
    );
    activities.push({
      id: key,
      kind: "config",
      status: "running",
      title: `配置源“${sourceLabel}”已变更`,
      summary: "检测到配置源文件发生外部修改",
      executionKey: key,
      target: { page: "resources" },
      ...(resource ? { resource } : {}),
      ...(source
        ? {
            action: {
              kind: "compareConfigSource" as const,
              label: "比较配置源",
              sourceId,
            },
          }
        : {}),
    });
  }

  return activities;
}
