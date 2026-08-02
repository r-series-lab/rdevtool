import { describe, expect, it } from "vitest";
import { createActivityEntry } from "../lib/activityCenter";
import {
  activityQueueStateLabel,
  buildActivityQueueGroups,
} from "./activityCenterQueue";

describe("activity attention queue", () => {
  it("groups all configuration reload notices into one safe batch", () => {
    const items = (["workspace", "projects", "projectWorkspaces"] as const).map(
      (scope) =>
        createActivityEntry({
          id: `config:${scope}`,
          kind: "config",
          status: "running",
          title: "配置已变更",
          summary: "检测到外部修改",
          action: {
            kind: "reloadConfig",
            label: "重新加载",
            scope,
          },
        }),
    );

    const groups = buildActivityQueueGroups(items);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "config:reload",
      label: "配置更新",
      actionCount: 3,
      total: 3,
    });
    expect(activityQueueStateLabel(groups[0])).toBe("需重新加载 3");
  });

  it("keeps side-effecting recovery actions in separate execution groups", () => {
    const groups = buildActivityQueueGroups([
      createActivityEntry({
        id: "build-a",
        kind: "build",
        status: "failed",
        title: "构建失败",
        summary: "分支不存在",
        executionKey: "build:a",
        action: {
          kind: "buildRecover",
          label: "重新规划并重试",
          projectKey: "a",
          projectName: "A",
          request: {
            project: "a",
            target: "vke",
            params: {},
          },
        },
      }),
      createActivityEntry({
        id: "build-b",
        kind: "build",
        status: "failed",
        title: "构建失败",
        summary: "环境无效",
        executionKey: "build:b",
        action: {
          kind: "buildRecover",
          label: "重新规划并重试",
          projectKey: "b",
          projectName: "B",
          request: {
            project: "b",
            target: "vke",
            params: {},
          },
        },
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => activityQueueStateLabel(group) === "可重试"))
      .toBe(true);
  });
});
