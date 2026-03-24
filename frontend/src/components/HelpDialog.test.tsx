import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpDialog } from "./HelpDialog";

describe("HelpDialog", () => {
  it("does not render when closed", () => {
    render(<HelpDialog open={false} onClose={jest.fn()} />);
    expect(screen.queryByText("利用ガイド")).not.toBeInTheDocument();
  });

  it("calls onClose when overlay is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<HelpDialog open={true} onClose={onClose} />);

    await user.click(screen.getByText("利用ガイド").closest(".fixed")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when dialog content is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<HelpDialog open={true} onClose={onClose} />);

    await user.click(screen.getByText("基本的な使い方"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<HelpDialog open={true} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
