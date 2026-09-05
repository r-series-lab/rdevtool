export type WorkspaceTypeOption = {
  key: string;
  label: string;
};

export type WorkspaceTypeCountOption = WorkspaceTypeOption & {
  count: number;
};

export const SYSTEM_WORKSPACE_TYPE = "system";
export const DEFAULT_WORKSPACE_TYPE = "custom";
export const DEFAULT_NEW_WORKSPACE_TYPE = "business";
export const WORKSPACE_TYPE_STORAGE_NAMESPACE = "rdevtool";
export const WORKSPACE_TYPE_STORAGE_KEY = "workspace-type-options";
export const WORKSPACE_TYPE_OPTIONS_EVENT = "rdevtool:workspace-type-options-changed";

export const WORKSPACE_TYPE_OPTIONS: WorkspaceTypeOption[] = [
  { key: "business", label: "业务" },
  { key: "dev", label: "研发" },
  { key: "other", label: "其他" },
];

const SYSTEM_WORKSPACE_TYPE_OPTION: WorkspaceTypeOption = {
  key: SYSTEM_WORKSPACE_TYPE,
  label: "全局",
};

const BUILTIN_WORKSPACE_TYPE_KEYS = new Set(WORKSPACE_TYPE_OPTIONS.map((option) => option.key));

const WORKSPACE_TYPE_LABELS = new Map<string, string>([
  [SYSTEM_WORKSPACE_TYPE, "全局"],
  ["business", "业务"],
  ["dev", "研发"],
  ["tool", "工具"],
  ["personal", "个人"],
  [DEFAULT_WORKSPACE_TYPE, "未分类"],
  ["other", "其他"],
]);
const RESERVED_WORKSPACE_TYPE_KEYS = new Set(WORKSPACE_TYPE_LABELS.keys());

export function normalizeWorkspaceType(value?: string | null) {
  const next = value?.trim();
  return next ? next : DEFAULT_WORKSPACE_TYPE;
}

export function normalizeWorkspaceTypeOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isBuiltinWorkspaceTypeOption(key: string) {
  return BUILTIN_WORKSPACE_TYPE_KEYS.has(key);
}

export function isCustomWorkspaceTypeOption(option: WorkspaceTypeOption) {
  return option.key !== SYSTEM_WORKSPACE_TYPE && !RESERVED_WORKSPACE_TYPE_KEYS.has(option.key);
}

export function mergeWorkspaceTypeOptions(options: WorkspaceTypeOption[] = []) {
  const merged = new Map<string, WorkspaceTypeOption>();
  for (const option of WORKSPACE_TYPE_OPTIONS) {
    merged.set(option.key, option);
  }
  for (const option of options) {
    const key = normalizeWorkspaceType(option.key);
    const label = normalizeWorkspaceTypeOptionLabel(option.label || key);
    if (!key || key === SYSTEM_WORKSPACE_TYPE || merged.has(key) || RESERVED_WORKSPACE_TYPE_KEYS.has(key)) {
      continue;
    }
    merged.set(key, { key, label });
  }
  return Array.from(merged.values());
}

export function workspaceTypeLabel(
  value?: string | null,
  fallbackLabel?: string | null,
  options: WorkspaceTypeOption[] = WORKSPACE_TYPE_OPTIONS,
) {
  const key = normalizeWorkspaceType(value);
  const option = key === SYSTEM_WORKSPACE_TYPE
    ? SYSTEM_WORKSPACE_TYPE_OPTION
    : options.find((item) => item.key === key);
  if (option?.label) {
    return option.label;
  }
  const label = fallbackLabel?.trim();
  if (label && label !== key) {
    return label;
  }
  return WORKSPACE_TYPE_LABELS.get(key) ?? key;
}

export function workspaceTypeOptionsWithValues(
  options: WorkspaceTypeOption[],
  values: Array<{ value?: string | null; label?: string | null }>,
) {
  const merged = mergeWorkspaceTypeOptions(options);
  const seen = new Set(merged.map((option) => option.key));
  for (const item of values) {
    const key = normalizeWorkspaceType(item.value);
    if (!key || key === SYSTEM_WORKSPACE_TYPE || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ key, label: workspaceTypeLabel(key, item.label, options) });
  }
  return merged;
}

export function createWorkspaceTypeOption(label: string, options: WorkspaceTypeOption[]) {
  const normalizedLabel = normalizeWorkspaceTypeOptionLabel(label);
  if (!normalizedLabel) {
    throw new Error("请填写类型名称");
  }
  const labelExists = options.some((option) => option.label === normalizedLabel);
  if (labelExists || normalizedLabel === SYSTEM_WORKSPACE_TYPE_OPTION.label) {
    throw new Error("类型已存在");
  }
  const slug = normalizedLabel
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const existingKeys = new Set([
    ...RESERVED_WORKSPACE_TYPE_KEYS,
    ...options.map((option) => option.key),
  ]);
  const base = slug || `type-${Date.now().toString(36)}`;
  let key = base;
  let index = 2;
  while (existingKeys.has(key)) {
    key = `${base}-${index}`;
    index += 1;
  }
  return { key, label: normalizedLabel };
}

export function workspaceTypeCountOptions(
  items: Array<{
    workspaceType?: string | null;
    workspaceTypeLabel?: string | null;
  }>,
  options: WorkspaceTypeOption[] = WORKSPACE_TYPE_OPTIONS,
) {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const item of items) {
    const key = normalizeWorkspaceType(item.workspaceType);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    labels.set(key, workspaceTypeLabel(key, item.workspaceTypeLabel, options));
  }

  const orderedKeys = [
    SYSTEM_WORKSPACE_TYPE,
    ...mergeWorkspaceTypeOptions(options).map((option) => option.key),
    ...Array.from(counts.keys()).sort((left, right) => left.localeCompare(right)),
  ];
  const seen = new Set<string>();
  return orderedKeys
    .filter((key) => {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map<WorkspaceTypeCountOption>((key) => ({
      key,
      label: labels.get(key) ?? workspaceTypeLabel(key, null, options),
      count: counts.get(key) ?? 0,
    }));
}
