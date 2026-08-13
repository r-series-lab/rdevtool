import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DoctorChecksView,
  SystemDiagnosticsPanel,
} from "./SystemDiagnosticsPanel";

describe("SystemDiagnosticsPanel", () => {
  it("keeps health inspection read-only inside settings", () => {
    const html = renderToStaticMarkup(<SystemDiagnosticsPanel />);

    expect(html).toContain('data-system-diagnostics="read-only"');
    expect(html).toContain("系统诊断");
    expect(html).toContain("复制诊断报告");
    expect(html).toContain("刷新系统诊断");
    expect(html).not.toContain("执行清理");
    expect(html).not.toContain("删除日志");
  });

  it("shows only checks that need attention by default", () => {
    const html = renderToStaticMarkup(
      <DoctorChecksView
        paths={{
          configDir: "/mock/config",
          projects: "/mock/config/projects.toml",
          workspace: "/mock/config/workspace.toml",
          workspacesDir: "/mock/config/workspaces",
          navigation: "/mock/config/navigation.toml",
          proxy: "/mock/config/proxy.toml",
          configSources: "/mock/config/config-sources.toml",
          webActions: "/mock/config/web-actions.toml",
          storage: "/mock/data/rdevtool.db",
        }}
        onOpenPath={() => undefined}
        workspace={{
          key: "demo",
          name: "演示工作区",
          system: false,
          projectCount: 1,
          includeAllProjects: false,
          includeAllNavigation: false,
        }}
        checks={[
          {
            status: "warning",
            code: "project_repo_paths",
            message: "missing path",
            detail: "/mock/missing",
          },
          {
            status: "ok",
            code: "storage",
            message: "storage is available",
          },
        ]}
      />,
    );
    const textHtml = html.replaceAll("<!-- -->", "");

    expect(html).toContain('data-doctor-checks="attention"');
    expect(html).toContain("项目仓库路径");
    expect(html).toContain("/mock/missing");
    expect(html).toContain("检查项目配置中的仓库路径是否存在。");
    expect(html).toContain("打开项目配置");
    expect(html).not.toContain("本地数据库");
    expect(textHtml).toContain("<strong>1</strong>警告");
    expect(textHtml).toContain("<strong>1</strong>通过");
  });

  it("summarizes changes after a recheck", () => {
    const html = renderToStaticMarkup(
      <DoctorChecksView
        checks={[
          {
            status: "warning",
            code: "proxy_ports",
            message: "occupied",
          },
        ]}
        comparison={{
          resolved: [
            {
              status: "warning",
              code: "project_repo_paths",
              message: "missing",
            },
          ],
          introduced: [
            {
              status: "warning",
              code: "proxy_ports",
              message: "occupied",
            },
          ],
          remaining: [],
        }}
        onRecheck={() => undefined}
      />,
    );

    expect(html).toContain('data-doctor-comparison="complete"');
    expect(html).toContain("重新检查完成");
    expect(html).toContain("已解决：项目仓库路径");
    expect(html).toContain("代理监听端口");
    expect(html).toContain("新增");
  });

});
