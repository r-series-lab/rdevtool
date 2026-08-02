import { describe, expect, it } from "vitest";
import { translateInternalMessage } from "./internalMessages";
import { translateMessage, type Translate } from "./index";

const englishT: Translate = (message, params) =>
  translateMessage("en-US", message, params);

describe("translateInternalMessage", () => {
  it("translates known build history text while preserving run data", () => {
    expect(
      translateInternalMessage(
        "构建成功 · 构建 #2113 当前结果： SUCCESS",
        englishT,
      ),
    ).toBe("Build succeeded · Build #2113 current result: SUCCESS");
  });

  it("translates known branch status labels inside generated detail lines", () => {
    expect(
      translateInternalMessage(
        "rDevTool: main -> origin/main [已提交并推送]",
        englishT,
      ),
    ).toBe("rDevTool: main -> origin/main [Committed and pushed]");
  });

  it("leaves user data and config values unchanged", () => {
    expect(translateInternalMessage("pre", englishT)).toBe("pre");
    expect(translateInternalMessage("release_2026", englishT)).toBe(
      "release_2026",
    );
  });

  it("translates generated Link activity text while preserving names", () => {
    expect(
      translateInternalMessage(
        "合作渠道联调 · 完成 0 / 失败 1 / 跳过 1",
        englishT,
      ),
    ).toBe("合作渠道联调 · 0 completed / 1 failed / 1 skipped");
    expect(
      translateInternalMessage("合作渠道联调 · 1 个步骤阻止重试", englishT),
    ).toBe("合作渠道联调 · 1 steps blocked retry");
  });

  it("translates toast error patterns while preserving the reason", () => {
    expect(
      translateInternalMessage("监听托盘操作失败：permission denied", englishT),
    ).toBe("Failed to listen for tray actions: permission denied");
  });
});
