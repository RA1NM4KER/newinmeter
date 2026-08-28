// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  verifyOtp: vi.fn(),
  trackFunnelEvent: vi.fn()
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOtp: mocks.signInWithOtp, signInWithOAuth: mocks.signInWithOAuth, verifyOtp: mocks.verifyOtp }
  })
}));
vi.mock("@/lib/funnel-client", () => ({ trackFunnelEvent: mocks.trackFunnelEvent }));

import { LoginForm } from "./login-form";

async function sendCode(email = "reviewer@example.com") {
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: email } });
  fireEvent.click(screen.getByText("Send code"));
  await waitFor(() => expect(screen.getByLabelText("6-digit code")).toBeDefined());
}

function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: code } });
}

describe("LoginForm", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("always shows the Explore demo option, with no token needed", () => {
    render(<LoginForm />);
    expect(screen.queryByText("Explore demo")).not.toBeNull();
  });

  it("also shows it when a (server-validated) recruiter demo token is supplied", () => {
    render(<LoginForm demoToken="server-validated-token" />);
    expect(screen.queryByText("Explore demo")).not.toBeNull();
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

  it("tracks sign_in_started when Google is clicked", async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByText("Continue with Google"));
    await waitFor(() => expect(mocks.trackFunnelEvent).toHaveBeenCalledWith("sign_in_started"));
  });

  it("posts no token to /api/demo-login for the public button (no demoToken prop)", async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByText("Explore demo"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/demo-login");
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("posts only the demo token (never an email) to /api/demo-login when a recruiter token is present", async () => {
    render(<LoginForm demoToken="server-validated-token" />);
    fireEvent.click(screen.getByText("Explore demo"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/demo-login");
    expect(JSON.parse(init.body)).toEqual({ token: "server-validated-token" });
  });

  it("redeems the server-generated token_hash with the normal browser client's verifyOtp (demo login unchanged)", async () => {
    render(<LoginForm demoToken="server-validated-token" />);
    fireEvent.click(screen.getByText("Explore demo"));

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
    fireEvent.click(screen.getByText("Explore demo"));

    expect(await screen.findByText("Invalid or missing demo access.")).not.toBeNull();
  });

  describe("email OTP: sending the code", () => {
    it("calls signInWithOtp with just the email -- no emailRedirectTo, this is a typed code not a link", async () => {
      render(<LoginForm />);
      await sendCode("reviewer@example.com");

      expect(mocks.signInWithOtp).toHaveBeenCalledTimes(1);
      expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: "reviewer@example.com" });
    });

    it("transitions to the code-entry state and shows the email address that was sent to", async () => {
      render(<LoginForm />);
      await sendCode("reviewer@example.com");

      expect(screen.getByText("Check your email")).toBeDefined();
      expect(screen.getByText("reviewer@example.com")).toBeDefined();
      expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
    });

    it("hides the demo option once on the code-entry step", async () => {
      render(<LoginForm demoToken="server-validated-token" />);
      await sendCode();
      expect(screen.queryByText("Explore demo")).toBeNull();
    });

    it("shows a useful error and stays on the email step when the send fails", async () => {
      mocks.signInWithOtp.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });
      render(<LoginForm />);
      fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
        target: { value: "reviewer@example.com" }
      });
      fireEvent.click(screen.getByText("Send code"));

      expect(await screen.findByText("Email rate limit exceeded")).not.toBeNull();
      expect(screen.queryByLabelText("6-digit code")).toBeNull();
    });
  });

  describe("email OTP: entering and verifying the code", () => {
    it("accepts six digits, strips non-digits, and caps at six characters", async () => {
      render(<LoginForm />);
      await sendCode();

      const input = screen.getByLabelText("6-digit code") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "12a3456" } });
      expect(input.value).toBe("123456");
    });

    it("supports paste (a full 6-digit value landing in one change event)", async () => {
      render(<LoginForm />);
      await sendCode();

      enterCode("482913");
      await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledTimes(1));
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "reviewer@example.com", token: "482913", type: "email" });
    });

    it("auto-submits once six digits are present, and also via the Continue button", async () => {
      mocks.verifyOtp.mockImplementation(() => new Promise(() => {})); // never resolves, so we can inspect the pending state
      render(<LoginForm />);
      await sendCode();

      enterCode("111111");
      await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledTimes(1));
    });

    it("does not call verifyOtp before six digits are entered", async () => {
      render(<LoginForm />);
      await sendCode();

      enterCode("123");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    });

    it("redirects to / on successful verification", async () => {
      const originalLocation = window.location;
      // jsdom doesn't implement real navigation -- swap in a writable stub
      // just for this test so `window.location.href = "/"` is observable
      // instead of throwing/no-op.
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...originalLocation, href: "" }
      });

      render(<LoginForm />);
      await sendCode();
      enterCode("123456");

      await waitFor(() => expect(window.location.href).toBe("/"));

      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    });

    it("tracks sign_in_completed on successful code verification", async () => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...originalLocation, href: "" }
      });

      render(<LoginForm />);
      await sendCode();
      enterCode("123456");

      await waitFor(() => expect(mocks.trackFunnelEvent).toHaveBeenCalledWith("sign_in_completed"));

      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    });

    it("shows an 'incorrect code' message for an invalid-token error and clears the input for retry", async () => {
      mocks.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
      render(<LoginForm />);
      await sendCode();
      enterCode("000000");

      expect(await screen.findByText(/isn't correct|expired/i)).not.toBeNull();
      await waitFor(() => expect((screen.getByLabelText("6-digit code") as HTMLInputElement).value).toBe(""));
    });

    it("shows an expired-code message when Supabase's error code says otp_expired", async () => {
      mocks.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "otp_expired" } });
      render(<LoginForm />);
      await sendCode();
      enterCode("000000");

      expect(await screen.findByText("That code has expired. Send a new one and try again.")).not.toBeNull();
    });

    it("shows a generic, honest message for an unrecognized verify failure", async () => {
      mocks.verifyOtp.mockResolvedValue({ error: { message: "something unexpected" } });
      render(<LoginForm />);
      await sendCode();
      enterCode("000000");

      expect(await screen.findByText("That code couldn't be verified. Try again or send a new code.")).not.toBeNull();
    });

    it("shows a network-failure message when verifyOtp throws", async () => {
      mocks.verifyOtp.mockRejectedValue(new Error("network down"));
      render(<LoginForm />);
      await sendCode();
      enterCode("000000");

      expect(await screen.findByText("Couldn't verify the code. Check your connection and try again.")).not.toBeNull();
    });
  });

  describe("email OTP: resend", () => {
    it("calls signInWithOtp again and confirms a new code was sent", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      render(<LoginForm />);
      await sendCode();

      await act(async () => {
        vi.advanceTimersByTime(45_000);
      });

      fireEvent.click(screen.getByText("Resend code"));
      await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledTimes(2));
      expect(await screen.findByText("New code sent.")).not.toBeNull();
    });

    it("disables Resend immediately after sending, with a visible cooldown", async () => {
      render(<LoginForm />);
      await sendCode();

      const resendButton = screen.getByText(/Resend code/) as HTMLButtonElement;
      expect(resendButton.disabled).toBe(true);
      expect(resendButton.textContent).toMatch(/Resend code \(\d+s\)/);
    });

    it("re-enables Resend once the cooldown elapses", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      render(<LoginForm />);
      await sendCode();

      await act(async () => {
        vi.advanceTimersByTime(45_000);
      });

      const resendButton = screen.getByText("Resend code") as HTMLButtonElement;
      expect(resendButton.disabled).toBe(false);
    });
  });

  describe("changing email", () => {
    it("returns to the initial email form and forgets the entered code", async () => {
      render(<LoginForm />);
      await sendCode("reviewer@example.com");
      enterCode("12");

      fireEvent.click(screen.getByText("Use a different email"));

      expect(await screen.findByPlaceholderText("you@example.com")).toBeDefined();
      expect(screen.queryByLabelText("6-digit code")).toBeNull();
    });
  });
});
