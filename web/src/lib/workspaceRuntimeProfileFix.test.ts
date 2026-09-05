import { describe, expect, it } from "vitest";
import {
  generatedRuntimeProfileSaveRequest,
  portOverrideProfileSaveRequest,
} from "./workspaceRuntimeProfileFix";

describe("workspace runtime profile fixes", () => {
  it("keeps generated profiles inherited from project basics", () => {
    expect(
      generatedRuntimeProfileSaveRequest({
        projectKey: "demo",
        plan: {
          kind: "createProfile",
          title: "生成启动档案",
          summary: "",
          confirmLabel: "创建并使用",
          steps: [],
          profileKey: "demo-local",
          profileLabel: "Demo 本地启动",
          expectedPort: 5173,
          fix: {
            kind: "createProfile",
            label: "生成启动档案",
            description: "",
            confirmationRequired: true,
          },
        },
        profileLabel: "",
        debugProfiles: [],
      }),
    ).toEqual({
      projectKey: "demo",
      mode: "create",
      profileKey: "demo-local",
      label: "Demo 本地启动",
      baseProfileKey: null,
      envOverrides: {},
      expectedPort: 5173,
    });
  });

  it("inherits a port override profile from the selected profile", () => {
    expect(
      portOverrideProfileSaveRequest({
        projectKey: "demo",
        projectName: "Demo",
        debugProfileKey: "uat",
        debugProfiles: [{ key: "uat-port-5174" }],
        expectedPort: 5174,
        profileLabel: "UAT alternate",
      }),
    ).toMatchObject({
      profileKey: "uat-port-5174-2",
      label: "UAT alternate",
      baseProfileKey: "uat",
      expectedPort: 5174,
    });
  });
});
