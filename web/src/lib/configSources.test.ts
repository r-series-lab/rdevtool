import { describe, expect, it } from "vitest";
import type { ConfigSource } from "../app-types";
import {
  configSourceIdForWorkspace,
  configSourceChangeAffects,
  configSourcePreferenceKey,
  ConfigSourceRequestTracker,
  configSourceSupports,
  findConfigSource,
  mergeConfigSourcesChangedPayload,
  normalizeConfigSourceId,
  resolveConfigSource,
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
  it("normalizes workspace keys into stable source ids", () => {
    expect(normalizeConfigSourceId(" Feature_CR260 / YKD Car ")).toBe(
      "feature_cr260-ykd-car",
    );
    expect(configSourceIdForWorkspace("feature_cr260_ykd_car")).toBe(
      "workspace-feature_cr260_ykd_car",
    );
    expect(configSourceIdForWorkspace("system")).toBe("default");
  });

  it("matches legacy underscore and dash variants", () => {
    const sources = [source("workspace-feature_cr260", ["resource"])];
    expect(findConfigSource(sources, "workspace-feature-cr260")?.id).toBe(
      "workspace-feature_cr260",
    );
  });

  it("scopes remembered selections by workspace and capability", () => {
    expect(configSourcePreferenceKey("feature_cr260", "proxy")).toBe(
      "rdevtool.config-source.proxy.feature_cr260",
    );
    expect(configSourcePreferenceKey("feature_cr260", "resource")).not.toBe(
      configSourcePreferenceKey("feature_cr260", "proxy"),
    );
    expect(configSourcePreferenceKey("feature_cr260", "link")).not.toBe(
      configSourcePreferenceKey("feature_cr260", "runtime"),
    );
  });

  it("falls back to the default source when the requested source is stale", () => {
    const sources = [
      source("default", ["resource", "proxy"], true),
      source("team", ["resource"]),
    ];
    expect(resolveConfigSource(sources, "removed-source", "proxy")?.id).toBe("default");
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
