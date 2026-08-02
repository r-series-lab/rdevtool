import { describe, expect, it, vi } from "vitest";
import { buildStartupTasks } from "../app-modules";
import type { ModuleRuntimeContext } from "../app-modules.types";

describe("app startup loading", () => {
  it("loads project scope once and leaves page data to active modules", async () => {
    const loadProjects = vi.fn(async () => undefined);
    const loadFinderData = vi.fn(async () => undefined);
    const loadBranchTaskHistory = vi.fn(async () => undefined);
    const context = {
      appShell: { loadProjects },
      projectsModule: { loadFinderData },
      mergeModule: { loadBranchTaskHistory },
    } as unknown as ModuleRuntimeContext;

    await Promise.all(
      buildStartupTasks(
        ["overview", "projectManagement"],
        "projectManagement",
        "demo",
        context,
      ),
    );

    expect(loadProjects).toHaveBeenCalledOnce();
    expect(loadProjects).toHaveBeenCalledWith("demo");
    expect(loadFinderData).not.toHaveBeenCalled();
    expect(loadBranchTaskHistory).not.toHaveBeenCalled();
  });
});
