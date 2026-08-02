import { useId, type ReactNode } from "react";
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  type DialogProps,
} from "@mui/material";
import { translateNode, useI18n } from "../i18n";
import {
  CheckIcon,
  ClearIcon,
  InfoIcon,
  ReplayIcon,
  TrashIcon,
  WarningIcon,
} from "./AppIcons";

export type AppActionDialogTone =
  | "primary"
  | "danger"
  | "warning"
  | "neutral"
  | "retry";

export type AppActionDialogProps = {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  contentIcon?: ReactNode | false;
  headerActions?: ReactNode;
  tone?: AppActionDialogTone;
  busy?: boolean;
  hideClose?: boolean;
  closeLabel?: string;
  maxWidth?: DialogProps["maxWidth"];
  className?: string;
  paperClassName?: string;
  contentClassName?: string;
  actionsClassName?: string;
  onClose: () => void;
};

function defaultTitleIcon(tone: AppActionDialogTone) {
  switch (tone) {
    case "danger":
      return <TrashIcon />;
    case "warning":
      return <WarningIcon />;
    case "retry":
      return <ReplayIcon />;
    case "neutral":
      return <InfoIcon />;
    default:
      return <CheckIcon />;
  }
}

function defaultContentIcon(tone: AppActionDialogTone) {
  return tone === "danger" || tone === "warning" ? (
    <WarningIcon />
  ) : (
    <InfoIcon />
  );
}

export function AppActionDialog({
  open,
  title,
  subtitle,
  description,
  children,
  actions,
  icon,
  contentIcon,
  headerActions,
  tone = "primary",
  busy = false,
  hideClose = false,
  closeLabel = "关闭弹窗",
  maxWidth = "xs",
  className,
  paperClassName,
  contentClassName,
  actionsClassName,
  onClose,
}: AppActionDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const hasDescription = description !== undefined && description !== null;
  const hasChildren =
    children !== undefined && children !== null && children !== false;
  const hasContent = hasDescription || hasChildren;
  const hasActions =
    actions !== undefined && actions !== null && actions !== false;
  const resolvedContentIcon =
    contentIcon === false ? null : contentIcon ?? defaultContentIcon(tone);

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      disableEscapeKeyDown={busy}
      fullWidth
      maxWidth={maxWidth}
      aria-labelledby={titleId}
      className={[
        "app-action-dialog",
        `app-action-dialog--${tone}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      PaperProps={{
        className: ["app-action-dialog-paper", paperClassName]
          .filter(Boolean)
          .join(" "),
      }}
    >
      <DialogTitle component="div" className="app-action-dialog-title">
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.25}
          className="app-action-dialog-header"
        >
          <Box className="app-action-dialog-title-icon">
            {icon ?? defaultTitleIcon(tone)}
          </Box>
          <Box className="app-action-dialog-heading">
            <Box id={titleId} component="h2" className="app-action-dialog-title-text">
              {translateNode(title, t)}
            </Box>
            {subtitle !== undefined ? (
              <Box className="app-action-dialog-subtitle">
                {translateNode(subtitle, t)}
              </Box>
            ) : null}
          </Box>
          {headerActions ? (
            <Box className="app-action-dialog-header-actions">{headerActions}</Box>
          ) : null}
          {!hideClose ? (
            <Tooltip title={t(closeLabel)}>
              <span>
                <IconButton
                  size="small"
                  disabled={busy}
                  onClick={onClose}
                  aria-label={t(closeLabel)}
                  className="app-action-dialog-close"
                >
                  <ClearIcon />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Stack>
      </DialogTitle>
      {hasContent ? (
        <DialogContent
          className={[
            "app-action-dialog-content",
            contentClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {hasDescription ? (
            <Box
              className={[
                "app-action-dialog-message",
                resolvedContentIcon ? "has-icon" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {resolvedContentIcon ? (
                <Box className="app-action-dialog-content-icon">
                  {resolvedContentIcon}
                </Box>
              ) : null}
              <Box className="app-action-dialog-description">
                {translateNode(description, t)}
              </Box>
            </Box>
          ) : null}
          {hasChildren ? (
            <Box className="app-action-dialog-children">{children}</Box>
          ) : null}
        </DialogContent>
      ) : null}
      {hasActions ? (
        <DialogActions
          className={[
            "app-action-dialog-actions",
            actionsClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {actions}
        </DialogActions>
      ) : null}
    </Dialog>
  );
}
