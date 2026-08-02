import type { ProjectRuntimeEntry } from "../app-types";
import { resolveProjectRuntimeDebugProfile } from "../hooks/useProjectsModule";
import { runtimeWorkspaceScopeLabel } from "./runtimeContext";

export type WorkspaceRuntimeSourceContext = {
  runtimeConfigSourceName: string;
  runtimeProfileScope: string;
};

export type WorkspaceProjectRuntimeProfileInfo = {
  debugProfileKey: string;
  profileMissing: boolean;
  summary: string;
  sourceTags: Array<{
    key: string;
    label: string;
    title: string;
  }>;
};

export function workspaceProjectRuntimeProfileInfo(
  entry: ProjectRuntimeEntry | undefined,
  requestedKey: string | undefined,
  workspace: WorkspaceRuntimeSourceContext,
  active: boolean,
): WorkspaceProjectRuntimeProfileInfo {
  if (!active) {
    return {
      debugProfileKey: "",
      profileMissing: false,
      summary: "切换到该工作区后读取默认启动档案",
      sourceTags: [],
    };
  }

  const selection = resolveProjectRuntimeDebugProfile(entry, requestedKey);
  const profile = selection.profile;
  const normalizedRequestedKey = requestedKey?.trim() || "";
  const profileMissing = Boolean(normalizedRequestedKey && !profile);
  const profileLabel = profileMissing
    ? `缺失 (${normalizedRequestedKey})`
    : profile?.label?.trim() || "默认";
  const commandSource = profile?.command?.trim() ? "项目启动档案" : "项目基础";
  const portSource = profile?.expectedPort ? "项目启动档案" : "自动识别";
  const runtimeScope = runtimeWorkspaceScopeLabel(workspace);
  const runtimeLabel = profile?.runtimeProfile?.trim() || "默认";

  return {
    debugProfileKey: profileMissing ? normalizedRequestedKey : selection.key,
    profileMissing,
    summary: [
      `档案 ${profileLabel}`,
      `端口 ${profile?.expectedPort ?? "自动"}`,
      `Runtime ${runtimeLabel}`,
      `网络代理 ${profile?.networkProxy?.enabled ? "开" : "关"}`,
      `本地代理 ${profile?.localProxy?.enabled ? "开" : "关"}`,
    ].join(" · "),
    sourceTags: [
      {
        key: "profile",
        label: `档案 · ${
          profileMissing
            ? "选择已失效"
            : requestedKey
              ? "工作区默认"
              : "项目基础"
        }`,
        title: `启动档案：${profileLabel}`,
      },
      {
        key: "target",
        label: `命令/端口 · ${commandSource === portSource ? commandSource : `${commandSource}/${portSource}`}`,
        title: `命令来自${commandSource}，端口来自${portSource}`,
      },
      {
        key: "runtime",
        label: `环境 · ${runtimeScope}`,
        title: `共享运行环境：${runtimeLabel}；配置源：${workspace.runtimeConfigSourceName}`,
      },
    ],
  };
}
