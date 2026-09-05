import type { BuildHistoryEntry } from "../app-types";
import { stableStringify } from "./historyGroups";

const LEGACY_POLL_MAX_GAP_MS = 5_000;
const LEGACY_POLL_MIN_RECORDS = 3;
const LEGACY_TIMESTAMP_TOLERANCE_MS = 15_000;

function legacyPollingTimestamp(item: BuildHistoryEntry) {
  if (item.queueUrl || item.buildUrl) {
    return null;
  }

  const match = item.historyKey.match(/^(.*):([^:]+):(\d{13})$/);
  if (!match || match[1] !== item.projectKey || match[2] !== item.mode) {
    return null;
  }

  const keyTimestamp = Number(match[3]);
  const createdTimestamp = Date.parse(item.createdAt);
  if (
    !Number.isFinite(keyTimestamp) ||
    !Number.isFinite(createdTimestamp) ||
    Math.abs(keyTimestamp - createdTimestamp) > LEGACY_TIMESTAMP_TOLERANCE_MS
  ) {
    return null;
  }
  return keyTimestamp;
}

function legacyPollingSignature(item: BuildHistoryEntry) {
  return stableStringify({
    workspaceKey: item.workspaceKey ?? "",
    projectInstancePath: item.projectInstancePath ?? "",
    projectKey: item.projectKey,
    mode: item.mode,
    env: item.env,
    branch: item.branch,
    params: item.params ?? {},
  });
}

function mergeLegacyPollingCluster(
  cluster: Array<{ item: BuildHistoryEntry; timestamp: number }>,
) {
  const oldest = cluster[0].item;
  const latestState = cluster.reduce((latest, current) =>
    current.item.updatedAt.localeCompare(latest.updatedAt) > 0
      ? current.item
      : latest,
  oldest);

  return {
    ...oldest,
    stateKey: latestState.stateKey,
    stateLabel: latestState.stateLabel,
    detail: latestState.detail,
    queueUrl: latestState.queueUrl,
    buildUrl: latestState.buildUrl,
    updatedAt: latestState.updatedAt,
  };
}

/**
 * Older web builds created a new local history key on every three-second
 * status poll. Keep the durable rows intact, but present each polling burst as
 * the single build execution it represented.
 */
export function collapseLegacyPollingBuildHistory(items: BuildHistoryEntry[]) {
  const candidates = new Map<
    string,
    Array<{ item: BuildHistoryEntry; timestamp: number }>
  >();

  for (const item of items) {
    const timestamp = legacyPollingTimestamp(item);
    if (timestamp === null) {
      continue;
    }
    const signature = legacyPollingSignature(item);
    const entries = candidates.get(signature) ?? [];
    entries.push({ item, timestamp });
    candidates.set(signature, entries);
  }

  const replacements = new Map<
    string,
    { clusterId: string; item: BuildHistoryEntry }
  >();
  let clusterIndex = 0;

  for (const entries of candidates.values()) {
    entries.sort((left, right) => left.timestamp - right.timestamp);
    let clusterStart = 0;

    for (let index = 1; index <= entries.length; index += 1) {
      const closesCluster =
        index === entries.length ||
        entries[index].timestamp - entries[index - 1].timestamp >
          LEGACY_POLL_MAX_GAP_MS;
      if (!closesCluster) {
        continue;
      }

      const cluster = entries.slice(clusterStart, index);
      clusterStart = index;
      if (cluster.length < LEGACY_POLL_MIN_RECORDS) {
        continue;
      }

      const clusterId = `legacy-poll-${clusterIndex}`;
      clusterIndex += 1;
      const merged = mergeLegacyPollingCluster(cluster);
      for (const { item } of cluster) {
        replacements.set(item.historyKey, { clusterId, item: merged });
      }
    }
  }

  if (replacements.size === 0) {
    return items;
  }

  const emittedClusters = new Set<string>();
  const collapsed: BuildHistoryEntry[] = [];
  for (const item of items) {
    const replacement = replacements.get(item.historyKey);
    if (!replacement) {
      collapsed.push(item);
      continue;
    }
    if (emittedClusters.has(replacement.clusterId)) {
      continue;
    }
    emittedClusters.add(replacement.clusterId);
    collapsed.push(replacement.item);
  }
  return collapsed;
}

export function isConfigReadyBuildHistoryEntry(
  item: Pick<BuildHistoryEntry, "stateKey" | "stateLabel" | "detail">,
) {
  const stateKey = item.stateKey.trim().toLowerCase();
  return (
    ["cancelled", "canceled", "stopped", "idle"].includes(stateKey) &&
    item.stateLabel.trim() === "待打包" &&
    item.detail.includes("配置已就绪")
  );
}

export function normalizeBuildHistoryRecords(items: BuildHistoryEntry[]) {
  return collapseLegacyPollingBuildHistory(items).filter(
    (item) => !isConfigReadyBuildHistoryEntry(item),
  );
}
