import { describe, expect, it } from "vitest";

import { translateMessage, type Translate } from "../i18n";
import { translateConfirmNode } from "./AppConfirmDialog";

const englishT: Translate = (message, params) =>
  translateMessage("en-US", message, params);

describe("translateConfirmNode", () => {
  it("translates generated action labels used by confirmation dialogs", () => {
    expect(
      translateConfirmNode("分支：提交推送 / rDevTool", englishT),
    ).toBe("Branch: Commit and Push / rDevTool");
  });

  it("preserves user-defined labels", () => {
    expect(translateConfirmNode("Release Candidate A", englishT)).toBe(
      "Release Candidate A",
    );
  });
});
