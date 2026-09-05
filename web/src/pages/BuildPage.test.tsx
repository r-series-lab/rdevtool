import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildHistoryEntry } from "../app-types";
import type { BuildParamMeta } from "../hooks/useBuildContext";
import {
  BuildHistoryRecordDetail,
  BuildHistoryRunTimeline,
  BuildPlanCommitSummary,
  buildHistoryParamEntries,
} from "./BuildPage";

const translate = (message: string, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    message,
  );

describe("BuildPlanCommitSummary", () => {
  it("keeps the commit subject and timestamp visible in the plan summary", () => {
    const html = renderToStaticMarkup(
      <BuildPlanCommitSummary
        commit={{
          shortHash: "2e76c2f02f",
          subject: "fix: 统一备注溢出显示行为",
          committedAt: "2026-08-10 11:42:06 +0800",
        }}
        changedPathCount={4}
        projectName="示例控制台"
        targetLabel="标准"
        branch="feature/demo"
      />,
    );

    expect(html).toContain("计划：");
    expect(html).toContain("示例控制台 / 标准");
    expect(html).toContain("分支 feature/demo");
    expect(html).toContain("fix: 统一备注溢出显示行为");
    expect(html).toContain("提交于 2026-08-10 11:42:06 +0800");
    expect(html).toContain(
      "fix: 统一备注溢出显示行为 · 提交于 2026-08-10 11:42:06 +0800",
    );
    expect(html).toContain("检测到 4 个改动文件");
    expect(html).toContain('data-build-plan-primary="visible"');
    expect(html).toContain('data-build-plan-revision="visible"');
    expect(html).not.toContain('title="fix: 统一备注溢出显示行为"');
  });
});

describe("Build history parameter presentation", () => {
  it("skips branch context, detects overrides, and masks sensitive values", () => {
    const item = {
      historyKey: "build-history-1",
      projectKey: "marketing",
      projectName: "示例控制台",
      mode: "standard",
      env: "pre",
      branch: "feature/demo",
      stateKey: "success",
      stateLabel: "构建成功",
      detail: "构建完成",
      params: {
        ENV_PROFILE: "pre",
        BRANCH: "feature/demo",
        IS_BUILD_MOBILE: "是",
        CACHE_MODE: "incremental",
        JENKINS_TOKEN: "secret-value",
      },
      createdAt: "2026-08-10 09:00",
      updatedAt: "2026-08-10 09:04",
    } satisfies BuildHistoryEntry;
    const booleanParam = {
      key: "IS_BUILD_MOBILE",
      label: "移动端",
      kind: "boolean",
      defaultValue: "否",
      configuredDefault: "否",
      defaultSource: "projectDefault",
      options: [],
      required: false,
      trueValue: "是",
      falseValue: "否",
    } satisfies BuildParamMeta;

    const entries = buildHistoryParamEntries(
      item,
      new Map([[booleanParam.key, booleanParam]]),
      {
        IS_BUILD_MOBILE: "否",
        CACHE_MODE: "incremental",
        JENKINS_TOKEN: "",
      },
      translate,
    );

    expect(entries.map((entry) => entry.key)).toEqual([
      "IS_BUILD_MOBILE",
      "CACHE_MODE",
      "JENKINS_TOKEN",
    ]);
    expect(entries[0]).toMatchObject({
      label: "移动端",
      valueLabel: "是",
      defaultValueLabel: "否",
      changed: true,
    });
    expect(entries[1].changed).toBe(false);
    expect(entries[2]).toMatchObject({
      valueLabel: "已配置",
      defaultValueLabel: "未配置",
      hidden: true,
      changed: true,
    });
    expect(JSON.stringify(entries)).not.toContain("secret-value");
  });

  it("shows override summaries without a plus-count placeholder", () => {
    const html = renderToStaticMarkup(
      <BuildHistoryRecordDetail
        detail="GitLab rejected this operation (HTTP 403)."
        danger
        paramEntries={[
          {
            key: "IS_BUILD_MOBILE",
            label: "移动端",
            valueLabel: "是",
            defaultValueLabel: "否",
            hidden: false,
            changed: true,
            defaultKnown: true,
          },
          {
            key: "IS_GRAY",
            label: "灰度",
            valueLabel: "否",
            defaultValueLabel: "是",
            hidden: false,
            changed: true,
            defaultKnown: true,
          },
          {
            key: "CHANNEL",
            label: "渠道",
            valueLabel: "pre",
            defaultValueLabel: "uat",
            hidden: false,
            changed: true,
            defaultKnown: true,
          },
          {
            key: "CACHE_MODE",
            label: "缓存模式",
            valueLabel: "full",
            defaultValueLabel: "incremental",
            hidden: false,
            changed: true,
            defaultKnown: true,
          },
        ]}
      />,
    );

    expect(html).toContain("参数变更 4 项");
    expect(html).toContain("还有 1 项变更");
    expect(html).toContain("展开详情");
    expect(html).toContain("is-danger");
    expect(html).not.toContain(">+1<");
  });
});

describe("Build history run timeline", () => {
  it("separates attempts, states, details, and timestamps", () => {
    const makeEntry = (
      historyKey: string,
      stateKey: string,
      stateLabel: string,
      detail: string,
      updatedAt: string,
    ): BuildHistoryEntry => ({
      historyKey,
      projectKey: "marketing",
      projectName: "示例控制台",
      mode: "standard",
      env: "pre",
      branch: "master",
      stateKey,
      stateLabel,
      detail,
      createdAt: updatedAt,
      updatedAt,
    });
    const html = renderToStaticMarkup(
      <BuildHistoryRunTimeline
        items={[
          makeEntry("latest", "success", "构建成功", "Build #3", "14:30"),
          makeEntry("second", "failed", "构建失败", "Build #2", "14:20"),
        ]}
        formatRelativeTime={(value) => value ?? ""}
      />,
    );

    expect(html).toContain("build-history-run-row is-success");
    expect(html).toContain("build-history-run-row is-danger");
    expect(html).toContain("最新");
    expect(html).toContain("第 2 次");
    expect(html).toContain("Build #3");
    expect(html).toContain("14:20");
  });
});
