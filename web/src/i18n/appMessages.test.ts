import { describe, expect, it } from "vitest";

import { translateMessage, type Translate } from "./index";
import { translateAppMessage } from "./appMessages";

const englishT: Translate = (message, params) =>
  translateMessage("en-US", message, params);

describe("translateAppMessage", () => {
  it("renders a stable application message with parameters", () => {
    expect(
      translateAppMessage(
        { key: "health.snapshot.warning", params: { count: 2 } },
        "legacy fallback",
        englishT,
      ),
    ).toBe("Found 2 issue(s) that need attention");
  });

  it("uses the legacy translator for older backends", () => {
    expect(
      translateAppMessage(
        undefined,
        "rDevTool 核心存储与当前可执行文件状态正常",
        englishT,
      ),
    ).toBe("rDevTool core storage and the current executable are healthy");
  });

  it("preserves the fallback when a newer key is unknown", () => {
    expect(
      translateAppMessage(
        { key: "health.future.message" },
        "raw backend detail",
        englishT,
      ),
    ).toBe("raw backend detail");
  });

  it("keeps proxy rule names as parameters", () => {
    expect(
      translateAppMessage(
        {
          key: "proxy.diagnosis.summary.matched_not_listening",
          params: { name: "API Rule" },
        },
        "legacy fallback",
        englishT,
      ),
    ).toBe(
      "The request will match rule API Rule, but the proxy port is not listening",
    );
  });

  it("renders runtime preflight counts from stable parameters", () => {
    expect(
      translateAppMessage(
        {
          key: "runtime.preflight.summary.errors",
          params: { errors: 2, warnings: 1 },
        },
        "legacy fallback",
        englishT,
      ),
    ).toBe("2 errors · 1 items need attention");
    expect(
      translateAppMessage(
        { key: "runtime.preflight.check.title.dev_port" },
        "预期端口",
        englishT,
      ),
    ).toBe("Expected Port");
  });

  it("renders runtime preflight details without translating dynamic values", () => {
    expect(
      translateAppMessage(
        {
          key: "runtime.preflight.detail.dev_port.occupied_by",
          params: { port: 5173, owner: "node (PID 42)" },
        },
        "legacy fallback",
        englishT,
      ),
    ).toBe("Port 5173 is in use by node (PID 42)");
  });
});
