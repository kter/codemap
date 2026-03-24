import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "./FileTree";

const paths = ["src/Button.tsx", "src/index.ts"];

describe("FileTree", () => {
  async function expandSrcDir(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "▸ src/" }));
  }

  it("renders directory button before files are expanded", () => {
    render(
      <FileTree paths={paths} selectedFile={null} onFileSelect={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "▸ src/" })).toBeInTheDocument();
    expect(screen.queryByText("Button.tsx")).not.toBeInTheDocument();
  });

  it("renders empty list without crashing", () => {
    render(<FileTree paths={[]} selectedFile={null} onFileSelect={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onFileSelect with the file path when a file is clicked", async () => {
    const user = userEvent.setup();
    const onFileSelect = jest.fn();
    render(
      <FileTree
        paths={paths}
        selectedFile={null}
        onFileSelect={onFileSelect}
      />,
    );
    await expandSrcDir(user);
    await user.click(screen.getByText("Button.tsx"));
    expect(onFileSelect).toHaveBeenCalledWith("src/Button.tsx");
    expect(onFileSelect).toHaveBeenCalledTimes(1);
  });

  it("applies selected styles to the currently selected file", async () => {
    render(
      <FileTree
        paths={paths}
        selectedFile="src/Button.tsx"
        onFileSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "▾ src/" })).toBeInTheDocument();
    const selectedBtn = screen.getByText("Button.tsx").closest("button");
    expect(selectedBtn).toHaveClass("text-blue-700");
    const otherBtn = screen.getByText("index.ts").closest("button");
    expect(otherBtn).not.toHaveClass("text-blue-700");
  });

  it("collapses and expands directory on click", async () => {
    const user = userEvent.setup();
    render(
      <FileTree paths={paths} selectedFile={null} onFileSelect={() => {}} />,
    );
    expect(screen.queryByText("Button.tsx")).not.toBeInTheDocument();

    await expandSrcDir(user);
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "▾ src/" }));
    expect(screen.queryByText("Button.tsx")).not.toBeInTheDocument();
  });

  it("renders root-level file without directory wrapper", () => {
    render(
      <FileTree
        paths={["README.md"]}
        selectedFile={null}
        onFileSelect={() => {}}
      />,
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // Only one button: the file itself, no directory button
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("sorts directories before files at the same level", () => {
    render(
      <FileTree
        paths={["utils.ts", "src/index.ts"]}
        selectedFile={null}
        onFileSelect={() => {}}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const dirBtnIdx = buttons.findIndex((b) => b.textContent?.includes("src"));
    const fileBtnIdx = buttons.findIndex((b) => b.textContent === "utils.ts");
    expect(dirBtnIdx).toBeLessThan(fileBtnIdx);
  });

  it("renders directory name as a folder button", () => {
    render(
      <FileTree paths={paths} selectedFile={null} onFileSelect={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "▸ src/" })).toBeInTheDocument();
  });

  it("applies font-semibold to analyzed files", async () => {
    const user = userEvent.setup();
    const analyzedPaths = new Set(["src/Button.tsx"]);
    render(
      <FileTree
        paths={paths}
        analyzedPaths={analyzedPaths}
        selectedFile={null}
        onFileSelect={() => {}}
      />,
    );
    await expandSrcDir(user);
    const analyzedBtn = screen.getByText("Button.tsx").closest("button");
    expect(analyzedBtn).toHaveClass("font-semibold");
  });

  it("does not apply font-semibold to non-analyzed files", async () => {
    const user = userEvent.setup();
    const analyzedPaths = new Set(["src/Button.tsx"]);
    render(
      <FileTree
        paths={paths}
        analyzedPaths={analyzedPaths}
        selectedFile={null}
        onFileSelect={() => {}}
      />,
    );
    await expandSrcDir(user);
    const otherBtn = screen.getByText("index.ts").closest("button");
    expect(otherBtn).not.toHaveClass("font-semibold");
  });
});
