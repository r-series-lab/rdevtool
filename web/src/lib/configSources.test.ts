import { describe, expect, it } from "vitest";
import type { ConfigSource } from "../app-types";
import {
  archivedConfigSourceCount,
  configSourceIdForWorkspace,
  configSourceChangeAffects,
  configSourcePreferenceKey,
  ConfigSourceRequestTracker,
  configSourceSupports,
  findConfigSource,
  managesConfigSourcePreference,
  mergeConfigSourcesChangedPayload,
  normalizeConfigSourceId,
  readConfigSourcePreferenceCache,
  resolveConfigSource,
  visibleConfigSources,
  writeConfigSourcePreferenceCache,
} from "./configSources";

function source(
  id: string,
  capabilities: string[],
  isDefault = false,
): ConfigSource {
  return {
    id,
    name: id,
    kind: isDefault ? "default" : "custom",
    baseDir: `/tmp/${id}`,
    files: {
      navigation: `/tmp/${id}/navigation.toml`,
      actions: `/tmp/${id}/actions.toml`,
      links: `/tmp/${id}/links.toml`,
      proxy: `/tmp/${id}/proxy.toml`,
      runtimeOverrides: `/tmp/${id}/runtime_overrides.toml`,
    },
    uiProfile: "resource-basic",
    capabilities,
    isDefault,
  };
}

describe("config source selection", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  }

  it("normalizes workspace keys into stable source ids", () => {
    expect(normalizeConfigSourceId(" Feature Demo / Checkout ")).toBe(
      "feature-demo-checkout",
    );
    expect(configSourceIdForWorkspace("feature_demo_checkout")).toBe(
      "workspace-feature_demo_checkout",
    );
    expect(configSourceIdForWorkspace("system")).toBe("default");
  });

  it("matches legacy underscore and dash variants", () => {
    const sources = [source("workspace-feature_demo", ["resource"])];
    expect(findConfigSource(sources, "workspace-feature-demo")?.id).toBe(
      "workspace-feature_demo",
    );
  });

  it("scopes remembered selections by workspace and capability", () => {
    expect(configSourcePreferenceKey("feature_demo", "proxy")).toBe(
      "rdevtool.config-source.proxy.feature_demo",
    );
    expect(configSourcePreferenceKey("feature_demo", "resource")).not.toBe(
      configSourcePreferenceKey("feature_demo", "proxy"),
    );
    expect(configSourcePreferenceKey("feature_demo", "link")).not.toBe(
      configSourcePreferenceKey("feature_demo", "runtime"),
    );
  });

  it("only caches selections managed as workspace capability preferences", () => {
    expect(managesConfigSourcePreference(undefined, "proxy")).toBe(true);
    expect(managesConfigSourcePreference("team-proxy", "proxy")).toBe(false);
    expect(managesConfigSourcePreference(undefined, undefined)).toBe(false);
  });

  it("uses local storage as a trimmed bootstrap cache", () => {
    const key = configSourcePreferenceKey("feature-a", "proxy");
    const storage = memoryStorage({ [key]: "  team-proxy  " });

    expect(readConfigSourcePreferenceCache(storage, key)).toBe("team-proxy");
    writeConfigSourcePreferenceCache(storage, key, " workspace-feature-a ");
    expect(readConfigSourcePreferenceCache(storage, key)).toBe("workspace-feature-a");
    writeConfigSourcePreferenceCache(storage, key, "  ");
    expect(readConfigSourcePreferenceCache(storage, key)).toBeNull();
  });

  it("falls back to the default source when the requested source is stale", () => {
    const sources = [
      source("default", ["resource", "proxy"], true),
      source("team", ["resource"]),
    ];
    expect(resolveConfigSource(sources, "removed-source", "proxy")?.id).toBe("default");
  });

  it("keeps archived workspace sources resolvable but hidden by default", () => {
    const sources = [
      source("default", ["resource"], true),
      { ...source("workspace-feature-a", ["resource"]), workspaceArchived: true },
    ];

    expect(archivedConfigSourceCount(sources)).toBe(1);
    expect(visibleConfigSources(sources, false).map((item) => item.id)).toEqual([
      "default",
    ]);
    expect(
      resolveConfigSource(sources, "workspace-feature-a", "resource")?.id,
    ).toBe("workspace-feature-a");
  });

  it("skips sources that do not provide the requested capability", () => {
    const sources = [
      source("default", ["resource"], true),
      source("proxy-team", ["proxy"]),
    ];
    expect(resolveConfigSource(sources, "default", "proxy")?.id).toBe("proxy-team");
    expect(configSourceSupports(sources[1], "PROXY")).toBe(true);
  });

  it("only accepts the latest request in the active scope", () => {
    const tracker = new ConfigSourceRequestTracker();
    const oldWorkspaceRequest = tracker.begin("proxy.workspace-a");
    const latestWorkspaceRequest = tracker.begin("proxy.workspace-b");

    expect(tracker.isCurrent(oldWorkspaceRequest, "proxy.workspace-a")).toBe(false);
    expect(tracker.isCurrent(latestWorkspaceRequest, "proxy.workspace-a")).toBe(false);
    expect(tracker.isCurrent(latestWorkspaceRequest, "proxy.workspace-b")).toBe(true);

    tracker.invalidate();
    expect(tracker.isCurrent(latestWorkspaceRequest, "proxy.workspace-b")).toBe(false);
  });

  it("refreshes only the affected source unless the catalog changed", () => {
    expect(
      configSourceChangeAffects(
        { revision: 1, sourceIds: ["team"], catalogChanged: false },
        "team",
      ),
    ).toBe(true);
    expect(
      configSourceChangeAffects(
        { revision: 2, sourceIds: ["other"], catalogChanged: false },
        "team",
      ),
    ).toBe(false);
    expect(
      configSourceChangeAffects(
        { revision: 3, sourceIds: [], catalogChanged: true },
        "team",
      ),
    ).toBe(true);
  });

  it("merges debounced source changes without dropping earlier sources", () => {
    expect(
      mergeConfigSourcesChangedPayload(
        {
          revision: 4,
          origin: "internal",
          sourceIds: ["team"],
          catalogChanged: false,
        },
        {
          revision: 5,
          origin: "external",
          sourceIds: ["shared", "team"],
          catalogChanged: true,
        },
      ),
    ).toEqual({
      revision: 5,
      origin: "external",
      sourceIds: ["team", "shared"],
      catalogChanged: true,
    });
  });
});
