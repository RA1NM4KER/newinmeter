const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat("en-ZA", {
  maximumFractionDigits: 2
});

export function formatCurrency(value: number) {
  return zarFormatter.format(value);
}

export function formatKwh(value: number) {
  return `${numberFormatter.format(value)} kWh`;
}

export function formatKl(value: number) {
  return `${numberFormatter.format(value)} kL`;
}

export function formatTariff(value: number) {
  return `R${numberFormatter.format(value)}/kWh`;
}

export function formatTariffPerKl(value: number) {
  return `R${numberFormatter.format(value)}/kL`;
}

export function formatUsage(value: number, unit: "kWh" | "kL" | null) {
  if (!unit) {
    return "-";
  }

  return unit === "kWh" ? formatKwh(value) : formatKl(value);
}

export function formatTariffForUnit(value: number, unit: "kWh" | "kL" | null) {
  if (!unit) {
    return "-";
  }

  return unit === "kWh" ? formatTariff(value) : formatTariffPerKl(value);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${numberFormatter.format(value)}%`;
}

export function shortDate(date: string) {
  return date.slice(0, 10);
}

export function chartDate(date: string) {
  return date.slice(5, 10);
}

export function longDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
