import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIExplanation } from "./AIExplanation";
import { FileResult } from "@/types/analysis";

const fileWithContent: FileResult = {
  path: "src/Button.tsx",
  source_code: "",
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

const fileWithNoSymbols: FileResult = {
  path: "src/empty.ts",
  source_code: "",
  interfaces: [],
  happy_paths: [],
};

describe("AIExplanation", () => {
  it("shows placeholder when file is null", () => {
    render(<AIExplanation file={null} onNavigate={() => {}} />);
    expect(
      screen.getByText(/select a file to see ai explanations/i),
    ).toBeInTheDocument();
  });

  it("shows placeholder when file has no interfaces or happy_paths", () => {
    render(<AIExplanation file={fileWithNoSymbols} onNavigate={() => {}} />);
    expect(
      screen.getByText(/no symbols found in this file/i),
    ).toBeInTheDocument();
  });

  it("renders interface names and line numbers", () => {
    render(<AIExplanation file={fileWithContent} onNavigate={() => {}} />);
    expect(screen.getByText("ButtonProps")).toBeInTheDocument();
    expect(screen.getByText(/L3/)).toBeInTheDocument();
  });

  it("renders interface descriptions", () => {
    render(<AIExplanation file={fileWithContent} onNavigate={() => {}} />);
    expect(
      screen.getByText("Props for the Button component"),
    ).toBeInTheDocument();
  });

  it("renders happy_path names and line numbers", () => {
    render(<AIExplanation file={fileWithContent} onNavigate={() => {}} />);
    expect(screen.getByText("handleClick")).toBeInTheDocument();
    expect(screen.getByText(/L10/)).toBeInTheDocument();
  });

  it("renders happy_path summaries", () => {
    render(<AIExplanation file={fileWithContent} onNavigate={() => {}} />);
    expect(screen.getByText("Handles button click events")).toBeInTheDocument();
  });

  it("renders 'Interfaces & Types' section heading", () => {
    render(<AIExplanation file={fileWithContent} onNavigate={() => {}} />);
    expect(screen.getByText(/interfaces & types/i)).toBeInTheDocument();
  });

  it("renders 'Exported Functions' section heading", () => {
    render(<AIExplanation file={fileWithContent} onNavigate={() => {}} />);
    expect(screen.getByText(/exported functions/i)).toBeInTheDocument();
  });

  it("does not render interfaces section when there are none", () => {
    const fileOnlyFns: FileResult = {
      path: "src/fns.ts",
      source_code: "",
      interfaces: [],
      happy_paths: [{ name: "init", line: 1, summary: "Init" }],
    };
    render(<AIExplanation file={fileOnlyFns} onNavigate={() => {}} />);
    expect(screen.queryByText(/interfaces & types/i)).not.toBeInTheDocument();
    expect(screen.getByText(/exported functions/i)).toBeInTheDocument();
  });

  it("does not render functions section when there are none", () => {
    const fileOnlyIfaces: FileResult = {
      path: "src/types.ts",
      source_code: "",
      interfaces: [
        {
          name: "Foo",
          line: 1,
          signature: "interface Foo {}",
          description: "",
        },
      ],
      happy_paths: [],
    };
    render(<AIExplanation file={fileOnlyIfaces} onNavigate={() => {}} />);
    expect(screen.getByText(/interfaces & types/i)).toBeInTheDocument();
    expect(screen.queryByText(/exported functions/i)).not.toBeInTheDocument();
  });

  it("calls onNavigate with correct target when interface name is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    render(<AIExplanation file={fileWithContent} onNavigate={onNavigate} />);
    await user.click(screen.getByText("ButtonProps"));
    expect(onNavigate).toHaveBeenCalledWith({
      filePath: "src/Button.tsx",
      line: 3,
    });
  });

  it("calls onNavigate with correct target when function name is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    render(<AIExplanation file={fileWithContent} onNavigate={onNavigate} />);
    await user.click(screen.getByText("handleClick"));
    expect(onNavigate).toHaveBeenCalledWith({
      filePath: "src/Button.tsx",
      line: 10,
    });
  });
});
