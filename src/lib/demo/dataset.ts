// Pure, deterministic generator for the recruiter demo dataset. No Supabase
// calls, no `server-only` import -- this is plain data shaping so it can be
// unit tested (dataset.test.ts) and imported directly by
// scripts/seed-demo-account.ts. The output rows are written into
// `energy_rows` exactly like a real LiveMopay sync would (same columns,
// same charge_label conventions that drive the generated `charge_kind`
// column), so every downstream rollup/analytics/assistant path runs
// unmodified against seeded data -- see the "Data Semantics" section of the
// README for the invariants this generator has to satisfy.

const SLOTS_PER_DAY = 48;
const WATER_TARIFF = 28.5;
const FIXED_CHARGE = 14.5;
const INITIAL_BALANCE = 300;

export type DemoEnergyRow = {
  captureDt: string;
  chargeLabel: string;
  periodDt: string;
  kwh: number;
  waterKl: number;
  tariff: number;
  cost: number;
  balance: number;
};

export type DemoActivityInput = {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  tags: string[];
  color: string;
  note?: string;
};

export type DemoDatasetOptions = {
  /** ISO date (YYYY-MM-DD) of the first seeded day. */
  startDate: string;
  /** Inclusive number of days to generate. */
  days: number;
  /** Fixed seed so reruns produce byte-identical output for the same range length. */
  seed?: number;
};

export type DemoDatasetMeta = {
  startDate: string;
  endDate: string;
  days: number;
  rateChangeDate: string;
  baseRateBefore: number;
  baseRateAfter: number;
  spikeDate: string;
  highUsageDates: string[];
  topupDates: string[];
  refundDate: string;
  awayStartDate: string;
};

export type DemoDataset = {
  energyRows: DemoEnergyRow[];
  activities: DemoActivityInput[];
  meta: DemoDatasetMeta;
};

