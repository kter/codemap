import { expect, test } from "@playwright/test";
import { analyzeFromHome, mockAuthenticatedPage } from "./fixtures";

test("logout returns to the login screen", async ({ page }) => {
  await mockAuthenticatedPage(page);

  await analyzeFromHome(page);
  await page.getByRole("button", { name: "Logout" }).click();

  await expect(
    page.getByRole("link", { name: /login with github/i }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("shows the backend error message when analyze fails", async ({ page }) => {
  await mockAuthenticatedPage(page);
  await page.route("**/analyze", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "GitHub API error: 404" }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("@testuser")).toBeVisible();
  await page
    .getByPlaceholder("owner/repo (e.g. facebook/react)")
    .fill("facebook/react");
  await page.getByRole("button", { name: "Analyze" }).click();

  await expect(page.getByText("GitHub API error: 404")).toBeVisible();
});

test("expired session during analyze falls back to login with a notice", async ({
  page,
}) => {
  await mockAuthenticatedPage(page);
  await page.route("**/analyze", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "session expired" }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("@testuser")).toBeVisible();
  await page
    .getByPlaceholder("owner/repo (e.g. facebook/react)")
    .fill("facebook/react");
  await page.getByRole("button", { name: "Analyze" }).click();

  await expect(
    page.getByText("Session expired. Please log in again."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /login with github/i }),
  ).toBeVisible();
});
