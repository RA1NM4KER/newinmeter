// Pure, deterministic generator for the recruiter demo dataset. No Supabase
// calls, no `server-only` import -- this is plain data shaping so it can be
// unit tested (dataset.test.ts) and imported directly by
// scripts/seed-demo-account.ts. The output rows are written into
// `energy_rows` exactly like a real LiveMopay sync would (same columns,
// same charge_label conventions that drive the generated `charge_kind`
// column), so every downstream rollup/analytics/assistant path runs
// unmodified against seeded data -- see the "Data Semantics" section of the
// README for the invariants this generator has to satisfy.

import {
  NEWINBOSCH_2026_27,
  findTariffLedgerRateSchedule,
  resolveMonthlyBand
} from "@/lib/newinmeter/tariff-profiles";

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
  tariffBand: string | null;
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
  guestsDate: string;
  laundryDates: string[];
  heaterDates: string[];
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

function energyTariff(date: string, monthKwh: number) {
  const position = resolveMonthlyBand(NEWINBOSCH_2026_27, monthKwh);
  const bandIndex = NEWINBOSCH_2026_27.bands.indexOf(position.currentBand);
  const schedule = findTariffLedgerRateSchedule(NEWINBOSCH_2026_27, "energy", date);
  if (!schedule?.bands[bandIndex]) {
    throw new Error(`No demo energy tariff schedule exists for ${date}.`);
  }
  return schedule.bands[bandIndex];
}

type PendingEvent = {
  date: string;
  slot: number;
  kindPriority: number;
  chargeLabel: string;
  kwh: number;
  waterKl: number;
  tariff: number;
  tariffBand: string | null;
  cost: number;
};

