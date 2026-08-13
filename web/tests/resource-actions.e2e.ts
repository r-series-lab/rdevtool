import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开参数化 Action 测试" }).click();
});

test("parameterized Action validates inputs and renders structured results", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await expect(dialog).toContainText(
    "按各项目标准配置检查部署计划，全部通过后逐个触发 pre 环境部署。",
  );
  await expect(dialog).toContainText("远程写入");
  await expect(dialog).toContainText("工作区 · demo-workspace");
  await expect(dialog).toContainText("部署目标 · standard");
  await expect(dialog).toContainText("部署环境 · pre");
  await expect(dialog.getByRole("combobox", { name: /统一分支覆盖/ })).toHaveValue("");
  const command = dialog.getByText("/bin/zsh scripts/preview-deploy.sh", { exact: true });
  await expect(command).not.toBeVisible();

  await dialog.getByText("执行详情", { exact: true }).click();
  await expect(command).toBeVisible();

  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();
  await expect(dialog).toContainText("必填");

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toContainText("已选 1/3");
  await dialog.getByRole("combobox", { name: /统一分支覆盖/ }).fill("feature/shared");
  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();

  await expect(dialog).toContainText("计划检查完成");
  await expect(dialog.getByText("计划检查完成", { exact: true })).toBeInViewport();
  await expect(dialog).toContainText("示例控制台");
  await expect(dialog).toContainText("环境 · pre");
  await expect(dialog.getByRole("button", { name: "打开结果" })).toBeVisible();
});

test("parameterized Action localizes schema-owned copy in English", async ({ page }) => {
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("rdevtool:language-preference-changed", {
        detail: "en-US",
      }),
    ),
  );

  const dialog = page.getByRole("dialog", { name: "Batch Deploy Pre" });
  await expect(dialog).toContainText(
    "Validate each project's deployment plan using its standard configuration, then trigger pre deployments one by one after all checks pass.",
  );
  await expect(dialog).toContainText("Workspace · demo-workspace");
  await expect(dialog).toContainText("Deployment Target · standard");
  await expect(dialog).toContainText("Deployment Environment · pre");
  await expect(
    dialog.getByRole("combobox", { name: /Unified Branch Override/ }),
  ).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Plan Check Only" })).toBeVisible();
  await expect(dialog.getByText("执行参数", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("统一分支覆盖", { exact: true })).toHaveCount(0);
});

test("structured results can retry only the failed selection", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.getByRole("option", { name: "示例门户" }).click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();

  await expect(dialog).toContainText("部分项目计划未通过");
  await expect(dialog).toContainText("计划被阻断");
  await dialog.getByRole("button", { name: "重试失败项（1）" }).click();

  await expect(dialog).toContainText("计划检查完成");
  await expect(dialog).toContainText("已选 1/3");
  await expect(dialog.getByRole("button", { name: "重试失败项（1）" })).toHaveCount(0);
});

test("project multi-select keeps every selected project visible", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });
  const projectSelect = dialog.getByRole("combobox", { name: /项目/ });

  await projectSelect.click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.getByRole("option", { name: "示例门户" }).click();
  await page.getByRole("option", { name: "示例移动端" }).click();
  await page.keyboard.press("Escape");

  await expect(projectSelect).toContainText("示例控制台");
  await expect(projectSelect).toContainText("示例门户");
  await expect(projectSelect).toContainText("示例移动端");
  await expect(dialog.getByText("+1", { exact: true })).toHaveCount(0);
});

test("changing parameters clears a stale result", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();
  await expect(dialog.getByText("计划检查完成", { exact: true })).toBeVisible();

  await dialog.getByRole("switch", { name: "仅检查计划" }).click();

  await expect(dialog.getByText("计划检查完成", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "生成执行计划", exact: true })).toBeVisible();
});

test("execution errors remain visible after the running state ends", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("combobox", { name: /统一分支覆盖/ })
    .fill("simulate-action-error");
  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("模拟 Action 执行失败");
  await expect(alert).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "检查计划", exact: true })).toBeEnabled();
});

test("running Actions stream logs and can be cancelled", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("combobox", { name: /统一分支覆盖/ })
    .fill("simulate-action-running");
  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();

  await expect(dialog.getByText("实时日志", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("checking plan: demo / standard / pre");
  await dialog.getByRole("button", { name: "停止执行", exact: true }).click();

  await expect(dialog).toContainText("执行已取消，进程已停止。");
  await expect(dialog.getByRole("button", { name: "检查计划", exact: true })).toBeEnabled();
});

test("running Actions can move to the background", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("combobox", { name: /统一分支覆盖/ })
    .fill("simulate-action-running");
  await dialog.getByRole("button", { name: "检查计划", exact: true }).click();

  await expect(dialog.getByRole("button", { name: "转到后台", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "转到后台", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("remote execution confirms the effective parameters", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "批量部署 Pre" });

  await dialog.getByRole("combobox", { name: /项目/ }).click();
  await page.getByRole("option", { name: "示例控制台" }).click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("switch", { name: "仅检查计划" }).click();
  await dialog.getByRole("button", { name: "生成执行计划", exact: true }).click();

  const confirmation = page.getByRole("dialog", { name: "确认执行该计划？" });
  await expect(confirmation).toContainText("已识别即将提交的实际部署目标");
  await expect(confirmation).toContainText("示例控制台");
  await expect(confirmation).toContainText("pre");
  await expect(confirmation).toContainText("feature/shared");
  await confirmation.getByRole("button", { name: "按计划执行", exact: true }).click();

  await expect(dialog).toContainText("部署任务已提交");
});

test("parameterless Action uses the same dialog without an empty parameter section", async ({
  page,
}) => {
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "打开无参数 Action 测试" }).click();

  const dialog = page.getByRole("dialog", { name: "刷新部署缓存" });
  await expect(dialog).toContainText("无参数 Action 使用同一执行面板。");
  await expect(dialog.getByText("执行参数", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "执行", exact: true })).toBeVisible();
});
