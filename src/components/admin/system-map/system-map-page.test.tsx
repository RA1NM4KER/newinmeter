// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemMapPage } from "./system-map-page";
import { buildSystemMap } from "@/lib/system-map/resolve";
import { mapEvidence, MAP_TEST_TIME } from "../../../../test/system-map-fixture";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(MAP_TEST_TIME));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {}))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SystemMapPage inspection", () => {
  it("opens component evidence and supports Escape to close", () => {
    render(<SystemMapPage initialSnapshot={buildSystemMap(mapEvidence(), new Date(MAP_TEST_TIME))} />);
    fireEvent.click(screen.getByRole("button", { name: "LiveMopay, Healthy" }));
    const dialog = screen.getByRole("dialog", { name: "LiveMopay" });
    expect(within(dialog).getByText("Contract passed")).toBeDefined();
    expect(within(dialog).getByRole("link", { name: "Open Diagnostics" }).getAttribute("href")).toBe(
      "/admin/diagnostics"
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("labels connections with the age of their last success and animates nothing on first load", () => {
    const { container } = render(
      <SystemMapPage initialSnapshot={buildSystemMap(mapEvidence(), new Date(MAP_TEST_TIME))} />
    );
    const labels = Array.from(container.querySelectorAll("svg text")).map((node) => node.textContent);
    expect(labels.some((text) => /^(now|\d+[mhd] ago)$/.test(text ?? ""))).toBe(true);
    expect(container.querySelector(".edge-pulse")).toBeNull();
  });

  it("makes graph connections keyboard inspectable with pipeline-scoped metrics", () => {
    render(<SystemMapPage initialSnapshot={buildSystemMap(mapEvidence(), new Date(MAP_TEST_TIME))} />);
    const edge = screen.getByRole("button", { name: "Ledger records: LiveMopay to Sync worker, Healthy" });
    fireEvent.keyDown(edge, { key: "Enter" });
    const dialog = screen.getByRole("dialog", { name: "Ledger records" });
    expect(within(dialog).getByText("Latest run duration (whole pipeline)")).toBeDefined();
    expect(within(dialog).getByText("10.0 s")).toBeDefined();
  });

  it("replaces health claims with unknown when the snapshot is stale", () => {
    const snapshot = buildSystemMap(mapEvidence(), new Date(Date.parse(MAP_TEST_TIME) - 180_000));
    render(<SystemMapPage initialSnapshot={snapshot} />);
    expect(screen.queryByRole("button", { name: "LiveMopay, Healthy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "LiveMopay, Unknown" }));
    expect(within(screen.getByRole("dialog")).getByText("Snapshot stale")).toBeDefined();
  });
  it("shows a structured loading state while the first snapshot is pending", () => {
    render(<SystemMapPage initialSnapshot={null} />);
    expect(screen.getByRole("status", { name: "Loading system map" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Health data is unavailable")).toBeNull();
  });
});
