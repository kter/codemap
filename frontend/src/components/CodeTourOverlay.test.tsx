import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeTourOverlay } from "./CodeTourOverlay";

describe("CodeTourOverlay", () => {
  const defaultProps = {
    title: "Auth flow",
    currentIndex: 2,
    totalStops: 8,
    explanation: "This is the login entry point.",
    onPrev: jest.fn(),
    onNext: jest.fn(),
    onClose: jest.fn(),
    hasPrev: true,
    hasNext: true,
  };

  it("renders title and progress", () => {
    render(<CodeTourOverlay {...defaultProps} />);
    expect(screen.getByText("3/8 - Auth flow")).toBeInTheDocument();
  });

  it("renders explanation text", () => {
    render(<CodeTourOverlay {...defaultProps} />);
    expect(
      screen.getByText("This is the login entry point."),
    ).toBeInTheDocument();
  });

  it("calls onNext when Next button is clicked", async () => {
    const onNext = jest.fn();
    render(<CodeTourOverlay {...defaultProps} onNext={onNext} />);
    await userEvent.click(screen.getByText("Next"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("calls onPrev when Prev button is clicked", async () => {
    const onPrev = jest.fn();
    render(<CodeTourOverlay {...defaultProps} onPrev={onPrev} />);
    await userEvent.click(screen.getByText("Prev"));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = jest.fn();
    render(<CodeTourOverlay {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close tour"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Prev when hasPrev is false", () => {
    render(<CodeTourOverlay {...defaultProps} hasPrev={false} />);
    expect(screen.getByText("Prev")).toBeDisabled();
  });

  it("disables Next when hasNext is false", () => {
    render(<CodeTourOverlay {...defaultProps} hasNext={false} />);
    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("shows first stop correctly", () => {
    render(
      <CodeTourOverlay {...defaultProps} currentIndex={0} totalStops={5} />,
    );
    expect(screen.getByText("1/5 - Auth flow")).toBeInTheDocument();
  });
});
