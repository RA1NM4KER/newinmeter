import { describe, expect, it } from "vitest";
import {
  NEWINBOSCH_2026_27,
  getTariffProfile,
  isApproachingNextBand,
  resolveMonthlyBand,
  resolveTariffBand
} from "./tariff-profiles";

describe("getTariffProfile", () => {
  it("resolves a known key", () => {
    expect(getTariffProfile("newinbosch_2026_27")).toBe(NEWINBOSCH_2026_27);
  });

  it("returns null for an unknown or missing key", () => {
    expect(getTariffProfile("some_future_estate")).toBeNull();
    expect(getTariffProfile(null)).toBeNull();
    expect(getTariffProfile(undefined)).toBeNull();
  });
});

describe("resolveTariffBand", () => {
  const derived = (periodDate: string, tariff: number, tariffProfile: string | null = "newinbosch_2026_27") =>
    resolveTariffBand({ chargeLabel: "Energy Charge:", tariffProfile, periodDate, tariff });

  it.each([
    ["Energy Charge: 0 - 50", "0 - 50"],
    ["Energy Charge: 50 - 300", "50 - 300"],
    ["Energy Charge: 300 - 600", "300 - 600"],
    ["Energy Charge: 600 -", "600 -"]
  ])("preserves an explicit upstream band in %s", (chargeLabel, expected) => {
    expect(resolveTariffBand({ chargeLabel, tariffProfile: null, periodDate: "2026-01-01", tariff: 999 })).toBe(
      expected
    );
  });

  it.each([
    [1.978, "0 - 50"],
    [2.5415, "50 - 300"],
    [3.5765, "300 - 600"],
    [4.232, "600 -"]
  ])("maps August VAT-inclusive rate %s", (tariff, expected) => {
    expect(derived("2026-08-01 00:00", tariff)).toBe(expected);
  });

  it.each([
    [2.3805, "0 - 50"],
    [3.0475, "50 - 300"],
    [4.301, "300 - 600"],
    [5.06, "600 -"]
  ])("maps the verified July ledger rate %s", (tariff, expected) => {
    expect(derived("2026-07-15", tariff)).toBe(expected);
  });

  it("uses the schedule effective-date boundary", () => {
    expect(derived("2026-07-31", 2.3805)).toBe("0 - 50");
    expect(derived("2026-08-01", 2.3805)).toBeNull();
    expect(derived("2026-07-31", 1.978)).toBeNull();
    expect(derived("2026-08-01", 1.978)).toBe("0 - 50");
    expect(derived("2027-07-01", 1.978)).toBeNull();
  });

  it("allows small decimal representation differences", () => {
    expect(derived("2026-08-20", 3.57650001)).toBe("300 - 600");
  });

  it("returns null for unknown profiles, rates, and non-energy rows", () => {
    expect(derived("2026-08-20", 1.978, null)).toBeNull();
    expect(derived("2026-08-20", 9.999)).toBeNull();
    expect(
      resolveTariffBand({
        chargeLabel: "Water: 0 - 6",
        tariffProfile: "newinbosch_2026_27",
        periodDate: "2026-08-20",
        tariff: 1.978
      })
    ).toBeNull();
  });

  it("lets an explicit label win over a conflicting derived rate", () => {
    expect(
      resolveTariffBand({
        chargeLabel: "Energy Charge: 600 -",
        tariffProfile: "newinbosch_2026_27",
        periodDate: "2026-08-20",
        tariff: 1.978
      })
    ).toBe("600 -");
  });
});

describe("resolveMonthlyBand -- Newinbosch 2026/27", () => {
  it("places usage in the first band and computes its 5kWh warning distance", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 20);
    expect(position.currentBand.ratePerKwh).toBe(1.72);
    expect(position.nextThresholdKwh).toBe(50);
    expect(position.warningDistanceKwh).toBe(5);
  });

  it("places usage in the second band and caps its warning distance at 25kWh", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 282);
    expect(position.currentBand.ratePerKwh).toBe(2.21);
    expect(position.nextThresholdKwh).toBe(300);
    expect(position.warningDistanceKwh).toBe(25);
  });

  it("places usage in the third band and caps its warning distance at 25kWh", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 590);
    expect(position.currentBand.ratePerKwh).toBe(3.11);
    expect(position.nextThresholdKwh).toBe(600);
    expect(position.warningDistanceKwh).toBe(25);
  });

  it("has no next threshold once in the top (unbounded) band", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 650);
    expect(position.currentBand.ratePerKwh).toBe(3.68);
    expect(position.nextThresholdKwh).toBeNull();
    expect(position.warningDistanceKwh).toBeNull();
  });

  it("treats an exact band boundary as belonging to the higher band", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 50);
    expect(position.currentBand.ratePerKwh).toBe(2.21);
  });
});

describe("isApproachingNextBand", () => {
  it("matches the spec's own worked example: 282 kWh is approaching the 300 kWh threshold", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 282);
    expect(isApproachingNextBand(position, 282)).toBe(true);
  });

  it("is false well below the warning distance", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 100);
    expect(isApproachingNextBand(position, 100)).toBe(false);
  });

  it("is false once already in the top band", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 700);
    expect(isApproachingNextBand(position, 700)).toBe(false);
  });

  it("is false right at the boundary itself (band position has already rolled over)", () => {
    const position = resolveMonthlyBand(NEWINBOSCH_2026_27, 45);
    expect(isApproachingNextBand(position, 45)).toBe(true);
    const rolledOver = resolveMonthlyBand(NEWINBOSCH_2026_27, 50);
    expect(isApproachingNextBand(rolledOver, 50)).toBe(false);
  });
});
