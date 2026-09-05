import { useEffect, useMemo, useRef, useState } from "react";
import { getStoredJson, setStoredJson } from "../lib/storage";
import {
  normalizeWorkspaceWorkflowChains,
  removeWorkspaceWorkflowChainRules,
  validateWorkspaceWorkflowChain,
  type WorkspaceWorkflowChain,
} from "../lib/workflowChains";
import {
  DEFAULT_WORKFLOW_RULES,
  makeBroadcastRulesForReplay,
  makeReceiveRulesForReplay,
  matchingReceiversForSignal,
  normalizeWorkflowRules,
  normalizeWorkflowSignals,
  workflowReplayKey,
  workflowReplayTargetsEqual,
  type WorkflowBroadcastRule,
  type WorkflowReceiveRule,
  type WorkflowReplay,
  type WorkflowRules,
  type WorkflowSignal,
} from "../lib/workflowSignals";

const WORKFLOW_STORAGE_NAMESPACE = "workflow-signals";
const WORKFLOW_RULES_KEY = "rules";
const WORKFLOW_LAST_SIGNAL_KEY = "last-signal";
const WORKFLOW_PENDING_SIGNALS_KEY = "pending-signals";
const WORKFLOW_CHAINS_KEY = "workspace-chains";
const WORKFLOW_CANCELLED_RUNS_KEY = "cancelled-workspace-runs";
const MAX_PENDING_SIGNALS = 20;
const MAX_CANCELLED_RUNS = 20;

type UseWorkflowSignalsOptions = {
  setError: (value: string) => void;
};

export type WorkflowSignalSummary = {
  id: string;
  receiveCount: number;
  broadcastCount: number;
  pendingCount: number;
  enabledReceiveCount: number;
  enabledBroadcastCount: number;
};

