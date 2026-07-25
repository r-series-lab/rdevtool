import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
} from "@mui/material";
import {
  confirmationCanBeDisabled,
  confirmationEnabled,
  confirmationPreferencesWithOverride,
  getCurrentConfirmationPreferences,
  loadConfirmationPreferences,
  saveConfirmationPreferences,
  type ConfirmationPreferenceKey,
} from "../lib/confirmationPreferences";

type ConfirmTone = "primary" | "danger";

export type AppConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: ConfirmTone;
  preferenceKey?: ConfirmationPreferenceKey;
};

export function useAppConfirmDialog() {
  const [options, setOptions] = useState<AppConfirmDialogOptions | null>(null);
  const [allowDisable, setAllowDisable] = useState(false);
  const [disableFuture, setDisableFuture] = useState(false);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

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
      if (!confirmationEnabled(preferences, nextOptions.preferenceKey)) {
        return true;
      }
      nextAllowDisable =
        preferences.mode !== "strict" &&
        confirmationCanBeDisabled(nextOptions.preferenceKey);
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
    <Dialog
      open={Boolean(options)}
      onClose={() => settle(false)}
      maxWidth="xs"
      fullWidth
      className="app-confirm-dialog"
    >
      <DialogTitle>{options?.title}</DialogTitle>
      {options?.description || allowDisable ? (
        <DialogContent sx={{ color: "text.secondary", pt: 0.5 }}>
          {options?.description}
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
              label="以后不再确认此类操作"
            />
          ) : null}
        </DialogContent>
      ) : null}
      <DialogActions>
        <Button color="inherit" onClick={() => settle(false)}>
          {options?.cancelLabel ?? "取消"}
        </Button>
        <Button
          variant="contained"
          color={options?.tone === "danger" ? "error" : "primary"}
          onClick={() => settle(true)}
        >
          {options?.confirmLabel ?? "确认"}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return [confirm, dialog] as const;
}
