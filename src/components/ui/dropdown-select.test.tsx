// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownSelect } from "./dropdown-select";

describe("DropdownSelect", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("portals the menu directly below the trigger at the same width", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 97,
      height: 36,
      left: 174,
      right: 384,
      top: 61,
      width: 210,
      x: 174,
      y: 61,
      toJSON: () => undefined
    });

    render(
      <DropdownSelect
        ariaLabel="Role"
        onChange={() => undefined}
        options={[
          { label: "Admin", value: "admin" },
          { label: "User", value: "user" }
        ]}
        value="user"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Role" }));

    const menu = screen.getByRole("listbox", { name: "Role" });
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe("174px");
    expect(menu.style.top).toBe("101px");
    expect(menu.style.width).toBe("210px");
  });
});
