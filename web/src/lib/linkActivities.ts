import type { LinkExecutionReport } from "../app-types";
import type {
  ActivityAction,
  ActivityDiagnosticStep,
  ActivityDraft,
  ActivityPatch,
} from "./activityCenter";

export type LinkActivityAction = "run" | "stop";

function linkActionLabel(action: LinkActivityAction) {
  return action === "stop" ? "停止" : "启动";
}

function linkActivityParameters(linkName: string, action: LinkActivityAction) {
  return [
    { key: "link", label: "链路", value: linkName },
    { key: "mode", label: "动作", value: linkActionLabel(action) },
  ];
}

const LINK_HARD_FAILURE_STATUSES = new Set(["blocked", "failed"]);

export function linkExecutionStepBlocks(
  step: LinkExecutionReport["steps"][number],
) {
  return (
    LINK_HARD_FAILURE_STATUSES.has(step.status) ||
    (step.status === "skipped" && step.risks.length > 0)
  );
}

function linkBlockingSteps(report: LinkExecutionReport) {
  return report.steps.filter(linkExecutionStepBlocks);
}

export function linkDiagnosticsFromReport(
  report: LinkExecutionReport,
): ActivityDiagnosticStep[] {
  return report.steps.map((step) => ({
    id: step.id,
    type: step.type,
    label: step.label,
    status: step.status,
    summary: step.summary,
    risks: step.risks,
  }));
}

export function linkCheckPassed(report: LinkExecutionReport) {
  return report.steps.length > 0 && linkBlockingSteps(report).length === 0;
}

export function linkCheckFailureReason(report: LinkExecutionReport) {
  const blocking = linkBlockingSteps(report)[0];
  return blocking?.risks[0] || blocking?.summary || report.warnings[0] || "联调链路检查未通过";
}

export function linkRecoveryAction(
  linkKey: string,
  linkName: string,
  action: LinkActivityAction,
  sourceId?: string | null,
  workspaceKey?: string | null,
  proxySourceId?: string | null,
  runtimeSourceId?: string | null,
): ActivityAction {
  return {
    kind: "linkRecover",
    label: action === "stop" ? "检查并重新停止" : "检查并重新启动",
    linkKey,
    linkName: linkName.trim() || linkKey,
    sourceId: sourceId?.trim() || null,
    proxySourceId: proxySourceId?.trim() || null,
    runtimeSourceId: runtimeSourceId?.trim() || null,
    workspaceKey: workspaceKey?.trim() || null,
    replayAction: action,
  };
}

export function linkActivityDraft(
  linkKey: string,
  linkName: string,
  action: LinkActivityAction,
  _sourceId?: string | null,
): ActivityDraft {
  const name = linkName.trim() || linkKey;
  const actionLabel = linkActionLabel(action);
  return {
    kind: "link",
    origin: "app",
    status: "running",
    title: `${actionLabel}联调链路`,
    summary: `${name} · 正在${actionLabel}`,
    executionKey: `link:${action}:${linkKey}`,
    parameters: linkActivityParameters(name, action),
    target: { page: "overview" },
  };
}

