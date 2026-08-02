import { expect, test, type Locator } from "@playwright/test";

async function expectTextContentFits(locator: Locator) {
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    lineClamp: getComputedStyle(element).webkitLineClamp,
  }));
  expect(metrics.lineClamp).toBe("none");
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html");
});

test("project startup profiles separate base commands from shared runtime environments", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开构建配置测试" }).click();

  const dialog = page.getByRole("dialog", { name: "项目配置" });
  const tabs = dialog.getByRole("tab");
  await expect(tabs).toHaveText([
    "基础信息",
    "本地命令",
    "启动档案",
    "构建目标",
    "分支规则",
  ]);

  await dialog.getByRole("tab", { name: "启动档案" }).click();
  await expect(dialog.getByText("共享运行环境来源", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "项目启动档案" })).toBeVisible();
  await expect(dialog).toContainText("项目仍可使用基础命令启动");

  await dialog.getByRole("button", { name: "新增档案" }).click();
  await expect(dialog.getByRole("combobox", { name: "共享运行环境" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "启动命令覆盖" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "档案环境变量" })).toBeVisible();
});

test("settings controls update the smoke harness state", async ({ page }) => {
  await page.getByLabel("打开设置").click();

  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeVisible();
  const settingsNavigation = dialog.getByRole("tablist", { name: "设置分类" });
  const generalTab = settingsNavigation.getByRole("tab", { name: "通用" });
  const confirmationTab = settingsNavigation.getByRole("tab", { name: "操作确认" });
  const accessTab = settingsNavigation.getByRole("tab", { name: "快捷入口" });
  const artifactsTab = settingsNavigation.getByRole("tab", { name: "受管产物" });
  const diagnosticsTab = settingsNavigation.getByRole("tab", { name: "系统诊断" });
  await expect(settingsNavigation.getByRole("tab")).toHaveText([
    "通用",
    "操作确认",
    "快捷入口",
    "受管产物",
    "系统诊断",
  ]);
  await expect(generalTab).toHaveAttribute("aria-selected", "true");
  await expect(confirmationTab).toHaveAttribute("aria-selected", "false");
  await expect(dialog.getByText("展示菜单", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "默认菜单" })).toBeVisible();
  const configActivityVisibility = dialog.getByRole("radiogroup", {
    name: "配置变更活动显示",
  });
  await expect(
    configActivityVisibility.getByRole("radio", { name: "仅待处理" }),
  ).toHaveAttribute("aria-checked", "true");
  const exitRuntimePolicy = dialog.getByRole("combobox", { name: "退出时项目" });
  await expect(exitRuntimePolicy).toHaveText("每次询问");
  await exitRuntimePolicy.click();
  await page.getByRole("option", { name: "停止本次启动项目", exact: true }).click();
  await expect(exitRuntimePolicy).toHaveText("停止本次启动项目");
  await expect(dialog.getByRole("group", { name: "主题" })).toBeVisible();
  const darkMode = dialog.getByRole("button", { name: "暗色主题" });
  await darkMode.click();
  await expect(darkMode).toHaveAttribute("aria-pressed", "true");

  const resourcesMenu = dialog.getByRole("checkbox", {
    name: "资源入口",
    exact: true,
  });
  await resourcesMenu.uncheck();
  await expect(resourcesMenu).not.toBeChecked();

  await confirmationTab.click();
  await expect(confirmationTab).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("展示菜单", { exact: true })).toHaveCount(0);
  const confirmationMode = dialog.getByRole("radiogroup", { name: "操作确认策略" });
  await expect(confirmationMode.getByRole("radio", { name: "平衡" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(dialog.getByRole("checkbox", { name: "构建与构建重放确认" })).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "代理与联调启停确认" }),
  ).not.toBeChecked();
  await expect(
    dialog.locator(".settings-confirmation-row").filter({ hasText: "分支合并与重放" }),
  ).toContainText("始终确认");
  await confirmationMode.getByRole("radio", { name: "严格" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "代理与联调启停确认" }),
  ).toBeChecked();
  await confirmationMode.getByRole("radio", { name: "快捷" }).click();
  const buildConfirmation = dialog.getByRole("checkbox", {
    name: "构建与构建重放确认",
  });
  await expect(buildConfirmation).not.toBeChecked();
  await buildConfirmation.check();
  await expect(confirmationMode.getByText("自定义", { exact: true })).toBeVisible();

  await accessTab.click();
  await expect(accessTab).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("命令面板", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /配置文件夹/ })).toBeVisible();

  await artifactsTab.click();
  await expect(artifactsTab).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("Proxy 状态", { exact: true })).toBeVisible();
  await expect(dialog.getByText("归属已验证", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/仅提供盘点视图/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /删除|清理/ })).toHaveCount(0);
  const artifactSurface = dialog.locator(".settings-artifacts-section");
  const artifactStyle = await artifactSurface.evaluate((element) => {
    const heading = element.querySelector("#settings-artifacts-title");
    const input = element.querySelector(".settings-artifacts-search .MuiOutlinedInput-root");
    return {
      borderRadius: getComputedStyle(element).borderRadius,
      headingFontSize: heading ? getComputedStyle(heading).fontSize : "",
      inputHeight: input?.getBoundingClientRect().height ?? 0,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
    };
  });
  expect(artifactStyle.borderRadius).toBe("8px");
  expect(artifactStyle.headingFontSize).toBe("14px");
  expect(artifactStyle.inputHeight).toBeGreaterThanOrEqual(38);
  expect(artifactStyle.horizontalOverflow).toBeLessThanOrEqual(1);

  await diagnosticsTab.click();
  await expect(diagnosticsTab).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.locator('[data-system-diagnostics="read-only"]'),
  ).toBeVisible();

  await dialog.getByLabel("关闭设置").click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "主菜单" }).getByRole("button", {
      name: "资源管理",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("settings language choice updates immediately and persists", async ({
  page,
}) => {
  await page.getByLabel("打开设置").click();

  let dialog = page.getByRole("dialog", { name: "设置", exact: true });
  let languageChoice = dialog.getByRole("group", { name: "界面语言" });
  await expect(
    languageChoice.getByRole("button", { name: "跟随系统" }),
  ).toHaveAttribute("aria-pressed", "true");

  await languageChoice.getByRole("button", { name: "英文" }).click();

  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  languageChoice = dialog.getByRole("group", { name: "Interface Language" });
  await expect(
    dialog.getByText("Choose the language used by the app interface."),
  ).toBeVisible();
  await expect(
    languageChoice.getByRole("button", { name: "English" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("rdevtool.language")),
    )
    .toBe("en-US");

  await page.reload();
  await page.getByLabel("Open Settings").click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  languageChoice = dialog.getByRole("group", { name: "Interface Language" });
  await expect(
    languageChoice.getByRole("button", { name: "English" }),
  ).toHaveAttribute("aria-pressed", "true");

  await languageChoice.getByRole("button", { name: "Follow System" }).click();
  dialog = page.getByRole("dialog", { name: "设置", exact: true });
  languageChoice = dialog.getByRole("group", { name: "界面语言" });
  await expect(
    languageChoice.getByRole("button", { name: "跟随系统" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("build target artifact directory is editable and persisted", async ({ page }) => {
  await page.getByRole("button", { name: "打开构建配置测试" }).click();

  let dialog = page.getByRole("dialog", { name: "项目配置" });
  await expect(dialog).toBeVisible();
  const outputDir = dialog.getByRole("textbox", { name: "产物目录" });
  await expect(outputDir).toHaveValue("/mock/demo/jenkins-output");
  await expect(dialog.getByText("仅用于产物定位，不会作为 Jenkins 参数发送。"))
    .toBeVisible();

  await outputDir.fill("/mock/demo/jenkins-output-next");
  await dialog.getByRole("button", { name: "保存构建" }).click();
  await expect(dialog.getByText("已保存构建配置")).toBeVisible();
  await dialog.getByLabel("关闭设置").click();

  await page.getByRole("button", { name: "打开构建配置测试" }).click();
  dialog = page.getByRole("dialog", { name: "项目配置" });
  await expect(dialog.getByRole("textbox", { name: "产物目录" })).toHaveValue(
    "/mock/demo/jenkins-output-next",
  );
});

test("confirmation preferences skip configurable prompts but keep critical prompts", async ({
  page,
}) => {
  const confirmationHarness = page.getByRole("region", { name: "确认策略测试" });

  await confirmationHarness.getByRole("button", { name: "测试构建确认" }).click();
  let dialog = page.getByRole("dialog", { name: "确认运行" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "以后不再确认此类操作" }).check();
  await dialog.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.getByTestId("build-confirmation-runs")).toHaveText("1");

  await confirmationHarness.getByRole("button", { name: "测试构建确认" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("build-confirmation-runs")).toHaveText("2");

  await confirmationHarness.getByRole("button", { name: "测试分支确认" }).click();
  dialog = page.getByRole("dialog", { name: "确认运行" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "以后不再确认此类操作" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByTestId("branch-confirmation-runs")).toHaveText("0");
});

test("config source manager compares and copies a source", async ({ page }) => {
  await page.getByRole("button", { name: "打开配置源管理" }).click();

  const dialog = page.getByRole("dialog", { name: /配置源管理/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("默认配置", { exact: true }).last()).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /已上线需求工作区 配置/ }),
  ).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: "显示归档来源 1" })
    .check();
  await expect(
    dialog.getByRole("button", { name: /已上线需求工作区 配置/ }),
  ).toBeVisible();

  await dialog.getByLabel("对比配置源").click();
  await page.getByRole("option", { name: "团队配置", exact: true }).click();
  await dialog.getByRole("button", { name: "比较", exact: true }).click();

  await expect(dialog.getByText("对比 团队配置", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 项不同", { exact: true })).toBeVisible();
  await expect(dialog.getByText("3 项一致", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "复制", exact: true }).click();
  await dialog.getByLabel("副本 ID").fill("default-smoke-copy");
  await dialog.getByLabel("副本名称").fill("默认配置烟雾副本");
  await dialog.getByRole("button", { name: "创建副本", exact: true }).click();

  const copiedSource = dialog.getByRole("button", { name: /默认配置烟雾副本/ });
  await expect(copiedSource).toBeVisible();
  await expect(copiedSource).toHaveClass(/is-active/);
  await expect(
    dialog.locator(".config-source-manager-detail").getByText("默认配置烟雾副本", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".MuiSnackbar-root").getByText(
      "已创建“默认配置烟雾副本”，复制 4 个文件",
      { exact: true },
    ),
  ).toBeVisible();
});

test("config change action opens the comparison result directly", async ({ page }) => {
  await page.getByRole("button", { name: "比较配置变更" }).click();

  const dialog = page.getByRole("dialog", { name: /配置源管理/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("对比 团队配置", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 项不同", { exact: true })).toBeVisible();
  await expect(dialog.getByText("3 项一致", { exact: true })).toBeVisible();
});

test("handled config activities stay hidden until all records are enabled", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await expect(activityCenter).toBeVisible();
  const configQueueCard = activityCenter
    .locator(".activity-queue-card")
    .filter({ hasText: "配置更新" });
  await expect(configQueueCard).toHaveCount(1);
  await expect(configQueueCard).toContainText("需重新加载 3");
  await activityCenter
    .getByRole("button", { name: "全部重新加载 3", exact: true })
    .click();

  await expect(page.getByTestId("config-activity-state")).toHaveText("success");
  await expect(activityCenter.getByRole("button", { name: "重新加载" })).toHaveCount(0);
  await expect(activityCenter.getByText("已重新加载并应用最新配置")).toHaveCount(0);

  await activityCenter.getByLabel("收起活动中心").click();
  await page.getByLabel("打开设置").click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  const configActivityVisibility = settings.getByRole("radiogroup", {
    name: "配置变更活动显示",
  });
  await configActivityVisibility.getByRole("radio", { name: "全部记录" }).click();
  await expect(
    configActivityVisibility.getByRole("radio", { name: "全部记录" }),
  ).toHaveAttribute("aria-checked", "true");
  await settings.getByLabel("关闭设置").click();

  await page.getByLabel("打开活动中心").click();
  const handledConfigRecords = page
    .getByRole("complementary", { name: "活动中心" })
    .getByText("已重新加载并应用最新配置");
  await expect(handledConfigRecords).toHaveCount(3);
  await expect(handledConfigRecords.first()).toBeVisible();
});

test("config reload notices can be ignored as one grouped reminder", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  const configQueueCard = activityCenter
    .locator(".activity-queue-card")
    .filter({ hasText: "配置更新" });
  await configQueueCard.getByRole("button", { name: "忽略", exact: true }).click();

  await expect(page.getByTestId("config-activity-state")).toHaveText("info");
  await expect(configQueueCard).toHaveCount(0);
  await expect(
    activityCenter.getByRole("button", { name: "全部重新加载 3", exact: true }),
  ).toHaveCount(0);
});

test("activity cards show complete grouped and standalone details", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  const activityList = activityCenter.locator(".activity-list-scroll");
  const pendingQueue = activityCenter.locator(".activity-queue-section");
  await expect(pendingQueue).not.toContainText("触发部署（进行中测试）");
  const runningDeployCard = activityList
    .locator(".activity-record-card")
    .filter({ hasText: "触发部署（进行中测试）" });
  await expect(runningDeployCard).toBeVisible();
  await expect(runningDeployCard.getByRole("button", { name: "标记已处理" }))
    .toHaveCount(0);
  await expect(activityCenter.getByRole("button", { name: "结束关注" })).toHaveCount(0);

  await activityCenter.getByRole("tab", { name: /^CLI / }).click();
  const deployCard = activityList
    .locator(".activity-record-card")
    .filter({ hasText: "构建 #4118" });
  const deployParameters = deployCard.locator(".activity-parameter-summary");
  await expect(deployParameters).toContainText("目标vke");
  await expect(deployParameters).toContainText("环境dc2");
  await expect(deployParameters).toContainText("分支env-dc2-vke");
  await expect(deployParameters).toContainText("灰度false");
  await expect(deployParameters).toContainText("令牌已配置");
  await expect(deployParameters).not.toContainText("secret");
  await expectTextContentFits(deployParameters);
  const deployLayout = await deployCard.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    cardBottom: element.getBoundingClientRect().bottom,
    parameterBottom:
      element.querySelector(".activity-parameter-summary")?.getBoundingClientRect().bottom ?? 0,
  }));
  expect(deployLayout.scrollWidth).toBeLessThanOrEqual(deployLayout.clientWidth + 1);
  expect(deployLayout.parameterBottom).toBeLessThanOrEqual(deployLayout.cardBottom + 1);

  await activityCenter.getByRole("tab", { name: /^失败 / }).click();
  const mergeCard = activityCenter
    .locator(".activity-record-card")
    .filter({ hasText: "合并分支" })
    .first();
  if (await mergeCard.count() === 0) {
    const nextActivityPage = activityCenter
      .locator(".MuiPaginationItem-page")
      .filter({ hasText: /^2$/ });
    if (await nextActivityPage.count()) {
      await nextActivityPage.click();
    }
  }
  const groupedFailureReason = mergeCard.locator(".activity-collapsed-reason");
  await expect(groupedFailureReason).toContainText(
    "GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
  );
  await expectTextContentFits(groupedFailureReason);

  await mergeCard.getByRole("button", { name: "展开执行详情" }).click();
  const timelineDetails = mergeCard.locator(".activity-timeline-detail");
  await expect(timelineDetails).toHaveCount(2);
  for (let index = 0; index < await timelineDetails.count(); index += 1) {
    await expectTextContentFits(timelineDetails.nth(index));
  }

  await activityCenter.getByRole("tab", { name: /^App / }).click();
  const standaloneCard = activityCenter
    .locator(".activity-record-card")
    .filter({ hasText: "dev 服务启动失败" });
  await standaloneCard.scrollIntoViewIfNeeded();
  await expectTextContentFits(standaloneCard.locator(".activity-item-summary"));
  const standaloneDetail = standaloneCard.locator(".activity-item-detail");
  await expect(standaloneDetail).toContainText("完整详情结束");
  await expectTextContentFits(standaloneDetail);
});

test("activity source tabs isolate App, CLI and tray records", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  const activityList = activityCenter.locator(".activity-list-scroll");

  await activityCenter.getByRole("tab", { name: /^CLI / }).click();
  await expect(activityList).toContainText("构建 #4118");
  await expect(activityList).not.toContainText("dev 服务启动失败");
  await expect(activityList.locator(".activity-status-pills").first()).toContainText("CLI");

  await activityCenter.getByRole("tab", { name: /^托盘 / }).click();
  await expect(activityList).toContainText("触发部署（进行中测试）");
  await expect(activityList).not.toContainText("构建 #4118");
  await expect(activityList.locator(".activity-status-pills").first()).toContainText("托盘");

  await activityCenter.getByRole("tab", { name: /^App / }).click();
  await expect(activityCenter).toContainText("dev 服务启动失败");
  await expect(activityCenter).not.toContainText("触发部署（进行中测试）");
});

test("activity bulk confirmations use the shared compact action dialog", async ({
  page,
}) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await activityCenter.getByRole("tab", { name: /^待办 / }).click();
  await activityCenter.getByRole("button", { name: "忽略全部" }).click();

  const dialog = page.getByRole("dialog", {
    name: "忽略全部待处理项？",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/app-action-dialog-paper/);
  await expect(dialog.locator(".app-action-dialog-title-icon")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭弹窗" })).toBeVisible();
  await expect(dialog).toContainText("记录仍可在“全部”中查看");

  const width = await dialog.evaluate((element) =>
    Math.round(element.getBoundingClientRect().width),
  );
  expect(width).toBeLessThanOrEqual(500);

  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("failed Link activity exposes diagnostics and checks before retrying", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  const activityList = activityCenter.locator(".activity-list-scroll");
  await activityCenter.getByRole("tab", { name: /^待办 / }).click();
  const linkCard = activityCenter
    .locator(".activity-record-card")
    .filter({ hasText: "合作渠道联调" })
    .first();

  await expect(linkCard).toBeVisible();
  await linkCard.getByRole("button", { name: "查看诊断详情" }).click();

  const detailDialog = page.getByRole("dialog").filter({ hasText: "启动代理" });
  await expect(detailDialog).toContainText("端口已被占用");
  await expect(detailDialog).toContainText("127.0.0.1:8791 已被外部进程占用");
  await expect(detailDialog).toContainText("请先确认本地代理端口的归属");
  await detailDialog
    .getByRole("button", { name: "关闭", exact: true })
    .click();

  await linkCard.getByRole("button", { name: "检查并重新启动" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "确认检查并重试？" });
  await expect(confirmDialog).toContainText("只有检查通过后");
  await confirmDialog.getByRole("button", { name: "检查并重试" }).click();

  await activityCenter.getByRole("tab", { name: /^全部 / }).click();
  const recoveredCard = activityList
    .locator(".activity-record-card")
    .filter({ hasText: "合作渠道联调" })
    .first();
  await expect(recoveredCard).toContainText("重试成功");
  await expect(recoveredCard.getByRole("button", { name: "检查并重新启动" })).toHaveCount(0);
});

test("failed build activity replans before replay and keeps a new running record", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await activityCenter.getByRole("tab", { name: /^App / }).click();
  const failedCard = activityCenter
    .locator(".activity-record-card")
    .filter({ hasText: "目标分支 feature/missing 不存在" });
  await expect(failedCard).toBeVisible();
  await failedCard.getByRole("button", { name: "重新规划并重试部署" }).click();

  const dialog = page.getByRole("dialog", { name: "确认重新规划并重试构建？" });
  await expect(dialog).toContainText("将先切换到原工作区");
  await expect(dialog).toContainText("只有工作区、项目、分支、环境和参数检查通过后");
  await dialog.getByRole("button", { name: "检查并重试" }).click();

  await expect(activityCenter).toContainText("构建已重新触发");
  await expect(activityCenter).toContainText("重新规划通过，已触发新构建");
  await expect(failedCard.getByRole("button", { name: "重新规划并重试部署" }))
    .toHaveCount(0);
});

test("Git, Runtime and proxy recovery explain their safety checks", async ({ page }) => {
  await page.getByLabel("打开活动中心").click();

  const activityCenter = page.getByRole("complementary", { name: "活动中心" });
  await activityCenter.getByRole("tab", { name: /^待办 / }).click();

  await activityCenter.getByRole("tab", { name: /^CLI / }).click();
  await activityCenter
    .getByRole("button", { name: "检查并重试 Git 操作" })
    .first()
    .click();
  const gitDialog = page.getByRole("dialog", { name: "确认重试 Git 操作？" });
  await expect(gitDialog).toContainText("项目、工作区和分支校验");
  await gitDialog.getByRole("button", { name: "取消" }).click();

  await activityCenter.getByRole("tab", { name: /^App / }).click();
  await activityCenter
    .getByRole("button", { name: "检查并重新启动" })
    .first()
    .click();
  const runtimeDialog = page.getByRole("dialog", { name: "确认检查并重新启动？" });
  await expect(runtimeDialog).toContainText("启动档案和本次覆盖");
  await expect(runtimeDialog).toContainText("启动前检查");
  await runtimeDialog.getByRole("button", { name: "取消" }).click();

  await activityCenter.getByRole("tab", { name: /^托盘 / }).click();
  const proxyCard = activityCenter
    .locator(".activity-record-card")
    .filter({ hasText: "本地联调代理" })
    .first();
  await proxyCard.getByRole("button", { name: "检查并重新启动" }).click();
  const proxyDialog = page.getByRole("dialog", { name: "确认检查并重新启动？" });
  await expect(proxyDialog).toContainText("配置、端口和监听归属");
  await proxyDialog.getByRole("button", { name: "取消" }).click();
});

test("missing Git worktree can be repaired without changing its selected path", async ({ page }) => {
  const recovery = page.getByRole("region", { name: "工作副本恢复测试" });
  const selector = recovery.getByRole("combobox", { name: "项目实例" });
  await expect(selector).toContainText("目录缺失");
  await expect(
    recovery.getByText("目录已被删除，但 Git 仍保留工作副本登记；可直接修复并重建。"),
  ).toBeVisible();

  await recovery.getByRole("button", { name: "修复副本" }).click();

  await expect(recovery.getByText("工作副本已恢复，可以继续切换分支。"))
    .toBeVisible();
  await expect(selector).toContainText("干净");
  await expect(recovery.getByRole("button", { name: "修复副本" })).toHaveCount(0);
  await expect(selector).toContainText("pre");
});
