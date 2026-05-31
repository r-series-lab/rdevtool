import { useDeployContext } from "./useDeployContext";
import { useDeployHistory } from "./useDeployHistory";
import type {
  ActivityBulkUpdater,
  ActivityRecorder,
  ActivityUpdater,
} from "../lib/activityCenter";
export type { BuildResult } from "./useDeployHistory";

type UseDeployModuleOptions = {
  deployEnabled: boolean;
  selectedProject: string;
  branchOptions: string[];
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
  syncActivities?: ActivityBulkUpdater;
};

export function useDeployModule({
  deployEnabled,
  selectedProject,
  branchOptions,
  setBusy,
  setError,
  recordActivity,
  updateActivity,
  syncActivities,
}: UseDeployModuleOptions) {
  const deployContext = useDeployContext({
    enabled: deployEnabled,
    selectedProject,
    branchOptions,
    setError,
  });
  const deployHistoryState = useDeployHistory({
    enabled: deployEnabled,
    selectedProject,
    target: deployContext.target,
    env: deployContext.env,
    branch: deployContext.branch,
    currentPlan: deployContext.plan,
    currentDeployRequest: deployContext.currentDeployRequest,
    setPlan: deployContext.setPlan,
    setBusy,
    setError,
    recordActivity,
    updateActivity,
    syncActivities,
  });

  return {
    ...deployContext,
    ...deployHistoryState,
  };
}
