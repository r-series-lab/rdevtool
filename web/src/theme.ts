import { createTheme } from "@mui/material";

export type AppStyleMode = "light" | "mono";

const lightTokens = {
  bg: "#f4f7fb",
  panel: "rgba(255,255,255,0.92)",
  panelStrong: "#fbfdff",
  line: "rgba(42,82,132,0.16)",
  lineSoft: "rgba(42,82,132,0.1)",
  text: "#172133",
  muted: "#65758b",
  accent: "#2563eb",
  accentHover: "#3778ff",
  accentSoft: "rgba(37,99,235,0.065)",
  accentBorder: "rgba(37,99,235,0.2)",
  secondary: "#0f766e",
  success: "#138a56",
  info: "#0284c7",
  warning: "#b7791f",
  error: "#c24141",
  shadow: "0 18px 42px rgba(46,83,126,0.1)",
};

const monoTokens = {
  bg: "#080d13",
  panel: "rgba(15,22,32,0.9)",
  panelStrong: "rgba(19,28,40,0.94)",
  line: "rgba(139,169,208,0.14)",
  lineSoft: "rgba(139,169,208,0.08)",
  text: "#f2f6fb",
  muted: "rgba(218,226,238,0.62)",
  accent: "#4f8cff",
  accentHover: "#6aa0ff",
  accentSoft: "rgba(79,140,255,0.07)",
  accentBorder: "rgba(79,140,255,0.2)",
  secondary: "#48c6b0",
  success: "#54d98f",
  info: "#58bdf6",
  warning: "#f2bc5b",
  error: "#ff7d7d",
  shadow: "0 26px 60px rgba(0,0,0,0.38)",
};

