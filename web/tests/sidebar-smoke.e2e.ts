import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
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
    menu.getByRole("menuitemradio", { name: /CR2606150041 优客贷.*2 个项目/ }),
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
