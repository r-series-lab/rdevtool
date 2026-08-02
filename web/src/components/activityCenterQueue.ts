import {
  activityExecutionKey,
  activityRequiresAttention,
  type ActivityEntry,
  type ActivityKind,
} from "../lib/activityCenter";

export type ActivityQueueGroup = {
  id: string;
  label: string;
  items: ActivityEntry[];
  latest: ActivityEntry;
  failedItems: ActivityEntry[];
  resourceItem: ActivityEntry | null;
  targetItem: ActivityEntry | null;
  actionItem: ActivityEntry | null;
  detailItem: ActivityEntry | null;
  failedCount: number;
  actionCount: number;
  total: number;
};

const KIND_LABELS: Record<ActivityKind, string> = {
  runtime: "运行",
  proxy: "本地代理",
  link: "联调链路",
  build: "构建任务",
  branch: "Git工作流",
  deploy: "构建任务",
  shortcut: "资源入口",
  config: "配置变更",
};

function isUnhandledFailure(item: ActivityEntry) {
  return item.status === "failed" && !item.acknowledgedAt;
}

function hasActivityDiagnostics(item: ActivityEntry) {
  return Boolean(item.diagnostics?.length || item.warnings?.length);
}

function queueGroupKey(item: ActivityEntry) {
  if (item.action?.kind === "reloadConfig") {
    return "config:reload";
  }
  return item.chainId ? `chain:${item.chainId}` : activityExecutionKey(item);
}

function queueGroupLabel(item: ActivityEntry) {
  if (item.action?.kind === "reloadConfig") {
    return "配置更新";
  }
  return item.projectName || item.projectKey || KIND_LABELS[item.kind];
}

export function compareActivityPriority(left: ActivityEntry, right: ActivityEntry) {
  const leftFailed = isUnhandledFailure(left) ? 1 : 0;
  const rightFailed = isUnhandledFailure(right) ? 1 : 0;
  if (leftFailed !== rightFailed) {
    return rightFailed - leftFailed;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function buildActivityQueueGroups(attentionItems: ActivityEntry[]) {
  const grouped = new Map<string, ActivityEntry[]>();
  for (const item of attentionItems) {
    const key = queueGroupKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return Array.from(grouped.entries())
    .map(([id, groupItems]): ActivityQueueGroup => {
      const sorted = [...groupItems].sort(compareActivityPriority);
      const failedItems = groupItems.filter(isUnhandledFailure);
      const latest = sorted[0];
      return {
        id,
        label: queueGroupLabel(latest),
        items: groupItems,
        latest,
        failedItems,
        resourceItem:
          sorted.find((item) => isUnhandledFailure(item) && item.resource) ??
          sorted.find((item) => item.resource) ??
          null,
        targetItem:
          sorted.find((item) => isUnhandledFailure(item) && item.target) ??
          sorted.find((item) => item.target) ??
          null,
        actionItem:
          sorted.find((item) => isUnhandledFailure(item) && item.action) ??
          sorted.find((item) => item.action) ??
          null,
        detailItem: sorted.find(hasActivityDiagnostics) ?? null,
        failedCount: failedItems.length,
        actionCount: groupItems.filter((item) => Boolean(item.action)).length,
        total: groupItems.length,
      };
    })
    .sort((left, right) =>
      right.latest.updatedAt.localeCompare(left.latest.updatedAt),
    );
}

export function activityQueueStateLabel(group: ActivityQueueGroup) {
  const actionKind = group.actionItem?.action?.kind;
  if (actionKind === "reloadConfig") {
    return group.actionCount > 1
      ? `需重新加载 ${group.actionCount}`
      : "需重新加载";
  }
  if (actionKind === "compareConfigSource") {
    return "需查看差异";
  }
  if (actionKind) {
    return "可重试";
  }
  return group.failedCount > 1 ? `需确认失败 ${group.failedCount}` : "需确认失败";
}

export function activityQueueResolveLabel(group: ActivityQueueGroup) {
  return group.actionCount > 0 ? "忽略" : "标记已处理";
}

export function reloadConfigAttentionItems(items: ActivityEntry[]) {
  return items.filter(
    (item) =>
      activityRequiresAttention(item) &&
      item.action?.kind === "reloadConfig",
  );
}
