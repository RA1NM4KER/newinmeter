// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  verifyOtp: vi.fn()
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOtp: mocks.signInWithOtp, signInWithOAuth: mocks.signInWithOAuth, verifyOtp: mocks.verifyOtp }
  })
}));

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tokenHash: "hashed-token-abc" })
      })
    );
  });

  it("does not show the demo option when no demo token is supplied", () => {
    render(<LoginForm />);
    expect(screen.queryByText("Explore demo account")).toBeNull();
  });

  it("shows the demo option only when a (server-validated) demo token is supplied", () => {
    render(<LoginForm demoToken="server-validated-token" />);
    expect(screen.queryByText("Explore demo account")).not.toBeNull();
    expect(screen.queryByText("View NewinMeter with synthetic data")).not.toBeNull();
  });

  it("keeps Google OAuth sign-in unchanged", async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByText("Continue with Google"));

    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: expect.stringContaining("/auth/callback") }
    });
  });

  it("keeps email magic-link (OTP) sign-in unchanged", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "reviewer@example.com" } });
    fireEvent.click(screen.getByText("Send sign-in link"));

    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledTimes(1));
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "reviewer@example.com",
      options: { emailRedirectTo: expect.stringContaining("/auth/callback") }
    });
    expect(await screen.findByText(/Sent to/)).not.toBeNull();
  });

  it("posts only the demo token (never an email) to /api/demo-login when clicked", async () => {
    render(<LoginForm demoToken="server-validated-token" />);
    fireEvent.click(screen.getByText("Explore demo account"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/demo-login");
    expect(JSON.parse(init.body)).toEqual({ token: "server-validated-token" });
  });

  it("redeems the server-generated token_hash with the normal browser client's verifyOtp", async () => {
    render(<LoginForm demoToken="server-validated-token" />);
    fireEvent.click(screen.getByText("Explore demo account"));

    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledTimes(1));
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token-abc", type: "magiclink" });
  });

  it("shows an inline error and never crashes if the demo endpoint denies the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "Invalid or missing demo access." })
      })
    );
    render(<LoginForm demoToken="server-validated-token" />);
    fireEvent.click(screen.getByText("Explore demo account"));

    expect(await screen.findByText("Invalid or missing demo access.")).not.toBeNull();
  });
});
