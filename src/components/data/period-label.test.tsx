// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PeriodLabel } from "./period-label";

describe("ledger consumption period label", () => {
  afterEach(cleanup);
  it("renders a compact interval with a discoverable year and timezone", () => {
    render(<PeriodLabel row={{ chargeKind: "energy", periodDateTime: "2026-10-13T12:30" }} />);
    const label = screen.getByText("13 Oct · 12:30–13:00");
    expect(label.getAttribute("title")).toBe("13 Oct 2026 12:30–13:00 SAST");
    expect(label.getAttribute("aria-label")).toBe(label.getAttribute("title"));
  });
  it("shows the next date when a water interval crosses midnight", () => {
    render(<PeriodLabel row={{ chargeKind: "water", periodDateTime: "2026-12-31T23:30" }} />);
    expect(screen.getByText("31 Dec · 23:30–1 Jan 00:00").getAttribute("title")).toContain("2027");
  });
  it("keeps topups as instants", () => {
    render(<PeriodLabel row={{ chargeKind: "topup", periodDateTime: "2026-10-13T12:30" }} />);
    expect(screen.getByText("13 Oct · 12:30")).toBeTruthy();
  });
});
