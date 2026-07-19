import type {
  LinkConfig,
  LinkStepConfig,
  ProjectConfigDraft,
  ProjectWorkspaceSummary,
  WebActionSummary,
} from "../app-types";
import {
  DEFAULT_LINK_UI_PROFILE,
  LINK_UI_PROFILES,
  UI_PROFILE_MANIFEST,
  type LinkUiProfileKey,
  linkUiProfileDefinition,
  normalizeLinkUiProfile,
  uiProfileHasFeature,
} from "./uiProfiles";

export type ProxyActionType = "proxy.start" | "proxy.check";
export type WebActionMode = "open" | "run" | "check";

export type LinkWizardDraft = {
  key: string;
  name: string;
  uiProfile: LinkUiProfileKey;
  workspaceKey: string;
  project: string;
  proxyProfile: string;
  proxyAction: ProxyActionType;
  includeLocalFile: boolean;
  localFilePath: string;
  includeProxy: boolean;
  includeRuntime: boolean;
  debugProfile: string;
  runtimeProfile: string;
  commandOverride: string;
  expectedPort: string;
  webActionKey: string;
  webActionMode: WebActionMode;
};

export type LinkCompatibility = {
  sourceSchemaVersion: number | null;
  targetSchemaVersion: number;
  readOnly: boolean;
  messages: string[];
};

type ManagedStepGroup = "localFile" | "proxy" | "runtime" | "webAction";

export const SUPPORTED_LINK_SCHEMA_VERSION = UI_PROFILE_MANIFEST.schemaVersion;

export function normalizeLinkKeyInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function slugifyLinkKey(value: string) {
  return normalizeLinkKeyInput(value) || `link-${Date.now().toString(36)}`;
}

function defaultWorkspaceKey(workspaces: ProjectWorkspaceSummary[], activeKey: string) {
  const active = workspaces.find((workspace) => workspace.key === activeKey);
  return active && !active.system ? active.key : "";
}

export function defaultDebugProfile(projects: ProjectConfigDraft[], projectKey: string) {
  return projects.find((project) => project.key === projectKey)?.debugProfiles[0]?.key ?? "local-proxy";
}

export function buildInitialLinkDraft({
  activeProjectWorkspaceKey,
  projectWorkspaces,
  projects,
  webActions,
  defaultUiProfile,
}: {
  activeProjectWorkspaceKey: string;
  projectWorkspaces: ProjectWorkspaceSummary[];
  projects: ProjectConfigDraft[];
  webActions: WebActionSummary[];
  defaultUiProfile?: string | null;
}): LinkWizardDraft {
  const uiProfile = normalizeLinkUiProfile(defaultUiProfile);
  const profile = linkUiProfileDefinition(uiProfile);
  const workspaceKey = defaultWorkspaceKey(projectWorkspaces, activeProjectWorkspaceKey);
  const workspace = projectWorkspaces.find((item) => item.key === workspaceKey);
  const project = projects.length === 1 ? projects[0].key : "";
  const name = workspace && !workspace.system ? `${workspace.name} 链路工具` : "链路工具";
  const baseKey = workspaceKey || project || name;
  return {
    key: slugifyLinkKey(`${baseKey}-link`),
    name,
    uiProfile,
    workspaceKey,
    project,
    proxyProfile: "",
    proxyAction: "proxy.start",
    includeLocalFile: uiProfileHasFeature(profile, "localFile"),
    localFilePath: ".env.dev",
    includeProxy: uiProfileHasFeature(profile, "proxy"),
    includeRuntime: uiProfileHasFeature(profile, "runtime"),
    debugProfile: project ? defaultDebugProfile(projects, project) : "local-proxy",
    runtimeProfile: "",
    commandOverride: "",
    expectedPort: "",
    webActionKey: webActions[0]?.key ?? "",
    webActionMode: "open",
  };
}

function managedStepGroup(type: string): ManagedStepGroup | null {
  if (type === "localFile.ensure") return "localFile";
  if (type === "proxy.start" || type === "proxy.check") return "proxy";
  if (type === "runtime.start") return "runtime";
  if (type === "webAction.open" || type === "webAction.run" || type === "webAction.check") {
    return "webAction";
  }
  return null;
}

