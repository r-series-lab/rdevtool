import type { ProjectDebugProfileSummary } from "../app-types";

function normalizedProfileKeyPart(value?: string | null) {
  return (
    value
      ?.trim()
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local"
  );
}

export function uniqueProjectLaunchProfileKey(
  profiles: Pick<ProjectDebugProfileSummary, "key">[],
  baseKey?: string | null,
  suffix = "custom",
) {
  const existing = new Set(profiles.map((profile) => profile.key.trim()));
  const normalizedBase = normalizedProfileKeyPart(baseKey);
  const normalizedSuffix = normalizedProfileKeyPart(suffix);
  let index = 1;
  let candidate = `${normalizedBase}-${normalizedSuffix}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${normalizedBase}-${normalizedSuffix}-${index}`;
  }
  return candidate;
}
