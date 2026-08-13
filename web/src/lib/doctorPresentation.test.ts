import { describe, expect, it } from "vitest";

import { translateMessage } from "../i18n";
import {
  compareDoctorChecks,
  doctorCheckAction,
  doctorCheckMessage,
  doctorCheckTitle,
  doctorStatusLabel,
} from "./doctorPresentation";

const zh = (message: string) => translateMessage("zh-CN", message);
const en = (message: string) => translateMessage("en-US", message);

describe("doctor presentation", () => {
  it("labels known checks and statuses", () => {
    expect(doctorCheckTitle("proxy_ports", zh)).toBe("代理监听端口");
    expect(doctorCheckTitle("proxy_ports", en)).toBe("Proxy Listening Ports");
    expect(doctorStatusLabel("warning", zh)).toBe("警告");
  });

  it("keeps backend messages in English and localizes Chinese summaries", () => {
    const check = {
      status: "error" as const,
      code: "storage",
      message: "failed to open storage",
    };

    expect(doctorCheckMessage(check, "zh-CN", zh)).toBe(
      "检查本地数据库路径和访问权限。",
    );
    expect(doctorCheckMessage(check, "en-US", en)).toBe("failed to open storage");
  });

  it("maps attention checks to trusted paths or artifact scopes", () => {
    const paths = {
      configDir: "/mock/config",
      projects: "/mock/config/projects.toml",
      workspace: "/mock/config/workspace.toml",
      workspacesDir: "/mock/config/workspaces",
      navigation: "/mock/config/navigation.toml",
      proxy: "/mock/config/proxy.toml",
      configSources: "/mock/config/config-sources.toml",
      proxyActive: "/mock/config/workspaces/demo/proxy.toml",
      webActions: "/mock/config/web-actions.toml",
      storage: "/mock/data/rdevtool.db",
    };

    expect(
      doctorCheckAction(
        { status: "warning", code: "project_repo_paths", message: "missing" },
        paths,
      ),
    ).toEqual({
      type: "path",
      path: "/mock/config/projects.toml",
      label: "打开项目配置",
    });
    expect(
      doctorCheckAction(
        { status: "warning", code: "runtimeLogOversized", message: "large" },
        paths,
      ),
    ).toEqual({
      type: "artifacts",
      artifactKind: "runtimeLog",
      label: "查看相关产物",
    });
    expect(
      doctorCheckAction(
        { status: "ok", code: "proxy_ports", message: "available" },
        paths,
      ),
    ).toBeNull();
  });

  it("compares attention checks across rechecks", () => {
    const comparison = compareDoctorChecks(
      [
        { status: "warning", code: "project_repo_paths", message: "missing" },
        { status: "error", code: "proxy_ports", message: "occupied" },
      ],
      [
        { status: "ok", code: "project_repo_paths", message: "available" },
        { status: "warning", code: "proxy_ports", message: "still occupied" },
        { status: "warning", code: "proxy_workspaces", message: "unknown" },
      ],
    );

    expect(comparison.resolved.map((check) => check.code)).toEqual([
      "project_repo_paths",
    ]);
    expect(comparison.introduced.map((check) => check.code)).toEqual([
      "proxy_workspaces",
    ]);
    expect(comparison.remaining.map((check) => check.code)).toEqual([
      "proxy_ports",
    ]);
  });
});
