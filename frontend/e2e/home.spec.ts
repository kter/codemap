import { expect, test, type Page } from "@playwright/test";

const analyzeResponse = {
  owner: "facebook",
  repo: "react",
  git_ref: "main",
  token_usage: {
    input_tokens: 123,
    output_tokens: 45,
  },
  files: [
    {
      path: "src/Button.tsx",
      source_code:
        "export function Button() {\n  return <button>Click me</button>;\n}\n",
      interfaces: [
        {
          name: "ButtonProps",
          line: 1,
          signature: "interface ButtonProps {}",
          description: "Props for Button",
        },
      ],
      happy_paths: [
        {
          name: "renderButton",
          line: 1,
          summary: "Render the button",
        },
      ],
    },
    {
      path: "src/index.ts",
      source_code: "export * from './Button';\n",
      interfaces: [],
      happy_paths: [],
    },
  ],
};

const treeResponse = {
  owner: "facebook",
  repo: "react",
  git_ref: "main",
  paths: ["src/Button.tsx", "src/index.ts"],
};

async function mockUnauthenticatedPage(page: Page) {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "not authenticated" }),
    });
  });
}

async function mockAuthenticatedPage(page: Page) {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ login: "testuser", github_user_id: 42 }),
    });
  });
  await page.route("**/analyze", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.postDataJSON()).toEqual({
      owner: "facebook",
      repo: "react",
      git_ref: "main",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(analyzeResponse),
    });
  });
  await page.route("**/tree?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(treeResponse),
    });
  });
  await page.route("**/auth/logout", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });
}

test("shows GitHub login when unauthenticated", async ({ page }) => {
  await mockUnauthenticatedPage(page);

  await page.goto("/");

  await expect(
    page.getByRole("link", { name: /login with github/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /login with github/i }),
  ).toHaveAttribute("href", "/auth/github");
  await expect(
    page.getByRole("heading", { name: "CodeMap" }),
  ).toBeVisible();
});

test("analyzes a repository from the authenticated home screen", async ({
  page,
}) => {
  await mockAuthenticatedPage(page);

  await page.goto("/");

  await expect(page.getByText("@testuser")).toBeVisible();
  await page.getByPlaceholder("owner/repo (e.g. facebook/react)").fill(
    "facebook/react",
  );
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
