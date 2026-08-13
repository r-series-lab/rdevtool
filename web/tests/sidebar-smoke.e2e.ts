import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
});

test("sidebar keeps its width and exposes the refined shell hierarchy", async ({ page }) => {
  const sidebar = page.locator("aside.sidebar");

  await expect(sidebar).toHaveCSS("width", "204px");
  await expect(sidebar.getByLabel("rDevTool")).toBeVisible();
  await expect(sidebar.getByText("开发工作台", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("工作台", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("当前工作区", { exact: true })).toBeVisible();

  const switcher = sidebar.getByRole("button", { name: "切换工作区", exact: true });
  await switcher.click();
  const menu = page.getByRole("menu", { name: "切换工作区" });
  await expect(menu.getByText("切换工作区", { exact: true })).toBeVisible();
  const workspaceOptions = menu.getByRole("menuitemradio");
  await expect(menu.locator(".workspace-menu-count")).toHaveText(
    String(await workspaceOptions.count()),
  );
});

test("project management submenu drives active state and content", async ({
  page,
}) => {
  const sidebar = page.locator("aside.sidebar");
  const mainMenu = sidebar.getByRole("navigation", { name: "主菜单" });
  const projectManagement = mainMenu.getByRole("button", {
    name: "项目管理",
    exact: true,
  });

  await expect(projectManagement).toHaveAttribute("aria-expanded", "false");
  await projectManagement.click();
  await expect(projectManagement).toHaveAttribute("aria-expanded", "true");
  await expect(projectManagement).toHaveAttribute("aria-current", "page");

  const submenu = sidebar.getByLabel("项目管理二级菜单");
  await expect(submenu).toBeVisible();

  const cases = [
    { name: "项目", state: "projectManagement/projects", content: "项目内容" },
    { name: "构建", state: "projectManagement/build", content: "构建内容" },
    { name: "Git", state: "projectManagement/git", content: "Git 内容" },
  ];

  for (const item of cases) {
    const navItem = submenu.getByRole("button", {
      name: item.name,
      exact: true,
    });
    await navItem.click();
    await expect(navItem).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("active-state")).toHaveText(item.state);
    await expect(page.getByRole("heading", { name: item.content })).toBeVisible();
  }

  await expect(sidebar.getByText("系统设置", { exact: true })).toHaveCount(0);
});

test("project management group collapses and expands", async ({ page }) => {
  const sidebar = page.locator("aside.sidebar");
  const projectManagement = sidebar.getByRole("button", {
    name: "项目管理",
    exact: true,
  });

  await projectManagement.click();
  await expect(sidebar.getByLabel("项目管理二级菜单")).toBeVisible();

  await projectManagement.click();
  await expect(projectManagement).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.getByLabel("项目管理二级菜单")).toHaveCount(0);

  await projectManagement.click();
  await expect(projectManagement).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByLabel("项目管理二级菜单")).toBeVisible();
});