export function linkActivityResultPatch(
  report: LinkExecutionReport,
  action: LinkActivityAction,
  sourceId?: string | null,
  workspaceKey?: string | null,
  proxySourceId?: string | null,
  runtimeSourceId?: string | null,
): ActivityPatch {
  const failedSteps = report.steps.filter(
    (step) => LINK_HARD_FAILURE_STATUSES.has(step.status),
  );
  const blockingSteps = report.steps.filter(linkExecutionStepBlocks);
  const skippedCount = report.steps.filter((step) => step.status === "skipped").length;
  const completedCount = Math.max(0, report.steps.length - failedSteps.length - skippedCount);
  const actionLabel = linkActionLabel(action);
  const detailLines = [
    ...blockingSteps.map((step) => `${step.label}：${step.summary}`),
    ...report.warnings.map((warning) => `警告：${warning}`),
  ];
  const sourceContext = report.plan.sourceContext;
  const resolvedSourceId = sourceContext?.linkSourceId || sourceId;
  const resolvedProxySourceId = sourceContext?.proxySourceId || proxySourceId;
  const resolvedRuntimeSourceId = sourceContext?.runtimeSourceId || runtimeSourceId;
  return {
    status: blockingSteps.length > 0 ? "failed" : report.steps.length > 0 ? "success" : "info",
    title: `${actionLabel}联调链路`,
    summary: `${report.name} · 完成 ${completedCount} / 失败 ${failedSteps.length} / 跳过 ${skippedCount}`,
    detail: detailLines.length > 0 ? detailLines.join("\n") : `联调链路已${actionLabel}`,
    projectKey: report.plan.project ?? null,
    parameters: linkActivityParameters(report.name || report.key, action),
    diagnostics: linkDiagnosticsFromReport(report),
    warnings: report.warnings,
    target: { page: "overview", projectKey: report.plan.project ?? null },
    action: blockingSteps.length > 0
      ? linkRecoveryAction(
          report.key,
          report.name,
          action,
          resolvedSourceId,
          workspaceKey || report.plan.workspaceKey,
          resolvedProxySourceId,
          resolvedRuntimeSourceId,
        )
      : null,
  };
}

export function linkActivityFailurePatch(
  linkKey: string,
  linkName: string,
  action: LinkActivityAction,
  sourceId: string | null | undefined,
  reason: unknown,
  workspaceKey?: string | null,
  proxySourceId?: string | null,
  runtimeSourceId?: string | null,
): ActivityPatch {
  const actionLabel = linkActionLabel(action);
  return {
    status: "failed",
    title: `${actionLabel}联调链路`,
    summary: `${linkName} · ${actionLabel}失败`,
    detail: String(reason),
    action: linkRecoveryAction(
      linkKey,
      linkName,
      action,
      sourceId,
      workspaceKey,
      proxySourceId,
      runtimeSourceId,
    ),
  };
}

export function linkCheckActivityDraft(
  linkKey: string,
  linkName: string,
  replayAction: LinkActivityAction,
): ActivityDraft {
  const name = linkName.trim() || linkKey;
  return {
    kind: "link",
    origin: "app",
    status: "running",
    title: "检查联调链路",
    summary: `${name} · 正在执行重试前检查`,
    executionKey: `link:${replayAction}:${linkKey}`,
    parameters: [
      { key: "link", label: "链路", value: name },
      { key: "mode", label: "动作", value: "重试前检查" },
    ],
    target: { page: "overview" },
  };
}

export function linkCheckActivityResultPatch(
  report: LinkExecutionReport,
): ActivityPatch {
  const blockingSteps = linkBlockingSteps(report);
  const passed = linkCheckPassed(report);
  const detailLines = [
    ...blockingSteps.map((step) => `${step.label}：${step.summary}`),
    ...report.warnings.map((warning) => `警告：${warning}`),
  ];
  return {
    status: passed ? "success" : "failed",
    title: "检查联调链路",
    summary: passed
      ? `${report.name} · 检查通过`
      : `${report.name} · ${blockingSteps.length} 个步骤阻止重试`,
    detail: detailLines.length > 0
      ? detailLines.join("\n")
      : passed
        ? "检查通过，可以安全重试"
        : "检查结果为空，未执行重试",
    projectKey: report.plan.project ?? null,
    diagnostics: linkDiagnosticsFromReport(report),
    warnings: report.warnings,
    target: { page: "overview", projectKey: report.plan.project ?? null },
  };
}

export function linkCheckActivityFailurePatch(reason: unknown): ActivityPatch {
  return {
    status: "failed",
    title: "检查联调链路",
    summary: "重试前检查失败",
    detail: String(reason),
  };
}
