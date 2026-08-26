// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/admin/features",
  push: vi.fn(),
  prefetch: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, prefetch: mocks.prefetch })
}));

import { AdminSectionTabs } from "./admin-section-tabs";

describe("AdminSectionTabs", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/admin/features";
  });

  it("derives the active tab from the shared child route", () => {
    render(<AdminSectionTabs />);

    expect(screen.getByRole("tab", { name: "Features" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Users" }).getAttribute("aria-selected")).toBe("false");
  });

  it("moves the underline immediately and navigates without scrolling the shell", () => {
    render(<AdminSectionTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));

    expect(screen.getByRole("tab", { name: "Diagnostics" }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.push).toHaveBeenCalledWith("/admin/diagnostics", { scroll: false });
  });

  it("navigates from Diagnostics back to Users through the same shell", () => {
    mocks.pathname = "/admin/diagnostics";
    render(<AdminSectionTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    expect(screen.getByRole("tab", { name: "Users" }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.push).toHaveBeenCalledWith("/admin", { scroll: false });
  });
});
