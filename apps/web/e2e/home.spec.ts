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

  test("evidence mode group is selectable, incl. external official-source lookup", async ({
    page,
  }) => {
    const group = page.getByRole("group", { name: "근거 모드 선택" });
    await expect(group).toBeVisible();

    const internalBtn = group.getByRole("button", { name: /사내 자료 사용/ });
    await internalBtn.click();
    await expect(internalBtn).toHaveAttribute("aria-pressed", "true");

    // internal_docs_web (user-provided official-source URL fetch) is now wired
    // and selectable; choosing it reveals the URL input. (Catalog-based
    // AUTOMATIC official-source lookup is still not implemented.)
    const externalBtn = group.getByRole("button", {
      name: /사내 자료 \+ 공식 출처/,
    });
    await expect(externalBtn).toBeEnabled();
    await externalBtn.click();
    await expect(externalBtn).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", { name: /공식 출처 URL/ }),
    ).toBeVisible();
  });

  test("'AI 가이드' chip toggles the usage guide", async ({ page }) => {
    await expect(page.getByText("사용 가이드")).toHaveCount(0);
    await page.getByRole("button", { name: "AI 가이드" }).click();
    await expect(page.getByText("사용 가이드")).toBeVisible();
  });

  test("'내부 자료 참조' chip switches evidence mode to internal_docs", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "내부 자료 참조" }).click();
    const group = page.getByRole("group", { name: "근거 모드 선택" });
    await expect(
      group.getByRole("button", { name: /사내 자료 사용/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
