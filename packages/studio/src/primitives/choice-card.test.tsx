import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoiceCard } from "./choice-card";

describe("ChoiceCard", () => {
  afterEach(cleanup);

  it("is a radio that selects on click and marks the checked card with the fill alone", async () => {
    const onSelect = vi.fn();
    render(
      <div role="radiogroup" aria-label="Start">
        <ChoiceCard name="start" checked onSelect={() => {}}>Blank</ChoiceCard>
        <ChoiceCard name="start" checked={false} onSelect={onSelect}>Template</ChoiceCard>
      </div>
    );
    const blank = screen.getByRole("radio", { name: "Blank" }) as HTMLInputElement;
    expect(blank.checked).toBe(true);
    const card = blank.closest("label")!;
    expect(card.className).toContain("fill-subtle-selected");
    expect(card.className).not.toContain("ring-[var(--typren-fg)]");
    await userEvent.setup().click(screen.getByText("Template"));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
