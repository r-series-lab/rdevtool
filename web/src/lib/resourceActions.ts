import type {
  ActivityParameter,
} from "./activityCenter";
import type {
  ResourceActionParam,
  ResourceActionParamValue,
  ResourceActionProgressEvent,
  ResourceActionRetry,
  ResourceActionView,
} from "../app-types";
import type { Translate } from "../i18n";

export type ResourceActionValues = Record<string, ResourceActionParamValue>;

const MAX_RESOURCE_ACTION_LIVE_LOG_CHARS = 64 * 1024;

export function appendResourceActionProgressEvent(
  current: ResourceActionProgressEvent[],
  event: ResourceActionProgressEvent,
  maxChars = MAX_RESOURCE_ACTION_LIVE_LOG_CHARS,
): ResourceActionProgressEvent[] {
  if (
    current.some(
      (candidate) =>
        candidate.operationId === event.operationId && candidate.sequence === event.sequence,
    )
  ) {
    return current;
  }
  const next = [...current, event].sort((left, right) => left.sequence - right.sequence);
  let totalChars = next.reduce((total, candidate) => total + candidate.chunk.length, 0);
  while (next.length > 1 && totalChars > maxChars) {
    totalChars -= next.shift()?.chunk.length ?? 0;
  }
  return next;
}

export function initialResourceActionValues(
  action: ResourceActionView,
): ResourceActionValues {
  return Object.fromEntries(
    action.params.map((param) => [param.key, initialParamValue(param)]),
  );
}

function initialParamValue(param: ResourceActionParam): ResourceActionParamValue {
  if (param.defaultValue !== undefined && param.defaultValue !== null) {
    return param.defaultValue;
  }
  if (param.kind === "boolean") {
    return false;
  }
  if (param.kind === "multi_select" || param.kind === "project_multi") {
    return [];
  }
  if (param.kind === "number") {
    return null;
  }
  return "";
}

export function validateResourceActionValues(
  action: ResourceActionView,
  values: ResourceActionValues,
  t: Translate = (message) => message,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const param of action.params) {
    const value = values[param.key];
    if (param.required && isEmptyParamValue(value)) {
      errors[param.key] = t("必填");
      continue;
    }
    if (isEmptyParamValue(value)) {
      continue;
    }
    if (param.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors[param.key] = t("请输入数字");
        continue;
      }
      if (param.min != null && value < param.min) {
        errors[param.key] = t("不能小于 {min}", { min: param.min });
        continue;
      }
      if (param.max != null && value > param.max) {
        errors[param.key] = t("不能大于 {max}", { max: param.max });
        continue;
      }
      if (param.step != null && !numberMatchesStep(value, param.step, param.min ?? 0)) {
        errors[param.key] = t("必须按 {step} 递增", { step: param.step });
        continue;
      }
    }
    if (param.kind === "boolean" && typeof value !== "boolean") {
      errors[param.key] = t("请选择有效的布尔值");
      continue;
    }
    if (typeof value === "string") {
      const length = Array.from(value).length;
      if (param.minLength != null && length < param.minLength) {
        errors[param.key] = t("至少输入 {count} 个字符", { count: param.minLength });
        continue;
      }
      if (param.maxLength != null && length > param.maxLength) {
        errors[param.key] = t("最多输入 {count} 个字符", { count: param.maxLength });
        continue;
      }
    }
    if (Array.isArray(value)) {
      if (param.minItems != null && value.length < param.minItems) {
        errors[param.key] = t("至少选择 {count} 项", { count: param.minItems });
        continue;
      }
      if (param.maxItems != null && value.length > param.maxItems) {
        errors[param.key] = t("最多选择 {count} 项", { count: param.maxItems });
        continue;
      }
    }
    const allowed = new Set(param.options.map((option) => option.value));
    if (
      (param.kind === "select" || param.kind === "project") &&
      typeof value === "string" &&
      allowed.size > 0 &&
      !allowed.has(value)
    ) {
      errors[param.key] = t("所选值已不在可用范围内");
      continue;
    }
    if (
      (param.kind === "multi_select" || param.kind === "project_multi") &&
      Array.isArray(value) &&
      allowed.size > 0 &&
      value.some((item) => !allowed.has(item))
    ) {
      errors[param.key] = t("部分所选值已不在可用范围内");
    }
  }
  return errors;
}

export function resourceActionActivityParameters(
  action: ResourceActionView,
  values: ResourceActionValues,
): ActivityParameter[] {
  return action.params
    .filter((param) => param.kind !== "hidden")
    .map((param) => ({
      key: param.key,
      label: param.label,
      value:
        param.kind === "secret"
          ? values[param.key]
            ? "已提供"
            : "未提供"
          : formatResourceActionParamValue(values[param.key], param),
      masked: param.kind === "secret",
    }));
}

export function formatResourceActionParamValue(
  value: ResourceActionParamValue | undefined,
  param: ResourceActionParam,
) {
  if (Array.isArray(value)) {
    const labels = new Map(param.options.map((option) => [option.value, option.label]));
    return value.map((item) => labels.get(item) ?? item).join("、");
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return value == null ? "" : String(value);
}

export function resourceActionDryRunState(
  action: ResourceActionView,
  values: ResourceActionValues,
): boolean | null {
  const param = action.params.find((candidate) => candidate.role === "dry_run");
  if (!param) return null;
  return values[param.key] === true;
}

export function resourceActionRequiresPlan(
  action: ResourceActionView,
  values: ResourceActionValues,
): boolean {
  return action.execution.mode === "plan_apply" && resourceActionDryRunState(action, values) !== true;
}

export function resourceActionRetryValues(
  action: ResourceActionView,
  values: ResourceActionValues,
  retry: ResourceActionRetry,
): ResourceActionValues | null {
  const param = action.params.find((candidate) => candidate.key === retry.param);
  if (!param || (param.kind !== "multi_select" && param.kind !== "project_multi")) {
    return null;
  }
  const allowed = new Set(param.options.map((option) => option.value));
  if (retry.values.length === 0 || retry.values.some((value) => !allowed.has(value))) {
    return null;
  }
  return { ...values, [retry.param]: [...retry.values] };
}

function isEmptyParamValue(value: ResourceActionParamValue | undefined) {
  return (
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function numberMatchesStep(value: number, step: number, base: number) {
  if (!Number.isFinite(step) || step <= 0) return false;
  const steps = (value - base) / step;
  const tolerance = 1e-9 * Math.max(1, Math.abs(steps));
  return Math.abs(steps - Math.round(steps)) <= tolerance;
}
