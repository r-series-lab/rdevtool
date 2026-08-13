import { describe, expect, it, vi } from "vitest";
import type { BuildTargetMeta } from "./useBuildContext";
import { loadBuildTargetContext } from "./useBuildContext";

function targetMeta(params: BuildTargetMeta["params"]): BuildTargetMeta {
  return {
    targets: [],
    selectedTarget: "package",
    params,
  };
}

describe("build target context loading", () => {
  it("does not infer a branch for local package targets without a branch parameter", async () => {
    const meta = targetMeta([
      {
        key: "platform",
        label: "系统",
        kind: "select",
        defaultValue: "macos",
        configuredDefault: "macos",
        defaultSource: "projectDefault",
        options: ["macos", "windows", "linux"],
        required: false,
        trueValue: "是",
        falseValue: "否",
      },
    ]);
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "get_build_target_meta") {
        return meta;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(
      loadBuildTargetContext("rcodexmanager", "package", invokeCommand),
    ).resolves.toEqual({ meta, defaultBranch: "" });
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith("get_build_target_meta", {
      project: "rcodexmanager",
      target: "package",
    });
  });

  it("still resolves the current branch for targets that declare a branch parameter", async () => {
    const meta = targetMeta([
      {
        key: "BRANCH",
        label: "分支",
        kind: "branch",
        defaultValue: "",
        configuredDefault: null,
        defaultSource: "currentBranch",
        options: [],
        required: true,
        trueValue: "是",
        falseValue: "否",
      },
    ]);
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "get_build_target_meta") {
        return meta;
      }
      if (command === "get_default_branch") {
        return "feature/demo";
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(
      loadBuildTargetContext("demo", "vke", invokeCommand),
    ).resolves.toEqual({ meta, defaultBranch: "feature/demo" });
    expect(invokeCommand).toHaveBeenNthCalledWith(2, "get_default_branch", {
      project: "demo",
    });
  });
});
