import { useBuildContext } from "./useBuildContext";
import { useBuildHistory } from "./useBuildHistory";
import type {
  ActivityBulkUpdater,
  ActivityRecorder,
  ActivityUpdater,
} from "../lib/activityCenter";
export type { BuildResult } from "./useBuildHistory";

type UseBuildModuleOptions = {
  buildEnabled: boolean;
  selectedProject: string;
  branchOptions: string[];
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
  syncActivities?: ActivityBulkUpdater;
};

export function useBuildModule({
  buildEnabled,
  selectedProject,
  branchOptions,
  setBusy,
  setError,
  recordActivity,
  updateActivity,
  syncActivities,
}: UseBuildModuleOptions) {
  const buildContext = useBuildContext({
    enabled: buildEnabled,
    selectedProject,
    branchOptions,
    setError,
  });
  const buildHistoryState = useBuildHistory({
    enabled: buildEnabled,
    selectedProject,
    target: buildContext.target,
    env: buildContext.env,
    branch: buildContext.branch,
    currentPlan: buildContext.plan,
    currentBuildRequest: buildContext.currentBuildRequest,
    setPlan: buildContext.setPlan,
    setBusy,
    setError,
    recordActivity,
    updateActivity,
    syncActivities,
  });

  return {
    ...buildContext,
    ...buildHistoryState,
  };
}
