import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINK_UI_PROFILE,
  LINK_UI_PROFILES,
  UI_PROFILE_MANIFEST,
  linkUiProfileDefinition,
  normalizeLinkUiProfile,
  uiProfileHasFeature,
} from "./uiProfiles";

describe("UI profile registry", () => {
  it("contains unique and complete built-in profiles", () => {
    const ids = UI_PROFILE_MANIFEST.profiles.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(UI_PROFILE_MANIFEST.schemaVersion).toBe(1);
    expect(ids).toEqual(
      expect.arrayContaining([
        "resource-basic",
        "link-local-debug",
        "link-proxy-only",
        "link-web-action",
      ]),
    );
  });

  it("falls back to the local debug profile", () => {
    expect(normalizeLinkUiProfile("resource-basic")).toBe(DEFAULT_LINK_UI_PROFILE);
    expect(normalizeLinkUiProfile("unknown-profile")).toBe(DEFAULT_LINK_UI_PROFILE);
  });

  it("exposes features used by the dynamic link form", () => {
    const local = linkUiProfileDefinition("link-local-debug");
    expect(uiProfileHasFeature(local, "project")).toBe(true);
    expect(uiProfileHasFeature(local, "runtime")).toBe(true);
    expect(uiProfileHasFeature(linkUiProfileDefinition("link-proxy-only"), "proxyAction")).toBe(
      true,
    );
    expect(uiProfileHasFeature(linkUiProfileDefinition("link-web-action"), "webAction")).toBe(
      true,
    );
    expect(LINK_UI_PROFILES.every((profile) => profile.label && profile.description)).toBe(true);
  });
});
