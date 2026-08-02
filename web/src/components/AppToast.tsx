import { useEffect, useState } from "react";
import { Alert, Snackbar } from "@mui/material";
import type { AlertProps } from "@mui/material/Alert";
import { useI18n, type TranslationParams } from "../i18n";
import { translateInternalMessage } from "../i18n/internalMessages";

type AppToastSeverity = NonNullable<AlertProps["severity"]>;

type AppToastProps = {
  message: string;
  messageKey?: string;
  messageParams?: TranslationParams;
  severity?: AppToastSeverity;
  autoHideDuration?: number;
  nonce?: number;
};

export function AppToast({
  message,
  messageKey,
  messageParams,
  severity = "info",
  autoHideDuration = 3200,
  nonce = 0,
}: AppToastProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(Boolean(message));
  const localizedMessage = messageKey
    ? t(messageKey, messageParams)
    : translateInternalMessage(message, t);

  useEffect(() => {
    setOpen(Boolean(message));
  }, [message, nonce]);

  if (!message) {
    return null;
  }

  return (
    <Snackbar
      key={`${severity}:${nonce}:${localizedMessage}`}
      open={open}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      autoHideDuration={autoHideDuration}
      onClose={(_, reason) => {
        if (reason !== "clickaway") {
          setOpen(false);
        }
      }}
      sx={{
        top: "calc(var(--window-drag-height, 44px) + 10px) !important",
        zIndex: (theme) => theme.zIndex.snackbar + 40,
        pointerEvents: "none",
        "& .MuiAlert-root": {
          minWidth: 220,
          maxWidth: "min(560px, calc(100vw - 48px))",
          borderRadius: "14px",
          alignItems: "center",
          fontSize: 14,
          fontWeight: 760,
          letterSpacing: 0,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          pointerEvents: "auto",
          boxShadow: (theme) =>
            theme.palette.mode === "dark"
              ? "0 18px 46px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.07)"
              : "0 18px 46px rgba(87, 102, 121, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
        },
      }}
    >
      <Alert
        severity={severity}
        variant="standard"
        onClose={() => setOpen(false)}
        sx={(theme) => ({
          color: theme.palette.text.primary,
          border: "1px solid",
          borderColor:
            theme.palette.mode === "dark"
              ? "rgba(144, 162, 184, 0.22)"
              : "rgba(116, 134, 154, 0.2)",
          backgroundColor:
            theme.palette.mode === "dark"
              ? "rgba(16, 21, 29, 0.9)"
              : "rgba(248, 251, 254, 0.92)",
          "& .MuiAlert-icon": {
            color:
              severity === "success"
                ? theme.palette.success.main
                : severity === "error"
                  ? theme.palette.error.main
                  : severity === "warning"
                    ? theme.palette.warning.main
                    : theme.palette.info.main,
          },
          "& .MuiAlert-message": {
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        })}
      >
        {localizedMessage}
      </Alert>
    </Snackbar>
  );
}
