import { useMemo } from "react";
import { CircularProgress, IconButton, Tooltip } from "@mui/material";
import type { ProjectRuntimeEntry } from "../app-types";
import {
  ExpandIcon,
  FolderIcon,
  OpenExternalIcon,
  PlayIcon,
  StopIcon,
} from "./AppIcons";
import { WorkspaceRuntimePreflightFixDialog } from "./WorkspaceRuntimePreflightFixDialog";
import { WorkspaceRuntimePreflightStatus } from "./WorkspaceRuntimePreflightStatus";
import {
  translateWorkspaceRuntimeSourceTag,
  translateWorkspaceRuntimeSourceTitle,
  translateWorkspaceRuntimeSummary,
  workspaceProjectRuntimeProfileInfo,
  type WorkspaceRuntimeSourceContext,
} from "../lib/workspaceRuntimeSummary";
import type { WorkspaceRuntimePreflightAction } from "../lib/workspaceRuntimePreflightActions";
import { useWorkspaceRuntimePreflightFix } from "../hooks/useWorkspaceRuntimePreflightFix";
import { useWorkspaceRuntimePreflight } from "../hooks/useWorkspaceRuntimePreflight";
import { useI18n } from "../i18n";

export type WorkspaceProjectDirectoryItem = {
  projectKey: string;
  projectName: string;
  mode: "global" | "managed" | "bound" | string;
  modeLabel: string;
  path?: string | null;
  managed: boolean;
  statusKey: string;
  statusLabel: string;
  running: boolean;
  canStart: boolean;
  canStop: boolean;
  canFocusRuntime: boolean;
};

export type WorkspaceProjectRuntimeRowProps = {
  workspace: WorkspaceRuntimeSourceContext;
  directory: WorkspaceProjectDirectoryItem;
  runtimeEntry?: ProjectRuntimeEntry;
  selectedDebugProfileKey?: string;
  active: boolean;
  preferencesHydrated: boolean;
  actionRunning: boolean;
  focusRunning: boolean;
  anyActionRunning: boolean;
  onOpenDirectory: (path: string) => Promise<void> | void;
  onStart: (
    debugProfileKey: string,
    expectedPort?: number,
  ) => Promise<unknown> | unknown;
  onRequestStart: (forceConfirm?: boolean) => Promise<unknown> | unknown;
  onStop: () => Promise<void> | void;
  onFocus: () => Promise<void> | void;
  onPreflightAction: (
    action: WorkspaceRuntimePreflightAction,
  ) => Promise<void> | void;
  onStartProxy: (
    profileId: string,
    sourceId: string,
  ) => Promise<unknown> | unknown;
  onProjectConfigSaved: () => Promise<void> | void;
  onSelectDebugProfile: (profileKey: string) => void;
};

function projectDirectoryTone(mode: string): "default" | "primary" | "success" {
  if (mode === "managed") {
    return "primary";
  }
  if (mode === "bound") {
    return "success";
  }
  return "default";
}

function projectDirectoryLabel(label: string) {
  if (label.includes("副本")) {
    return "副本";
  }
  if (label.includes("绑定")) {
    return "绑定";
  }
  if (label.includes("全局")) {
    return "全局";
  }
  return label;
}

