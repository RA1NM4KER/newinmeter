import { describe, expect, it } from "vitest";
import {
  chartDate,
  formatCurrency,
  formatCurrencyAxisTick,
  formatKl,
  formatKwh,
  formatPercent,
  formatTariff,
  formatTariffForUnit,
  formatTariffPerKl,
  formatUsage,
  longDateTime,
  shortDate
} from "@/lib/format";

// en-ZA formats numbers with a comma decimal separator and a non-breaking
// space thousands separator (e.g. "RÂ 1Â 234,50"), not the
// period/comma US convention -- assertions below check the meaningful shape
// (symbol, digits, sign) rather than pinning exact whitespace bytes, which
// makes them robust to ICU data details while still catching real
// regressions like a wrong symbol, wrong rounding, or a misplaced sign.

describe("formatCurrency", () => {
  it("formats positive ZAR amounts with the R symbol and two decimals", () => {
    const result = formatCurrency(1234.5);
    expect(result).toMatch(/^R\s*1\D*234,50$/);
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toMatch(/^R\s*0,00$/);
  });

  it("puts the minus sign before the R symbol for negative amounts", () => {
    expect(formatCurrency(-50)).toMatch(/^-R\s*50,00$/);
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(10.001)).toMatch(/^R\s*10,00$/);
    expect(formatCurrency(10.099)).toMatch(/^R\s*10,10$/);
  });
});

describe("formatCurrencyAxisTick", () => {
  it("removes floating-point noise from compact chart labels", () => {
    expect(formatCurrencyAxisTick(3.6000000000000004)).toBe("R3.6");
    expect(formatCurrencyAxisTick(0)).toBe("R0");
  });
});

describe("formatKwh / formatKl", () => {
  it("appends the unit and rounds to 2 decimals", () => {
    expect(formatKwh(12.345)).toBe("12,35 kWh");
    expect(formatKl(3)).toBe("3 kL");
  });
});

describe("formatTariff / formatTariffPerKl", () => {
  it("formats per-unit rates", () => {
    expect(formatTariff(2.6)).toBe("R2,6/kWh");
    expect(formatTariffPerKl(30)).toBe("R30/kL");
  });
});

describe("formatUsage", () => {
  it("returns a placeholder when unit is null", () => {
    expect(formatUsage(10, null)).toBe("-");
  });

  it("dispatches to kWh or kL formatting based on unit", () => {
    expect(formatUsage(10, "kWh")).toBe("10 kWh");
    expect(formatUsage(10, "kL")).toBe("10 kL");
  });
});

describe("formatTariffForUnit", () => {
  it("returns a placeholder when unit is null", () => {
    expect(formatTariffForUnit(2, null)).toBe("-");
  });

  it("dispatches to the matching per-unit formatter", () => {
    expect(formatTariffForUnit(2.6, "kWh")).toBe("R2,6/kWh");
    expect(formatTariffForUnit(30, "kL")).toBe("R30/kL");
  });
});

describe("formatPercent", () => {
  it("prefixes positive values with a plus sign", () => {
    expect(formatPercent(12.3)).toBe("+12,3%");
  });

  it("does not double up the minus sign on negative values", () => {
    expect(formatPercent(-12.3)).toBe("-12,3%");
  });

  it("prefixes zero with a plus sign too", () => {
    expect(formatPercent(0)).toBe("+0%");
  });
});

describe("date helpers", () => {
  it("shortDate takes the first 10 characters", () => {
    expect(shortDate("2026-07-25T14:30:00")).toBe("2026-07-25");
  });

  it("chartDate takes the MM-DD slice", () => {
    expect(chartDate("2026-07-25")).toBe("07-25");
  });

  it("longDateTime swaps the T for a space and trims seconds", () => {
    expect(longDateTime("2026-07-25T14:30:00")).toBe("2026-07-25 14:30");
  });
});
