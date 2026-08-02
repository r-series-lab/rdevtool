import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppExitRuntimePolicy } from "../app-types";
import { disposeTauriListener } from "../lib/tauriEvents";
import { AppActionDialog } from "./AppActionDialog";
import { PowerIcon } from "./AppIcons";
import { useI18n } from "../i18n";

const APP_EXIT_REQUESTED_EVENT = "rdevtool://app-exit-requested";
const APP_EXIT_FAILED_EVENT = "rdevtool://app-exit-failed";

type AppExitRequestedPayload = {
  activeRuntimeCount: number;
  projectNames: string[];
};

type AppExitFailedPayload = {
  message: string;
};

type AppExitDialogProps = {
  onError: (message: string) => void;
};

export function AppExitDialog({ onError }: AppExitDialogProps) {
  const { t } = useI18n();
  const [request, setRequest] = useState<AppExitRequestedPayload | null>(null);
  const [remember, setRemember] = useState(false);
  const [busyPolicy, setBusyPolicy] = useState<AppExitRuntimePolicy | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlistenRequested: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;

    void Promise.allSettled([
      listen<AppExitRequestedPayload>(APP_EXIT_REQUESTED_EVENT, (event) => {
        setRequest(event.payload);
        setRemember(false);
        setBusyPolicy(null);
      }),
      listen<AppExitFailedPayload>(APP_EXIT_FAILED_EVENT, (event) => {
        setRequest(null);
        setBusyPolicy(null);
        onError(event.payload.message);
      }),
    ]).then(([requestedResult, failedResult]) => {
      const registeredListeners = [
        [requestedResult, "退出确认"],
        [failedResult, "退出失败"],
      ] as const;

      for (const [result, label] of registeredListeners) {
        if (result.status === "rejected") {
          if (!disposed) {
            onError(
              t("监听{label}事件失败：{reason}", {
                label: t(label),
                reason: String(result.reason),
              }),
            );
          }
          continue;
        }
        if (disposed) {
          disposeTauriListener(result.value);
          continue;
        }
        if (label === "退出确认") {
          unlistenRequested = result.value;
        } else {
          unlistenFailed = result.value;
        }
      }
    });

    return () => {
      disposed = true;
      disposeTauriListener(unlistenRequested);
      disposeTauriListener(unlistenFailed);
    };
  }, [onError, t]);

  async function cancelExit() {
    if (busyPolicy) {
      return;
    }
    setRequest(null);
    await invoke("cancel_app_exit").catch((reason) => onError(String(reason)));
  }

  async function confirmExit(policy: Exclude<AppExitRuntimePolicy, "ask">) {
    setBusyPolicy(policy);
    try {
      await invoke("confirm_app_exit", { policy, remember });
    } catch (reason) {
      setBusyPolicy(null);
      onError(String(reason));
    }
  }

  const projectNames = request?.projectNames ?? [];

  return (
    <AppActionDialog
      open={Boolean(request)}
      onClose={() => void cancelExit()}
      busy={Boolean(busyPolicy)}
      className="app-confirm-dialog"
      tone="warning"
      icon={<PowerIcon />}
      title={t("退出 rDevTool？")}
      description={t("本次启动的 {count} 个项目仍在运行。", {
        count: request?.activeRuntimeCount ?? 0,
      })}
      actions={
        <>
          <Button
            variant="outlined"
            color="inherit"
            disabled={Boolean(busyPolicy)}
            onClick={() => void cancelExit()}
            className="app-action-dialog-cancel"
          >
            {t("取消")}
          </Button>
          <Button
            color="inherit"
            disabled={Boolean(busyPolicy)}
            onClick={() => void confirmExit("keep")}
          >
            {t(busyPolicy === "keep" ? "正在退出" : "保持运行并退出")}
          </Button>
          <Button
            autoFocus
            variant="contained"
            color="warning"
            disabled={Boolean(busyPolicy)}
            onClick={() => void confirmExit("stop")}
            className="app-action-dialog-confirm"
          >
            {t(busyPolicy === "stop" ? "正在停止" : "停止并退出")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.15}>
        {projectNames.length > 0 ? (
          <Typography variant="body2" color="text.secondary" noWrap>
            {projectNames.join("、")}
          </Typography>
        ) : null}
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
          }
          label={t("记住我的选择")}
        />
      </Stack>
    </AppActionDialog>
  );
}
