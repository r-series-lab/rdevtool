import {
  activityRequiresAttention,
  type ActivityEntry,
} from "./activityCenter";

export function resolveActivityEntries(
  items: ActivityEntry[],
  ids: string[],
  resolvedAt = new Date().toISOString(),
) {
  const targetIds = new Set(ids.filter(Boolean));
  if (targetIds.size === 0) {
    return items;
  }
  return items.map((item) => {
    if (!targetIds.has(item.id)) {
      return item;
    }
    return {
      ...item,
      status:
        item.kind === "config" && item.status === "running"
          ? "info" as const
          : item.status,
      action: null,
      acknowledgedAt: item.acknowledgedAt || resolvedAt,
      updatedAt: resolvedAt,
    };
  });
}

export function activityCanBeCleared(item: ActivityEntry) {
  return !activityRequiresAttention(item) && item.status !== "running";
}
