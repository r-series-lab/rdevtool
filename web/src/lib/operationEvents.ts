import type {
  BranchTaskReplayCommand,
  BranchTaskReplayRequest,
  BranchTaskResponse,
  BranchWorkflowMode,
  BuildHistoryEntry,
  OperationEventEntry,
} from "../app-types";
import {
  createActivityEntry,
  type ActivityBuildReplayRequest,
  type ActivityDiagnosticStep,
} from "./activityCenter";
import {
  branchTaskDiagnosticSteps,
  branchTaskDisplayDetail,
  branchTaskFailureReplay,
} from "./branchTaskDetails";

const BRANCH_ACTIONS = new Set<BranchWorkflowMode>([
  "sync",
  "create",
  "checkout",
  "switch",
  "push",
]);

const BRANCH_REPLAY_COMMANDS = new Set<BranchTaskReplayCommand>([
  "execute_branch_sync_task",
  "execute_branch_create_task",
  "checkout_branch_to_directory_task",
  "execute_branch_switch_task",
  "execute_branch_push_task",
]);

export function isOperationEventEntry(value: unknown): value is OperationEventEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<OperationEventEntry>;
  return (
    candidate.version === 1 &&
    typeof candidate.id === "string" &&
    (candidate.origin === "app" ||
      candidate.origin === "cli" ||
      candidate.origin === "tray") &&
    typeof candidate.workspaceKey === "string" &&
    typeof candidate.domain === "string" &&
    typeof candidate.action === "string" &&
    (candidate.state === "running" ||
      candidate.state === "success" ||
      candidate.state === "failed" ||
      candidate.state === "info") &&
    typeof candidate.title === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.detail === "string" &&
    Array.isArray(candidate.relatedHistoryKeys) &&
    candidate.relatedHistoryKeys.every((key) => typeof key === "string") &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function linkDiagnosticSteps(value: unknown): ActivityDiagnosticStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const candidate = objectValue(item);
    if (!candidate) {
      return [];
    }
    const id = optionalString(candidate.id)?.trim() || "";
    const type = optionalString(candidate.type)?.trim() || "";
    const label = optionalString(candidate.label)?.trim() || "";
    const status = optionalString(candidate.status)?.trim() || "failed";
    const summary = optionalString(candidate.summary)?.trim() || "";
    if (!id || !type || !label || !summary) {
      return [];
    }
    return [{ id, type, label, status, summary, risks: stringList(candidate.risks) }];
  });
}

function buildParams(value: unknown): Record<string, string> {
  const object = objectValue(value);
  if (!object) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(object)
      .filter((entry) =>
        ["string", "number", "boolean"].includes(typeof entry[1]),
      )
      .map(([key, entryValue]) => [key, String(entryValue)]),
  );
}

