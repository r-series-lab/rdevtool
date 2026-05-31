export type HistoryGroup<T> = {
  id: string;
  signature: string;
  latest: T;
  items: T[];
};

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function groupConsecutiveBy<T>(
  items: T[],
  getSignature: (item: T) => string,
  getId: (item: T) => string,
): HistoryGroup<T>[] {
  const groups: HistoryGroup<T>[] = [];

  for (const item of items) {
    const signature = getSignature(item);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.signature === signature) {
      lastGroup.items.push(item);
      continue;
    }

    groups.push({
      id: getId(item),
      signature,
      latest: item,
      items: [item],
    });
  }

  return groups;
}
