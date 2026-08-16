import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html?overviewWorkspace=system");
  await page
    .getByRole("button", { name: "打开工作区运行来源测试" })
    .click();
});

test("global workspace keeps aggregate modules separate from the workspace directory", async ({
  page,
}) => {
  const panel = page.locator(".overview-global-workspace-panel");
  const workspaceDirectory = page.locator(
    ".overview-workspace-directory-panel",
  );
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "全局" })).toBeVisible();
  await expect(panel.locator('[data-overview-module="resources"]')).toBeVisible();
  await expect(panel.locator('[data-overview-module="tools"]')).toBeVisible();
  await expect(panel.locator('[data-overview-module="projects"]')).toBeVisible();
  await expect(panel.locator('[data-overview-module="proxy"]')).toBeVisible();
  await expect(workspaceDirectory).toBeVisible();
  await expect(panel.locator('[data-overview-module="workspaces"]')).toHaveCount(0);
  await expect(workspaceDirectory.locator(".overview-workspace-index-card")).toHaveCount(4);
  await expect(
    page.getByPlaceholder("搜索工作区、项目、入口、代理或动作"),
  ).toBeVisible();

  const toolbarLayout = await page.locator(".overview-global-toolbar").evaluate(
    (toolbar) => {
      const metricRects = Array.from(
        toolbar.querySelectorAll(".workspace-page-toolbar-metric"),
      ).map((metric) => metric.getBoundingClientRect());
      const actionRect = toolbar
        .querySelector(".workspace-page-toolbar-action")
        ?.getBoundingClientRect();
      return {
        metricHeights: metricRects.map((rect) => Math.round(rect.height)),
        metricTops: [...new Set(metricRects.map((rect) => Math.round(rect.top)))],
        actionHeight: actionRect ? Math.round(actionRect.height) : 0,
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
      };
    },
  );
  expect(toolbarLayout.metricHeights.every((height) => height === 31)).toBe(true);
  expect(toolbarLayout.metricTops).toHaveLength(1);
  expect(toolbarLayout.actionHeight).toBe(32);
  expect(toolbarLayout.scrollWidth).toBeLessThanOrEqual(toolbarLayout.clientWidth);

  const globalSurfaceLayout = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, right: rect.right } : null;
    };
    const overview = document.querySelector(".overview-page.is-global-workspace");
    return {
      overview: bounds(".overview-page.is-global-workspace"),
      toolbar: bounds(".overview-global-toolbar"),
      filter: bounds(".overview-filter-bar"),
      workspaceList: bounds(".overview-workspace-list"),
      paddingLeft: overview ? getComputedStyle(overview).paddingLeft : "",
    };
  });
  expect(globalSurfaceLayout.overview).not.toBeNull();
  expect(globalSurfaceLayout.toolbar).not.toBeNull();
  expect(globalSurfaceLayout.filter).not.toBeNull();
  expect(globalSurfaceLayout.workspaceList).not.toBeNull();
  expect(globalSurfaceLayout.paddingLeft).toBe("0px");
  expect(globalSurfaceLayout.toolbar!.left).toBe(globalSurfaceLayout.overview!.left);
  expect(globalSurfaceLayout.filter!.left).toBe(globalSurfaceLayout.overview!.left);
  expect(globalSurfaceLayout.workspaceList!.left).toBe(globalSurfaceLayout.overview!.left);

  const firstRow = workspaceDirectory
    .locator(".overview-workspace-index-card")
    .first();
  await firstRow.getByRole("button", { name: /更多操作/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "提取 AI 上下文" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "工作区配置" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".MuiBackdrop-root")).toHaveCount(0);

  const resources = panel.locator('[data-overview-module="resources"]');
  const resourceCollapse = resources.getByRole("button", { name: "收起 入口" });
  await resourceCollapse.click();
  await expect(resources).toHaveClass(/is-collapsed/);
  await expect(resources.locator(".overview-shortcut-grid")).toHaveCount(0);
  await expect(workspaceDirectory.locator(".overview-workspace-index-card")).toHaveCount(4);

  await panel.getByRole("button", { name: "全局 的模块布局" }).click();
  await page.getByRole("menuitem", { name: "展开全部模块" }).click();
  await expect(resources.locator(".overview-shortcut-grid")).toBeVisible();
  await expect(page.locator(".MuiBackdrop-root")).toHaveCount(0);

  await panel.getByRole("button", { name: "全局 的模块布局" }).click();
  await page.getByRole("menuitem", { name: "收起全部模块" }).click();
  await expect(resources.locator(".overview-shortcut-grid")).toHaveCount(0);
  await expect(workspaceDirectory.locator(".overview-workspace-index-card")).toHaveCount(4);
  await expect(page.locator(".MuiBackdrop-root")).toHaveCount(0);
  await panel.getByRole("button", { name: "全局 的模块布局" }).click();
  await page.getByRole("menuitem", { name: "展开全部模块" }).click();
  await expect(page.locator(".MuiBackdrop-root")).toHaveCount(0);

  await panel.getByRole("button", { name: "收起 全局" }).click();
  await expect(panel.locator('[data-overview-module="resources"]')).toHaveCount(0);
  await expect(workspaceDirectory.locator(".overview-workspace-index-card")).toHaveCount(4);
  await panel.getByRole("button", { name: "展开 全局" }).click();
  await expect(panel.locator('[data-overview-module="resources"]')).toBeVisible();

  await page.setViewportSize({ width: 720, height: 800 });

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  const layout = await page
    .locator(".overview-workspace-directory-panel .overview-workspace-index-card")
    .first()
    .evaluate((row) => {
      const bounds = (element: Element | null) => {
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      };
      return {
        row: bounds(row),
        copy: bounds(row.querySelector(".overview-workspace-index-copy")),
        enter: bounds(row.querySelector(".overview-workspace-index-enter")),
        menu: bounds(
          row.querySelector(".overview-workspace-index-menu-button"),
        ),
        summary: bounds(
          row.querySelector(".overview-workspace-index-summary"),
        ),
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });

  expect(layout.row).not.toBeNull();
  expect(layout.copy).not.toBeNull();
  expect(layout.enter).not.toBeNull();
  expect(layout.menu).not.toBeNull();
  expect(layout.summary).not.toBeNull();
  expect(layout.copy!.right).toBeLessThanOrEqual(layout.enter!.left);
  expect(layout.enter!.right).toBeLessThanOrEqual(layout.menu!.left);
  expect(layout.summary!.top).toBeGreaterThanOrEqual(layout.copy!.bottom);
  expect(layout.row!.right).toBeLessThanOrEqual(layout.pageClientWidth);
  expect(layout.pageScrollWidth).toBe(layout.pageClientWidth);

  await page.setViewportSize({ width: 726, height: 800 });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("rdevtool:language-preference-changed", {
        detail: "en-US",
      }),
    ),
  );
  const englishToolbar = page.locator(".overview-global-toolbar");
  await expect(
    englishToolbar.getByRole("button", {
      name: "Workspace Configuration",
    }),
  ).toBeVisible();
  const englishToolbarLayout = await englishToolbar.evaluate((toolbar) => {
    const action = toolbar.querySelector(
      ".workspace-page-toolbar-action",
    );
    const actionRect = action?.getBoundingClientRect();
    return {
      actionHeight: actionRect ? Math.round(actionRect.height) : 0,
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
    };
  });
  expect(englishToolbarLayout.actionHeight).toBe(32);
  expect(englishToolbarLayout.scrollWidth).toBeLessThanOrEqual(
    englishToolbarLayout.clientWidth,
  );
});
