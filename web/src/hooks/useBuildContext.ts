import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BranchOption, CommitInfo } from "../app-types";

export type BuildContextStatus = "idle" | "loading" | "ready" | "error";

export type BuildTargetSummary = {
  key: string;
  label: string;
  adapter: string;
  actionKind: string;
  jobName: string;
};

export type BuildParamKind = "select" | "boolean" | "branch" | "text" | "hidden";

export type BuildParamMeta = {
  key: string;
  label: string;
  labelKey?: string | null;
  kind: BuildParamKind;
  defaultValue: string;
  configuredDefault: string | null;
  defaultSource:
    | "projectDefault"
    | "currentBranch"
    | "booleanFalseValue"
    | "firstOption"
    | "none";
  options: string[];
  required: boolean;
  trueValue: string;
  falseValue: string;
};

export type BuildTargetMeta = {
  targets: BuildTargetSummary[];
  selectedTarget: string;
  params: BuildParamMeta[];
};

export type BuildPlan = {
  projectKey: string;
  projectName: string;
  adapter: string;
  actionKind: string;
  jobKind: string;
  jobName: string;
  triggerUrl: string;
  params: Record<string, string>;
  jenkinsBaseUrl: string;
  command?: string | null;
  cwd?: string | null;
  outputDir?: string | null;
  requested?: Record<string, unknown>;
  effective?: Record<string, unknown>;
  observed?: {
    commit?: CommitInfo | null;
    changedPaths?: string[];
  };
  ignoredInputs?: unknown[];
  status?: {
    key: string;
    label: string;
    success: boolean;
    terminal: boolean;
    detail: string;
  };
  risks?: Array<{
    code: string;
    severity: string;
    detail: string;
  }>;
};

export type BuildRequest = {
  project: string;
  target: string | null;
  variant?: boolean;
  env?: string | null;
  branch?: string | null;
  extraParams?: Record<string, string>;
  params: Record<string, string>;
};

const BUILD_CONTEXT_TIMEOUT_MS = 8000;
const BUILD_CONTEXT_FALLBACK_TIMEOUT_MS = BUILD_CONTEXT_TIMEOUT_MS + 1000;
const PLAN_PREVIEW_DEBOUNCE_MS = 220;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
}

type UseBuildContextOptions = {
  enabled: boolean;
  selectedProject: string;
  branchOptions: string[];
  setError: (value: string) => void;
};

type BuildContextInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export async function loadBuildTargetContext(
  project: string,
  target: string | null,
  invokeCommand: BuildContextInvoke = invoke,
) {
  const meta = (await invokeCommand("get_build_target_meta", {
    project,
    target,
  })) as BuildTargetMeta;
  const needsBranch = meta.params.some((param) => param.kind === "branch");
  const defaultBranch = needsBranch
    ? ((await invokeCommand("get_default_branch", { project })) as string)
    : "";

  return { meta, defaultBranch };
}

