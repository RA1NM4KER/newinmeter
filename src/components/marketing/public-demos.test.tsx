// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityAssistantDemo } from "./activity-assistant-demo";
import { AlertPlayground } from "./alert-playground";
import { DayExplorer } from "./day-explorer";
import { EnergyPlayground } from "./energy-playground";

describe("public NewinMeter demos", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("changes energy scenarios, selects chart intervals, and reveals a grounded answer", async () => {
    vi.useFakeTimers();
    render(<EnergyPlayground />);

    fireEvent.click(screen.getByRole("button", { name: "Evening spike" }));
    expect(screen.getByText(/period labelled Cooking/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /18:30, 1.18 kWh, overlaps Cooking/i }));
    expect(screen.getByText("18:30–19:00")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Ask NewinMeter why" }));
    expect(screen.getByRole("status")).toBeDefined();
    await act(async () => vi.advanceTimersByTime(420));
    expect(screen.getByText(/largest spike overlaps your Cooking Activity/i)).toBeDefined();
    expect(screen.getByText(/recorded during the period labelled Cooking/i)).toBeDefined();
  });

  it("reveals the assistant answer immediately when reduced motion is preferred", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });
    render(<EnergyPlayground />);

    fireEvent.click(screen.getByRole("button", { name: "Ask NewinMeter why" }));

    expect(screen.getByText(/late-night spike overlaps your Geyser Activity/i)).toBeDefined();
  });

  it("lets visitors inspect different parts of a day", () => {
    render(<DayExplorer />);

    fireEvent.click(screen.getByRole("button", { name: "Morning" }));
    expect(screen.getByText("06:00–10:00")).toBeDefined();
    expect(screen.getByText(/morning rise stayed close/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /18:00.*Select Evening/i }));
    expect(screen.getByText("18:00–20:00")).toBeDefined();
  });

  it("connects Activity selections to the assistant explanation", () => {
    render(<ActivityAssistantDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Cooking" }));
    expect(screen.getByText("What happened around dinner?")).toBeDefined();
    expect(screen.getByText(/overlaps your Cooking Activity/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Geyser/i }));
    expect(screen.getByText("Why was last night expensive?")).toBeDefined();
    expect(screen.getByText(/largest spike overlaps your Geyser Activity/i)).toBeDefined();
  });

  it("updates alert state as the threshold changes", () => {
    render(<AlertPlayground />);

    expect(screen.getByText("Notification ready")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Increase Daily spending threshold/i }));
    expect(screen.getByText("R60")).toBeDefined();
    expect(screen.getByText("Waiting for threshold")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Low balance" }));
    expect(screen.getByText(/Your balance is R186.40/i)).toBeDefined();
  });
});
