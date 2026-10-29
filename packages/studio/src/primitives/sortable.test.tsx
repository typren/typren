import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AnnounceContext } from "../announce";
import { DragHandle, folderDrop, useSortable, type Where } from "./sortable";

function List({ onMove }: Readonly<{ onMove: (from: string, to: string, where: Where) => void }>) {
  const [items, setItems] = useState(["a", "b", "c"]);
  const row = useSortable({
    onMove,
    nests: (id) => id === "b",
    onStep: (id, by) => {
      const i = items.indexOf(id);
      const j = i + by;
      if (j < 0 || j >= items.length) return null;
      const next = [...items];
      [next[i], next[j]] = [next[j]!, next[i]!];
      setItems(next);
      return { to: id, message: `${id} moved to ${j + 1}` };
    },
  });
  return (
    <ul>
        {items.map((id) => (
          <li key={id} {...row(id)}>
            <DragHandle />
            <button type="button">{id}</button>
          </li>
        ))}
    </ul>
  );
}

const over = (el: HTMLElement, clientY: number) => fireEvent(el, new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY }));
const li = (name: string) => screen.getByRole("button", { name }).closest("li")!;
// jsdom lays nothing out; give the row a 40px box at the top.
const box = (el: HTMLElement) =>
  (el.getBoundingClientRect = () => ({ top: 0, height: 40, left: 0, width: 100, bottom: 40, right: 100, x: 0, y: 0, toJSON: () => ({}) }));

describe("useSortable", () => {
  afterEach(cleanup);

  it("drops before, after or inside by where the pointer sits, with a line and a faded source", () => {
    const onMove = vi.fn();
    render(<List onMove={onMove} />);
    const [a, b, c] = [li("a"), li("b"), li("c")];
    [a, b, c].forEach(box);
    fireEvent.dragStart(a);
    expect(a.className).toContain("opacity-40");
    over(c, 5);
    expect(c.className).toContain("inset_0_2px_0");
    over(c, 35);
    expect(c.className).toContain("inset_0_-2px_0");
    fireEvent.drop(c);
    expect(onMove).toHaveBeenLastCalledWith("a", "c", "after");
    fireEvent.dragStart(a);
    over(b, 20);
    expect(b.className).toContain("ring-2");
    fireEvent.drop(b);
    expect(onMove).toHaveBeenLastCalledWith("a", "b", "inside");
    // A row never nests that doesn't take it; dropping on itself does nothing.
    fireEvent.dragStart(a);
    over(c, 20);
    fireEvent.dragLeave(c);
    over(a, 20);
    fireEvent.drop(a);
    expect(onMove).toHaveBeenCalledTimes(2);
    fireEvent.dragEnd(a);
    expect(a.className).not.toContain("opacity-40");
  });

  it("ignores drags that didn't start in the list", () => {
    const onMove = vi.fn();
    render(<List onMove={onMove} />);
    fireEvent.dragOver(li("a"), { clientY: 5 });
    fireEvent.drop(li("a"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("steps a row with Alt+Arrow, keeps focus on it and announces the move", () => {
    const announce = vi.fn();
    render(
      <AnnounceContext value={announce}>
        <List onMove={() => {}} />
      </AnnounceContext>
    );
    screen.getByRole("button", { name: "a" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown", altKey: true });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["b", "a", "c"]);
    expect(document.activeElement?.textContent).toBe("a");
    expect(announce).toHaveBeenCalledWith("a moved to 2");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["a", "b", "c"]);
    expect(announce).toHaveBeenCalledTimes(2);
  });
});

describe("folderDrop", () => {
  const drop = (types: string[], data: Record<string, string>, files: File[] = []) =>
    ({
      dataTransfer: { types, getData: (t: string) => data[t] ?? "", files },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { contains: () => false },
      relatedTarget: null,
    }) as never;

  it("moves a dragged item or uploads files into the folder, reporting the hover", () => {
    const onMove = vi.fn();
    const onFiles = vi.fn();
    const setOver = vi.fn();
    const props = folderDrop("docs", { onMove, onFiles, setOver, type: "x/item" });
    props.onDragOver(drop(["x/item"], {}));
    expect(setOver).toHaveBeenLastCalledWith("docs");
    props.onDragOver(drop(["text/plain"], {}));
    expect(setOver).toHaveBeenCalledTimes(1);
    props.onDragLeave(drop([], {}));
    expect(setOver).toHaveBeenLastCalledWith(null);
    props.onDrop(drop(["x/item"], { "x/item": "7" }));
    expect(onMove).toHaveBeenCalledWith("7", "docs");
    const file = new File(["x"], "a.png");
    props.onDrop(drop(["Files"], {}, [file]));
    expect(onFiles).toHaveBeenCalledWith([file], "docs");
    props.onDrop(drop([], {}));
    expect(onMove).toHaveBeenCalledOnce();
  });
});
