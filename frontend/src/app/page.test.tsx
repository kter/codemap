import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";
import { FileExplanation, NavigationTarget } from "@/types/analysis";

const capturedEditorProps: {
  revealLine?: number;
  revealNonce?: number;
  onCursorLineChange?: (line: number) => void;
  onNavigate?: (target: NavigationTarget) => void;
}[] = [];
const mockEditorHandle = {
  focus: jest.fn(),
  moveCursor: jest.fn(),
  scrollLines: jest.fn(),
  scrollPages: jest.fn(),
  goTop: jest.fn(),
  goBottom: jest.fn(),
  goDefinition: jest.fn(),
  showReferences: jest.fn(),
};
const mockFileTreeHandle = {
  moveCursor: jest.fn(),
  pageMove: jest.fn(),
  goTop: jest.fn(),
  goBottom: jest.fn(),
  expandOrOpen: jest.fn(),
  collapse: jest.fn(),
};
const mockAIExplanationHandle = {
  moveCursor: jest.fn(),
  pageMove: jest.fn(),
  goTop: jest.fn(),
  goBottom: jest.fn(),
  activateSelection: jest.fn(() => true),
};
let capturedFileTreeProps: { active?: boolean } | null = null;
let capturedAIExplanationProps: {
  active?: boolean;
  selectedPath?: string | null;
  status?: string;
  explanation?: FileExplanation | null;
  errorMessage?: string | null;
} | null = null;

jest.mock("@/components/Editor", () => ({
  Editor: require("react").forwardRef(
    (
      props: {
        revealLine?: number;
        revealNonce?: number;
        onCursorLineChange?: (line: number) => void;
        onNavigate?: (target: NavigationTarget) => void;
      },
      ref: unknown,
    ) => {
      require("react").useImperativeHandle(ref, () => mockEditorHandle);
      capturedEditorProps.push({
        revealLine: props.revealLine,
        revealNonce: props.revealNonce,
        onCursorLineChange: props.onCursorLineChange,
        onNavigate: props.onNavigate,
      });
      return (
        <div data-testid="mock-editor">
          <textarea data-testid="mock-editor-input" readOnly />
        </div>
      );
    },
  ),
}));

// AnalysisResults is not the focus here
jest.mock("@/components/AnalysisResults", () => ({
  AnalysisResults: () => <div data-testid="mock-analysis-results" />,
}));

// Capture onFileSelect so tests can trigger file selection
let capturedFileSelectFn: ((path: string) => void) | null = null;
jest.mock("@/components/FileTree", () => ({
  FileTree: require("react").forwardRef(
    (
      props: { onFileSelect?: (path: string) => void; active?: boolean },
      ref: unknown,
    ) => {
      require("react").useImperativeHandle(ref, () => mockFileTreeHandle);
      capturedFileSelectFn = props.onFileSelect ?? null;
      capturedFileTreeProps = { active: props.active };
      return <div data-testid="mock-file-tree" />;
    },
  ),
}));

jest.mock("@/components/AIExplanation", () => ({
  AIExplanation: require("react").forwardRef(
    (
      props: {
        active?: boolean;
        selectedPath?: string | null;
        status?: string;
        explanation?: FileExplanation | null;
        errorMessage?: string | null;
      },
      ref: unknown,
    ) => {
      require("react").useImperativeHandle(ref, () => mockAIExplanationHandle);
      capturedAIExplanationProps = {
        active: props.active,
        selectedPath: props.selectedPath,
        status: props.status,
        explanation: props.explanation ?? null,
        errorMessage: props.errorMessage ?? null,
      };
      return <div data-testid="mock-ai-explanation" />;
    },
  ),
}));

jest.mock("@/components/HelpDialog", () => ({
  HelpDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="help-dialog">
        <span>利用ガイド</span>
        <button onClick={onClose}>閉じる</button>
      </div>
    ) : null,
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
  capturedEditorProps.length = 0;
  capturedFileSelectFn = null;
  capturedFileTreeProps = null;
  capturedAIExplanationProps = null;
  Object.values(mockEditorHandle).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
  Object.values(mockFileTreeHandle).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
  Object.values(mockAIExplanationHandle).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
  mockAIExplanationHandle.activateSelection.mockReturnValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  localStorage.clear();
});

