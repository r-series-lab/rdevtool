import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BranchOption } from "../app-types";
import {
  DEFAULT_TARGET_BRANCH_KEYWORDS,
  normalizeProjectSelectionEntry,
  prioritizeBranchOptions,
  type ProjectSelectionEntry,
  type ProjectSelectionMap,
  type ProjectSummary,
} from "./useBranchContext";

type UseMergeSelectionOptions = {
  enabled: boolean;
  selectedProject: string;
  selectedProjectInfo: ProjectSummary | null;
  branchEntries: BranchOption[];
  branchOptions: string[];
  selectedProjectSelection: ProjectSelectionEntry | null;
  setProjectSelections: Dispatch<SetStateAction<ProjectSelectionMap>>;
};

function resolveInitialTargetBranch(
  savedTarget: string | undefined,
  targetBranchOptions: string[],
  branchOptions: string[],
) {
  const normalizedSaved = savedTarget?.trim() ?? "";
  if (normalizedSaved) {
    return normalizedSaved;
  }
  return targetBranchOptions[0] || branchOptions[0] || "";
}

function resolveInitialSourceBranch(
  savedSource: string | undefined,
  sourceBranchOptions: string[],
  branchOptions: string[],
  mergeTarget: string,
) {
  const normalizedSaved = savedSource?.trim() ?? "";
  if (normalizedSaved && normalizedSaved !== mergeTarget) {
    return normalizedSaved;
  }
  return (
    sourceBranchOptions.find((item) => item !== mergeTarget) ||
    branchOptions.find((item) => item !== mergeTarget) ||
    ""
  );
}

export function useMergeSelection({
  enabled,
  selectedProject,
  selectedProjectInfo,
  branchEntries,
  branchOptions,
  selectedProjectSelection,
  setProjectSelections,
}: UseMergeSelectionOptions) {
  const initializedProjectRef = useRef("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [selectionProjectKey, setSelectionProjectKey] = useState("");

  const targetBranchKeywords = useMemo(
    () =>
      selectedProjectInfo?.targetBranchKeywords?.length
        ? selectedProjectInfo.targetBranchKeywords
        : DEFAULT_TARGET_BRANCH_KEYWORDS,
    [selectedProjectInfo],
  );
  const sourceBranchEntries = branchEntries;
  const targetBranchEntries = useMemo(
    () => prioritizeBranchOptions(branchEntries, targetBranchKeywords),
    [branchEntries, targetBranchKeywords],
  );
  const sourceBranchOptions = useMemo(
    () => sourceBranchEntries.map((item) => item.name),
    [sourceBranchEntries],
  );
  const targetBranchOptions = useMemo(
    () => targetBranchEntries.map((item) => item.name),
    [targetBranchEntries],
  );

  useEffect(() => {
    initializedProjectRef.current = "";
    setSelectionProjectKey("");
    if (!enabled) {
      setMergeSource("");
      setMergeTarget("");
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !selectedProject) {
      initializedProjectRef.current = "";
      setSelectionProjectKey("");
      setMergeSource("");
      setMergeTarget("");
      return;
    }

    if (initializedProjectRef.current === selectedProject) {
      return;
    }

    initializedProjectRef.current = selectedProject;
    const nextTarget = resolveInitialTargetBranch(
      selectedProjectSelection?.mergeTarget,
      targetBranchOptions,
      branchOptions,
    );
    const nextSource = resolveInitialSourceBranch(
      selectedProjectSelection?.mergeSource,
      sourceBranchOptions,
      branchOptions,
      nextTarget,
    );

    setMergeTarget(nextTarget);
    setMergeSource(nextSource);
    setSelectionProjectKey(selectedProject);
  }, [
    branchOptions,
    enabled,
    selectedProject,
    selectedProjectSelection?.mergeSource,
    selectedProjectSelection?.mergeTarget,
    sourceBranchOptions,
    targetBranchOptions,
  ]);

  useEffect(() => {
    if (!enabled || !selectedProject) {
      return;
    }

    setMergeSource((current) => {
      const normalizedCurrent = current.trim();
      if (!normalizedCurrent) {
        return current;
      }
      if (normalizedCurrent !== mergeTarget) {
        return normalizedCurrent === current ? current : normalizedCurrent;
      }
      const fallbackSource = resolveInitialSourceBranch(
        selectedProjectSelection?.mergeSource,
        sourceBranchOptions,
        branchOptions,
        mergeTarget.trim(),
      );
      return current === fallbackSource ? current : fallbackSource;
    });
  }, [
    branchOptions,
    enabled,
    mergeTarget,
    selectedProject,
    selectedProjectSelection?.mergeSource,
    sourceBranchOptions,
  ]);

  useEffect(() => {
    if (!enabled || !selectedProject || selectionProjectKey !== selectedProject) {
      return;
    }

    setProjectSelections((current) => {
      const previous = current[selectedProject] ?? {};
      const next = normalizeProjectSelectionEntry({
        ...previous,
        mergeSource: mergeSource || undefined,
        mergeTarget: mergeTarget || undefined,
      });

      if (JSON.stringify(previous) === JSON.stringify(next ?? {})) {
        return current;
      }

      return {
        ...current,
        [selectedProject]: next ?? {},
      };
    });
  }, [
    enabled,
    mergeSource,
    mergeTarget,
    selectedProject,
    selectionProjectKey,
    setProjectSelections,
  ]);

  return {
    mergeSource,
    setMergeSource,
    mergeTarget,
    setMergeTarget,
    sourceBranchEntries,
    targetBranchEntries,
    sourceBranchOptions,
    targetBranchOptions,
  };
}
