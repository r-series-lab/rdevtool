import { describe, expect, it } from "vitest";

import { translateMessage } from "../i18n";
import { formatBranchSyncSummary } from "./useBranchContext";

describe("branch sync summary", () => {
  it("localizes the dynamic summary without translating branch data", () => {
    const summary = formatBranchSyncSummary(
      {
        syncedAt: new Date("2026-08-10T06:48:01Z").getTime(),
        source: "localRepository",
        freshness: "fresh",
        elapsedMs: 1600,
        branches: [
          {
            name: "feature_demo_WORKSPACE-exchange",
            updatedAt: "2026-08-10T06:48:01Z",
            updatedTs: new Date("2026-08-10T06:48:01Z").getTime(),
            commit: null,
          },
        ],
      },
      (message, params) => translateMessage("en-US", message, params),
    );

    expect(summary).toContain("Last synced at");
    expect(summary).toContain("Local repository");
    expect(summary).toContain("1 branches · 1.6s");
    expect(summary).toContain("refreshes automatically");
    expect(summary).not.toContain("最近同步于");
  });
});
