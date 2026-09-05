import { describe, expect, it } from "vitest";

import type { ResourceActionView } from "../app-types";
import {
  appendResourceActionProgressEvent,
  initialResourceActionValues,
  resourceActionActivityParameters,
  resourceActionDryRunState,
  resourceActionRequiresPlan,
  resourceActionRetryValues,
  validateResourceActionValues,
} from "./resourceActions";

const action: ResourceActionView = {
  configPath: "/tmp/actions.toml",
  key: "preview",
  name: "预演部署",
  description: null,
  effect: "remote_write",
  execution: {
    mode: "direct",
    planTtlSeconds: 300,
  },
  runner: {
    kind: "process",
    program: "/bin/zsh",
    args: ["preview.sh"],
    cwd: "/tmp",
    input: "json_stdin",
    output: "structured_json",
    timeoutSeconds: 60,
  },
  params: [
    {
      key: "projects",
      label: "项目",
      kind: "project_multi",
      required: true,
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "beta", label: "Beta" },
      ],
    },
    {
      key: "branchOverride",
      label: "统一分支覆盖",
      kind: "branch",
      required: false,
      options: [],
    },
    {
      key: "token",
      label: "Token",
      kind: "secret",
      required: true,
      options: [],
    },
    {
      key: "dryRun",
      label: "仅预演",
      kind: "boolean",
      defaultValue: true,
      required: false,
      role: "dry_run",
      options: [],
    },
  ],
};

describe("resource action plan/apply", () => {
  it("requires a persisted plan only for non-dry-run plan_apply executions", () => {
    const planApply = {
      ...action,
      execution: { mode: "plan_apply" as const, planTtlSeconds: 300 },
    };
    const values = initialResourceActionValues(planApply);

    expect(resourceActionRequiresPlan(planApply, values)).toBe(false);
    expect(resourceActionRequiresPlan(planApply, { ...values, dryRun: false })).toBe(true);
    expect(resourceActionRequiresPlan(action, { ...values, dryRun: false })).toBe(false);
  });
});

const constrainedAction: ResourceActionView = {
  ...action,
  key: "constrained",
  effect: "read",
  params: [
    {
      key: "port",
      label: "端口",
      kind: "number",
      required: true,
      min: 1,
      max: 65535,
      step: 1,
      options: [],
    },
    {
      key: "label",
      label: "名称",
      kind: "text",
      required: true,
      minLength: 2,
      maxLength: 4,
      options: [],
    },
    {
      key: "targets",
      label: "目标",
      kind: "multi_select",
      required: true,
      minItems: 1,
      maxItems: 2,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
      ],
    },
  ],
};

describe("resource action parameters", () => {
  it("orders, deduplicates, and bounds live progress events", () => {
    const event = (sequence: number, chunk: string) => ({
      operationId: "action-live-test",
      sequence,
      stream: "stderr" as const,
      chunk,
      outputSuppressed: false,
      occurredAt: "2026-08-10T00:00:00Z",
    });
    const ordered = appendResourceActionProgressEvent(
      appendResourceActionProgressEvent([], event(2, "second"), 10),
      event(1, "first"),
      10,
    );

    expect(ordered.map((candidate) => candidate.sequence)).toEqual([2]);
    expect(appendResourceActionProgressEvent(ordered, event(2, "duplicate"), 10)).toBe(ordered);
  });

  it("initializes values by parameter kind", () => {
    expect(initialResourceActionValues(action)).toEqual({
      projects: [],
      branchOverride: "",
      token: "",
      dryRun: true,
    });
  });

  it("validates required and stale option values", () => {
    expect(
      validateResourceActionValues(action, {
        projects: ["removed"],
        branchOverride: "",
        token: "",
        dryRun: true,
      }),
    ).toEqual({
      projects: "部分所选值已不在可用范围内",
      token: "必填",
    });
  });

  it("never persists a secret value in activity parameters", () => {
    expect(
      resourceActionActivityParameters(action, {
        projects: ["alpha"],
        branchOverride: "feature/shared",
        token: "top-secret",
        dryRun: false,
      }),
    ).toEqual([
      { key: "projects", label: "项目", value: "Alpha", masked: false },
      {
        key: "branchOverride",
        label: "统一分支覆盖",
        value: "feature/shared",
        masked: false,
      },
      { key: "token", label: "Token", value: "已提供", masked: true },
      { key: "dryRun", label: "仅预演", value: "否", masked: false },
    ]);
  });

  it("uses an explicit dry-run role instead of a parameter-name convention", () => {
    expect(resourceActionDryRunState(action, initialResourceActionValues(action))).toBe(true);
    expect(
      resourceActionDryRunState(action, {
        ...initialResourceActionValues(action),
        dryRun: false,
      }),
    ).toBe(false);
  });

  it("retries only configured multi-value options", () => {
    const values = initialResourceActionValues(action);
    expect(
      resourceActionRetryValues(action, values, {
        param: "projects",
        values: ["beta"],
      }),
    ).toEqual({ ...values, projects: ["beta"] });
    expect(
      resourceActionRetryValues(action, values, {
        param: "projects",
        values: ["removed"],
      }),
    ).toBeNull();
  });

  it("validates declared number, text, and item constraints", () => {
    expect(
      validateResourceActionValues(constrainedAction, {
        port: 0,
        label: "名称",
        targets: ["a"],
      }),
    ).toMatchObject({ port: "不能小于 {min}" });

    expect(
      validateResourceActionValues(constrainedAction, {
        port: 1.5,
        label: "x",
        targets: ["a", "b", "c"],
      }),
    ).toEqual({
      port: "必须按 {step} 递增",
      label: "至少输入 {count} 个字符",
      targets: "最多选择 {count} 项",
    });
  });
});
