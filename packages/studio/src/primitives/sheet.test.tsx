import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet, SheetContent, SheetTrigger } from "./sheet";

function Harness() {
  return (
    <Sheet>
      <SheetTrigger>Open</SheetTrigger>
      <SheetContent title="Search" header={<input aria-label="Query" />}>
        <p>Results</p>
      </SheetContent>
    </Sheet>
  );
}

const open = async () => {
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Open" }));
  return screen.findByRole("dialog", { name: "Search" });
};
const header = () => document.querySelector<HTMLElement>("[data-slot=sheet-header]")!;
const pull = (dy: number, ms: number) => {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  fireEvent.pointerDown(header(), { clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(header(), { clientY: dy, pointerId: 1 });
  now.mockReturnValue(ms);
  fireEvent.pointerUp(header(), { clientY: dy, pointerId: 1 });
  now.mockRestore();
};

describe("Sheet", () => {
  afterEach(cleanup);

  it("is a labelled dialog with a header and content, closed by Escape", async () => {
    expect(await open()).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Query" })).toBeTruthy();
    expect(screen.getByText("Results")).toBeTruthy();
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("follows a drag on its header and settles back from a short slow one", async () => {
    const dialog = await open();
    Object.defineProperty(dialog, "offsetHeight", { value: 800 });
    fireEvent.pointerDown(header(), { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(header(), { clientY: 3, pointerId: 1 });
    expect(dialog.style.translate).toBe("");
    fireEvent.pointerMove(header(), { clientY: 100, pointerId: 1 });
    expect(dialog.style.translate).toBe("0 100px");
    fireEvent.pointerCancel(header(), { pointerId: 1 });
    expect(dialog.style.translate).toBe("");
    pull(100, 1000);
    expect(dialog.style.translate).toBe("");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(header(), { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(header(), { clientY: 50, pointerId: 1 });
    fireEvent.pointerCancel(header(), { pointerId: 1 });
    expect(dialog.style.translate).toBe("");
  });

  it("dismisses past a quarter of its height", async () => {
    const dialog = await open();
    Object.defineProperty(dialog, "offsetHeight", { value: 800 });
    pull(300, 5000);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("dismisses on a quick flick", async () => {
    const dialog = await open();
    Object.defineProperty(dialog, "offsetHeight", { value: 800 });
    pull(80, 50);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
