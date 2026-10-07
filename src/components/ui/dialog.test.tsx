// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

function setup(dismissOnBackdrop?: boolean) {
  const onClose = vi.fn();
  render(
    <Dialog isOpen onClose={onClose} title="Details" dismissOnBackdrop={dismissOnBackdrop}>
      <p>Body</p>
    </Dialog>
  );
  const backdrop = screen.getByText("Body").parentElement!.parentElement!;
  return { onClose, backdrop };
}

afterEach(cleanup);

describe("Dialog backdrop dismissal", () => {
  it("closes when the backdrop is clicked and dismissal is enabled", () => {
    const { onClose, backdrop } = setup(true);
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when the content is clicked", () => {
    const { onClose } = setup(true);
    fireEvent.mouseDown(screen.getByText("Body"));
    fireEvent.click(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when a press starts inside and is released on the backdrop", () => {
    const { onClose, backdrop } = setup(true);
    fireEvent.mouseDown(screen.getByText("Body"));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores backdrop clicks by default", () => {
    const { onClose, backdrop } = setup();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
