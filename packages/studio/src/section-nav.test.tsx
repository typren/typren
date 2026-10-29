import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSections } from "@typren/core";
import { SectionNav } from "./section-nav";

afterEach(cleanup);

const sections = resolveSections({}); // default trio: pages, media, settings

describe("SectionNav", () => {
  it("renders every resolved section as a row, from data only", () => {
    render(<SectionNav sections={sections} activeId="pages" onSelect={() => {}} dark={false} onToggleTheme={() => {}} />);
    for (const s of sections) expect(screen.getByRole("button", { name: s.label })).toBeTruthy();
  });

  it("marks the active section current and leaves the rest unmarked", () => {
    render(<SectionNav sections={sections} activeId="media" onSelect={() => {}} dark={false} onToggleTheme={() => {}} />);
    expect(screen.getByRole("button", { name: "Media" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Pages" }).getAttribute("aria-current")).toBeNull();
  });

  it("calls onSelect with the clicked section's id, not a route", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SectionNav sections={sections} activeId="pages" onSelect={onSelect} dark={false} onToggleTheme={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("the one theme toggle calls onToggleTheme and reflects `dark`", async () => {
    const onToggleTheme = vi.fn();
    const user = userEvent.setup();
    render(<SectionNav sections={sections} activeId="pages" onSelect={() => {}} dark={false} onToggleTheme={onToggleTheme} />);
    await user.click(screen.getByRole("button", { name: "Toggle editor theme" }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });
});
