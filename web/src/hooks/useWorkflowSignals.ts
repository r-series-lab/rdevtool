import { useEffect, useMemo, useRef, useState } from "react";
import { getStoredJson, setStoredJson } from "../lib/storage";
import {
  DEFAULT_WORKFLOW_RULES,
  makeBroadcastRulesForReplay,
  makeReceiveRulesForReplay,
  matchingReceiversForSignal,
  normalizeWorkflowRules,
  normalizeWorkflowSignals,
  workflowReplayKey,
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
const MAX_PENDING_SIGNALS = 20;

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
  const rulesRef = useRef(rules);
  const pendingSignalsRef = useRef(pendingSignals);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [storedRules, storedSignals, storedLegacySignal] = await Promise.all([
          getStoredJson<unknown>(WORKFLOW_STORAGE_NAMESPACE, WORKFLOW_RULES_KEY),
          getStoredJson<unknown>(WORKFLOW_STORAGE_NAMESPACE, WORKFLOW_PENDING_SIGNALS_KEY),
          getStoredJson<unknown>(WORKFLOW_STORAGE_NAMESPACE, WORKFLOW_LAST_SIGNAL_KEY),
        ]);
        if (cancelled) {
          return;
        }
        const normalizedRules = normalizeWorkflowRules(storedRules);
        rulesRef.current = normalizedRules;
        setRules(normalizedRules);
        const pending = normalizeWorkflowSignals(storedSignals);
        const normalizedSignals =
          pending.length > 0 ? pending : normalizeWorkflowSignals(storedLegacySignal);
        pendingSignalsRef.current = normalizedSignals;
        setPendingSignals(normalizedSignals);
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
        (signal) => matchingReceiversForSignal(signal, rules.receivers).length > 0,
      ) ?? null,
    [pendingSignals, rules.receivers],
  );

  async function persistRules(nextRules: WorkflowRules) {
    const normalized = normalizeWorkflowRules(nextRules);
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
      (rule) => rule.target === replay.target && rule.replayKey === replayKey,
    );
  }

  function signalIdsForReplay(replay: WorkflowReplay) {
    const replayKey = workflowReplayKey(replay);
    return rules.receivers
      .filter((rule) => rule.target === replay.target && rule.replayKey === replayKey)
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
    if (signals.length === 0) {
      return;
    }
    await persistPendingSignals([...signals, ...pendingSignalsRef.current]);
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
    await persistRules(DEFAULT_WORKFLOW_RULES);
    await persistPendingSignals([]);
  }

  return {
    rules,
    pendingSignals,
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
    emitWorkflowSignals,
    clearWorkflowSignal,
    deleteWorkflowSignal,
    clearWorkflowSignals,
  };
}

export type WorkflowSignalsState = ReturnType<typeof useWorkflowSignals>;
