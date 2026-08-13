import { describe, expect, it } from "vitest";

import {
  ALL_PAGE_KEYS,
  DEFAULT_VISIBLE_PAGE_KEYS,
  NAV_ITEMS,
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

  it("keeps knowledge as the final menu item", () => {
    expect(DEFAULT_VISIBLE_PAGE_KEYS[DEFAULT_VISIBLE_PAGE_KEYS.length - 1]).toBe(
      "knowledge",
    );
    expect(ALL_PAGE_KEYS[ALL_PAGE_KEYS.length - 1]).toBe("knowledge");
    expect(NAV_ITEMS[NAV_ITEMS.length - 1]?.key).toBe("knowledge");
  });
});
