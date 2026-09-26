import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "..");
const appRoot = resolve(webRoot, "..");
const outputDir = resolve(appRoot, "docs/assets/screenshots");
const port = 24_000 + (process.pid % 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const sensitivePublicScreenshotPatterns = [
  {
    label: "private IPv4 address",
    pattern:
      /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/,
  },
  { label: "work item identifier", pattern: /\bCR\d{6,}\b/i },
  {
    label: "local home directory",
    pattern: /\/(?:Users|home)\/[^/\s]+(?:\/|$)/,
  },
];
const server = spawn(npmCommand, ["run", "dev", "--", "--port", String(port)], {
  cwd: webRoot,
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before screenshots were captured.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/smoke.html`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${serverOutput}`);
}

function stopServer() {
  if (server.exitCode !== null || server.pid === undefined) return;
  try {
    if (process.platform === "win32") server.kill("SIGTERM");
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

async function createPage(
  browser,
  {
    width = 950,
    height = 760,
    deviceScaleFactor = 2,
    query = "style=mono",
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    colorScheme: "dark",
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/smoke.html${query ? `?${query}` : ""}`, {
    waitUntil: "networkidle",
  });
  return { context, page };
}

async function assertPublicScreenshotIsSanitized(
  page,
  screenshotName,
  expectedFixtureTerms,
) {
  const visibleText = await page.locator("body").innerText();
  const missingTerm = expectedFixtureTerms.find(
    (term) => !visibleText.includes(term),
  );
  if (missingTerm) {
    throw new Error(
      `${screenshotName} is not using the expected public fixture: ${missingTerm}`,
    );
  }
  const sensitiveMatch = sensitivePublicScreenshotPatterns.find(({ pattern }) =>
    pattern.test(visibleText),
  );
  if (sensitiveMatch) {
    throw new Error(`${screenshotName} contains ${sensitiveMatch.label}`);
  }
}

async function captureAction(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=action&overviewWorkspace=r-series",
  });
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });
  await dialog.waitFor();
  const projects = dialog.getByRole("combobox", { name: /项目/ });
  await projects.click();
  for (const name of ["示例控制台", "示例门户", "示例移动端"]) {
    await page.getByRole("option", { name }).click();
  }
  await page.keyboard.press("Escape");
  await page.getByRole("option", { name: "示例控制台" }).waitFor({
    state: "hidden",
  });
  await dialog
    .getByRole("combobox", { name: /统一分支覆盖/ })
    .fill("release_demo_202608");
  await assertPublicScreenshotIsSanitized(page, "action-batch-deploy-pre.png", [
    "demo-workspace",
    "示例控制台",
    "示例门户",
    "示例移动端",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "action-batch-deploy-pre.png") });
  await context.close();
}

async function captureBuildRecord(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=build",
  });
  await page.getByLabel("Build 文档截图页面").waitFor();
  await page.getByRole("button", { name: /^(Build|构建)$/ }).waitFor();
  await page.getByText("构建移动端", { exact: true }).waitFor();
  await page.locator(".workflow-history-panel .app-history-card").first().waitFor();
  await page.locator(".workspace--workflow").evaluate((element) => {
    element.scrollTop = 0;
  });
  await assertPublicScreenshotIsSanitized(page, "build-record-details.png", [
    "示例工作区",
    "示例控制台",
    "demo-console",
    "release_demo_202608",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "build-record-details.png") });
  await context.close();
}

async function captureBranchRecord(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=git",
  });
  await page.getByLabel("Git 文档截图页面").waitFor();
  await page.getByRole("button", { name: "Git", exact: true }).waitFor();
  await page.getByText("release_demo_202608", { exact: true }).first().waitFor();
  await page.locator(".workflow-history-panel .app-history-card").first().waitFor();
  await page.locator(".workspace--workflow").evaluate((element) => {
    element.scrollTop = 0;
  });
  await assertPublicScreenshotIsSanitized(page, "branch-record-summary.png", [
    "示例工作区",
    "示例控制台",
    "示例门户",
    "release_demo_202608",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "branch-record-summary.png") });
  await context.close();
}

async function captureProjectsList(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=projects",
  });
  await page.getByLabel("项目列表文档截图页面").waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).waitFor();
  await page.getByText("示例控制台", { exact: true }).waitFor();
  await assertPublicScreenshotIsSanitized(page, "projects-list.png", [
    "示例工作区",
    "示例控制台",
    "示例移动端",
    "运行中",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "projects-list.png") });
  await context.close();
}

async function captureRuntimePanel(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=runtime",
  });
  await page.getByLabel("项目列表文档截图页面").waitFor();
  await page.getByRole("button", { name: "示例控制台 更多操作" }).click();
  await page.getByRole("menuitem", { name: "运行面板", exact: true }).click();
  await page.locator(".runtime-panel-dialog").waitFor();
  await page.getByText("链路预检", { exact: true }).waitFor();
  await page.getByText("运行上下文", { exact: true }).waitFor();
  await assertPublicScreenshotIsSanitized(page, "project-runtime-panel.png", [
    "示例控制台",
    "链路预检",
    "运行上下文",
    "UAT3 VKE",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "project-runtime-panel.png") });
  await context.close();
}

async function captureRuntimeConfigPanel(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=runtime",
  });
  await page.getByLabel("项目列表文档截图页面").waitFor();
  await page.getByRole("button", { name: "示例控制台 更多操作" }).click();
  await page.getByRole("menuitem", { name: "运行面板", exact: true }).click();
  await page.locator(".runtime-panel-dialog").waitFor();
  await page.getByRole("tab", { name: /运行配置/ }).click();
  await page.getByText("共享运行环境", { exact: true }).waitFor();
  await page.getByText("解析链", { exact: true }).waitFor();
  await assertPublicScreenshotIsSanitized(page, "project-runtime-config-panel.png", [
    "示例控制台",
    "解析链",
    "共享运行环境",
    "UAT3 VKE",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({
    path: resolve(outputDir, "project-runtime-config-panel.png"),
  });
  await context.close();
}

async function captureResources(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=resources",
  });
  await page.getByLabel("资源入口文档截图页面").waitFor();
  await page.getByRole("button", { name: "资源管理", exact: true }).waitFor();
  await page.getByText("批量部署 Pre", { exact: true }).waitFor();
  await assertPublicScreenshotIsSanitized(page, "resources-actions.png", [
    "示例工作区",
    "批量部署 Pre",
    "示例联调链路",
    "入口配置",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "resources-actions.png") });
  await context.close();
}

async function captureProxy(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=proxy",
  });
  await page.locator('[data-proxy-dashboard="services-rules"]').waitFor();
  await page
    .locator(".proxy-overview-toolbar")
    .getByRole("button", { name: "代理配置", exact: true })
    .waitFor();
  await page.getByText("订单查询 Mock", { exact: true }).waitFor();
  await assertPublicScreenshotIsSanitized(page, "local-proxy-rules.png", [
    "代理配置",
    "示例本地代理",
    "订单查询 Mock",
    "127.0.0.1:8791",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "local-proxy-rules.png") });
  await context.close();
}

async function captureKnowledge(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=knowledge",
  });
  await page.locator(".knowledge-page").waitFor();
  await page.getByRole("heading", { name: "本地代理排障", exact: true }).waitFor();
  await page.getByText("建议拓扑", { exact: true }).waitFor();
  await assertPublicScreenshotIsSanitized(page, "knowledge-base-notes.png", [
    "示例工作区",
    "知识库",
    "本地代理排障",
    "发布前验证清单",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "knowledge-base-notes.png") });
  await context.close();
}

async function captureActivity(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=activity&overviewWorkspace=demo-workspace",
  });
  await page.getByLabel("打开活动中心").click();
  await page.getByRole("complementary", { name: "活动中心" }).waitFor();
  await page.getByText("运行与活动", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /活动记录/ }).click();
  await page.getByText(/全部来源/).waitFor();
  await page.getByText("示例控制台", { exact: true }).first().waitFor();
  await assertPublicScreenshotIsSanitized(page, "activity-center-pagination-preview.jpeg", [
    "运行与活动",
    "运行中",
    "活动记录",
    "示例控制台",
    "本地联调代理",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({
    path: resolve(outputDir, "activity-center-pagination-preview.jpeg"),
    type: "jpeg",
    quality: 90,
  });
  await context.close();
}

async function captureProjectConfig(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=project-config",
  });
  const dialog = page.getByRole("dialog", { name: /项目配置/ });
  await dialog.waitFor();
  await page.getByText("基础信息", { exact: true }).waitFor();
  await page.getByText("Demo", { exact: true }).first().waitFor();
  await assertPublicScreenshotIsSanitized(page, "project-config-panel.png", [
    "项目配置",
    "Demo",
    "demo",
    "基础信息",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "project-config-panel.png") });
  await context.close();
}

async function captureConfigSource(browser) {
  const { context, page } = await createPage(browser, {
    query: "style=mono&docsScreenshot=config-source",
  });
  const dialog = page.getByRole("dialog", { name: /配置源管理/ });
  await dialog.waitFor();
  await page.getByText("默认配置", { exact: true }).first().waitFor();
  await assertPublicScreenshotIsSanitized(page, "config-source-manager.png", [
    "配置源管理",
    "默认配置",
    "资源入口",
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outputDir, "config-source-manager.png") });
  await context.close();
}

let browser;
try {
  await mkdir(outputDir, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CI ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" }),
  });
  await captureAction(browser);
  await captureProjectsList(browser);
  await captureRuntimePanel(browser);
  await captureRuntimeConfigPanel(browser);
  await captureBuildRecord(browser);
  await captureBranchRecord(browser);
  await captureResources(browser);
  await captureProxy(browser);
  await captureKnowledge(browser);
  await captureActivity(browser);
  await captureProjectConfig(browser);
  await captureConfigSource(browser);
  console.log(`Captured documentation screenshots in ${outputDir}`);
} finally {
  await browser?.close();
  stopServer();
}