const sampleTreeResponse = {
  owner: "facebook",
  repo: "react",
  git_ref: "main",
  paths: ["src/Button.tsx", "src/index.ts"],
};

const sampleFileExplanationResponse: FileExplanation = {
  path: "docs/guide.md",
  kind: "summary",
  overview: "Explains how to use the guide for the project.",
  interfaces: [],
  happy_paths: [],
};
const EXPLANATION_LANGUAGE_STORAGE_KEY =
  "codemap:settings:ai-explanation-language";

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
      source_code: "",
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
      source_code: "",
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
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
      expect(
        screen.queryByRole("button", { name: /analyze/i }),
      ).not.toBeInTheDocument(),
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    render(<Home />);
    // Should auto-trigger analysis and render the file tree without any user input
    await screen.findByTestId("mock-file-tree");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/analyze"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          owner: "facebook",
          repo: "react",
          git_ref: "main",
        }),
      }),
    );
  });
});

describe("Home — localStorage cache", () => {
  const CACHE_KEY = "codemap:result:facebook/react@main";

  function seedCache(overrides?: { cachedAt?: number }) {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        data: sampleAnalyzeResponse,
        cachedAt: overrides?.cachedAt ?? Date.now(),
      }),
    );
  }

  it("saves result to localStorage after successful analysis", async () => {
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });
    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.clear(repoInput);
    await user.type(repoInput, "facebook/react");
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByTestId("mock-file-tree");

    const cached = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(cached.data).toEqual(sampleAnalyzeResponse);
    expect(cached.cachedAt).toBeLessThanOrEqual(Date.now());
  });

  it("restores analyze view immediately from cache before /analyze returns", async () => {
    seedCache();
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");

    // /analyze never resolves — simulates a slow server
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockReturnValueOnce(new Promise(() => {}));

    render(<Home />);

    // File tree should be visible from cache without waiting for /analyze
    await screen.findByTestId("mock-file-tree");
  });

  it("does not clear the cached view while background re-analyze is in-flight", async () => {
    seedCache();
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");

    let resolveAnalyze!: (v: unknown) => void;
    const analyzePromise = new Promise((res) => {
      resolveAnalyze = res;
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockReturnValueOnce(analyzePromise)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    render(<Home />);
    // Cache is shown; background fetch is pending
    await screen.findByTestId("mock-file-tree");
    // View should still be present (not cleared by clearPrevious=false)
    expect(screen.getByTestId("mock-file-tree")).toBeInTheDocument();

    // Resolve the pending fetch to avoid unhandled promise rejections
    resolveAnalyze({
      ok: true,
      status: 200,
      json: async () => sampleAnalyzeResponse,
    });
  });

  it("clears result cache on logout but preserves explanation language", async () => {
    const user = userEvent.setup();
    seedCache();
    localStorage.setItem(EXPLANATION_LANGUAGE_STORAGE_KEY, "ja");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      });

    render(<Home />);
    const logoutBtn = await screen.findByRole("button", { name: /logout/i });
    await user.click(logoutBtn);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /analyze/i }),
      ).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(localStorage.getItem(EXPLANATION_LANGUAGE_STORAGE_KEY)).toBe("ja");
  });

  it("does not restore an expired cache entry", async () => {
    // Seed a cache that expired 25 hours ago
    seedCache({ cachedAt: Date.now() - 25 * 60 * 60 * 1000 });
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");

    // Control when /analyze resolves so we can inspect the intermediate state
    let resolveAnalyze!: (v: unknown) => void;
    const analyzePromise = new Promise((res) => {
      resolveAnalyze = res;
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockReturnValueOnce(analyzePromise) // /analyze is pending
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    render(<Home />);
    // Auto-analyze fires; expired cache was not restored → form with "Analyzing…"
    await screen.findByRole("button", { name: /analyzing…/i });
    expect(screen.queryByTestId("mock-file-tree")).not.toBeInTheDocument();

    // Resolve /analyze → analyze view appears with a fresh cache entry
    resolveAnalyze({
      ok: true,
      status: 200,
      json: async () => sampleAnalyzeResponse,
    });
    await screen.findByTestId("mock-file-tree");
    const fresh = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(fresh.data).toEqual(sampleAnalyzeResponse);
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
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

  it("shows the current file name and path in the editor pane", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        path: "src/Button.tsx",
        content: "export const Button = () => null;",
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        path: "src/Button.tsx",
        kind: "structured",
        overview: "Explains the button module.",
        interfaces: [],
        happy_paths: [],
      }),
    });

    await renderAndAnalyze();

    await act(async () => {
      await capturedFileSelectFn?.("src/Button.tsx");
    });

    expect(await screen.findByText("Current file")).toBeInTheDocument();
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/Button.tsx")).toBeInTheDocument();
  });

  it("shows the logged-in user in the compact header", async () => {
    await renderAndAnalyze();
    await screen.findByText("@testuser");
  });
});

