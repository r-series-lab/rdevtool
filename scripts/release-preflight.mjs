import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const appManifest = readJson("r-app.manifest.json");
const skillManifest = readJson("skills/rdevtool/manifest.json");
const version = packageJson.version;
const expectedTag = `v${version}`;
const isTag = process.env.GITHUB_REF_TYPE === "tag";
const actualTag = process.env.GITHUB_REF_NAME?.trim() ?? "";
const localizedDocuments = Object.entries(
  appManifest.localization?.translations ?? {},
).flatMap(([locale, translation]) =>
  (translation.documentation ?? []).map((document) => ({ locale, ...document })),
);
const staleDocuments = localizedDocuments.filter(
  (document) => document.reviewedForVersion !== version,
);

const checks = [
  check(
    "release-tag-version",
    "GitHub Tag 与应用版本一致",
    !isTag || actualTag === expectedTag,
    `Tag 必须为 ${expectedTag}。`,
  ),
  check(
    "tauri-version",
    "Tauri 与应用版本一致",
    tauriConfig.version === version,
    `src-tauri/tauri.conf.json 的 version 必须为 ${version}。`,
  ),
  check(
    "skill-version",
    "Skill 与应用版本一致",
    skillManifest.skillVersion === version
      && skillManifest.generatedForVersion === version,
    `skills/rdevtool/manifest.json 的版本必须为 ${version}。`,
  ),
  check(
    "localized-documentation",
    "本地化文档版本复核",
    staleDocuments.length === 0,
    staleDocuments.length === 0
      ? ""
      : `复核后更新 reviewedForVersion：${staleDocuments.map((item) => `${item.locale}/${item.id}`).join(", ")}`,
  ),
];
const missing = checks.filter((item) => !item.ok);

console.log(JSON.stringify(
  missing.length === 0
    ? {
        ok: true,
        command: "release.check",
        data: { version, expectedTag, mode: isTag ? "tag" : "manual", checks },
      }
    : {
        ok: false,
        error: {
          code: "release_preflight_failed",
          message: "发布前检查未通过。",
          checks,
        },
      },
  null,
  2,
));

if (missing.length > 0) process.exit(2);

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function check(id, label, ok, fix) {
  return { id, label, ok, ...(ok ? {} : { fix }) };
}
