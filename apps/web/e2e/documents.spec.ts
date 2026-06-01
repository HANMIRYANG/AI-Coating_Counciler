import { test, expect } from "@playwright/test";

// Smoke layer for the document management page. Renders the upload form +
// search controls regardless of DB availability (list/search fetches may 503
// without Postgres, but the page still mounts). Does NOT submit real intake.

test.describe("documents page smoke", () => {
  test("renders the upload form and search controls", async ({ page }) => {
    await page.goto("/documents");

    await expect(
      page.getByRole("heading", { name: "내부 기술자료 관리" }).first(),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "업로드" })).toBeVisible();
    await expect(page.getByRole("button", { name: "검색" })).toBeVisible();
  });

  test("is reachable from the sidebar nav", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "내부 기술자료 관리" }).click();
    await expect(page).toHaveURL(/\/documents$/);
  });
});
