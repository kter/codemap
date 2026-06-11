import { expect, test } from "@playwright/test";

/**
 * Smoke tests against a deployed environment (e.g. dev).
 *
 * Opt-in: set E2E_DEV_BASE_URL (frontend) and E2E_DEV_API_BASE_URL (API).
 * Run via `make frontend-e2e-dev ENV=dev`, which resolves both URLs from
 * Terraform outputs.
 *
 * Intentionally limited to unauthenticated pages and the non-AI /health
 * endpoint so a run costs nothing in AI usage.
 */

const frontendUrl = process.env.E2E_DEV_BASE_URL;
const apiUrl = process.env.E2E_DEV_API_BASE_URL;

test.describe("deployed environment smoke", () => {
  test.skip(
    !frontendUrl,
    "Set E2E_DEV_BASE_URL to run smoke tests against a deployed environment",
  );

  test("serves the login screen", async ({ page }) => {
    await page.goto(frontendUrl!);
    await expect(page.getByRole("heading", { name: "CodeMap" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /login with github/i }),
    ).toBeVisible();
  });

  test("login link points at the deployed API", async ({ page }) => {
    await page.goto(frontendUrl!);
    const href = await page
      .getByRole("link", { name: /login with github/i })
      .getAttribute("href");
    expect(href).toContain("/auth/github");
  });

  test("API /health responds ok without auth", async ({ request }) => {
    test.skip(!apiUrl, "Set E2E_DEV_API_BASE_URL to run API smoke tests");
    const resp = await request.get(`${apiUrl}/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("codemap-api");
  });

  test("API rejects unauthenticated analyze requests", async ({ request }) => {
    test.skip(!apiUrl, "Set E2E_DEV_API_BASE_URL to run API smoke tests");
    // Must 401 before reaching GitHub or the AI model — no tokens spent.
    const resp = await request.post(`${apiUrl}/analyze`, {
      data: { owner: "foo", repo: "bar", git_ref: "main" },
    });
    expect(resp.status()).toBe(401);
  });
});
