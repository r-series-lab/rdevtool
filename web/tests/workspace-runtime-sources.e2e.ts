import { expect, test } from "@playwright/test";

test("workspace-owned resources can be managed from workspace configuration", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();
  await page
    .getByRole("button", { name: "工作区配置", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());

  const dialog = page.getByRole("dialog", { name: "工作区配置" });
  const editor = dialog.locator(".workspace-resource-editor");
  await expect(editor).toBeVisible();
  const insets = await dialog.evaluate((element) => {
    const main = element.querySelector(".overview-workspace-config-main");
    const detailContent = element.querySelector(
      ".overview-workspace-config-detail-card > .MuiStack-root",
    );
    return {
      main: main ? getComputedStyle(main).padding : "",
      detailContent: detailContent ? getComputedStyle(detailContent).padding : "",
    };
  });
  expect(insets.main).toBe("0px");
  expect(insets.detailContent).toBe("10px 12px 12px");
  await expect(dialog.getByText("4 个专属资源", { exact: true })).toBeVisible();
  await expect(editor.getByText("系统生成", { exact: true })).toHaveCount(2);

  const rules = editor
    .locator(".workspace-resource-row")
    .filter({ hasText: "玩法规则联调页" });
  await rules.getByRole("button", { name: "编辑资源 玩法规则联调页" }).click();
  await expect(rules.getByLabel("名称")).toHaveValue("玩法规则联调页");
  await expect(rules.getByLabel("URL")).toHaveValue(
    "http://127.0.0.1:4173/#/debug/gameplay-rules",
  );

  await rules.getByRole("button", { name: "复制资源 玩法规则联调页" }).click();
  await expect(editor.getByText("玩法规则联调页 副本", { exact: true })).toBeVisible();
  await expect(dialog.getByText("5 个专属资源", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(dialog.getByText("5 个专属资源", { exact: true })).toBeVisible();
});

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

test("workspace project instances show health and explain safe unbinding", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();
  await page
    .getByRole("button", { name: "工作区配置", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());

  const workspaceDialog = page.getByRole("dialog", { name: "工作区配置" });
  const instanceRow = workspaceDialog
    .locator(".overview-workspace-project-dir-row")
    .filter({ hasText: "示例控制台" });
  await expect(instanceRow).toContainText("工作区副本");
  await expect(instanceRow).toContainText("托管");
  await expect(instanceRow).toContainText("正常");
  await expect(
    instanceRow.getByRole("button", { name: "打开项目目录", exact: true }),
  ).toBeVisible();

  await instanceRow
    .getByRole("button", { name: "解除关联", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "解除 示例控制台 的项目实例关联？",
  });
  await expect(confirm).toContainText("不会删除托管目录或其中的代码");
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(workspaceDialog).toBeVisible();
});

test("missing managed worktree requires confirmation and repairs in place", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page
    .getByRole("button", { name: "打开工作区副本修复测试" })
    .click();
  await page
    .getByRole("button", { name: "工作区配置", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());

  const workspaceDialog = page.getByRole("dialog", { name: "工作区配置" });
  const instanceRow = workspaceDialog
    .locator(".overview-workspace-project-dir-row")
    .filter({ hasText: "示例控制台" });
  await expect(instanceRow).toContainText("目录缺失");
  await expect(instanceRow).toContainText("可按原路径和分支修复");
  await instanceRow
    .getByRole("button", { name: "修复副本", exact: true })
    .click();

  const confirm = page.getByRole("dialog", {
    name: "修复 示例控制台 的工作区副本？",
  });
  await expect(confirm).toContainText("/mock/workspaces/feature/demo");
  await expect(confirm).toContainText("feature/REQ-1234");
  await expect(confirm).toContainText("不会删除其他目录");
  await confirm.getByRole("button", { name: "修复", exact: true }).click();

  await expect(instanceRow).toContainText("正常");
  await expect(instanceRow).not.toContainText("目录缺失");
});

test("managed workspace copy opens an exact read-only cleanup assessment", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();
  await page
    .getByRole("button", { name: "工作区配置", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());

  const workspaceDialog = page.getByRole("dialog", { name: "工作区配置" });
  const instanceRow = workspaceDialog
    .locator(".overview-workspace-project-dir-row")
    .filter({ hasText: "示例控制台" });
  await instanceRow
    .getByRole("button", { name: "评估托管副本清理", exact: true })
    .click();

  await expect(workspaceDialog).not.toBeVisible();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole("tab", { name: "受管产物", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const focus = settings.locator(".settings-artifacts-focus");
  await expect(focus).toContainText("feature_demo_checkout");
  await expect(focus).toContainText("demo");
  await expect(settings.getByRole("textbox", { name: "搜索受管产物" })).toHaveValue(
    "/mock/workspaces/feature/demo",
  );
  const instanceArtifact = settings
    .locator(".settings-artifact-record")
    .filter({ hasText: "/mock/workspaces/feature/demo" });
  await expect(instanceArtifact).toContainText("工作区副本");
  await expect(
    instanceArtifact.getByRole("checkbox", {
      name: /选择工作区副本：\/mock\/workspaces\/feature\/demo/,
    }),
  ).toBeChecked();

  await settings
    .getByRole("button", { name: "评估选中项（1）", exact: true })
    .click();
  const plan = settings.locator(
    '[data-managed-artifact-cleanup-plan="read-only"]',
  );
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("/mock/workspaces/feature/demo");
  await expect(plan).toContainText("Git 工作树干净");
  await expect(
    plan.getByRole("button", { name: /确认清理|立即清理|执行清理/ }),
  ).toHaveCount(0);

  await focus.getByRole("button", { name: "清除定位", exact: true }).click();
  await expect(focus).toHaveCount(0);
  await expect(settings.getByRole("textbox", { name: "搜索受管产物" })).toHaveValue("");
  await expect(settings.locator(".settings-artifacts-scope input")).toBeEnabled();
  await expect(plan).toHaveCount(0);
});

test("workspace quick launch card exposes its effective configuration sources", async ({
  page,
}) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开工作区运行来源测试" }).click();

  const project = page
    .getByRole("button", { name: /示例控制台/ })
    .filter({ has: page.getByText("档案 UAT3 VKE") });
  await expect(project).toBeVisible();
  const sources = page.getByLabel("示例控制台 运行配置来源");
  await expect(sources).toContainText("档案 · 工作区默认");
  await expect(sources).toContainText("命令/端口 · 项目启动档案");
  await expect(sources).toContainText("环境 · 工作区运行环境");
  const preflightButton = page.getByRole("button", {
    name: "示例控制台 启动预检：需留意",
  });
  await expect(preflightButton).toBeVisible();
  await preflightButton.click();
  const preflightDialog = page.getByRole("dialog", {
    name: "示例控制台 启动预检详情",
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
      name: "示例控制台 启动预检：可启动",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "示例控制台 启动预检：可启动",
    })
    .click();
  await expect(preflightDialog).toContainText("第 2 次检查");
  await preflightDialog
    .getByRole("button", { name: "刷新 示例控制台 启动预检" })
    .click();
  await expect(preflightDialog).toContainText("第 3 次检查");
  await preflightDialog.getByRole("button", { name: "查看运行配置" }).click();
  await expect(page.getByTestId("workspace-runtime-action-state")).toHaveText(
    "demo:runtimePanel:config",
  );
  await expect(preflightDialog).toHaveCount(0);

  await page.getByRole("button", { name: "选择 示例控制台 启动档案" }).click();
  const startDialog = page.getByRole("dialog", {
    name: /启动 示例控制台/,
  });
  await expect(startDialog).toBeVisible();
  await expect(
    startDialog.getByRole("combobox", {
      name: /示例控制台 启动档案/,
    }),
  ).toHaveText(/UAT3 VKE/);
  await startDialog
    .getByRole("combobox", { name: /示例控制台 启动档案/ })
    .click();
  await page.getByRole("option", { name: /DC2 VKE/ }).click();
  await expect(startDialog).toContainText("npm run dev -- --mode env_demo_pre");
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
    "demo:env_demo_pre",
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
  await expect(page.getByLabel("示例控制台 运行配置来源")).toContainText(
    "环境 · 工作区运行环境",
  );
  await page.getByRole("button", { name: "示例控制台 启动预检：需留意" }).click();
  const darkPreflightDialog = page.getByRole("dialog", {
    name: "示例控制台 启动预检详情",
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
    .getByRole("button", { name: "示例控制台 启动预检：不可启动" })
    .click();
  const preflightDialog = page.getByRole("dialog", {
    name: "示例控制台 启动预检详情",
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
    .getByRole("button", { name: "示例控制台 启动预检：不可启动" })
    .click();
  await page
    .getByRole("dialog", { name: "示例控制台 启动预检详情" })
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

  await page.getByRole("button", { name: "示例控制台 启动预检：需留意" }).click();
  const preflightDialog = page.getByRole("dialog", {
    name: "示例控制台 启动预检详情",
  });
  await expect(preflightDialog).toContainText("使用项目默认启动配置");
  await preflightDialog.getByRole("button", { name: "生成启动档案" }).click();

  const createDialog = page.getByRole("dialog", { name: /快速修复/ });
  await expect(createDialog).toContainText("npm run dev");
  await expect(createDialog).toContainText("/mock/projects/demo");
  await expect(createDialog).toContainText("npm · Node 20 · 端口 5173");
  await expect(createDialog.getByLabel("启动档案名称")).toHaveValue(
    "示例控制台 本地启动",
  );
  await createDialog.getByLabel("启动档案名称").fill("示例控制台 本地档案");
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
    .getByRole("button", { name: "示例控制台 启动预检：不可启动" })
    .click();
  const stalePreflightDialog = page.getByRole("dialog", {
    name: "示例控制台 启动预检详情",
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