function explicitLinkUiProfile(value?: string | null): LinkUiProfileKey | null {
  return LINK_UI_PROFILES.some((profile) => profile.id === value)
    ? (value as LinkUiProfileKey)
    : null;
}

export function inferLinkUiProfile(link: LinkConfig): LinkUiProfileKey {
  const explicit = explicitLinkUiProfile(link.uiProfile);
  if (explicit) return explicit;
  if (!link.uiProfile?.trim()) return DEFAULT_LINK_UI_PROFILE;

  const groups = new Set(link.steps.map((step) => managedStepGroup(step.type)).filter(Boolean));
  if (groups.size === 1 && groups.has("proxy")) return "link-proxy-only";
  if (groups.size === 1 && groups.has("webAction")) return "link-web-action";
  return DEFAULT_LINK_UI_PROFILE;
}

function webActionModeFromStep(step?: LinkStepConfig): WebActionMode {
  if (step?.type === "webAction.run") return "run";
  if (step?.type === "webAction.check") return "check";
  return "open";
}

export function buildLinkDraftFromConfig(
  link: LinkConfig,
  projects: ProjectConfigDraft[],
  webActions: WebActionSummary[],
): LinkWizardDraft {
  const uiProfile = inferLinkUiProfile(link);
  const localFileStep = link.steps.find((step) => step.type === "localFile.ensure");
  const proxyStep = link.steps.find(
    (step) => step.type === "proxy.start" || step.type === "proxy.check",
  );
  const runtimeStep = link.steps.find((step) => step.type === "runtime.start");
  const webActionStep = link.steps.find((step) => managedStepGroup(step.type) === "webAction");
  const project = link.project || localFileStep?.project || runtimeStep?.project || "";
  return {
    key: link.key,
    name: link.name,
    uiProfile,
    workspaceKey: link.workspaceKey ?? "",
    project,
    proxyProfile: proxyStep?.profile ?? "",
    proxyAction: proxyStep?.type === "proxy.check" ? "proxy.check" : "proxy.start",
    includeLocalFile: Boolean(localFileStep),
    localFilePath: localFileStep?.path?.trim() || ".env.dev",
    includeProxy: Boolean(proxyStep),
    includeRuntime: Boolean(runtimeStep),
    debugProfile:
      runtimeStep?.debugProfile?.trim() ||
      (project ? defaultDebugProfile(projects, project) : "local-proxy"),
    runtimeProfile: runtimeStep?.runtimeProfile?.trim() || "",
    commandOverride: runtimeStep?.command?.trim() || "",
    expectedPort: runtimeStep?.expectedPort ? String(runtimeStep.expectedPort) : "",
    webActionKey: webActionStep?.action?.trim() || webActions[0]?.key || "",
    webActionMode: webActionModeFromStep(webActionStep),
  };
}

function webActionStepType(mode: WebActionMode) {
  if (mode === "run") return "webAction.run";
  if (mode === "check") return "webAction.check";
  return "webAction.open";
}

function existingManagedStep(link: LinkConfig | null | undefined, group: ManagedStepGroup) {
  return link?.steps.find((step) => managedStepGroup(step.type) === group);
}

function mergeManagedAndExtensionSteps(
  original: LinkConfig | null | undefined,
  generated: Array<{ group: ManagedStepGroup; step: LinkStepConfig }>,
) {
  if (!original) return generated.map((item) => item.step);
  const generatedByGroup = new Map(generated.map((item) => [item.group, item.step]));
  const emitted = new Set<ManagedStepGroup>();
  const steps: LinkStepConfig[] = [];

  for (const step of original.steps) {
    const group = managedStepGroup(step.type);
    if (!group) {
      steps.push(step);
      continue;
    }
    const replacement = generatedByGroup.get(group);
    if (replacement && !emitted.has(group)) {
      steps.push(replacement);
      emitted.add(group);
    }
  }
  for (const item of generated) {
    if (!emitted.has(item.group)) steps.push(item.step);
  }
  return steps;
}

