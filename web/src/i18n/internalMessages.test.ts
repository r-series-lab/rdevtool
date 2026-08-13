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

  it("translates generated pinned action labels while preserving configured names", () => {
    expect(
      translateInternalMessage("分支：提交推送 / 示例控制台", englishT),
    ).toBe("Branch: Commit and Push / 示例控制台");
    expect(
      translateInternalMessage("分支：合并分支 / 示例控制台", englishT),
    ).toBe("Branch: Merge Branches / 示例控制台");
    expect(
      translateInternalMessage("部署：示例控制台 / VKE", englishT),
    ).toBe("Deploy: 示例控制台 / VKE");
    expect(translateInternalMessage("工作区联动", englishT)).toBe(
      "Workspace Workflow",
    );
  });

  it("translates configuration change activity while preserving source names", () => {
    expect(
      translateInternalMessage("配置源“R系列 配置”已变更", englishT),
    ).toBe('Configuration source "R系列 配置" changed');
    expect(
      translateInternalMessage("检测到配置源文件发生外部修改", englishT),
    ).toBe("External changes to configuration source files were detected");
    expect(translateInternalMessage("比较配置源", englishT)).toBe(
      "Compare Configuration Source",
    );
  });

  it("translates workspace configuration change activity", () => {
    expect(translateInternalMessage("工作区配置已变更", englishT)).toBe(
      "Workspace configuration changed",
    );
    expect(
      translateInternalMessage(
        "检测到外部修改，请重新加载最新配置",
        englishT,
      ),
    ).toBe("External changes detected. Reload the latest configuration.");
    expect(translateInternalMessage("重新加载", englishT)).toBe("Reload");
    expect(
      translateInternalMessage("影响：工作区、项目、项目工作区", englishT),
    ).toBe("Affected: Workspace, Projects, Project Workspaces");
  });

  it("translates Git result markers while preserving project and branch names", () => {
    expect(
      translateInternalMessage(
        "消息中心: pre -> master [合并失败]",
        englishT,
      ),
    ).toBe("消息中心: pre -> master [Merge failed]");
  });

  it("translates structured merge conflict details while preserving MR data", () => {
    expect(
      translateInternalMessage(
        "示例渠道: feature_demo_mobile -> env_demo_uat [存在合并冲突]\n" +
          "原因：分支存在合并冲突，请先处理冲突后重试。\n" +
          "GitLab 状态：cannot_be_merged\n" +
          "MR：!403\n" +
          "链接：http://gitlab.example.test/project/-/merge_requests/403\n" +
          "建议：先解决 feature_demo_mobile -> env_demo_uat 的合并冲突后重试。",
        englishT,
      ),
    ).toBe(
      "示例渠道: feature_demo_mobile -> env_demo_uat [Merge conflicts detected]\n" +
        "Reason: The branches have merge conflicts. Resolve them before retrying.\n" +
        "GitLab status: cannot_be_merged\n" +
        "MR: !403\n" +
        "Link: http://gitlab.example.test/project/-/merge_requests/403\n" +
        "Suggestion: Resolve the merge conflicts from feature_demo_mobile into env_demo_uat, then retry.",
    );
  });

  it("translates generated Link summary segments while preserving configured values", () => {
    expect(
      translateInternalMessage(
        "3 步 · 未启动 · 项目 demo-console · 代理 REQ-1234 权益兑换 Mock",
        englishT,
      ),
    ).toBe(
      "3 steps · Not Started · Project demo-console · Proxy REQ-1234 权益兑换 Mock",
    );
  });

  it("falls back to the translation dictionary for known generated text", () => {
    expect(
      translateInternalMessage(
        "rDevTool 核心存储与当前可执行文件状态正常",
        englishT,
      ),
    ).toBe("rDevTool core storage and the current executable are healthy");
    expect(
      translateInternalMessage("发现 2 个需要关注的问题", englishT),
    ).toBe("Found 2 issue(s) that need attention");
    expect(
      translateInternalMessage("请求会命中规则 Mock API", englishT),
    ).toBe("The request will match rule Mock API");
  });

  it("translates generated Link activity text while preserving names", () => {
    expect(
      translateInternalMessage(
        "示例联调 · 完成 0 / 失败 1 / 跳过 1",
        englishT,
      ),
    ).toBe("示例联调 · 0 completed / 1 failed / 1 skipped");
    expect(
      translateInternalMessage("示例联调 · 1 个步骤阻止重试", englishT),
    ).toBe("示例联调 · 1 steps blocked retry");
  });

  it("translates toast error patterns while preserving the reason", () => {
    expect(
      translateInternalMessage("监听托盘操作失败：permission denied", englishT),
    ).toBe("Failed to listen for tray actions: permission denied");
  });
});
