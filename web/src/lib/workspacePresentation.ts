import type { AppLanguage, Translate } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

type WorkspaceNameSource = {
  name: string;
  system: boolean;
};

export type WorkspaceSummaryCountKind =
  | "entry"
  | "project"
  | "proxy"
  | "action";

const ENGLISH_COUNT_NOUNS: Record<
  WorkspaceSummaryCountKind,
  [singular: string, plural: string]
> = {
  entry: ["resource", "resources"],
  project: ["project", "projects"],
  proxy: ["proxy", "proxies"],
  action: ["action", "actions"],
};

const CHINESE_COUNT_UNITS: Record<WorkspaceSummaryCountKind, string> = {
  entry: "入口",
  project: "项目",
  proxy: "代理",
  action: "动作",
};

export function workspaceDisplayName(
  workspace: WorkspaceNameSource | null,
  t: Translate,
) {
  if (!workspace) {
    return t("工作区");
  }
  return workspace.system ? t("全局") : workspace.name;
}

export function workspaceSummaryCountLabel(
  language: AppLanguage,
  kind: WorkspaceSummaryCountKind,
  count: number,
) {
  if (language === "en-US") {
    const [singular, plural] = ENGLISH_COUNT_NOUNS[kind];
    return `${count} ${count === 1 ? singular : plural}`;
  }
  return `${count} 个${CHINESE_COUNT_UNITS[kind]}`;
}

export function missingDirectoryCountLabel(
  language: AppLanguage,
  count: number,
) {
  if (language === "en-US") {
    return count === 1
      ? "1 directory needs setup"
      : `${count} directories need setup`;
  }
  return `${count} 目录待配`;
}

export function workspaceLinkToolSummary(
  detail: string | null | undefined,
  fallback: string,
  runtimeLabel: string,
  t: Translate,
) {
  const normalizedDetail = detail?.trim() ?? "";
  const normalizedRuntimeLabel = runtimeLabel.trim();
  const displayDetail = normalizedDetail
    ? translateInternalMessage(normalizedDetail, t)
    : fallback;
  const detailIncludesRuntime = normalizedDetail
    .split(" · ")
    .some((part) => part.trim() === normalizedRuntimeLabel);
  const displayRuntime =
    normalizedRuntimeLabel && !detailIncludesRuntime
      ? translateInternalMessage(normalizedRuntimeLabel, t)
      : "";
  return [displayDetail, displayRuntime].filter(Boolean).join(" · ");
}
