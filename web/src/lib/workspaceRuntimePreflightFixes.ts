import type { ProjectRuntimePreflightFix } from "../app-types";

export type WorkspaceRuntimePreflightFixStep = {
  key: string;
  label: string;
  detail: string;
};

type WorkspaceRuntimePreflightFixPlanBase = {
  title: string;
  summary: string;
  confirmLabel: string;
  steps: WorkspaceRuntimePreflightFixStep[];
  fix: ProjectRuntimePreflightFix;
};

export type WorkspaceRuntimePreflightFixPlan =
  | (WorkspaceRuntimePreflightFixPlanBase & {
      kind: "startProxy";
    })
  | (WorkspaceRuntimePreflightFixPlanBase & {
      kind: "changePort";
      currentPort: number;
      suggestedPort: number;
    })
  | (WorkspaceRuntimePreflightFixPlanBase & {
      kind: "createProfile";
      profileKey: string;
      profileLabel: string;
      expectedPort: number;
    })
  | (WorkspaceRuntimePreflightFixPlanBase & {
      kind: "resetProfile";
    });

export function workspaceRuntimePreflightFixPlan(
  fix: ProjectRuntimePreflightFix | null | undefined,
): WorkspaceRuntimePreflightFixPlan | null {
  if (!fix) {
    return null;
  }
  if (
    fix.kind === "startProxy" &&
    fix.profileId?.trim() &&
    fix.sourceId?.trim()
  ) {
    const profileName = fix.profileName?.trim() || fix.profileId.trim();
    const sourceName = fix.sourceName?.trim() || fix.sourceId.trim();
    const listenUrl = fix.listenUrl?.trim() || "监听地址由代理配置决定";
    return {
      kind: "startProxy",
      title: `启动 ${profileName}`,
      summary:
        fix.description.trim() ||
        "启动已绑定的本地代理，成功后重新检查项目运行条件。",
      confirmLabel: "启动并重新检查",
      steps: [
        {
          key: "source",
          label: "配置来源",
          detail: sourceName,
        },
        {
          key: "proxy",
          label: "代理服务",
          detail: `${profileName} · ${listenUrl}`,
        },
        {
          key: "verify",
          label: "完成后",
          detail: "刷新当前项目的启动预检",
        },
      ],
      fix,
    };
  }
  const currentPort = fix.currentPort ?? 0;
  const suggestedPort = fix.suggestedPort ?? 0;
  if (
    fix.kind !== "changePort" ||
    currentPort < 1 ||
    suggestedPort < 1 ||
    suggestedPort > 65_535
  ) {
    if (
      fix.kind === "createProfile" &&
      fix.profileKey?.trim() &&
      fix.profileLabel?.trim() &&
      fix.command?.trim() &&
      fix.cwd?.trim() &&
      suggestedPort > 0 &&
      suggestedPort <= 65_535
    ) {
      const environment = [
        fix.packageManager?.trim(),
        fix.nodeVersion?.trim() ? `Node ${fix.nodeVersion.trim()}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        kind: "createProfile",
        title: "生成启动档案",
        summary:
          fix.description.trim() ||
          "根据已检测的项目运行信息生成可复用启动档案。",
        confirmLabel: "创建并使用",
        profileKey: fix.profileKey.trim(),
        profileLabel: fix.profileLabel.trim(),
        expectedPort: suggestedPort,
        steps: [
          {
            key: "command",
            label: "项目基础命令",
            detail: fix.command.trim(),
          },
          {
            key: "cwd",
            label: "工作目录",
            detail: fix.cwd.trim(),
          },
          {
            key: "environment",
            label: "检测结果",
            detail: [
              environment,
              `端口 ${suggestedPort}`,
              fix.focusUrl?.trim() || "",
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ],
        fix,
      };
    }
    if (fix.kind === "resetProfile") {
      return {
        kind: "resetProfile",
        title: "恢复项目基础配置",
        summary:
          fix.description.trim() ||
          "清除已失效的工作区启动档案选择，恢复项目基础配置。",
        confirmLabel: "恢复基础配置",
        steps: [
          {
            key: "selection",
            label: "工作区选择",
            detail: "清除已失效的启动档案偏好",
          },
          {
            key: "fallback",
            label: "启动来源",
            detail: "项目基础命令与自动识别端口",
          },
          {
            key: "verify",
            label: "完成后",
            detail: "重新执行当前项目启动预检",
          },
        ],
        fix,
      };
    }
    return null;
  }
  return {
    kind: "changePort",
    title: "换用空闲端口",
    summary:
      fix.description.trim() ||
      `端口 ${currentPort} 已被占用，使用 ${suggestedPort} 启动当前项目。`,
    confirmLabel: `使用 ${suggestedPort} 启动`,
    currentPort,
    suggestedPort,
    steps: [
      {
        key: "occupied",
        label: "当前端口",
        detail: `${currentPort} · 已被占用`,
      },
      {
        key: "override",
        label: "本次启动",
        detail: `${suggestedPort} · Vite strictPort`,
      },
      {
        key: "persist",
        label: "可选保存",
        detail: "沉淀为项目启动档案，供后续工作区复用",
      },
    ],
    fix,
  };
}
