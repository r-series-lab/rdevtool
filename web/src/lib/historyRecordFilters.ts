import type {
  BranchTaskHistoryEntry,
  BranchWorkflowMode,
  BuildHistoryEntry,
} from "../app-types";
import type { HistoryGroup } from "./historyGroups";
import { isOperationActiveState } from "./operationLifecycle";

export type BuildHistoryStatusFilter = "all" | "active" | "success" | "failed";
export type BranchHistoryResultFilter = "all" | "success" | "failed";
export type BranchHistoryKindFilter = "all" | BranchWorkflowMode;

function normalizedSearchText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function includesHistoryQuery(query: string, values: unknown[]) {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) {
    return true;
  }
  return values.some((value) =>
    normalizedSearchText(value).includes(normalizedQuery),
  );
}

export function buildHistoryStatus(
  item: BuildHistoryEntry,
): Exclude<BuildHistoryStatusFilter, "all"> | "other" {
  const state = normalizedSearchText(item.stateKey);
  if (isOperationActiveState(state)) {
    return "active";
  }
  if (
    state.includes("success") ||
    state.includes("succeed") ||
    state.includes("done") ||
    state.includes("complete")
  ) {
    return "success";
  }
  if (
    state.includes("fail") ||
    state.includes("error") ||
    state.includes("abort") ||
    state.includes("cancel") ||
    state.includes("stop")
  ) {
    return "failed";
  }
  return "other";
}

export function matchesBuildHistoryEntry(
  item: BuildHistoryEntry,
  filters: {
    query: string;
    status: BuildHistoryStatusFilter;
    mode: string;
    markedOnly: boolean;
  },
  isMarked: (item: BuildHistoryEntry) => boolean,
) {
  if (filters.status !== "all" && buildHistoryStatus(item) !== filters.status) {
    return false;
  }
  if (filters.mode !== "all" && item.mode !== filters.mode) {
    return false;
  }
  if (filters.markedOnly && !isMarked(item)) {
    return false;
  }
  return includesHistoryQuery(filters.query, [
    item.historyKey,
    item.projectKey,
    item.projectName,
    item.mode,
    item.env,
    item.branch,
    item.stateKey,
    item.stateLabel,
    item.detail,
    ...Object.entries(item.params ?? {}).flatMap(([key, value]) => [key, value]),
  ]);
}

export function matchesBranchHistoryEntry(
  item: BranchTaskHistoryEntry,
  filters: {
    query: string;
    result: BranchHistoryResultFilter;
    kind: BranchHistoryKindFilter;
    markedOnly: boolean;
  },
  isMarked: (item: BranchTaskHistoryEntry) => boolean,
) {
  const failed = !item.success || item.items.some((taskItem) => !taskItem.success);
  if (filters.result === "success" && failed) {
    return false;
  }
  if (filters.result === "failed" && !failed) {
    return false;
  }
  if (filters.kind !== "all" && item.taskKind !== filters.kind) {
    return false;
  }
  if (filters.markedOnly && !isMarked(item)) {
    return false;
  }
  return includesHistoryQuery(filters.query, [
    item.id,
    item.taskKind,
    item.summary,
    item.detail,
    ...item.items.flatMap((taskItem) => [
      taskItem.projectKey,
      taskItem.projectName,
      taskItem.sourceBranch,
      taskItem.targetBranch,
      taskItem.statusKey,
      taskItem.statusLabel,
      taskItem.summary,
      taskItem.detail,
      taskItem.commit?.shortHash,
      taskItem.commit?.subject,
    ]),
  ]);
}

export function filterHistoryGroups<T>(
  groups: HistoryGroup<T>[],
  matches: (item: T) => boolean,
): HistoryGroup<T>[] {
  return groups.flatMap((group) => {
    const items = group.items.filter(matches);
    return items.length > 0 ? [{ ...group, latest: items[0], items }] : [];
  });
}