export function WorkspaceProjectRuntimeRow({
  workspace,
  directory,
  runtimeEntry,
  selectedDebugProfileKey,
  active,
  preferencesHydrated,
  actionRunning,
  focusRunning,
  anyActionRunning,
  onOpenDirectory,
  onStart,
  onRequestStart,
  onStop,
  onFocus,
  onPreflightAction,
  onStartProxy,
  onProjectConfigSaved,
  onSelectDebugProfile,
}: WorkspaceProjectRuntimeRowProps) {
  const { t } = useI18n();
  const projectRunning = directory.running || directory.canStop;
  const profileInfo = useMemo(
    () =>
      workspaceProjectRuntimeProfileInfo(
        runtimeEntry,
        active ? selectedDebugProfileKey : undefined,
        workspace,
        active,
      ),
    [active, runtimeEntry, selectedDebugProfileKey, workspace],
  );
  const profileSummary = preferencesHydrated
    ? translateWorkspaceRuntimeSummary(profileInfo.summary, t)
    : t("正在读取启动档案");
  const { preflight, refresh: refreshPreflight } =
    useWorkspaceRuntimePreflight({
    projectKey: directory.projectKey,
    debugProfileKey: profileInfo.debugProfileKey,
    enabled:
      active &&
      preferencesHydrated &&
      directory.canStart &&
      !projectRunning,
    running: projectRunning,
    });
  const preflightFix = useWorkspaceRuntimePreflightFix({
    projectKey: directory.projectKey,
    projectName: directory.projectName,
    debugProfileKey: profileInfo.debugProfileKey,
    debugProfiles: runtimeEntry?.debugProfiles ?? [],
    onStartProxy,
    onStartRuntime: (expectedPort) =>
      onStart(profileInfo.debugProfileKey, expectedPort),
    onProjectConfigSaved,
    onSelectDebugProfile,
    onRefresh: refreshPreflight,
  });

  function handlePreflightAction(action: WorkspaceRuntimePreflightAction) {
    if (action.target === "quickFix") {
      preflightFix.open(action.fix);
      return;
    }
    void onPreflightAction(action);
  }

  const canToggleProject =
    active &&
    Boolean(directory.projectKey) &&
    (projectRunning || (preferencesHydrated && directory.canStart));
  const preflightBlocksDefaultStart =
    !projectRunning && preflight.statusKey.toLowerCase() === "error";
  const canFocusProject =
    active &&
    Boolean(directory.projectKey) &&
    projectRunning &&
    directory.canFocusRuntime;
  const projectToggleTitle = projectRunning
    ? t("停止项目")
    : preflightBlocksDefaultStart
      ? preflight.summary || t("当前默认档案预检未通过")
      : canToggleProject
        ? t("使用工作区默认档案启动")
        : !preferencesHydrated
          ? t("正在读取启动档案")
          : active
            ? t("项目暂不可启动")
            : t("设为当前工作区后启动");
  const projectOpenTitle = canFocusProject
    ? t("打开运行中的项目")
    : active
      ? t("未配置打开地址，且未识别到启动 URL")
      : t("设为当前工作区后打开");

  return (
    <div
      className={`overview-directory-row${projectRunning ? " is-running" : ""}`}
      title={[profileSummary, directory.path].filter(Boolean).join(" · ")}
    >
      <button
        type="button"
        className="overview-directory-main"
        onClick={() => void onOpenDirectory(directory.path ?? "")}
        disabled={!directory.path || anyActionRunning}
      >
        <span className="overview-shortcut-icon" aria-hidden="true">
          <FolderIcon fontSize="small" />
        </span>
        <span className="overview-shortcut-copy">
          <span className="overview-directory-name-row">
            <strong>{directory.projectName}</strong>
            <span
              className={`overview-directory-chip is-${projectDirectoryTone(directory.mode)}`}
            >
              {t(projectDirectoryLabel(directory.modeLabel))}
            </span>
            {projectRunning ? (
              <span className="overview-directory-chip is-success">
                {t(directory.statusLabel || "运行中")}
              </span>
            ) : null}
          </span>
          <small>
            {[profileSummary, directory.path || t("目录未配置")].join(" · ")}
          </small>
          {preferencesHydrated && profileInfo.sourceTags.length > 0 ? (
            <span
              className="overview-runtime-source-row"
              aria-label={t("{name} 运行配置来源", {
                name: directory.projectName,
              })}
            >
              {profileInfo.sourceTags.map((source) => (
                <span
                  key={source.key}
                  className="overview-runtime-source-tag"
                  title={translateWorkspaceRuntimeSourceTitle(source.title, t)}
                >
                  {translateWorkspaceRuntimeSourceTag(source.label, t)}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>

      <span className="overview-directory-actions">
        {!projectRunning && (preflight.statusKey || preflight.loading) ? (
          <WorkspaceRuntimePreflightStatus
            projectName={directory.projectName}
            preflight={preflight}
            onRefresh={refreshPreflight}
            onAction={handlePreflightAction}
          />
        ) : null}
        {projectRunning ? (
          <Tooltip title={projectOpenTitle}>
            <span>
              <IconButton
                size="small"
                className="overview-project-start overview-project-open"
                onClick={() => void onFocus()}
                disabled={!canFocusProject || anyActionRunning}
                aria-label={t("打开 {name}", {
                  name: directory.projectName,
                })}
              >
                {focusRunning ? (
                  <CircularProgress size={15} thickness={5} />
                ) : (
                  <OpenExternalIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : null}

        <span className="overview-project-launch-group">
          <Tooltip title={projectToggleTitle}>
            <span>
              <IconButton
                size="small"
                className={`overview-project-start overview-project-toggle${
                  projectRunning ? " is-running" : ""
                }`}
                onClick={() =>
                  projectRunning
                    ? void onStop()
                    : void onRequestStart()
                }
                disabled={
                  !canToggleProject ||
                  preflightBlocksDefaultStart ||
                  anyActionRunning
                }
                aria-label={
                  projectRunning
                    ? t("停止 {name}", { name: directory.projectName })
                    : t("启动 {name}", { name: directory.projectName })
                }
              >
                {actionRunning ? (
                  <CircularProgress size={15} thickness={5} />
                ) : projectRunning ? (
                  <StopIcon fontSize="small" />
                ) : (
                  <PlayIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>

          {!projectRunning && active && preferencesHydrated ? (
            <Tooltip title={t("选择启动档案")}>
              <span>
                <IconButton
                  size="small"
                  className="overview-project-profile-menu"
                  onClick={() => void onRequestStart(true)}
                  aria-label={t("选择 {name} 启动档案", {
                    name: directory.projectName,
                  })}
                  aria-haspopup="dialog"
                  disabled={!directory.canStart || anyActionRunning}
                >
                  <ExpandIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </span>
      </span>
      <WorkspaceRuntimePreflightFixDialog
        plan={preflightFix.plan}
        busy={preflightFix.busy}
        error={preflightFix.error}
        portDraft={preflightFix.portDraft}
        onClose={preflightFix.close}
        onPortDraftChange={preflightFix.updatePortDraft}
        onConfirm={preflightFix.execute}
      />
    </div>
  );
}
