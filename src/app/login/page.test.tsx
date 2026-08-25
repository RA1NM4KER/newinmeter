// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LoginPage from "./page";

const ENV_KEY = "NEWINMETER_DEMO_ACCESS_TOKEN";

describe("LoginPage demo-token gating", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = "correct-token";
  });

  afterEach(() => {
    cleanup();
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("does not show the demo option for an ordinary /login visit (no token)", () => {
    render(<LoginPage searchParams={{}} />);
    expect(screen.queryByText("Explore demo account")).toBeNull();
  });

  it("does not show the demo option for an invalid token", () => {
    render(<LoginPage searchParams={{ demo: "wrong-token" }} />);
    expect(screen.queryByText("Explore demo account")).toBeNull();
  });

  it("does not show the demo option when the feature is unconfigured, even with a token supplied", () => {
    delete process.env[ENV_KEY];
    render(<LoginPage searchParams={{ demo: "correct-token" }} />);
    expect(screen.queryByText("Explore demo account")).toBeNull();
  });

  it("shows the demo option for a server-validated, correct token", () => {
    render(<LoginPage searchParams={{ demo: "correct-token" }} />);
    expect(screen.queryByText("Explore demo account")).not.toBeNull();
  });

  it("presents the interactive product and keeps sign-in in the hero", () => {
    render(<LoginPage searchParams={{}} />);

    expect(screen.getByRole("heading", { level: 1, name: /see what your electricity/i })).toBeDefined();
    expect(screen.getByText("Connect your account")).toBeDefined();
    expect(screen.getByRole("region", { name: "Illustrative NewinMeter playground" })).toBeDefined();
  });

  it("includes the product-story sections", () => {
    render(<LoginPage searchParams={{}} />);

    expect(screen.getByRole("heading", { name: "Every day has a shape." })).toBeDefined();
    expect(screen.getByRole("heading", { name: /Label what was happening/i })).toBeDefined();
    expect(screen.getByRole("heading", { name: /You don’t need to keep checking/i })).toBeDefined();
  });
});
