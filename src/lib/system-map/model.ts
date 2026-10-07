import { z } from "zod";
import { SYSTEM_EDGES, SYSTEM_NODES } from "./topology";

export const MAP_POLL_MS = 45_000;
export const MAP_STALE_MS = 120_000;
export const healthStatusSchema = z.enum(["healthy", "degraded", "failed", "unknown", "affected"]);
export type MapHealth = z.infer<typeof healthStatusSchema>;

export const observationSchema = z.object({
  status: healthStatusSchema,
  reason: z.string(),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
  lastFailureAt: z.string().datetime({ offset: true }).nullable(),
  affectedBy: z.array(z.string()),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })),
  events: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string().datetime({ offset: true }),
      message: z.string(),
      severity: z.enum(["info", "warning", "critical"]),
      resolvedAt: z.string().datetime({ offset: true }).nullable()
    })
  )
});
export type Observation = z.infer<typeof observationSchema>;

export const systemMapSnapshotSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    nodes: z.record(observationSchema),
    edges: z.record(observationSchema)
  })
  .superRefine((value, ctx) => {
    for (const [kind, definitions] of [
      ["nodes", SYSTEM_NODES],
      ["edges", SYSTEM_EDGES]
    ] as const) {
      for (const { id } of definitions) {
        if (!value[kind][id]) ctx.addIssue({ code: "custom", message: `Missing ${kind}: ${id}`, path: [kind, id] });
      }
    }
  });
export type SystemMapSnapshot = z.infer<typeof systemMapSnapshotSchema>;

export function isMapStale(snapshot: SystemMapSnapshot, now: number) {
  const age = now - Date.parse(snapshot.generatedAt);
  return !Number.isFinite(age) || age > MAP_STALE_MS || age < -30_000;
}
