import { expect, test } from "@playwright/test";

test("workspace Action tool opens the shared parameter dialog before execution", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();

  const actionCard = page
    .locator(".overview-shortcut--with-run")
    .filter({ hasText: "批量部署 Pre" });
  await expect(actionCard).toContainText("选择项目和分支，检查计划后执行");

  const runButton = actionCard.getByRole("button", {
    name: "配置并运行 批量部署 Pre",
    exact: true,
  });
  await expect(runButton).toBeVisible();
  await runButton.click();

  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("执行参数");
  await expect(dialog.getByRole("button", { name: "检查计划" })).toBeVisible();
});

test("workspace Action tool localizes its outer card from structured fields", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("rdevtool:language-preference-changed", {
        detail: "en-US",
      }),
    ),
  );

  const actionCard = page
    .locator(".overview-shortcut--with-run")
    .filter({ hasText: "Batch Deploy Pre" });
  await expect(actionCard).toContainText(
    "Tool action · batch-deploy-pre · Action run · Select work projects, validate each project's standard configuration, and trigger its pre deployment.",
  );
  await expect(
    actionCard.getByRole("button", {
      name: "Configure and run Batch Deploy Pre",
      exact: true,
    }),
  ).toBeVisible();
  await expect(actionCard).not.toContainText("批量部署 Pre");
});