export function buildLinkConfig(
  draft: LinkWizardDraft,
  original?: LinkConfig | null,
): LinkConfig {
  const profile = linkUiProfileDefinition(draft.uiProfile);
  const generated: Array<{ group: ManagedStepGroup; step: LinkStepConfig }> = [];
  if (uiProfileHasFeature(profile, "localFile") && draft.includeLocalFile) {
    generated.push({
      group: "localFile",
      step: {
        ...existingManagedStep(original, "localFile"),
        id: existingManagedStep(original, "localFile")?.id || "local-env",
        type: "localFile.ensure",
        project: draft.project || null,
        path: draft.localFilePath.trim() || ".env.dev",
      },
    });
  }
  if (uiProfileHasFeature(profile, "proxy") && draft.includeProxy) {
    generated.push({
      group: "proxy",
      step: {
        ...existingManagedStep(original, "proxy"),
        id:
          existingManagedStep(original, "proxy")?.id ||
          (draft.proxyAction === "proxy.check" ? "proxy-check" : "proxy"),
        type: draft.proxyAction,
        profile: draft.proxyProfile || null,
      },
    });
  }
  if (uiProfileHasFeature(profile, "runtime") && draft.includeRuntime) {
    generated.push({
      group: "runtime",
      step: {
        ...existingManagedStep(original, "runtime"),
        id: existingManagedStep(original, "runtime")?.id || "runtime",
        type: "runtime.start",
        project: draft.project || null,
        debugProfile: draft.debugProfile.trim() || null,
        runtimeProfile: draft.runtimeProfile.trim() || null,
        command: draft.commandOverride.trim() || null,
        expectedPort: draft.expectedPort ? Number(draft.expectedPort) : null,
      },
    });
  }
  if (uiProfileHasFeature(profile, "proxyAction")) {
    generated.push({
      group: "proxy",
      step: {
        ...existingManagedStep(original, "proxy"),
        id:
          existingManagedStep(original, "proxy")?.id ||
          (draft.proxyAction === "proxy.check" ? "proxy-check" : "proxy"),
        type: draft.proxyAction,
        profile: draft.proxyProfile || null,
      },
    });
  }
  if (uiProfileHasFeature(profile, "webAction")) {
    generated.push({
      group: "webAction",
      step: {
        ...existingManagedStep(original, "webAction"),
        id: existingManagedStep(original, "webAction")?.id || "web-action",
        type: webActionStepType(draft.webActionMode),
        action: draft.webActionKey || null,
      },
    });
  }
  return {
    key: draft.key.trim(),
    name: draft.name.trim(),
    kind: profile.kind,
    uiProfile: draft.uiProfile,
    schemaVersion: SUPPORTED_LINK_SCHEMA_VERSION,
    workspaceKey: draft.workspaceKey || null,
    project: draft.project || null,
    steps: mergeManagedAndExtensionSteps(original, generated),
  };
}

export function linkCompatibility(link: LinkConfig): LinkCompatibility {
  const sourceSchemaVersion = link.schemaVersion && link.schemaVersion > 0 ? link.schemaVersion : null;
  const messages: string[] = [];
  if (!sourceSchemaVersion) {
    messages.push(`这是旧版链路，保存后会升级为 v${SUPPORTED_LINK_SCHEMA_VERSION}。`);
  } else if (sourceSchemaVersion < SUPPORTED_LINK_SCHEMA_VERSION) {
    messages.push(
      `保存后会从 v${sourceSchemaVersion} 升级为 v${SUPPORTED_LINK_SCHEMA_VERSION}。`,
    );
  } else if (sourceSchemaVersion > SUPPORTED_LINK_SCHEMA_VERSION) {
    messages.push(
      `该链路使用 v${sourceSchemaVersion}，当前应用仅支持到 v${SUPPORTED_LINK_SCHEMA_VERSION}。`,
    );
  }
  if (link.uiProfile?.trim() && !explicitLinkUiProfile(link.uiProfile)) {
    messages.push(`未识别界面配置 ${link.uiProfile}，当前按 ${inferLinkUiProfile(link)} 展示。`);
  }
  const extensionSteps = link.steps.filter((step) => !managedStepGroup(step.type));
  if (extensionSteps.length > 0) {
    messages.push(`${extensionSteps.length} 个扩展步骤会按原顺序保留。`);
  }
  return {
    sourceSchemaVersion,
    targetSchemaVersion: SUPPORTED_LINK_SCHEMA_VERSION,
    readOnly: Boolean(sourceSchemaVersion && sourceSchemaVersion > SUPPORTED_LINK_SCHEMA_VERSION),
    messages,
  };
}
