import { useState } from "react";
import type {
  ProjectRuntimeEntry,
  ProjectRuntimeStartPromptMode,
} from "../app-types";
import { ProjectRuntimeStartDialog } from "../components/ProjectRuntimeStartDialog";

export type ProjectRuntimeStartOptions = {
  debugProfileKey?: string;
  envOverrides?: Record<string, string>;
  expectedPort?: number | null;
  forceConfirm?: boolean;
};

export type ProjectRuntimeStartHandler = (
  projectKey: string,
  debugProfileKey?: string,
  envOverrides?: Record<string, string>,
  expectedPort?: number | null,
) => Promise<unknown> | unknown;

type RuntimeStartDialogRequest = {
  entry: ProjectRuntimeEntry;
  profileKey: string;
  defaultSelectionKnown: boolean;
  envOverrides?: Record<string, string>;
  expectedPort?: number | null;
};

function validProfileKey(entry: ProjectRuntimeEntry, requestedKey: string) {
  const candidate = requestedKey.trim();
  return candidate &&
    entry.debugProfiles.some((profile) => profile.key === candidate)
    ? candidate
    : "";
}

export function shouldConfirmProjectRuntimeStart({
  mode,
  entry,
  requestedProfileKey,
  defaultSelectionKnown,
  forceConfirm = false,
}: {
  mode: ProjectRuntimeStartPromptMode;
  entry: ProjectRuntimeEntry;
  requestedProfileKey: string;
  defaultSelectionKnown: boolean;
  forceConfirm?: boolean;
}) {
  if (forceConfirm || mode === "always") {
    return true;
  }
  if (mode === "never" || entry.debugProfiles.length === 0) {
    return false;
  }
  if (!defaultSelectionKnown) {
    return true;
  }
  return Boolean(
    requestedProfileKey.trim() &&
      !entry.debugProfiles.some(
        (profile) => profile.key === requestedProfileKey.trim(),
      ),
  );
}

export function useProjectRuntimeStartDialog({
  promptMode,
  selectedDebugProfileKeys,
  onStart,
  onSetDefaultProfile,
  onPromptModeChange,
}: {
  promptMode: ProjectRuntimeStartPromptMode;
  selectedDebugProfileKeys: Record<string, string>;
  onStart: ProjectRuntimeStartHandler;
  onSetDefaultProfile: (projectKey: string, profileKey: string) => void;
  onPromptModeChange: (mode: ProjectRuntimeStartPromptMode) => void;
}) {
  const [request, setRequest] = useState<RuntimeStartDialogRequest | null>(null);

  function requestStart(
    entry: ProjectRuntimeEntry,
    options: ProjectRuntimeStartOptions = {},
  ) {
    const explicitProfile = options.debugProfileKey !== undefined;
    const defaultSelectionKnown = Object.prototype.hasOwnProperty.call(
      selectedDebugProfileKeys,
      entry.key,
    );
    const requestedProfileKey = explicitProfile
      ? options.debugProfileKey ?? ""
      : selectedDebugProfileKeys[entry.key] ?? "";
    const profileKey = validProfileKey(entry, requestedProfileKey);
    const needsConfirmation = shouldConfirmProjectRuntimeStart({
      mode: promptMode,
      entry,
      requestedProfileKey,
      defaultSelectionKnown: explicitProfile || defaultSelectionKnown,
      forceConfirm: options.forceConfirm,
    });

    if (!needsConfirmation) {
      return onStart(
        entry.key,
        profileKey || undefined,
        options.envOverrides,
        options.expectedPort,
      );
    }

    setRequest({
      entry,
      profileKey,
      defaultSelectionKnown:
        explicitProfile || (defaultSelectionKnown && profileKey === requestedProfileKey),
      envOverrides: options.envOverrides,
      expectedPort: options.expectedPort,
    });
    return undefined;
  }

  const dialog = (
    <ProjectRuntimeStartDialog
      open={Boolean(request)}
      entry={request?.entry ?? null}
      initialProfileKey={request?.profileKey ?? ""}
      defaultSelectionKnown={request?.defaultSelectionKnown ?? false}
      promptMode={promptMode}
      onClose={() => setRequest(null)}
      onPromptModeChange={onPromptModeChange}
      onConfirm={async (profileKey, saveAsDefault) => {
        if (!request) {
          return false;
        }
        if (saveAsDefault) {
          onSetDefaultProfile(request.entry.key, profileKey);
        }
        return onStart(
          request.entry.key,
          profileKey || undefined,
          request.envOverrides,
          request.expectedPort,
        );
      }}
    />
  );

  return { requestStart, dialog };
}
