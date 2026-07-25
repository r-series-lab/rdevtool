import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");
const errors = [];
const warnings = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), "utf8"));
}

function cargoPackage(relativeManifestPath) {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--locked", "--no-deps", "--format-version", "1", "--manifest-path", relativeManifestPath],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  return metadata.packages.find((item) => item.manifest_path === metadata.resolve?.root)
    ?? metadata.packages[0];
}

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function requireString(value, label) {
  requireValue(typeof value === "string" && value.trim().length > 0, `${label} 必须是非空字符串`);
}

function requireUnique(values, label) {
  requireValue(Array.isArray(values), `${label} 必须是数组`);
  if (Array.isArray(values)) {
    requireValue(new Set(values).size === values.length, `${label} 不能包含重复值`);
  }
}

function safeProjectPath(relativePath, label) {
  requireString(relativePath, label);
  if (typeof relativePath !== "string" || isAbsolute(relativePath)) {
    errors.push(`${label} 必须是仓库内相对路径`);
    return null;
  }
  const target = resolve(projectRoot, relativePath);
  if (target !== projectRoot && !target.startsWith(`${projectRoot}${sep}`)) {
    errors.push(`${label} 不能越过仓库边界`);
    return null;
  }
  try {
    requireValue(statSync(target).isFile(), `${label} 不指向文件: ${relativePath}`);
  } catch {
    errors.push(`${label} 不存在: ${relativePath}`);
  }
  return target;
}

function outputAndExit(manifest, version) {
  if (errors.length > 0) {
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        error: {
          code: "manifest_validation_failed",
          message: `${errors.length} 项 Manifest 校验失败`,
          details: errors,
        },
        warnings,
      }));
    } else {
      console.error(`Manifest 校验失败 (${errors.length})`);
      for (const message of errors) console.error(`- ${message}`);
      for (const message of warnings) console.warn(`- 警告: ${message}`);
    }
    process.exit(2);
  }

  const data = {
    schemaVersion: manifest.schemaVersion,
    app: manifest.identity.name,
    slug: manifest.identity.slug,
    version,
    architecture: manifest.product.architecture,
    documentCount: manifest.documentation.length,
    capabilityCount: manifest.website.capabilities.length,
    cliDomainCount: manifest.cli.domains.length,
  };
  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, command: "manifest.check", data, warnings }));
  } else {
    console.log(`Manifest valid: ${data.app} v${data.version}`);
    console.log(`- ${data.documentCount} documents`);
    console.log(`- ${data.capabilityCount} website capabilities`);
    console.log(`- ${data.cliDomainCount} CLI domains`);
    for (const message of warnings) console.warn(`- 警告: ${message}`);
  }
}

