import type { ProjectRuntimeEntry } from "../app-types";
import { resolveProjectRuntimeDebugProfile } from "../hooks/useProjectsModule";
import type { Translate } from "../i18n";
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

function translateGeneratedValue(value: string, t: Translate): string {
  const missingMatch = value.match(/^缺失 \((.*)\)$/);
  if (missingMatch) {
    return t("缺失 ({key})", { key: missingMatch[1] });
  }
  const stableValues = new Set([
    "默认",
    "自动",
    "开",
    "关",
    "选择已失效",
    "工作区默认",
    "项目基础",
    "项目启动档案",
    "自动识别",
    "全局配置",
    "工作区覆盖",
    "工作区运行环境",
    "继承的共享环境",
    "全局共享环境",
  ]);
  if (stableValues.has(value)) {
    return t(value);
  }
  if (value.includes("/")) {
    return value
      .split("/")
      .map((part) => translateGeneratedValue(part, t))
      .join("/");
  }
  return value;
}

export function translateWorkspaceRuntimeSummary(
  summary: string,
  t: Translate,
): string {
  return summary
    .split(" · ")
    .map((part) => {
      if (part.startsWith("档案 ")) {
        return t("档案 {name}", {
          name: translateGeneratedValue(part.slice("档案 ".length), t),
        });
      }
      if (part.startsWith("端口 ")) {
        return t("端口 {port}", {
          port: translateGeneratedValue(part.slice("端口 ".length), t),
        });
      }
      if (part.startsWith("Runtime ")) {
        return t("Runtime {name}", {
          name: translateGeneratedValue(part.slice("Runtime ".length), t),
        });
      }
      if (part.startsWith("网络代理 ")) {
        return t("网络代理 {state}", {
          state: translateGeneratedValue(part.slice("网络代理 ".length), t),
        });
      }
      if (part.startsWith("本地代理 ")) {
        return t("本地代理 {state}", {
          state: translateGeneratedValue(part.slice("本地代理 ".length), t),
        });
      }
      return t(part);
    })
    .join(" · ");
}

export function translateWorkspaceRuntimeSourceTag(
  value: string,
  t: Translate,
): string {
  const [label, detail] = value.split(" · ", 2);
  if (!detail) {
    return t(value);
  }
  return `${t(label)} · ${translateGeneratedValue(detail, t)}`;
}

export function translateWorkspaceRuntimeSourceTitle(
  value: string,
  t: Translate,
): string {
  const profileMatch = value.match(/^启动档案：(.*)$/);
  if (profileMatch) {
    return t("启动档案：{name}", {
      name: translateGeneratedValue(profileMatch[1], t),
    });
  }
  const targetMatch = value.match(/^命令来自(.*)，端口来自(.*)$/);
  if (targetMatch) {
    return t("命令来自{commandSource}，端口来自{portSource}", {
      commandSource: translateGeneratedValue(targetMatch[1], t),
      portSource: translateGeneratedValue(targetMatch[2], t),
    });
  }
  const runtimeMatch = value.match(/^共享运行环境：(.*)；配置源：(.*)$/);
  if (runtimeMatch) {
    return t("共享运行环境：{runtimeProfile}；配置源：{source}", {
      runtimeProfile: translateGeneratedValue(runtimeMatch[1], t),
      source: runtimeMatch[2],
    });
  }
  return t(value);
}

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
