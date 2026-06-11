import { expect, type Page } from "@playwright/test";

export const analyzeResponse = {
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

export const treeResponse = {
  owner: "facebook",
  repo: "react",
  git_ref: "main",
  paths: ["src/Button.tsx", "src/index.ts", "src/utils.ts"],
};

export function explanationFor(path: string, language: string) {
  const isJapanese = language === "ja";
  return {
    path,
    kind: "structured",
    overview: isJapanese ? `${path} の概要です。` : `Overview of ${path}.`,
    interfaces: [
      {
        name: "ButtonProps",
        line: 1,
        signature: "interface ButtonProps {}",
        description: isJapanese ? "ボタンのプロパティ" : "Props for Button",
      },
    ],
    happy_paths: [
      {
        name: "renderButton",
        line: 2,
        summary: isJapanese ? "ボタンを描画する" : "Render the button",
      },
    ],
    token_usage: { input_tokens: 7, output_tokens: 5 },
  };
}

export async function mockUnauthenticatedPage(page: Page) {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "not authenticated" }),
    });
  });
}

export async function mockAuthenticatedPage(page: Page) {
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
  await page.route("**/file/explanation*", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        explanationFor(
          url.searchParams.get("path") ?? "",
          url.searchParams.get("explanation_language") ?? "en",
        ),
      ),
    });
  });
  await page.route("**/auth/logout", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });
}

/** Logs in (mocked), runs an analyze of facebook/react@main and waits for the result UI. */
export async function analyzeFromHome(page: Page) {
  await page.goto("/");
  await expect(page.getByText("@testuser")).toBeVisible();
  await page
    .getByPlaceholder("owner/repo (e.g. facebook/react)")
    .fill("facebook/react");
  await page.getByPlaceholder("git ref (branch, tag, or SHA)").fill("main");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByText("facebook/react @ main")).toBeVisible();
}