export function buildDemoDataset(options: DemoDatasetOptions): DemoDataset {
  const { startDate, days } = options;
  const seed = options.seed ?? 20260101;
  const random = mulberry32(seed);

  if (days < 14) {
    throw new Error("buildDemoDataset requires at least 14 days to produce a meaningful demo range.");
  }

  const endDate = addDaysIso(startDate, days - 1);
  const scheduleTransitions = NEWINBOSCH_2026_27.ledgerRateSchedules
    .filter(
      (schedule) =>
        schedule.kind === "energy" && schedule.effectiveFrom > startDate && schedule.effectiveFrom <= endDate
    )
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  const rateChangeDate = scheduleTransitions[0]?.effectiveFrom ?? startDate;
  const beforeSchedule = findTariffLedgerRateSchedule(
    NEWINBOSCH_2026_27,
    "energy",
    addDaysIso(rateChangeDate, -1)
  );
  const afterSchedule = findTariffLedgerRateSchedule(NEWINBOSCH_2026_27, "energy", rateChangeDate);
  const spikeIndex = Math.floor(days * 0.3);
  const refundIndex = Math.floor(days * 0.62);
  const highUsageIndexes = new Set(
    [Math.floor(days * 0.12), Math.floor(days * 0.56), Math.floor(days * 0.85)].filter((index) => index !== spikeIndex)
  );
  const baseRateBefore = beforeSchedule?.bands[1]?.rate ?? 2.369;
  const baseRateAfter = afterSchedule?.bands[1]?.rate ?? baseRateBefore;
  // Multi-day "away" stretch (see buildDemoActivities): usage drops to a
  // fridge-and-standby-only baseline so "how did usage change while I was
  // away" has a real answer, not a flat line.
  const awayStartIndex = Math.floor(days * 0.7);
  const awayDayIndexes = new Set([awayStartIndex, awayStartIndex + 1, awayStartIndex + 2]);
  const guestsIndex = Math.floor(days * 0.2);
  const laundryIndexes = new Set([Math.floor(days * 0.12), Math.floor(days * 0.48), Math.floor(days * 0.82)]);
  const heaterIndexes = new Set([Math.floor(days * 0.08), Math.floor(days * 0.56), Math.floor(days * 0.85)]);

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
  let energyMonth = startDate.slice(0, 7);
  // The first generated month may start part-way through a real billing
  // month. Give it a modest synthetic opening balance so the first visible
  // block transition does not unrealistically restart on the range boundary.
  let monthEnergyKwh = (Number(startDate.slice(8, 10)) - 1) * 11;

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = addDaysIso(startDate, dayIndex);
    if (date.slice(0, 7) !== energyMonth) {
      energyMonth = date.slice(0, 7);
      monthEnergyKwh = 0;
    }
    const isWeekend = dayOfWeek(date) === 0 || dayOfWeek(date) === 6;
    const isSpikeDay = dayIndex === spikeIndex;
    const isHighUsageDay = highUsageIndexes.has(dayIndex);
    const isAwayDay = awayDayIndexes.has(dayIndex);
    const isLaundryDay = laundryIndexes.has(dayIndex);
    const isHeaterDay = heaterIndexes.has(dayIndex);
    const hasGuests = dayIndex === guestsIndex;

    events.push({
      date,
      slot: 0,
      kindPriority: 0,
      chargeLabel: "Basic Charge",
      kwh: 0,
      waterKl: 0,
      tariff: 0,
      tariffBand: null,
      cost: FIXED_CHARGE
    });

    if (topupIndexes.includes(dayIndex)) {
      const amount = Math.round((600 + random() * 220) / 10) * 10;
      events.push({
        date,
        slot: 16,
        kindPriority: 3,
        chargeLabel: "Top Up",
        kwh: 0,
        waterKl: 0,
        tariff: 0,
        tariffBand: null,
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
        tariffBand: null,
        cost: 45
      });
    }

    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      const { hour } = slotToHourMinute(slot);
      let kwh = baselineKwh(hour, isWeekend, random);

      if (isAwayDay) {
        // Fridge/standby-only: no morning/evening peak, well below baseline.
        kwh *= 0.22;
      } else {
        // Distinct appliance-shaped additions sit on top of the noisy
        // household baseline. They are intentionally irregular rather than
        // repeated every day at exactly the same draw.
        if (slot >= 11 && slot <= 13 && dayIndex % 4 !== 1) kwh += 0.55 + random() * 0.28; // geyser
        if ((slot === 14 || slot === 15) && dayIndex % 3 !== 0) kwh += 0.18 + random() * 0.2; // kettle/breakfast
        if (slot >= 35 && slot <= 39) kwh += 0.2 + random() * 0.38; // cooking
        if (slot === 41 && dayIndex % 5 === 2) kwh += 0.5 + random() * 0.25; // dishwasher
        if (isLaundryDay && slot >= 20 && slot <= 24) kwh += 0.45 + random() * 0.55;
        if (isHeaterDay && ((slot >= 12 && slot <= 16) || (slot >= 36 && slot <= 42))) kwh += 0.7 + random() * 0.5;
        if (hasGuests && slot >= 34 && slot <= 46) kwh += 0.25 + random() * 0.45;
        if (isHighUsageDay) kwh *= 1.22;

        // The deliberately unexplained event is overnight, where a normal
        // residential trace is quiet enough for it to stand out without
        // making the whole day cartoonishly high.
        if (isSpikeDay && (slot === 4 || slot === 5)) kwh += 2.2 + random() * 0.35;
      }

      kwh = round3(kwh);
      const tariffBand = energyTariff(date, monthEnergyKwh);
      const tariff = tariffBand.rate;
      const cost = round2(kwh * tariff);
      monthEnergyKwh += kwh;

      events.push({
        date,
        slot,
        kindPriority: 1,
        chargeLabel: `Energy Charge: ${tariffBand.label}`,
        kwh,
        waterKl: 0,
        tariff,
        tariffBand: tariffBand.label,
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
          tariffBand: null,
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
          tariffBand: null,
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
          tariffBand: null,
          cost: round2(waterKl * WATER_TARIFF)
        });
      }
      if (slot === 22 && !isAwayDay && isLaundryDay) {
        const waterKl = round3(0.11 + random() * 0.06);
        events.push({
          date,
          slot,
          kindPriority: 2,
          chargeLabel: `Water: ${waterKl.toFixed(3)} kL @ R${WATER_TARIFF.toFixed(2)}`,
          kwh: 0,
          waterKl,
          tariff: WATER_TARIFF,
          tariffBand: null,
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
      tariffBand: event.tariffBand,
      cost: event.cost,
      balance
    };
  });

  const spikeDate = addDaysIso(startDate, spikeIndex);
  const refundDate = addDaysIso(startDate, refundIndex);
  const highUsageDates = Array.from(highUsageIndexes)
    .sort((a, b) => a - b)
    .map((index) => addDaysIso(startDate, index));
  const topupDates = topupIndexes.map((index) => addDaysIso(startDate, index));
  const awayStartDate = addDaysIso(startDate, awayStartIndex);

  return {
    energyRows,
    activities: buildDemoActivities({
      startDate,
      days,
      spikeDate,
      highUsageDates,
      awayStartIndex,
      guestsIndex,
      laundryIndexes: Array.from(laundryIndexes),
      heaterIndexes: Array.from(heaterIndexes)
    }),
    meta: {
      startDate,
      endDate,
      days,
      rateChangeDate,
      baseRateBefore,
      baseRateAfter,
      spikeDate,
      highUsageDates,
      topupDates,
      refundDate,
      awayStartDate,
      guestsDate: addDaysIso(startDate, guestsIndex),
      laundryDates: Array.from(laundryIndexes).map((index) => addDaysIso(startDate, index)),
      heaterDates: Array.from(heaterIndexes).map((index) => addDaysIso(startDate, index))
    }
  };
}

const ACTIVITY_COLORS = {
  geyser: "#c2410c",
  laundry: "#2563eb",
  oven: "#db2777",
  cooking: "#65a30d",
  away: "#7c3aed",
  guests: "#0f766e",
  kettle: "#b45309",
  heater: "#dc2626",
  entertainment: "#4f46e5",
  dishwasher: "#0891b2",
  investigating: "#9333ea"
} as const;

