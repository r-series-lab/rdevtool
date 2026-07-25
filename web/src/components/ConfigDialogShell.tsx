import type { ReactNode } from "react";
import {
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  type DialogProps,
} from "@mui/material";
import { useAppConfirmDialog } from "./AppConfirmDialog";

type ConfigDialogShellProps = {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  titleIcon?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  actions?: ReactNode | ((requestClose: () => void) => ReactNode);
  dirty?: boolean;
  dirtyLabel?: string;
  closeDisabled?: boolean;
  maxWidth?: DialogProps["maxWidth"];
  className?: string;
  paperClassName?: string;
  titleClassName?: string;
  titleIconClassName?: string;
  contentClassName?: string;
  actionsClassName?: string;
  onClose: () => void;
};

export function ConfigDialogShell({
  open,
  title,
  subtitle,
  titleIcon,
  headerActions,
  children,
  actions,
  dirty = false,
  dirtyLabel = "未保存",
  closeDisabled = false,
  maxWidth = "lg",
  className,
  paperClassName,
  titleClassName,
  titleIconClassName,
  contentClassName,
  actionsClassName,
  onClose,
}: ConfigDialogShellProps) {
  const [confirm, confirmDialog] = useAppConfirmDialog();

  async function requestClose() {
    if (closeDisabled) return;
    if (dirty) {
      const accepted = await confirm({
        title: "放弃未保存的改动？",
        description: "关闭后，本次尚未保存的配置修改将丢失。",
        confirmLabel: "放弃改动",
        tone: "danger",
        preferenceKey: "configuration.discard",
      });
      if (!accepted) return;
    }
    onClose();
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={() => void requestClose()}
        fullWidth
        maxWidth={maxWidth}
        className={className}
        PaperProps={{ className: paperClassName }}
      >
        <DialogTitle className={titleClassName}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" spacing={titleIcon ? 1 : 0} alignItems="center" minWidth={0}>
              {titleIcon ? (
                <span className={titleIconClassName}>{titleIcon}</span>
              ) : null}
              <Stack spacing={0.1} minWidth={0}>
                <Typography variant="subtitle1" noWrap>
                  {title}
                </Typography>
                {subtitle ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {subtitle}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
            {dirty || headerActions ? (
              <Stack direction="row" spacing={0.6} alignItems="center" flexShrink={0}>
                {dirty ? <Chip size="small" color="primary" label={dirtyLabel} /> : null}
                {headerActions}
              </Stack>
            ) : null}
          </Stack>
        </DialogTitle>
        <DialogContent className={contentClassName}>{children}</DialogContent>
        {actions !== undefined ? (
          <DialogActions className={actionsClassName}>
            {typeof actions === "function" ? actions(() => void requestClose()) : actions}
          </DialogActions>
        ) : null}
      </Dialog>
      {confirmDialog}
    </>
  );
}
