import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
  await page
    .getByRole("navigation", { name: "主菜单" })
    .getByRole("button", { name: "知识", exact: true })
    .click();
});

test("knowledge library searches scopes and previews Markdown", async ({
  page,
}) => {
  await expect(page.locator('[data-knowledge-library="markdown"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /本地代理排障/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本地代理排障", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("127.0.0.1:8791")).toBeVisible();

  await page.getByRole("button", { name: "手册", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /发布前验证清单/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /本地代理排障/ }),
  ).toHaveCount(0);
});

test("knowledge search shows the matching body context", async ({ page }) => {
  await page
    .getByPlaceholder("搜索标题、正文或路径")
    .fill("下一跳状态");
  await page.getByRole("button", { name: "搜索", exact: true }).click();

  await expect(
    page.locator(".knowledge-document-summary mark"),
  ).toHaveText("下一跳状态");
});

test("knowledge Markdown links navigate between safe local notes", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "查看发布前验证清单" })
    .click();

  await expect(
    page.getByRole("heading", { name: "发布前验证清单", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /发布前验证清单/ })).toBeVisible();
});

test("knowledge library refreshes the selected note after app focus returns", async ({
  page,
}) => {
  const before = Number(
    (await page.locator("html").getAttribute("data-knowledge-read-count")) ??
      "0",
  );
  await page.waitForTimeout(850);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect
    .poll(async () =>
      Number(
        (await page
          .locator("html")
          .getAttribute("data-knowledge-read-count")) ?? "0",
      ),
    )
    .toBeGreaterThan(before);
});

test("knowledge library creates a Markdown note from the primary action", async ({
  page,
}) => {
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("标题").fill("联调复盘");
  await page.getByRole("button", { name: "新建并编辑" }).click();

  await expect(
    page.getByRole("heading", { name: "联调复盘", level: 1 }),
  ).toBeVisible();
});

test("system health is available from settings diagnostics", async ({ page }) => {
  await page.getByRole("button", { name: "打开设置" }).click();
  await page.getByRole("tab", { name: "系统诊断" }).click();

  await expect(
    page.locator('[data-system-diagnostics="read-only"]'),
  ).toBeVisible();
  await expect(page.getByText("rDevTool 本机状态正常。")).toBeVisible();
  await expect(page.getByText("知识笔记", { exact: true })).toBeVisible();
});

test("knowledge workbench stays within a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 640 });

  const bounds = await page.locator(".knowledge-workbench").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
});

test("knowledge workbench remains usable at the narrow fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });

  await expect(page.locator(".knowledge-index")).toBeVisible();
  await expect(page.locator(".knowledge-reader")).toBeVisible();
  const reader = await page.locator(".knowledge-reader").boundingBox();
  expect(reader).not.toBeNull();
  expect(reader!.width).toBeGreaterThan(300);
  expect(reader!.height).toBeGreaterThan(300);
});
