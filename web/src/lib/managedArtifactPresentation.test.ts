import { describe, expect, it } from "vitest";
import { translateMessage } from "../i18n";
import {
  managedArtifactDetailLabel,
  managedArtifactCleanupPlanCommand,
  managedArtifactKindLabel,
  managedArtifactObjectTypeLabel,
} from "./managedArtifactPresentation";

const t = (message: string) => translateMessage("en-US", message);

describe("managed artifact presentation", () => {
  it("localizes backend kind and object type keys", () => {
    expect(managedArtifactKindLabel("workspaceProjectInstance", t)).toBe(
      "Workspace Copy",
    );
    expect(managedArtifactObjectTypeLabel("directory", t)).toBe("Directory");
  });

  it("localizes known backend detail messages", () => {
    expect(
      managedArtifactDetailLabel(
        "工作区项目实例显式记录 managed=true",
        t,
      ),
    ).toBe("The workspace project instance is explicitly marked managed=true");
  });

  it("builds a reproducible cleanup plan command from structured scope", () => {
    expect(
      managedArtifactCleanupPlanCommand({
        schemaVersion: 1,
        requested: {
          workspace: "feature demo",
          allWorkspaces: false,
          project: null,
          kinds: ["runtimeLog"],
          artifactIds: ["artifact-one", "artifact'two"],
        },
        effective: {
          workspaceKeys: ["feature demo"],
          selectedArtifactIds: ["artifact-one", "artifact'two"],
          missingArtifactIds: [],
          executionSupported: false,
        },
        observed: {
          actions: [],
          eligibleCount: 0,
          reviewRequiredCount: 0,
          blockedCount: 0,
        },
        status: {
          key: "empty",
          label: "empty",
          success: true,
          terminal: true,
          detail: "empty",
        },
        evidence: [],
        risks: [],
        managedArtifacts: [],
        recommendedActions: [],
      }),
    ).toBe(
      "rdevtool --json artifacts cleanup-plan --workspace 'feature demo' --kind runtimeLog --artifact-id artifact-one --artifact-id 'artifact'\\''two'",
    );
  });
});
