import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
} from "@mui/material";
import {
  confirmationPreferencesWithOverride,
  getCurrentConfirmationPreferences,
  loadConfirmationPreferences,
  resolveConfirmationDecision,
  saveConfirmationPreferences,
  type ConfirmationPreferenceKey,
} from "../lib/confirmationPreferences";
import { translateNode, useI18n } from "../i18n";
import {
  AppActionDialog,
  type AppActionDialogProps,
  type AppActionDialogTone,
} from "./AppActionDialog";

export type AppConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  content?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  confirmIcon?: ReactNode;
  icon?: ReactNode;
  contentIcon?: ReactNode | false;
  tone?: AppActionDialogTone;
  hideCancel?: boolean;
  preferenceKey?: ConfirmationPreferenceKey;
  maxWidth?: AppActionDialogProps["maxWidth"];
  dialogClassName?: string;
  paperClassName?: string;
  contentClassName?: string;
  actionsClassName?: string;
};

export function useAppConfirmDialog() {
  const { t } = useI18n();
  const [options, setOptions] = useState<AppConfirmDialogOptions | null>(null);
  const [allowDisable, setAllowDisable] = useState(false);
  const [disableFuture, setDisableFuture] = useState(false);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    const preferenceKey = options?.preferenceKey;
    if (confirmed && disableFuture && preferenceKey && allowDisable) {
      void saveConfirmationPreferences(
        confirmationPreferencesWithOverride(
          getCurrentConfirmationPreferences(),
          preferenceKey,
          false,
        ),
      );
    }
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    setAllowDisable(false);
    setDisableFuture(false);
    resolver?.(confirmed);
  }, [allowDisable, disableFuture, options?.preferenceKey]);

  const confirm = useCallback(async (nextOptions: AppConfirmDialogOptions) => {
    let nextAllowDisable = false;
    if (nextOptions.preferenceKey) {
      const preferences = await loadConfirmationPreferences();
      const decision = resolveConfirmationDecision(preferences, nextOptions.preferenceKey);
      if (!decision.required) {
        return true;
      }
      nextAllowDisable = decision.canDisable;
    }
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setAllowDisable(nextAllowDisable);
      setDisableFuture(false);
      setOptions(nextOptions);
    });
  }, []);

  const dialog = (
    <AppActionDialog
      open={Boolean(options)}
      onClose={() => settle(false)}
      title={options?.title}
      description={options?.description}
      icon={options?.icon}
      contentIcon={options?.contentIcon}
      tone={options?.tone}
      maxWidth={options?.maxWidth}
      className={["app-confirm-dialog", options?.dialogClassName]
        .filter(Boolean)
        .join(" ")}
      paperClassName={options?.paperClassName}
      contentClassName={options?.contentClassName}
      actionsClassName={options?.actionsClassName}
      actions={
        <>
          {!options?.hideCancel ? (
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => settle(false)}
              className="app-action-dialog-cancel"
            >
              {translateNode(options?.cancelLabel ?? "取消", t)}
            </Button>
          ) : null}
          <Button
            autoFocus
            variant="contained"
            color={options?.tone === "danger" ? "error" : "primary"}
            startIcon={options?.confirmIcon}
            onClick={() => settle(true)}
            className="app-action-dialog-confirm"
          >
            {translateNode(options?.confirmLabel ?? "确认", t)}
          </Button>
        </>
      }
    >
      {options?.content || allowDisable ? (
        <Stack className="app-confirm-dialog-custom-content" spacing={1}>
          {options?.content}
          {allowDisable ? (
            <FormControlLabel
              className="app-confirm-dialog-disable-future"
              control={
                <Checkbox
                  size="small"
                  checked={disableFuture}
                  onChange={(event) => setDisableFuture(event.target.checked)}
                />
              }
              label={t("以后直接执行此类操作")}
            />
          ) : null}
        </Stack>
      ) : null}
    </AppActionDialog>
  );

  return [confirm, dialog] as const;
}
