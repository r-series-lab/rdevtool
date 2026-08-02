import type { ProjectDebugProfileSummary } from "../app-types";
import { uniqueProjectLaunchProfileKey } from "./projectRuntimeProfiles";
import type { WorkspaceRuntimePreflightFixPlan } from "./workspaceRuntimePreflightFixes";

export type RuntimeLaunchProfileSaveRequest = {
  projectKey: string;
  mode: "create";
  profileKey: string;
  label: string;
  baseProfileKey: string | null;
  envOverrides: Record<string, string>;
  expectedPort: number;
};

export function generatedRuntimeProfileSaveRequest({
  projectKey,
  plan,
  profileLabel,
  debugProfiles,
}: {
  projectKey: string;
  plan: Extract<WorkspaceRuntimePreflightFixPlan, { kind: "createProfile" }>;
  profileLabel: string;
  debugProfiles: Pick<ProjectDebugProfileSummary, "key">[];
}): RuntimeLaunchProfileSaveRequest {
  const preferredKey = plan.profileKey.trim();
  const profileKey = debugProfiles.some(
    (profile) => profile.key.trim() === preferredKey,
  )
    ? uniqueProjectLaunchProfileKey(debugProfiles, preferredKey, "generated")
    : preferredKey;
  return {
    projectKey,
    mode: "create",
    profileKey,
    label: profileLabel.trim() || plan.profileLabel,
    baseProfileKey: null,
    envOverrides: {},
    expectedPort: plan.expectedPort,
  };
}

export function portOverrideProfileSaveRequest({
  projectKey,
  projectName,
  debugProfileKey,
  debugProfiles,
  expectedPort,
  profileLabel,
}: {
  projectKey: string;
  projectName: string;
  debugProfileKey: string;
  debugProfiles: Pick<ProjectDebugProfileSummary, "key">[];
  expectedPort: number;
  profileLabel: string;
}): RuntimeLaunchProfileSaveRequest {
  return {
    projectKey,
    mode: "create",
    profileKey: uniqueProjectLaunchProfileKey(
      debugProfiles,
      debugProfileKey || projectKey,
      `port-${expectedPort}`,
    ),
    label: profileLabel.trim() || `${projectName} · 端口 ${expectedPort}`,
    baseProfileKey: debugProfileKey || null,
    envOverrides: {},
    expectedPort,
  };
}
