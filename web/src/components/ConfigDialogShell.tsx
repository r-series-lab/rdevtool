import type { ReactNode } from "react";
import {
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  type DialogProps,
} from "@mui/material";
import { translateNode, useI18n } from "../i18n";
import { useAppConfirmDialog } from "./AppConfirmDialog";
import { ClearIcon } from "./AppIcons";

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
  showClose?: boolean;
  closeLabel?: string;
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
  showClose = true,
  closeLabel = "关闭",
  maxWidth = "lg",
  className,
  paperClassName,
  titleClassName,
  titleIconClassName,
  contentClassName,
  actionsClassName,
  onClose,
}: ConfigDialogShellProps) {
  const { t } = useI18n();
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
        className={`config-dialog-shell ${className ?? ""}`}
        PaperProps={{ className: `config-dialog-shell-paper ${paperClassName ?? ""}` }}
      >
        <DialogTitle className={`config-dialog-shell-title ${titleClassName ?? ""}`}>
          <Stack
            className="config-dialog-shell-heading"
            direction="row"
            alignItems="flex-start"
            justifyContent="space-between"
            spacing={1}
          >
            <Stack direction="row" spacing={titleIcon ? 1 : 0} alignItems="center" minWidth={0}>
              {titleIcon ? (
                <span className={`config-dialog-shell-title-icon ${titleIconClassName ?? ""}`}>{titleIcon}</span>
              ) : null}
              <Stack spacing={0.1} minWidth={0}>
                <Typography variant="subtitle1" noWrap>
                  {translateNode(title, t)}
                </Typography>
                {subtitle ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {translateNode(subtitle, t)}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
            <Stack direction="row" spacing={0.6} alignItems="center" flexShrink={0}>
              {dirty ? <Chip size="small" color="primary" label={t(dirtyLabel)} /> : null}
              {headerActions}
              {showClose ? (
                <Tooltip title={t(closeLabel)}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t(closeLabel)}
                      disabled={closeDisabled}
                      onClick={() => void requestClose()}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent className={`config-dialog-shell-content ${contentClassName ?? ""}`}>{children}</DialogContent>
        {actions !== undefined ? (
          <DialogActions className={`config-dialog-shell-actions ${actionsClassName ?? ""}`}>
            {typeof actions === "function" ? actions(() => void requestClose()) : actions}
          </DialogActions>
        ) : null}
      </Dialog>
      {confirmDialog}
    </>
  );
}