function buildDemoActivities(args: {
  startDate: string;
  days: number;
  spikeDate: string;
  highUsageDates: string[];
  awayStartIndex: number;
  guestsIndex: number;
  laundryIndexes: number[];
  heaterIndexes: number[];
}): DemoActivityInput[] {
  const { startDate, days, awayStartIndex } = args;
  const activities: DemoActivityInput[] = [];
  const isAwayIndex = (index: number) => index >= awayStartIndex && index < awayStartIndex + 3;

  // A handful of recurring geyser mornings, spaced through the range, loosely
  // aligned with the 06:00-08:00 usage peak baked into baselineKwh. Skipped
  // during the away stretch -- nobody's home to run the geyser.
  for (let index = 4; index < days - 2; index += 6) {
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

  for (const index of args.laundryIndexes) {
    const date = addDaysIso(startDate, index);
    activities.push({
      startsAt: `${date}T10:00:00`,
      endsAt: `${date}T12:30:00`,
      allDay: false,
      tags: ["laundry"],
      color: ACTIVITY_COLORS.laundry,
      note: "Wash + tumble dry"
    });
  }

  // The overnight spike is deliberately not "explained away": the tag and
  // note show how a user records an investigation while preserving the
  // anomaly as a useful assistant/notification story.
  activities.push({
    startsAt: `${args.spikeDate}T02:00:00`,
    endsAt: `${args.spikeDate}T03:00:00`,
    allDay: false,
    tags: ["investigating"],
    color: ACTIVITY_COLORS.investigating,
    note: "Unexpected overnight draw — cause still unknown"
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
      color: ACTIVITY_COLORS.cooking,
      note: index % 2 === 0 ? "Dinner prep and oven" : undefined
    });
  }

  const ovenDate = args.highUsageDates[0];
  activities.push({
    startsAt: `${ovenDate}T17:30:00`,
    endsAt: `${ovenDate}T20:00:00`,
    allDay: false,
    tags: ["oven", "cooking"],
    color: ACTIVITY_COLORS.oven,
    note: "Batch cooking for the week"
  });

  // Breakfast/kettle and dishwasher tags demonstrate shorter, ordinary
  // activities without annotating every interval in the range.
  for (let index = 7; index < days - 2; index += 15) {
    if (isAwayIndex(index)) continue;
    const date = addDaysIso(startDate, index);
    activities.push({
      startsAt: `${date}T07:00:00`,
      endsAt: `${date}T08:00:00`,
      allDay: false,
      tags: ["kettle", "cooking"],
      color: ACTIVITY_COLORS.kettle,
      note: "Breakfast before work"
    });
  }
  for (let index = 12; index < days - 2; index += 19) {
    if (isAwayIndex(index)) continue;
    const date = addDaysIso(startDate, index);
    activities.push({
      startsAt: `${date}T20:30:00`,
      endsAt: `${date}T22:00:00`,
      allDay: false,
      tags: ["dishwasher"],
      color: ACTIVITY_COLORS.dishwasher
    });
  }

  for (const index of args.heaterIndexes) {
    if (isAwayIndex(index)) continue;
    const date = addDaysIso(startDate, index);
    activities.push({
      startsAt: `${date}T18:00:00`,
      endsAt: `${date}T21:30:00`,
      allDay: false,
      tags: ["heater", "entertainment"],
      color: ACTIVITY_COLORS.heater,
      note: "Cold evening at home"
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
  const guestsDate = addDaysIso(startDate, args.guestsIndex);
  const guestsNextDate = addDaysIso(guestsDate, 1);
  activities.push({
    startsAt: `${guestsDate}T17:00:00`,
    endsAt: `${guestsNextDate}T01:00:00`,
    allDay: false,
    tags: ["guests", "cooking"],
    color: ACTIVITY_COLORS.guests,
    note: "Friends stayed for dinner and a late movie"
  });

  const movieDate = addDaysIso(startDate, Math.floor(days * 0.64));
  activities.push({
    startsAt: `${movieDate}T21:00:00`,
    endsAt: `${addDaysIso(movieDate, 1)}T00:30:00`,
    allDay: false,
    tags: ["entertainment"],
    color: ACTIVITY_COLORS.entertainment,
    note: "Movie night"
  });

  // Keep the default Day detail (the latest completed day) demonstrative:
  // its two clearest peaks have context immediately, without requiring the
  // presenter to hunt backwards through the range.
  const latestDate = addDaysIso(startDate, days - 1);
  activities.push(
    {
      startsAt: `${latestDate}T05:30:00`,
      endsAt: `${latestDate}T08:30:00`,
      allDay: false,
      tags: ["geyser", "kettle"],
      color: ACTIVITY_COLORS.geyser,
      note: "Morning showers and breakfast"
    },
    {
      startsAt: `${latestDate}T17:00:00`,
      endsAt: `${latestDate}T20:30:00`,
      allDay: false,
      tags: ["cooking", "entertainment"],
      color: ACTIVITY_COLORS.cooking,
      note: "Dinner prep and evening at home"
    }
  );

  return activities.sort((left, right) => (left.startsAt < right.startsAt ? -1 : 1));
}
