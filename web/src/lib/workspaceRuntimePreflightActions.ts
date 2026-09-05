import type {
  ProjectRuntimePreflightFix,
  ProjectRuntimePreflightCheck,
  ProjectSettingsSectionKey,
} from "../app-types";
import { workspaceRuntimePreflightFixPlan } from "./workspaceRuntimePreflightFixes";

export type WorkspaceRuntimePreflightAction =
  | {
      key: "openProjectSettings";
      label: string;
      target: "projectSettings";
      section: ProjectSettingsSectionKey;
    }
  | {
      key: "openRuntimePanel";
      label: string;
      target: "runtimePanel";
    }
  | {
      key: "openProxy";
      label: string;
      target: "proxy";
    }
  | {
      key: "openProjectDirectory";
      label: string;
      target: "projectDirectory";
    }
  | {
      key: "runQuickFix";
      label: string;
      target: "quickFix";
      fix: ProjectRuntimePreflightFix;
    };

const PROJECT_LOCAL_CHECKS = new Set([
  "devCommand",
  "devCwd",
  "focusUrl",
  "readyDetection",
  "afterReadyActions",
]);

const PROJECT_RUNTIME_CHECKS = new Set([
  "debugProfile",
  "devPort",
  "localFiles",
  "readyProbe",
]);

const RUNTIME_PANEL_CHECKS = new Set([
  "browserProxy",
  "debugLocalProxy",
  "debugLocalProxy.daemon",
  "networkProxy",
  "webActionsCdp",
]);

const PROXY_CHECKS = new Set(["rdevProxyProfile", "runtimeProxy"]);

function projectSettingsAction(
  section: ProjectSettingsSectionKey,
  label: string,
): WorkspaceRuntimePreflightAction {
  return {
    key: "openProjectSettings",
    label,
    target: "projectSettings",
    section,
  };
}

export function workspaceRuntimePreflightAction(
  check: ProjectRuntimePreflightCheck,
): WorkspaceRuntimePreflightAction | null {
  const fixPlan = workspaceRuntimePreflightFixPlan(check.fix);
  if (fixPlan) {
    return {
      key: "runQuickFix",
      label: check.fix?.label.trim() || "快速修复",
      target: "quickFix",
      fix: fixPlan.fix,
    };
  }
  if (!check.action?.trim()) {
    return null;
  }

  const key = check.key.trim();
  if (key === "nodeVersion") {
    return {
      key: "openProjectDirectory",
      label: "打开项目目录",
      target: "projectDirectory",
    };
  }
  if (PROXY_CHECKS.has(key)) {
    return {
      key: "openProxy",
      label: "打开本地代理",
      target: "proxy",
    };
  }
  if (PROJECT_LOCAL_CHECKS.has(key)) {
    return projectSettingsAction("projectLocal", "编辑本地命令");
  }
  if (PROJECT_RUNTIME_CHECKS.has(key) || key.startsWith("localFile.")) {
    return projectSettingsAction("projectRuntime", "编辑启动档案");
  }
  if (RUNTIME_PANEL_CHECKS.has(key)) {
    return {
      key: "openRuntimePanel",
      label: "查看运行配置",
      target: "runtimePanel",
    };
  }
  if (check.category === "proxy") {
    return {
      key: "openProxy",
      label: "打开本地代理",
      target: "proxy",
    };
  }
  if (
    check.category === "runtime" ||
    check.category === "network" ||
    check.category === "webActions" ||
    check.category === "context"
  ) {
    return {
      key: "openRuntimePanel",
      label: "查看运行配置",
      target: "runtimePanel",
    };
  }
  return null;
}
