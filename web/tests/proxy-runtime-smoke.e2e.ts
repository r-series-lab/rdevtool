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

  const service = page
    .getByRole("list", { name: "代理服务列表" })
    .getByRole("listitem")
    .filter({ hasText: "http://127.0.0.1:8791" });
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

  const requestMetric = toolbar.locator(".workspace-page-toolbar-metric").last();
  await requestMetric.evaluate((element) => {
    const label = element.querySelector<HTMLElement>(
      ".workspace-page-toolbar-metric-label",
    );
    const value = element.querySelector<HTMLElement>(
      ".workspace-page-toolbar-metric-value",
    );
    if (label && value) {
      label.textContent = "Requests";
      value.textContent = "489";
    }
  });
  const [requestLabelBounds, requestValueBounds] = await Promise.all([
    requestMetric.locator(".workspace-page-toolbar-metric-label").boundingBox(),
    requestMetric.locator(".workspace-page-toolbar-metric-value").boundingBox(),
  ]);
  expect(requestLabelBounds).not.toBeNull();
  expect(requestValueBounds).not.toBeNull();
  expect(requestLabelBounds!.x + requestLabelBounds!.width).toBeLessThanOrEqual(
    requestValueBounds!.x - 4,
  );

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

test("proxy configuration uses the shared dark dialog surface", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono");
  await page.getByRole("button", { name: "代理配置", exact: true }).click();

  const toolbar = page.locator('[aria-label="本地代理概览与配置"]');
  await toolbar
    .getByRole("button", { name: "代理配置", exact: true })
    .click();

  const dialog = page.locator(".proxy-config-manager-dialog");
  await expect(dialog).toBeVisible();
  const colors = await dialog.evaluate((element) => {
    const backdrop = element.querySelector(".MuiBackdrop-root");
    const title = element.querySelector(".MuiDialogTitle-root");
    return {
      backdrop: backdrop ? getComputedStyle(backdrop).backgroundColor : "",
      title: title ? getComputedStyle(title).backgroundColor : "",
      titleImage: title ? getComputedStyle(title).backgroundImage : "",
    };
  });

  expect(colors.backdrop).toBe("rgba(3, 7, 12, 0.42)");
  expect(colors.title).toBe("rgba(17, 25, 36, 0.68)");
  expect(colors.titleImage).toContain("linear-gradient");

  const contentInsets = await dialog.evaluate((element) => {
    const content = element.querySelector(".proxy-config-manager-content");
    const detail = element.querySelector(".proxy-config-manager-detail");
    const editorBody = element.querySelector(".proxy-config-editor-body");
    const input = element.querySelector(".proxy-config-manager-detail .MuiInputBase-input");
    return {
      content: content ? getComputedStyle(content).padding : "",
      detail: detail ? getComputedStyle(detail).padding : "",
      editorBody: editorBody ? getComputedStyle(editorBody).padding : "",
      inputLeft: input ? getComputedStyle(input).paddingLeft : "",
    };
  });
  expect(contentInsets.content).toBe("8px");
  expect(contentInsets.detail).toBe("0px");
  expect(contentInsets.editorBody).toBe("10px 12px");
  expect(contentInsets.inputLeft).toBe("12px");

  await page.setViewportSize({ width: 390, height: 844 });
  const sourceName = dialog
    .locator(".resource-config-source-main .MuiTypography-caption")
    .first();
  const [dialogBounds, sourceNameBounds] = await Promise.all([
    dialog.getByRole("dialog", { name: "代理配置" }).boundingBox(),
    sourceName.boundingBox(),
  ]);
  expect(dialogBounds).not.toBeNull();
  expect(sourceNameBounds).not.toBeNull();
  expect(dialogBounds!.y).toBeGreaterThanOrEqual(7);
  expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(837);
  expect(sourceNameBounds!.width).toBeGreaterThan(40);
  expect(sourceNameBounds!.height).toBeLessThan(24);
});
