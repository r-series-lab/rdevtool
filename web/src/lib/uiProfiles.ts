import manifestJson from "../../../ui_profiles.json";

export type UiProfileScope = "resource" | "link";
export type UiProfileFeature =
  | "url"
  | "directory"
  | "app"
  | "script"
  | "tool"
  | "project"
  | "localFile"
  | "proxy"
  | "runtime"
  | "proxyAction"
  | "webAction";

export type LinkUiProfileKey =
  | "link-local-debug"
  | "link-proxy-only"
  | "link-web-action";

export type UiProfileDefinition = {
  id: string;
  scope: UiProfileScope;
  kind: string;
  label: string;
  description: string;
  features: UiProfileFeature[];
};

export type UiProfileManifest = {
  schemaVersion: number;
  profiles: UiProfileDefinition[];
};

export const DEFAULT_RESOURCE_UI_PROFILE = "resource-basic";
export const DEFAULT_LINK_UI_PROFILE: LinkUiProfileKey = "link-local-debug";

export const UI_PROFILE_MANIFEST = manifestJson as UiProfileManifest;
export const UI_PROFILES = UI_PROFILE_MANIFEST.profiles;
export const LINK_UI_PROFILES = UI_PROFILES.filter(
  (profile): profile is UiProfileDefinition & { id: LinkUiProfileKey; scope: "link" } =>
    profile.scope === "link",
);

export function uiProfileDefinition(value?: string | null) {
  const id = value?.trim();
  return id ? UI_PROFILES.find((profile) => profile.id === id) ?? null : null;
}

export function linkUiProfileDefinition(value?: string | null) {
  const id = normalizeLinkUiProfile(value);
  return LINK_UI_PROFILES.find((profile) => profile.id === id) ?? LINK_UI_PROFILES[0];
}

export function normalizeLinkUiProfile(value?: string | null): LinkUiProfileKey {
  return LINK_UI_PROFILES.some((profile) => profile.id === value)
    ? (value as LinkUiProfileKey)
    : DEFAULT_LINK_UI_PROFILE;
}

export function uiProfileHasFeature(
  profile: Pick<UiProfileDefinition, "features"> | null | undefined,
  feature: UiProfileFeature,
) {
  return profile?.features.includes(feature) ?? false;
}