export function useWorkflowSignals({ setError }: UseWorkflowSignalsOptions) {
  const [rules, setRules] = useState<WorkflowRules>(DEFAULT_WORKFLOW_RULES);
  const [pendingSignals, setPendingSignals] = useState<WorkflowSignal[]>([]);
  const [workspaceChains, setWorkspaceChains] = useState<
    WorkspaceWorkflowChain[]
  >([]);
  const [cancelledWorkflowRunIds, setCancelledWorkflowRunIds] = useState<
    string[]
  >([]);
  const rulesRef = useRef(rules);
  const pendingSignalsRef = useRef(pendingSignals);
  const workspaceChainsRef = useRef(workspaceChains);
  const cancelledWorkflowRunIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [
          storedRules,
          storedSignals,
          storedLegacySignal,
          storedChains,
          storedCancelledRuns,
        ] = await Promise.all([
            getStoredJson<unknown>(
              WORKFLOW_STORAGE_NAMESPACE,
              WORKFLOW_RULES_KEY,
            ),
            getStoredJson<unknown>(
              WORKFLOW_STORAGE_NAMESPACE,
              WORKFLOW_PENDING_SIGNALS_KEY,
            ),
            getStoredJson<unknown>(
              WORKFLOW_STORAGE_NAMESPACE,
              WORKFLOW_LAST_SIGNAL_KEY,
            ),
            getStoredJson<unknown>(
              WORKFLOW_STORAGE_NAMESPACE,
              WORKFLOW_CHAINS_KEY,
            ),
            getStoredJson<unknown>(
              WORKFLOW_STORAGE_NAMESPACE,
              WORKFLOW_CANCELLED_RUNS_KEY,
            ),
          ]);
        if (cancelled) {
          return;
        }
        const normalizedChains = normalizeWorkspaceWorkflowChains(storedChains);
        const normalizedRules = normalizedChains.reduce(
          (current, chain) =>
            removeWorkspaceWorkflowChainRules(chain.id, current),
          normalizeWorkflowRules(storedRules),
        );
        rulesRef.current = normalizedRules;
        setRules(normalizedRules);
        workspaceChainsRef.current = normalizedChains;
        setWorkspaceChains(normalizedChains);
        const pending = normalizeWorkflowSignals(storedSignals);
        const normalizedSignals =
          pending.length > 0 ? pending : normalizeWorkflowSignals(storedLegacySignal);
        pendingSignalsRef.current = normalizedSignals;
        setPendingSignals(normalizedSignals);
        const normalizedCancelledRuns = Array.isArray(storedCancelledRuns)
          ? storedCancelledRuns
              .filter((runId): runId is string => typeof runId === "string")
              .map((runId) => runId.trim())
              .filter(Boolean)
              .slice(0, MAX_CANCELLED_RUNS)
          : [];
        cancelledWorkflowRunIdsRef.current = new Set(normalizedCancelledRuns);
        setCancelledWorkflowRunIds(normalizedCancelledRuns);
      } catch (reason) {
        if (!cancelled) {
          setError(String(reason));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setError]);

  const nextPendingSignal = useMemo(
    () =>
      pendingSignals.find(
        (signal) =>
          !cancelledWorkflowRunIdsRef.current.has(signal.chainId ?? "") &&
          matchingReceiversForSignal(signal, rules.receivers).length > 0,
      ) ?? null,
    [cancelledWorkflowRunIds, pendingSignals, rules.receivers],
  );

  async function persistRules(nextRules: WorkflowRules) {
    const normalized = workspaceChainsRef.current.reduce(
      (current, chain) =>
        removeWorkspaceWorkflowChainRules(chain.id, current),
      normalizeWorkflowRules(nextRules),
    );
    rulesRef.current = normalized;
    setRules(normalized);
    await setStoredJson(
      WORKFLOW_STORAGE_NAMESPACE,
      WORKFLOW_RULES_KEY,
      normalized,
    );
  }

  async function persistPendingSignals(nextSignals: WorkflowSignal[]) {
    const normalized = normalizeWorkflowSignals(nextSignals).slice(0, MAX_PENDING_SIGNALS);
    pendingSignalsRef.current = normalized;
    setPendingSignals(normalized);
    await setStoredJson(
      WORKFLOW_STORAGE_NAMESPACE,
      WORKFLOW_PENDING_SIGNALS_KEY,
      normalized,
    );
  }

  async function persistWorkspaceState(
    nextChains: WorkspaceWorkflowChain[],
    nextRules: WorkflowRules,
  ) {
    const normalizedChains = normalizeWorkspaceWorkflowChains(nextChains);
    const normalizedRules = normalizeWorkflowRules(nextRules);
    await Promise.all([
      setStoredJson(
        WORKFLOW_STORAGE_NAMESPACE,
        WORKFLOW_CHAINS_KEY,
        normalizedChains,
      ),
      setStoredJson(
        WORKFLOW_STORAGE_NAMESPACE,
        WORKFLOW_RULES_KEY,
        normalizedRules,
      ),
    ]);
    workspaceChainsRef.current = normalizedChains;
    setWorkspaceChains(normalizedChains);
    rulesRef.current = normalizedRules;
    setRules(normalizedRules);
  }

  async function saveWorkspaceChain(chain: WorkspaceWorkflowChain) {
    const normalized = normalizeWorkspaceWorkflowChains([chain])[0];
    if (!normalized) {
      throw new Error("联动流程配置无效");
    }
    const validation = validateWorkspaceWorkflowChain(normalized);
    if (!validation.valid) {
      throw new Error(validation.errors.join("；"));
    }
    const nextChains = [
      normalized,
      ...workspaceChainsRef.current.filter((item) => item.id !== normalized.id),
    ];
    const nextRules = removeWorkspaceWorkflowChainRules(
      normalized.id,
      rulesRef.current,
    );
    await persistWorkspaceState(nextChains, nextRules);
    return normalized;
  }

  async function deleteWorkspaceChain(chainId: string) {
    const normalizedId = chainId.trim();
    if (!normalizedId) {
      return;
    }
    await persistWorkspaceState(
      workspaceChainsRef.current.filter((chain) => chain.id !== normalizedId),
      removeWorkspaceWorkflowChainRules(normalizedId, rulesRef.current),
    );
  }

  async function setWorkspaceChainEnabled(chainId: string, enabled: boolean) {
    const current = workspaceChainsRef.current.find(
      (chain) => chain.id === chainId,
    );
    if (!current) {
      return;
    }
    await saveWorkspaceChain({
      ...current,
      enabled,
      updatedAt: new Date().toISOString(),
    });
  }

  async function setBroadcastRules(broadcasts: WorkflowBroadcastRule[]) {
    await persistRules({
      ...rulesRef.current,
      broadcasts,
    });
  }

  async function setReceiveRules(receivers: WorkflowReceiveRule[]) {
    await persistRules({
      ...rulesRef.current,
      receivers,
    });
  }

  async function setBroadcastRulesEnabled(ruleIds: string[], enabled: boolean) {
    const targetIds = new Set(ruleIds);
    await setBroadcastRules(
      rulesRef.current.broadcasts.map((rule) =>
        targetIds.has(rule.id) ? { ...rule, enabled } : rule,
      ),
    );
  }

  async function deleteBroadcastRules(ruleIds: string[]) {
    const targetIds = new Set(ruleIds);
    await setBroadcastRules(
      rulesRef.current.broadcasts.filter((rule) => !targetIds.has(rule.id)),
    );
  }

  async function setReceiveRulesEnabled(ruleIds: string[], enabled: boolean) {
    const targetIds = new Set(ruleIds);
    await setReceiveRules(
      rulesRef.current.receivers.map((rule) =>
        targetIds.has(rule.id) ? { ...rule, enabled } : rule,
      ),
    );
  }

  async function deleteReceiveRules(ruleIds: string[]) {
    const targetIds = new Set(ruleIds);
    await setReceiveRules(
      rulesRef.current.receivers.filter((rule) => !targetIds.has(rule.id)),
    );
  }

  async function setReceiveRulesForReplay(replay: WorkflowReplay, signalIds: string[]) {
    await setReceiveRules(
      makeReceiveRulesForReplay({
        replay,
        signalIds,
        existing: rulesRef.current.receivers,
      }),
    );
  }

  async function setBroadcastRulesForReplay(replay: WorkflowReplay, signalIds: string[]) {
    await setBroadcastRules(
      makeBroadcastRulesForReplay({
        replay,
        signalIds,
        existing: rulesRef.current.broadcasts,
      }),
    );
  }

  async function setWorkflowRulesForReplay({
    replay,
    receiveSignalIds,
    broadcastSignalIds,
  }: {
    replay: WorkflowReplay;
    receiveSignalIds: string[];
    broadcastSignalIds: string[];
  }) {
    await persistRules({
      broadcasts: makeBroadcastRulesForReplay({
        replay,
        signalIds: broadcastSignalIds,
        existing: rulesRef.current.broadcasts,
      }),
      receivers: makeReceiveRulesForReplay({
        replay,
        signalIds: receiveSignalIds,
        existing: rulesRef.current.receivers,
      }),
    });
  }

  function signalIdsForBroadcastReplay(replay: WorkflowReplay) {
    const replayKey = workflowReplayKey(replay);
    return rules.broadcasts
      .filter((rule) => rule.replayKey === replayKey)
      .map((rule) => rule.signalId);
  }

  function broadcastRulesForReplay(replay: WorkflowReplay) {
    const replayKey = workflowReplayKey(replay);
    return rules.broadcasts.filter((rule) => rule.replayKey === replayKey);
  }

  function receiveRulesForReplay(replay: WorkflowReplay) {
    const replayKey = workflowReplayKey(replay);
    return rules.receivers.filter(
      (rule) => workflowReplayTargetsEqual(rule.target, replay.target) && rule.replayKey === replayKey,
    );
  }

  function signalIdsForReplay(replay: WorkflowReplay) {
    const replayKey = workflowReplayKey(replay);
    return rules.receivers
      .filter((rule) => workflowReplayTargetsEqual(rule.target, replay.target) && rule.replayKey === replayKey)
      .map((rule) => rule.signalId);
  }

  const signalOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...rules.broadcasts.map((rule) => rule.signalId),
            ...rules.receivers.map((rule) => rule.signalId),
            ...pendingSignals.map((signal) => signal.id),
          ]
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [pendingSignals, rules.broadcasts, rules.receivers],
  );
  const signalSummaries = useMemo(() => {
    const summaries = new Map<string, WorkflowSignalSummary>();
    const ensureSummary = (id: string) => {
      const normalizedId = id.trim();
      if (!normalizedId) {
        return null;
      }
      const current = summaries.get(normalizedId) ?? {
        id: normalizedId,
        receiveCount: 0,
        broadcastCount: 0,
        pendingCount: 0,
        enabledReceiveCount: 0,
        enabledBroadcastCount: 0,
      };
      summaries.set(normalizedId, current);
      return current;
    };

    for (const rule of rules.receivers) {
      const summary = ensureSummary(rule.signalId);
      if (summary) {
        summary.receiveCount += 1;
        if (rule.enabled) {
          summary.enabledReceiveCount += 1;
        }
      }
    }
    for (const rule of rules.broadcasts) {
      const summary = ensureSummary(rule.signalId);
      if (summary) {
        summary.broadcastCount += 1;
        if (rule.enabled) {
          summary.enabledBroadcastCount += 1;
        }
      }
    }
    for (const signal of pendingSignals) {
      const summary = ensureSummary(signal.id);
      if (summary) {
        summary.pendingCount += 1;
      }
    }

    return Array.from(summaries.values()).sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }, [pendingSignals, rules.broadcasts, rules.receivers]);

  function matchingReceivers(signal: WorkflowSignal) {
    return matchingReceiversForSignal(signal, rules.receivers);
  }

  async function emitWorkflowSignals(signals: WorkflowSignal[]) {
    const eligibleSignals = signals.filter(
      (signal) =>
        !cancelledWorkflowRunIdsRef.current.has(signal.chainId ?? ""),
    );
    if (eligibleSignals.length === 0) {
      return;
    }
    await persistPendingSignals([
      ...eligibleSignals,
      ...pendingSignalsRef.current,
    ]);
  }

  async function cancelWorkflowRun(runId: string) {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }
    const next = [
      normalizedRunId,
      ...Array.from(cancelledWorkflowRunIdsRef.current).filter(
        (item) => item !== normalizedRunId,
      ),
    ].slice(0, MAX_CANCELLED_RUNS);
    cancelledWorkflowRunIdsRef.current = new Set(next);
    setCancelledWorkflowRunIds(next);
    await Promise.all([
      setStoredJson(
        WORKFLOW_STORAGE_NAMESPACE,
        WORKFLOW_CANCELLED_RUNS_KEY,
        next,
      ),
      persistPendingSignals(
        pendingSignalsRef.current.filter(
          (signal) => signal.chainId !== normalizedRunId,
        ),
      ),
    ]);
  }

  function isWorkflowRunCancelled(runId?: string | null) {
    return Boolean(
      runId && cancelledWorkflowRunIdsRef.current.has(runId.trim()),
    );
  }

  async function clearWorkflowSignal(instanceId: string) {
    await persistPendingSignals(
      pendingSignalsRef.current.filter((signal) => signal.instanceId !== instanceId),
    );
  }

  async function deleteWorkflowSignal(signalId: string) {
    const normalizedId = signalId.trim();
    if (!normalizedId) {
      return;
    }
    await persistRules({
      broadcasts: rulesRef.current.broadcasts.filter(
        (rule) => rule.signalId.trim() !== normalizedId,
      ),
      receivers: rulesRef.current.receivers.filter(
        (rule) => rule.signalId.trim() !== normalizedId,
      ),
    });
    await persistPendingSignals(
      pendingSignalsRef.current.filter((signal) => signal.id.trim() !== normalizedId),
    );
  }

  async function clearWorkflowSignals() {
    await persistWorkspaceState([], DEFAULT_WORKFLOW_RULES);
    await persistPendingSignals([]);
    cancelledWorkflowRunIdsRef.current = new Set();
    setCancelledWorkflowRunIds([]);
    await setStoredJson(
      WORKFLOW_STORAGE_NAMESPACE,
      WORKFLOW_CANCELLED_RUNS_KEY,
      [],
    );
  }

  return {
    rules,
    pendingSignals,
    workspaceChains,
    cancelledWorkflowRunIds,
    nextPendingSignal,
    setBroadcastRules,
    setReceiveRules,
    setBroadcastRulesEnabled,
    deleteBroadcastRules,
    setReceiveRulesEnabled,
    deleteReceiveRules,
    setReceiveRulesForReplay,
    setBroadcastRulesForReplay,
    setWorkflowRulesForReplay,
    signalIdsForBroadcastReplay,
    broadcastRulesForReplay,
    receiveRulesForReplay,
    signalIdsForReplay,
    signalOptions,
    signalSummaries,
    matchingReceivers,
    saveWorkspaceChain,
    deleteWorkspaceChain,
    setWorkspaceChainEnabled,
    emitWorkflowSignals,
    cancelWorkflowRun,
    isWorkflowRunCancelled,
    clearWorkflowSignal,
    deleteWorkflowSignal,
    clearWorkflowSignals,
  };
}

export type WorkflowSignalsState = ReturnType<typeof useWorkflowSignals>;
