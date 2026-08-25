// Every schema here is written for OpenAI's strict function-calling mode
// (see openai.ts: every tool is registered with strict: true): every
// property must appear in `required`, and additionalProperties is always
// false at every level. "Optional" arguments are expressed as a nullable
// type instead of being omitted from `required` -- the model must pass an
// explicit `null` rather than leaving the key out. Handlers already treat
// any non-matching value (including null) as "use the default", so this
// costs no handler code changes, only schema shape.

export const EmptySchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false
} as const;

export const GetTopDaysSchema = {
  type: "object",
  properties: {
    metric: {
      type: "string",
      enum: ["spend", "kwh", "tariff", "waterKl", "waterSpend"]
    },
    limit: {
      type: ["number", "null"],
      description: "1-10. Defaults to 5 when null."
    }
  },
  required: ["metric", "limit"],
  additionalProperties: false
} as const;

export const GetTopHoursSchema = {
  type: "object",
  properties: {
    metric: {
      type: "string",
      enum: ["spend", "kwh"]
    },
    limit: {
      type: ["number", "null"],
      description: "1-10. Defaults to 5 when null."
    }
  },
  required: ["metric", "limit"],
  additionalProperties: false
} as const;

export const ExplainDaySchema = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "ISO date in YYYY-MM-DD format."
    }
  },
  required: ["date"],
  additionalProperties: false
} as const;

export const GetRecentTopupsSchema = {
  type: "object",
  properties: {
    limit: {
      type: ["number", "null"],
      description: "1-20. Defaults to 10 when null."
    }
  },
  required: ["limit"],
  additionalProperties: false
} as const;

export const GetDataStatusSchema = {
  type: "object",
  properties: {
    limit: {
      type: ["number", "null"],
      description: "Maximum number of incomplete/possible-gap dates to list. 1-30, defaults to 10 when null."
    }
  },
  required: ["limit"],
  additionalProperties: false
} as const;

export const GetActivityReportSchema = {
  type: "object",
  properties: {
    from: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD). Defaults to the active dashboard scope start when null."
    },
    to: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD). Defaults to the active dashboard scope end when null."
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Filter to activities that have at least one of these tags. Empty array means no tag filter."
    },
    utility: {
      type: "string",
      enum: ["all", "electricity", "water"]
    },
    groupBy: {
      type: "string",
      enum: ["none", "tag"],
      description: "'none' returns individual activity occurrences; 'tag' returns per-tag aggregate metrics."
    },
    includeNotes: {
      type: "boolean",
      description:
        "Include free-text activity notes. Set true only when the user is asking what happened or about notes specifically."
    }
  },
  required: ["from", "to", "tags", "utility", "groupBy", "includeNotes"],
  additionalProperties: false
} as const;

// Distinct from get_activity_report: that tool deliberately omits activity
// ids (it's a read-only reporting tool). This one exists so the model can
// resolve a real activityId before proposing update_activity/delete_activity
// -- it never invents one.
export const FindActivitiesSchema = {
  type: "object",
  properties: {
    from: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD). Defaults to the active dashboard scope start when null."
    },
    to: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD). Defaults to the active dashboard scope end when null."
    },
    tag: {
      type: ["string", "null"],
      description: "Filter to activities carrying this one tag. Null means no tag filter."
    },
    startTime: {
      type: ["string", "null"],
      description: "HH:MM (half-hour aligned). Together with endTime, narrows to activities overlapping this time-of-day window on each date. Null means no time-of-day filter."
    },
    endTime: {
      type: ["string", "null"],
      description: "HH:MM (half-hour aligned, or 00:00 for midnight). Null means no time-of-day filter."
    }
  },
  required: ["from", "to", "tag", "startTime", "endTime"],
  additionalProperties: false
} as const;

export const InspectTimeWindowSchema = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "ISO date (YYYY-MM-DD) the window falls on."
    },
    startTime: {
      type: "string",
      description: "HH:MM, half-hour aligned. Start of the window to inspect, e.g. '19:00'."
    },
    endTime: {
      type: "string",
      description: "HH:MM, half-hour aligned (or '00:00' for midnight). End of the window to inspect, e.g. '20:00'."
    },
    includeTypicalComparison: {
      type: "boolean",
      description: "Compare against the same time-of-day window on other complete days in scope, when enough history exists."
    }
  },
  required: ["date", "startTime", "endTime", "includeTypicalComparison"],
  additionalProperties: false
} as const;

export const GetRecentAlertsSchema = {
  type: "object",
  properties: {
    limit: {
      type: ["number", "null"],
      description: "1-30. Defaults to 10 when null."
    }
  },
  required: ["limit"],
  additionalProperties: false
} as const;

export const ExplainAlertSchema = {
  type: "object",
  properties: {
    alertEventId: {
      type: "string",
      description: "The alert event id to explain (from get_recent_alerts, or trusted UI context)."
    }
  },
  required: ["alertEventId"],
  additionalProperties: false
} as const;
