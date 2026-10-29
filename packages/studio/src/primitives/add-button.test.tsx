import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderPlus } from "lucide-react";
import { AddButton, AddMenu } from "./add-button";
import { TooltipProvider } from "./tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("AddButton", () => {
  afterEach(cleanup);

  it("is an icon button named by its label, with the label as a tooltip", async () => {
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <AddButton label="Add thing" onClick={onClick} />
      </TooltipProvider>
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Add thing" });
    expect(button.textContent).toBe("");
    await user.hover(button);
    expect((await screen.findByText("Add thing")).closest("[data-slot=tooltip-content]")).toBeTruthy();
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the label beside the glyph when labelled", () => {
    render(<AddButton labelled label="Add item" />);
    expect(screen.getByRole("button", { name: "Add item" }).textContent).toBe("Add item");
  });

  it("takes another glyph", () => {
    const { container } = render(<AddButton label="New folder" icon={<FolderPlus data-testid="glyph" />} />);
    expect(screen.getByTestId("glyph")).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("triggers a popover when rendered by one", async () => {
    render(
      <Popover>
        <PopoverTrigger render={<AddButton label="Add to list" />} />
        <PopoverContent>Menu</PopoverContent>
      </Popover>
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("Menu")).toBeTruthy();
  });
});

describe("AddMenu", () => {
  afterEach(cleanup);

  it("picks an option", async () => {
    const onPick = vi.fn();
    render(<AddMenu label="Add section" options={[{ value: "hero", label: "Hero" }]} onPick={onPick} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Add section" }));
    await user.click(await screen.findByRole("option", { name: "Hero" }));
    expect(onPick).toHaveBeenCalledWith("hero");
  });
});
