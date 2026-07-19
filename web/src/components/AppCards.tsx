import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { CommitInfo } from "../app-types";

export type HistoryAccent = "success" | "info" | "warning" | "danger" | "neutral";

export function CommitSummaryCard({
  title,
  branch,
  commit,
  emptyText = "未读取",
  formatCommitDate,
}: {
  title: string;
  branch: string;
  commit?: CommitInfo | null;
  emptyText?: string;
  formatCommitDate: (value?: string | null) => string;
}) {
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "16px",
        p: 1.15,
        minWidth: 0,
        bgcolor: "rgba(255,255,255,0.012)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.018)",
      }}
    >
      <Stack spacing={0.45} minWidth={0}>
        <Stack direction="row" spacing={0.6} alignItems="center" minWidth={0}>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {title}
          </Typography>
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
            {branch || "-"}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
          {commit?.subject || emptyText}
        </Typography>
        <Stack direction="row" spacing={0.8} color="text.secondary" minWidth={0}>
          <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
            {commit?.shortHash || "-"}
          </Typography>
          <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
            {formatCommitDate(commit?.committedAt)}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

export function HistoryCard({
  title,
  subtitle,
  badge,
  detail,
  meta,
  children,
  pinned = false,
  accent = "neutral",
}: {
  title: string;
  subtitle: string;
  badge?: ReactNode;
  detail: string;
  meta: string[];
  children?: ReactNode;
  pinned?: boolean;
  accent?: HistoryAccent;
}) {
  return (
    <Card
      variant="outlined"
      className={`app-history-card is-${accent}${pinned ? " is-pinned" : ""}`}
      sx={(theme) => ({
        "--history-accent":
          accent === "success"
            ? "#31b96f"
            : accent === "danger"
              ? "#df5c58"
              : accent === "warning"
                ? "#d9932f"
                : accent === "info"
                  ? theme.palette.primary.main
                  : alpha(theme.palette.text.secondary, 0.52),
        position: "relative",
        overflow: "hidden",
        borderRadius: "14px",
        bgcolor:
          pinned && theme.palette.mode === "dark"
            ? alpha(theme.palette.primary.main, 0.07)
            : pinned
              ? alpha(theme.palette.primary.main, 0.045)
              : theme.palette.mode === "dark"
                ? "rgba(18,22,28,0.42)"
                : "rgba(255,255,255,0.84)",
        borderColor: pinned
          ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.26 : 0.22)
          : theme.palette.mode === "dark"
            ? "rgba(143,184,234,0.085)"
            : "rgba(74,96,122,0.14)",
        boxShadow: pinned
          ? `0 0 0 1px ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.08 : 0.06)}, 0 12px 28px ${alpha(theme.palette.primary.main, 0.08)}`
          : theme.palette.mode === "dark"
            ? "inset 0 1px 0 rgba(255,255,255,0.028), 0 10px 24px rgba(0,0,0,0.14)"
            : "inset 0 1px 0 rgba(255,255,255,0.74), 0 12px 28px rgba(33,52,74,0.05)",
        backdropFilter: "blur(18px) saturate(1.12)",
        WebkitBackdropFilter: "blur(18px) saturate(1.12)",
        minWidth: 0,
        maxWidth: "100%",
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 10,
          bottom: 10,
          width: 4,
          borderRadius: "999px",
          background: "var(--history-accent)",
          boxShadow: `0 0 18px ${alpha(
            accent === "neutral" ? theme.palette.text.secondary : theme.palette.primary.main,
            0.12,
          )}`,
        },
      })}
    >
      <CardContent sx={{ minWidth: 0, maxWidth: "100%", p: 1.35, pl: 1.65, "&:last-child": { pb: 1.35 } }}>
        <Stack spacing={0.62} minWidth={0} maxWidth="100%">
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.1} minWidth={0}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={0.55} alignItems="center" minWidth={0} mb={0.18}>
                {pinned ? (
                  <Box
                    component="span"
                    sx={(theme) => ({
                      flexShrink: 0,
                      px: 0.58,
                      py: 0.14,
                      borderRadius: "999px",
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.primary.main,
                      fontSize: "0.62rem",
                      lineHeight: 1.35,
                      fontWeight: 820,
                    })}
                  >
                    已标记
                  </Box>
                ) : null}
                <Typography
                  className="app-history-card-title"
                  variant="subtitle2"
                  title={title}
                  sx={{
                    minWidth: 0,
                    color: "text.primary",
                    fontWeight: 820,
                    fontSize: "1rem",
                    letterSpacing: 0,
                    lineHeight: 1.24,
                  }}
                  noWrap
                >
                  {title}
                </Typography>
              </Stack>
              <Typography
                className="app-history-card-subtitle"
                variant="caption"
                color="text.secondary"
                title={subtitle}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.55,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.35,
                  fontSize: "0.78rem",
                  fontWeight: 720,
                }}
              >
                {subtitle}
              </Typography>
            </Box>
            <Box className="app-history-card-actions" sx={{ flexShrink: 0, maxWidth: "52%" }}>{badge}</Box>
          </Stack>
          <Typography
            className="app-history-card-detail"
            variant="caption"
            color="text.secondary"
            title={detail}
            sx={{
              display: "-webkit-box",
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflowWrap: "anywhere",
              lineHeight: 1.38,
              fontSize: "0.76rem",
              fontWeight: 650,
            }}
          >
            {detail}
          </Typography>
          <Stack
            className="app-history-card-meta"
            direction="row"
            spacing={0.55}
            flexWrap="wrap"
            useFlexGap
            minWidth={0}
            rowGap={0.35}
          >
            {meta.filter(Boolean).map((item, index) => (
              <Box
                key={`${title}-${index}-${item}`}
                component="span"
                title={item}
                sx={(theme) => ({
                  display: "inline-flex",
                  alignItems: "center",
                  maxWidth: "100%",
                  minHeight: 20,
                  px: 0.72,
                  py: 0.12,
                  borderRadius: "999px",
                  border: "1px solid",
                  borderColor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.common.white, 0.12)
                      : "rgba(63,72,87,0.1)",
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.common.white, 0.045)
                      : "rgba(63,72,87,0.04)",
                  color:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.common.white, 0.72)
                      : "rgba(54,63,77,0.68)",
                  boxShadow:
                    theme.palette.mode === "dark"
                      ? "inset 0 1px 0 rgba(255,255,255,0.035)"
                      : "inset 0 1px 0 rgba(255,255,255,0.72)",
                  fontSize: "0.67rem",
                  fontWeight: 680,
                  lineHeight: 1.25,
                  letterSpacing: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                })}
              >
                <Box
                  component="span"
                  sx={{
                    minWidth: 0,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item}
                </Box>
              </Box>
            ))}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}
