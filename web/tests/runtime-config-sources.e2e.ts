import { expect, test } from "@playwright/test";

test("runtime panel traces workspace sources and saves one-off overrides", async ({
  page,
}, testInfo) => {
  await page.goto("/smoke.html?style=mono");
  await page.getByRole("button", { name: "打开运行配置来源测试" }).click();

  await page.getByLabel("示例控制台 更多操作").click();
  await page.getByRole("menuitem", { name: "运行面板" }).click();

  const runtimePanel = page
    .getByRole("dialog")
    .filter({ hasText: "示例控制台" });
  await expect(runtimePanel).toBeVisible();
  await expect(
    runtimePanel.locator(".runtime-preflight-check-icon"),
  ).toHaveCount(2);
  const darkSurface = await runtimePanel.evaluate((element) => {
    const paper = getComputedStyle(element);
    const tabs = getComputedStyle(
      element.querySelector<HTMLElement>(".runtime-panel-tabs")!,
    );
    return {
      paperRadius: paper.borderRadius,
      paperBackgroundImage: paper.backgroundImage,
      paperBackdropFilter: paper.backdropFilter,
      tabsRadius: tabs.borderRadius,
      tabsShadow: tabs.boxShadow,
    };
  });
  expect(darkSurface.paperRadius).toBe("8px");
  expect(darkSurface.paperBackgroundImage).toBe("none");
  expect(darkSurface.paperBackdropFilter).toBe("none");
  expect(darkSurface.tabsRadius).toBe("0px");
  expect(darkSurface.tabsShadow).toBe("none");
  await expect(runtimePanel.getByText("运行上下文", { exact: true })).toBeVisible();
  await expect(runtimePanel.getByText("0 会话", { exact: true })).toBeVisible();
  await expect(
    runtimePanel.getByText("可先启动该代理，再重新执行启动预检。"),
  ).toHaveCount(0);
  await expect(
    runtimePanel.getByText("当前候选目录未观测到 daemon 会话。"),
  ).toHaveCount(0);
  await expect(runtimePanel.getByText("证据与建议动作")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("runtime-overview-concise.png"),
    fullPage: true,
  });
  await runtimePanel.getByRole("tab", { name: "运行配置" }).click();

  await expect(runtimePanel.getByText("解析链", { exact: true })).toBeVisible();
  await expect(
    runtimePanel.getByText(
      "工作区 · 示例需求工作区",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(runtimePanel.getByText("工作区实例 + 启动档案")).toBeVisible();
  await expect(runtimePanel.getByText("工作区运行环境").first()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-config-sources-panel.png"),
    fullPage: true,
  });

  const configLayout = await runtimePanel
    .locator(".runtime-panel-config-page")
    .evaluate((element) => {
      const launch = element.querySelector<HTMLElement>(
        ".runtime-config-launch-card",
      );
      const environment = element.querySelector<HTMLElement>(
        ".runtime-config-environment-card",
      );
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        launchWidth: launch?.clientWidth ?? 0,
        environmentWidth: environment?.clientWidth ?? 0,
      };
    });
  expect(configLayout.scrollWidth - configLayout.clientWidth).toBeLessThanOrEqual(1);
  expect(configLayout.launchWidth).toBeGreaterThan(configLayout.clientWidth - 4);
  expect(configLayout.environmentWidth).toBeGreaterThan(
    configLayout.clientWidth - 4,
  );

  await runtimePanel.getByRole("tab", { name: "网页动作" }).click();
  const webActionsBody = runtimePanel.locator(".runtime-panel-body--webActions");
  await expect(webActionsBody.locator(".web-actions-panel")).toBeVisible();
  const targetFilter = webActionsBody.getByRole("textbox", {
    name: "筛选受控页面",
  });
  const selectedTarget = webActionsBody.getByRole("option", {
    name: /示例控制台.*127\.0\.0\.1:5173/,
  });
  await expect(targetFilter).toBeVisible();
  await expect(selectedTarget).toBeVisible();
  await expect(selectedTarget).toHaveAttribute("aria-selected", "true");
  await targetFilter.fill("not-found");
  await expect(webActionsBody.getByText("没有匹配的页面")).toBeVisible();
  await targetFilter.fill("");
  await expect(selectedTarget).toBeVisible();
  await expect(
    webActionsBody.getByRole("combobox", { name: "网页动作" }),
  ).toContainText("读取页面信息");
  await expect(webActionsBody.locator(".web-actions-script-field")).toBeVisible();
  const scriptTextarea = webActionsBody
    .locator(".web-actions-script-field textarea:not([aria-hidden='true'])")
    .first();
  await expect(scriptTextarea).toHaveValue(/readyState/);
  const scriptTextareaMetrics = await scriptTextarea.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scriptTextareaMetrics.clientHeight).toBeGreaterThanOrEqual(
    scriptTextareaMetrics.scrollHeight - 1,
  );
  const webActionsLayout = await webActionsBody.evaluate((element) => {
    const editor = element.querySelector<HTMLElement>(
      ".web-actions-editor-panel",
    );
    const scriptField = element.querySelector<HTMLElement>(
      ".web-actions-script-field",
    );
    const actions = element.querySelector<HTMLElement>(
      ".web-actions-panel-actions",
    );
    const bodyRect = element.getBoundingClientRect();
    const editorRect = editor?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      bodyBottom: bodyRect.bottom,
      editorBottom: editorRect?.bottom ?? 0,
      scriptHeight: scriptField?.clientHeight ?? 0,
      actionsTop: actionsRect?.top ?? 0,
      actionsBottom: actionsRect?.bottom ?? 0,
    };
  });
  expect(webActionsLayout.scrollWidth - webActionsLayout.clientWidth).toBeLessThanOrEqual(1);
  expect(webActionsLayout.editorBottom).toBeLessThanOrEqual(
    webActionsLayout.actionsTop + 1,
  );
  expect(webActionsLayout.scriptHeight).toBeGreaterThan(140);
  expect(webActionsLayout.actionsBottom).toBeLessThanOrEqual(
    webActionsLayout.bodyBottom + 1,
  );
  await page.screenshot({
    path: testInfo.outputPath("runtime-web-actions-layout.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 820, height: 640 });
  const compactWebActionsLayout = await webActionsBody.evaluate((element) => {
    const actions = element.querySelector<HTMLElement>(
      ".web-actions-panel-actions",
    );
    const bodyRect = element.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      actionsTop: actionsRect?.top ?? 0,
      actionsBottom: actionsRect?.bottom ?? 0,
    };
  });
  expect(
    compactWebActionsLayout.scrollWidth - compactWebActionsLayout.clientWidth,
  ).toBeLessThanOrEqual(1);
  expect(compactWebActionsLayout.actionsTop).toBeGreaterThanOrEqual(
    compactWebActionsLayout.bodyTop,
  );
  expect(compactWebActionsLayout.actionsBottom).toBeLessThanOrEqual(
    compactWebActionsLayout.bodyBottom + 1,
  );
  await page.screenshot({
    path: testInfo.outputPath("runtime-web-actions-layout-compact.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await runtimePanel.getByRole("tab", { name: "运行配置" }).click();

  await runtimePanel.getByRole("button", { name: "添加" }).click();
  await runtimePanel
    .getByRole("textbox", { name: "本次启动环境变量覆盖" })
    .fill("FEATURE_FLAG=true");
  await expect(
    runtimePanel.getByText("本次覆盖 · 1", { exact: true }),
  ).toBeVisible();

  await runtimePanel
    .getByRole("button", { name: "保存为启动档案" })
    .click();
  const saveDialog = page.getByRole("dialog", { name: "保存为启动档案" });
  await expect(saveDialog).toBeVisible();
  await expect(saveDialog.getByText("项目级", { exact: true })).toBeVisible();
  await expect(saveDialog.getByText("所有工作区可用", { exact: true })).toBeVisible();
  await expect(saveDialog.getByRole("combobox", { name: "保存方式" })).toHaveText(
    "另存为新档案",
  );

  const panelOverflow = await runtimePanel.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  const dialogOverflow = await saveDialog.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(panelOverflow).toBeLessThanOrEqual(1);
  expect(dialogOverflow).toBeLessThanOrEqual(1);

  await page.screenshot({
    path: testInfo.outputPath("runtime-config-sources.png"),
    fullPage: true,
  });
});

test("runtime panel follows the light application settings surface", async ({
  page,
}, testInfo) => {
  await page.goto("/smoke.html");
  await page.getByRole("button", { name: "打开运行配置来源测试" }).click();
  await page.getByLabel("示例控制台 更多操作").click();
  await page.getByRole("menuitem", { name: "运行面板" }).click();

  const runtimePanel = page
    .getByRole("dialog")
    .filter({ hasText: "示例控制台" });
  await expect(runtimePanel).toBeVisible();
  await expect(
    runtimePanel.locator(".runtime-preflight-check-icon"),
  ).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("runtime-overview-light.png"),
    fullPage: true,
  });
  await runtimePanel.getByRole("tab", { name: "运行配置" }).click();

  const lightSurface = await runtimePanel.evaluate((element) => {
    const paper = getComputedStyle(element);
    const header = getComputedStyle(
      element.querySelector<HTMLElement>(".runtime-panel-header")!,
    );
    const field = getComputedStyle(
      element.querySelector<HTMLElement>(".MuiOutlinedInput-root")!,
    );
    return {
      paperRadius: paper.borderRadius,
      paperBackgroundImage: paper.backgroundImage,
      paperBackdropFilter: paper.backdropFilter,
      headerShadow: header.boxShadow,
      fieldRadius: field.borderRadius,
    };
  });
  expect(lightSurface.paperRadius).toBe("8px");
  expect(lightSurface.paperBackgroundImage).toBe("none");
  expect(lightSurface.paperBackdropFilter).toBe("none");
  expect(lightSurface.headerShadow).toBe("none");
  expect(lightSurface.fieldRadius).toBe("7px");

  await page.screenshot({
    path: testInfo.outputPath("runtime-config-settings-light.png"),
    fullPage: true,
  });
});
