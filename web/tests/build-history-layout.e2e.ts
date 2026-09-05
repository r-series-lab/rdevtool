import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html?style=mono");
  await page.getByRole("button", { name: "打开 Build Record 测试" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("rdevtool:language-preference-changed", {
        detail: "en-US",
      }),
    ),
  );
});

test("build records prioritize parameter overrides and expand all parameters", async ({
  page,
}) => {
  const record = page.getByLabel("Build Record 测试");
  const firstCard = record.locator(".app-history-card").first();

  await expect(firstCard).toContainText("5 parameter overrides");
  await expect(firstCard.locator(".build-history-parameter-preview")).toHaveCount(3);
  await expect(firstCard).toContainText("2 more overrides");
  await expect(firstCard).not.toContainText("+2");
  await expect(firstCard).not.toContainText("CACHE_MODE");

  await firstCard.getByRole("button", { name: "Expand Details" }).click();
  await expect(firstCard).toContainText("All Execution Parameters");
  await expect(firstCard.locator(".build-history-parameter-row")).toHaveCount(6);
  await expect(firstCard).toContainText("CACHE_MODE");
  await expect(firstCard).toContainText("Default: incremental");
  await expect(firstCard).toContainText("JENKINS_TOKEN");
  await expect(firstCard).toContainText("Configured");
  await expect(firstCard).toContainText("Not Configured");
  await expect(
    firstCard.getByRole("button", { name: "Collapse Details" }),
  ).toBeVisible();
});

test("failed build records keep a clear reason before showing full diagnostics", async ({
  page,
}) => {
  const failedCard = page
    .getByLabel("Build Record 测试")
    .locator(".app-history-card")
    .nth(1);

  await expect(failedCard).toContainText(
    "Jenkins rejected the build request (HTTP 403)",
  );
  await failedCard.getByRole("button", { name: "Expand Details" }).click();
  await expect(failedCard).toContainText(
    "Check the Jenkins token permission, job membership, and CSRF crumb configuration before retrying.",
  );
});

test("secondary actions use a menu and pinned cards keep the normal surface", async ({
  page,
}) => {
  const record = page.getByLabel("Build Record 测试");
  const cards = record.locator(".app-history-card");
  const normalCard = cards.first();
  const pinnedCard = cards.nth(2);

  await normalCard.getByRole("button", { name: "More Actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Open Record" })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Configure Workflow" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(pinnedCard).toContainText("Pinned");
  await expect(pinnedCard).toContainText("3 consecutive runs");
  await expect(pinnedCard.locator(".build-history-run-row")).toHaveCount(3);
  await expect(pinnedCard).toContainText("Build failed");

  const [normalBackground, pinnedBackground] = await Promise.all([
    normalCard.evaluate((element) => getComputedStyle(element).backgroundColor),
    pinnedCard.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(pinnedBackground).toBe(normalBackground);
});

test("build record parameter rows remain within the narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  const record = page.getByLabel("Build Record 测试");
  const firstCard = record.locator(".app-history-card").first();
  await firstCard.getByRole("button", { name: "Expand Details" }).click();

  const overflow = await record.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
