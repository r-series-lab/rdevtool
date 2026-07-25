#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webSrcDir = path.join(rootDir, "web", "src");
const rustSrcDir = path.join(rootDir, "src-tauri", "src");
const rustSource = await readFile(path.join(rootDir, "src-tauri", "src", "lib.rs"), "utf8");
const requireFromWeb = createRequire(path.join(rootDir, "web", "package.json"));
const { parse } = requireFromWeb("@babel/parser");
const jsonMode = process.argv.includes("--json");

async function sourceFiles(directory, pattern) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute, pattern)));
    if (entry.isFile() && pattern.test(entry.name)) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

const rustSources = await Promise.all(
  (await sourceFiles(rustSrcDir, /\.rs$/)).map(async (file) => ({
    file,
    source: await readFile(file, "utf8"),
  })),
);

function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, callback);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      visit(value, callback);
    }
  }
}

function rustCommandNames() {
  const commandPattern = /#\[tauri::command\]\s*(?:#\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  return rustSources
    .flatMap(({ source }) => [...source.matchAll(commandPattern)].map((match) => match[1]))
    .sort();
}

function registeredHandlerNames() {
  const match = rustSource.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/);
  if (!match) throw new Error("Unable to find tauri::generate_handler! command list");
  return match[1]
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.split("::").at(-1))
    .sort();
}

async function frontendInvocations() {
  const calls = [];
  const dynamic = [];
  for (const file of await sourceFiles(webSrcDir, /\.[cm]?[jt]sx?$/)) {
    const source = await readFile(file, "utf8");
    const ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: false,
    });
    const invokeNames = new Set();
    for (const statement of ast.program.body) {
      if (statement.type !== "ImportDeclaration" || statement.source.value !== "@tauri-apps/api/core") continue;
      for (const specifier of statement.specifiers) {
        if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && specifier.imported.name === "invoke") {
          invokeNames.add(specifier.local.name);
        }
      }
    }
    if (invokeNames.size === 0) continue;
    visit(ast.program, (node) => {
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || !invokeNames.has(node.callee.name)) return;
      const command = node.arguments[0];
      const location = `${path.relative(rootDir, file)}:${node.loc?.start.line ?? 0}`;
      if (command?.type === "StringLiteral") {
        calls.push({ command: command.value, location });
      } else {
        dynamic.push(location);
      }
    });
  }
  return { calls, dynamic };
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))].sort();
}

const declared = rustCommandNames();
const registered = registeredHandlerNames();
const frontend = await frontendInvocations();
const declaredSet = new Set(declared);
const registeredSet = new Set(registered);
const invoked = [...new Set(frontend.calls.map((call) => call.command))].sort();
const invokedSet = new Set(invoked);

const errors = [
  ...duplicates(declared).map((command) => `duplicate #[tauri::command] function: ${command}`),
  ...duplicates(registered).map((command) => `duplicate generate_handler entry: ${command}`),
  ...registered.filter((command) => !declaredSet.has(command)).map((command) => `registered command lacks #[tauri::command]: ${command}`),
  ...declared.filter((command) => !registeredSet.has(command)).map((command) => `#[tauri::command] is not registered: ${command}`),
  ...invoked.filter((command) => !registeredSet.has(command)).map((command) => `frontend invokes an unregistered command: ${command}`),
];
const registeredWithoutLiteralInvoke = registered.filter((command) => !invokedSet.has(command));
const warnings = [];
if (frontend.dynamic.length > 0) {
  warnings.push(`${frontend.dynamic.length} invoke sites use a statically typed runtime command selector`);
}
if (registeredWithoutLiteralInvoke.length > 0) {
  warnings.push(`${registeredWithoutLiteralInvoke.length} registered commands have no literal frontend invoke: ${registeredWithoutLiteralInvoke.join(", ")}`);
}
const data = {
  declaredCount: declared.length,
  registeredCount: registered.length,
  invokedCommandCount: invoked.length,
  invokeCallCount: frontend.calls.length,
  dynamicInvokeCount: frontend.dynamic.length,
  dynamicInvokeSites: frontend.dynamic,
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, command: "ipc.check", data, errors, warnings })}\n`);
} else if (errors.length === 0) {
  process.stdout.write(`IPC contract valid: ${data.registeredCount} Rust commands, ${data.invokedCommandCount} frontend commands, ${data.invokeCallCount} invoke sites.\n`);
  for (const warning of warnings) process.stdout.write(`- warning: ${warning}\n`);
} else {
  process.stderr.write(`IPC contract failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
}

process.exitCode = errors.length === 0 ? 0 : 2;
