import { expect, test } from "@playwright/test";

test("workspace archive deep link opens and locates the archived item", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page
    .getByRole("button", { name: "打开归档工作区定位测试" })
    .click();

  const dialog = page.getByRole("dialog", { name: "工作区配置" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "已归档 1", exact: true }),
  ).toHaveClass(/MuiButton-contained/);
  const focused = dialog.locator(".overview-workspace-config-item.is-focused");
  await expect(focused).toContainText("已上线需求工作区");
  await expect(focused).toContainText("需求已上线");
});

test("workspace archive dialog accepts an optional reason", async ({ page }) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();
  await page
    .getByRole("button", { name: "工作区配置", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());

  const workspaceDialog = page.getByRole("dialog", { name: "工作区配置" });
  await workspaceDialog
    .getByRole("button", {
      name: "归档工作区 2026-07-16 上线",
      exact: true,
    })
    .click();

  const archiveDialog = page.getByRole("dialog", { name: "归档工作区" });
  const reason = archiveDialog.getByLabel("归档原因（可选）");
  await reason.fill("需求已上线");
  await expect(reason).toHaveValue("需求已上线");
  await archiveDialog.getByRole("button", { name: "取消", exact: true }).click();
});

test("workspace quick launch card exposes its effective configuration sources", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();

  const project = page
    .getByRole("button", { name: /智能营销/ })
    .filter({ has: page.getByText("档案 UAT3 VKE") });
  await expect(project).toBeVisible();
  const sources = page.getByLabel("智能营销 运行配置来源");
  await expect(sources).toContainText("档案 · 工作区默认");
  await expect(sources).toContainText("命令/端口 · 项目启动档案");
  await expect(sources).toContainText("环境 · 工作区运行环境");
  const preflightButton = page.getByRole("button", {
    name: "智能营销 启动预检：需留意",
  });
  await expect(preflightButton).toBeVisible();
  await preflightButton.click();
  const preflightDialog = page.getByRole("dialog", {
    name: "智能营销 启动预检详情",
  });
  const lightPreflightSurface = await preflightDialog.evaluate((element) => {
    const paper = element.closest<HTMLElement>(
      ".overview-runtime-preflight-paper",
    )!;
    const check = element.querySelector<HTMLElement>(
      ".overview-runtime-preflight-check",
    )!;
    return {
      paperBackground: getComputedStyle(paper).backgroundColor,
      paperBackgroundImage: getComputedStyle(paper).backgroundImage,
      paperBackdrop: getComputedStyle(paper).backdropFilter,
      checkBackground: getComputedStyle(check).backgroundColor,
    };
  });
  expect(lightPreflightSurface.paperBackground).toBe("rgb(248, 251, 255)");
  expect(lightPreflightSurface.paperBackgroundImage).toBe("none");
  expect(lightPreflightSurface.paperBackdrop).toBe("none");
  expect(lightPreflightSurface.checkBackground).toBe("rgb(255, 255, 255)");
  await expect(preflightDialog).toContainText("启动命令");
  await expect(preflightDialog).toContainText("第 1 次检查");
  await page.waitForTimeout(250);
  await preflightDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-preflight.png",
  });
  await preflightDialog.getByRole("button", { name: "启动代理" }).click();
  const fixDialog = page.getByRole("dialog", { name: /快速修复/ });
  await expect(fixDialog).toContainText("工作区代理");
  await expect(fixDialog).toContainText("本地联调代理 · http://127.0.0.1:8791");
  await fixDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-preflight-fix.png",
  });
  await fixDialog.getByRole("button", { name: "启动并重新检查" }).click();
  await expect(page.getByTestId("workspace-runtime-proxy-state")).toHaveText(
    "local-debug:workspace-proxy",
  );
  await expect(
    page.getByRole("button", {
      name: "智能营销 启动预检：可启动",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "智能营销 启动预检：可启动",
    })
    .click();
  await expect(preflightDialog).toContainText("第 2 次检查");
  await preflightDialog
    .getByRole("button", { name: "刷新 智能营销 启动预检" })
    .click();
  await expect(preflightDialog).toContainText("第 3 次检查");
  await preflightDialog.getByRole("button", { name: "查看运行配置" }).click();
  await expect(page.getByTestId("workspace-runtime-action-state")).toHaveText(
    "demo:runtimePanel:config",
  );
  await expect(preflightDialog).toHaveCount(0);

  await page.getByRole("button", { name: "选择 智能营销 启动档案" }).click();
  const startDialog = page.getByRole("dialog", {
    name: /启动 智能营销/,
  });
  await expect(startDialog).toBeVisible();
  await expect(
    startDialog.getByRole("combobox", {
      name: /智能营销 启动档案/,
    }),
  ).toHaveText(/UAT3 VKE/);
  await startDialog
    .getByRole("combobox", { name: /智能营销 启动档案/ })
    .click();
  await page.getByRole("option", { name: /DC2 VKE/ }).click();
  await expect(startDialog).toContainText("npm run dev -- --mode dc2-vke");
  await expect(startDialog).toContainText("5174");
  await expect(
    startDialog.getByRole("combobox", { name: "快捷启动" }),
  ).toHaveText("仅必要时确认");
  await startDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-start-dialog.png",
  });
  await expect(
    startDialog.getByRole("button", { name: "启动项目" }),
  ).toBeEnabled();
  await startDialog.getByRole("button", { name: "启动项目" }).click();
  await expect(page.getByTestId("workspace-runtime-start-state")).toHaveText(
    "demo:dc2-vke",
  );

  const metrics = await project.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
  expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(1);

  await page.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-sources.png",
    fullPage: true,
  });

  await page.goto("/smoke.html?style=mono");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();
  await expect(page.getByLabel("智能营销 运行配置来源")).toContainText(
    "环境 · 工作区运行环境",
  );
  await page.getByRole("button", { name: "智能营销 启动预检：需留意" }).click();
  const darkPreflightDialog = page.getByRole("dialog", {
    name: "智能营销 启动预检详情",
  });
  await expect(darkPreflightDialog).toBeVisible();
  const darkPreflightSurface = await darkPreflightDialog.evaluate((element) => {
    const paper = element.closest<HTMLElement>(
      ".overview-runtime-preflight-paper",
    )!;
    const check = element.querySelector<HTMLElement>(
      ".overview-runtime-preflight-check",
    )!;
    return {
      paperBackground: getComputedStyle(paper).backgroundColor,
      checkBackground: getComputedStyle(check).backgroundColor,
    };
  });
  expect(darkPreflightSurface.paperBackground).toBe("rgb(18, 23, 30)");
  expect(darkPreflightSurface.checkBackground).toBe("rgb(24, 31, 40)");
  await page.waitForTimeout(250);
  await darkPreflightDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-preflight-dark.png",
  });
  await darkPreflightDialog.getByRole("button", { name: "启动代理" }).click();
  const darkFixDialog = page.getByRole("dialog", { name: /快速修复/ });
  await expect(darkFixDialog).toBeVisible();
  await darkFixDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-preflight-fix-dark.png",
  });
  await page.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-sources-dark.png",
    fullPage: true,
  });
});

