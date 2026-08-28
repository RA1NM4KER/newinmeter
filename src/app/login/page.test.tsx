// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordFunnelEvent: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  redirect: vi.fn()
}));
vi.mock("@/lib/funnel", () => ({ recordFunnelEvent: mocks.recordFunnelEvent }));
vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
// Mirrors next/navigation's real redirect() behavior: it throws to halt the
// render, which is how the App Router actually stops the rest of the
// component from running (and how tests below assert it was reached).
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  }
}));

import LoginPage from "./page";

const ENV_KEY = "NEWINMETER_DEMO_ACCESS_TOKEN";

// LoginPage is an async Server Component -- calling it directly and
// awaiting the result (rather than passing the function to React's render)
// is the standard way to exercise an App Router page/layout function in a
// unit test.
async function renderLoginPage(searchParams: { demo?: string } = {}) {
  render(await LoginPage({ searchParams }));
}

describe("LoginPage", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[ENV_KEY] = "correct-token";
    mocks.getAuthenticatedSession.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  // Previously middleware's job -- now the page's own first check, before
  // anything else runs, so a signed-in visitor never sees a flash of the
  // login form (see src/middleware.ts, which no longer makes this call).
  describe("already-authenticated visitors", () => {
    it("redirects to / before rendering anything, without touching the demo token or funnel tracking", async () => {
      mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });

      await expect(LoginPage({ searchParams: {} })).rejects.toThrow("NEXT_REDIRECT:/");

      expect(mocks.redirect).toHaveBeenCalledWith("/");
      expect(mocks.recordFunnelEvent).not.toHaveBeenCalled();
    });
  });

  it("always shows the Explore demo option, token or not -- it's the public entry point now", async () => {
    await renderLoginPage({});
    expect(screen.queryByText("Explore demo")).not.toBeNull();
  });

  it("still shows the demo option for a server-validated recruiter token", async () => {
    await renderLoginPage({ demo: "correct-token" });
    expect(screen.queryByText("Explore demo")).not.toBeNull();
  });

  it("presents a calm hero with sign-in reachable, and one interactive teaser -- not a full marketing site", async () => {
    await renderLoginPage();

    expect(screen.getByRole("heading", { level: 1, name: /your electricity.*finally explained/i })).toBeDefined();
    expect(screen.getByLabelText("Sign in to NewinMeter")).toBeDefined();
    expect(screen.getByRole("region", { name: "Illustrative NewinMeter playground" })).toBeDefined();
  });

  it("does not render the extra marketing playgrounds that used to follow the hero", async () => {
    await renderLoginPage();

    expect(screen.queryByRole("heading", { name: "Every day has a shape." })).toBeNull();
    expect(screen.queryByRole("heading", { name: /You noticed the spike.*Now add context/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /You don’t need to keep checking/i })).toBeNull();
  });

  it("records a login_page_viewed funnel event once rendered for a genuinely unauthenticated visitor", async () => {
    await renderLoginPage();
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("login_page_viewed");
  });

  it("keeps sign-in available in a sticky bar and enables scoped smooth scrolling", async () => {
    await renderLoginPage();

    expect(screen.getByRole("banner").className).toContain("sticky");
    expect(document.documentElement.classList.contains("public-smooth-scroll")).toBe(true);
  });

  it("keeps the standalone energy teaser interactive", async () => {
    await renderLoginPage();

    fireEvent.click(screen.getByRole("button", { name: "Evening spike" }));
    expect(screen.getByText(/period labelled Cooking/i)).toBeDefined();
  });
});
