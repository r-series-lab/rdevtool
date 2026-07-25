#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwardedArgs = process.argv.slice(2);

function optionValue(name) {
  const inline = forwardedArgs.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = forwardedArgs.indexOf(name);
  if (index < 0) return undefined;
  const value = forwardedArgs[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function run(command, args, cwd = rootDir) {
  process.stdout.write(`+ ${[command, ...args].join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const target = optionValue("--target");
const tauriBinary = path.join(
  rootDir,
  "web",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);

run(tauriBinary, ["build", "--config", "tauri.conf.json", ...forwardedArgs], path.join(rootDir, "src-tauri"));

const macBuild = target ? target.endsWith("-apple-darwin") : process.platform === "darwin";
if (macBuild) {
  const args = [path.join(rootDir, "scripts", "apply-macos-appicon-assets.py"), "--rebuild-dmg"];
  if (target) args.push("--target", target);
  run(process.env.PYTHON ?? "python3", args);
}
