import { expect, test, type Page } from "@playwright/test";
import { analyzeFromHome, mockAuthenticatedPage } from "./fixtures";

const searchResponse = {
  matches: [
    { path: "src/Button.tsx", line: 2, content: "  return <button>;" },
    { path: "src/utils.ts", line: 5, content: "export function helper() {" },
  ],
  searched_files: 3,
  truncated: false,
};

async function openSearchPanel(page: Page) {
  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Search in repository…")).toBeVisible();
}

test("searches the repository and navigates to a match", async ({ page }) => {
  await mockAuthenticatedPage(page);
  await page.route("**/search?**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("q")).toBe("helper");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(searchResponse),
    });
  });
  await page.route(
    (url) => url.pathname.endsWith("/file"),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          path: "src/utils.ts",
          content: "// utils\n\n\n\nexport function helper() {}\n",
        }),
      });
    },
  );

  await analyzeFromHome(page);
  await openSearchPanel(page);

  await page.getByPlaceholder("Search in repository…").fill("helper");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("src/Button.tsx (1 match)")).toBeVisible();
  await expect(page.getByText("src/utils.ts (1 match)")).toBeVisible();

  // Navigating to a match in a file that was not part of the analysis
  // triggers an on-demand /file load.
  await page.getByRole("button", { name: /export function helper/ }).click();

  await expect(
    page.locator("main p[title='src/utils.ts']").last(),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Search in repository…"),
  ).not.toBeVisible();
});

test("shows an empty state when nothing matches", async ({ page }) => {
  await mockAuthenticatedPage(page);
  await page.route("**/search?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        matches: [],
        searched_files: 2,
        truncated: false,
      }),
    });
  });

  await analyzeFromHome(page);
  await openSearchPanel(page);

  await page.getByPlaceholder("Search in repository…").fill("nomatch");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("No matches in 2 file(s).")).toBeVisible();
});

test("surfaces backend search errors", async ({ page }) => {
  await mockAuthenticatedPage(page);
  await page.route("**/search?**", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "GitHub search unavailable" }),
    });
  });

  await analyzeFromHome(page);
  await openSearchPanel(page);

  await page.getByPlaceholder("Search in repository…").fill("anything");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("GitHub search unavailable")).toBeVisible();

  await page.getByRole("button", { name: "Close search" }).click();
  await expect(
    page.getByPlaceholder("Search in repository…"),
  ).not.toBeVisible();
});
