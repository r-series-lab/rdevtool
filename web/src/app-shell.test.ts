import { describe, expect, it } from "vitest";

import {
  DEFAULT_VISIBLE_PAGE_KEYS,
  normalizeEnabledPages,
  normalizePageKey,
} from "./app-shell";

describe("app shell knowledge route", () => {
  it("migrates the former health route to knowledge", () => {
    expect(normalizePageKey("health")).toBe("knowledge");
    expect(normalizeEnabledPages(["overview", "health"])).toEqual([
      "overview",
      "knowledge",
    ]);
  });

  it("includes knowledge in the default primary menu", () => {
    expect(DEFAULT_VISIBLE_PAGE_KEYS).toContain("knowledge");
    expect(DEFAULT_VISIBLE_PAGE_KEYS).not.toContain("health");
  });
});
