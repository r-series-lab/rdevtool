import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BranchOption } from "../app-types";

export type DeployContextStatus = "idle" | "loading" | "ready" | "error";

export type DeployTargetSummary = {
  key: string;
  label: string;
  jobName: string;
};

export type DeployParamKind = "select" | "boolean" | "branch" | "text" | "hidden";

export type DeployParamMeta = {
  key: string;
  label: string;
  kind: DeployParamKind;
  defaultValue: string;
  options: string[];
  required: boolean;
  trueValue: string;
  falseValue: string;
};

export type DeployTargetMeta = {
  targets: DeployTargetSummary[];
  selectedTarget: string;
  params: DeployParamMeta[];
};

export type DeployPlan = {
  projectKey: string;
  projectName: string;
  jobKind: string;
  jobName: string;
  triggerUrl: string;
  params: Record<string, string>;
  jenkinsBaseUrl: string;
};

export type DeployRequest = {
  project: string;
  target: string | null;
  params: Record<string, string>;
};

const DEPLOY_CONTEXT_TIMEOUT_MS = 8000;
const DEPLOY_CONTEXT_FALLBACK_TIMEOUT_MS = DEPLOY_CONTEXT_TIMEOUT_MS + 1000;
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

type UseDeployContextOptions = {
  enabled: boolean;
  selectedProject: string;
  branchOptions: string[];
  setError: (value: string) => void;
};

export function useDeployContext({
  enabled,
  selectedProject,
  branchOptions,
  setError,
}: UseDeployContextOptions) {
  const deployContextRequestRef = useRef(0);
  const planPreviewRequestRef = useRef(0);
  const [target, setTarget] = useState("");
  const [targetMeta, setTargetMeta] = useState<DeployTargetMeta | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [defaultParamValues, setDefaultParamValues] = useState<Record<string, string>>({});
  const [deployContextLoadedKey, setDeployContextLoadedKey] = useState("");
  const [deployContextStatus, setDeployContextStatus] = useState<DeployContextStatus>("idle");
  const [deployContextError, setDeployContextError] = useState("");
  const [plan, setPlan] = useState<DeployPlan | null>(null);

  const deployScopeKey = useMemo(
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
    deployContextRequestRef.current += 1;
    if (!enabled) {
      setTarget("");
      setTargetMeta(null);
      setParamValues({});
      setDefaultParamValues({});
      setDeployContextLoadedKey("");
      setDeployContextStatus("idle");
      setDeployContextError("");
      setPlan(null);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !selectedProject) {
      return;
    }

    setDeployContextLoadedKey("");
    setPlan(null);
    setDeployContextStatus("loading");
    setDeployContextError("");
    setTargetMeta(null);
    setParamValues({});
    setDefaultParamValues({});
    void loadDeployContext(selectedProject, null);
  }, [enabled, selectedProject]);

  useEffect(() => {
    if (!enabled || !selectedProject || !target || deployContextLoadedKey === deployScopeKey) {
      return;
    }

    setPlan(null);
    setDeployContextStatus("loading");
    setDeployContextError("");
    setError("");
    setDeployContextLoadedKey("");
    void loadDeployContext(selectedProject, target);
  }, [deployContextLoadedKey, deployScopeKey, enabled, selectedProject, setError, target]);

  useEffect(() => {
    if (!enabled || deployContextStatus !== "loading" || !selectedProject) {
      return;
    }

    const timer = window.setTimeout(() => {
      deployContextRequestRef.current += 1;
      setDeployContextLoadedKey("");
      setDeployContextStatus("error");
      setDeployContextError("加载部署配置超时，请检查项目配置或稍后重试");
    }, DEPLOY_CONTEXT_FALLBACK_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deployContextStatus, deployScopeKey, enabled, selectedProject]);

  useEffect(() => {
    if (!enabled || !selectedProject || !targetMeta || deployContextLoadedKey !== deployScopeKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshPlanPreview();
    }, PLAN_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deployContextLoadedKey, deployScopeKey, enabled, paramValues, selectedProject, targetMeta]);

  async function loadDeployContext(project: string, nextTarget: string | null) {
    const requestId = ++deployContextRequestRef.current;
    try {
      const [defaultBranch, meta] = await withTimeout(
        Promise.all([
          invoke<string>("get_default_branch", { project }),
          invoke<DeployTargetMeta>("get_deploy_target_meta", {
            project,
            target: nextTarget,
          }),
        ]),
        DEPLOY_CONTEXT_TIMEOUT_MS,
        "加载部署配置超时，请重试",
      );

      if (requestId !== deployContextRequestRef.current) {
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
      setDeployContextLoadedKey(`${project}:${meta.selectedTarget}`);
      setDeployContextStatus("ready");
      setDeployContextError("");
    } catch (reason) {
      if (requestId !== deployContextRequestRef.current) {
        return;
      }
      setDeployContextLoadedKey("");
      setDeployContextStatus("error");
      setDeployContextError(String(reason));
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

  function currentDeployRequest(): DeployRequest {
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
      const nextPlan = await invoke<DeployPlan>("build_deploy_plan", {
        request: currentDeployRequest(),
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
    deployContextLoadedKey,
    setDeployContextLoadedKey,
    deployContextStatus,
    deployContextError,
    plan,
    setPlan,
    setDeployContextStatus,
    currentDeployRequest,
  };
}
