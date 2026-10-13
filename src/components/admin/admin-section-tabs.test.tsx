// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDiagnosticsHealthProvider, PublishAdminDiagnosticsHealth } from "./admin-diagnostics-health";
import { AdminSectionTabs } from "./admin-section-tabs";

describe("AdminSectionTabs", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    mocks.pathname = "/admin/features";
  });

  it("derives the active tab from the shared child route", () => {
    render(<AdminSectionTabs />);

    expect(screen.getByRole("tab", { name: "Features" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Users" }).getAttribute("aria-selected")).toBe("false");
    expect(mocks.prefetch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("retains and updates published health, then retains and refreshes it without prefetching", () => {
    const client = new QueryClient();
    function Shell({ health }: { health?: "healthy" | "critical" }) {
      return (
        <QueryClientProvider client={client}>
          <AdminDiagnosticsHealthProvider>
            <AdminSectionTabs />
            {health ? <PublishAdminDiagnosticsHealth health={health} /> : null}
          </AdminDiagnosticsHealthProvider>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(<Shell />);
    const tab = screen.getByRole("tab", { name: "Diagnostics" });
    expect(tab.querySelector("span")?.className).toContain("bg-muted/50");
    rerender(<Shell health="healthy" />);
    expect(tab.querySelector("span")?.className).toContain("bg-accent");
    rerender(<Shell />);
    expect(tab.querySelector("span")?.className).toContain("bg-accent");
    rerender(<Shell health="critical" />);
    expect(tab.querySelector("span")?.className).toContain("bg-red-500");
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it("checks only the small health endpoint without blocking Users", async () => {
    mocks.pathname = "/admin";
    let complete!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal("fetch", fetch);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminDiagnosticsHealthProvider>
          <AdminSectionTabs />
          <p>Users ready</p>
        </AdminDiagnosticsHealthProvider>
      </QueryClientProvider>
    );
    expect(screen.getByText("Users ready")).toBeTruthy();
    const dot = screen.getByRole("tab", { name: "Diagnostics" }).querySelector("span")!;
    expect(dot.className).toContain("bg-muted/50");
    expect(fetch).toHaveBeenCalledWith("/api/admin/diagnostics?section=health", { cache: "no-store" });
    complete(new Response(JSON.stringify({ health: "warning", checkedAt: new Date().toISOString() }), { status: 200 }));
    await waitFor(() => expect(dot.className).toContain("bg-amber-500"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });
  it("keeps health neutral when the small check fails", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminDiagnosticsHealthProvider>
          <AdminSectionTabs />
        </AdminDiagnosticsHealthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("tab", { name: "Diagnostics" }).querySelector("span")?.className).toContain("bg-muted/50");
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
