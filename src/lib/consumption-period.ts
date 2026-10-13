// Consumption periods are SAST wall-clock bucket starts, not publication times.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (date: Date) => `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
const dateLabel = (date: Date, year = false) =>
  `${date.getUTCDate()} ${months[date.getUTCMonth()]}${year ? ` ${date.getUTCFullYear()}` : ""}`;

export function intervalTimeLabel(value: string | number, minutes: number): string {
  const match = String(value).match(/^(\d{1,2})(?::(\d{2})(?::\d{2})?)?$/);
  if (!match) return String(value);
  const start = Number(match[1]) * 60 + Number(match[2] ?? 0);
  if (start < 0 || start >= 1440 || Number(match[2] ?? 0) >= 60) return String(value);
  const end = start + minutes;
  const at = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  // 24:00 denotes the end of this day without adding date text to chart tooltips.
  return `${at(start)}–${end <= 1440 ? at(end) : `${at(end % 1440)} (+${Math.floor(end / 1440)}d)`}`;
}

export function consumptionPeriodLabel(value: string, minutes = 30) {
  let civil = value;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return { label: value, accessibleLabel: value };
    // Use UTC arithmetic on a SAST wall-clock representation, independent of browser timezone.
    civil = new Date(instant.getTime() + 2 * 3600000).toISOString().slice(0, 19);
  }
  const match = civil.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return { label: value, accessibleLabel: value };
  const [, year, month, day, hour, minute] = match;
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  if (start.toISOString().slice(0, 16) !== `${year}-${month}-${day}T${hour}:${minute}`)
    return { label: value, accessibleLabel: value };
  const end = new Date(start.getTime() + minutes * 60000);
  const crossedDate = start.toISOString().slice(0, 10) !== end.toISOString().slice(0, 10);
  return {
    label: `${dateLabel(start)} · ${clock(start)}${minutes ? `–${crossedDate ? `${dateLabel(end)} ` : ""}${clock(end)}` : ""}`,
    accessibleLabel: `${dateLabel(start, true)} ${clock(start)}${minutes ? `–${crossedDate ? `${dateLabel(end, true)} ` : ""}${clock(end)}` : ""} SAST`
  };
}
