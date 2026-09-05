import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Stack, TextField, Typography } from "@mui/material";
import type { WorkspaceArchivePlan } from "../app-types";
import { AppActionDialog } from "../components/AppActionDialog";
import { ArchiveIcon } from "../components/AppIcons";
import {
  normalizeWorkspaceArchiveReason,
  workspaceArchiveDescription,
} from "../lib/workspaceLifecycle";
import { useI18n } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

type WorkspaceArchiveDialogState = {
  plan: WorkspaceArchivePlan;
  reason: string;
};

export type WorkspaceArchiveDialogResult = {
  confirmed: boolean;
  reason: string | null;
};

export function useWorkspaceArchiveDialog() {
  const { t } = useI18n();
  const [state, setState] = useState<WorkspaceArchiveDialogState | null>(null);
  const resolverRef = useRef<
    ((result: WorkspaceArchiveDialogResult) => void) | null
  >(null);

  useEffect(
    () => () => {
      resolverRef.current?.({ confirmed: false, reason: null });
      resolverRef.current = null;
    },
    [],
  );

  const settle = useCallback(
    (confirmed: boolean) => {
      const resolver = resolverRef.current;
      const reason = normalizeWorkspaceArchiveReason(state?.reason ?? "");
      resolverRef.current = null;
      setState(null);
      resolver?.({ confirmed, reason: confirmed ? reason : null });
    },
    [state?.reason],
  );

  const requestArchive = useCallback((plan: WorkspaceArchivePlan) => {
    resolverRef.current?.({ confirmed: false, reason: null });
    return new Promise<WorkspaceArchiveDialogResult>((resolve) => {
      resolverRef.current = resolve;
      setState({ plan, reason: "" });
    });
  }, []);

  const hasRunningItems = Boolean(state?.plan.blockers.length);
  const dialog = (
    <AppActionDialog
      open={Boolean(state)}
      onClose={() => settle(false)}
      title={t(hasRunningItems ? "停止并归档工作区" : "归档工作区")}
      description={
        state
          ? translateInternalMessage(workspaceArchiveDescription(state.plan), t)
          : undefined
      }
      icon={<ArchiveIcon fontSize="small" />}
      tone="danger"
      maxWidth="sm"
      className="workspace-archive-dialog"
      actions={
        <>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => settle(false)}
          >
            {t("取消")}
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<ArchiveIcon fontSize="small" />}
            onClick={() => settle(true)}
          >
            {t(hasRunningItems ? "停止并归档" : "归档")}
          </Button>
        </>
      }
    >
      <Stack spacing={0.65}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={t("归档原因（可选）")}
          value={state?.reason ?? ""}
          placeholder={t("例如：需求已上线、暂停维护")}
          inputProps={{ maxLength: 160 }}
          onChange={(event) =>
            setState((current) =>
              current ? { ...current, reason: event.target.value } : current,
            )
          }
        />
        <Typography variant="caption" color="text.secondary">
          {t("原因会显示在已归档列表中，便于后续检索和恢复。")}
        </Typography>
      </Stack>
    </AppActionDialog>
  );

  return [requestArchive, dialog] as const;
}
