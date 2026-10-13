// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InactiveFor, inactivityDuration } from "./inactive-for";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows elapsed inactivity with the actual activity time discoverable", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T12:00:00Z"));
  render(<InactiveFor user={{ role: "user", lastActiveAt: "2026-09-16T12:00:00Z", inactivitySource: "foreground" }} />);
  expect(screen.getByText("27 days").getAttribute("title")).toBe("Last foreground activity: 16 Sept 2026, 14:00 SAST");
});
it("distinguishes fallback information and unknown activity", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T12:00:00Z"));
  const { rerender } = render(
    <InactiveFor user={{ role: "user", lastActiveAt: "2026-10-13T10:00:00Z", inactivitySource: "sign_in" }} />
  );
  expect(screen.getByText("2 hours").getAttribute("title")).toContain("Fallback: last sign-in");
  rerender(<InactiveFor user={{ role: "user", lastActiveAt: null, inactivitySource: null }} />);
  expect(screen.getByText("Unknown")).toBeTruthy();
});
it("handles recent activity and clock skew without negative durations", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  expect(inactivityDuration("2026-10-13T11:59:00Z", now)).toBe("1 minute");
  expect(inactivityDuration("2026-10-13T12:01:00Z", now)).toBe("Less than a minute");
});

it("does not present an admin sign-in timestamp as inactivity", () => {
  render(<InactiveFor user={{ role: "admin", lastActiveAt: "2026-10-13T10:00:00Z", inactivitySource: "sign_in" }} />);
  expect(screen.getByText("Not tracked · admin").getAttribute("title")).toBeNull();
  expect(screen.queryByText(/hours/)).toBeNull();
});