// mulberry32 -- small, fast, deterministic PRNG. Same seed always produces
// the same sequence, which is what makes a reseed byte-for-byte reproducible.
function mulberry32(seed: number) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad2(value: number) {
  return value < 10 ? `0${value}` : `${value}`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function addDaysIso(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dayOfWeek(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function slotToHourMinute(slot: number) {
  return { hour: Math.floor(slot / 2), minute: (slot % 2) * 30 };
}

function periodDtOf(date: string, slot: number) {
  const { hour, minute } = slotToHourMinute(slot);
  return `${date} ${pad2(hour)}:${pad2(minute)}`;
}

function captureDtOf(date: string, slot: number) {
  const { hour, minute } = slotToHourMinute(slot);
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${pad2(hour)}:${pad2(minute)}`;
}

// Residential half-hour baseline: low overnight, a morning peak, a lighter
// daytime trough (heavier on weekends, when people are home), and the
// dominant evening peak. Weekday/weekend shift is deliberately visible so
// the assistant's "time of day" and week-over-week comparisons have
// something real to describe.
function baselineKwh(hour: number, isWeekend: boolean, random: () => number) {
  let base: number;
  if (hour < 5) base = 0.06;
  else if (hour < 6) base = 0.1;
  else if (hour < 9) base = isWeekend ? 0.32 : 0.55;
  else if (hour < 16) base = isWeekend ? 0.28 : 0.16;
  else if (hour < 17) base = 0.22;
  else if (hour < 21) base = isWeekend ? 0.72 : 0.62;
  else if (hour < 23) base = 0.18;
  else base = 0.09;

  const noise = 0.85 + random() * 0.3;
  return Math.max(0.02, base * noise);
}

// Time-of-use bands within a single day -- off-peak overnight, a premium
// evening peak, standard the rest of the time. This is the "tariff-band
// transition" the demo needs to exercise: the model has no separate
// tariff-schedule table (see README Data Semantics), so, exactly like real
// synced data, a rate change is represented purely by the per-row `tariff`
// value differing across rows.
function tariffForHour(hour: number, baseRate: number) {
  if (hour >= 22 || hour < 6) return round2(baseRate * 0.75);
  if (hour >= 17 && hour < 20) return round2(baseRate * 1.35);
  return baseRate;
}

type PendingEvent = {
  date: string;
  slot: number;
  kindPriority: number;
  chargeLabel: string;
  kwh: number;
  waterKl: number;
  tariff: number;
  cost: number;
};

export function buildDemoDataset(options: DemoDatasetOptions): DemoDataset {
  const { startDate, days } = options;
  const seed = options.seed ?? 20260101;
  const random = mulberry32(seed);

  if (days < 14) {
    throw new Error("buildDemoDataset requires at least 14 days to produce a meaningful demo range.");
  }

  const rateChangeIndex = Math.floor(days * 0.45);
  const spikeIndex = Math.floor(days * 0.3);
  const refundIndex = Math.floor(days * 0.62);
  const highUsageIndexes = new Set(
    [Math.floor(days * 0.12), Math.floor(days * 0.56), Math.floor(days * 0.85)].filter((index) => index !== spikeIndex)
  );
  const baseRateBefore = 2.2;
  const baseRateAfter = 2.45;
  // Multi-day "away" stretch (see buildDemoActivities): usage drops to a
  // fridge-and-standby-only baseline so "how did usage change while I was
  // away" has a real answer, not a flat line.
  const awayStartIndex = Math.floor(days * 0.7);
  const awayDayIndexes = new Set([awayStartIndex, awayStartIndex + 1, awayStartIndex + 2]);

  // Top-ups roughly every 9-11 days, starting a few days in, skipped if it
  // would land in the final 2 days (no time for the balance story to react).
  // Sized (with the fixed/energy/water cost constants above) to keep the
  // running balance mostly positive with visible pre-topup dips, rather than
  // drifting deeply negative over a 10-12 week range.
  const topupIndexes: number[] = [];
  for (let index = 3; index < days - 2; index += 9 + Math.floor(random() * 3)) {
    topupIndexes.push(index);
  }

  const events: PendingEvent[] = [];

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = addDaysIso(startDate, dayIndex);
    const isWeekend = dayOfWeek(date) === 0 || dayOfWeek(date) === 6;
    const baseRate = dayIndex >= rateChangeIndex ? baseRateAfter : baseRateBefore;
    const isSpikeDay = dayIndex === spikeIndex;
    const isHighUsageDay = highUsageIndexes.has(dayIndex);
    const isAwayDay = awayDayIndexes.has(dayIndex);

    events.push({
      date,
      slot: 0,
      kindPriority: 0,
      chargeLabel: "Basic Charge",
      kwh: 0,
      waterKl: 0,
      tariff: 0,
      cost: FIXED_CHARGE
    });

    if (topupIndexes.includes(dayIndex)) {
      const amount = Math.round((480 + random() * 220) / 10) * 10;
      events.push({
        date,
        slot: 16,
        kindPriority: 3,
        chargeLabel: "Top Up",
        kwh: 0,
        waterKl: 0,
        tariff: 0,
        cost: amount
      });
    }

    if (dayIndex === refundIndex) {
      events.push({
        date,
        slot: 30,
        kindPriority: 4,
        chargeLabel: "Tariff Correction Refund",
        kwh: 0,
        waterKl: 0,
        tariff: 0,
        cost: 45
      });
    }

    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      const { hour } = slotToHourMinute(slot);
      let kwh = baselineKwh(hour, isWeekend, random);

      // A short, obvious spike: two consecutive half-hours at 13:00-14:00
      // running several times normal draw (oven + kettle + geyser overlap).
      if (isSpikeDay && (slot === 26 || slot === 27)) {
        kwh *= 12;
      } else if (isAwayDay) {
        // Fridge/standby-only: no morning/evening peak, well below baseline.
        kwh *= 0.22;
      } else if (isHighUsageDay) {
        kwh *= 1.6;
      }

      kwh = round3(kwh);
      const tariff = tariffForHour(hour, baseRate);
      const cost = round2(kwh * tariff);

      events.push({
        date,
        slot,
        kindPriority: 1,
        chargeLabel: `Energy Charge: ${kwh.toFixed(3)} kWh @ R${tariff.toFixed(2)}`,
        kwh,
        waterKl: 0,
        tariff,
        cost
      });

      // Water: a morning shower slot and an evening slot most days, plus an
      // occasional midday laundry-style draw. Sparse by design -- water
      // usage is real but much less continuous than electricity.
      if (slot === 13 && !isAwayDay && random() < 0.75) {
        const waterKl = round3(0.05 + random() * 0.08);
        events.push({
          date,
          slot,
          kindPriority: 2,
          chargeLabel: `Water: ${waterKl.toFixed(3)} kL @ R${WATER_TARIFF.toFixed(2)}`,
          kwh: 0,
          waterKl,
          tariff: WATER_TARIFF,
          cost: round2(waterKl * WATER_TARIFF)
        });
      }
      if (slot === 39 && !isAwayDay && random() < 0.7) {
        const waterKl = round3(0.04 + random() * 0.07);
        events.push({
          date,
          slot,
          kindPriority: 2,
          chargeLabel: `Water: ${waterKl.toFixed(3)} kL @ R${WATER_TARIFF.toFixed(2)}`,
          kwh: 0,
          waterKl,
          tariff: WATER_TARIFF,
          cost: round2(waterKl * WATER_TARIFF)
        });
      }
      if (slot === 21 && !isAwayDay && random() < 0.12) {
        const waterKl = round3(0.08 + random() * 0.07);
        events.push({
          date,
          slot,
          kindPriority: 2,
          chargeLabel: `Water: ${waterKl.toFixed(3)} kL @ R${WATER_TARIFF.toFixed(2)}`,
          kwh: 0,
          waterKl,
          tariff: WATER_TARIFF,
          cost: round2(waterKl * WATER_TARIFF)
        });
      }
    }
  }

  events.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    if (left.slot !== right.slot) return left.slot - right.slot;
    return left.kindPriority - right.kindPriority;
  });

  let balance = INITIAL_BALANCE;
  const isCredit = (priority: number) => priority === 3 || priority === 4;

  const energyRows: DemoEnergyRow[] = events.map((event) => {
    balance = round2(balance + (isCredit(event.kindPriority) ? event.cost : -event.cost));

    return {
      captureDt: captureDtOf(event.date, event.slot),
      chargeLabel: event.chargeLabel,
      periodDt: periodDtOf(event.date, event.slot),
      kwh: event.kwh,
      waterKl: event.waterKl,
      tariff: event.tariff,
      cost: event.cost,
      balance
    };
  });

  const endDate = addDaysIso(startDate, days - 1);
  const spikeDate = addDaysIso(startDate, spikeIndex);
  const refundDate = addDaysIso(startDate, refundIndex);
  const highUsageDates = Array.from(highUsageIndexes)
    .sort((a, b) => a - b)
    .map((index) => addDaysIso(startDate, index));
  const topupDates = topupIndexes.map((index) => addDaysIso(startDate, index));
  const awayStartDate = addDaysIso(startDate, awayStartIndex);

  return {
    energyRows,
    activities: buildDemoActivities({ startDate, days, spikeDate, highUsageDates, awayStartIndex }),
    meta: {
      startDate,
      endDate,
      days,
      rateChangeDate: addDaysIso(startDate, rateChangeIndex),
      baseRateBefore,
      baseRateAfter,
      spikeDate,
      highUsageDates,
      topupDates,
      refundDate,
      awayStartDate
    }
  };
}

const ACTIVITY_COLORS = {
  geyser: "#c2410c",
  laundry: "#2563eb",
  oven: "#db2777",
  cooking: "#65a30d",
  away: "#7c3aed",
  guests: "#0f766e"
} as const;

function buildDemoActivities(args: {
  startDate: string;
  days: number;
  spikeDate: string;
  highUsageDates: string[];
  awayStartIndex: number;
}): DemoActivityInput[] {
  const { startDate, days, awayStartIndex } = args;
  const activities: DemoActivityInput[] = [];
  const isAwayIndex = (index: number) => index >= awayStartIndex && index < awayStartIndex + 3;

  // A handful of recurring geyser mornings, spaced through the range, loosely
  // aligned with the 06:00-08:00 usage peak baked into baselineKwh. Skipped
  // during the away stretch -- nobody's home to run the geyser.
  for (let index = 5; index < days - 3; index += 9) {
    if (isAwayIndex(index)) continue;
    const date = addDaysIso(startDate, index);
    activities.push({
      startsAt: `${date}T05:30:00`,
      endsAt: `${date}T07:00:00`,
      allDay: false,
      tags: ["geyser"],
      color: ACTIVITY_COLORS.geyser,
      note: "Morning geyser cycle"
    });
  }

  // Late-night geyser crossing midnight into the following morning.
  for (let index = 10; index < days - 3; index += 14) {
    if (isAwayIndex(index) || isAwayIndex(index + 1)) continue;
    const date = addDaysIso(startDate, index);
    const nextDate = addDaysIso(startDate, index + 1);
    activities.push({
      startsAt: `${date}T22:00:00`,
      endsAt: `${nextDate}T06:00:00`,
      allDay: false,
      tags: ["geyser"],
      color: ACTIVITY_COLORS.geyser
    });
  }

  // Laundry on the spike day and a couple of other weekday afternoons.
  const laundryOffsets = [args.spikeDate, ...args.highUsageDates.slice(0, 1)];
  for (const date of laundryOffsets) {
    activities.push({
      startsAt: `${date}T13:00:00`,
      endsAt: `${date}T14:30:00`,
      allDay: false,
      tags: ["laundry"],
      color: ACTIVITY_COLORS.laundry,
      note: "Wash + tumble dry"
    });
  }

  // Oven + cooking on the spike day itself, aligned with the boosted
  // 13:00-14:00 interval.
  activities.push({
    startsAt: `${args.spikeDate}T12:30:00`,
    endsAt: `${args.spikeDate}T14:00:00`,
    allDay: false,
    tags: ["oven", "cooking"],
    color: ACTIVITY_COLORS.oven,
    note: "Sunday roast"
  });

  // A handful of standalone cooking/dinner slots through the evening peak.
  for (let index = 18; index < days - 3; index += 16) {
    if (isAwayIndex(index)) continue;
    const date = addDaysIso(startDate, index);
    activities.push({
      startsAt: `${date}T18:00:00`,
      endsAt: `${date}T19:30:00`,
      allDay: false,
      tags: ["cooking"],
      color: ACTIVITY_COLORS.cooking
    });
  }

  // A multi-day "away" stretch roughly two-thirds through the range, where
  // usage reads visibly lower than the household's normal baseline (see the
  // isAwayDay kwh/water reduction in the main generation loop above).
  // usage_activities caps any single row at 24 hours (see
  // usage_activities_max_duration), so a multi-day stretch is three
  // consecutive all-day rows, not one spanning row.
  for (let offset = 0; offset < 3; offset += 1) {
    const date = addDaysIso(startDate, awayStartIndex + offset);
    activities.push({
      startsAt: `${date}T00:00:00`,
      endsAt: `${addDaysIso(date, 1)}T00:00:00`,
      allDay: true,
      tags: ["away"],
      color: ACTIVITY_COLORS.away,
      ...(offset === 0 ? { note: "Long weekend away" } : {})
    });
  }

  // A "guests" evening for a second household tag distinct from the core set.
  const guestsDate = addDaysIso(startDate, Math.floor(days * 0.2));
  activities.push({
    startsAt: `${guestsDate}T17:00:00`,
    endsAt: `${guestsDate}T22:00:00`,
    allDay: false,
    tags: ["guests", "cooking"],
    color: ACTIVITY_COLORS.guests,
    note: "Dinner with visitors"
  });

  return activities.sort((left, right) => (left.startsAt < right.startsAt ? -1 : 1));
}
