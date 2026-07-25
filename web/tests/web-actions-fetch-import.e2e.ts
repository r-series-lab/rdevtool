import { expect, test, type Page } from "@playwright/test";

const copiedFetch = `fetch("https://example.test/api/items?year=2026&quarter=Q2", {
  headers: {
    accept: "application/json",
    "content-type": "application/json;charset=UTF-8",
    authorization: "Bearer volatile-token",
    cookie: "browser-managed"
  },
  body: JSON.stringify({ pageNum: 1, pageSize: 500 }),
  method: "POST",
  mode: "cors",
  credentials: "include"
});`;

test.beforeEach(async ({ page }) => {
  await page.goto("/web-actions-smoke.html");
});

async function openFetchImporter(page: Page) {
  await page.getByRole("button", { name: "新建动作", exact: true }).click();
  await page.getByRole("menuitem", { name: /导入 Fetch/ }).click();
}

test("imports, edits and replays Chrome Copy as fetch", async ({ page }) => {
  await expect(page.getByRole("button", { name: "导入 Fetch", exact: true })).toHaveCount(0);
  await openFetchImporter(page);

  const dialog = page.getByRole("dialog", { name: "导入 Fetch", exact: true });
  await dialog.getByLabel("Chrome Copy as fetch").fill(copiedFetch);
  await dialog.getByRole("button", { name: "解析请求", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "URL" })).toHaveValue(
    "https://example.test/api/items",
  );
  await expect(page.getByLabel("Method")).toHaveText("POST");
  await expect(page.getByLabel("Credentials")).toHaveText("include");
  await expect(page.getByLabel("参数").nth(0)).toHaveValue("year");
  await expect(page.getByLabel("敏感值")).toHaveAttribute("type", "password");
  await expect(page.getByText(/浏览器控制 Header cookie/)).toBeVisible();

  await page.getByLabel("值").nth(0).fill("2027");
  await page.getByRole("button", { name: "运行动作", exact: true }).click();

  await expect(page.getByText(/"status": 200/)).toBeVisible();
  await expect(
    page.getByText(/"requestUrl": "https:\/\/example\.test\/api\/items\?year=2027&quarter=Q2"/),
  ).toBeVisible();
});

test("keeps the request editor inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await openFetchImporter(page);
  await page.getByLabel("Chrome Copy as fetch").fill(copiedFetch);
  await page.getByRole("button", { name: "解析请求", exact: true }).click();

  const panel = page.locator(".web-actions-panel");
  await expect(panel).toBeVisible();
  expect(
    await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "运行动作", exact: true })).toBeVisible();
});

test("creates and runs a blank HTTP request draft", async ({ page }) => {
  await page.getByRole("button", { name: "新建动作", exact: true }).click();
  await page.getByRole("menuitem", { name: "空白 HTTP 请求", exact: true }).click();

  await expect(page.getByText("HTTP 请求草稿", { exact: true })).toBeVisible();
  await expect(page.getByText("草稿 · GET 未设置 URL", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "URL" }).fill("/api/items");
  await page.getByRole("button", { name: "运行动作", exact: true }).click();

  await expect(page.getByText(/"requestUrl": "\/api\/items"/)).toBeVisible();
});
