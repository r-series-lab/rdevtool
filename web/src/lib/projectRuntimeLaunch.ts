export type ProjectRuntimeResolutionArgs = {
  project: string;
  debugProfile: string | null;
  runtimeProfile: string | null;
  command: string | null;
  expectedPort: number | null;
  envOverrides: Record<string, string> | null;
};

type ProjectRuntimeResolutionInput = {
  project: string;
  debugProfile?: string | null;
  runtimeProfile?: string | null;
  command?: string | null;
  expectedPort?: number | null;
  envOverrides?: Record<string, string> | null;
};

function optionalText(value?: string | null): string | null {
  return value?.trim() || null;
}

export function normalizeRuntimeEnvOverrides(
  value?: Record<string, string> | null,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      continue;
    }
    const normalizedKey = key.trim();
    if (normalizedKey) {
      next[normalizedKey] = item;
    }
  }
  return next;
}

export function buildProjectRuntimeResolutionArgs({
  project,
  debugProfile,
  runtimeProfile,
  command,
  expectedPort,
  envOverrides,
}: ProjectRuntimeResolutionInput): ProjectRuntimeResolutionArgs {
  const hasExplicitEnvOverrides = envOverrides != null;
  return {
    project: project.trim(),
    debugProfile: optionalText(debugProfile),
    runtimeProfile: optionalText(runtimeProfile),
    command: optionalText(command),
    expectedPort: expectedPort ?? null,
    envOverrides: hasExplicitEnvOverrides
      ? normalizeRuntimeEnvOverrides(envOverrides)
      : null,
  };
}
