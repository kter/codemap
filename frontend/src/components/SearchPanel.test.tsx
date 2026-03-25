import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./SearchPanel";
import { SearchResponse } from "@/types/analysis";

const defaultProps = {
  owner: "acme",
  repo: "demo",
  git_ref: "main",
  onNavigate: jest.fn(),
  onClose: jest.fn(),
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("SearchPanel", () => {
  it("shows empty state initially", () => {
    render(<SearchPanel {...defaultProps} />);
    expect(
      screen.getByPlaceholderText("Search in repository…"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Type to search across all files."),
    ).toBeInTheDocument();
  });

  it("shows loading state while fetching", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));

    render(<SearchPanel {...defaultProps} />);
    await user.type(
      screen.getByPlaceholderText("Search in repository…"),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByRole("button", { name: "…" }),
    ).toBeInTheDocument();
  });

  it("renders results grouped by file", async () => {
    const user = userEvent.setup();
    const response: SearchResponse = {
      matches: [
        { path: "src/foo.ts", line: 3, content: "const foo = 1;" },
        { path: "src/foo.ts", line: 7, content: "export { foo };" },
        {
          path: "src/bar.ts",
          line: 1,
          content: "import { foo } from './foo';",
        },
      ],
      searched_files: 5,
      truncated: false,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    });

    render(<SearchPanel {...defaultProps} />);
    await user.type(
      screen.getByPlaceholderText("Search in repository…"),
      "foo",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/src\/foo\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/bar\.ts/)).toBeInTheDocument();
    expect(screen.getByText("const foo = 1;")).toBeInTheDocument();
    expect(screen.getByText("export { foo };")).toBeInTheDocument();
  });

  it("clicking a result calls onNavigate with correct path and line", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    const response: SearchResponse = {
      matches: [{ path: "src/foo.ts", line: 3, content: "const foo = 1;" }],
      searched_files: 1,
      truncated: false,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    });

    render(<SearchPanel {...defaultProps} onNavigate={onNavigate} />);
    await user.type(
      screen.getByPlaceholderText("Search in repository…"),
      "foo",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    const resultButton = await screen.findByText("const foo = 1;");
    await user.click(resultButton);

    expect(onNavigate).toHaveBeenCalledWith("src/foo.ts", 3);
  });

  it("shows truncated warning", async () => {
    const user = userEvent.setup();
    const response: SearchResponse = {
      matches: [{ path: "src/foo.ts", line: 1, content: "foo" }],
      searched_files: 100,
      truncated: true,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    });

    render(<SearchPanel {...defaultProps} />);
    await user.type(
      screen.getByPlaceholderText("Search in repository…"),
      "foo",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Results capped at 200"),
    ).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "server error" }),
    });

    render(<SearchPanel {...defaultProps} />);
    await user.type(
      screen.getByPlaceholderText("Search in repository…"),
      "foo",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("server error")).toBeInTheDocument();
  });
});
