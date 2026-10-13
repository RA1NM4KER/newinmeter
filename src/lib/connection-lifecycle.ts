import type { ConnectionDataState } from "./newinmeter/connection";

export type ConnectionLifecycle = "active" | "paused" | Exclude<ConnectionDataState, "warm">;

export function connectionLifecycle(dataState: ConnectionDataState, pausedForInactivity: boolean): ConnectionLifecycle {
  return dataState === "warm" ? (pausedForInactivity ? "paused" : "active") : dataState;
}
