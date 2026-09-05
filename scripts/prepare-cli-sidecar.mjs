#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function optionValue(name, fallback) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value`);
  return value;
}

function capture(command, commandArgs, fallback = "") {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function run(command, commandArgs, env) {
  process.stdout.write(`+ ${[command, ...commandArgs].join(" ")}\n`);
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function hostTarget() {
  const verbose = capture("rustc", ["-vV"]);
  const host = verbose
    .split(/\r?\n/)
    .find((line) => line.startsWith("host:"))
    ?.slice("host:".length)
    .trim();
  if (!host) throw new Error("Unable to determine the Rust host target");
  return host;
}

const profile = optionValue("--profile", "debug");
if (!new Set(["debug", "release"]).has(profile)) {
  throw new Error(`Unsupported profile: ${profile}`);
}
const target = optionValue("--target", hostTarget());
const extension = target.includes("windows") ? ".exe" : "";
const cargoArgs = ["build", "--locked", "--bin", "rdevtool"];
if (profile === "release") cargoArgs.push("--release");
if (args.includes("--target") || args.some((value) => value.startsWith("--target="))) {
  cargoArgs.push("--target", target);
}

const commit = capture("git", ["rev-parse", "--verify", "HEAD"]);
const dirty = capture("git", ["status", "--porcelain", "--untracked-files=normal"])
  ? "true"
  : "false";
const buildEnv = {
  ...process.env,
  RDEVTOOL_BUILD_COMMIT: commit,
  RDEVTOOL_BUILD_DIRTY: dirty,
  RDEVTOOL_BUILD_PROFILE: profile,
  RDEVTOOL_BUILD_TARGET: target,
  RDEVTOOL_INSTALL_KIND: "bundled",
};
run("cargo", cargoArgs, buildEnv);

const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(rootDir, process.env.CARGO_TARGET_DIR)
  : path.join(rootDir, "target");
const targetWasExplicit =
  args.includes("--target") || args.some((value) => value.startsWith("--target="));
const source = path.join(
  cargoTargetDir,
  ...(targetWasExplicit ? [target] : []),
  profile,
  `rdevtool${extension}`,
);
const binariesDir = path.join(rootDir, "src-tauri", "binaries");
const destination = path.join(binariesDir, `rdevtool-${target}${extension}`);
mkdirSync(binariesDir, { recursive: true });
copyFileSync(source, destination);
if (extension === "") chmodSync(destination, 0o755);
process.stdout.write(`Prepared CLI sidecar: ${destination}\n`);
