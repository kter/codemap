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

jest.mock("@/components/FileTree", () => ({
  FileTree: () => <div data-testid="mock-file-tree" />,
}));

jest.mock("@/components/AIExplanation", () => ({
  AIExplanation: () => <div data-testid="mock-ai-explanation" />,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

let replaceStateSpy: jest.SpyInstance;

beforeEach(() => {
  // Reset URL to "/" before each test using pushState (no actual navigation)
  window.history.pushState({}, "", "/");
  replaceStateSpy = jest
    .spyOn(window.history, "replaceState")
    .mockImplementation(jest.fn());
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
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
    expect(btn).toHaveAttribute(
      "href",
      expect.stringContaining("/auth/github"),
    );
  });

  it("does not show the analyze form", async () => {
    render(<Home />);
    await screen.findByRole("link", { name: /login with github/i });
    expect(
      screen.queryByRole("button", { name: /analyze/i }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.getByRole("button", { name: /analyze/i }),
    ).toBeInTheDocument();
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
      expect(
        screen.queryByRole("button", { name: /analyze/i }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /login with github/i }),
    ).toBeInTheDocument();
  });
});

const sampleAnalyzeResponse = {
  owner: "facebook",
  repo: "react",
  git_ref: "main",
  files: [
    {
      path: "src/Button.tsx",
      interfaces: [
        {
          name: "ButtonProps",
          line: 1,
          signature: "interface ButtonProps {}",
          description: "Props for the Button component",
        },
      ],
      happy_paths: [
        {
          name: "handleClick",
          line: 10,
          summary: "Handles button click events",
        },
      ],
    },
    {
      path: "src/index.ts",
      interfaces: [],
      happy_paths: [{ name: "init", line: 1, summary: "Initializes the app" }],
    },
  ],
};

describe("Home — URL persistence", () => {
  it("updates URL after successful analysis", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleAnalyzeResponse,
      });

    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });

    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.clear(repoInput);
    await user.type(repoInput, "facebook/react");

    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByTestId("mock-file-tree");

    expect(replaceStateSpy).toHaveBeenCalledWith(
      {},
      "",
      "?owner=facebook&repo=react&ref=main",
    );
  });

  it("clears URL on logout", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });

    render(<Home />);
    const logoutBtn = await screen.findByRole("button", { name: /logout/i });
    await user.click(logoutBtn);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /analyze/i })).not.toBeInTheDocument(),
    );
    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/");
  });

  it("auto-analyzes when URL has owner and repo params", async () => {
    // Set URL params before rendering (pushState doesn't trigger navigation)
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleAnalyzeResponse,
      });

    render(<Home />);
    // Should auto-trigger analysis and render the file tree without any user input
    await screen.findByTestId("mock-file-tree");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/analyze"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ owner: "facebook", repo: "react", git_ref: "main" }),
      }),
    );
  });
});

describe("Home — with results", () => {
  beforeEach(() => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleAnalyzeResponse,
      });
  });

  async function renderAndAnalyze() {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });

    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.clear(repoInput);
    await user.type(repoInput, "facebook/react");

    await user.click(screen.getByRole("button", { name: /analyze/i }));
    return user;
  }

  it("renders the file tree after successful analysis", async () => {
    await renderAndAnalyze();
    await screen.findByTestId("mock-file-tree");
  });

  it("renders the AI explanation panel after successful analysis", async () => {
    await renderAndAnalyze();
    await screen.findByTestId("mock-ai-explanation");
  });

  it("shows repo info in the header after analysis", async () => {
    await renderAndAnalyze();
    await screen.findByText(/facebook\/react/);
  });

  it("shows the logged-in user in the compact header", async () => {
    await renderAndAnalyze();
    await screen.findByText("@testuser");
  });
});
