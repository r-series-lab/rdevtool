import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";

type ConfirmTone = "primary" | "danger";

export type AppConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: ConfirmTone;
};

export function useAppConfirmDialog() {
  const [options, setOptions] = useState<AppConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolver?.(confirmed);
  }, []);

  const confirm = useCallback((nextOptions: AppConfirmDialogOptions) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
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
      {options?.description ? (
        <DialogContent sx={{ color: "text.secondary", pt: 0.5 }}>
          {options.description}
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
