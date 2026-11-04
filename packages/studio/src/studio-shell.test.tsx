import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioShell, type StudioShellEntry } from "./studio-shell";

afterEach(cleanup);

const entries: StudioShellEntry[] = [
  { id: "sites", label: "Sites", icon: <svg data-testid="sites-icon" /> },
  { id: "domains", label: "Domains", group: "Account" },
  { id: "billing", label: "Billing", group: "Account" },
  { id: "members", label: "Members", group: "Team" },
];

const mount = (props: Partial<Parameters<typeof StudioShell>[0]> = {}) =>
  render(
    <StudioShell title="Acme" entries={entries} activeId="domains" onNavigate={() => {}} {...props}>
      <p>Domains screen</p>
    </StudioShell>
  );

describe("StudioShell", () => {
  it("heads the rail with the title and groups entries in order, ungrouped first", () => {
    mount();
    const rail = within(screen.getByRole("navigation", { name: "Studio" }));
    expect(rail.getByText("Acme")).toBeTruthy();
    expect(rail.getAllByRole("button").map((b) => b.textContent).filter(Boolean)).toEqual(["Sites", "Account", "Domains", "Billing", "Team", "Members"]);
    expect(screen.getByTestId("sites-icon")).toBeTruthy();
  });

  it("selects the active entry, names the screen after it and navigates on click", async () => {
    const onNavigate = vi.fn();
    mount({ onNavigate });
    expect(screen.getByRole("button", { name: "Domains" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Billing" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Domains");
    await userEvent.setup().click(screen.getByRole("button", { name: "Billing" }));
    expect(onNavigate).toHaveBeenCalledWith("billing");
  });

  it("renders the host's screen, top bar slot and back link", async () => {
    const onBack = vi.fn();
    mount({ topBarSlot: <button type="button">Account menu</button>, back: { label: "Typren Cloud", onBack } });
    expect(screen.getByText("Domains screen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Typren Cloud" })[0]);
    expect(onBack).toHaveBeenCalled();
  });

  it("shows the Typren lockup without a back link", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Typren Cloud" })).toBeNull();
  });
});
