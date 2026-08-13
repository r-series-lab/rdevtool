import type { ManagedArtifactFocusRequest } from "../app-types";
import type { SettingsSection } from "./SettingsPanel";

export const OPEN_SETTINGS_EVENT = "rdevtool:open-settings";

export type OpenSettingsEventDetail = {
  section?: SettingsSection;
  artifactFocus?: ManagedArtifactFocusRequest;
};

let artifactFocusRequestId = 0;

export function requestOpenSettings(
  section?: SettingsSection,
  artifactFocus?: ManagedArtifactFocusRequest,
) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OpenSettingsEventDetail>(OPEN_SETTINGS_EVENT, {
      detail: { section, artifactFocus },
    }),
  );
}

export function requestOpenManagedArtifacts(
  focus: Omit<ManagedArtifactFocusRequest, "requestId">,
) {
  artifactFocusRequestId += 1;
  requestOpenSettings("artifacts", {
    ...focus,
    requestId: artifactFocusRequestId,
  });
}
