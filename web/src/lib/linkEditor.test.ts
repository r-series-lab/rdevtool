import { describe, expect, it } from "vitest";
import type { LinkConfig } from "../app-types";
import {
  buildLinkConfig,
  buildLinkDraftFromConfig,
  linkCompatibility,
} from "./linkEditor";

const legacyLink: LinkConfig = {
  key: "legacy-debug",
  name: "Legacy Debug",
  steps: [
    { id: "before", type: "custom.prepare", note: "keep", customValue: "future" },
    {
      id: "env",
      type: "localFile.ensure",
      project: "demo",
      path: ".env.local",
      customFlag: true,
    },
    { id: "proxy", type: "proxy.start", profile: "default" },
    { id: "after", type: "custom.check" },
  ],
};

describe("Link editor migration", () => {
  it("hydrates legacy links with the default profile", () => {
    const draft = buildLinkDraftFromConfig(legacyLink, [], []);
    expect(draft.uiProfile).toBe("link-local-debug");
    expect(draft.project).toBe("demo");
    expect(draft.localFilePath).toBe(".env.local");
    expect(draft.includeRuntime).toBe(false);
  });

  it("preserves extension steps and unknown fields while upgrading", () => {
    const draft = buildLinkDraftFromConfig(legacyLink, [], []);
    const saved = buildLinkConfig({ ...draft, localFilePath: ".env.dev" }, legacyLink);
    expect(saved.schemaVersion).toBe(1);
    expect(saved.steps.map((step) => step.type)).toEqual([
      "custom.prepare",
      "localFile.ensure",
      "proxy.start",
      "custom.check",
    ]);
    expect(saved.steps[0].customValue).toBe("future");
    expect(saved.steps[1].customFlag).toBe(true);
    expect(saved.steps[2].type).toBe("proxy.start");
    expect(saved.steps[1].path).toBe(".env.dev");
  });

  it("preserves a legacy proxy check action", () => {
    const proxyCheckLink: LinkConfig = {
      ...legacyLink,
      steps: legacyLink.steps.map((step) =>
        step.type === "proxy.start" ? { ...step, type: "proxy.check" } : step,
      ),
    };
    const draft = buildLinkDraftFromConfig(proxyCheckLink, [], []);
    expect(draft.proxyAction).toBe("proxy.check");
    const saved = buildLinkConfig(draft, proxyCheckLink);
    expect(saved.steps.find((step) => step.id === "proxy")?.type).toBe("proxy.check");
  });

  it("round-trips explicit runtime launch overrides", () => {
    const link: LinkConfig = {
      key: "runtime-override",
      name: "Runtime Override",
      uiProfile: "link-local-debug",
      project: "demo",
      steps: [
        {
          id: "runtime",
          type: "runtime.start",
          project: "demo",
          debugProfile: "proxy",
          runtimeProfile: "env_demo_pre",
          command: "npm exec vite -- --mode env_demo_pre",
          expectedPort: 1420,
        },
      ],
    };
    const draft = buildLinkDraftFromConfig(link, [], []);
    expect(draft.debugProfile).toBe("proxy");
    expect(draft.runtimeProfile).toBe("env_demo_pre");
    expect(draft.commandOverride).toContain("--mode env_demo_pre");
    expect(draft.expectedPort).toBe("1420");

    const saved = buildLinkConfig(draft, link);
    expect(saved.steps[0]).toMatchObject({
      runtimeProfile: "env_demo_pre",
      command: "npm exec vite -- --mode env_demo_pre",
      expectedPort: 1420,
    });
  });

  it("blocks editing a future schema version", () => {
    const compatibility = linkCompatibility({ ...legacyLink, schemaVersion: 9 });
    expect(compatibility.readOnly).toBe(true);
    expect(compatibility.messages.join(" ")).toContain("仅支持到 v1");
  });
});
