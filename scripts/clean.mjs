#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "standard";
if (!new Set(["build-cache", "standard", "all"]).has(mode)) {
  throw new Error(`Unknown clean mode: ${mode}`);
}

function runCargoClean(args = []) {
  const result = spawnSync(
    "cargo",
    ["clean", "--manifest-path", path.join(rootDir, "src-tauri", "Cargo.toml"), ...args],
    { cwd: rootDir, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function remove(relativePath) {
  await rm(path.join(rootDir, relativePath), { recursive: true, force: true });
}

if (mode === "build-cache") {
  runCargoClean(["-p", "rdevtool-core", "-p", "rdevtool-tauri"]);
  await remove("web/dist");
  await remove("target/release/bundle");
  await remove("src-tauri/binaries");
  try {
    for (const entry of await readdir(path.join(rootDir, "target"), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.includes("-")) {
        await remove(path.join("target", entry.name, "release", "bundle"));
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
} else {
  runCargoClean();
  await remove("web/dist");
  await remove("src-tauri/binaries");
  if (mode === "all") await remove("web/node_modules");
}
