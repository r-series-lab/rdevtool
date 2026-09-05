import { describe, expect, it } from "vitest";
import { createActivityEntry } from "./activityCenter";
import {
  activityCanBeCleared,
  resolveActivityEntries,
} from "./activityResolution";

describe("activity resolution", () => {
  it("dismisses actionable config changes into handled records", () => {
    const entry = createActivityEntry({
      id: "config-change",
      kind: "config",
      status: "running",
      title: "配置已变更",
      summary: "检测到外部修改",
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: "workspace",
      },
    });

    const [resolved] = resolveActivityEntries(
      [entry],
      [entry.id],
      "2026-07-27T08:00:00.000Z",
    );

    expect(resolved).toMatchObject({
      status: "info",
      action: null,
      acknowledgedAt: "2026-07-27T08:00:00.000Z",
      updatedAt: "2026-07-27T08:00:00.000Z",
    });
    expect(activityCanBeCleared(resolved)).toBe(true);
  });

  it("keeps pending and running activities out of handled cleanup", () => {
    const pending = createActivityEntry({
      id: "failed",
      kind: "build",
      status: "failed",
      title: "构建失败",
      summary: "失败",
    });
    const running = createActivityEntry({
      id: "running",
      kind: "build",
      status: "running",
      title: "构建中",
      summary: "运行中",
    });

    expect(activityCanBeCleared(pending)).toBe(false);
    expect(activityCanBeCleared(running)).toBe(false);
    expect(activityCanBeCleared(
      resolveActivityEntries(
        [pending],
        [pending.id],
        "2026-07-27T08:00:00.000Z",
      )[0],
    )).toBe(true);
  });
});