try {
  const manifest = readJson("r-app.manifest.json");
  const rootPackage = readJson("package.json");
  const webPackage = readJson("web/package.json");
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  const corePackage = cargoPackage("Cargo.toml");
  const tauriPackage = cargoPackage("src-tauri/Cargo.toml");
  const version = rootPackage.version;

  requireValue(manifest.schemaVersion === 1, "schemaVersion 当前必须为 1");
  requireString(manifest.identity?.name, "identity.name");
  requireValue(manifest.identity?.slug === manifest.identity?.repo, "identity.slug 与 identity.repo 必须一致");
  requireValue(manifest.identity?.package === rootPackage.name, "identity.package 与 package.json name 不一致");
  requireValue(manifest.identity?.webPackage === webPackage.name, "identity.webPackage 与 web/package.json name 不一致");
  requireValue(manifest.identity?.coreCrate === corePackage?.name, "identity.coreCrate 与 Cargo package 不一致");
  requireValue(manifest.identity?.tauriCrate === tauriPackage?.name, "identity.tauriCrate 与 Tauri Cargo package 不一致");
  requireValue(manifest.identity?.identifier === tauriConfig.identifier, "identity.identifier 与 Tauri identifier 不一致");
  requireValue(manifest.identity?.name === tauriConfig.productName, "identity.name 与 Tauri productName 不一致");

  const versions = new Map([
    ["package.json", rootPackage.version],
    ["web/package.json", webPackage.version],
    ["Cargo.toml", corePackage?.version],
    ["src-tauri/Cargo.toml", tauriPackage?.version],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
  ]);
  for (const [source, candidate] of versions) {
    requireValue(candidate === version, `${source} 版本 ${candidate ?? "<missing>"} 与 ${version} 不一致`);
  }

  requireValue(["simple-tool", "modular-workbench"].includes(manifest.product?.architecture), "product.architecture 无效");
  requireValue(manifest.product?.localFirst === true, "R 系列公开应用必须声明 localFirst: true");
  requireUnique(manifest.product?.nonGoals, "product.nonGoals");
  requireValue(manifest.website?.publish === true, "website.publish 必须为 true 才能进入官网");
  requireValue(/^#[0-9a-f]{6}$/i.test(manifest.website?.accent ?? ""), "website.accent 必须是六位十六进制颜色");
  requireValue(/^#[0-9a-f]{6}$/i.test(manifest.website?.accentSoft ?? ""), "website.accentSoft 必须是六位十六进制颜色");
  requireValue((manifest.website?.facts?.length ?? 0) >= 2, "website.facts 至少需要 2 项");
  requireValue((manifest.website?.capabilities?.length ?? 0) >= 3, "website.capabilities 至少需要 3 项");
  requireValue((manifest.website?.workflow?.length ?? 0) >= 3, "website.workflow 至少需要 3 步");

  requireUnique(manifest.documentation?.map((item) => item.id), "documentation.id");
  requireValue(manifest.documentation?.some((item) => item.id === "overview"), "documentation 必须包含 overview");
  requireValue(manifest.documentation?.some((item) => item.id === "changelog"), "documentation 必须包含 changelog");
  for (const document of manifest.documentation ?? []) {
    safeProjectPath(document.source, `documentation.${document.id}.source`);
  }
  for (const screenshot of manifest.website?.screenshots ?? []) {
    safeProjectPath(screenshot.source, `website.screenshots.${screenshot.id}.source`);
  }

  requireValue(manifest.cli?.contractVersion === 1, "cli.contractVersion 当前必须为 1");
  requireValue(manifest.cli?.jsonFlagPosition === "global-before-command", "rDevTool 的 JSON flag 规范必须为 global-before-command");
  for (const [label, command] of [
    ["infoCommand", manifest.cli?.infoCommand],
    ["capabilitiesCommand", manifest.cli?.capabilitiesCommand],
    ["doctorCommand", manifest.cli?.doctorCommand],
  ]) {
    requireValue(Array.isArray(command) && command[0] === "--json", `cli.${label} 必须以 --json 开始`);
  }
  requireUnique(manifest.cli?.domains, "cli.domains");

  requireUnique(manifest.quality?.requiredScripts, "quality.requiredScripts");
  for (const script of manifest.quality?.requiredScripts ?? []) {
    requireValue(typeof rootPackage.scripts?.[script] === "string", `package.json 缺少必需脚本 ${script}`);
  }
  requireUnique(manifest.quality?.validationCommands, "quality.validationCommands");

  safeProjectPath("README.md", "README");
  safeProjectPath("CHANGELOG.md", "CHANGELOG");
  safeProjectPath("src-tauri/icons/icon.png", "应用图标");
  requireValue(readFileSync(resolve(projectRoot, "README.md"), "utf8").includes(manifest.identity.name), "README 未包含产品名");
  requireValue(readFileSync(resolve(projectRoot, "CHANGELOG.md"), "utf8").includes(version), `CHANGELOG 未包含当前版本 ${version}`);

  const csp = tauriConfig.app?.security?.csp;
  requireValue(typeof csp === "string" && csp.includes("default-src 'self'"), "Tauri CSP 必须启用并以 self 为默认来源");
  requireValue(typeof csp === "string" && csp.includes("object-src 'none'"), "Tauri CSP 必须禁用 object-src");
  requireValue(tauriConfig.app?.security?.freezePrototype === true, "Tauri security.freezePrototype 必须启用");
  if (tauriConfig.app?.windows?.[0]?.minWidth === tauriConfig.app?.windows?.[0]?.width) {
    warnings.push("默认宽度与最小宽度相同；应在响应式验收后下调最小窗口尺寸");
  }

  outputAndExit(manifest, version);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  outputAndExit({ schemaVersion: 0, identity: {}, product: {}, documentation: [], website: { capabilities: [] }, cli: { domains: [] } }, "unknown");
}