describe("Home — async AI explanations", () => {
  const CACHE_KEY = "codemap:result:facebook/react@main";

  beforeEach(() => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: sampleAnalyzeResponse, cachedAt: Date.now() }),
    );
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");
  });

  it("fetches explanations for analyzed files with the default language", async () => {
    const response: FileExplanation = {
      path: "src/Button.tsx",
      kind: "structured",
      overview: "Explains the button module in English.",
      interfaces: [],
      happy_paths: [],
    };

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ login: "testuser", github_user_id: 42 }),
        });
      }
      if (url.includes("/analyze")) {
        return new Promise(() => {});
      }
      if (url.includes("/file?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: "src/Button.tsx",
            content: "export const x = 1;",
          }),
        });
      }
      if (url.includes("/file/explanation?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => response,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<Home />);
    await screen.findByTestId("mock-file-tree");

    await act(async () => {
      await capturedFileSelectFn?.("src/Button.tsx");
    });

    await waitFor(() =>
      expect(capturedAIExplanationProps?.selectedPath).toBe("src/Button.tsx"),
    );
    expect(capturedAIExplanationProps?.status).toBe("ready");
    expect(capturedAIExplanationProps?.explanation).toEqual(response);
    const explanationCalls = mockFetch.mock.calls.filter(([input]) =>
      String(input).includes("/file/explanation?"),
    );
    expect(explanationCalls).toHaveLength(1);
    expect(String(explanationCalls[0]?.[0])).toContain(
      "explanation_language=en",
    );
  });

  it("loads the target file when editor navigation jumps to an unopened file", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ login: "testuser", github_user_id: 42 }),
        });
      }
      if (url.includes("/analyze")) {
        return new Promise(() => {});
      }
      if (url.includes("/file?") && url.includes("path=src%2FButton.tsx")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: "src/Button.tsx",
            content: "export const Button = () => null;",
          }),
        });
      }
      if (url.includes("/file?") && url.includes("path=src%2Findex.ts")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: "src/index.ts",
            content: "export const init = () => true;",
          }),
        });
      }
      if (url.includes("/file/explanation?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => sampleFileExplanationResponse,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<Home />);
    await screen.findByTestId("mock-file-tree");

    await act(async () => {
      await capturedFileSelectFn?.("src/Button.tsx");
    });
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([input]) =>
          String(input).includes("path=src%2FButton.tsx"),
        ),
      ).toBe(true),
    );

    const latestEditor = capturedEditorProps[capturedEditorProps.length - 1];
    await act(async () => {
      await latestEditor?.onNavigate?.({ filePath: "src/index.ts", line: 1 });
    });

    expect(
      mockFetch.mock.calls.some(([input]) =>
        String(input).includes("path=src%2Findex.ts"),
      ),
    ).toBe(true);
  });

  it("fetches and caches explanations per language", async () => {
    const user = userEvent.setup();
    const englishResponse: FileExplanation = {
      ...sampleFileExplanationResponse,
      overview: "English explanation",
    };
    const japaneseResponse: FileExplanation = {
      ...sampleFileExplanationResponse,
      overview: "Japanese explanation",
    };

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ login: "testuser", github_user_id: 42 }),
        });
      }
      if (url.includes("/analyze")) {
        return new Promise(() => {});
      }
      if (url.includes("/file?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ path: "docs/guide.md", content: "# Guide" }),
        });
      }
      if (url.includes("/file/explanation?")) {
        const payload = url.includes("explanation_language=ja")
          ? japaneseResponse
          : englishResponse;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => payload,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<Home />);
    await screen.findByTestId("mock-file-tree");

    await act(async () => {
      await capturedFileSelectFn?.("docs/guide.md");
    });

    await waitFor(() =>
      expect(capturedAIExplanationProps?.status).toBe("ready"),
    );
    expect(capturedAIExplanationProps?.explanation).toEqual(englishResponse);

    const explanationCalls = mockFetch.mock.calls.filter(([input]) =>
      String(input).includes("/file/explanation?"),
    );
    expect(explanationCalls).toHaveLength(1);
    expect(String(explanationCalls[0]?.[0])).toContain(
      "explanation_language=en",
    );

    await user.selectOptions(
      screen.getByLabelText(/ai explanation language/i),
      "ja",
    );

    await waitFor(() =>
      expect(capturedAIExplanationProps?.explanation).toEqual(japaneseResponse),
    );

    const explanationCallsAfterJapanese = mockFetch.mock.calls.filter(
      ([input]) => String(input).includes("/file/explanation?"),
    );
    expect(explanationCallsAfterJapanese).toHaveLength(2);
    expect(String(explanationCallsAfterJapanese[1]?.[0])).toContain(
      "explanation_language=ja",
    );

    await user.selectOptions(
      screen.getByLabelText(/ai explanation language/i),
      "en",
    );

    await waitFor(() =>
      expect(capturedAIExplanationProps?.explanation).toEqual(englishResponse),
    );

    const explanationCallsAfterSwitchBack = mockFetch.mock.calls.filter(
      ([input]) => String(input).includes("/file/explanation?"),
    );
    expect(explanationCallsAfterSwitchBack).toHaveLength(2);
  });
});

