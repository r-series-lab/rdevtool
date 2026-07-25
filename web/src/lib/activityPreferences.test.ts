import { describe, expect, it } from "vitest";
import {
  activityVisibleWithPreferences,
  DEFAULT_ACTIVITY_PREFERENCES,
  normalizeActivityPreferences,
} from "./activityPreferences";

describe("activity preferences", () => {
  it("defaults to showing only actionable config activities", () => {
    expect(normalizeActivityPreferences(null)).toEqual(DEFAULT_ACTIVITY_PREFERENCES);
    expect(normalizeActivityPreferences({ configActivityVisibility: "invalid" })).toEqual(
      DEFAULT_ACTIVITY_PREFERENCES,
    );
  });

  it("hides handled config records but keeps pending and failed records", () => {
    const visible = (
      status: "running" | "success" | "failed",
      acknowledgedAt: string | null = null,
    ) =>
      activityVisibleWithPreferences(
        { kind: "config", status, acknowledgedAt },
        DEFAULT_ACTIVITY_PREFERENCES,
      );

    expect(visible("running")).toBe(true);
    expect(visible("failed")).toBe(true);
    expect(visible("success")).toBe(false);
    expect(visible("failed", "2026-07-21T02:00:00.000Z")).toBe(false);
  });

  it("keeps non-config activities and restores all config history in all mode", () => {
    expect(
      activityVisibleWithPreferences(
        { kind: "build", status: "success", acknowledgedAt: null },
        DEFAULT_ACTIVITY_PREFERENCES,
      ),
    ).toBe(true);
    expect(
      activityVisibleWithPreferences(
        { kind: "config", status: "success", acknowledgedAt: "2026-07-21T02:00:00.000Z" },
        { version: 1, configActivityVisibility: "all" },
      ),
    ).toBe(true);
  });
});
