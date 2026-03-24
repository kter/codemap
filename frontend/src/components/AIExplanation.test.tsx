import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIExplanation } from "./AIExplanation";
import { FileExplanation } from "@/types/analysis";

const structuredExplanation: FileExplanation = {
  path: "src/Button.tsx",
  kind: "structured",
  overview: "Renders a button component and wires its click handler.",
  interfaces: [
    {
      name: "ButtonProps",
      line: 3,
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
};

const summaryExplanation: FileExplanation = {
  path: "README.md",
  kind: "summary",
  overview: "Describes the project and how to get started.",
  interfaces: [],
  happy_paths: [],
};

describe("AIExplanation", () => {
  it("shows placeholder when no file is selected", () => {
    render(
      <AIExplanation
        selectedPath={null}
        explanation={null}
        status="idle"
        onNavigate={() => {}}
      />,
    );
    expect(
      screen.getByText(/select a file to see ai explanations/i),
    ).toBeInTheDocument();
  });

  it("shows loading state while explanation is pending", () => {
    render(
      <AIExplanation
        selectedPath="src/Button.tsx"
        explanation={null}
        status="loading"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText(/generating ai explanation/i)).toBeInTheDocument();
  });

  it("shows error state when explanation fetch fails", () => {
    render(
      <AIExplanation
        selectedPath="src/Button.tsx"
        explanation={null}
        status="error"
        errorMessage="AI is unavailable"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText("AI is unavailable")).toBeInTheDocument();
  });

  it("renders overview text", () => {
    render(
      <AIExplanation
        selectedPath={structuredExplanation.path}
        explanation={structuredExplanation}
        status="ready"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText(/overview/i)).toBeInTheDocument();
    expect(
      screen.getByText("Renders a button component and wires its click handler."),
    ).toBeInTheDocument();
  });

  it("renders interface names and line numbers", () => {
    render(
      <AIExplanation
        selectedPath={structuredExplanation.path}
        explanation={structuredExplanation}
        status="ready"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText("ButtonProps")).toBeInTheDocument();
    expect(screen.getByText(/L3/)).toBeInTheDocument();
  });

  it("renders function names and line numbers", () => {
    render(
      <AIExplanation
        selectedPath={structuredExplanation.path}
        explanation={structuredExplanation}
        status="ready"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText("handleClick")).toBeInTheDocument();
    expect(screen.getByText(/L10/)).toBeInTheDocument();
  });

  it("renders summary-only explanations without structured sections", () => {
    render(
      <AIExplanation
        selectedPath={summaryExplanation.path}
        explanation={summaryExplanation}
        status="ready"
        onNavigate={() => {}}
      />,
    );
    expect(
      screen.getByText("Describes the project and how to get started."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/interfaces & types/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/functions & methods/i)).not.toBeInTheDocument();
  });

  it("calls onNavigate with correct target when interface name is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    render(
      <AIExplanation
        selectedPath={structuredExplanation.path}
        explanation={structuredExplanation}
        status="ready"
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByText("ButtonProps"));
    expect(onNavigate).toHaveBeenCalledWith({
      filePath: "src/Button.tsx",
      line: 3,
    });
  });

  it("calls onNavigate with correct target when function name is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    render(
      <AIExplanation
        selectedPath={structuredExplanation.path}
        explanation={structuredExplanation}
        status="ready"
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByText("handleClick"));
    expect(onNavigate).toHaveBeenCalledWith({
      filePath: "src/Button.tsx",
      line: 10,
    });
  });
});
