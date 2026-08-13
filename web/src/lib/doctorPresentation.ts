import type {
  DoctorCheck,
  DoctorPaths,
  DoctorStatus,
  HealthIdentity,
} from "../app-types";
import type { AppLanguage, Translate } from "../i18n";

const CHECK_TITLES: Record<string, string> = {
  projects_config: "项目配置",
  project_keys: "项目标识",
  project_repo_paths: "项目仓库路径",
  workspace_preferences: "工作区偏好",
  workspace_catalog: "工作区目录",
  workspace_projects: "工作区项目范围",
  active_workspace: "当前工作区",
  navigation: "资源入口",
  config_sources: "配置源",
  proxy_source: "代理配置源",
  proxy_daemon_versions: "代理运行版本",
  proxy_config: "代理配置",
  proxy_workspaces: "代理工作区引用",
  proxy_ports: "代理监听端口",
  storage: "本地数据库",
  web_actions: "网页动作",
  self_identity: "当前执行文件",
  runtimeLogOversized: "运行日志",
  binarySourceMismatch: "执行文件与源码",
};

const CHECK_GUIDANCE: Record<string, string> = {
  projects_config: "检查项目配置是否可读取且格式有效。",
  project_keys: "为重复项目标识改用唯一值。",
  project_repo_paths: "检查项目配置中的仓库路径是否存在。",
  workspace_preferences: "检查当前工作区偏好配置。",
  workspace_catalog: "检查工作区目录中的配置文件。",
  workspace_projects: "移除工作区中不存在的项目引用。",
  active_workspace: "确认当前工作区仍存在且可读取。",
  navigation: "检查资源入口配置是否可读取。",
  config_sources: "检查配置源登记及文件路径。",
  proxy_source: "检查当前工作区的代理配置源。",
  proxy_daemon_versions: "重启旧版本代理进程后重新检查。",
  proxy_config: "检查代理配置格式与规则引用。",
  proxy_workspaces: "更新代理配置中的工作区引用。",
  proxy_ports: "确认代理监听端口未被其他进程占用。",
  storage: "检查本地数据库路径和访问权限。",
  web_actions: "检查网页动作配置是否可读取。",
  self_identity: "确认当前执行文件来源与构建信息。",
  runtimeLogOversized: "先确认日志不再活跃，再评估清理。",
  binarySourceMismatch: "重新构建或安装与当前源码一致的执行文件。",
};

export type DoctorCheckAction =
  | {
      type: "path";
      path: string;
      label: string;
    }
  | {
      type: "artifacts";
      artifactKind: string;
      label: string;
    };

export type DoctorCheckComparison = {
  resolved: DoctorCheck[];
  introduced: DoctorCheck[];
  remaining: DoctorCheck[];
};

export function compareDoctorChecks(
  previous: DoctorCheck[],
  current: DoctorCheck[],
): DoctorCheckComparison {
  const previousAttention = new Map(
    previous
      .filter((check) => check.status !== "ok")
      .map((check) => [check.code, check]),
  );
  const currentAttention = new Map(
    current
      .filter((check) => check.status !== "ok")
      .map((check) => [check.code, check]),
  );

  return {
    resolved: [...previousAttention.values()].filter(
      (check) => !currentAttention.has(check.code),
    ),
    introduced: [...currentAttention.values()].filter(
      (check) => !previousAttention.has(check.code),
    ),
    remaining: [...currentAttention.values()].filter((check) =>
      previousAttention.has(check.code),
    ),
  };
}

export function doctorCheckTitle(code: string, t: Translate): string {
  if (code.startsWith("runtime.")) {
    return t("项目运行环境");
  }
  return t(CHECK_TITLES[code] ?? code);
}

export function doctorStatusLabel(status: DoctorStatus, t: Translate): string {
  switch (status) {
    case "error":
      return t("错误");
    case "warning":
      return t("警告");
    default:
      return t("通过");
  }
}

export function doctorCheckMessage(
  check: DoctorCheck,
  language: AppLanguage,
  t: Translate,
): string {
  if (language === "en-US") {
    return check.message;
  }
  if (check.status !== "ok") {
    if (check.code.startsWith("runtime.")) {
      return t("根据详情补齐项目运行环境配置。");
    }
    const guidance = CHECK_GUIDANCE[check.code];
    if (guidance) {
      return t(guidance);
    }
  }
  switch (check.status) {
    case "error":
      return t("检查失败");
    case "warning":
      return t("需要处理");
    default:
      return t("检查通过");
  }
}

export function doctorCheckAction(
  check: DoctorCheck,
  paths: DoctorPaths,
  identity?: HealthIdentity | null,
): DoctorCheckAction | null {
  if (check.status === "ok") {
    return null;
  }

  if (check.code === "runtimeLogOversized") {
    return {
      type: "artifacts",
      artifactKind: "runtimeLog",
      label: "查看相关产物",
    };
  }

  if (check.code === "binarySourceMismatch") {
    const path = identity?.sourceRoot || identity?.executablePath;
    return path
      ? {
          type: "path",
          path,
          label: identity?.sourceRoot ? "打开源码目录" : "打开执行文件",
        }
      : null;
  }

  switch (check.code) {
    case "projects_config":
    case "project_keys":
    case "project_repo_paths":
      return { type: "path", path: paths.projects, label: "打开项目配置" };
    case "workspace_preferences":
      return { type: "path", path: paths.workspace, label: "打开工作区偏好" };
    case "workspace_catalog":
    case "workspace_projects":
    case "active_workspace":
      return { type: "path", path: paths.workspacesDir, label: "打开工作区目录" };
    case "navigation":
      return { type: "path", path: paths.navigation, label: "打开资源配置" };
    case "config_sources":
      return { type: "path", path: paths.configSources, label: "打开配置源" };
    case "proxy_source":
    case "proxy_config":
    case "proxy_workspaces":
    case "proxy_ports":
      return {
        type: "path",
        path: paths.proxyActive || paths.proxy,
        label: "打开代理配置",
      };
    case "web_actions":
      return { type: "path", path: paths.webActions, label: "打开网页动作配置" };
    default:
      return null;
  }
}
