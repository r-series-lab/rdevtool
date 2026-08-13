import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BranchRevisionSummary } from "./BranchRevisionSummary";

describe("BranchRevisionSummary", () => {
  it("keeps branch commit context visible without a hover title", () => {
    const html = renderToStaticMarkup(
      <BranchRevisionSummary
        label="源分支"
        branch="feature/demo"
        context="当前项目参考：Demo"
        commit={{
          shortHash: "2e76c2f",
          subject: "fix: 统一备注溢出显示行为",
          committedAt: "2026-08-10 11:42:06 +0800",
        }}
      />,
    );

    expect(html).toContain("feature/demo");
    expect(html).toContain('data-branch-revision-row="branch"');
    expect(html).toContain('data-branch-revision-row="revision"');
    expect(html).toContain("当前项目参考：Demo · 源分支 · feature/demo");
    expect(html).toContain("fix: 统一备注溢出显示行为");
    expect(html).toContain("提交于 2026-08-10 11:42:06 +0800");
    expect(html).toContain(
      "fix: 统一备注溢出显示行为 · 提交于 2026-08-10 11:42:06 +0800",
    );
    expect(html).not.toContain("2e76c2f");
    expect(html).not.toContain('title="fix: 统一备注溢出显示行为"');
  });

  it("falls back to the catalog activity time when commit details are absent", () => {
    const html = renderToStaticMarkup(
      <BranchRevisionSummary
        label="目标分支"
        branch="release/pre"
        updatedAt="2026-08-09 16:30"
      />,
    );

    expect(html).toContain("最近活动于 2026-08-09 16:30");
  });
});
