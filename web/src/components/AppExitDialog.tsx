import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppExitRuntimePolicy } from "../app-types";
import { disposeTauriListener } from "../lib/tauriEvents";

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
            onError(`监听${label}事件失败：${String(result.reason)}`);
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
  }, [onError]);

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
    <Dialog
      open={Boolean(request)}
      onClose={() => void cancelExit()}
      maxWidth="xs"
      fullWidth
      className="app-confirm-dialog"
    >
      <DialogTitle>退出 rDevTool？</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography color="text.secondary">
            本次启动的 {request?.activeRuntimeCount ?? 0} 个项目仍在运行。
          </Typography>
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
            label="记住我的选择"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" disabled={Boolean(busyPolicy)} onClick={() => void cancelExit()}>
          取消
        </Button>
        <Button
          color="inherit"
          disabled={Boolean(busyPolicy)}
          onClick={() => void confirmExit("keep")}
        >
          {busyPolicy === "keep" ? "正在退出" : "保持运行并退出"}
        </Button>
        <Button
          variant="contained"
          disabled={Boolean(busyPolicy)}
          onClick={() => void confirmExit("stop")}
        >
          {busyPolicy === "stop" ? "正在停止" : "停止并退出"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