export function createAppTheme(styleMode: AppStyleMode) {
  const mono = styleMode === "mono";
  const tokens = mono ? monoTokens : lightTokens;

  return createTheme({
    palette: {
      mode: mono ? "dark" : "light",
      primary: {
        main: tokens.accent,
        light: tokens.accentHover,
        dark: mono ? "#2f6ff6" : "#1d4ed8",
        contrastText: "#ffffff",
      },
      secondary: {
        main: tokens.secondary,
      },
      success: {
        main: tokens.success,
      },
      info: {
        main: tokens.info,
      },
      warning: {
        main: tokens.warning,
      },
      error: {
        main: tokens.error,
      },
      background: {
        default: tokens.bg,
        paper: tokens.panel,
      },
      text: {
        primary: tokens.text,
        secondary: tokens.muted,
      },
      divider: tokens.line,
    },
    shape: {
      borderRadius: mono ? 10 : 10,
    },
    typography: {
      fontSize: 13,
      fontFamily: `"SF Pro Display","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`,
      h6: {
        fontSize: "1.02rem",
        fontWeight: 800,
      },
      body2: {
        fontSize: "0.86rem",
      },
      caption: {
        fontSize: "0.72rem",
      },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            borderColor: tokens.line,
            background: tokens.panel,
            boxShadow: tokens.shadow,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: mono
            ? {
                backgroundImage: "none",
              }
            : {},
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 700,
            minHeight: mono ? 32 : 26,
            paddingInline: mono ? 12 : 8,
            borderRadius: mono ? 10 : 9,
            minWidth: 0,
          },
          containedPrimary: {
            boxShadow: mono
              ? "0 12px 24px rgba(11,78,190,0.22), inset 0 1px 0 rgba(255,255,255,0.18)"
              : "0 10px 22px rgba(37,99,235,0.18)",
            "&:hover": {
              backgroundColor: tokens.accentHover,
            },
          },
          outlinedInherit: {
            borderColor: tokens.line,
            color: tokens.text,
            backgroundColor: mono ? "rgba(255,255,255,0.012)" : "rgba(255,255,255,0.46)",
            "&:hover": {
              borderColor: tokens.accentBorder,
              backgroundColor: tokens.accentSoft,
            },
          },
          text: mono
            ? {
                color: "rgba(224,229,236,0.74)",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.028)",
                },
              }
            : {},
        },
        defaultProps: {
          size: "small",
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            width: mono ? 30 : 28,
            height: mono ? 30 : 28,
            borderRadius: mono ? 9 : 9,
            ...(mono
              ? {
                  color: "rgba(228,233,240,0.72)",
                  border: `1px solid ${tokens.lineSoft}`,
                  backgroundColor: "rgba(255,255,255,0.014)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
                  "&:hover": {
                    backgroundColor: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(229,233,240,0.08)",
                  },
                  "&.Mui-disabled": {
                    color: "rgba(167,173,181,0.32)",
                    borderColor: "rgba(229,233,240,0.03)",
                    backgroundColor: "rgba(255,255,255,0.008)",
                  },
                }
              : {}),
          },
        },
        defaultProps: {
          size: "small",
        },
      },
      MuiTextField: {
        defaultProps: {
          size: "small",
        },
      },
      MuiFormControl: {
        defaultProps: {
          size: "small",
        },
      },
      MuiSelect: {
        defaultProps: {
          size: "small",
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            height: mono ? 24 : 22,
            fontWeight: 700,
            borderRadius: 999,
            fontSize: "0.68rem",
            ...(mono
              ? {
                  backgroundColor: "rgba(255,255,255,0.026)",
                  color: "rgba(234,238,244,0.72)",
                  border: `1px solid ${tokens.lineSoft}`,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.018)",
                }
              : {}),
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: {
            fontSize: "0.9rem",
          },
          input: {
            paddingTop: 8,
            paddingBottom: 8,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 9,
            ...(mono
              ? {
                  borderRadius: 10,
                  backgroundColor: "rgba(255,255,255,0.016)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.016)",
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderColor: tokens.lineSoft,
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    borderColor: tokens.line,
                  },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    borderColor: tokens.accentBorder,
                  },
                }
              : {}),
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            margin: 0,
            padding: 4,
          },
          switchBase: mono
            ? {
                "&.Mui-checked": {
                  color: "#12161c",
                },
                "&.Mui-checked + .MuiSwitch-track": {
                  backgroundColor: "#eef1f5",
                  opacity: 1,
                },
              }
            : {},
          track: mono
            ? {
                borderRadius: 999,
                backgroundColor: "rgba(255,255,255,0.14)",
                opacity: 1,
              }
            : {},
        },
        defaultProps: {
          size: "small",
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: 12,
            "&:last-child": {
              paddingBottom: 12,
            },
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: mono ? 16 : 9,
            ...(mono
              ? {
                  border: "1px solid rgba(229,233,240,0.06)",
                  backgroundColor: "rgba(23,27,33,0.96)",
                  color: "#eef0f3",
                  boxShadow: "0 16px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.02)",
                }
              : {}),
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: mono
            ? {
                marginTop: 8,
                borderRadius: 16,
                border: `1px solid ${tokens.line}`,
                background: tokens.panelStrong,
                boxShadow: "0 20px 44px rgba(0,0,0,0.32)",
              }
            : {},
          listbox: mono
            ? {
                padding: 8,
              }
            : {},
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: mono
            ? {
                marginTop: 8,
                borderRadius: 16,
                border: `1px solid ${tokens.line}`,
                background: tokens.panelStrong,
                boxShadow: "0 20px 44px rgba(0,0,0,0.32)",
              }
            : {},
          list: mono
            ? {
                padding: 8,
              }
            : {},
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: mono
            ? {
                minHeight: 36,
                borderRadius: 12,
                color: "#eef1f5",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.035)",
                },
                "&.Mui-selected": {
                  backgroundColor: "rgba(255,255,255,0.06)",
                },
                "&.Mui-selected:hover": {
                  backgroundColor: "rgba(255,255,255,0.075)",
                },
              }
            : {},
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: mono
            ? {
                borderColor: "rgba(229,233,240,0.07)",
              }
            : {},
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: mono
            ? {
                backgroundColor: "rgba(255,255,255,0.06)",
              }
            : {},
        },
      },
    },
  });
}
