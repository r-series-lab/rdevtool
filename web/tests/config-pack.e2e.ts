import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
  await page.getByLabel("打开设置").click();
  const dialog = page.getByRole("dialog", { name: /设置/ });
  await dialog.getByRole("tab", { name: "配置迁移" }).click();
});

test("configuration pack import plans mappings and supports transaction rollback", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog", { name: /设置/ });
  await expect(dialog.getByRole("checkbox", { name: "项目、构建、部署与 Git" })).toBeChecked();
  await expect(dialog.getByText("示例控制台", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Feature A", { exact: true })).toBeVisible();

  const panel = dialog.locator(".config-pack-panel");
  const layout = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  await dialog.getByRole("tab", { name: "导入", exact: true }).click();
  await dialog.getByRole("button", { name: "选择配置包" }).click();
  await expect(dialog.getByText("Team Development Baseline", { exact: true })).toBeVisible();
  await expect(dialog.getByText("已移除 2 个敏感值", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "配置源 default 导入到" }),
  ).toContainText("默认配置 · default");
  await expect(
    dialog.getByRole("combobox", { name: "配置源 team 导入到" }),
  ).toContainText("团队配置 · team");

  await dialog.getByRole("button", { name: "生成导入计划" }).click();
  await expect(dialog.getByText("项目 demo 需要本机路径映射。", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "项目 · demo" })).toHaveValue(
    "/mock/projects/demo",
  );
  await expect(dialog.getByRole("button", { name: "执行导入" })).toBeDisabled();

  await dialog.getByRole("button", { name: "重新检查计划" }).click();
  await expect(dialog.getByText("敏感值已省略，可在导入后配置。", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "执行导入" })).toBeEnabled();
  await dialog.getByRole("button", { name: "执行导入" }).click();

  const confirm = page.getByRole("dialog", { name: "执行配置导入" });
  await expect(confirm).toContainText("写入 2 项配置");
  await confirm.getByRole("button", { name: "执行导入" }).click();

  await expect(dialog.getByRole("button", { name: "回滚本次导入" })).toBeVisible();
  await dialog.getByRole("button", { name: "回滚本次导入" }).click();
  const rollback = page.getByRole("dialog", { name: "回滚本次配置导入" });
  await rollback.getByRole("button", { name: "回滚" }).click();
  await expect(dialog.getByText("配置导入已回滚。", { exact: true })).toBeVisible();
});

test("configuration pack export keeps modules and scopes readable in the settings width", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog", { name: /设置/ });
  await expect(dialog.getByRole("tab", { name: "导出", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByText("2/2", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("1/1", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("2/2 已选", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1/1 已选", { exact: true })).toBeVisible();

  const panel = dialog.locator(".config-pack-panel");
  const layout = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  await page.setViewportSize({ width: 760, height: 800 });
  const compactLayout = await panel.evaluate((element) => {
    const options = element.querySelectorAll<HTMLElement>(".config-pack-module-option");
    const first = options[0]?.getBoundingClientRect();
    const second = options[1]?.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      modulesStacked: Boolean(first && second && second.top >= first.bottom - 1),
    };
  });
  expect(compactLayout.scrollWidth).toBeLessThanOrEqual(compactLayout.clientWidth + 1);
  expect(compactLayout.modulesStacked).toBe(true);
});

test("configuration pack operations can be filtered and selectively replanned", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog", { name: /设置/ });
  await dialog.getByRole("tab", { name: "导入", exact: true }).click();
  await dialog.getByRole("button", { name: "选择配置包" }).click();
  await dialog.getByRole("button", { name: "生成导入计划" }).click();
  await dialog.getByRole("button", { name: "重新检查计划" }).click();

  const search = dialog.getByPlaceholder("搜索配置项或目标路径");
  await search.fill("feature-a");
  await expect(dialog.getByText("feature-a", { exact: true })).toBeVisible();
  await expect(dialog.getByText("demo", { exact: true })).toHaveCount(0);
  await search.clear();

  await dialog.getByRole("checkbox", { name: "选择配置项 feature-a" }).uncheck();
  await expect(
    dialog.getByText("操作选择已更改，请更新计划后再执行导入。", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "执行导入" })).toBeDisabled();
  await dialog.getByRole("button", { name: "更新导入计划" }).click();

  await expect(dialog.getByRole("checkbox", { name: "选择配置项 feature-a" })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "执行导入" })).toBeEnabled();
  await expect(dialog.locator(".config-pack-operation-row.is-excluded")).toHaveCount(1);
});

test("configuration pack history lists durable transactions and refreshes rollback state", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog", { name: /设置/ });
  await dialog.getByRole("tab", { name: "历史", exact: true }).click();

  const active = dialog.locator(".config-pack-history-row", {
    hasText: "Local Workbench Baseline",
  });
  const rolledBack = dialog.locator(".config-pack-history-row", {
    hasText: "Previous Baseline",
  });
  await expect(active.getByText("可回滚", { exact: true })).toBeVisible();
  await expect(active.getByRole("button", { name: "回滚" })).toBeEnabled();
  await expect(rolledBack.getByText("已回滚", { exact: true })).toBeVisible();
  await expect(rolledBack.getByRole("button", { name: "回滚" })).toBeDisabled();

  await active.getByRole("button", { name: "回滚" }).click();
  const confirm = page.getByRole("dialog", { name: "回滚本次配置导入" });
  await confirm.getByRole("button", { name: "回滚" }).click();
  await expect(active.getByText("已回滚", { exact: true })).toBeVisible();
  await expect(active.getByRole("button", { name: "回滚" })).toBeDisabled();
});