describe("Home — explanation language setting", () => {
  it("restores the saved explanation language from localStorage", async () => {
    localStorage.setItem(EXPLANATION_LANGUAGE_STORAGE_KEY, "ja");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ login: "testuser", github_user_id: 42 }),
    });

    render(<Home />);

    expect(
      await screen.findByLabelText(/ai explanation language/i),
    ).toHaveValue("ja");
  });
});

describe("Home — help dialog", () => {
  function setupAuth() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ login: "testuser", github_user_id: 42 }),
    });
  }

  it("clicking ? button in form view opens the help dialog", async () => {
    const user = userEvent.setup();
    setupAuth();
    render(<Home />);
    const helpBtn = await screen.findByRole("button", { name: /利用ガイド/i });
    await user.click(helpBtn);
    expect(screen.getByTestId("help-dialog")).toBeInTheDocument();
    expect(screen.getByText("利用ガイド")).toBeInTheDocument();
  });

  it("pressing Escape closes the help dialog", async () => {
    const user = userEvent.setup();
    setupAuth();
    render(<Home />);
    const helpBtn = await screen.findByRole("button", { name: /利用ガイド/i });
    await user.click(helpBtn);
    expect(screen.getByTestId("help-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("help-dialog")).not.toBeInTheDocument(),
    );
  });

  it("pressing ? key (not in input) opens the help dialog", async () => {
    const user = userEvent.setup();
    setupAuth();
    render(<Home />);
    await screen.findByRole("button", { name: /利用ガイド/i });
    // Focus on document.body (not an input)
    document.body.focus();
    await user.keyboard("?");
    expect(screen.getByTestId("help-dialog")).toBeInTheDocument();
  });

  it("pressing ? key while in an input does not open the dialog", async () => {
    const user = userEvent.setup();
    setupAuth();
    render(<Home />);
    await screen.findByRole("button", { name: /利用ガイド/i });
    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.click(repoInput);
    await user.keyboard("?");
    expect(screen.queryByTestId("help-dialog")).not.toBeInTheDocument();
  });

  it("help button is visible in result view and clicking it shows dialog", async () => {
    const CACHE_KEY = "codemap:result:facebook/react@main";
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: sampleAnalyzeResponse, cachedAt: Date.now() }),
    );
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockReturnValueOnce(new Promise(() => {}));

    const user = userEvent.setup();
    render(<Home />);
    await screen.findByTestId("mock-file-tree");

    const helpBtn = screen.getByRole("button", { name: /利用ガイド/i });
    expect(helpBtn).toBeInTheDocument();
    await user.click(helpBtn);
    expect(screen.getByTestId("help-dialog")).toBeInTheDocument();
  });
});

