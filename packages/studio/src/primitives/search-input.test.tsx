import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SearchInput } from "./search-input";
import { Sheet, SheetContent } from "./sheet";

function Controlled({ inSheet = false }: Readonly<{ inSheet?: boolean }>) {
  const [q, setQ] = useState("");
  const field = <SearchInput aria-label="Search media" className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} />;
  if (!inSheet) return field;
  return (
    <Sheet defaultOpen>
      <SheetContent title="Search" header={field}>
        <p>Results</p>
      </SheetContent>
    </Sheet>
  );
}

describe("SearchInput", () => {
  afterEach(cleanup);

  it("is an input with a leading glyph, sized by its wrapper", () => {
    const { container } = render(<Controlled />);
    const input = screen.getByRole("textbox", { name: "Search media" });
    expect(input.className).toContain("pl-9");
    expect((container.firstElementChild as HTMLElement).className).toContain("flex-1");
    expect(container.querySelector("svg[aria-hidden]")).toBeTruthy();
  });

  it("offers a clear button only while it holds text, which clears and keeps focus", async () => {
    render(<Controlled />);
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "Search media" }) as HTMLInputElement;
    await user.type(input, "logo");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears on Escape first, and lets a second Escape close the sheet around it", async () => {
    render(<Controlled inSheet />);
    const user = userEvent.setup();
    const input = (await screen.findByRole("textbox", { name: "Search media" })) as HTMLInputElement;
    await user.type(input, "logo");
    await user.keyboard("{Escape}");
    expect(input.value).toBe("");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
