import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/smoke.html?style=mono");
  await page.getByRole("button", { name: "打开分支 Record 测试" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("rdevtool:language-preference-changed", {
        detail: "en-US",
      }),
    ),
  );
});

test("branch records render projects as rows and expand long details", async ({ page }) => {
  const record = page.getByLabel("分支 Record 测试");
  const cards = record.locator(".app-history-card");
  const firstCard = cards.first();

  await expect(firstCard.locator(".branch-history-project-row")).toHaveCount(3);
  await expect(firstCard).toContainText("示例门户");
  await expect(firstCard).toContainText("示例移动端");
  await expect(firstCard).toContainText("示例控制台");
  await expect(firstCard).toContainText("feature_demo_mob...e_candidate");
  await expect(firstCard).toContainText("1 more projects");
  await expect(firstCard).not.toContainText("示例服务");

  const list = record.locator(".module-list-scroll");
  const thirdCard = cards.nth(2);
  const [listBox, thirdCardBox] = await Promise.all([
    list.boundingBox(),
    thirdCard.boundingBox(),
  ]);
  expect(listBox).not.toBeNull();
  expect(thirdCardBox).not.toBeNull();
  expect(thirdCardBox!.y + thirdCardBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );

  await firstCard.getByRole("button", { name: "Expand Details" }).click();
  await expect(firstCard.locator(".branch-history-project-row")).toHaveCount(4);
  await expect(firstCard).toContainText(
    "feature_demo_mobile_release_candidate",
  );
  await expect(firstCard).toContainText("示例服务");
  await expect(firstCard.getByRole("button", { name: "Collapse Details" })).toBeVisible();
});

test("failed records keep a concise reason before expansion", async ({ page }) => {
  const failedCard = page
    .getByLabel("分支 Record 测试")
    .locator(".app-history-card")
    .nth(1);

  await expect(failedCard).toContainText("GitLab rejected this operation (HTTP 403)");
  await failedCard.getByRole("button", { name: "Expand Details" }).click();
  await expect(failedCard).toContainText(
    "Check the token API scope, project role, and target branch protection rules, then retry.",
  );
});
