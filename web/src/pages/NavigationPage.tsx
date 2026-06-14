import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { type KeyboardEvent } from "react";
import {
  AppWindowIcon,
  ClearIcon,
  OpenExternalIcon,
  TerminalIcon,
} from "../components/AppIcons";
import { shouldHandlePrimaryEnter } from "../lib/keyboard";

type NavigationEntry = {
  name: string;
  kind: string;
  targetLabel: string;
  url?: string | null;
  browser?: string | null;
  browserProfile?: string | null;
  runtimeProfile?: string | null;
  bundleId?: string | null;
  appName?: string | null;
  script?: string | null;
  cwd?: string | null;
  note?: string | null;
};

type NavigationCategory = {
  title: string;
  shortLabel: string;
  entries: NavigationEntry[];
};

export type NavigationPageProps = {
  navigationCategories: NavigationCategory[];
  navigationCategory: string;
  onNavigationCategoryChange: (value: string) => void;
  navigationTypeOptions: readonly string[];
  navigationTypeFilter: string;
  navigationTypeCounts: Record<string, number>;
  navigationCategoryCounts: Record<string, number>;
  onNavigationTypeFilterChange: (value: string) => void;
  navigationQuery: string;
  onNavigationQueryChange: (value: string) => void;
  filteredNavigationResults: Array<{
    category: NavigationCategory;
    entry: NavigationEntry;
  }>;
  selectedNavigationEntries: NavigationEntry[];
  navigationPreferredCategory?: string | null;
  onOpenNavigation: (entry: NavigationEntry) => void;
};

function navigationKindLabel(kind: string) {
  switch (kind) {
    case "app":
      return "应用";
    case "script":
      return "脚本";
    default:
      return "网页";
  }
}

function NavigationKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "app":
      return <AppWindowIcon fontSize="inherit" />;
    case "script":
      return <TerminalIcon fontSize="inherit" />;
    default:
      return <OpenExternalIcon fontSize="inherit" />;
  }
}

