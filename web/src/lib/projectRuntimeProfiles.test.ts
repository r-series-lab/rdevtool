import { describe, expect, it } from "vitest";
import { uniqueProjectLaunchProfileKey } from "./projectRuntimeProfiles";

describe("uniqueProjectLaunchProfileKey", () => {
  it("builds stable keys and skips existing profiles", () => {
    expect(
      uniqueProjectLaunchProfileKey(
        [{ key: "uat-port-5174" }, { key: "uat-port-5174-2" }],
        "uat",
        "port-5174",
      ),
    ).toBe("uat-port-5174-3");
  });

  it("normalizes user-facing profile parts", () => {
    expect(uniqueProjectLaunchProfileKey([], "UAT 3 / VKE")).toBe(
      "UAT-3-VKE-custom",
    );
  });
});
