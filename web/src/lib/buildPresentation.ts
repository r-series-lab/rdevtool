import type { Translate } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

type BuildParameterLabelInput = {
  key: string;
  label: string;
  labelKey?: string | null;
};

const BUILD_DETAIL_LINE_TEMPLATES: Record<string, string> = {
  命令: "命令：{value}",
  目录: "目录：{value}",
  产物: "产物：{value}",
  日志: "日志：{value}",
  退出码: "退出码：{value}",
};

const BUILD_PARAMETER_LABEL_SOURCES: Record<string, string> = {
  "build.param.target.label": "目标",
  "build.param.environment.label": "环境",
  "build.param.branch.label": "分支",
  "build.param.platform.label": "系统",
  "build.param.profile.label": "配置",
  "build.param.channel.label": "渠道",
  "build.param.more.label": "其他",
};

const LEGACY_BUILTIN_PARAMETER_LABELS = new Map([
  ["target\u0000目标", "build.param.target.label"],
  ["environment\u0000环境", "build.param.environment.label"],
  ["branch\u0000分支", "build.param.branch.label"],
  ["platform\u0000系统", "build.param.platform.label"],
  ["profile\u0000配置", "build.param.profile.label"],
  ["channel\u0000渠道", "build.param.channel.label"],
  ["more\u0000其他", "build.param.more.label"],
]);

export function resolveBuildParameterLabelKey(
  key: string,
  label: string,
  explicitLabelKey?: string | null,
): string | null {
  const explicit = explicitLabelKey?.trim();
  if (explicit) {
    return explicit;
  }
  return (
    LEGACY_BUILTIN_PARAMETER_LABELS.get(
      `${key.trim().toLowerCase()}\u0000${label.trim()}`,
    ) ?? null
  );
}

export function translateBuildParameterLabel(
  parameter: BuildParameterLabelInput,
  t: Translate,
): string {
  const labelKey = resolveBuildParameterLabelKey(
    parameter.key,
    parameter.label,
    parameter.labelKey,
  );
  const source = labelKey ? BUILD_PARAMETER_LABEL_SOURCES[labelKey] : undefined;
  return source ? t(source) : parameter.label;
}

function translateBuildDetailLine(line: string, t: Translate): string {
  const match = line.match(/^(\s*)(命令|目录|产物|日志|退出码)[：:]\s*(.*)$/);
  if (!match) {
    return translateInternalMessage(line, t);
  }
  return `${match[1]}${t(BUILD_DETAIL_LINE_TEMPLATES[match[2]], {
    value: match[3],
  })}`;
}

export function translateBuildDetail(detail: string, t: Translate): string {
  if (!detail) {
    return detail;
  }
  return detail
    .split("\n")
    .map((line) => translateBuildDetailLine(line, t))
    .join("\n");
}
