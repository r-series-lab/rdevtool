import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIRMATION_PREFERENCES,
  confirmationEnabled,
  confirmationPreferenceKeyForTrayAction,
  confirmationPreferencesWithMode,
  confirmationPreferencesWithOverride,
  normalizeConfirmationPreferences,
} from "./confirmationPreferences";

describe("confirmation preferences", () => {
  it("keeps critical actions enabled in every mode", () => {
    for (const mode of ["strict", "balanced", "fast"] as const) {
      expect(confirmationEnabled(confirmationPreferencesWithMode(mode), "branch.mutate")).toBe(
        true,
      );
      expect(confirmationEnabled(confirmationPreferencesWithMode(mode), "destructive.delete")).toBe(
        true,
      );
    }
  });

  it("applies balanced, strict and fast presets to configurable actions", () => {
    expect(confirmationEnabled(confirmationPreferencesWithMode("balanced"), "build.run")).toBe(
      true,
    );
    expect(
      confirmationEnabled(confirmationPreferencesWithMode("balanced"), "network.change"),
    ).toBe(false);
    expect(confirmationEnabled(confirmationPreferencesWithMode("strict"), "network.change")).toBe(
      true,
    );
    expect(confirmationEnabled(confirmationPreferencesWithMode("fast"), "build.run")).toBe(false);
  });

  it("switches to a complete custom policy when one category changes", () => {
    const next = confirmationPreferencesWithOverride(
      DEFAULT_CONFIRMATION_PREFERENCES,
      "build.run",
      false,
    );
    expect(next.mode).toBe("custom");
    expect(confirmationEnabled(next, "build.run")).toBe(false);
    expect(confirmationEnabled(next, "runtime.change")).toBe(true);
  });

  it("normalizes persisted values and maps tray action kinds", () => {
    expect(
      normalizeConfirmationPreferences({
        version: 99,
        mode: "custom",
        overrides: { "build.run": false, unknown: true },
      }),
    ).toEqual({ version: 1, mode: "custom", overrides: { "build.run": false } });
    expect(confirmationPreferenceKeyForTrayAction("branch.replay")).toBe("branch.mutate");
    expect(confirmationPreferenceKeyForTrayAction("proxy.start")).toBe("network.change");
    expect(confirmationPreferenceKeyForTrayAction("project.runtime.focus")).toBeNull();
  });
});
