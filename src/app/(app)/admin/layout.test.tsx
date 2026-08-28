// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  notFound: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/components/admin/admin-section-tabs", () => ({
  AdminSectionTabs: () => <div data-testid="admin-tabs" />
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error("NEXT_NOT_FOUND");
  }
}));

import AdminLayout from "./layout";

describe("(app)/admin/layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // notFound(), not a redirect to /login -- an authenticated non-admin
  // should not be told an admin section exists at all.
  it("renders a 404, not the admin UI, for a non-admin session", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status: 403 });

    await expect(AdminLayout({ children: <div /> })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("renders a 404 for an unauthenticated request too", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status: 401 });

    await expect(AdminLayout({ children: <div /> })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the admin shell and children for an actual admin session", async () => {
    mocks.requireAdminSession.mockResolvedValue({
      ok: true,
      session: { userId: "admin-1", email: "admin@example.com", accessToken: "t", permissions: { role: "admin" } }
    });

    const ui = await AdminLayout({ children: <div data-testid="admin-page-content" /> });
    render(ui);

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByTestId("admin-tabs")).toBeDefined();
    expect(screen.getByTestId("admin-page-content")).toBeDefined();
  });
});
