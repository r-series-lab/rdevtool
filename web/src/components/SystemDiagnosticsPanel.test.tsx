import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SystemDiagnosticsPanel } from "./SystemDiagnosticsPanel";

describe("SystemDiagnosticsPanel", () => {
  it("keeps health inspection read-only inside settings", () => {
    const html = renderToStaticMarkup(<SystemDiagnosticsPanel />);

    expect(html).toContain('data-system-diagnostics="read-only"');
    expect(html).toContain("系统诊断");
    expect(html).not.toContain("执行清理");
    expect(html).not.toContain("删除日志");
  });
});
