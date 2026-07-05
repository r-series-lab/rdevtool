import { createTheme } from "@mui/material";

export type AppStyleMode = "light" | "mono";

const lightTokens = {
  bg: "rgba(243,246,250,0.58)",
  panel: "rgba(250,252,255,0.42)",
  panelStrong: "rgba(250,252,255,0.52)",
  line: "rgba(52,76,96,0.14)",
  lineSoft: "rgba(52,76,96,0.08)",
  text: "#17202b",
  muted: "rgba(63,79,97,0.68)",
  accent: "#5c7085",
  accentHover: "#455a70",
  accentSoft: "rgba(92,112,133,0.11)",
  accentBorder: "rgba(92,112,133,0.24)",
  secondary: "#687386",
  success: "#3f8269",
  info: "#5c7085",
  warning: "#a86c1c",
  error: "#aa6069",
  shadow: "0 22px 58px rgba(28,48,68,0.14)",
};

const monoTokens = {
  bg: "rgba(10,12,15,0.78)",
  panel: "rgba(18,22,28,0.42)",
  panelStrong: "rgba(24,29,36,0.52)",
  line: "rgba(226,232,240,0.12)",
  lineSoft: "rgba(226,232,240,0.07)",
  text: "#f2f6f4",
  muted: "rgba(221,231,229,0.62)",
  accent: "#8fb8ea",
  accentHover: "#b6d2f4",
  accentSoft: "rgba(143,184,234,0.16)",
  accentBorder: "rgba(182,210,244,0.34)",
  secondary: "#c6b8d9",
  success: "#86c2a0",
  info: "#8fb8ea",
  warning: "#ecc26f",
  error: "#df8b94",
  shadow: "0 30px 72px rgba(0,0,0,0.42)",
};

