import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { KnowledgePage } from "./KnowledgePage";

describe("KnowledgePage", () => {
  it("renders a lightweight Markdown knowledge workbench", () => {
    const html = renderToStaticMarkup(
      <KnowledgePage
        projects={[{ key: "demo-console", name: "示例控制台" }]}
        selectedProject="demo-console"
      />,
    );

    expect(html).toContain('data-knowledge-library="markdown"');
    expect(html).toContain("知识库");
    expect(html).toContain("知识范围");
    expect(html).toContain("项目");
    expect(html).toContain("搜索标题、正文或路径");
    expect(html).toContain("新建");
    expect(html).not.toContain("富文本");
    expect(html).not.toContain("删除");
  });

  it("renders the workbench shell in English when the language is English", () => {
    const html = renderToStaticMarkup(
      <I18nProvider systemLanguageOverride="en-US">
        <KnowledgePage
          projects={[{ key: "demo-console", name: "Demo Console" }]}
          selectedProject="demo-console"
        />
      </I18nProvider>,
    );

    expect(html).toContain("Documents");
    expect(html).toContain("Projects");
    expect(html).toContain("Knowledge Base");
    expect(html).toContain("Knowledge Scope");
    expect(html).toContain("Search titles, content, or paths");
    expect(html).toContain("New");
  });
});
