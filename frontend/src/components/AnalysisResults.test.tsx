import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisResults } from "./AnalysisResults";

describe("AnalysisResults", () => {
  it("shows neutral empty-state copy", () => {
    render(
      <AnalysisResults
        data={{ owner: "acme", repo: "demo", git_ref: "main", files: [] }}
        onFileSelect={() => {}}
      />,
    );

    expect(
      screen.getByText(/no supported source files found/i),
    ).toBeInTheDocument();
  });

  it("renders functions and methods heading", () => {
    render(
      <AnalysisResults
        data={{
          owner: "acme",
          repo: "demo",
          git_ref: "main",
          files: [
            {
              path: "src/main.py",
              source_code: "",
              interfaces: [],
              happy_paths: [{ name: "run", line: 1, summary: "Runs the app" }],
            },
          ],
        }}
        onFileSelect={() => {}}
      />,
    );

    expect(screen.getByText(/functions & methods/i)).toBeInTheDocument();
  });

  it("calls onFileSelect when a file is clicked", async () => {
    const user = userEvent.setup();
    const onFileSelect = jest.fn();

    render(
      <AnalysisResults
        data={{
          owner: "acme",
          repo: "demo",
          git_ref: "main",
          files: [
            {
              path: "src/main.py",
              source_code: "",
              interfaces: [],
              happy_paths: [],
            },
          ],
        }}
        onFileSelect={onFileSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "src/main.py" }));
    expect(onFileSelect).toHaveBeenCalledWith("src/main.py");
  });
});
