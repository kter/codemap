import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeTourInput } from "./CodeTourInput";

describe("CodeTourInput", () => {
  it("renders Tour button initially", () => {
    render(<CodeTourInput onSubmit={jest.fn()} loading={false} />);
    expect(screen.getByText("Tour")).toBeInTheDocument();
  });

  it("expands to input on Tour button click", async () => {
    render(<CodeTourInput onSubmit={jest.fn()} loading={false} />);
    await userEvent.click(screen.getByText("Tour"));
    expect(
      screen.getByPlaceholderText("e.g. Explain the auth flow"),
    ).toBeInTheDocument();
    expect(screen.getByText("Go")).toBeInTheDocument();
  });

  it("calls onSubmit with query text", async () => {
    const onSubmit = jest.fn();
    render(<CodeTourInput onSubmit={onSubmit} loading={false} />);
    await userEvent.click(screen.getByText("Tour"));
    await userEvent.type(
      screen.getByPlaceholderText("e.g. Explain the auth flow"),
      "explain auth flow",
    );
    await userEvent.click(screen.getByText("Go"));
    expect(onSubmit).toHaveBeenCalledWith("explain auth flow");
  });

  it("does not submit empty query", async () => {
    const onSubmit = jest.fn();
    render(<CodeTourInput onSubmit={onSubmit} loading={false} />);
    await userEvent.click(screen.getByText("Tour"));
    await userEvent.click(screen.getByText("Go"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows spinner when loading", async () => {
    render(<CodeTourInput onSubmit={jest.fn()} loading={true} />);
    await userEvent.click(screen.getByText("Tour"));
    // The Go button should be replaced by a spinner SVG
    expect(screen.queryByText("Go")).not.toBeInTheDocument();
  });

  it("collapses on x button click", async () => {
    render(<CodeTourInput onSubmit={jest.fn()} loading={false} />);
    await userEvent.click(screen.getByText("Tour"));
    expect(
      screen.getByPlaceholderText("e.g. Explain the auth flow"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("x"));
    expect(screen.getByText("Tour")).toBeInTheDocument();
  });

  it("disables Tour button when disabled prop is true", () => {
    render(
      <CodeTourInput onSubmit={jest.fn()} loading={false} disabled={true} />,
    );
    expect(screen.getByText("Tour")).toBeDisabled();
  });
});
