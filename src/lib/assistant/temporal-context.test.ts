import { describe, expect, it } from "vitest";
import { buildAssistantTemporalContext } from "./temporal-context";

describe("buildAssistantTemporalContext", () => {
  it("grounds today and yesterday in Africa/Johannesburg", () => {
    expect(buildAssistantTemporalContext(new Date("2026-08-25T10:00:00Z"))).toMatchObject({
      timeZone: "Africa/Johannesburg",
      currentLocalDate: "2026-08-25",
      today: "2026-08-25",
      yesterday: "2026-08-24"
    });
  });

  it("uses the SAST date across the UTC midnight edge", () => {
    expect(buildAssistantTemporalContext(new Date("2026-08-24T22:30:00Z"))).toMatchObject({
      today: "2026-08-25",
      yesterday: "2026-08-24"
    });
  });
});
