import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "代理配置", exact: true }).click();
});

test("external proxy listeners stay visible and read-only", async ({ page }) => {
  const toolbar = page.locator('[aria-label="本地代理概览与配置"]');
  await expect(toolbar).toContainText("运行中0");
  await expect(toolbar).toContainText("外部占用1");
  await expect(toolbar).toContainText("规则2");

  await expect(page.getByRole("button", { name: "新建服务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建规则" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "代理规则列表" }).getByRole("listitem"),
  ).toHaveCount(2);

  const service = page.getByRole("listitem").filter({
    hasText: "优客贷车后本地代理",
  });
  await expect(service).toContainText("外部占用");
  await expect(
    service.getByRole("button", { name: "外部进程占用，无法操作" }),
  ).toBeDisabled();
  await expect(service.getByRole("button", { name: "启动代理" })).toHaveCount(0);
  await expect(service.getByRole("button", { name: "停止代理" })).toHaveCount(0);

  await toolbar.getByRole("button", { name: "代理配置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "代理配置" });
  await expect(dialog).toContainText("外部占用");
  await expect(dialog.getByText("http://127.0.0.1:8791", { exact: true }).first()).toBeVisible();
});

test("proxy overview stays on one row at compact desktop widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 800 });

  const toolbar = page.locator('[aria-label="本地代理概览与配置"]');
  const metric = toolbar.locator(".workspace-page-toolbar-metric").first();
  const action = toolbar.getByRole("button", { name: "请求记录" });
  const [toolbarBounds, metricBounds, actionBounds] = await Promise.all([
    toolbar.boundingBox(),
    metric.boundingBox(),
    action.boundingBox(),
  ]);

  expect(toolbarBounds).not.toBeNull();
  expect(metricBounds).not.toBeNull();
  expect(actionBounds).not.toBeNull();
  expect(Math.abs(metricBounds!.y - actionBounds!.y)).toBeLessThanOrEqual(1);
  expect(toolbarBounds!.height).toBeLessThanOrEqual(54);

  await page.setViewportSize({ width: 600, height: 800 });
  const [serviceBounds, rulesBounds, titleBounds, bulkActionsBounds] =
    await Promise.all([
      page.locator(".proxy-service-panel").boundingBox(),
      page.locator(".proxy-rules-panel").boundingBox(),
      page.locator(".proxy-rules-panel .proxy-panel-title-copy").boundingBox(),
      page.locator(".proxy-rule-bulk-actions").boundingBox(),
    ]);
  expect(serviceBounds).not.toBeNull();
  expect(rulesBounds).not.toBeNull();
  expect(titleBounds).not.toBeNull();
  expect(bulkActionsBounds).not.toBeNull();
  expect(rulesBounds!.y).toBeGreaterThanOrEqual(
    serviceBounds!.y + serviceBounds!.height,
  );
  expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(
    bulkActionsBounds!.x,
  );

  const documentWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(documentWidths.scroll).toBe(documentWidths.client);
});
