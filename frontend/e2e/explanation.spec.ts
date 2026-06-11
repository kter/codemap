import { expect, test, type Page } from "@playwright/test";
import { analyzeFromHome, mockAuthenticatedPage } from "./fixtures";

async function selectButtonFile(page: Page) {
  await page.getByRole("button", { name: "src/" }).click();
  await page.getByRole("button", { name: "Button.tsx" }).click();
  await expect(page.getByText("Current file")).toBeVisible();
}

test("shows the AI explanation for the selected file", async ({ page }) => {
  await mockAuthenticatedPage(page);

  await analyzeFromHome(page);
  await selectButtonFile(page);

  await expect(page.getByText("Overview of src/Button.tsx.")).toBeVisible();
  await expect(page.getByRole("button", { name: /ButtonProps/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /renderButton/ }),
  ).toBeVisible();
  await expect(page.getByText("Props for Button")).toBeVisible();

  // analyze (123/45) + file explanation (7/5) token usage accumulate.
  await expect(page.getByText("↑130 ↓50")).toBeVisible();
});

test("re-fetches the explanation when the language changes", async ({
  page,
}) => {
  await mockAuthenticatedPage(page);

  await analyzeFromHome(page);
  await selectButtonFile(page);
  await expect(page.getByText("Overview of src/Button.tsx.")).toBeVisible();

  await page.getByLabel("AI explanation language").selectOption("ja");

  await expect(page.getByText("src/Button.tsx の概要です。")).toBeVisible();
  await expect(page.getByText("ボタンのプロパティ")).toBeVisible();
});

test("shows an error message when the explanation request fails", async ({
  page,
}) => {
  await mockAuthenticatedPage(page);
  await page.route("**/file/explanation*", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "AI quota exceeded" }),
    });
  });

  await analyzeFromHome(page);
  await selectButtonFile(page);

  await expect(page.getByText("AI quota exceeded")).toBeVisible();
});
