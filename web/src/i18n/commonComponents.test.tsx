import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppEmptyState } from "../components/AppEmptyState";
import { AppListEndState } from "../components/AppListEndState";
import { I18nProvider, translateNode } from "./index";

describe("i18n component boundaries", () => {
  it("keeps common components usable without an i18n provider", () => {
    const html = renderToString(
      <AppEmptyState title="暂无待处理" description="换个筛选条件看看其他活动。" />,
    );

    expect(html).toContain("暂无待处理");
    expect(html).toContain("换个筛选条件看看其他活动。");
  });

  it("uses the Chinese fallback for server rendering with system preference", () => {
    const html = renderToString(
      <I18nProvider>
        <AppEmptyState title="设置" description="应用偏好与行为" />
      </I18nProvider>,
    );

    expect(html).toContain("设置");
    expect(html).toContain("应用偏好与行为");
  });

  it("translates the shared list end state", () => {
    const html = renderToString(
      <I18nProvider systemLanguageOverride="en-US">
        <AppListEndState />
      </I18nProvider>,
    );

    expect(html).toContain("No more items");
    expect(html).toContain('aria-label="No more items"');
    expect(html).not.toContain("没有更多了");
  });

  it("does not alter non-string React nodes", () => {
    const node = <strong>Custom content</strong>;
    expect(translateNode(node, (message) => `translated:${message}`)).toBe(node);
  });
});