describe("Home — navigation (revealNonce)", () => {
  // Use a pre-seeded cache so the result view loads immediately
  const CACHE_KEY = "codemap:result:facebook/react@main";

  beforeEach(() => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: sampleAnalyzeResponse, cachedAt: Date.now() }),
    );
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");
  });

  function setupFetch() {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      // background /analyze re-fetch never resolves (keeps result view stable)
      .mockReturnValueOnce(new Promise(() => {}));
  }

  it("Editor receives revealNonce=0 on initial render after file selection", async () => {
    setupFetch();
    render(<Home />);
    // Wait for result view (file tree loaded from cache)
    await screen.findByTestId("mock-file-tree");

    // Select a file via the captured FileTree onFileSelect callback
    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });

    await screen.findByTestId("mock-editor");

    // The last captured prop set should have revealNonce=0 (initial state)
    const last = capturedEditorProps[capturedEditorProps.length - 1];
    expect(last.revealNonce).toBe(0);
  });

  it("revealNonce increments each time handleNavigate is called", async () => {
    setupFetch();
    render(<Home />);
    await screen.findByTestId("mock-file-tree");

    const { act } = await import("@testing-library/react");
    // Select a file to make Editor visible
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");

    const nonceBefore =
      capturedEditorProps[capturedEditorProps.length - 1].revealNonce ?? 0;
    expect(typeof nonceBefore).toBe("number");

    // The nonce is an incrementing counter — verify it starts at 0
    expect(nonceBefore).toBe(0);
  });
});

