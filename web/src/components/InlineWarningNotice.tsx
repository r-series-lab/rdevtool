import {
  Button,
  Stack,
  Typography,
} from "@mui/material";

type InlineWarningNoticeProps = {
  title: string;
  details?: string[];
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
};

export function InlineWarningNotice({
  title,
  details = [],
  actionLabel = "重置",
  actionDisabled = false,
  onAction,
}: InlineWarningNoticeProps) {
  const detailText = details.filter(Boolean).join("、");

  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="baseline"
      flexWrap="wrap"
      rowGap={0.2}
      minWidth={0}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          minWidth: 0,
          fontSize: "0.7rem",
          fontWeight: 500,
          lineHeight: 1.4,
          overflowWrap: "anywhere",
        }}
      >
        {title}
        {detailText ? `：${detailText}` : ""}
      </Typography>

      {onAction ? (
        <Button
          size="small"
          variant="text"
          color="primary"
          disabled={actionDisabled}
          onClick={onAction}
          sx={{
            minWidth: 0,
            minHeight: 20,
            px: 0.25,
            py: 0,
            fontSize: "0.7rem",
            fontWeight: 760,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          {actionLabel}
        </Button>
      ) : null}
    </Stack>
  );
}
