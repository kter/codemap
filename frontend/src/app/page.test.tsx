import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";

// Monaco Editor is not compatible with jsdom
jest.mock("@/components/Editor", () => ({
  Editor: () => <div data-testid="mock-editor" />,
}));

// AnalysisResults is not the focus here
jest.mock("@/components/AnalysisResults", () => ({
  AnalysisResults: () => <div data-testid="mock-analysis-results" />,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => {
  jest.clearAllMocks();
});

describe("Home — unauthenticated", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "not authenticated" }),
    });
  });

  it("shows GitHub login button", async () => {
    render(<Home />);
    const btn = await screen.findByRole("link", { name: /login with github/i });
    expect(btn).toBeInTheDocument();
  });

  it("login button links to /auth/github", async () => {
    render(<Home />);
    const btn = await screen.findByRole("link", { name: /login with github/i });
    expect(btn).toHaveAttribute("href", expect.stringContaining("/auth/github"));
  });

  it("does not show the analyze form", async () => {
    render(<Home />);
    await screen.findByRole("link", { name: /login with github/i });
    expect(screen.queryByRole("button", { name: /analyze/i })).not.toBeInTheDocument();
  });
});

describe("Home — authenticated", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ login: "testuser", github_user_id: 42 }),
    });
  });

  it("shows the analyze form", async () => {
    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });
    expect(screen.getByRole("button", { name: /analyze/i })).toBeInTheDocument();
  });

  it("shows the logged-in user handle", async () => {
    render(<Home />);
    await screen.findByText("@testuser");
  });

  it("shows a logout button", async () => {
    render(<Home />);
    await screen.findByRole("button", { name: /logout/i });
  });
});

describe("Home — logout", () => {
  it("clicking logout calls /auth/logout and shows login screen", async () => {
    const user = userEvent.setup();

    // First call: /auth/me succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      // Second call: POST /auth/logout
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });

    render(<Home />);
    const logoutBtn = await screen.findByRole("button", { name: /logout/i });
    await user.click(logoutBtn);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /analyze/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /login with github/i })).toBeInTheDocument();
  });
});