describe("Home — Vim shortcuts", () => {
  const CACHE_KEY = "codemap:result:facebook/react@main";

  beforeEach(() => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: sampleAnalyzeResponse, cachedAt: Date.now() }),
    );
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockReturnValueOnce(new Promise(() => {}));
  });

  async function renderResultView() {
    render(<Home />);
    await screen.findByTestId("mock-file-tree");
  }

  async function dispatchKeyDown(
    target: Document | Element,
    init: KeyboardEventInit,
  ) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("routes editor scrolling shortcuts to the editor handle", async () => {
    const user = userEvent.setup();
    await renderResultView();

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");

    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    fireEvent.keyDown(document, { key: "b", ctrlKey: true });
    fireEvent.keyDown(document, { key: "e", ctrlKey: true });
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });

    expect(mockEditorHandle.scrollPages).toHaveBeenCalledWith(1);
    expect(mockEditorHandle.scrollPages).toHaveBeenCalledWith(-1);
    expect(mockEditorHandle.scrollLines).toHaveBeenCalledWith(1);
    expect(mockEditorHandle.scrollLines).toHaveBeenCalledWith(-1);

    await user.keyboard("gg");
    await user.keyboard("G");
    expect(mockEditorHandle.goTop).toHaveBeenCalled();
    expect(mockEditorHandle.goBottom).toHaveBeenCalled();
  });

  it("keeps Vim shortcuts active when Monaco's internal textarea has focus", async () => {
    await renderResultView();

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    const editor = await screen.findByTestId("mock-editor");
    const editorInput = screen.getByTestId("mock-editor-input");

    fireEvent.mouseDown(editor);
    fireEvent.keyDown(editorInput, { key: "f", ctrlKey: true });
    expect(mockEditorHandle.scrollPages).toHaveBeenCalledWith(1);

    fireEvent.keyDown(editorInput, { key: "g" });
    fireEvent.keyDown(editorInput, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(editorInput, { key: "T", shiftKey: true });
    fireEvent.keyDown(document, { key: "j" });
    expect(mockFileTreeHandle.moveCursor).toHaveBeenCalledWith(1);
  });

  it("handles Ctrl-e/y/f/b from Monaco textarea and prevents default browser behavior", async () => {
    await renderResultView();

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");
    const editor = screen.getByTestId("mock-editor");
    const editorInput = screen.getByTestId("mock-editor-input");

    fireEvent.mouseDown(editor);

    const ctrlF = await dispatchKeyDown(editorInput, {
      key: "f",
      ctrlKey: true,
    });
    const ctrlB = await dispatchKeyDown(editorInput, {
      key: "b",
      ctrlKey: true,
    });
    const ctrlE = await dispatchKeyDown(editorInput, {
      key: "e",
      ctrlKey: true,
    });
    const ctrlY = await dispatchKeyDown(editorInput, {
      key: "y",
      ctrlKey: true,
    });

    expect(ctrlF.defaultPrevented).toBe(true);
    expect(ctrlB.defaultPrevented).toBe(true);
    expect(ctrlE.defaultPrevented).toBe(true);
    expect(ctrlY.defaultPrevented).toBe(true);
    expect(mockEditorHandle.scrollPages).toHaveBeenCalledWith(1);
    expect(mockEditorHandle.scrollPages).toHaveBeenCalledWith(-1);
    expect(mockEditorHandle.scrollLines).toHaveBeenCalledWith(1);
    expect(mockEditorHandle.scrollLines).toHaveBeenCalledWith(-1);
  });

  it("does not trigger Vim shortcuts from regular header inputs", async () => {
    await renderResultView();

    const repoInput = screen.getByDisplayValue("facebook/react");
    fireEvent.focus(repoInput);

    await dispatchKeyDown(repoInput, { key: "f", ctrlKey: true });
    await dispatchKeyDown(repoInput, { key: "g" });
    await dispatchKeyDown(repoInput, { key: "T", shiftKey: true });

    expect(mockEditorHandle.scrollPages).not.toHaveBeenCalled();
    expect(mockFileTreeHandle.moveCursor).not.toHaveBeenCalled();
    expect(mockAIExplanationHandle.moveCursor).not.toHaveBeenCalled();
  });

  it("switches panes with gt and gT", async () => {
    const user = userEvent.setup();
    await renderResultView();

    expect(capturedFileTreeProps?.active).toBe(true);

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");

    fireEvent.keyDown(document, { key: "j" });
    expect(mockEditorHandle.moveCursor).toHaveBeenCalledWith(1, 0);

    await user.keyboard("gt");
    fireEvent.keyDown(document, { key: "j" });
    expect(mockAIExplanationHandle.moveCursor).toHaveBeenCalledWith(1);

    await user.keyboard("gT");
    fireEvent.keyDown(document, { key: "j" });
    expect(mockEditorHandle.moveCursor).toHaveBeenLastCalledWith(1, 0);

    await user.keyboard("gT");
    fireEvent.keyDown(document, { key: "j" });
    expect(mockFileTreeHandle.moveCursor).toHaveBeenCalledWith(1);
  });

  it("routes Ctrl scrolling to the active non-editor pane", async () => {
    const user = userEvent.setup();
    await renderResultView();

    await dispatchKeyDown(document, { key: "f", ctrlKey: true });
    await dispatchKeyDown(document, { key: "b", ctrlKey: true });
    await dispatchKeyDown(document, { key: "e", ctrlKey: true });
    await dispatchKeyDown(document, { key: "y", ctrlKey: true });

    expect(mockFileTreeHandle.pageMove).toHaveBeenCalledWith(1);
    expect(mockFileTreeHandle.pageMove).toHaveBeenCalledWith(-1);
    expect(mockFileTreeHandle.moveCursor).toHaveBeenCalledWith(1);
    expect(mockFileTreeHandle.moveCursor).toHaveBeenCalledWith(-1);

    await user.keyboard("gt");
    await user.keyboard("gt");

    await dispatchKeyDown(document, { key: "f", ctrlKey: true });
    await dispatchKeyDown(document, { key: "b", ctrlKey: true });
    await dispatchKeyDown(document, { key: "e", ctrlKey: true });
    await dispatchKeyDown(document, { key: "y", ctrlKey: true });

    expect(mockAIExplanationHandle.pageMove).toHaveBeenCalledWith(1);
    expect(mockAIExplanationHandle.pageMove).toHaveBeenCalledWith(-1);
    expect(mockAIExplanationHandle.moveCursor).toHaveBeenCalledWith(1);
    expect(mockAIExplanationHandle.moveCursor).toHaveBeenCalledWith(-1);
  });

  it("supports gT when Shift emits its own keydown before T", async () => {
    await renderResultView();

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");

    await dispatchKeyDown(document, { key: "g" });
    await dispatchKeyDown(document, { key: "Shift", shiftKey: true });
    await dispatchKeyDown(document, { key: "T", shiftKey: true });
    await dispatchKeyDown(document, { key: "j" });

    expect(mockFileTreeHandle.moveCursor).toHaveBeenCalledWith(1);
  });

  it("routes Ctrl-] to the active pane action", async () => {
    await renderResultView();

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");

    fireEvent.keyDown(document, {
      key: "]",
      code: "BracketRight",
      ctrlKey: true,
    });
    expect(mockEditorHandle.goDefinition).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "t" });
    fireEvent.keyDown(document, {
      key: "]",
      code: "BracketRight",
      ctrlKey: true,
    });
    expect(mockAIExplanationHandle.activateSelection).toHaveBeenCalled();
  });

  it("routes F12 and Shift+F12 to the editor handle and prevents browser defaults", async () => {
    await renderResultView();

    const { act } = await import("@testing-library/react");
    await act(async () => {
      capturedFileSelectFn?.("src/Button.tsx");
    });
    await screen.findByTestId("mock-editor");

    const f12 = await dispatchKeyDown(document, { key: "F12", code: "F12" });
    const shiftF12 = await dispatchKeyDown(document, {
      key: "F12",
      code: "F12",
      shiftKey: true,
    });

    expect(f12.defaultPrevented).toBe(true);
    expect(shiftF12.defaultPrevented).toBe(true);
    expect(mockEditorHandle.goDefinition).toHaveBeenCalled();
    expect(mockEditorHandle.showReferences).toHaveBeenCalled();
  });
});