export function NavigationPage({
  navigationCategories,
  navigationCategory,
  onNavigationCategoryChange,
  navigationTypeOptions,
  navigationTypeFilter,
  navigationTypeCounts,
  navigationCategoryCounts,
  onNavigationTypeFilterChange,
  navigationQuery,
  onNavigationQueryChange,
  filteredNavigationResults,
  selectedNavigationEntries,
  navigationPreferredCategory,
  onOpenNavigation,
}: NavigationPageProps) {
  const theme = useTheme();
  const mono = theme.palette.mode === "dark";
  const isSearching = Boolean(navigationQuery.trim());
  const displayItems = navigationQuery.trim()
    ? filteredNavigationResults.map((item) => ({
        categoryTitle: item.category.title,
        categoryLabel: item.category.shortLabel,
        entry: item.entry,
      }))
    : selectedNavigationEntries.map((entry) => ({
        categoryTitle: navigationCategory,
        categoryLabel:
          navigationCategories.find((item) => item.title === navigationCategory)?.shortLabel ??
          navigationCategory,
        entry,
      }));
  const firstEntry = navigationQuery.trim()
    ? filteredNavigationResults[0]?.entry
    : selectedNavigationEntries[0];
  const resultCount = navigationQuery.trim()
    ? filteredNavigationResults.length
    : selectedNavigationEntries.length;
  const shellTone = mono
    ? {
        heroBg: "rgba(15,22,32,0.9)",
        heroBorder: "rgba(139,169,208,0.12)",
        heroHighlight: "rgba(255,255,255,0.032)",
        helperText: "rgba(228,233,240,0.48)",
        searchWrapBg: "rgba(9,11,15,0.28)",
        searchInnerBg: "rgba(255,255,255,0.018)",
        searchBorder: "rgba(255,255,255,0.06)",
        searchHintBg: "rgba(255,255,255,0.026)",
        searchHintColor: "rgba(228,233,240,0.56)",
        sectionBg: "rgba(15,22,32,0.68)",
        sectionBorder: "rgba(139,169,208,0.1)",
        sectionHighlight: "rgba(255,255,255,0.024)",
        countBg: "rgba(255,255,255,0.055)",
        countColor: "rgba(241,244,248,0.74)",
        emptyBg: "rgba(255,255,255,0.02)",
        emptyText: "rgba(223,228,235,0.56)",
      }
    : {
        heroBg: "rgba(255,255,255,0.86)",
        heroBorder: "rgba(42,82,132,0.14)",
        heroHighlight: "rgba(255,255,255,0.6)",
        helperText: "rgba(52,60,74,0.52)",
        searchWrapBg: "rgba(255,255,255,0.48)",
        searchInnerBg: "rgba(255,255,255,0.72)",
        searchBorder: "rgba(42,82,132,0.12)",
        searchHintBg: "rgba(37,99,235,0.055)",
        searchHintColor: "rgba(52,60,74,0.58)",
        sectionBg: "rgba(255,255,255,0.78)",
        sectionBorder: "rgba(42,82,132,0.12)",
        sectionHighlight: "rgba(255,255,255,0.58)",
        countBg: "rgba(42,50,66,0.06)",
        countColor: "rgba(38,44,56,0.64)",
        emptyBg: "rgba(255,255,255,0.42)",
        emptyText: "rgba(60,68,82,0.58)",
      };
  const primaryFilterTone = mono
    ? {
        wrapBg: "rgba(255,255,255,0.032)",
        wrapBorder: "rgba(255,255,255,0.065)",
        activeBg: "#eef2f6",
        activeColor: "#111319",
        activeBorder: "rgba(255,255,255,0.12)",
        activeShadow: "0 10px 22px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.72)",
        idleBg: "transparent",
        idleColor: "rgba(231,236,242,0.68)",
        idleBorder: "rgba(255,255,255,0.05)",
        idleHover: "rgba(255,255,255,0.028)",
      }
    : {
        wrapBg: "rgba(37,99,235,0.04)",
        wrapBorder: "rgba(37,99,235,0.12)",
        activeBg: "rgba(37,99,235,0.92)",
        activeColor: "#ffffff",
        activeBorder: "rgba(37,99,235,0.18)",
        activeShadow: "0 8px 18px rgba(37,99,235,0.14)",
        idleBg: "transparent",
        idleColor: "rgba(52,60,74,0.62)",
        idleBorder: "rgba(37,99,235,0.08)",
        idleHover: "rgba(37,99,235,0.05)",
      };
  const secondaryFilterTone = mono
    ? {
        label: "rgba(226,231,238,0.46)",
        wrapBg: "rgba(255,255,255,0.014)",
        wrapBorder: "rgba(255,255,255,0.042)",
        activeBg: "rgba(255,255,255,0.062)",
        activeColor: "#f2f5f9",
        activeBorder: "rgba(255,255,255,0.085)",
        idleBg: "transparent",
        idleColor: "rgba(226,231,238,0.46)",
        idleBorder: "rgba(255,255,255,0.04)",
        idleHover: "rgba(255,255,255,0.024)",
      }
    : {
        label: "rgba(60,68,82,0.52)",
        wrapBg: "rgba(255,255,255,0.38)",
        wrapBorder: "rgba(42,82,132,0.1)",
        activeBg: "rgba(37,99,235,0.08)",
        activeColor: "#1f5bce",
        activeBorder: "rgba(37,99,235,0.16)",
        idleBg: "transparent",
        idleColor: "rgba(60,68,82,0.6)",
        idleBorder: "rgba(42,82,132,0.08)",
        idleHover: "rgba(37,99,235,0.04)",
      };
  const entryTone = mono
    ? {
        cardBg: "rgba(19,28,40,0.72)",
        cardBorder: "rgba(139,169,208,0.1)",
        cardHover: "rgba(24,35,50,0.84)",
        iconBg: "rgba(255,255,255,0.04)",
        iconBorder: "rgba(255,255,255,0.06)",
        metaBg: "rgba(255,255,255,0.042)",
        metaBorder: "rgba(255,255,255,0.05)",
        metaColor: "rgba(233,238,244,0.68)",
        targetColor: "rgba(223,228,235,0.64)",
        noteColor: "rgba(223,228,235,0.48)",
      }
    : {
        cardBg: "rgba(255,255,255,0.72)",
        cardBorder: "rgba(42,82,132,0.11)",
        cardHover: "rgba(255,255,255,0.9)",
        iconBg: "rgba(37,99,235,0.055)",
        iconBorder: "rgba(37,99,235,0.12)",
        metaBg: "rgba(42,82,132,0.055)",
        metaBorder: "rgba(42,82,132,0.08)",
        metaColor: "rgba(38,44,56,0.68)",
        targetColor: "rgba(52,60,74,0.66)",
        noteColor: "rgba(60,68,82,0.54)",
      };
  const showCategorySection = navigationCategories.length > 1;

  function handlePrimaryEnter(event: KeyboardEvent<HTMLElement>) {
    if (!shouldHandlePrimaryEnter(event) || !firstEntry) {
      return;
    }
    event.preventDefault();
    onOpenNavigation(firstEntry);
  }

  return (
    <Box
      className="workspace workspace--narrow"
      onKeyDown={handlePrimaryEnter}
      sx={{
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflowX: "clip",
      }}
    >
      <Card
        variant="outlined"
        sx={{
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
          borderRadius: "18px",
          background: shellTone.heroBg,
          borderColor: shellTone.heroBorder,
          boxShadow: mono
            ? "0 26px 52px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.028)"
            : undefined,
        }}
      >
        <CardContent sx={{ p: "14px !important" }}>
          <Stack spacing={1.1}>
            <Box
              sx={{
                minWidth: 0,
                p: 0.7,
                borderRadius: "16px",
                border: "1px solid",
                borderColor: shellTone.searchBorder,
                bgcolor: shellTone.searchWrapBg,
                boxShadow: `inset 0 1px 0 ${shellTone.heroHighlight}`,
              }}
            >
              <Stack spacing={0.75}>
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    p: 0.45,
                    borderRadius: "14px",
                    border: "1px solid",
                    borderColor: shellTone.searchBorder,
                    bgcolor: shellTone.searchInnerBg,
                  }}
                >
                  <Stack direction="row" spacing={0.8} alignItems="center">
                    <TextField
                      fullWidth
                      value={navigationQuery}
                      onChange={(event) => onNavigationQueryChange(event.target.value)}
                      placeholder="搜索入口、路径或备注"
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          bgcolor: "transparent",
                          boxShadow: "none",
                          "& .MuiOutlinedInput-notchedOutline": {
                            borderColor: "transparent",
                          },
                          "&:hover .MuiOutlinedInput-notchedOutline": {
                            borderColor: "transparent",
                          },
                          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                            borderColor: "transparent",
                          },
                        },
                        "& .MuiOutlinedInput-input": {
                          px: 0.6,
                          py: 0.95,
                          fontSize: "1rem",
                        },
                      }}
                    />
                    <IconButton
                      onClick={() => onNavigationQueryChange("")}
                      disabled={!navigationQuery}
                      aria-label="清空搜索"
                      title="清空搜索"
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>

                <Stack
                  direction={{ xs: "column", md: "row" }}
                  alignItems={{ xs: "stretch", md: "center" }}
                  spacing={0.75}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      minWidth: { md: 40 },
                      fontWeight: 700,
                      letterSpacing: "0.07em",
                      color: secondaryFilterTone.label,
                    }}
                  >
                    类型
                  </Typography>
                  <Box
                    sx={{
                      flex: 1,
                      p: { xs: 0.42, sm: 0.5 },
                      minWidth: 0,
                      borderRadius: { xs: "14px", sm: "15px" },
                      border: "1px solid",
                      borderColor: primaryFilterTone.wrapBorder,
                      bgcolor: primaryFilterTone.wrapBg,
                      boxShadow: mono
                        ? "inset 0 1px 0 rgba(255,255,255,0.018)"
                        : "inset 0 1px 0 rgba(255,255,255,0.5)",
                    }}
                  >
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${navigationTypeOptions.length}, minmax(0, 1fr))`,
                        gap: { xs: 0.45, sm: 0.55 },
                      }}
                    >
                      {navigationTypeOptions.map((type) => {
                        const active = type === navigationTypeFilter;
                        return (
                          <Box
                            key={type}
                            component="button"
                            type="button"
                            onClick={() => onNavigationTypeFilterChange(type)}
                            sx={{
                              width: "100%",
                              minWidth: 0,
                              height: { xs: 34, sm: 33 },
                              px: { xs: 0.72, sm: 0.9 },
                              borderRadius: { xs: "12px", sm: "13px" },
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: { xs: 0.3, sm: 0.45 },
                              cursor: "pointer",
                              appearance: "none",
                              textAlign: "left",
                              fontWeight: active ? 700 : 600,
                              fontSize: { xs: "0.78rem", sm: "0.82rem" },
                              letterSpacing: "0.01em",
                              bgcolor: active
                                ? primaryFilterTone.activeBg
                                : primaryFilterTone.idleBg,
                              color: active
                                ? primaryFilterTone.activeColor
                                : primaryFilterTone.idleColor,
                              border: "1px solid",
                              borderColor: active
                                ? primaryFilterTone.activeBorder
                                : primaryFilterTone.idleBorder,
                              boxShadow: active ? primaryFilterTone.activeShadow : "none",
                              "&:hover": {
                                bgcolor: active
                                  ? primaryFilterTone.activeBg
                                  : primaryFilterTone.idleHover,
                              },
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {type}
                            </Box>
                            <Box
                              component="span"
                              sx={{
                                flexShrink: 0,
                                minWidth: { xs: 16, sm: 18 },
                                px: { xs: 0.28, sm: 0.36 },
                                py: 0.04,
                                borderRadius: "999px",
                                bgcolor: active
                                  ? mono
                                    ? "rgba(17,19,25,0.12)"
                                    : "rgba(255,255,255,0.2)"
                                  : mono
                                    ? "rgba(255,255,255,0.06)"
                                    : "rgba(37,99,235,0.08)",
                                color: "inherit",
                                fontSize: { xs: "0.56rem", sm: "0.62rem" },
                                lineHeight: 1.32,
                                textAlign: "center",
                              }}
                            >
                              {navigationTypeCounts[type] ?? 0}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                </Stack>
              </Stack>
            </Box>

            {navigationCategories.length > 0 ? (
              <>
                {showCategorySection ? (
                  <Box
                    sx={{
                      p: 0.78,
                      borderRadius: { xs: "12px", sm: "13px" },
                      border: "1px solid",
                      borderColor: secondaryFilterTone.wrapBorder,
                      bgcolor: secondaryFilterTone.wrapBg,
                      boxShadow: `inset 0 1px 0 ${shellTone.heroHighlight}`,
                    }}
                  >
                    <Stack spacing={0.75}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          letterSpacing: "0.07em",
                          color: secondaryFilterTone.label,
                        }}
                      >
                        分类
                      </Typography>
                      <Box
                        sx={{
                          minWidth: 0,
                          width: "100%",
                          maxWidth: "100%",
                          overflow: "hidden",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 0.6,
                        }}
                      >
                        {navigationCategories.map((category) => {
                          const active = category.title === navigationCategory;
                          return (
                            <Box
                              key={category.title}
                              component="button"
                              type="button"
                              onClick={() => onNavigationCategoryChange(category.title)}
                              sx={{
                                flex: "0 1 auto",
                                width: "auto",
                                maxWidth: "min(100%, 214px)",
                                minWidth: 0,
                                overflow: "hidden",
                                height: { xs: 30, sm: 28 },
                                borderRadius: { xs: "9px", sm: "10px" },
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 0.42,
                                px: { xs: 0.72, sm: 0.64 },
                                cursor: "pointer",
                                appearance: "none",
                                textAlign: "left",
                                fontWeight: active ? 650 : 560,
                                fontSize: { xs: "0.74rem", sm: "0.7rem" },
                                bgcolor: active
                                  ? secondaryFilterTone.activeBg
                                  : secondaryFilterTone.idleBg,
                                color: active
                                  ? secondaryFilterTone.activeColor
                                  : secondaryFilterTone.idleColor,
                                border: "1px solid",
                                borderColor: active
                                  ? secondaryFilterTone.activeBorder
                                  : secondaryFilterTone.idleBorder,
                                "&:hover": {
                                  bgcolor: active
                                    ? secondaryFilterTone.activeBg
                                    : secondaryFilterTone.idleHover,
                                },
                              }}
                            >
                              <Box
                                component="span"
                                sx={{
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {category.shortLabel}
                              </Box>
                              <Box
                                component="span"
                                sx={{
                                  flexShrink: 0,
                                  minWidth: 16,
                                  px: 0.32,
                                  borderRadius: "999px",
                                  bgcolor: active
                                    ? mono
                                      ? "rgba(255,255,255,0.08)"
                                      : "rgba(37,99,235,0.1)"
                                    : "transparent",
                                  fontSize: "0.56rem",
                                  lineHeight: 1.3,
                                  opacity: active ? 0.95 : 0.62,
                                  textAlign: "center",
                                }}
                              >
                                {navigationCategoryCounts[category.title] ?? 0}
                              </Box>
                            </Box>
                          );
                        })}
                      </Box>
                    </Stack>
                  </Box>
                ) : null}

                <Box
                  sx={{
                    minWidth: 0,
                    maxWidth: "100%",
                    overflow: "hidden",
                    p: { xs: 0.72, sm: 0.82 },
                    borderRadius: { xs: "15px", sm: "16px" },
                    border: "1px solid",
                    borderColor: shellTone.sectionBorder,
                    bgcolor: shellTone.sectionBg,
                    boxShadow: `inset 0 1px 0 ${shellTone.sectionHighlight}`,
                  }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    justifyContent="space-between"
                    spacing={0.85}
                    mb={{ xs: 0.85, sm: 1.05 }}
                  >
                    <Box>
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 750, fontSize: { xs: "0.94rem", sm: "1rem" } }}
                      >
                        {navigationQuery.trim()
                          ? "搜索结果"
                          : navigationCategory || navigationPreferredCategory || "快捷入口"}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: shellTone.helperText, display: { xs: "none", sm: "block" } }}
                      >
                        {navigationQuery.trim()
                          ? "按名称、备注和目标路径过滤"
                          : "当前分类下的可用入口"}
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        px: { xs: 0.82, sm: 0.95 },
                        py: { xs: 0.4, sm: 0.52 },
                        borderRadius: "999px",
                        bgcolor: shellTone.countBg,
                        color: shellTone.countColor,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                      }}
                    >
                      {resultCount} 个入口
                    </Box>
                  </Stack>

      {displayItems.length > 0 ? (
                    <Stack spacing={{ xs: 0.56, sm: 0.62 }} sx={{ minWidth: 0, maxWidth: "100%" }}>
                      {displayItems.map((item) => (
                        <Card
                          key={`${item.categoryTitle}-${item.entry.kind}-${item.entry.targetLabel}`}
                          variant="outlined"
                          sx={{
                            width: "100%",
                            minWidth: 0,
                            maxWidth: "100%",
                            overflow: "hidden",
                            borderRadius: { xs: "12px", sm: "13px" },
                            background: entryTone.cardBg,
                            borderColor: entryTone.cardBorder,
                            boxShadow: "none",
                          }}
                        >
                          <CardActionArea
                            onClick={() => onOpenNavigation(item.entry)}
                            title={item.entry.targetLabel}
                            sx={{
                              width: "100%",
                              minWidth: 0,
                              maxWidth: "100%",
                              overflow: "hidden",
                              px: { xs: 0.76, sm: 0.88 },
                              py: { xs: 0.62, sm: 0.72 },
                              height: "100%",
                              borderRadius: { xs: "12px", sm: "13px" },
                              transition:
                                "background-color 160ms ease, transform 160ms ease, border-color 160ms ease",
                              "&:hover": {
                                background: entryTone.cardHover,
                                transform: "translateY(-1px)",
                              },
                            }}
                            >
                            <Stack
                              direction="row"
                              spacing={{ xs: 0.62, sm: 0.82 }}
                              alignItems="center"
                              sx={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                            >
                              <Stack
                                direction="row"
                                spacing={{ xs: 0.62, sm: 0.78 }}
                                alignItems="center"
                                sx={{
                                  flex: "1 1 auto",
                                  width: "auto",
                                  minWidth: 0,
                                  maxWidth: "100%",
                                }}
                              >
                                <Box
                                  sx={{
                                    width: { xs: 28, sm: 30 },
                                    height: { xs: 28, sm: 30 },
                                    borderRadius: { xs: "9px", sm: "10px" },
                                    display: "grid",
                                    placeItems: "center",
                                    border: "1px solid",
                                    borderColor: entryTone.iconBorder,
                                    bgcolor: entryTone.iconBg,
                                    color: "text.secondary",
                                    flexShrink: 0,
                                    fontSize: { xs: 13, sm: 14 },
                                  }}
                                >
                                  <NavigationKindIcon kind={item.entry.kind} />
                                </Box>
                                <Box
                                  sx={{
                                    flex: "1 1 auto",
                                    width: 0,
                                    minWidth: 0,
                                    maxWidth: "100%",
                                    overflow: "hidden",
                                    textAlign: "left",
                                  }}
                                >
                                  <Typography
                                    variant="subtitle2"
                                    sx={{
                                      display: "block",
                                      fontWeight: 760,
                                      minWidth: 0,
                                      maxWidth: "100%",
                                      fontSize: { xs: "0.84rem", sm: "0.88rem" },
                                      letterSpacing: "-0.01em",
                                      lineHeight: 1.14,
                                    }}
                                    noWrap
                                  >
                                    {item.entry.name}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      display: "block",
                                      minWidth: 0,
                                      maxWidth: "100%",
                                      mt: 0.03,
                                      color: entryTone.metaColor,
                                      lineHeight: 1.28,
                                      fontSize: { xs: "0.64rem", sm: "0.66rem" },
                                    }}
                                    noWrap
                                  >
                                    {[
                                      navigationKindLabel(item.entry.kind),
                                      isSearching ? item.categoryLabel : null,
                                      item.entry.note ?? null,
                                    ]
                                      .filter(Boolean)
                                      .join("  ·  ")}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      display: "-webkit-box",
                                      minWidth: 0,
                                      maxWidth: "100%",
                                      mt: 0.12,
                                      textAlign: "left",
                                      color: entryTone.targetColor,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      overflowWrap: "normal",
                                      wordBreak: "normal",
                                      WebkitBoxOrient: "vertical",
                                      WebkitLineClamp: 1,
                                      lineHeight: 1.22,
                                      fontSize: { xs: "0.64rem", sm: "0.66rem" },
                                      fontFamily:
                                        '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                                    }}
                                  >
                                    {item.entry.targetLabel}
                                  </Typography>
                                </Box>
                              </Stack>
                              <Stack
                                direction="row"
                                spacing={{ xs: 0.42, sm: 0.52 }}
                                alignItems="center"
                                justifyContent="flex-end"
                                flexShrink={0}
                                sx={{ minWidth: 0 }}
                              >
                                <Box
                                  sx={{
                                    px: { xs: 0.56, sm: 0.66 },
                                    py: { xs: 0.14, sm: 0.2 },
                                    borderRadius: "999px",
                                    border: "1px solid",
                                    borderColor: entryTone.metaBorder,
                                    bgcolor: entryTone.metaBg,
                                    color: entryTone.metaColor,
                                    fontSize: { xs: "0.58rem", sm: "0.6rem" },
                                    fontWeight: 700,
                                  }}
                                >
                                  {navigationKindLabel(item.entry.kind)}
                                </Box>
                                <Box
                                  sx={{
                                    width: { xs: 22, sm: 24 },
                                    height: { xs: 22, sm: 24 },
                                    borderRadius: { xs: "8px", sm: "9px" },
                                    border: "1px solid",
                                    borderColor: entryTone.metaBorder,
                                    bgcolor: entryTone.iconBg,
                                    color: entryTone.metaColor,
                                    display: "grid",
                                    placeItems: "center",
                                    fontSize: { xs: 12, sm: 13 },
                                    flexShrink: 0,
                                  }}
                                >
                                  <OpenExternalIcon fontSize="inherit" />
                                </Box>
                              </Stack>
                            </Stack>
                          </CardActionArea>
                        </Card>
                      ))}
                    </Stack>
                  ) : (
                    <Box
                      sx={{
                        p: 1.25,
                        borderRadius: "14px",
                        border: "1px dashed",
                        borderColor: shellTone.sectionBorder,
                        bgcolor: shellTone.emptyBg,
                      }}
                    >
                      <Typography variant="body2" sx={{ color: shellTone.emptyText }}>
                        当前筛选下暂无快捷入口，试试切到“全部”或清空搜索。
                      </Typography>
                    </Box>
                  )}
                </Box>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3 }}>
                还没有加载到快捷入口配置，检查 `navigation.toml` 是否可读。
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
