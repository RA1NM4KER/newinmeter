import { describe, expect, it } from "vitest";
import {
  NEWINBOSCH_2026_27,
  getTariffProfile,
  isApproachingNextBand,
  resolveMonthlyBand
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
