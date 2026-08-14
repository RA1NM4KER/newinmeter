import { describe, expect, it } from "vitest";
import { buildActivitiesPath, buildActivityTagMetadata, mapActivityRow } from "./activity-data";

describe("activity data queries", () => {
  it("builds connection-safe overlap and case-normalized tag filters", () => {
    const path = buildActivitiesPath({ from: "2026-08-01", to: "2026-08-04", tags: [" Geyser "] });
    expect(path).toContain("ends_at=gt.2026-08-01T00%3A00%3A00");
    expect(path).toContain("starts_at=lt.2026-08-05T00%3A00%3A00");
    expect(path).toContain("tags=ov.%7Bgeyser%7D");
    expect(path).not.toContain("connection_id=eq");
  });

  it("maps database rows without exposing connection ownership", () => {
    expect(
      mapActivityRow({
        id: "a",
        connection_id: "private",
        starts_at: "2026-08-04T00:00:00",
        ends_at: "2026-08-05T00:00:00",
        all_day: true,
        tags: ["guests"],
        color: "#2563eb",
        note: null,
        created_at: "created",
        updated_at: "updated"
      })
    ).toEqual({
      id: "a",
      startsAt: "2026-08-04T00:00:00",
      endsAt: "2026-08-05T00:00:00",
      allDay: true,
      tags: ["guests"],
      color: "#2563eb",
      note: undefined,
      createdAt: "created",
      updatedAt: "updated"
    });
  });

  it("uses the most recently updated matching tag colour as the activity default", () => {
    expect(
      buildActivityTagMetadata([
        { tags: ["Geyser", "winter"], color: "#2563eb" },
        { tags: ["geyser"], color: "#0f766e" }
      ])
    ).toEqual({
      tags: ["geyser", "winter"],
      colors: { geyser: "#2563eb", winter: "#2563eb" }
    });
  });
});
