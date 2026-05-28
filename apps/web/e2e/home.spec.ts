import { test, expect } from "@playwright/test";

// Smoke layer for the home workspace. Asserts the page boots and the
// composer + task-mode controls respond as expected. Does NOT submit a
// real session — we only verify the send button toggles on a valid prompt.

test.describe("home page smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("brand and hero title render", async ({ page }) => {
    await expect(page.getByText("HANMIR COATINGS")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "특수도료 AI 검토 시스템" }),
    ).toBeVisible();
  });

  test("composer enables only after a valid prompt is entered", async ({
    page,
  }) => {
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();

    const sendBtn = page.locator(".composer-send");
    await expect(sendBtn).toBeDisabled();

    await textarea.fill("HE-850A 코팅제 적용 검토 요청");
    await expect(sendBtn).toBeEnabled();
  });

  test("task mode group is visible and selectable", async ({ page }) => {
    const group = page.getByRole("group", { name: "검토 모드 선택" });
    await expect(group).toBeVisible();

    const ideationBtn = group.getByRole("button", { name: "아이디어" });
    await ideationBtn.click();
    await expect(ideationBtn).toHaveAttribute("aria-pressed", "true");
  });
});
