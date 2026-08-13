import { describe, expect, it } from "vitest";

import { translateMessage, type Translate } from "../i18n";
import {
  resolveBuildParameterLabelKey,
  translateBuildDetail,
  translateBuildParameterLabel,
} from "./buildPresentation";

const englishT: Translate = (message, params) =>
  translateMessage("en-US", message, params);

describe("build presentation", () => {
  it("translates application-owned detail labels and preserves runtime values", () => {
    const detail = [
      "打包任务正在运行",
      "PID: 84957",
      "命令: npm run build",
      "目录: /Users/ikiru/Documents/r-series-public/rcodexmanager",
      "产物: /tmp/rCodexManager.dmg",
      "日志: /tmp/rdevtool.log",
    ].join("\n");

    expect(translateBuildDetail(detail, englishT)).toBe(
      [
        "The build task is running",
        "PID: 84957",
        "Command: npm run build",
        "Directory: /Users/ikiru/Documents/r-series-public/rcodexmanager",
        "Output: /tmp/rCodexManager.dmg",
        "Log: /tmp/rdevtool.log",
      ].join("\n"),
    );
  });

  it("uses stable label keys for built-ins and preserves custom labels", () => {
    expect(
      translateBuildParameterLabel(
        {
          key: "channel",
          label: "渠道",
          labelKey: "build.param.channel.label",
        },
        englishT,
      ),
    ).toBe("Channel");
    expect(
      translateBuildParameterLabel(
        { key: "businessChannel", label: "业务渠道" },
        englishT,
      ),
    ).toBe("业务渠道");
  });

  it("recognizes legacy built-in metadata only by key and default label", () => {
    expect(resolveBuildParameterLabelKey("platform", "系统")).toBe(
      "build.param.platform.label",
    );
    expect(resolveBuildParameterLabelKey("platform", "目标系统")).toBeNull();
  });
});
