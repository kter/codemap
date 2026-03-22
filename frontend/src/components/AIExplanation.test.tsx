import { render, screen } from "@testing-library/react";
import { AIExplanation } from "./AIExplanation";
import { FileResult } from "@/types/analysis";

const fileWithContent: FileResult = {
  path: "src/Button.tsx",
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
  interfaces: [],
  happy_paths: [],
};

describe("AIExplanation", () => {
  it("shows placeholder when file is null", () => {
    render(<AIExplanation file={null} />);
    expect(
      screen.getByText(/select a file to see ai explanations/i),
    ).toBeInTheDocument();
  });

  it("shows placeholder when file has no interfaces or happy_paths", () => {
    render(<AIExplanation file={fileWithNoSymbols} />);
    expect(
      screen.getByText(/no symbols found in this file/i),
    ).toBeInTheDocument();
  });

  it("renders interface names and line numbers", () => {
    render(<AIExplanation file={fileWithContent} />);
    expect(screen.getByText("ButtonProps")).toBeInTheDocument();
    expect(screen.getByText(/L3/)).toBeInTheDocument();
  });

  it("renders interface descriptions", () => {
    render(<AIExplanation file={fileWithContent} />);
    expect(
      screen.getByText("Props for the Button component"),
    ).toBeInTheDocument();
  });

  it("renders happy_path names and line numbers", () => {
    render(<AIExplanation file={fileWithContent} />);
    expect(screen.getByText("handleClick")).toBeInTheDocument();
    expect(screen.getByText(/L10/)).toBeInTheDocument();
  });

  it("renders happy_path summaries", () => {
    render(<AIExplanation file={fileWithContent} />);
    expect(screen.getByText("Handles button click events")).toBeInTheDocument();
  });

  it("renders 'Interfaces & Types' section heading", () => {
    render(<AIExplanation file={fileWithContent} />);
    expect(screen.getByText(/interfaces & types/i)).toBeInTheDocument();
  });

  it("renders 'Exported Functions' section heading", () => {
    render(<AIExplanation file={fileWithContent} />);
    expect(screen.getByText(/exported functions/i)).toBeInTheDocument();
  });

  it("does not render interfaces section when there are none", () => {
    const fileOnlyFns: FileResult = {
      path: "src/fns.ts",
      interfaces: [],
      happy_paths: [{ name: "init", line: 1, summary: "Init" }],
    };
    render(<AIExplanation file={fileOnlyFns} />);
    expect(screen.queryByText(/interfaces & types/i)).not.toBeInTheDocument();
    expect(screen.getByText(/exported functions/i)).toBeInTheDocument();
  });

  it("does not render functions section when there are none", () => {
    const fileOnlyIfaces: FileResult = {
      path: "src/types.ts",
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
    render(<AIExplanation file={fileOnlyIfaces} />);
    expect(screen.getByText(/interfaces & types/i)).toBeInTheDocument();
    expect(screen.queryByText(/exported functions/i)).not.toBeInTheDocument();
  });
});