export function createAppTheme(styleMode: AppStyleMode) {
  const mono = styleMode === "mono";
  const tokens = mono ? monoTokens : lightTokens;
  const menuPaperBg = mono ? "rgba(17,21,27,0.96)" : "rgba(248,251,255,0.96)";
  const menuPaperBorder = mono ? "rgba(226,232,240,0.13)" : "rgba(52,76,96,0.16)";
  const menuPaperShadow = mono
    ? "0 22px 52px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.035)"
    : "0 22px 52px rgba(28,48,68,0.18), inset 0 1px 0 rgba(255,255,255,0.72)";
  const menuItemHoverBg = mono ? "rgba(143,184,234,0.09)" : "rgba(92,112,133,0.08)";
  const menuItemSelectedBg = mono ? "rgba(143,184,234,0.13)" : "rgba(92,112,133,0.12)";
  const dialogBackdropBg = mono ? "rgba(0,0,0,0.34)" : "rgba(30,38,48,0.22)";
  const dialogPaperBg = mono
    ? "linear-gradient(180deg, rgba(255,255,255,0.052), rgba(255,255,255,0.018) 48%, rgba(255,255,255,0.01)), rgba(14,18,24,0.985)"
    : "linear-gradient(180deg, rgba(255,255,255,0.985), rgba(247,250,254,0.992) 48%, rgba(241,246,252,0.988)), rgba(248,251,255,0.99)";
  const dialogChromeBg = mono ? "rgba(15,19,25,0.94)" : "rgba(248,251,255,0.94)";
  const dialogPaperShadow = mono
    ? "0 34px 92px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.055)"
    : "0 30px 86px rgba(20,36,54,0.28), inset 0 1px 0 rgba(255,255,255,0.96)";

  return createTheme({
    palette: {
      mode: mono ? "dark" : "light",
      primary: {
        main: tokens.accent,
        light: tokens.accentHover,
        dark: mono ? "#6f96c7" : "#455a70",
        contrastText: mono ? "#07111d" : "#ffffff",
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
            borderRadius: 13,
            borderColor: tokens.line,
            background: tokens.panel,
            boxShadow: tokens.shadow,
            backdropFilter: "blur(24px) saturate(1.18)",
            WebkitBackdropFilter: "blur(24px) saturate(1.18)",
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
      MuiBackdrop: {
        styleOverrides: {
          root: {
            backgroundColor: dialogBackdropBg,
            backdropFilter: "blur(2px) saturate(1.02)",
            WebkitBackdropFilter: "blur(2px) saturate(1.02)",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 18,
            border: `1px solid ${mono ? "rgba(143,184,234,0.14)" : "rgba(52,76,96,0.18)"}`,
            background: dialogPaperBg,
            backgroundImage: "none",
            color: tokens.text,
            boxShadow: dialogPaperShadow,
            backdropFilter: "blur(18px) saturate(1.1)",
            WebkitBackdropFilter: "blur(18px) saturate(1.1)",
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            background: dialogChromeBg,
            color: tokens.text,
            borderBottom: `1px solid ${tokens.lineSoft}`,
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            background: dialogChromeBg,
            borderTop: `1px solid ${tokens.lineSoft}`,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            backgroundColor: "transparent",
          },
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
            border: `1px solid ${tokens.accentBorder}`,
            backgroundColor: tokens.accent,
            boxShadow: mono
              ? "0 12px 28px rgba(38,84,132,0.28), inset 0 1px 0 rgba(255,255,255,0.3)"
              : "0 8px 20px rgba(38,105,132,0.16)",
            "&:hover": {
              backgroundColor: tokens.accentHover,
              boxShadow: mono
                ? "0 14px 30px rgba(50,98,148,0.32), inset 0 1px 0 rgba(255,255,255,0.34)"
                : "0 10px 20px rgba(49,95,187,0.16)",
            },
            "&.Mui-disabled": {
              borderColor: tokens.lineSoft,
            },
          },
          outlinedInherit: {
            borderColor: tokens.line,
            color: tokens.text,
            backgroundColor: mono ? "rgba(255,255,255,0.026)" : "rgba(255,255,255,0.4)",
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
                  color: "rgba(235,241,248,0.82)",
                  border: "1px solid rgba(156,185,220,0.16)",
                  backgroundColor: "rgba(143,184,234,0.07)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
                  "&:hover": {
                    color: "#f7fbff",
                    backgroundColor: "rgba(143,184,234,0.13)",
                    borderColor: "rgba(182,210,244,0.28)",
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
          autoComplete: "off",
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
        defaultProps: {
          inputProps: {
            autoCapitalize: "none",
            autoComplete: "off",
            autoCorrect: "off",
            spellCheck: false,
          },
        },
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
            borderRadius: mono ? 10 : 9,
            ...(mono
              ? {
                  backgroundColor: "rgba(255,255,255,0.026)",
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
              : {
                  backgroundColor: "rgba(255,255,255,0.46)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderColor: tokens.line,
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    borderColor: tokens.accentBorder,
                  },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    borderColor: tokens.accentBorder,
                  },
                }),
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
          paper: {
            marginTop: 8,
            borderRadius: 14,
            border: `1px solid ${menuPaperBorder}`,
            background: menuPaperBg,
            color: tokens.text,
            boxShadow: menuPaperShadow,
            backdropFilter: "blur(10px) saturate(1.08)",
            WebkitBackdropFilter: "blur(10px) saturate(1.08)",
            backgroundImage: "none",
          },
          listbox: {
            padding: 8,
          },
          option: {
            borderRadius: 10,
            minHeight: 34,
            '&[aria-selected="true"]': {
              backgroundColor: menuItemSelectedBg,
            },
            '&[aria-selected="true"].Mui-focused': {
              backgroundColor: menuItemSelectedBg,
            },
            "&.Mui-focused": {
              backgroundColor: menuItemHoverBg,
            },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            marginTop: 8,
            borderRadius: 14,
            border: `1px solid ${menuPaperBorder}`,
            background: menuPaperBg,
            color: tokens.text,
            boxShadow: menuPaperShadow,
            backdropFilter: "blur(10px) saturate(1.08)",
            WebkitBackdropFilter: "blur(10px) saturate(1.08)",
            backgroundImage: "none",
          },
          list: {
            padding: 8,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 36,
            borderRadius: 10,
            color: tokens.text,
            "&:hover": {
              backgroundColor: menuItemHoverBg,
            },
            "&.Mui-selected": {
              backgroundColor: menuItemSelectedBg,
            },
            "&.Mui-selected:hover": {
              backgroundColor: menuItemSelectedBg,
            },
            "&.Mui-disabled": {
              opacity: mono ? 0.32 : 0.42,
            },
          },
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
