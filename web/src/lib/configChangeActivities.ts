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

const WORKSPACE_SCOPE_LABELS: Record<WorkspaceConfigScope, string> = {
  workspace: "工作区",
  projects: "项目",
  projectWorkspaces: "项目工作区",
};

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
  const scopes = WORKSPACE_CONFIG_SCOPES.filter((scope) => changedScopes.has(scope));
  if (scopes.length === 0) {
    return [];
  }

  const primaryScope = scopes[0];
  const primaryDetails = WORKSPACE_SCOPE_DETAILS[primaryScope];
  const combined = scopes.length > 1;
  const key = configActivityKey(combined ? "workspace-state" : primaryScope);
  const resource = localPathResource(
    combined
      ? nonEmpty(appInfo.configDir) ?? appInfo[primaryDetails.pathKey]
      : nonEmpty(appInfo[primaryDetails.pathKey]) ?? appInfo.configDir,
  );

  return [
    {
      id: key,
      kind: "config",
      status: "running",
      title: combined ? "工作区相关配置已变更" : primaryDetails.title,
      summary: "检测到外部修改，请重新加载最新配置",
      ...(combined
        ? { detail: `影响：${scopes.map((scope) => WORKSPACE_SCOPE_LABELS[scope]).join("、")}` }
        : {}),
      executionKey: key,
      target: { page: primaryDetails.page },
      ...(resource ? { resource } : {}),
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: primaryScope,
      },
    },
  ];
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