test("workspace switcher searches, resets and selects a workspace", async ({ page }) => {
  const switcher = page.getByRole("button", { name: "切换工作区", exact: true });
  await expect(switcher).toContainText("全局");
  await switcher.click();

  const menu = page.getByRole("menu", { name: "切换工作区" });
  const search = menu.getByRole("textbox", { name: "搜索工作区名称或 ID" });
  await expect(search).toBeFocused();
  await expect(menu.getByRole("menuitemradio", { name: /全局.*全部项目/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await search.fill("优客");
  await expect(
    menu.getByRole("menuitemradio", { name: /REQ-1234 优客贷.*2 个项目/ }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /R系列/ })).toHaveCount(0);
  await menu.getByRole("button", { name: "查看全部结果", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(menu.getByRole("menuitemradio", { name: /R系列.*11 个项目/ })).toBeVisible();

  await search.fill("xyz123");
  await expect(menu.getByRole("status")).toContainText("未找到相关工作区");
  await menu.getByRole("button", { name: "清空搜索", exact: true }).click();
  await menu.getByRole("menuitemradio", { name: /R系列.*11 个项目/ }).click();

  await expect(page.getByTestId("active-workspace-state")).toHaveText("r-series");
  await expect(switcher).toContainText("R系列");
  await expect(menu).toHaveCount(0);
});

test("workbench fits the compact desktop window boundary", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 640 });
  await expect(page.getByText("rDevTool", { exact: true })).toBeVisible();

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
});

test("runtime center separates live resources from activity history", async ({
  page,
}) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await activityCenter.getByRole("tab", { name: "运行中 4", exact: true }).click();

  await expect(
    activityCenter.getByText("当前工作区", { exact: true }),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("共享服务", { exact: true }),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("http://127.0.0.1:1420", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("http://127.0.0.1:8791", { exact: true }),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("3 个活跃端口", { exact: true }),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("1 个端口冲突", { exact: true }),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("1 个外部进程", { exact: true }),
  ).toBeVisible();
  await expect(activityCenter.getByText(/更新$/)).toBeVisible();
  await expect(
    activityCenter.getByText("本次 12 个请求", { exact: true }),
  ).toBeVisible();
  await expect(
    activityCenter.getByText("1 个异常", { exact: true }),
  ).toBeVisible();

  const externalRuntimeRow = activityCenter.locator(".active-session-row").filter({
    has: page.locator(".active-session-name").filter({
      hasText: /^Legacy Portal$/,
    }),
  });
  await expect(externalRuntimeRow).toContainText("外部进程");
  await expect(externalRuntimeRow).toContainText("端口 1420 冲突");
  await expect(
    externalRuntimeRow.getByLabel("深度诊断", { exact: true }),
  ).toBeVisible();
  await externalRuntimeRow.getByLabel("认领并纳入管理", { exact: true }).click();
  await expect(activityCenter.getByRole("status")).toContainText(
    "Legacy Portal · 已纳入 rDevTool 管理",
  );

  const runtimeRow = activityCenter.locator(".active-session-row").filter({
    has: page.locator(".active-session-name").filter({
      hasText: /^rDevTool$/,
    }),
  });
  await runtimeRow.getByLabel("停止", { exact: true }).click();
  const stopDialog = page.getByRole("dialog", { name: "停止运行资源？" });
  await expect(stopDialog).toContainText("rDevTool");
  await stopDialog.getByRole("button", { name: "取消", exact: true }).click();

  await runtimeRow.getByLabel("停止", { exact: true }).click();
  await page
    .getByRole("dialog", { name: "停止运行资源？" })
    .getByRole("button", { name: "停止", exact: true })
    .click();
  await expect(activityCenter.getByRole("status")).toContainText(
    "rDevTool · 运行资源已停止",
  );

  await activityCenter.getByRole("tab", { name: /^活动记录 / }).click();
  await expect(activityCenter.locator(".activity-list-scroll")).toBeVisible();
});

test("runtime diagnostics inspect real listener evidence on demand", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();
  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await activityCenter.getByRole("tab", { name: "运行中 4", exact: true }).click();

  const conflictRow = activityCenter.locator(".active-session-row").filter({
    has: page.locator(".active-session-name").filter({
      hasText: /^Legacy Portal$/,
    }),
  });
  await conflictRow.getByLabel("深度诊断", { exact: true }).click();

  const inspectionDialog = page
    .locator(".active-session-inspection-dialog")
    .getByRole("dialog", { name: "端口 1420 深度诊断" });
  await expect(inspectionDialog).toBeVisible();
  await expect(inspectionDialog).toContainText("归属不匹配");
  await expect(inspectionDialog).toContainText("node ./node_modules/vite/bin/vite.js");
  await expect(inspectionDialog).toContainText("/workspace/rdevtool");
  await inspectionDialog.getByRole("button", { name: "打开资源详情" }).click();
  await expect(inspectionDialog).toBeHidden();
  await expect(activityCenter).toBeHidden();
});

test("controlled browser sessions expose read-only CDP details", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();
  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await activityCenter.getByRole("tab", { name: "运行中 4", exact: true }).click();

  const browserRow = activityCenter.locator(".active-session-row").filter({
    has: page.locator(".active-session-name").filter({ hasText: /^Chrome$/ }),
  });
  await expect(browserRow).toContainText("CDP 已连接");
  await expect(browserRow).toContainText("3 个受控页面");
  await expect(browserRow.getByLabel("停止", { exact: true })).toHaveCount(0);
  await browserRow.getByLabel("查看详情", { exact: true }).click();

  const dialog = page
    .locator(".active-browser-session-dialog")
    .getByRole("dialog", { name: "受控浏览器详情" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Chrome 139.0.7258.67");
  await expect(dialog).toContainText("http://127.0.0.1:9223");
  await expect(dialog).toContainText("rDevTool");
  await expect(dialog).toContainText("web-cdp");
  await expect(dialog).toContainText("http://127.0.0.1:1420/dashboard");
  await expect(dialog.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(activityCenter).toBeVisible();
});

test("sidebar collapse control preserves the workspace and restores navigation", async ({
  page,
}) => {
  const sidebar = page.locator("aside.sidebar");
  const collapse = page.getByRole("button", { name: "收起导航栏" });

  await collapse.click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("heading", { name: "总览内容" })).toBeVisible();

  const expand = page.getByRole("button", { name: "展开导航栏" });
  await expand.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "204px");
});
