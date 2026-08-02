import { describe, expect, it } from "vitest";
import type { ProjectRuntimeEntry } from "../app-types";
import { shouldConfirmProjectRuntimeStart } from "./useProjectRuntimeStartDialog";

const entry = {
  key: "demo",
  debugProfiles: [
    {
      key: "uat",
    },
    {
      key: "dc2",
    },
  ],
} as ProjectRuntimeEntry;

describe("project runtime start confirmation decision", () => {
  it("always honors explicit confirmation and direct modes", () => {
    expect(
      shouldConfirmProjectRuntimeStart({
        mode: "always",
        entry,
        requestedProfileKey: "uat",
        defaultSelectionKnown: true,
      }),
    ).toBe(true);
    expect(
      shouldConfirmProjectRuntimeStart({
        mode: "never",
        entry,
        requestedProfileKey: "",
        defaultSelectionKnown: false,
      }),
    ).toBe(false);
  });

  it("prompts in auto mode until the workspace has chosen a profile", () => {
    expect(
      shouldConfirmProjectRuntimeStart({
        mode: "auto",
        entry,
        requestedProfileKey: "",
        defaultSelectionKnown: false,
      }),
    ).toBe(true);
    expect(
      shouldConfirmProjectRuntimeStart({
        mode: "auto",
        entry,
        requestedProfileKey: "",
        defaultSelectionKnown: true,
      }),
    ).toBe(false);
  });

  it("prompts when the stored profile disappeared or selection is requested", () => {
    expect(
      shouldConfirmProjectRuntimeStart({
        mode: "auto",
        entry,
        requestedProfileKey: "removed",
        defaultSelectionKnown: true,
      }),
    ).toBe(true);
    expect(
      shouldConfirmProjectRuntimeStart({
        mode: "never",
        entry,
        requestedProfileKey: "uat",
        defaultSelectionKnown: true,
        forceConfirm: true,
      }),
    ).toBe(true);
  });
});
