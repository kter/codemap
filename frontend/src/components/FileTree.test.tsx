import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "./FileTree";
import { FileResult } from "@/types/analysis";

const files: FileResult[] = [
  {
    path: "src/Button.tsx",
    source_code: "",
    interfaces: [],
    happy_paths: [],
  },
  {
    path: "src/index.ts",
    source_code: "",
    interfaces: [],
    happy_paths: [],
  },
];

describe("FileTree", () => {
  it("renders all file paths", () => {
    render(
      <FileTree files={files} selectedFile={null} onFileSelect={() => {}} />,
    );
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("renders empty list without crashing", () => {
    render(<FileTree files={[]} selectedFile={null} onFileSelect={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onFileSelect with the file path when a file is clicked", async () => {
    const user = userEvent.setup();
    const onFileSelect = jest.fn();
    render(
      <FileTree
        files={files}
        selectedFile={null}
        onFileSelect={onFileSelect}
      />,
    );
    await user.click(screen.getByText("Button.tsx"));
    expect(onFileSelect).toHaveBeenCalledWith("src/Button.tsx");
    expect(onFileSelect).toHaveBeenCalledTimes(1);
  });

  it("applies selected styles to the currently selected file", () => {
    render(
      <FileTree
        files={files}
        selectedFile="src/Button.tsx"
        onFileSelect={() => {}}
      />,
    );
    const selectedBtn = screen.getByText("Button.tsx").closest("button");
    expect(selectedBtn).toHaveClass("text-blue-700");
    const otherBtn = screen.getByText("index.ts").closest("button");
    expect(otherBtn).not.toHaveClass("text-blue-700");
  });

  it("collapses and expands directory on click", async () => {
    const user = userEvent.setup();
    render(
      <FileTree files={files} selectedFile={null} onFileSelect={() => {}} />,
    );
    // Initially expanded
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();

    // Collapse by clicking the dir button
    await user.click(screen.getByText("▾ src/"));
    expect(screen.queryByText("Button.tsx")).not.toBeInTheDocument();

    // Expand again
    await user.click(screen.getByText("▸ src/"));
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
  });

  it("renders root-level file without directory wrapper", () => {
    const rootFiles: FileResult[] = [
      {
        path: "README.md",
        source_code: "",
        interfaces: [],
        happy_paths: [],
      },
    ];
    render(
      <FileTree
        files={rootFiles}
        selectedFile={null}
        onFileSelect={() => {}}
      />,
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // Only one button: the file itself, no directory button
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("sorts directories before files at the same level", () => {
    const mixed: FileResult[] = [
      { path: "utils.ts", source_code: "", interfaces: [], happy_paths: [] },
      {
        path: "src/index.ts",
        source_code: "",
        interfaces: [],
        happy_paths: [],
      },
    ];
    render(
      <FileTree files={mixed} selectedFile={null} onFileSelect={() => {}} />,
    );
    const buttons = screen.getAllByRole("button");
    const dirBtnIdx = buttons.findIndex((b) => b.textContent?.includes("src"));
    const fileBtnIdx = buttons.findIndex((b) => b.textContent === "utils.ts");
    expect(dirBtnIdx).toBeLessThan(fileBtnIdx);
  });

  it("renders directory name as a folder button", () => {
    render(
      <FileTree files={files} selectedFile={null} onFileSelect={() => {}} />,
    );
    expect(screen.getByText("▾ src/")).toBeInTheDocument();
  });
});
