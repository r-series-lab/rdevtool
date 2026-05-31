import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

function renderBootstrapError(message: string) {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f4f7fb;color:#172133;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC',sans-serif;">
      <div style="max-width:760px;width:100%;padding:20px 22px;border-radius:14px;background:rgba(255,255,255,0.94);border:1px solid rgba(42,82,132,0.16);box-shadow:0 18px 42px rgba(46,83,126,0.1);">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px;">rDevTool 启动失败</div>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;">${message}</pre>
      </div>
    </div>
  `;
}

window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.error.message : String(event.message);
  console.error("[bootstrap-error]", event.error ?? event.message);
  renderBootstrapError(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  console.error("[bootstrap-unhandledrejection]", event.reason);
  renderBootstrapError(reason);
});

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[bootstrap-render-error]", error);
  renderBootstrapError(message);
}
