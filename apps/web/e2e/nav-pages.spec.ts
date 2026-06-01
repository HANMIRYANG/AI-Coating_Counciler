import { test, expect } from "@playwright/test";

// Smoke layer for the previously-decorative nav targets that are now live
// routes: /history, /archive, /settings. List pages render without a DB
// (the session-summary fetch may be empty); /settings reads non-secret config.

const PAGES: Array<[string, string]> = [
  ["/history", "최근 검토 기록"],
  ["/archive", "업체 발송 답변 보관함"],
  ["/settings", "설정 / 정보"],
];

test.describe("nav pages smoke", () => {
  for (const [path, heading] of PAGES) {
    test(`${path} renders its heading`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }).first(),
      ).toBeVisible();
    });
  }

  test("/settings shows runtime config from /api/config", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("세션 저장소")).toBeVisible();
    await expect(page.getByText("기본 모델 체인")).toBeVisible();
  });

  test("sidebar nav reaches the document manager", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "내부 기술자료 관리" }).click();
    await expect(page).toHaveURL(/\/documents$/);
  });
});
