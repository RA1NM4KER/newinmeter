// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticConnection, DiagnosticsSnapshot } from "@/lib/diagnostics/data";

vi.mock("./diagnostics-refresh-button", () => ({
  DiagnosticsRefreshButton: () => <button aria-label="Refresh diagnostics" />
}));

import { DiagnosticsPage } from "./diagnostics-page";

function connection(id: string, health: "healthy" | "warning" | "critical"): DiagnosticConnection {
  return {
    id,
    userEmail: `${id}@example.test`,
    accountLabel: "Home",
    status: "connected",
    health,
    healthReason: health === "healthy" ? "Sync activity is normal." : "Recent sync health needs attention.",
    lastSuccessfulSyncAt: "2026-08-26T10:00:00.000Z",
    lastAttemptAt: "2026-08-26T10:00:00.000Z",
    lastAttemptStatus: health === "healthy" ? "success" : "failed",
    lastError: health === "healthy" ? null : "Safe operational error.",
    lastAutoSyncAt: "2026-08-26T10:00:00.000Z",
    lastAutoSyncStatus: health === "healthy" ? "success" : "failed",
    lastAutoSyncError: null,
    nextSyncAt: "2026-08-26T14:00:00.000Z",
    syncClaimedAt: null,
    claimStuck: false,
    stale: health !== "healthy",
    consecutiveFailures: health === "critical" ? 3 : health === "warning" ? 1 : 0,
    recentRuns: []
  };
}

function snapshot(): DiagnosticsSnapshot {
  return {
    generatedAt: "2026-08-26T12:00:00.000Z",
    overview: {
      overall: "critical",
      livemopay: "healthy",
      livemopayReason: "The latest contract check passed.",
      scheduler: "warning",
      schedulerReason: "Scheduler worker is delayed.",
      schedulerLastInvocationAt: "2026-08-26T11:40:00.000Z",
      schedulerExpectedMinutes: 5,
      connectionCount: 2,
      healthyConnections: 1,
      needsAttentionConnections: 1,
      unresolvedCriticalEvents: 1,
      lastApiContractCheckAt: "2026-08-26T08:00:00.000Z",
      lastApiContractSuccessAt: "2026-08-26T08:00:00.000Z",
      activePushSubscriptions: 3,
      pushStatus: "healthy"
    },
    connections: [connection("healthy-user", "healthy"), connection("problem-user", "critical")],
    events: [
      {
        id: "open-event",
        createdAt: "2026-08-26T11:00:00.000Z",
        severity: "critical",
        category: "sync",
        eventType: "connection_repeated_failures",
        connectionId: "problem-user",
        message: "A connection needs attention.",
        resolvedAt: null
      },
      {
        id: "resolved-event",
        createdAt: "2026-08-26T09:00:00.000Z",
        severity: "info",
        category: "scheduler",
        eventType: "scheduler_recovered",
        connectionId: null,
        message: "The scheduler recovered.",
        resolvedAt: "2026-08-26T09:05:00.000Z"
      }
    ]
  };
}

describe("DiagnosticsPage", () => {
  afterEach(cleanup);

  it("keeps the overview compact and surfaces only problem connections by default", () => {
    const { container } = render(<DiagnosticsPage snapshot={snapshot()} />);

    expect(screen.getByText("Action required")).toBeTruthy();
    expect(screen.getByText("problem-user@example.test")).toBeTruthy();
    expect(screen.getByText("View all healthy connections")).toBeTruthy();
    expect(container.querySelector("details[open]")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Admin" })).toBeNull();
  });

  it("opens a deep-linked healthy connection and resolved event history", () => {
    const { container } = render(
      <DiagnosticsPage snapshot={snapshot()} selectedConnectionId="healthy-user" selectedEventId="resolved-event" />
    );

    expect(container.querySelector("#connection-healthy-user")?.hasAttribute("open")).toBe(true);
    expect(container.querySelector("#event-resolved-event")?.className).toContain("bg-accentSoft/50");
    expect(screen.getByText("View recent resolved events").closest("details")?.hasAttribute("open")).toBe(true);
  });

  it("uses a tiny empty incident state when nothing is unresolved", () => {
    const data = snapshot();
    data.events = data.events.map((event) => ({ ...event, resolvedAt: event.resolvedAt ?? data.generatedAt }));

    render(<DiagnosticsPage snapshot={data} />);

    expect(screen.getByText("No unresolved incidents.")).toBeTruthy();
  });
});
