import { describe, expect, it } from "vitest";
import { resolveLiveAccess } from "./access";

describe("resolveLiveAccess", () => {
  it("redirects unauthenticated visitors to login", () => {
    expect(resolveLiveAccess({ hasSession: false, liveMeterEnabled: false, isConnected: false, isDataWarm: true })).toBe(
      "login"
    );
  });

  it("returns notFound for an authenticated user without the feature (invisible, not forbidden)", () => {
    expect(
      resolveLiveAccess({ hasSession: true, liveMeterEnabled: false, isConnected: true, isDataWarm: true })
    ).toBe("notFound");
  });

  it("sends an enabled-but-unconnected user to connect", () => {
    expect(
      resolveLiveAccess({ hasSession: true, liveMeterEnabled: true, isConnected: false, isDataWarm: true })
    ).toBe("connect");
  });

  it("sends an enabled, connected user with non-warm data to restoring", () => {
    expect(
      resolveLiveAccess({ hasSession: true, liveMeterEnabled: true, isConnected: true, isDataWarm: false })
    ).toBe("restoring");
  });

  it("allows an enabled, connected user with warm data", () => {
    expect(resolveLiveAccess({ hasSession: true, liveMeterEnabled: true, isConnected: true, isDataWarm: true })).toBe(
      "ok"
    );
  });

  it("prioritises the feature gate over the connection check", () => {
    // A disabled user never reveals whether they even have a connection.
    expect(
      resolveLiveAccess({ hasSession: true, liveMeterEnabled: false, isConnected: false, isDataWarm: true })
    ).toBe("notFound");
  });
});
