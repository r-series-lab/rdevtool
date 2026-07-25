import ReactDOM from "react-dom/client";
import { Box, CssBaseline, ThemeProvider } from "@mui/material";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { WebActionRunResult, WebActionTarget } from "./app-types";
import { WebActionsPanel, type WebActionsDialogContext } from "./components/WebActionsDialog";
import { createAppTheme } from "./theme";
import "./styles.css";

document.documentElement.dataset.style = "mono";

const context: WebActionsDialogContext = {
  title: "协同平台",
  scope: "",
  url: "https://example.test/app/index.html",
};

const target: WebActionTarget = {
  id: "target-web-actions-smoke",
  title: "协同平台",
  url: context.url,
  type: "page",
  webSocketDebuggerUrl: "ws://127.0.0.1/mock",
};

function replayResult(payload: Record<string, unknown> | undefined): WebActionRunResult {
  const request = payload?.request as Record<string, unknown> | undefined;
  const script = String(request?.script ?? "");
  const inputMatch = script.match(/^const __request = (\{.*\});/m);
  const input = inputMatch
    ? (JSON.parse(inputMatch[1]) as {
        url: string;
        options: { method?: string };
      })
    : { url: "-", options: {} };
  const result = {
    kind: "browser-request",
    method: input.options.method ?? "GET",
    requestUrl: input.url,
    status: 200,
    ok: true,
    responseBody: { imported: true },
  };
  return {
    actionKey: "temporary-script",
    targetId: target.id,
    title: target.title,
    url: target.url,
    success: true,
    result,
    resultText: JSON.stringify(result, null, 2),
    error: null,
  };
}

mockIPC(
  (command, payload) => {
    switch (command) {
      case "list_web_actions":
        return { configPath: "/mock/web_actions.toml", actions: [] };
      case "list_web_action_targets":
        return [target];
      case "run_web_action_script":
        return replayResult(payload as Record<string, unknown> | undefined);
      case "open_web_action_target":
        return target;
      case "open_local_path":
        return null;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

function WebActionsSmoke() {
  return (
    <ThemeProvider theme={createAppTheme("mono")}>
      <CssBaseline />
      <Box
        sx={{
          width: "min(860px, 100%)",
          minHeight: "100vh",
          mx: "auto",
          p: { xs: 1, sm: 2 },
        }}
      >
        <WebActionsPanel context={context} />
      </Box>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<WebActionsSmoke />);
