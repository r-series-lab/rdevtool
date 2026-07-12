import type { SettingsSection } from "./SettingsPanel";

export const OPEN_SETTINGS_EVENT = "rdevtool:open-settings";

export function requestOpenSettings(section?: SettingsSection) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<{ section?: SettingsSection }>(OPEN_SETTINGS_EVENT, {
      detail: { section },
    }),
  );
}
