import { expect, test } from "@playwright/test";

test("Git documentation screenshot keeps navigation, controls, and Record together", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono&docsScreenshot=git");

  await expect(page.getByLabel("Git 文档截图页面")).toBeVisible();
  await expect(page.getByRole("button", { name: "Git", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("button", { name: /^(合并分支|Merge Branches)$/ }),
  ).toBeVisible();
  await expect(page.getByText("release_demo_202608", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".workflow-history-panel")).toBeVisible();
  await expect(page.locator(".workflow-history-panel .app-history-card").first()).toBeVisible();
});

test("Build documentation screenshot keeps navigation, parameters, and Record together", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono&docsScreenshot=build");

  await expect(page.getByLabel("Build 文档截图页面")).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Build|构建)$/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText(/构建移动端|Build Mobile/, { exact: true })).toBeVisible();
  await expect(page.getByText(/开始构建|Start Build/, { exact: true })).toBeVisible();
  await expect(page.locator(".workflow-history-panel")).toBeVisible();
  await expect(page.locator(".workflow-history-panel .app-history-card").first()).toBeVisible();
});

test("Projects documentation screenshot shows project finder state", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono&docsScreenshot=projects");

  await expect(page.getByLabel("项目列表文档截图页面")).toBeVisible();
  await expect(page.getByRole("button", { name: "项目", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("示例控制台", { exact: true })).toBeVisible();
  await expect(page.getByText("示例移动端", { exact: true })).toBeVisible();
});

test("Resources documentation screenshot shows tool entries", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono&docsScreenshot=resources");

  await expect(page.getByLabel("资源入口文档截图页面")).toBeVisible();
  await expect(page.getByRole("button", { name: "资源管理", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("批量部署 Pre", { exact: true })).toBeVisible();
  await expect(page.getByText("示例联调链路", { exact: true })).toBeVisible();
});

test("Proxy documentation screenshot shows services and rules", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono&docsScreenshot=proxy");

  await expect(page.locator('[data-proxy-dashboard="services-rules"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "代理配置", exact: true }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("示例本地代理", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("订单查询 Mock", { exact: true })).toBeVisible();
});

test("Knowledge documentation screenshot shows note index and preview", async ({
  page,
}) => {
  await page.goto("/smoke.html?style=mono&docsScreenshot=knowledge");

  await expect(page.locator(".knowledge-page")).toBeVisible();
  await expect(page.getByRole("button", { name: "知识库", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "本地代理排障", exact: true })).toBeVisible();
  await expect(page.getByText("发布前验证清单", { exact: true }).first()).toBeVisible();
});
