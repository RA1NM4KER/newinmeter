import "server-only";

import { cache } from "react";
import { getDiagnosticsSnapshot } from "../diagnostics/data";
import { getSystemHealthStates, listUnresolvedSystemEvents, sanitizeDiagnosticMessage } from "../diagnostics/store";
import { buildSystemMap } from "./resolve";

export const getSystemMapSnapshot = cache(async function getSystemMapSnapshot() {
  const [diagnostics, states, unresolved] = await Promise.all([
    getDiagnosticsSnapshot(),
    getSystemHealthStates(),
    listUnresolvedSystemEvents()
  ]);
  const events = new Map(diagnostics.events.map((event) => [event.id, event]));
  for (const event of unresolved) events.set(event.id, event);
  return buildSystemMap({
    diagnostics,
    states,
    events: Array.from(events.values()).map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      category: event.category,
      eventType: event.eventType,
      connectionId: event.connectionId,
      severity: event.severity,
      resolvedAt: event.resolvedAt,
      message: sanitizeDiagnosticMessage(event.message)
    }))
  });
});
