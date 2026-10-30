import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BlockList } from "./block-list";

const slices = [{ slice: "hero" }, { slice: "features", label: "Perks" }, { slice: "footer" }];

function setup() {
  const onReorder = vi.fn();
  render(
    <BlockList
      title="Home"
      slices={slices}
      selectedIndex={0}
      sliceNames={["hero"]}
      onSelect={() => {}}
      onReorder={onReorder}
      onAdd={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
    />
  );
  const rows = screen.getAllByRole("listitem");
  for (const r of rows)
    r.getBoundingClientRect = () => ({ top: 0, height: 40, left: 0, width: 100, bottom: 40, right: 100, x: 0, y: 0, toJSON: () => ({}) });
  return { onReorder, rows };
}
const over = (el: HTMLElement, clientY: number) => fireEvent(el, new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY }));

describe("BlockList", () => {
  afterEach(cleanup);

  it("marks the selected row for the list's one selection fill", () => {
    const { rows } = setup();
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual(["page", null, null]);
  });

  it("reorders to the index a drop line marks", () => {
    const { onReorder, rows } = setup();
    fireEvent.dragStart(rows[0]!);
    over(rows[2]!, 35);
    fireEvent.drop(rows[2]!);
    expect(onReorder).toHaveBeenLastCalledWith(0, 2);
    fireEvent.dragStart(rows[2]!);
    over(rows[0]!, 5);
    fireEvent.drop(rows[0]!);
    expect(onReorder).toHaveBeenLastCalledWith(2, 0);
    // Just above the row below itself is where it already is.
    fireEvent.dragStart(rows[0]!);
    over(rows[1]!, 5);
    fireEvent.drop(rows[1]!);
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("steps a section with Alt+Arrow", () => {
    const { onReorder } = setup();
    const perks = screen.getByRole("button", { name: /Perks/ });
    fireEvent.keyDown(perks, { key: "ArrowUp", altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(1, 0);
    fireEvent.keyDown(screen.getByRole("button", { name: /footer/ }), { key: "ArrowDown", altKey: true });
    expect(onReorder).toHaveBeenCalledOnce();
  });
});
