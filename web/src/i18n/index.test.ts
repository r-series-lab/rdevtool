import { describe, expect, it } from "vitest";
import {
  hasTranslationMessage,
  normalizeLanguagePreference,
  resolveLanguage,
  systemLanguage,
  translateMessage,
} from "./index";

describe("i18n", () => {
  it("normalizes persisted preferences conservatively", () => {
    expect(normalizeLanguagePreference("en-US")).toBe("en-US");
    expect(normalizeLanguagePreference("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguagePreference("system")).toBe("system");
    expect(normalizeLanguagePreference("unknown")).toBe("system");
  });

  it("resolves system language to Chinese or English", () => {
    expect(systemLanguage("")).toBe("zh-CN");
    expect(resolveLanguage("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLanguage("system", "zh-TW")).toBe("zh-CN");
    expect(resolveLanguage("system", "en-GB")).toBe("en-US");
    expect(resolveLanguage("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("translates and interpolates known messages while preserving unknown text", () => {
    expect(translateMessage("en-US", "切换到 {page}", { page: "Projects" })).toBe(
      "Switch to Projects",
    );
    expect(translateMessage("zh-CN", "切换到 {page}", { page: "项目" })).toBe(
      "切换到 项目",
    );
    expect(translateMessage("en-US", "User-defined project")).toBe(
      "User-defined project",
    );
  });

  it("translates menu labels for the language setting", () => {
    expect(translateMessage("en-US", "知识库")).toBe("Knowledge Base");
    expect(translateMessage("en-US", "知识")).toBe("Knowledge");
    expect(translateMessage("en-US", "项目管理")).toBe("Projects");
    expect(translateMessage("en-US", "资源入口")).toBe("Resources");
    expect(
      translateMessage("en-US", "{name} · 知识库", { name: "rDevTool" }),
    ).toBe("rDevTool · Knowledge Base");
  });

  it("preserves missing interpolation parameters without corrupting copy", () => {
    expect(translateMessage("en-US", "切换到 {page}")).toBe(
      "Switch to {page}",
    );
    expect(
      translateMessage("en-US", "共 {count} 条。忽略后不再提醒，记录仍可在“全部”中查看。", {
        count: 3,
      }),
    ).toContain("3 items");
  });

  it("reports whether a message has an explicit translation", () => {
    expect(hasTranslationMessage("zh-CN", "任意中文")).toBe(true);
    expect(hasTranslationMessage("en-US", "切换到 {page}")).toBe(true);
    expect(hasTranslationMessage("en-US", "尚未加入词典")).toBe(false);
  });
});
