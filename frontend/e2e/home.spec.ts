import { expect, test } from "@playwright/test";
import {
  analyzeFromHome,
  mockAuthenticatedPage,
  mockUnauthenticatedPage,
} from "./fixtures";

test("shows GitHub login when unauthenticated", async ({ page }) => {
  await mockUnauthenticatedPage(page);

  await page.goto("/");

  await expect(
    page.getByRole("link", { name: /login with github/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /login with github/i }),
  ).toHaveAttribute("href", "/auth/github");
  await expect(page.getByRole("heading", { name: "CodeMap" })).toBeVisible();
});

test("analyzes a repository from the authenticated home screen", async ({
  page,
}) => {
  await mockAuthenticatedPage(page);

  await page.goto("/");

  await expect(page.getByText("@testuser")).toBeVisible();
  await page
    .getByPlaceholder("owner/repo (e.g. facebook/react)")
    .fill("facebook/react");
  await page.getByPlaceholder("git ref (branch, tag, or SHA)").fill("main");
  await page.getByRole("button", { name: "Analyze" }).click();

  await expect(page).toHaveURL(/owner=facebook&repo=react&ref=main/);
  await expect(page.getByText("facebook/react @ main")).toBeVisible();
  await expect(page.getByText("↑123 ↓45")).toBeVisible();

  await page.getByRole("button", { name: "src/" }).click();
  await page.getByRole("button", { name: "Button.tsx" }).click();

  await expect(page.getByText("Current file")).toBeVisible();
  await expect(
    page.locator("main p[title='src/Button.tsx']").last(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
});

test("rejects a repo input that is not owner/repo", async ({ page }) => {
  await mockAuthenticatedPage(page);

  await page.goto("/");
  await expect(page.getByText("@testuser")).toBeVisible();
  await page
    .getByPlaceholder("owner/repo (e.g. facebook/react)")
    .fill("not-a-repo");
  await page.getByRole("button", { name: "Analyze" }).click();

  await expect(
    page.getByText("Please enter a repo in owner/repo format."),
  ).toBeVisible();
});

test("opens and closes the help dialog", async ({ page }) => {
  await mockAuthenticatedPage(page);

  await page.goto("/");
  await expect(page.getByText("@testuser")).toBeVisible();
  await page.getByRole("button", { name: "利用ガイド" }).click();

  await expect(page.getByRole("heading", { name: "利用ガイド" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "利用ガイド" }),
  ).not.toBeVisible();
});

test("restores a cached analysis from localStorage on reload", async ({
  page,
}) => {
  await mockAuthenticatedPage(page);

  await analyzeFromHome(page);
  await expect(page).toHaveURL(/owner=facebook&repo=react&ref=main/);

  // Reload: the cached result renders immediately and the auto re-analyze
  // reuses the same mocked routes without errors.
  await page.reload();
  await expect(page.getByText("facebook/react @ main")).toBeVisible();
  await expect(page.getByRole("button", { name: "src/" })).toBeVisible();
});
