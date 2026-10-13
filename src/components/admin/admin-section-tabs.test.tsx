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

import { AdminDiagnosticsHealthProvider, PublishAdminDiagnosticsHealth } from "./admin-diagnostics-health";
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
    expect(mocks.prefetch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows health only after Diagnostics publishes it, then retains and refreshes it without prefetching", () => {
    function Shell({ health }: { health?: "healthy" | "critical" }) {
      return (
        <AdminDiagnosticsHealthProvider>
          <AdminSectionTabs />
          {health ? <PublishAdminDiagnosticsHealth health={health} /> : null}
        </AdminDiagnosticsHealthProvider>
      );
    }
    const { rerender } = render(<Shell />);
    const tab = screen.getByRole("tab", { name: "Diagnostics" });
    expect(tab.querySelector("span")).toBeNull();
    rerender(<Shell health="healthy" />);
    expect(tab.querySelector("span")?.className).toContain("bg-accent");
    rerender(<Shell />);
    expect(tab.querySelector("span")?.className).toContain("bg-accent");
    rerender(<Shell health="critical" />);
    expect(tab.querySelector("span")?.className).toContain("bg-red-500");
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it("moves the underline immediately and navigates without scrolling the shell", () => {
    render(<AdminSectionTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));

    expect(screen.getByRole("tab", { name: "Diagnostics" }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.push).toHaveBeenCalledWith("/admin/diagnostics", { scroll: false });
  });

  it("loads Engagement only when selected", () => {
    render(<AdminSectionTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Engagement" }));

    expect(screen.getByRole("tab", { name: "Engagement" }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.push).toHaveBeenCalledWith("/admin/engagement", { scroll: false });
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it("navigates from Diagnostics back to Users through the same shell", () => {
    mocks.pathname = "/admin/diagnostics";
    render(<AdminSectionTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    expect(screen.getByRole("tab", { name: "Users" }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.push).toHaveBeenCalledWith("/admin", { scroll: false });
  });
  it("opens System in the shared admin shell", () => {
    mocks.pathname = "/admin/system";
    render(<AdminSectionTabs />);
    expect(screen.getByRole("tab", { name: "System" }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.prefetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(mocks.push).toHaveBeenCalledWith("/admin/diagnostics", { scroll: false });
  });
});