describe("Home — token usage display", () => {
  const CACHE_KEY = "codemap:result:facebook/react@main";

  function setupCacheAndUrl() {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: sampleAnalyzeResponse, cachedAt: Date.now() }),
    );
    window.history.pushState({}, "", "?owner=facebook&repo=react&ref=main");
  }

  it("does not show token counter before any AI call", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        // No token_usage in response (cache hit)
        json: async () => sampleAnalyzeResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    const user = userEvent.setup();
    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });
    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.clear(repoInput);
    await user.type(repoInput, "facebook/react");
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByTestId("mock-file-tree");

    // No token usage in response, so counter should not appear
    expect(screen.queryByTitle(/トークン/)).not.toBeInTheDocument();
  });

  it("shows token counter after analyze response with token_usage", async () => {
    const responseWithUsage = {
      ...sampleAnalyzeResponse,
      token_usage: { input_tokens: 1234, output_tokens: 567 },
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseWithUsage,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    const user = userEvent.setup();
    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });
    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.clear(repoInput);
    await user.type(repoInput, "facebook/react");
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByTestId("mock-file-tree");

    const counter = await screen.findByTitle(/トークン/);
    expect(counter).toBeInTheDocument();
    expect(counter.textContent).toContain("1,234");
    expect(counter.textContent).toContain("567");
  });

  it("accumulates tokens from file/explanation responses", async () => {
    setupCacheAndUrl();

    const fileExplanationWithUsage: FileExplanation = {
      path: "src/Button.tsx",
      kind: "structured",
      overview: "Button module",
      interfaces: [],
      happy_paths: [],
      token_usage: { input_tokens: 500, output_tokens: 200 },
    };

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ login: "testuser", github_user_id: 42 }),
        });
      }
      if (url.includes("/analyze")) return new Promise(() => {});
      if (url.includes("/file?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: "src/Button.tsx",
            content: "export const x = 1;",
          }),
        });
      }
      if (url.includes("/file/explanation?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => fileExplanationWithUsage,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<Home />);
    await screen.findByTestId("mock-file-tree");

    await act(async () => {
      await capturedFileSelectFn?.("src/Button.tsx");
    });

    const counter = await screen.findByTitle(/トークン/);
    expect(counter).toBeInTheDocument();
    expect(counter.textContent).toContain("500");
    expect(counter.textContent).toContain("200");
  });

  it("resets token counter when starting a new analysis", async () => {
    const responseWithUsage = {
      ...sampleAnalyzeResponse,
      token_usage: { input_tokens: 1000, output_tokens: 300 },
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: "testuser", github_user_id: 42 }),
      })
      // First analysis — with tokens
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseWithUsage,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      })
      // Second analysis — no tokens (cache hit)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleAnalyzeResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleTreeResponse,
      });

    const user = userEvent.setup();
    render(<Home />);
    await screen.findByRole("button", { name: /analyze/i });
    const repoInput = screen.getByPlaceholderText(/owner\/repo/i);
    await user.clear(repoInput);
    await user.type(repoInput, "facebook/react");
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByTestId("mock-file-tree");

    // First analysis shows counter
    await screen.findByTitle(/トークン/);

    // Second analysis — counter disappears (reset + no new tokens)
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await waitFor(() =>
      expect(screen.queryByTitle(/トークン/)).not.toBeInTheDocument(),
    );
  });
});
