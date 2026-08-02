import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectDebugProfileSummary,
  ProjectRuntimePreflightFix,
  SaveProjectRuntimeLaunchProfileResponse,
} from "../app-types";
import {
  workspaceRuntimePreflightFixPlan,
  type WorkspaceRuntimePreflightFixPlan,
} from "../lib/workspaceRuntimePreflightFixes";
import {
  generatedRuntimeProfileSaveRequest,
  portOverrideProfileSaveRequest,
} from "../lib/workspaceRuntimeProfileFix";

export type WorkspaceRuntimePortFixDraft = {
  portText: string;
  saveProfile: boolean;
  profileLabel: string;
};

const EMPTY_PORT_DRAFT: WorkspaceRuntimePortFixDraft = {
  portText: "",
  saveProfile: false,
  profileLabel: "",
};

export function useWorkspaceRuntimePreflightFix({
  projectKey,
  projectName,
  debugProfileKey,
  debugProfiles,
  onStartProxy,
  onStartRuntime,
  onProjectConfigSaved,
  onSelectDebugProfile,
  onRefresh,
}: {
  projectKey: string;
  projectName: string;
  debugProfileKey: string;
  debugProfiles: ProjectDebugProfileSummary[];
  onStartProxy: (
    profileId: string,
    sourceId: string,
  ) => Promise<unknown> | unknown;
  onStartRuntime: (expectedPort: number) => Promise<unknown> | unknown;
  onProjectConfigSaved: () => Promise<void> | void;
  onSelectDebugProfile: (profileKey: string) => void;
  onRefresh: () => void;
}) {
  const [plan, setPlan] = useState<WorkspaceRuntimePreflightFixPlan | null>(
    null,
  );
  const [portDraft, setPortDraft] =
    useState<WorkspaceRuntimePortFixDraft>(EMPTY_PORT_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = useCallback(
    (fix: ProjectRuntimePreflightFix) => {
      const nextPlan = workspaceRuntimePreflightFixPlan(fix);
      if (!nextPlan) {
        setError("当前修复计划不完整，请打开对应配置页处理。");
        return false;
      }
      setError("");
      setPlan(nextPlan);
      if (nextPlan.kind === "changePort") {
        const baseProfile = debugProfiles.find(
          (profile) => profile.key === debugProfileKey,
        );
        setPortDraft({
          portText: String(nextPlan.suggestedPort),
          saveProfile: false,
          profileLabel: `${
            baseProfile?.label || projectName
          } · 端口 ${nextPlan.suggestedPort}`,
        });
      } else if (nextPlan.kind === "createProfile") {
        setPortDraft({
          portText: String(nextPlan.expectedPort),
          saveProfile: true,
          profileLabel: nextPlan.profileLabel,
        });
      } else {
        setPortDraft(EMPTY_PORT_DRAFT);
      }
      return true;
    },
    [debugProfileKey, debugProfiles, projectName],
  );

  const close = useCallback(() => {
    if (!busy) {
      setPlan(null);
      setPortDraft(EMPTY_PORT_DRAFT);
      setError("");
    }
  }, [busy]);

  const updatePortDraft = useCallback(
    (patch: Partial<WorkspaceRuntimePortFixDraft>) => {
      setPortDraft((current) => ({ ...current, ...patch }));
      setError("");
    },
    [],
  );

  const execute = useCallback(async () => {
    if (!plan || busy) {
      return false;
    }
    setBusy(true);
    setError("");
    try {
      if (plan.kind === "startProxy") {
        const profileId = plan.fix.profileId?.trim();
        const sourceId = plan.fix.sourceId?.trim();
        if (!profileId || !sourceId) {
          throw new Error("代理修复计划缺少配置来源或代理 ID。");
        }
        await onStartProxy(profileId, sourceId);
        setPlan(null);
        onRefresh();
        return true;
      }

      if (plan.kind === "resetProfile") {
        onSelectDebugProfile("");
        setPlan(null);
        setPortDraft(EMPTY_PORT_DRAFT);
        return true;
      }

      if (plan.kind === "createProfile") {
        const response = await invoke<SaveProjectRuntimeLaunchProfileResponse>(
          "save_project_runtime_launch_profile",
          {
            request: generatedRuntimeProfileSaveRequest({
              projectKey,
              plan,
              profileLabel: portDraft.profileLabel,
              debugProfiles,
            }),
          },
        );
        await onProjectConfigSaved();
        onSelectDebugProfile(response.profileKey);
        setPlan(null);
        setPortDraft(EMPTY_PORT_DRAFT);
        return true;
      }

      const expectedPort = Number(portDraft.portText);
      if (
        !Number.isInteger(expectedPort) ||
        expectedPort < 1 ||
        expectedPort > 65_535
      ) {
        throw new Error("端口必须是 1-65535 之间的整数。");
      }
      if (expectedPort === plan.currentPort) {
        throw new Error(`端口 ${expectedPort} 仍是当前冲突端口。`);
      }

      let profileSaved = false;
      if (portDraft.saveProfile) {
        const response = await invoke<SaveProjectRuntimeLaunchProfileResponse>(
          "save_project_runtime_launch_profile",
          {
            request: portOverrideProfileSaveRequest({
              projectKey,
              projectName,
              debugProfileKey,
              debugProfiles,
              expectedPort,
              profileLabel: portDraft.profileLabel,
            }),
          },
        );
        profileSaved = true;
        setPortDraft((current) => ({ ...current, saveProfile: false }));
        await onProjectConfigSaved();
        onSelectDebugProfile(response.profileKey);
      }

      const started = await onStartRuntime(expectedPort);
      if (started === false) {
        throw new Error(
          profileSaved
            ? "启动档案已保存，但项目未能使用新端口启动，请查看活动记录中的失败原因。"
            : "项目未能使用新端口启动，请查看活动记录中的失败原因。",
        );
      }
      setPlan(null);
      setPortDraft(EMPTY_PORT_DRAFT);
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    debugProfileKey,
    debugProfiles,
    onProjectConfigSaved,
    onRefresh,
    onSelectDebugProfile,
    onStartProxy,
    onStartRuntime,
    plan,
    portDraft,
    projectKey,
    projectName,
  ]);

  return {
    plan,
    portDraft,
    busy,
    error,
    open,
    close,
    updatePortDraft,
    execute,
  };
}