test("workspace preflight can change a conflicting Vite port and save the profile", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开端口冲突修复测试" }).click();

  await page
    .getByRole("button", { name: "智能营销 启动预检：不可启动" })
    .click();
  const preflightDialog = page.getByRole("dialog", {
    name: "智能营销 启动预检详情",
  });
  await expect(preflightDialog).toContainText(
    "端口 5173 已被 node (PID 1420) 占用",
  );
  await preflightDialog.getByRole("button", { name: "换用 5175" }).click();

  const fixDialog = page.getByRole("dialog", { name: /快速修复/ });
  await expect(fixDialog).toContainText("5173 · 已被占用");
  await expect(fixDialog.getByLabel("本次启动端口")).toHaveValue("5175");
  await fixDialog.getByRole("checkbox", { name: "同时保存为启动档案" }).check();
  await expect(fixDialog.getByLabel("启动档案名称")).toHaveValue(
    "UAT3 VKE · 端口 5175",
  );
  await fixDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-port-fix.png",
  });
  await fixDialog.getByRole("button", { name: "使用 5175 启动" }).click();

  await expect(page.getByTestId("workspace-runtime-start-state")).toHaveText(
    "demo:uat3-vke:5175",
  );
  await expect(page.getByTestId("workspace-runtime-profile-state")).toHaveText(
    "uat3-vke-port-5175",
  );
  await expect(fixDialog).toHaveCount(0);

  await page.goto("/smoke.html?style=mono");
  await page.getByRole("button", { name: "打开端口冲突修复测试" }).click();
  await page
    .getByRole("button", { name: "智能营销 启动预检：不可启动" })
    .click();
  await page
    .getByRole("dialog", { name: "智能营销 启动预检详情" })
    .getByRole("button", { name: "换用 5175" })
    .click();
  const darkFixDialog = page.getByRole("dialog", { name: /快速修复/ });
  await darkFixDialog
    .getByRole("checkbox", { name: "同时保存为启动档案" })
    .check();
  await darkFixDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-port-fix-dark.png",
  });
});

test("workspace preflight can create a detected profile and repair a stale selection", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开启动档案生成测试" }).click();

  await page.getByRole("button", { name: "智能营销 启动预检：需留意" }).click();
  const preflightDialog = page.getByRole("dialog", {
    name: "智能营销 启动预检详情",
  });
  await expect(preflightDialog).toContainText("使用项目默认启动配置");
  await preflightDialog.getByRole("button", { name: "生成启动档案" }).click();

  const createDialog = page.getByRole("dialog", { name: /快速修复/ });
  await expect(createDialog).toContainText("npm run dev");
  await expect(createDialog).toContainText("/mock/projects/demo");
  await expect(createDialog).toContainText("npm · Node 20 · 端口 5173");
  await expect(createDialog.getByLabel("启动档案名称")).toHaveValue(
    "智能营销 本地启动",
  );
  await createDialog.getByLabel("启动档案名称").fill("智能营销 本地档案");
  await createDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-profile-create.png",
  });
  await createDialog.getByRole("button", { name: "创建并使用" }).click();
  await expect(page.getByTestId("workspace-runtime-profile-state")).toHaveText(
    "demo-local",
  );
  await expect(createDialog).toHaveCount(0);

  await page
    .getByRole("button", {
      name: "关闭工作区运行来源测试",
    })
    .click();
  await page.getByRole("button", { name: "打开失效档案修复测试" }).click();
  await page
    .getByRole("button", { name: "智能营销 启动预检：不可启动" })
    .click();
  const stalePreflightDialog = page.getByRole("dialog", {
    name: "智能营销 启动预检详情",
  });
  await expect(stalePreflightDialog).toContainText("启动档案不存在: removed");
  await stalePreflightDialog
    .getByRole("button", { name: "使用基础配置" })
    .click();

  const resetDialog = page.getByRole("dialog", { name: /快速修复/ });
  await expect(resetDialog).toContainText("清除已失效的启动档案偏好");
  await resetDialog.screenshot({
    path: "node_modules/.cache/playwright-results/workspace-runtime-profile-reset.png",
  });
  await resetDialog.getByRole("button", { name: "恢复基础配置" }).click();
  await expect(page.getByTestId("workspace-runtime-profile-state")).toHaveText(
    "base",
  );
  await expect(resetDialog).toHaveCount(0);
});