export function useBuildContext({
  enabled,
  selectedProject,
  branchOptions,
  setError,
}: UseBuildContextOptions) {
  const buildContextRequestRef = useRef(0);
  const planPreviewRequestRef = useRef(0);
  const [target, setTarget] = useState("");
  const [targetMeta, setTargetMeta] = useState<BuildTargetMeta | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [defaultParamValues, setDefaultParamValues] = useState<Record<string, string>>({});
  const [buildContextLoadedKey, setBuildContextLoadedKey] = useState("");
  const [buildContextStatus, setBuildContextStatus] = useState<BuildContextStatus>("idle");
  const [buildContextError, setBuildContextError] = useState("");
  const [plan, setPlan] = useState<BuildPlan | null>(null);

  const buildScopeKey = useMemo(
    () => (selectedProject && target ? `${selectedProject}:${target}` : ""),
    [selectedProject, target],
  );

  const branchParam = useMemo(
    () => targetMeta?.params.find((param) => param.kind === "branch") ?? null,
    [targetMeta],
  );

  const envParam = useMemo(
    () =>
      targetMeta?.params.find(
        (param) =>
          param.kind === "select" &&
          ["ENV_PROFILE", "projectEnv", "env"].includes(param.key),
      ) ?? null,
    [targetMeta],
  );

  const branch = branchParam ? paramValues[branchParam.key] ?? "" : "";
  const env = envParam ? paramValues[envParam.key] ?? "" : "";

  useEffect(() => {
    buildContextRequestRef.current += 1;
    if (!enabled) {
      setTarget("");
      setTargetMeta(null);
      setParamValues({});
      setDefaultParamValues({});
      setBuildContextLoadedKey("");
      setBuildContextStatus("idle");
      setBuildContextError("");
      setPlan(null);
    }
  }, [enabled]);

  useEffect(() => {
    buildContextRequestRef.current += 1;
    planPreviewRequestRef.current += 1;
    setTarget("");
    setBuildContextLoadedKey("");
    setPlan(null);
    setBuildContextError("");
    setTargetMeta(null);
    setParamValues({});
    setDefaultParamValues({});

    if (!enabled || !selectedProject) {
      setBuildContextStatus("idle");
      return;
    }

    setBuildContextStatus("loading");
    void loadBuildContext(selectedProject, null);
  }, [enabled, selectedProject]);

  useEffect(() => {
    if (!enabled || !selectedProject || !target || buildContextLoadedKey === buildScopeKey) {
      return;
    }

    setPlan(null);
    setBuildContextStatus("loading");
    setBuildContextError("");
    setError("");
    setBuildContextLoadedKey("");
    void loadBuildContext(selectedProject, target);
  }, [buildContextLoadedKey, buildScopeKey, enabled, selectedProject, setError, target]);

  useEffect(() => {
    if (!enabled || buildContextStatus !== "loading" || !selectedProject) {
      return;
    }

    const timer = window.setTimeout(() => {
      buildContextRequestRef.current += 1;
      setBuildContextLoadedKey("");
      setBuildContextStatus("error");
      setBuildContextError("加载构建配置超时，请检查项目配置或稍后重试");
    }, BUILD_CONTEXT_FALLBACK_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [buildContextStatus, buildScopeKey, enabled, selectedProject]);

  useEffect(() => {
    if (!enabled || !selectedProject || !targetMeta || buildContextLoadedKey !== buildScopeKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshPlanPreview();
    }, PLAN_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [buildContextLoadedKey, buildScopeKey, enabled, paramValues, selectedProject, targetMeta]);

  async function loadBuildContext(project: string, nextTarget: string | null) {
    const requestId = ++buildContextRequestRef.current;
    try {
      const { defaultBranch, meta } = await withTimeout(
        loadBuildTargetContext(project, nextTarget),
        BUILD_CONTEXT_TIMEOUT_MS,
        "加载构建配置超时，请重试",
      );

      if (requestId !== buildContextRequestRef.current) {
        return;
      }

      const defaults: Record<string, string> = {};
      for (const param of meta.params) {
        if (param.kind === "branch") {
          defaults[param.key] =
            param.defaultValue || defaultBranch || branchOptions[0] || "";
        } else {
          defaults[param.key] = param.defaultValue;
        }
      }

      setTarget(meta.selectedTarget);
      setTargetMeta(meta);
      setParamValues(defaults);
      setDefaultParamValues(defaults);
      setBuildContextLoadedKey(`${project}:${meta.selectedTarget}`);
      setBuildContextStatus("ready");
      setBuildContextError("");
    } catch (reason) {
      if (requestId !== buildContextRequestRef.current) {
        return;
      }
      setBuildContextLoadedKey("");
      setBuildContextStatus("error");
      setBuildContextError(String(reason));
      setTargetMeta(null);
      setParamValues({});
      setDefaultParamValues({});
    }
  }

  function setParamValue(key: string, value: string) {
    setParamValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function currentBuildRequest(): BuildRequest {
    return {
      project: selectedProject,
      target: target || null,
      params: paramValues,
    };
  }

  async function refreshPlanPreview() {
    if (!enabled || !selectedProject || !target) {
      return;
    }
    const requestId = ++planPreviewRequestRef.current;
    try {
      const nextPlan = await invoke<BuildPlan>("preview_build_plan", {
        request: currentBuildRequest(),
      });
      if (requestId !== planPreviewRequestRef.current) {
        return;
      }
      setPlan(nextPlan);
    } catch (reason) {
      if (requestId !== planPreviewRequestRef.current) {
        return;
      }
      setPlan(null);
      setError(String(reason));
    }
  }

  return {
    target,
    setTarget,
    targetMeta,
    paramValues,
    defaultParamValues,
    setParamValue,
    branch,
    setBranch: branchParam ? (value: string) => setParamValue(branchParam.key, value) : () => {},
    env,
    setEnv: envParam ? (value: string) => setParamValue(envParam.key, value) : () => {},
    buildContextLoadedKey,
    setBuildContextLoadedKey,
    buildContextStatus,
    buildContextError,
    plan,
    setPlan,
    setBuildContextStatus,
    currentBuildRequest,
  };
}
