#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target");
const target = targetIndex >= 0 ? args[targetIndex + 1] : args.find((value) => value.startsWith("--target="))?.split("=", 2)[1];
if (!target) throw new Error("--target is required");

const releaseDir = path.join(rootDir, "target", target, "release");
const bundleDir = path.join(releaseDir, "bundle");
const supportedSuffixes = [".dmg", ".app.tar.gz", ".msi", ".exe"];

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await filesUnder(absolute)));
    if (entry.isFile() && supportedSuffixes.some((suffix) => entry.name.endsWith(suffix))) output.push(absolute);
  }
  return output;
}

const packageMetadata = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const evidencePrefix = `rdevtool-${target}`;
const files = (await filesUnder(bundleDir)).sort((left, right) => left.localeCompare(right));
if (files.length === 0) throw new Error(`No release artifacts found under ${bundleDir}`);

const artifacts = [];
for (const file of files) {
  const content = await readFile(file);
  artifacts.push({
    path: path.relative(rootDir, file).split(path.sep).join("/"),
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}

await mkdir(releaseDir, { recursive: true });
await writeFile(
  path.join(releaseDir, `${evidencePrefix}-release-artifacts.json`),
  `${JSON.stringify({ product: "rDevTool", version: packageMetadata.version, target, artifacts }, null, 2)}\n`,
);
await writeFile(
  path.join(releaseDir, `${evidencePrefix}-SHA256SUMS.txt`),
  `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join("\n")}\n`,
);
process.stdout.write(`Release evidence written for ${artifacts.length} artifact(s).\n`);
