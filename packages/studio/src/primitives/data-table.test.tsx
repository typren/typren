import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataColumn } from "./data-table";

afterEach(cleanup);

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "1", name: "alpha" },
  { id: "2", name: "beta" },
];
const columns: DataColumn<Row>[] = [
  { id: "name", header: "Name", width: 200, minWidth: 100, cell: (r) => r.name },
  { id: "id", header: "Id", cell: (r) => r.id, resizable: false },
];
const mount = (extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} {...extra} />);
const colWidth = () => (document.querySelector("col") as HTMLElement).style.width;

describe("DataTable", () => {
  it("pins the header at stickyTop", () => {
    mount({ stickyTop: 48 });
    const th = screen.getByText("Name").closest("th")!;
    expect(th.style.top).toBe("48px");
    expect(th.className).toContain("sticky");
    // The browser's top blur is the pinned header's edge: no divider stroke.
    expect(th.closest("tr")!.className).not.toContain("border-b");
    expect(th.className).not.toContain("stroke-divider");
  });

  it("renders headers, cells and row props", () => {
    const onClick = vi.fn();
    mount({ rowProps: (r) => ({ onClick: () => onClick(r.id), className: "picked" }), gutter: 8 });
    expect(screen.getByText("Name")).toBeTruthy();
    fireEvent.click(screen.getByText("beta"));
    expect(onClick).toHaveBeenCalledWith("2");
    expect(screen.getByText("beta").closest("tr")!.className).toContain("picked");
  });

  it("only resizable columns get a separator", () => {
    mount();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByRole("separator", { name: "Resize Name column" })).toBeTruthy();
  });

  it("resizes by arrow keys, floors at minWidth, and resets on double click", () => {
    mount();
    const sep = screen.getByRole("separator");
    expect(colWidth()).toBe("200px");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(colWidth()).toBe("216px");
    for (let i = 0; i < 10; i++) fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(colWidth()).toBe("100px");
    fireEvent.keyDown(sep, { key: "Enter" });
    expect(colWidth()).toBe("100px");
    fireEvent.doubleClick(sep);
    expect(colWidth()).toBe("200px");
  });

  it("drags the edge with the pointer and releases on pointerup", () => {
    mount();
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientX: 100 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(sep.dataset.dragging).toBe("true");
    fireEvent(window, new MouseEvent("pointermove", { clientX: 150 }));
    expect(colWidth()).toBe("250px");
    fireEvent(window, new MouseEvent("pointerup"));
    expect(document.body.style.cursor).toBe("");
    expect(sep.dataset.dragging).toBeUndefined();
    fireEvent(window, new MouseEvent("pointermove", { clientX: 400 }));
    expect(colWidth()).toBe("250px");
  });

  it("a sortable header cycles ascending, descending, default and sets aria-sort", () => {
    const cols: DataColumn<Row>[] = [{ ...columns[0]!, sort: (r) => r.name }, columns[1]!];
    const names = () => [...document.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
    render(<DataTable columns={cols} rows={[rows[1]!, rows[0]!]} rowKey={(r) => r.id} />);
    const th = screen.getAllByRole("columnheader")[0]!;
    const button = screen.getByRole("button", { name: "Name" });
    expect(th.getAttribute("aria-sort")).toBeNull();
    fireEvent.click(button);
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    expect(names()).toEqual(["alpha", "beta"]);
    fireEvent.click(button);
    expect(th.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["beta", "alpha"]);
    fireEvent.click(button);
    expect(th.getAttribute("aria-sort")).toBeNull();
    expect(names()).toEqual(["beta", "alpha"]);
    expect(screen.queryByRole("button", { name: "Id" })).toBeNull();
  });
});
