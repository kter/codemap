import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "./FileTree";
import { FileResult } from "@/types/analysis";

const files: FileResult[] = [
  {
    path: "src/Button.tsx",
    interfaces: [],
    happy_paths: [],
  },
  {
    path: "src/index.ts",
    interfaces: [],
    happy_paths: [],
  },
];

describe("FileTree", () => {
  it("renders all file paths", () => {
    render(
      <FileTree files={files} selectedFile={null} onFileSelect={() => {}} />,
    );
    expect(screen.getByText("src/Button.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
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
    await user.click(screen.getByText("src/Button.tsx"));
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
    const selectedBtn = screen.getByText("src/Button.tsx").closest("button");
    expect(selectedBtn).toHaveClass("text-blue-700");
    const otherBtn = screen.getByText("src/index.ts").closest("button");
    expect(otherBtn).not.toHaveClass("text-blue-700");
  });
});