function stringRecord(value: unknown): Record<string, string> | null {
  const object = objectValue(value);
  if (!object) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(object).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function buildHistoryFromOperationEvent(
  event: OperationEventEntry,
): BuildHistoryEntry | null {
  if (event.domain !== "build") {
    return null;
  }
  const payload = objectValue(event.payload);
  if (!payload) {
    return null;
  }
  const projectKey =
    optionalString(payload.projectKey)?.trim() || event.projectKey?.trim() || "";
  if (!projectKey) {
    return null;
  }
  const stateKey = optionalString(payload.stateKey)?.trim() || event.state;
  const stateLabel =
    optionalString(payload.stateLabel)?.trim() ||
    ({
      running: "进行中",
      success: "成功",
      failed: "失败",
      info: "状态已更新",
    } as const)[event.state];
  return {
    historyKey:
      optionalString(payload.historyKey)?.trim() ||
      event.relatedHistoryKeys[0] ||
      event.id,
    workspaceKey:
      optionalString(payload.workspaceKey)?.trim() || event.workspaceKey,
    projectInstancePath: optionalString(payload.projectInstancePath),
    projectKey,
    projectName:
      optionalString(payload.projectName)?.trim() ||
      event.projectName?.trim() ||
      projectKey,
    mode: optionalString(payload.mode)?.trim() || event.action,
    env: optionalString(payload.env) || "",
    branch: optionalString(payload.branch) || "",
    stateKey,
    stateLabel,
    detail: optionalString(payload.detail) || event.detail,
    queueUrl: optionalString(payload.queueUrl),
    buildUrl: optionalString(payload.buildUrl),
    params: buildParams(payload.params),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function buildReplayRequestFromOperationEvent(
  event: OperationEventEntry,
): ActivityBuildReplayRequest | null {
  if (event.domain !== "build") {
    return null;
  }
  const payload = objectValue(event.payload);
  const replay = objectValue(payload?.replayRequest);
  if (!replay) {
    return null;
  }
  const project = optionalString(replay.project)?.trim() || "";
  const target = optionalString(replay.target)?.trim() || null;
  if (!project || !target) {
    return null;
  }
  const extraParams = stringRecord(replay.extraParams);
  return {
    project,
    target,
    ...(typeof replay.variant === "boolean" ? { variant: replay.variant } : {}),
    ...(typeof replay.env === "string" ? { env: replay.env } : {}),
    ...(typeof replay.branch === "string" ? { branch: replay.branch } : {}),
    ...(extraParams ? { extraParams } : {}),
    params: stringRecord(replay.params) ?? {},
  };
}

function branchResponseFromEvent(event: OperationEventEntry) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return null;
  }
  const payload = event.payload as Partial<BranchTaskResponse>;
  if (
    !BRANCH_ACTIONS.has(payload.taskKind as BranchWorkflowMode) ||
    typeof payload.success !== "boolean" ||
    typeof payload.summary !== "string" ||
    typeof payload.detail !== "string" ||
    !Array.isArray(payload.items)
  ) {
    return null;
  }
  return payload as BranchTaskResponse;
}

function branchModeFromEvent(event: OperationEventEntry): BranchWorkflowMode {
  return BRANCH_ACTIONS.has(event.action as BranchWorkflowMode)
    ? (event.action as BranchWorkflowMode)
    : "sync";
}

function branchReplayFromEvent(
  event: OperationEventEntry,
): BranchTaskReplayRequest | null {
  const payload = objectValue(event.payload);
  const replay = objectValue(payload?.replay);
  const command = optionalString(replay?.command) as BranchTaskReplayCommand | null;
  const busyText = optionalString(replay?.busyText)?.trim() || "";
  const request = objectValue(replay?.request);
  if (!command || !BRANCH_REPLAY_COMMANDS.has(command) || !busyText || !request) {
    return null;
  }
  return {
    command,
    busyText,
    request: { ...request },
    refreshPushStatusProject:
      optionalString(replay?.refreshPushStatusProject)?.trim() || null,
    clearPushCommitMessageOnSuccess:
      replay?.clearPushCommitMessageOnSuccess === true,
  };
}

export function activityFromOperationEvent(event: OperationEventEntry) {
  const response = branchResponseFromEvent(event);
  const requestedReplay = branchReplayFromEvent(event);
  const replay = response && requestedReplay
    ? branchTaskFailureReplay(response, requestedReplay)
    : requestedReplay;
  const project = response?.items[0];
  return createActivityEntry({
    id: event.id,
    kind: "branch",
    origin: event.origin,
    status: event.state,
    title: event.title,
    summary: event.summary,
    detail: response ? branchTaskDisplayDetail(response) : event.detail,
    executionKey: `operation:${event.id}`,
    projectKey: project?.projectKey || event.projectKey || null,
    projectName: project?.projectName || event.projectName || null,
    diagnostics: response ? branchTaskDiagnosticSteps(response) : [],
    warnings: event.state === "failed" && requestedReplay && !replay
      ? ["当前批次包含同一项目的部分成功结果，请打开 Git 页面核对后按剩余目标执行。"]
      : [],
    action: event.state === "failed" && replay
      ? {
          kind: "branchReplay",
          label: "检查并重试 Git 操作",
          replay,
        }
      : null,
    target: {
      page: "merge",
      projectKey: project?.projectKey || event.projectKey || null,
      branchMode: branchModeFromEvent(event),
    },
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  });
}

export function activityFromLifecycleOperationEvent(
  event: OperationEventEntry,
) {
  const payload = objectValue(event.payload);
  if (event.domain === "runtime") {
    const projectKey =
      event.projectKey?.trim() || optionalString(payload?.projectKey)?.trim() || null;
    const projectName =
      event.projectName?.trim() || optionalString(payload?.name)?.trim() || projectKey;
    const logPath = optionalString(payload?.logPath)?.trim() || "";
    const debugProfileKey = optionalString(payload?.debugProfile)?.trim() || null;
    const envOverrides = stringRecord(payload?.envOverrides);
    const unsupportedReplayOverrides = [
      optionalString(payload?.requestedRuntimeProfile)?.trim() || "",
      optionalString(payload?.requestedCommand)?.trim() || "",
      payload?.requestedExpectedPort == null
        ? ""
        : String(payload.requestedExpectedPort).trim(),
    ].filter(Boolean);
    const replayAction = event.action === "stop" ? "stop" : "start";
    const recoverable =
      event.state === "failed" &&
      Boolean(projectKey) &&
      (event.action === "start" || event.action === "stop");
    return createActivityEntry({
      id: event.id,
      kind: "runtime",
      origin: event.origin,
      status: event.state,
      title: event.title,
      summary: event.summary,
      detail: event.detail || null,
      executionKey: `runtime:${event.action}:${projectKey || event.id}`,
      projectKey,
      projectName,
      diagnostics: event.state === "failed"
        ? [{
            id: `runtime:${event.action}:${projectKey || event.id}`,
            type: `runtime.${event.action}`,
            label: event.title,
            status: "failed",
            summary: event.summary,
            risks: event.detail.trim() ? [event.detail.trim()] : [],
          }]
        : [],
      target: {
        page: "projectManagement",
        projectKey,
      },
      resource: logPath
        ? {
            kind: "localPath",
            label: "打开日志",
            value: logPath,
          }
        : null,
      warnings: recoverable && unsupportedReplayOverrides.length
        ? ["本次使用了 App 暂不支持恢复的 CLI 启动覆盖，请在 CLI 按原参数重试。"]
        : [],
      action: recoverable && unsupportedReplayOverrides.length === 0
        ? {
            kind: "runtimeRecover",
            label: replayAction === "stop" ? "检查并重新停止" : "检查并重新启动",
            projectKey: projectKey!,
            projectName: projectName || projectKey!,
            debugProfileKey,
            envOverrides,
            replayAction,
          }
        : null,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    });
  }
  if (event.domain === "proxy") {
    const profileId = optionalString(payload?.profileId)?.trim() || "default";
    const profileName = optionalString(payload?.profileName)?.trim() || profileId;
    const sourceId = optionalString(payload?.sourceId)?.trim() || null;
    const replayAction = event.action === "stop" ? "stop" : "start";
    return createActivityEntry({
      id: event.id,
      kind: "proxy",
      origin: event.origin,
      status: event.state,
      title: event.title,
      summary: event.summary,
      detail: event.detail || optionalString(payload?.listenUrl) || null,
      executionKey: `proxy:${event.action}:${profileId}`,
      parameters: [{ key: "profile", label: "代理", value: profileName }],
      diagnostics: event.state === "failed"
        ? [{
            id: `proxy:${event.action}:${profileId}`,
            type: `proxy.${event.action}`,
            label: event.title,
            status: "failed",
            summary: event.summary,
            risks: event.detail.trim() ? [event.detail.trim()] : [],
          }]
        : [],
      target: { page: "proxy" },
      action: event.state === "failed" && (event.action === "start" || event.action === "stop")
        ? {
            kind: "proxyRecover",
            label: replayAction === "stop" ? "检查并重新停止" : "检查并重新启动",
            profileId,
            profileName,
            sourceId,
            replayAction,
          }
        : null,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    });
  }
  if (event.domain === "link") {
    const linkKey = optionalString(payload?.linkKey)?.trim() || event.id;
    const linkName = optionalString(payload?.linkName)?.trim() || linkKey;
    const sourceId = optionalString(payload?.sourceId)?.trim() || null;
    const diagnostics = linkDiagnosticSteps(
      payload?.diagnosticSteps ?? payload?.failedSteps,
    );
    const warnings = stringList(payload?.warnings);
    const replayAction = event.action === "stop" ? "stop" : "run";
    return createActivityEntry({
      id: event.id,
      kind: "link",
      origin: event.origin,
      status: event.state,
      title: event.title,
      summary: event.summary,
      detail: event.detail || null,
      executionKey: `link:${event.action}:${linkKey}`,
      projectKey: event.projectKey ?? null,
      projectName: event.projectName ?? null,
      parameters: [
        { key: "link", label: "链路", value: linkName },
        { key: "mode", label: "动作", value: replayAction === "stop" ? "停止" : "启动" },
      ],
      diagnostics,
      warnings,
      target: { page: "overview", projectKey: event.projectKey ?? null },
      action: event.state === "failed"
        ? {
            kind: "linkRecover",
            label: replayAction === "stop" ? "检查并重新停止" : "检查并重新启动",
            linkKey,
            linkName,
            sourceId,
            replayAction,
          }
        : null,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    });
  }
  return null;
}
