// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TopBar } from "./top-bar";

describe("TopBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the logo linking home, with no right-side element by default", () => {
    const { container } = render(<TopBar />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/");
    expect(link.textContent).toBe("NewinMeter");

    const header = container.querySelector("header");
    expect(header?.className).toContain("h-14");
    expect(header?.className).toContain("px-4");
    expect(header?.className).toContain("border-b");
    expect(header?.className).toContain("bg-canvas");
  });

  it("renders an optional right-side element", () => {
    render(<TopBar right={<button type="button">Bell</button>} />);
    expect(screen.getByText("Bell")).toBeDefined();
  });

  it("applies caller-supplied positioning classes without losing the shared chrome", () => {
    const { container } = render(<TopBar className="fixed inset-x-0 top-0 z-20 lg:hidden" />);
    const header = container.querySelector("header");
    expect(header?.className).toContain("fixed");
    expect(header?.className).toContain("lg:hidden");
    expect(header?.className).toContain("h-14");
  });

  it("translates off-screen when hidden is true, and stays in place when false", () => {
    const { container: hiddenContainer } = render(<TopBar hidden />);
    expect(hiddenContainer.querySelector("header")?.className).toContain("-translate-y-full");

    cleanup();

    const { container: visibleContainer } = render(<TopBar hidden={false} />);
    expect(visibleContainer.querySelector("header")?.className).toContain("translate-y-0");
    expect(visibleContainer.querySelector("header")?.className).not.toContain("-translate-y-full");
  });
});
