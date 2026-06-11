import { expect, test } from "@playwright/test";
import { analyzeFromHome, mockAuthenticatedPage } from "./fixtures";

const tourResponse = {
  query: "auth flow",
  title: "Auth flow",
  stops: [
    {
      file_path: "src/Button.tsx",
      line_start: 1,
      line_end: 2,
      explanation: "First stop explanation",
    },
    {
      file_path: "src/index.ts",
      line_start: 1,
      line_end: 1,
      explanation: "Second stop explanation",
    },
  ],
  token_usage: { input_tokens: 11, output_tokens: 9 },
};

test("runs a code tour through its stops and exits", async ({ page }) => {
  await mockAuthenticatedPage(page);
  await page.route("**/tour", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      owner: "facebook",
      repo: "react",
      git_ref: "main",
      query: "auth flow",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tourResponse),
    });
  });

  await analyzeFromHome(page);

  await page.getByRole("button", { name: "Tour" }).click();
  await page.getByPlaceholder("e.g. Explain the auth flow").fill("auth flow");
  await page.getByRole("button", { name: "Go", exact: true }).click();

  await expect(page.getByText("Tour: 1/2")).toBeVisible();
  // The overlay widget renders inside the Monaco editor, which loads async.
  await expect(page.getByText("First stop explanation")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("1/2 - Auth flow")).toBeVisible();

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Tour: 2/2")).toBeVisible();
  await expect(page.getByText("Second stop explanation")).toBeVisible();
  await expect(
    page.locator("main p[title='src/index.ts']").last(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Prev", exact: true }).click();
  await expect(page.getByText("Tour: 1/2")).toBeVisible();
  await expect(page.getByText("First stop explanation")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Tour: 1/2")).not.toBeVisible();
  await expect(page.getByText("First stop explanation")).not.toBeVisible();
});

test("shows an error when the tour request fails", async ({ page }) => {
  await mockAuthenticatedPage(page);
  await page.route("**/tour", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "tour generation failed" }),
    });
  });

  await analyzeFromHome(page);

  await page.getByRole("button", { name: "Tour" }).click();
  await page.getByPlaceholder("e.g. Explain the auth flow").fill("auth flow");
  await page.getByRole("button", { name: "Go", exact: true }).click();

  await expect(page.getByText("tour generation failed")).toBeVisible();
});
