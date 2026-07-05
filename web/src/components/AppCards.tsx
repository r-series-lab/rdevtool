import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { CommitInfo } from "../app-types";

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
}: {
  title: string;
  subtitle: string;
  badge?: ReactNode;
  detail: string;
  meta: string[];
  children?: ReactNode;
  pinned?: boolean;
}) {
  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        borderRadius: "12px",
        bgcolor:
          pinned && theme.palette.mode === "dark"
            ? alpha(theme.palette.primary.main, 0.055)
            : pinned
              ? alpha(theme.palette.primary.main, 0.04)
              : theme.palette.mode === "dark"
                ? "rgba(18,22,28,0.34)"
                : "rgba(246,249,252,0.42)",
        borderColor: pinned
          ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.26 : 0.22)
          : theme.palette.mode === "dark"
            ? "rgba(143,184,234,0.085)"
            : "rgba(52,76,96,0.092)",
        boxShadow: pinned
          ? `inset 2px 0 0 ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.52 : 0.46)}`
          : theme.palette.mode === "dark"
            ? "inset 0 1px 0 rgba(255,255,255,0.028), 0 7px 18px rgba(0,0,0,0.12)"
            : "inset 0 1px 0 rgba(255,255,255,0.44), 0 7px 18px rgba(24,48,62,0.038)",
        backdropFilter: "blur(16px) saturate(1.1)",
        WebkitBackdropFilter: "blur(16px) saturate(1.1)",
        minWidth: 0,
        maxWidth: "100%",
      })}
    >
      <CardContent sx={{ minWidth: 0, maxWidth: "100%", p: 1.05, "&:last-child": { pb: 1.05 } }}>
        <Stack spacing={0.38} minWidth={0} maxWidth="100%">
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} minWidth={0}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={0.55} alignItems="center" minWidth={0}>
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
                <Typography variant="subtitle2" sx={{ minWidth: 0, fontWeight: 740, fontSize: "0.9rem" }} noWrap>
                  {title}
                </Typography>
              </Stack>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: "block",
                  mt: 0.25,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.35,
                }}
              >
                {subtitle}
              </Typography>
            </Box>
            <Box sx={{ flexShrink: 0, maxWidth: "46%" }}>{badge}</Box>
          </Stack>
          <Typography
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
            }}
          >
            {detail}
          </Typography>
          <Stack
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
