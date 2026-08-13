import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const projectPath = process.cwd();
const devUrl = "http://127.0.0.1:1420";
const depUrl = `${devUrl}/node_modules/.vite/deps/react.js`;

let shuttingDown = false;
let viteProcess;
let tauriProcess;

function stopProcess(child, signal = "SIGTERM") {
  if (!child || child.exitCode != null || child.killed) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    // Ignore shutdown races.
  }
}

async function waitForReady(url, label, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the dev server is truly ready.
    }

    await delay(400);
  }

  throw new Error(`Timed out waiting for ${label}: ${url}`);
}

async function main() {
  const sidecar = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./prepare-cli-sidecar.mjs", import.meta.url))],
    { cwd: projectPath, stdio: "inherit" },
  );
  if (sidecar.error) throw sidecar.error;
  if (sidecar.status !== 0) process.exit(sidecar.status ?? 1);

  viteProcess = spawn("npm", ["--prefix", "web", "run", "dev", "--", "--force"], {
    cwd: projectPath,
    stdio: "inherit",
  });

  viteProcess.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopProcess(tauriProcess);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  await waitForReady(devUrl, "Vite dev server");
  await waitForReady(depUrl, "optimized React dependency");

  tauriProcess = spawn(
    "../web/node_modules/.bin/tauri",
    ["dev", "--config", "tauri.conf.json"],
    {
      cwd: `${projectPath}/src-tauri`,
      stdio: "inherit",
    },
  );

  tauriProcess.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopProcess(viteProcess);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopProcess(tauriProcess, signal);
    stopProcess(viteProcess, signal);
    process.exit(0);
  });
}

main().catch((error) => {
  shuttingDown = true;
  stopProcess(tauriProcess);
  stopProcess(viteProcess);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
